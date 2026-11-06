import type { Route } from '../components/Layout';

const RESERVED_ROOT_SEGMENTS = new Set([
  '',
  'studio',
  'my-page',
  'mypage',
  'market',
  'editor',
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

export function parseRoute(pathname: string): Route {
  const clean = pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
  if (clean === 'my-page' || clean === 'mypage') return 'mypage';
  if (clean === 'editor' || /^editor\/[^/]+$/.test(clean)) return 'editor';
  if (clean === 'market' || marketCreator(pathname) !== null) return 'market';
  return 'studio';
}

export function marketPath(creator?: string | null): string {
  const creatorSlug = toUrlSlug(creator);
  return creatorSlug ? `/${creatorSlug}` : '/market';
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
