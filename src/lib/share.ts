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


