import { api } from './api';
import { fetchPublicLyrics, type PublicLyrics } from './lyrics';
import type { Song } from './schema';

export interface SongMeta {
  bpm?: number;
  keyScale?: string;
}

interface CacheEntry<T> {
  value: T;
  at: number;
}

const MAX_ENTRIES = 16;
const TTL_MS = 10 * 60 * 1000;

const metaCache = new Map<string, CacheEntry<SongMeta>>();
const lyricsCache = new Map<string, CacheEntry<PublicLyrics>>();
const songCache = new Map<string, CacheEntry<Song>>();
const inflightMeta = new Map<string, Promise<SongMeta | null>>();
const inflightLyrics = new Map<string, Promise<PublicLyrics | null>>();

function prune<T>(map: Map<string, CacheEntry<T>>) {
  while (map.size > MAX_ENTRIES) {
    const oldestKey = map.keys().next().value;
    if (oldestKey !== undefined) map.delete(oldestKey);
    else break;
  }
}

export function getCachedSongMeta(songId: string): SongMeta | null {
  const hit = metaCache.get(songId);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    metaCache.delete(songId);
    return null;
  }
  return hit.value;
}

export function setCachedSongMeta(songId: string, value: SongMeta): void {
  metaCache.delete(songId);
  metaCache.set(songId, { value, at: Date.now() });
  prune(metaCache);
}

export function getCachedLyrics(songId: string): PublicLyrics | null {
  const hit = lyricsCache.get(songId);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    lyricsCache.delete(songId);
    return null;
  }
  return hit.value;
}

export function setCachedLyrics(songId: string, value: PublicLyrics): void {
  lyricsCache.delete(songId);
  lyricsCache.set(songId, { value, at: Date.now() });
  prune(lyricsCache);
}

export function getCachedSongRecord(songId: string): Song | null {
  const hit = songCache.get(songId);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    songCache.delete(songId);
    return null;
  }
  return hit.value;
}

export function setCachedSongRecord(song: Song): void {
  if (!song?.id) return;
  songCache.delete(song.id);
  songCache.set(song.id, { value: song, at: Date.now() });
  prune(songCache);
}

export function clearPrefetchCache(): void {
  metaCache.clear();
  lyricsCache.clear();
  songCache.clear();
  inflightMeta.clear();
  inflightLyrics.clear();
}

export function extractSongMetaFromResponse(data: any): SongMeta {
  const takes: any[] = Array.isArray(data?.takes) ? data.takes : [];
  const baseTake =
    takes.find((t) => t?.is_active && !t?.stem_id) ??
    takes.find((t) => t?.task === 'text2music') ??
    takes.find((t) => t?.is_active) ??
    takes[0];
  const params = (baseTake?.provenance?.parameters ?? {}) as Record<string, any>;
  const submitted = (params.submitted ?? params) as Record<string, any>;
  const resolved = (params.resolved ?? {}) as Record<string, any>;
  const rawBpm = Number(submitted.bpm ?? resolved.bpm);
  const rawKey = String(submitted.keyScale ?? submitted.keyscale ?? resolved.keyscale ?? '').trim();
  return {
    bpm: Number.isFinite(rawBpm) && rawBpm >= 30 && rawBpm <= 260 ? Math.round(rawBpm) : undefined,
    keyScale: rawKey && rawKey.toLowerCase() !== 'unknown' ? rawKey : undefined,
  };
}

export function prefetchSongAssets(song: Song | null | undefined, userAddress?: string): void {
  if (!song?.id || typeof window === 'undefined') return;
  setCachedSongRecord(song);

  if (song.image && song.image.trim()) {
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = song.image;
    } catch { }
  }

  if (!getCachedSongMeta(song.id) && !inflightMeta.has(song.id)) {
    const p = api
      .fetch(`/api/songs/${encodeURIComponent(song.id)}`, userAddress ? { userAddress } : undefined)
      .then(async (res) => {
        if (!res.ok) return null;
        const data = await res.json();
        const rec = Array.isArray(data) ? data[0] : (data?.song || data);
        if (rec?.id) setCachedSongRecord(rec as Song);
        const meta = extractSongMetaFromResponse(data);
        setCachedSongMeta(song.id, meta);
        return meta;
      })
      .catch(() => null)
      .finally(() => {
        inflightMeta.delete(song.id);
      });
    inflightMeta.set(song.id, p);
  }

  const cachedLyrics = getCachedLyrics(song.id);
  if ((!cachedLyrics || cachedLyrics.status === 'transcribing') && !inflightLyrics.has(song.id)) {
    const p = fetchPublicLyrics(song.id, { userAddress: userAddress || undefined })
      .then((data) => {
        if (data?.status === 'cached' || data?.status === 'none') {
          setCachedLyrics(song.id, data);
        }
        return data;
      })
      .catch(() => null)
      .finally(() => {
        inflightLyrics.delete(song.id);
      });
    inflightLyrics.set(song.id, p);
  }
}
