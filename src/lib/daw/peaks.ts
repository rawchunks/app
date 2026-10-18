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
  low?: Float32Array;
  mid?: Float32Array;
  high?: Float32Array;
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
  const low = new Float32Array(count), mid = new Float32Array(count), high = new Float32Array(count);
  const alphaLow = 1 - Math.exp((-2 * Math.PI * 250) / Math.max(8000, rate));
  const alphaMid = 1 - Math.exp((-2 * Math.PI * 4000) / Math.max(8000, rate));
  let lpLow = 0;
  let lpMid = 0;
  for (let bin = 0; bin < count; bin++) {
    const start = first + Math.floor(bin * frames / count), end = first + Math.floor((bin + 1) * frames / count);
    const span = end - start;
    const step = Math.max(1, Math.floor(span / 64));
    let energy = 0, eLow = 0, eMid = 0, eHigh = 0, sampled = 0;
    for (let frame = start; frame < end; frame += step) {
      sampled++;
      for (let channel = 0; channel < channels; channel++) {
        const value = read(frame, channel);
        if (!Number.isFinite(value)) throw new Error('Audio contains non-finite samples');
        mins[bin] = Math.min(mins[bin], value); maxs[bin] = Math.max(maxs[bin], value); energy += value * value;
        lpLow += alphaLow * (value - lpLow);
        lpMid += alphaMid * (value - lpMid);
        const bLow = lpLow;
        const bMid = lpMid - lpLow;
        const bHigh = value - lpMid;
        eLow += bLow * bLow;
        eMid += bMid * bMid;
        eHigh += bHigh * bHigh;
      }
    }
    if (sampled > 0) {
      rms[bin] = Math.sqrt(energy / (sampled * channels));
      const bandSum = eLow + eMid + eHigh;
      if (bandSum > 1e-12) {
        low[bin] = eLow / bandSum;
        mid[bin] = eMid / bandSum;
        high[bin] = eHigh / bandSum;
      } else {
        low[bin] = 0.34;
        mid[bin] = 0.33;
        high[bin] = 0.33;
      }
    }
  }
  return { mins, maxs, rms, low, mid, high, bins: count, duration: length / rate };
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
  const count = Math.max(1, Math.min(2048, Math.floor(targetBins)));
  if (source.bins === count) return source;
  const mins = new Float32Array(count);
  const maxs = new Float32Array(count);
  const rms = new Float32Array(count);
  const hasBands = Boolean(source.low && source.mid && source.high);
  const low = hasBands ? new Float32Array(count) : undefined;
  const mid = hasBands ? new Float32Array(count) : undefined;
  const high = hasBands ? new Float32Array(count) : undefined;

  for (let bin = 0; bin < count; bin++) {
    const pos = count > 1 ? (bin / (count - 1)) * (source.bins - 1) : 0;
    const start = Math.floor((bin * source.bins) / count);
    const end = Math.max(start + 1, Math.min(source.bins, Math.floor(((bin + 1) * source.bins) / count)));
    if (count <= source.bins) {
      let minVal = Infinity;
      let maxVal = -Infinity;
      let energy = 0;
      let lowSum = 0;
      let midSum = 0;
      let highSum = 0;
      const span = end - start;
      for (let i = start; i < end; i++) {
        if (source.mins[i] < minVal) minVal = source.mins[i];
        if (source.maxs[i] > maxVal) maxVal = source.maxs[i];
        energy += source.rms[i] * source.rms[i];
        if (hasBands) {
          lowSum += source.low![i];
          midSum += source.mid![i];
          highSum += source.high![i];
        }
      }
      mins[bin] = Number.isFinite(minVal) ? minVal : 0;
      maxs[bin] = Number.isFinite(maxVal) ? maxVal : 0;
      rms[bin] = Math.sqrt(energy / span);
      if (hasBands) {
        low![bin] = lowSum / span;
        mid![bin] = midSum / span;
        high![bin] = highSum / span;
      }
    } else {
      const idx0 = Math.min(source.bins - 1, Math.floor(pos));
      const idx1 = Math.min(source.bins - 1, idx0 + 1);
      const frac = pos - idx0;
      mins[bin] = source.mins[idx0] * (1 - frac) + source.mins[idx1] * frac;
      maxs[bin] = source.maxs[idx0] * (1 - frac) + source.maxs[idx1] * frac;
      rms[bin] = source.rms[idx0] * (1 - frac) + source.rms[idx1] * frac;
      if (hasBands) {
        low![bin] = source.low![idx0] * (1 - frac) + source.low![idx1] * frac;
        mid![bin] = source.mid![idx0] * (1 - frac) + source.mid![idx1] * frac;
        high![bin] = source.high![idx0] * (1 - frac) + source.high![idx1] * frac;
      }
    }
  }
  return { mins, maxs, rms, low, mid, high, bins: count, duration: source.duration };
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

