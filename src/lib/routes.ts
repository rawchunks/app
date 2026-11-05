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

export function marketCreator(pathname: string): string | null {
  const clean = pathname.replace(/^\/+|\/+$/g, '');
  if (!clean) return null;

  const normalizeHandle = (raw: string): string | null => {
    const trimmed = raw.trim().replace(/^@+/, '').trim();
    return trimmed || null;
  };

  const legacyMatch = /^market\/([^/]+)$/i.exec(clean);
  if (legacyMatch) {
    try {
      return normalizeHandle(decodeURIComponent(legacyMatch[1]));
    } catch {
      return normalizeHandle(legacyMatch[1]);
    }
  }

  if (!clean.includes('/')) {
    const lower = clean.toLowerCase();
    if (RESERVED_ROOT_SEGMENTS.has(lower)) return null;
    try {
      return normalizeHandle(decodeURIComponent(clean));
    } catch {
      return normalizeHandle(clean);
    }
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
  const clean = creator?.trim();
  return clean ? `/${encodeURIComponent(clean)}` : '/market';
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
