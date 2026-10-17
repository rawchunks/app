export interface PersistedPeakRecord {
  mins: number[];
  maxs: number[];
  duration: number;
  updatedAt: number;
}

const IDB_NAME = 'rawchunks-peaks-v1';
const IDB_STORE = 'peaks';
const AUDIO_CACHE_NAME = 'rawchunks-audio-v1';

let idbPromise: Promise<IDBDatabase | null> | null = null;

function openPeakDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (idbPromise) return idbPromise;
  idbPromise = new Promise<IDBDatabase | null>((resolve) => {
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
  return idbPromise;
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

export interface BipolarPeaks {
  mins: Float32Array;
  maxs: Float32Array;
  rms: Float32Array;
  bins: number;
  duration: number;
}


function envelope(length: number, channels: number, rate: number, read: (frame: number, channel: number) => number, bins: number, offset = 0, duration?: number): BipolarPeaks {
  if (!Number.isFinite(bins) || bins < 1 || !Number.isFinite(offset) || offset < 0 || (duration !== undefined && (!Number.isFinite(duration) || duration < 0))) throw new Error('Invalid waveform range');
  const count = Math.min(2048, Math.floor(bins));
  const first = Math.min(length, Math.floor(offset * rate));
  const last = duration === undefined ? length : Math.min(length, Math.ceil((offset + duration) * rate));
  const frames = Math.max(0, last - first);
  const mins = new Float32Array(count), maxs = new Float32Array(count), rms = new Float32Array(count);
  for (let bin = 0; bin < count; bin++) {
    const start = first + Math.floor(bin * frames / count), end = first + Math.floor((bin + 1) * frames / count);
    let energy = 0;
    for (let frame = start; frame < end; frame++) for (let channel = 0; channel < channels; channel++) {
      const value = read(frame, channel);
      if (!Number.isFinite(value)) throw new Error('Audio contains non-finite samples');
      mins[bin] = Math.min(mins[bin], value); maxs[bin] = Math.max(maxs[bin], value); energy += value * value;
    }
    if (end > start) rms[bin] = Math.sqrt(energy / ((end - start) * channels));
  }
  return { mins, maxs, rms, bins: count, duration: length / rate };
}

export function extractBipolarPeaksFromBuffer(buffer: AudioBuffer, bins = 512, offset = 0, duration?: number): BipolarPeaks {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel));
  return envelope(buffer.length, channels.length, buffer.sampleRate, (frame, channel) => channels[channel][frame], bins, offset, duration);
}

function magnitudes(peaks: BipolarPeaks): number[] {
  return Array.from(peaks.maxs, (value, index) => Math.max(value, -peaks.mins[index]));
}

export function extractPeaksFromBuffer(buffer: AudioBuffer, bins = 256): number[] {
  return magnitudes(extractBipolarPeaksFromBuffer(buffer, bins));
}

export function extractBipolarPeaksFromWav(buffer: ArrayBuffer, bins = 512, offset = 0, duration?: number): BipolarPeaks | null {
  const view = new DataView(buffer);
  if (view.byteLength < 12 || view.getUint32(0) !== 0x52494646 || view.getUint32(8) !== 0x57415645) return null;
  let format = 0, channels = 0, rate = 0, bits = 0, align = 0, data = -1, bytes = 0;
  for (let cursor = 12; cursor + 8 <= view.byteLength;) {
    const id = view.getUint32(cursor), size = view.getUint32(cursor + 4, true), body = cursor + 8;
    if (body + size > view.byteLength) throw new Error('Truncated WAV chunk');
    if (id === 0x666d7420) {
      if (size < 16) throw new Error('Invalid WAV format');
      format = view.getUint16(body, true); channels = view.getUint16(body + 2, true); rate = view.getUint32(body + 4, true);
      align = view.getUint16(body + 12, true); bits = view.getUint16(body + 14, true);
      if (format === 0xfffe && size >= 40) format = view.getUint16(body + 24, true);
    } else if (id === 0x64617461) { data = body; bytes = size; }
    cursor = body + size + size % 2;
  }
  if (data < 0 || !channels || !rate || align !== channels * bits / 8 || bytes % align) throw new Error('Invalid WAV layout');
  if (!(format === 1 && [8, 16, 24, 32].includes(bits)) && !(format === 3 && [32, 64].includes(bits))) return null;
  const read = (frame: number, channel: number) => {
    const position = data + frame * align + channel * bits / 8;
    if (format === 3) return bits === 32 ? view.getFloat32(position, true) : view.getFloat64(position, true);
    if (bits === 8) return (view.getUint8(position) - 128) / 128;
    if (bits === 16) return view.getInt16(position, true) / 32768;
    if (bits === 24) return ((view.getInt8(position + 2) << 16) | (view.getUint8(position + 1) << 8) | view.getUint8(position)) / 8388608;
    return view.getInt32(position, true) / 2147483648;
  };
  return envelope(bytes / align, channels, rate, read, bins, offset, duration);
}