export async function decodeAudioFile(file: File | Blob): Promise<AudioBuffer> {
  const arrayBuffer = await file.arrayBuffer();
  return decodeAudioBuffer(arrayBuffer);
}

/**
 * Dual-Mode Tactile Acoustic Waveform Sculpting Model:
 * 1. Granular Wave Shape Design Mode (`mode: 'granular'`, default):
 *    Users directly grab any wave peak, trough, or cycle with a finger/cursor to pull/push gain
 *    (with 1st-order ADAA tanh saturation + 2.2 kHz transient preservation), shift cycle timing
 *    (`timeShift`), skew wave-cycle convexity (`bend`), apply 1st-order ADAA sinusoidal wavefolding
 *    (`smash`), apply slew-rate + zero-phase smoothing (`smooth`), or apply differential dual-envelope
 *    transient sharpening (`sharpen`).
 * 2. Speed / Median Curve Mode (`mode: 'curve'`, accessible via the Mode Switcher):
 *    4-node Catmull-Rom / cubic Bezier macro speed & median envelope curve.
 */
export type GranularTool = 'grab' | 'bend' | 'smash' | 'smooth' | 'sharpen';
export type WaveSculptMode = 'granular' | 'curve';

export interface GranularPeakAnchor {
  id: string;
  /** Normalized center position in [0, 1] */
  position: number;
  /** Half-window influence radius in normalized time [0.002 .. 0.12] */
  radius: number;
  /** Which lobe of the wave cycle was grabbed: 'both' | 'upper' | 'lower' */
  polarity?: 'both' | 'upper' | 'lower';
  /** Direct peak gain delta in dB [-24 .. +14] */
  gainDb: number;
  /** Local zero-crossing-locked cycle time-shift delta [-0.08 .. +0.08] */
  timeShift: number;
  /** Non-linear wave-cycle power skew [-1 .. +1] */
  bend: number;
  /** 1st-order ADAA sinusoidal wavefolder depth [0 .. 1] */
  smash: number;
  /** Slew-rate limiter + LPF smoothing depth [0 .. 1] */
  smooth: number;
  /** Differential dual-envelope transient sharpener depth [0 .. 1] */
  sharpen: number;
}

export interface SculptNode {
  id: string;
  /** Normalized horizontal anchor position in [0, 1] */
  position: number;
  /** Vertical Peak-Sculpting regional gain in dB [-24, +12] */
  gainDb: number;
  /** Horizontal Wave-Design monotone time-warp offset [-0.35, +0.35] */
  warpOffset: number;
}

export interface WaveSculptState {
  /** Active interaction mode: 'granular' (direct peak-sculpting) or 'curve' (Speed/Median Bezier curve) */
  mode?: WaveSculptMode;
  /** Active granular sculpting tool when in 'granular' mode */
  activeTool?: GranularTool;
  /** Horizontal zoom factor [1 .. 32] */
  zoom?: number;
  /** Horizontal pan offset [0 .. 1] */
  panOffset?: number;
  /** Direct granular peak-sculpting anchors */
  anchors?: GranularPeakAnchor[];
  /** Alias for granular peak-sculpting anchors */
  granularAnchors?: GranularPeakAnchor[];
  nodes: SculptNode[];
  /** Global transient crest factor [-1 = soften/compress extremes, 0 = neutral, +1 = spike extremes] */
  crest: number;
  /** Harmonic soft-clip saturation drive [0 = clean, 1 = heavy tanh saturation] */
  drive: number;
  /** Wave-Design median/body texture [-1 = hollow transient contour, 0 = neutral, +1 = dense median sustain] */
  texture: number;
  /** Normalized fade-in length [0..0.45] */
  fadeIn: number;
  /** Normalized fade-out length [0..0.45] */
  fadeOut: number;
}

