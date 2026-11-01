import type { Route } from '../components/Layout';

export function parseRoute(pathname: string): Route {
  const clean = pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
  if (clean === 'my-page' || clean === 'mypage') return 'mypage';
  if (clean === 'market' || /^market\/[^/]+$/.test(clean)) return 'market';
  if (clean === 'editor' || /^editor\/[^/]+$/.test(clean)) return 'editor';
  return 'studio';
}

export function marketCreator(pathname: string): string | null {
  const clean = pathname.replace(/^\/+|\/+$/g, '');
  const match = /^market\/([^/]+)$/i.exec(clean);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]).trim() || null;
  } catch {
    return match[1].trim() || null;
  }
}

export function marketPath(creator?: string | null): string {
  const clean = creator?.trim();
  return clean ? `/market/${encodeURIComponent(clean)}` : '/market';
}

export function editorId(pathname: string): string | null {
  const match = /^\/editor\/([^/]+)\/?$/.exec(pathname);
  try { return match ? decodeURIComponent(match[1]) : null; }
  catch { return null; }
}

export function editorPath(id: string): string {
  return `/editor/${encodeURIComponent(id)}`;
}