let sharedDecodeContext: BaseAudioContext | null = null;

function getDecodeContext(): BaseAudioContext {
  if (typeof window === 'undefined') {
    throw new Error('Web Audio not available in SSR');
  }
  if (sharedDecodeContext) {
    return sharedDecodeContext;
  }
  const OfflineCtx = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  if (OfflineCtx) {
    sharedDecodeContext = new OfflineCtx(1, 1, 44100);
    return sharedDecodeContext;
  }
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtx) {
    throw new Error('Web Audio API not supported in this environment');
  }
  sharedDecodeContext = new AudioCtx();
  return sharedDecodeContext;
}

/**
 * Decodes audio data from an ArrayBuffer using a singleton OfflineAudioContext so it never
 * leaks hardware audio contexts or triggers browser autoplay warnings.
 */
export async function decodeAudioBuffer(arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
  // Yield one microtask tick so any synchronous DataView peak readers on the shared ArrayBuffer
  // complete before decodeAudioData detaches the buffer.
  await Promise.resolve();
  const decodeCtx = getDecodeContext();
  return new Promise<AudioBuffer>((resolve, reject) => {
    decodeCtx.decodeAudioData(
      arrayBuffer,
      (decoded) => resolve(decoded),
      (err) => reject(err)
    );
  });
}

export type AudioLoadPriority = 'high' | 'normal';

const MAX_BACKGROUND_CONCURRENCY = 3;
const MAX_PEAK_CACHE_ENTRIES = 64;
const MAX_DECODED_BUFFER_CACHE_ENTRIES = 5;
let activeBackgroundFetches = 0;

interface QueuedFetch {
  url: string;
  start: (asHigh: boolean) => void;
  abort: () => void;
}

interface InFlightFetch {
  promise: Promise<ArrayBuffer>;
  controller: AbortController;
  isHigh: boolean;
}

const backgroundQueue: QueuedFetch[] = [];
const inFlightFetches = new Map<string, InFlightFetch>();
const canonicalPeakCache = new Map<string, Promise<BipolarPeaks>>();
const resolvedCanonicalPeaks = new Map<string, BipolarPeaks>();
const decodedBufferCache = new Map<string, Promise<AudioBuffer>>();

export function clearMemoryAudioCaches() {
  decodedBufferCache.clear();
  canonicalPeakCache.clear();
}

function canonicalCacheKey(url: string, offset = 0, duration?: number): string {
  if (offset === 0 && duration === undefined) return url;
  return `${url}|${offset}|${duration ?? ''}`;
}

function peakStorageKey(url: string, bins = 512, offset = 0, duration?: number): string {
  return `waveform:${JSON.stringify([url, bins, offset, duration])}`;
}

function persistPeakToLocalStorage(
  url: string,
  bins: number,
  offset: number,
  duration: number | undefined,
  peaks: BipolarPeaks
): void {
  if (typeof localStorage === 'undefined' || typeof localStorage.setItem !== 'function') return;
  try {
    const payload = JSON.stringify({
      mins: Array.from(peaks.mins),
      maxs: Array.from(peaks.maxs),
      rms: Array.from(peaks.rms),
      bins: peaks.bins,
      duration: peaks.duration,
    });
    localStorage.setItem(peakStorageKey(url, bins, offset, duration), payload);
  } catch {
    // Ignore storage quota errors
  }
}