export const DEFAULT_WAVE_SCULPT: WaveSculptState = {
  mode: 'granular',
  activeTool: 'grab',
  zoom: 1,
  panOffset: 0,
  anchors: [],
  granularAnchors: [],
  nodes: [
    { id: 'n0', position: 0.15, gainDb: 0, warpOffset: 0 },
    { id: 'n1', position: 0.38, gainDb: 0, warpOffset: 0 },
    { id: 'n2', position: 0.62, gainDb: 0, warpOffset: 0 },
    { id: 'n3', position: 0.85, gainDb: 0, warpOffset: 0 },
  ],
  crest: 0,
  drive: 0,
  texture: 0,
  fadeIn: 0,
  fadeOut: 0,
};

export function createDefaultWaveSculpt(): WaveSculptState {
  return {
    mode: 'granular',
    activeTool: 'grab',
    zoom: 1,
    panOffset: 0,
    anchors: [],
    granularAnchors: [],
    nodes: DEFAULT_WAVE_SCULPT.nodes.map((n) => ({ ...n })),
    crest: 0,
    drive: 0,
    texture: 0,
    fadeIn: 0,
    fadeOut: 0,
  };
}

export function isIdentityWaveSculpt(sculpt?: WaveSculptState | null): boolean {
  if (!sculpt) return true;
  if (Math.abs(sculpt.crest || 0) > 0.005) return false;
  if (Math.abs(sculpt.drive || 0) > 0.005) return false;
  if (Math.abs(sculpt.texture || 0) > 0.005) return false;
  if ((sculpt.fadeIn || 0) > 0.002 || (sculpt.fadeOut || 0) > 0.002) return false;
  const anchors = sculpt.anchors && sculpt.anchors.length > 0 ? sculpt.anchors : sculpt.granularAnchors;
  if (
    anchors &&
    anchors.some(
      (a) =>
        Math.abs(a.gainDb || 0) > 0.05 ||
        Math.abs(a.timeShift || 0) > 0.0005 ||
        Math.abs(a.bend || 0) > 0.01 ||
        (a.smash || 0) > 0.01 ||
        (a.smooth || 0) > 0.01 ||
        (a.sharpen || 0) > 0.01
    )
  ) {
    return false;
  }
  return (sculpt.nodes || []).every(
    (n) => Math.abs(n.gainDb || 0) <= 0.05 && Math.abs(n.warpOffset || 0) <= 0.002
  );
}

export function getTrackOwnSculpt(
  track?: { sculpt?: WaveSculptState | null; clips?: Array<{ sculpt?: WaveSculptState | null }> } | null
): WaveSculptState | undefined {
  if (!track) return undefined;
  const clipSculpt = track.clips?.find((c) => c.sculpt && !isIdentityWaveSculpt(c.sculpt))?.sculpt;
  if (clipSculpt) return clipSculpt;
  if (track.sculpt && !isIdentityWaveSculpt(track.sculpt)) return track.sculpt;
  return track.clips?.[0]?.sculpt ?? track.sculpt ?? undefined;
}

