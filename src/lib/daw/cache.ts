/**
 * Persistent browser storage for precomputed bipolar waveform peaks (IndexedDB)
 * and raw audio ArrayBuffers (Cache API) so page reloads render waveforms in <50ms
 * and avoid re-downloading 300MB+ of uncompressed WAV files.
 * Gracefully degrades to a no-op in Node/SSR test environments.
 */

export interface PersistedPeakRecord {
  mins: number[];
  maxs: number[];
  duration: number;
  updatedAt: number;
}

const IDB_NAME = 'rawchunks-peaks-v1';
const IDB_STORE = 'peaks';
const AUDIO_CACHE_NAME = 'rawchunks-audio-v1';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openPeakDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

export async function readPersistedPeaks(url: string): Promise<PersistedPeakRecord | null> {
  if (!url) return null;
  const db = await openPeakDb();
  if (!db) return null;
  return new Promise<PersistedPeakRecord | null>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(url);
      req.onsuccess = () => {
        const val = req.result as PersistedPeakRecord | undefined;
        if (val && Array.isArray(val.mins) && Array.isArray(val.maxs) && val.mins.length > 0) {
          resolve(val);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function writePersistedPeaks(url: string, record: PersistedPeakRecord): Promise<void> {
  if (!url || !record.mins.length) return;
  const db = await openPeakDb();
  if (!db) return;
  return new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      store.put(record, url);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

function isCacheableAudioUrl(url: string): boolean {
  return Boolean(url) && !url.startsWith('blob:') && !url.startsWith('data:');
}

export async function readCachedAudioBuffer(url: string): Promise<ArrayBuffer | null> {
  if (typeof caches === 'undefined' || !isCacheableAudioUrl(url)) return null;
  try {
    const cache = await caches.open(AUDIO_CACHE_NAME);
    const match = await cache.match(url);
    if (!match || !match.ok) return null;
    return await match.arrayBuffer();
  } catch {
    return null;
  }
}

export async function writeCachedAudioBuffer(url: string, buffer: ArrayBuffer, contentType = 'audio/wav'): Promise<void> {
  if (typeof caches === 'undefined' || !isCacheableAudioUrl(url) || buffer.byteLength === 0) return;
  try {
    const cache = await caches.open(AUDIO_CACHE_NAME);
    const response = new Response(buffer.slice(0), {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(buffer.byteLength),
        'Cache-Control': 'public, max-age=604800, immutable',
      },
    });
    await cache.put(url, response);
  } catch {
    // Ignore quota errors on restricted devices
  }
}
