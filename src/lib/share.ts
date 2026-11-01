import type { Song } from './schema';

export interface MintShareData {
  songId: string;
  title: string;
  creator: string;
  creatorAddress: string;
  image?: string;
  network?: string;
  txHash?: string;
  metadataCid?: string;
  justPublished?: boolean;
}

const STORAGE_KEY = 'mint_share';

const env =
  (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};

function resolveOrigin(): string {
  const configured = (env.VITE_APP_URL ?? '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin.replace(/\/+$/, '');
  }
  return 'https://app.rawchunks.space';
}

export function songToShareData(
  song: Song,
  creatorSlug?: string | null,
  justPublished = false,
  fallbackCover?: string | null
): MintShareData {
  const cleanCreator = creatorSlug?.trim() || song.creator;
  const resolvedImage = song.image?.trim() || fallbackCover?.trim() || undefined;
  return {
    songId: song.id,
    title: song.title,
    creator: cleanCreator,
    creatorAddress: song.creator,
    image: resolvedImage,
    network: song.network,
    txHash: song.tx_hash,
    metadataCid: song.metadata_cid,
    justPublished,
  };
}

export function saveMintSuccessForShare(data: MintShareData): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('Failed to save mint share data:', e);
  }
}

export function getMintSuccessForShare(): MintShareData | null {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored) as MintShareData;
    }
  } catch (e) {
    console.warn('Failed to retrieve mint share data:', e);
  }
  return null;
}

export function clearMintSuccessShare(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn('Failed to clear mint share data:', e);
  }
}

export function buildShareUrl(creator: string): string {
  const clean = creator?.trim();
  return clean ? `${resolveOrigin()}/market/${clean}` : `${resolveOrigin()}/market`;
}

export function buildShareDisplayUrl(creator: string): string {
  return buildShareUrl(creator).replace(/^https?:\/\//i, '');
}

export function buildShareCopy(data: MintShareData): string {
  const title = data.title?.trim() || 'Untitled';
  const url = buildShareUrl(data.creator);
  return `${title} is live 🙌 \n\nYou can now Stream it or Remix it on @rawchunks \n\n${url}`;
}

export function buildShareIntentUrl(text: string): string {
  const params = new URLSearchParams({
    text: text.trim(),
  });
  return `https://x.com/intent/post?${params.toString()}`;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function loadImageElement(src: string, anonymous = false): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (anonymous) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = src;
  });
}

async function loadCorsSafeImage(src: string): Promise<HTMLImageElement> {
  try {
    const response = await fetch(src, {
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-cache',
    });
    if (response.ok) {
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      try {
        return await loadImageElement(objectUrl, false);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    }
  } catch {
    // Fall back to direct image element loading
  }
  return loadImageElement(src, true);
}

function drawCoverFit(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  dx: number,
  dy: number,
  dWidth: number,
  dHeight: number
): void {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) return;

  const scale = Math.max(dWidth / iw, dHeight / ih);
  const sw = dWidth / scale;
  const sh = dHeight / scale;
  const sx = (iw - sw) / 2;
  const sy = (ih - sh) / 2;

  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dWidth, dHeight);
}

/**
 * Renders the native 1:1 (1080x1080) cover-art frame:
 * 1:1 square cover art + neon green (#00ff41) inset frame border,
 * with zero outer background margin.
 */
export async function renderShareCardPng(
  _title: string,
  imageUrl?: string
): Promise<Blob> {
  // 1080x1080 (1:1): X's native 1:1 square single-image feed specification
  const size = 1080;
  const radius = 12;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context unavailable');
  }

  // Clip strictly to the 1:1 native frame
  ctx.save();
  drawRoundedRect(ctx, 0, 0, size, size, radius);
  ctx.clip();

  ctx.fillStyle = '#0c0c12';
  ctx.fillRect(0, 0, size, size);

  let drewCover = false;
  if (imageUrl && imageUrl.trim()) {
    try {
      const coverImg = await loadCorsSafeImage(imageUrl.trim());
      drawCoverFit(ctx, coverImg, 0, 0, size, size);
      drewCover = true;
    } catch (e) {
      console.warn('Could not load track cover for share card, using brand mark:', e);
    }
  }

  if (!drewCover) {
    try {
      const fallbackLogo = await loadImageElement('/branding/mark.svg', false);
      const logoSize = Math.round(size * 0.28);
      const logoX = Math.round((size - logoSize) / 2);
      const logoY = Math.round((size - logoSize) / 2);
      ctx.globalAlpha = 0.65;
      ctx.drawImage(fallbackLogo, logoX, logoY, logoSize, logoSize);
      ctx.globalAlpha = 1;
    } catch {
      // Keep dark cover surface if mark svg is unavailable
    }
  }

  // Native frame border (--primary #00ff41) inset along perimeter
  ctx.save();
  ctx.strokeStyle = '#00ff41';
  ctx.lineWidth = 4;
  drawRoundedRect(ctx, 2, 2, size - 4, size - 4, radius - 1);
  ctx.stroke();
  ctx.restore();

  ctx.restore();

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to encode share card PNG'));
      },
      'image/png',
      1
    );
  });
}