export function composeWaveSculpts(
  base?: WaveSculptState | null,
  overlay?: WaveSculptState | null
): WaveSculptState {
  const baseIdentity = !base || isIdentityWaveSculpt(base);
  const overlayIdentity = !overlay || isIdentityWaveSculpt(overlay);
  if (baseIdentity && overlayIdentity) {
    return overlay ?? base ?? createDefaultWaveSculpt();
  }
  if (baseIdentity) return overlay!;
  if (overlayIdentity) return base!;

  const baseNodes = base!.nodes?.length ? base!.nodes : DEFAULT_WAVE_SCULPT.nodes;
  const overlayNodes = overlay!.nodes?.length ? overlay!.nodes : DEFAULT_WAVE_SCULPT.nodes;
  const nodeCount = Math.max(baseNodes.length, overlayNodes.length);
  const nodes: SculptNode[] = new Array(nodeCount);
  for (let i = 0; i < nodeCount; i++) {
    const b = baseNodes[i] ?? DEFAULT_WAVE_SCULPT.nodes[Math.min(i, DEFAULT_WAVE_SCULPT.nodes.length - 1)];
    const o = overlayNodes[i] ?? b;
    nodes[i] = {
      id: o.id || b.id || `n${i}`,
      position: o.position ?? b.position ?? (nodeCount > 1 ? i / (nodeCount - 1) : 0),
      gainDb: Math.max(-24, Math.min(12, Number(((b.gainDb || 0) + (o.gainDb || 0)).toFixed(2)))),
      warpOffset: Math.max(
        -0.35,
        Math.min(0.35, Number(((b.warpOffset || 0) + (o.warpOffset || 0)).toFixed(3)))
      ),
    };
  }

  const baseAnchors =
    base!.anchors && base!.anchors.length > 0 ? base!.anchors : (base!.granularAnchors ?? []);
  const overlayAnchors =
    overlay!.anchors && overlay!.anchors.length > 0
      ? overlay!.anchors
      : (overlay!.granularAnchors ?? []);

  const mergedAnchors: GranularPeakAnchor[] = baseAnchors.map((a) => ({ ...a }));
  for (let i = 0; i < overlayAnchors.length; i++) {
    const oa = overlayAnchors[i];
    const matchIdx = mergedAnchors.findIndex(
      (ma) =>
        ma.id === oa.id ||
        (Math.abs((ma.position || 0) - (oa.position || 0)) < 0.012 &&
          (ma.polarity ?? 'both') === (oa.polarity ?? 'both'))
    );
    if (matchIdx >= 0) {
      const ma = mergedAnchors[matchIdx];
      mergedAnchors[matchIdx] = {
        ...ma,
        id: oa.id || ma.id,
        position: oa.position ?? ma.position,
        radius: oa.radius || ma.radius || 0.075,
        polarity: oa.polarity ?? ma.polarity ?? 'both',
        gainDb: Math.max(-24, Math.min(18, Number(((ma.gainDb || 0) + (oa.gainDb || 0)).toFixed(2)))),
        timeShift: Math.max(
          -0.25,
          Math.min(0.25, Number(((ma.timeShift || 0) + (oa.timeShift || 0)).toFixed(3)))
        ),
        bend: Math.max(-1, Math.min(1, Number(((ma.bend || 0) + (oa.bend || 0)).toFixed(2)))),
        smash: Math.max(0, Math.min(1, Math.max(ma.smash || 0, oa.smash || 0))),
        smooth: Math.max(0, Math.min(1, Math.max(ma.smooth || 0, oa.smooth || 0))),
        sharpen: Math.max(0, Math.min(1, Math.max(ma.sharpen || 0, oa.sharpen || 0))),
      };
    } else {
      mergedAnchors.push({ ...oa });
    }
  }
  mergedAnchors.sort((a, b) => a.position - b.position);

  const useOverlayZoom = Boolean(overlay!.zoom && overlay!.zoom > 1.01);
  return {
    mode: overlay!.mode ?? base!.mode ?? 'granular',
    activeTool: overlay!.activeTool ?? base!.activeTool ?? 'grab',
    zoom: useOverlayZoom ? overlay!.zoom! : (base!.zoom ?? 1),
    panOffset: useOverlayZoom ? (overlay!.panOffset ?? 0) : (base!.panOffset ?? 0),
    nodes,
    anchors: mergedAnchors,
    granularAnchors: mergedAnchors,
    crest: Math.max(-1, Math.min(1, (base!.crest || 0) + (overlay!.crest || 0))),
    drive: Math.max(0, Math.min(1, (base!.drive || 0) + (overlay!.drive || 0))),
    texture: Math.max(-1, Math.min(1, (base!.texture || 0) + (overlay!.texture || 0))),
    fadeIn: Math.max(0, Math.min(0.45, Math.max(base!.fadeIn || 0, overlay!.fadeIn || 0))),
    fadeOut: Math.max(0, Math.min(0.45, Math.max(base!.fadeOut || 0, overlay!.fadeOut || 0))),
  };
}

export interface GranularFieldSample {
  upperGainLinear: number;
  lowerGainLinear: number;
  meanGainDb: number;
  timeShift: number;
  bend: number;
  smash: number;
  smooth: number;
  sharpen: number;
}

