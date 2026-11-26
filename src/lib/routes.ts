import type { Route } from '../components/Layout';

const RESERVED_ROOT_SEGMENTS = new Set([
  '',
  'studio',
  'profile',
  'profile',
  'market',
  'editor',
  'video',
  'api',
  'assets',
  'branding',
  'favicon.ico',
]);

export function toUrlSlug(raw?: string | null): string {
  if (!raw) return '';
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  const trimmed = decoded.trim().replace(/^@+/, '').trim();
  if (!trimmed) return '';
  const hyphenated = trimmed
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return hyphenated ? encodeURIComponent(hyphenated) : '';
}

export function normalizeSlugKey(raw?: string | null): string {
  if (!raw) return '';
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  return decoded
    .trim()
    .replace(/^@+/, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function decodeSegment(raw: string): string | null {
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  const trimmed = decoded.trim().replace(/^@+/, '').trim();
  return trimmed || null;
}

export function navigateToSong(creator?: string | null, songTitle?: string | null, songId?: string | null): void {
  const target = marketPath(creator, songTitle);
  const state = songId ? { songId } : null;
  if (window.location.pathname !== target) {
    window.history.pushState(state, '', target);
  } else if (state) {
    window.history.replaceState(state, '', target);
  }
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function replaceSongUrl(creator?: string | null, songTitle?: string | null, songId?: string | null): void {
  const target = marketPath(creator, songTitle);
  const state = songId ? { songId } : window.history.state;
  if (window.location.pathname !== target || (songId && window.history.state?.songId !== songId)) {
    window.history.replaceState(state, '', target);
  }
}

export function marketCreator(pathname: string): string | null {
  const clean = pathname.replace(/^\/+|\/+$/g, '');
  if (!clean) return null;

  const legacyMatch = /^market\/([^/]+)(?:\/[^/]+)?$/i.exec(clean);
  if (legacyMatch) {
    return decodeSegment(legacyMatch[1]);
  }

  const segments = clean.split('/');
  if (segments.length === 1 || segments.length === 2) {
    const firstLower = segments[0].toLowerCase();
    if (RESERVED_ROOT_SEGMENTS.has(firstLower)) return null;
    return decodeSegment(segments[0]);
  }

  return null;
}

export function marketSong(pathname: string): string | null {
  const clean = pathname.replace(/^\/+|\/+$/g, '');
  if (!clean) return null;

  const legacyMatch = /^market\/[^/]+\/([^/]+)$/i.exec(clean);
  if (legacyMatch) {
    return decodeSegment(legacyMatch[1]);
  }

  const segments = clean.split('/');
  if (segments.length === 2) {
    const firstLower = segments[0].toLowerCase();
    if (RESERVED_ROOT_SEGMENTS.has(firstLower)) return null;
    return decodeSegment(segments[1]);
  }

  return null;
}

export function parseRoute(pathname: string): Route {
  const clean = pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
  if (clean === 'my-page' || clean === 'profile') return 'profile';
  if (clean === 'editor' || /^editor\/[^/]+$/.test(clean)) return 'editor';
  if (clean === 'video' || /^video\/[^/]+$/.test(clean)) return 'video';
  if (marketCreator(pathname) !== null && marketSong(pathname) !== null) return 'song';
  if (clean === 'market' || marketCreator(pathname) !== null) return 'market';
  return 'studio';
}

export function marketPath(creator?: string | null, songTitle?: string | null): string {
  const creatorSlug = toUrlSlug(creator);
  if (!creatorSlug) return '/market';
  const songSlug = toUrlSlug(songTitle);
  return songSlug ? `/${creatorSlug}/${songSlug}` : `/${creatorSlug}`;
}

export function navigateToCreator(creator?: string | null): void {
  const target = marketPath(creator);
  if (window.location.pathname !== target) {
    window.history.pushState(null, '', target);
  }
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function editorId(pathname: string): string | null {
  const match = /^\/editor\/([^/]+)\/?$/.exec(pathname);
  try { return match ? decodeURIComponent(match[1]) : null; }
  catch { return null; }
}

export function editorPath(id: string): string {
  return `/editor/${encodeURIComponent(id)}`;
}

export function videoId(pathname: string): string | null {
  const match = /^\/video\/([^/]+)\/?$/.exec(pathname);
  try { return match ? decodeURIComponent(match[1]) : null; }
  catch { return null; }
}

export function videoPath(id: string): string {
  return `/video/${encodeURIComponent(id)}`;
}
