import type { Route } from '../components/Layout';

export function parseRoute(pathname: string): Route {
  const clean = pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
  if (clean === 'my-page' || clean === 'mypage') return 'mypage';
  if (clean === 'market') return 'market';
  if (clean === 'editor' || /^editor\/[^/]+$/.test(clean)) return 'editor';
  return 'studio';
}

export function editorId(pathname: string): string | null {
  const match = /^\/editor\/([^/]+)\/?$/.exec(pathname);
  try { return match ? decodeURIComponent(match[1]) : null; }
  catch { return null; }
}

export function editorPath(id: string): string {
  return `/editor/${encodeURIComponent(id)}`;
}