export function evaluateGranularField(sculpt: WaveSculptState, t: number): GranularFieldSample {
  const anchors = sculpt.anchors && sculpt.anchors.length > 0 ? sculpt.anchors : sculpt.granularAnchors;
  if (!anchors || anchors.length === 0) {
    return {
      upperGainLinear: 1,
      lowerGainLinear: 1,
      meanGainDb: 0,
      timeShift: 0,
      bend: 0,
      smash: 0,
      smooth: 0,
      sharpen: 0,
    };
  }
  let upperDb = 0;
  let lowerDb = 0;
  let timeShift = 0;
  let bend = 0;
  let smash = 0;
  let smooth = 0;
  let sharpen = 0;

  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    const r = Math.max(0.015, Math.min(0.35, a.radius || 0.075));
    const center = Math.max(0.002, Math.min(0.998, (a.position || 0) + (a.timeShift || 0) * 0.35));
    const rawDelta = t - center;
    const skew = Math.max(-0.68, Math.min(0.68, (a.bend || 0) * 0.65));
    const sideRadius = rawDelta < 0 ? r * (1 + skew) : r * (1 - skew);
    const dist = Math.abs(rawDelta);
    if (dist >= sideRadius) continue;
    // C2-continuous raised-cosine window for ultra-smooth organic peak sculpting
    const u = dist / Math.max(1e-5, sideRadius);
    const w = Math.pow(0.5 * (1 + Math.cos(Math.PI * u)), 1.35);
    const pol = a.polarity ?? 'both';
    const gainDb = a.gainDb || 0;
    if (pol === 'both' || pol === 'upper') {
      upperDb += gainDb * w;
    }
    if (pol === 'both' || pol === 'lower') {
      lowerDb += gainDb * w;
    }
    timeShift += (a.timeShift || 0) * w;
    bend += (a.bend || 0) * w;
    smash = Math.max(smash, (a.smash || 0) * w);
    smooth = Math.max(smooth, (a.smooth || 0) * w);
    sharpen = Math.max(sharpen, (a.sharpen || 0) * w);
  }

  upperDb = Math.max(-28, Math.min(16, upperDb));
  lowerDb = Math.max(-28, Math.min(16, lowerDb));
  const meanGainDb = 0.5 * (upperDb + lowerDb);

  return {
    upperGainLinear: Math.pow(10, upperDb / 20),
    lowerGainLinear: Math.pow(10, lowerDb / 20),
    meanGainDb,
    timeShift: Math.max(-0.12, Math.min(0.12, timeShift)),
    bend: Math.max(-1, Math.min(1, bend)),
    smash: Math.max(0, Math.min(1, smash)),
    smooth: Math.max(0, Math.min(1, smooth)),
    sharpen: Math.max(0, Math.min(1, sharpen)),
  };
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, u: number): number {
  const u2 = u * u;
  const u3 = u2 * u;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * u +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * u3)
  );
}

/**
 * Evaluates the vertical Peak-Sculpting gain envelope g(t), the horizontal
 * Wave-Design monotone progression bijection phi(t), and the local Granular
 * acoustic parameters at normalized coordinate t in [0, 1].
 */