function hydratePeakRecord(raw: {
  mins: number[];
  maxs: number[];
  rms?: number[];
  low?: number[];
  mid?: number[];
  high?: number[];
  bins?: number;
  duration?: number;
}): BipolarPeaks | null {
  if (!raw || !Array.isArray(raw.mins) || !Array.isArray(raw.maxs) || raw.mins.length === 0) {
    return null;
  }
  const count = raw.mins.length;
  const mins = Float32Array.from(raw.mins);
  const maxs = Float32Array.from(raw.maxs);
  const rms = Array.isArray(raw.rms) && raw.rms.length === count
    ? Float32Array.from(raw.rms)
    : Float32Array.from({ length: count }, (_, i) => Math.max(Math.abs(mins[i]), Math.abs(maxs[i])) * 0.7071);
  return {
    mins,
    maxs,
    rms,
    low: Array.isArray(raw.low) ? Float32Array.from(raw.low) : undefined,
    mid: Array.isArray(raw.mid) ? Float32Array.from(raw.mid) : undefined,
    high: Array.isArray(raw.high) ? Float32Array.from(raw.high) : undefined,
    bins: count,
    duration: typeof raw.duration === 'number' && Number.isFinite(raw.duration) ? raw.duration : 0,
  };
}

function readPeakFromLocalStorage(
  url: string,
  bins: number,
  offset: number,
  duration: number | undefined
): BipolarPeaks | null {
  if (typeof localStorage === 'undefined' || typeof localStorage.getItem !== 'function') return null;
  try {
    const rawStr = localStorage.getItem(peakStorageKey(url, bins, offset, duration));
    if (!rawStr) return null;
    return hydratePeakRecord(JSON.parse(rawStr));
  } catch {
    return null;
  }
}

function storeResolvedPeak(key: string, peaks: BipolarPeaks) {
  if (resolvedCanonicalPeaks.size >= MAX_PEAK_CACHE_ENTRIES) {
    const oldest = resolvedCanonicalPeaks.keys().next().value;
    if (oldest !== undefined) resolvedCanonicalPeaks.delete(oldest);
  }
  resolvedCanonicalPeaks.set(key, peaks);
}

function pumpBackgroundQueue() {
  while (activeBackgroundFetches < MAX_BACKGROUND_CONCURRENCY && backgroundQueue.length > 0) {
    const next = backgroundQueue.shift()!;
    activeBackgroundFetches++;
    next.start(false);
  }
}

let pendingAbortTimer: ReturnType<typeof setTimeout> | null = null;

export function cancelPendingAudioFetchAbort() {
  if (pendingAbortTimer !== null) {
    clearTimeout(pendingAbortTimer);
    pendingAbortTimer = null;
  }
}

export function abortBackgroundAudioFetches(immediate = false) {
  cancelPendingAudioFetchAbort();
  const executeAbort = () => {
    pendingAbortTimer = null;
    while (backgroundQueue.length > 0) {
      const queued = backgroundQueue.shift()!;
      queued.abort();
    }
    for (const [, entry] of inFlightFetches) {
      entry.controller.abort(new DOMException('Aborted background audio fetch', 'AbortError'));
    }
    inFlightFetches.clear();
    activeBackgroundFetches = 0;
  };
  if (immediate) {
    executeAbort();
  } else {
    pendingAbortTimer = setTimeout(executeAbort, 0);
  }
}

export function fetchAudioArrayBuffer(url: string, priority: AudioLoadPriority = 'normal'): Promise<ArrayBuffer> {
  if (!url) return Promise.reject(new Error('Audio source is required'));
  cancelPendingAudioFetchAbort();

  if (priority === 'high') {
    const queuedIdx = backgroundQueue.findIndex((item) => item.url === url);
    if (queuedIdx !== -1) {
      const [promoted] = backgroundQueue.splice(queuedIdx, 1);
      promoted.start(true);
    }
    const existingInFlight = inFlightFetches.get(url);
    if (existingInFlight && !existingInFlight.isHigh) {
      existingInFlight.isHigh = true;
      activeBackgroundFetches = Math.max(0, activeBackgroundFetches - 1);
      pumpBackgroundQueue();
    }
  }

  const existing = inFlightFetches.get(url);
  if (existing) {
    return existing.promise;
  }

  const controller = new AbortController();
  const entryState: InFlightFetch = {
    promise: Promise.resolve(new ArrayBuffer(0)),
    controller,
    isHigh: priority === 'high',
  };

  const doFetch = async (): Promise<ArrayBuffer> => {
    const cachedBuf = await readCachedAudioBuffer(url);
    if (cachedBuf && cachedBuf.byteLength > 0) {
      return cachedBuf;
    }
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Failed to load waveform (${response.status})`);
    const buf = await response.arrayBuffer();
    void writeCachedAudioBuffer(url, buf, response.headers.get('content-type') || 'audio/wav');
    return buf;
  };

  let raw: Promise<ArrayBuffer>;
  if (priority === 'high' || activeBackgroundFetches < MAX_BACKGROUND_CONCURRENCY) {
    if (!entryState.isHigh) {
      activeBackgroundFetches++;
    }
    raw = doFetch().finally(() => {
      inFlightFetches.delete(url);
      if (!entryState.isHigh) {
        activeBackgroundFetches = Math.max(0, activeBackgroundFetches - 1);
        pumpBackgroundQueue();
      }
    });
  } else {
    raw = new Promise<ArrayBuffer>((resolve, reject) => {
      const queuedEntry: QueuedFetch = {
        url,
        start: (asHigh: boolean) => {
          if (asHigh) entryState.isHigh = true;
          doFetch()
            .then(resolve, reject)
            .finally(() => {
              inFlightFetches.delete(url);
              if (!entryState.isHigh) {
                activeBackgroundFetches = Math.max(0, activeBackgroundFetches - 1);
                pumpBackgroundQueue();
              }
            });
        },
        abort: () => {
          inFlightFetches.delete(url);
          controller.abort(new DOMException('Aborted background audio fetch', 'AbortError'));
          reject(new DOMException('Aborted background audio fetch', 'AbortError'));
        },
      };
      backgroundQueue.push(queuedEntry);
      pumpBackgroundQueue();
    });
  }

  raw.catch(() => {});
  entryState.promise = raw;
  inFlightFetches.set(url, entryState);
  return raw;
}

export function getDecodedAudioBuffer(url: string, priority: AudioLoadPriority = 'normal'): Promise<AudioBuffer> {
  if (!url) return Promise.reject(new Error('Audio source is required'));
  cancelPendingAudioFetchAbort();
  const cached = decodedBufferCache.get(url);
  if (cached) {
    if (priority === 'high') {
      void fetchAudioArrayBuffer(url, 'high').catch(() => {});
    }
    return cached;
  }
  const pending = fetchAudioArrayBuffer(url, priority).then(async (raw) => {
    const key = canonicalCacheKey(url, 0, undefined);
    if (!resolvedCanonicalPeaks.has(key)) {
      const wavPeaks = extractBipolarPeaksFromWav(raw, 512, 0, undefined);
      if (wavPeaks) {
        storeResolvedPeak(key, wavPeaks);
        persistPeakToLocalStorage(url, 512, 0, undefined, wavPeaks);
        void writePersistedPeaks(key, {
          mins: Array.from(wavPeaks.mins),
          maxs: Array.from(wavPeaks.maxs),
          duration: wavPeaks.duration,
          updatedAt: Date.now(),
        });
        canonicalPeakCache.set(key, Promise.resolve(wavPeaks));
      }
    }
    const decoded = await decodeAudioBuffer(raw);
    if (!resolvedCanonicalPeaks.has(key)) {
      const bufPeaks = extractBipolarPeaksFromBuffer(decoded, 512, 0, undefined);
      storeResolvedPeak(key, bufPeaks);
      persistPeakToLocalStorage(url, 512, 0, undefined, bufPeaks);
      void writePersistedPeaks(key, {
        mins: Array.from(bufPeaks.mins),
        maxs: Array.from(bufPeaks.maxs),
        duration: bufPeaks.duration,
        updatedAt: Date.now(),
      });
      canonicalPeakCache.set(key, Promise.resolve(bufPeaks));
    }
    return decoded;
  });
  if (decodedBufferCache.size >= MAX_DECODED_BUFFER_CACHE_ENTRIES) {
    const oldest = decodedBufferCache.keys().next().value;
    if (oldest !== undefined) decodedBufferCache.delete(oldest);
  }
  decodedBufferCache.set(url, pending);
  pending.catch(() => decodedBufferCache.delete(url));
  return pending;
}

/**
 * Fetches audio from URL, decodes real PCM samples, and returns high-resolution peaks.
 */
export async function extractPeaksFromUrl(url: string, bins = 256, priority: AudioLoadPriority = 'normal'): Promise<number[]> {
  return magnitudes(await extractBipolarPeaksFromUrl(url, bins, 0, undefined, priority));
}

function resampleBipolarPeaks(source: BipolarPeaks, targetBins: number): BipolarPeaks {
  const count = Math.min(2048, Math.floor(targetBins));
  if (source.bins === count) return source;
  const mins = new Float32Array(count);
  const maxs = new Float32Array(count);
  const rms = new Float32Array(count);
  for (let bin = 0; bin < count; bin++) {
    const start = Math.floor((bin * source.bins) / count);
    const end = Math.max(start + 1, Math.min(source.bins, Math.floor(((bin + 1) * source.bins) / count)));
    let minVal = Infinity;
    let maxVal = -Infinity;
    let energy = 0;
    for (let i = start; i < end; i++) {
      if (source.mins[i] < minVal) minVal = source.mins[i];
      if (source.maxs[i] > maxVal) maxVal = source.maxs[i];
      energy += source.rms[i] * source.rms[i];
    }
    mins[bin] = Number.isFinite(minVal) ? minVal : 0;
    maxs[bin] = Number.isFinite(maxVal) ? maxVal : 0;
    rms[bin] = Math.sqrt(energy / (end - start));
  }
  return { mins, maxs, rms, bins: count, duration: source.duration };
}

function readExactPeaks(url: string, bins: number, offset: number, duration?: number): BipolarPeaks | null {
  try {
    const raw = localStorage.getItem(peakKey(url, bins, offset, duration));
    if (!raw) return null;
    const saved = JSON.parse(raw);
    const count = Math.min(2048, Math.floor(bins));
    if (![saved.mins, saved.maxs, saved.rms].every(values => Array.isArray(values) && values.length === count && values.every(Number.isFinite)) || !Number.isFinite(saved.duration)) return null;
    return { mins: Float32Array.from(saved.mins), maxs: Float32Array.from(saved.maxs), rms: Float32Array.from(saved.rms), bins: count, duration: saved.duration };
  } catch { return null; }
}

export function readPeaks(url: string, bins = 512, offset = 0, duration?: number): BipolarPeaks | null {
  if (!url) return null;
  const key = canonicalCacheKey(url, offset, duration);
  const direct = resolvedCanonicalPeaks.get(key);
  if (direct) return resampleBipolarPeaks(direct, bins);

  const exactLs = readPeakFromLocalStorage(url, bins, offset, duration);
  if (exactLs) {
    storeResolvedPeak(key, exactLs);
    return resampleBipolarPeaks(exactLs, bins);
  }

  if (offset === 0) {
    const fullKey = canonicalCacheKey(url, 0, undefined);
    let full = resolvedCanonicalPeaks.get(fullKey) ?? null;
    if (!full) {
      full = readPeakFromLocalStorage(url, 512, 0, undefined);
      if (full) storeResolvedPeak(fullKey, full);
    }
    if (full && (duration === undefined || duration >= 30 || Math.abs(duration - full.duration) <= 1.5)) {
      return resampleBipolarPeaks(full, bins);
    }
  }
  return null;
}

export async function extractBipolarPeaksFromUrl(
  url: string,
  bins = 512,
  offset = 0,
  duration?: number,
  priority: AudioLoadPriority = 'normal'
): Promise<BipolarPeaks> {
  if (!url) throw new Error('Audio source is required');
  if (
    !Number.isFinite(bins) ||
    bins < 1 ||
    !Number.isFinite(offset) ||
    offset < 0 ||
    (duration !== undefined && (!Number.isFinite(duration) || duration < 0))
  ) {
    throw new Error('Invalid waveform range');
  }
  const syncCached = readPeaks(url, bins, offset, duration);
  if (syncCached) return syncCached;

  const isFullTrack = offset === 0 && (duration === undefined || duration >= 30);
  const effectiveOffset = isFullTrack ? 0 : offset;
  const effectiveDuration = isFullTrack ? undefined : duration;
  const key = canonicalCacheKey(url, effectiveOffset, effectiveDuration);

  if (offset === 0 && canonicalPeakCache.has(canonicalCacheKey(url, 0, undefined))) {
    const fullPeaks = await canonicalPeakCache.get(canonicalCacheKey(url, 0, undefined))!;
    if (duration === undefined || duration >= 30 || Math.abs(duration - fullPeaks.duration) <= 1.5) {
      const resampled = resampleBipolarPeaks(fullPeaks, bins);
      persistPeakToLocalStorage(url, bins, offset, duration, resampled);
      return resampled;
    }
  }

  if (!canonicalPeakCache.has(key)) {
    const canonicalBins = Math.max(512, Math.min(1024, bins));
    const pending = (async () => {
      if (isFullTrack) {
        const persisted = await readPersistedPeaks(key);
        if (persisted) {
          const hydrated = hydratePeakRecord(persisted);
          if (hydrated) {
            storeResolvedPeak(key, hydrated);
            persistPeakToLocalStorage(url, 512, 0, undefined, resampleBipolarPeaks(hydrated, 512));
            return hydrated;
          }
        }
        // In browser environment, query lightweight backend precomputed peaks (~3 KB) before downloading 40 MB WAV
        if (
          typeof window !== 'undefined' &&
          (url.includes('.r2.dev') || url.includes('r2.cloudflarestorage.com'))
        ) {
          try {
            const resp = await fetch(`/api/editing/peaks?url=${encodeURIComponent(url)}&bins=${canonicalBins}`);
            if (resp.ok) {
              const data = await resp.json();
              const remotePeaks = hydratePeakRecord(data);
              if (remotePeaks) {
                storeResolvedPeak(key, remotePeaks);
                persistPeakToLocalStorage(url, 512, 0, undefined, resampleBipolarPeaks(remotePeaks, 512));
                void writePersistedPeaks(key, {
                  mins: Array.from(remotePeaks.mins),
                  maxs: Array.from(remotePeaks.maxs),
                  duration: remotePeaks.duration,
                  updatedAt: Date.now(),
                });
                return remotePeaks;
              }
            }
          } catch {
            // Fall back to direct audio fetch if peak endpoint is unreachable
          }
        }
      }

      const raw = await fetchAudioArrayBuffer(url, priority);
      const wav = extractBipolarPeaksFromWav(raw, canonicalBins, effectiveOffset, effectiveDuration);
      if (wav) {
        storeResolvedPeak(key, wav);
        if (isFullTrack) {
          persistPeakToLocalStorage(url, 512, 0, undefined, resampleBipolarPeaks(wav, 512));
          void writePersistedPeaks(key, {
            mins: Array.from(wav.mins),
            maxs: Array.from(wav.maxs),
            duration: wav.duration,
            updatedAt: Date.now(),
          });
        }
        return wav;
      }
      const decoded = await decodeAudioBuffer(raw);
      const result = extractBipolarPeaksFromBuffer(decoded, canonicalBins, effectiveOffset, effectiveDuration);
      storeResolvedPeak(key, result);
      if (isFullTrack) {
        persistPeakToLocalStorage(url, 512, 0, undefined, resampleBipolarPeaks(result, 512));
        void writePersistedPeaks(key, {
          mins: Array.from(result.mins),
          maxs: Array.from(result.maxs),
          duration: result.duration,
          updatedAt: Date.now(),
        });
      }
      return result;
    })();
    if (canonicalPeakCache.size >= MAX_PEAK_CACHE_ENTRIES) {
      const oldestKey = canonicalPeakCache.keys().next().value;
      if (oldestKey !== undefined) canonicalPeakCache.delete(oldestKey);
    }
    canonicalPeakCache.set(key, pending);
    pending.catch(() => canonicalPeakCache.delete(key));
  } else if (priority === 'high') {
    void fetchAudioArrayBuffer(url, 'high').catch(() => {});
  }

  const canonical = await canonicalPeakCache.get(key)!;
  const resampled = resampleBipolarPeaks(canonical, bins);
  persistPeakToLocalStorage(url, bins, offset, duration, resampled);
  return resampled;
}


export function contributions(master: number[], lanes: number[][]) {
  return lanes.map((lane, index) => master.map((peak, bin) => {
    const total = lanes.reduce((sum, values) => sum + Math.max(0, values[bin] ?? 0), 0);
    const before = lanes.slice(0, index).reduce((sum, values) => sum + Math.max(0, values[bin] ?? 0), 0);
    return { start: total ? peak * before / total : 0, end: total ? peak * (before + Math.max(0, lane[bin] ?? 0)) / total : 0 };
  }));
}