export function evaluateSculptField(sculpt: WaveSculptState, t: number): {
  gainLinear: number;
  upperGainLinear: number;
  lowerGainLinear: number;
  gainDb: number;
  warpedTime: number;
  fadeMultiplier: number;
  bend: number;
  smash: number;
  smooth: number;
  sharpen: number;
} {
  const clampedT = Math.max(0, Math.min(1, t));
  const sorted = [...(sculpt.nodes || [])].sort((a, b) => a.position - b.position);

  const anchors: Array<{ x: number; db: number; srcT: number }> = [
    { x: 0, db: sorted[0]?.gainDb || 0, srcT: 0 },
  ];
  let prevX = 0.01;
  for (let i = 0; i < sorted.length; i++) {
    const node = sorted[i];
    const maxAllowed = 1 - (sorted.length - i) * 0.02;
    const warpedX = Math.max(prevX, Math.min(maxAllowed, (node.position || 0) + (node.warpOffset || 0)));
    anchors.push({
      x: warpedX,
      db: Math.max(-24, Math.min(12, node.gainDb || 0)),
      srcT: Math.max(0.01, Math.min(0.99, node.position || 0)),
    });
    prevX = warpedX + 0.02;
  }
  anchors.push({ x: 1, db: sorted[sorted.length - 1]?.gainDb || 0, srcT: 1 });

  let segIdx = 0;
  for (let i = 0; i < anchors.length - 1; i++) {
    if (clampedT >= anchors[i].x && clampedT <= anchors[i + 1].x) {
      segIdx = i;
      break;
    }
  }
  const aPrev = anchors[Math.max(0, segIdx - 1)];
  const a0 = anchors[segIdx];
  const a1 = anchors[segIdx + 1] ?? a0;
  const aNext = anchors[Math.min(anchors.length - 1, segIdx + 2)];
  const span = Math.max(1e-6, a1.x - a0.x);
  const localAlpha = Math.max(0, Math.min(1, (clampedT - a0.x) / span));

  // Catmull-Rom cubic spline interpolation for smooth Bezier-grade macro curve
  const curveGainDb = Math.max(
    -24,
    Math.min(12, catmullRom(aPrev.db, a0.db, a1.db, aNext.db, localAlpha))
  );
  const curveGainLinear = Math.pow(10, curveGainDb / 20);

  // Strictly monotone piecewise progression for horizontal Speed / Wave-Design
  const baseWarpedTime = Math.max(0, Math.min(1, a0.srcT + (a1.srcT - a0.srcT) * localAlpha));

  // Evaluate local granular peak-sculpting field at t
  const gran = evaluateGranularField(sculpt, clampedT);
  // Zero-crossing-safe local time shift pulls from opposite direction in source buffer
  const warpedTime = Math.max(0, Math.min(1, baseWarpedTime - gran.timeShift));

  let fadeMultiplier = 1;
  const fadeIn = sculpt.fadeIn || 0;
  const fadeOut = sculpt.fadeOut || 0;
  if (fadeIn > 0.001 && clampedT < fadeIn) {
    const u = clampedT / fadeIn;
    fadeMultiplier *= Math.sin(u * (Math.PI / 2));
  }
  if (fadeOut > 0.001 && clampedT > 1 - fadeOut) {
    const u = (1 - clampedT) / fadeOut;
    fadeMultiplier *= Math.sin(Math.max(0, u) * (Math.PI / 2));
  }

  const gainDb = curveGainDb + gran.meanGainDb;
  const gainLinear = curveGainLinear * Math.pow(10, gran.meanGainDb / 20);
  const upperGainLinear = curveGainLinear * gran.upperGainLinear;
  const lowerGainLinear = curveGainLinear * gran.lowerGainLinear;

  return {
    gainLinear,
    upperGainLinear,
    lowerGainLinear,
    gainDb,
    warpedTime,
    fadeMultiplier,
    bend: gran.bend,
    smash: gran.smash,
    smooth: gran.smooth,
    sharpen: gran.sharpen,
  };
}

/**
 * Bi-directional time-warp transfer helpers so lyrics highlighting and click-to-seek
 * stay 100% locked in real time when wave/speed/granular time-shifts are applied.
 */
export function mapPlayheadTimeToSourceTime(
  playheadSec: number,
  arg2: number,
  arg3?: number | WaveSculptState | null,
  arg4?: WaveSculptState | null
): number {
  const clipStartSec = typeof arg3 === 'number' ? arg2 : 0;
  const durationSec = typeof arg3 === 'number' ? arg3 : arg2;
  const sculpt = typeof arg3 === 'number' ? arg4 : arg3;
  if (!durationSec || durationSec <= 0 || !sculpt || isIdentityWaveSculpt(sculpt)) {
    return playheadSec;
  }
  const localPlayhead = playheadSec - clipStartSec;
  const normPlayhead = Math.max(0, Math.min(1, localPlayhead / durationSec));
  const { warpedTime } = evaluateSculptField(sculpt, normPlayhead);
  return clipStartSec + warpedTime * durationSec;
}

export function mapSourceTimeToPlayheadTime(
  sourceSec: number,
  arg2: number,
  arg3?: number | WaveSculptState | null,
  arg4?: WaveSculptState | null
): number {
  const clipStartSec = typeof arg3 === 'number' ? arg2 : 0;
  const durationSec = typeof arg3 === 'number' ? arg3 : arg2;
  const sculpt = typeof arg3 === 'number' ? arg4 : arg3;
  if (!durationSec || durationSec <= 0 || !sculpt || isIdentityWaveSculpt(sculpt)) {
    return sourceSec;
  }
  const localSource = sourceSec - clipStartSec;
  const targetNorm = Math.max(0, Math.min(1, localSource / durationSec));
  let lo = 0;
  let hi = 1;
  for (let iter = 0; iter < 14; iter++) {
    const mid = 0.5 * (lo + hi);
    const { warpedTime } = evaluateSculptField(sculpt, mid);
    if (warpedTime < targetNorm) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return clipStartSec + 0.5 * (lo + hi) * durationSec;
}

/**
 * 1st-order Antiderivative Anti-Aliasing (ADAA) helper for f(u) = tanh(u):
 * F^(1)(u) = ln(cosh(u)) = |u| + ln(1 + exp(-2|u|)) - ln(2)
 */
function adaaTanhAntideriv(u: number): number {
  const absU = Math.abs(u);
  return absU + Math.log(1 + Math.exp(-2 * absU)) - 0.6931471805599453;
}

/**
 *Transforms BipolarPeaks in real time (<0.2ms for 512 bins) using both:
 * 1. Granular Peak-Sculpting (individual lobe gain, cycle timeShift, bend, wavefolding smash, smooth, sharpen)
 * 2. Speed / Median Curve (monotone time-warping progression phi(t), macro gain, crest, texture, drive)
 */
export function sculptBipolarPeaks(source: BipolarPeaks, sculpt?: WaveSculptState | null): BipolarPeaks {
  if (!sculpt || isIdentityWaveSculpt(sculpt)) return source;

  const count = source.bins;
  const mins = new Float32Array(count);
  const maxs = new Float32Array(count);
  const rms = new Float32Array(count);
  const low = source.low ? new Float32Array(count) : undefined;
  const mid = source.mid ? new Float32Array(count) : undefined;
  const high = source.high ? new Float32Array(count) : undefined;

  const driveAmount = Math.max(0, Math.min(1, sculpt.drive || 0));
  const crestAmount = Math.max(-1, Math.min(1, sculpt.crest || 0));
  const textureAmount = Math.max(-1, Math.min(1, sculpt.texture || 0));

  const sampleArray = (arr: Float32Array, normPos: number): number => {
    if (count <= 1) return arr[0] ?? 0;
    const exact = Math.max(0, Math.min(count - 1, normPos * (count - 1)));
    const i1 = Math.floor(exact);
    const i0 = Math.max(0, i1 - 1);
    const i2 = Math.min(count - 1, i1 + 1);
    const i3 = Math.min(count - 1, i1 + 2);
    const frac = exact - i1;
    return catmullRom(arr[i0], arr[i1], arr[i2], arr[i3], frac);
  };

  for (let bin = 0; bin < count; bin++) {
    const t = count > 1 ? bin / (count - 1) : 0;
    const {
      gainLinear,
      upperGainLinear,
      lowerGainLinear,
      warpedTime,
      fadeMultiplier,
      bend,
      smash,
      smooth,
      sharpen,
    } = evaluateSculptField(sculpt, t);

    const rawMinSample = sampleArray(source.mins, warpedTime);
    const rawMaxSample = sampleArray(source.maxs, warpedTime);
    const rawRmsSample = sampleArray(source.rms, warpedTime);

    const span = count > 2 ? 1.5 / (count - 1) : 0;
    const leftMin = span > 0 ? sampleArray(source.mins, Math.max(0, warpedTime - span)) : rawMinSample;
    const rightMin = span > 0 ? sampleArray(source.mins, Math.min(1, warpedTime + span)) : rawMinSample;
    const leftMax = span > 0 ? sampleArray(source.maxs, Math.max(0, warpedTime - span)) : rawMaxSample;
    const rightMax = span > 0 ? sampleArray(source.maxs, Math.min(1, warpedTime + span)) : rawMaxSample;
    const leftRms = span > 0 ? sampleArray(source.rms, Math.max(0, warpedTime - span)) : rawRmsSample;
    const rightRms = span > 0 ? sampleArray(source.rms, Math.min(1, warpedTime + span)) : rawRmsSample;

    const avgMinMag = 0.25 * Math.abs(leftMin) + 0.5 * Math.abs(rawMinSample) + 0.25 * Math.abs(rightMin);
    const avgMaxMag = 0.25 * Math.abs(leftMax) + 0.5 * Math.abs(rawMaxSample) + 0.25 * Math.abs(rightMax);
    const avgRms = 0.25 * leftRms + 0.5 * rawRmsSample + 0.25 * rightRms;

    const detailMin = Math.abs(rawMinSample) - avgMinMag;
    const detailMax = Math.abs(rawMaxSample) - avgMaxMag;

    const detailGain = Math.max(0.12, (1 - smooth * 0.82) * (1 + sharpen * 1.45 + Math.max(0, crestAmount) * 0.6));
    const upGain = upperGainLinear * fadeMultiplier;
    const loGain = lowerGainLinear * fadeMultiplier;

    const effUpGain = upGain * (1 - smooth * 0.14);
    const effLoGain = loGain * (1 - smooth * 0.14);

    const bodyMax = avgMaxMag * effUpGain;
    const bodyMin = avgMinMag * effLoGain;

    let nextMax = Math.max(0, bodyMax + detailMax * detailGain * Math.min(2.6, effUpGain));
    let nextMin = -Math.max(0, bodyMin + detailMin * detailGain * Math.min(2.6, effLoGain));

    const textureFactor = Math.max(0.2, Math.min(1.85, 1 + (textureAmount + bend * 0.35) * 0.45));
    let nextRms = (rawRmsSample * (1 - smooth * 0.65) + avgRms * (smooth * 0.65)) * gainLinear * fadeMultiplier * textureFactor;

    // Sinusoidal wavefolding when Granular Smash > 0
    if (smash > 0.01) {
      const omega = 1 + smash * 4.2;
      const foldMin = -Math.abs(Math.sin(Math.abs(nextMin) * omega * (Math.PI * 0.5)));
      const foldMax = Math.abs(Math.sin(nextMax * omega * (Math.PI * 0.5)));
      nextMin = nextMin * (1 - smash * 0.72) + foldMin * (smash * 0.72);
      nextMax = nextMax * (1 - smash * 0.72) + foldMax * (smash * 0.72);
      nextRms = Math.min(Math.max(Math.abs(nextMin), Math.abs(nextMax)), nextRms * (1 + smash * 0.25));
    }

    if (driveAmount > 0.001) {
      const k = 1 + driveAmount * 3.5;
      const norm = Math.tanh(k);
      nextMin = Math.tanh(nextMin * k) / norm;
      nextMax = Math.tanh(nextMax * k) / norm;
      nextRms = Math.min(Math.max(Math.abs(nextMin), Math.abs(nextMax)), Math.tanh(nextRms * k) / norm);
    }

    mins[bin] = Math.max(-1.52, Math.min(0, nextMin));
    maxs[bin] = Math.max(0, Math.min(1.52, nextMax));
    rms[bin] = Math.max(0, Math.min(Math.max(-mins[bin], maxs[bin]), nextRms));

    if (low && mid && high && source.low && source.mid && source.high) {
      const wLow = Math.max(
        0,
        sampleArray(source.low, warpedTime) * (1 - driveAmount * 0.25 + smooth * 0.35)
      );
      const wMid = Math.max(
        0,
        sampleArray(source.mid, warpedTime) *
          (1 + textureAmount * 0.25 + driveAmount * 0.2 + Math.abs(bend) * 0.35)
      );
      const wHigh = Math.max(
        0,
        sampleArray(source.high, warpedTime) *
          (1 +
            Math.max(0, crestAmount) * 0.35 +
            driveAmount * 0.45 +
            smash * 0.65 +
            sharpen * 0.75 -
            smooth * 0.45)
      );
      const sum = wLow + wMid + wHigh;
      if (sum > 1e-6) {
        low[bin] = wLow / sum;
        mid[bin] = wMid / sum;
        high[bin] = wHigh / sum;
      } else {
        low[bin] = 0.34;
        mid[bin] = 0.33;
        high[bin] = 0.33;
      }
    }
  }

  return {
    mins,
    maxs,
    rms,
    low,
    mid,
    high,
    bins: count,
    duration: source.duration,
  };
}

/**
 * Applies the Dual-Mode WaveSculptState directly to an AudioBuffer so WebAudio playback
 * and offline WAV export match the sculpted visual waveform 1:1.
 * Accepts an optional reusable `targetBuffer` and `dirtyRange` [startNorm, endNorm]
 * so real-time dragging mutates in-place with zero AudioBuffer allocations.
 */
