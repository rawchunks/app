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

let sharedAudioCtx: AudioContext | null = null;

function getSharedAudioContext(): AudioContext {
  if (typeof window === 'undefined') {
    throw new Error('Web Audio not available in SSR');
  }
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtx) {
    throw new Error('Web Audio API not supported in this environment');
  }
  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    sharedAudioCtx = new AudioCtx();
  }
  return sharedAudioCtx;
}

/**
 * Decodes audio data from an ArrayBuffer using native AudioContext.
 */
export async function decodeAudioBuffer(arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
  const audioCtx = getSharedAudioContext();
  return new Promise<AudioBuffer>((resolve, reject) => {
    audioCtx.decodeAudioData(
      arrayBuffer,
      (decoded) => resolve(decoded),
      (err) => reject(err)
    );
  });
}

export type AudioLoadPriority = 'high' | 'normal';

const MAX_BACKGROUND_CONCURRENCY = 1;
const MAX_DECODED_BUFFERS = 4;
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
const decodedBufferCache = new Map<string, Promise<AudioBuffer>>();
const cache = new Map<string, Promise<BipolarPeaks>>();

function pumpBackgroundQueue() {
  while (activeBackgroundFetches < MAX_BACKGROUND_CONCURRENCY && backgroundQueue.length > 0) {
    const next = backgroundQueue.shift()!;
    activeBackgroundFetches++;
    next.start(false);
  }
}

export function abortBackgroundAudioFetches() {
  while (backgroundQueue.length > 0) {
    const queued = backgroundQueue.shift()!;
    queued.abort();
  }
  for (const [, entry] of inFlightFetches) {
    entry.controller.abort();
  }
  inFlightFetches.clear();
  activeBackgroundFetches = 0;
  decodedBufferCache.clear();
}

export function fetchAudioArrayBuffer(url: string, priority: AudioLoadPriority = 'normal'): Promise<ArrayBuffer> {
  if (!url) return Promise.reject(new Error('Audio source is required'));

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
  if (existing) return existing.promise;

  const controller = new AbortController();
  const entryState: InFlightFetch = {
    promise: Promise.resolve(new ArrayBuffer(0)),
    controller,
    isHigh: priority === 'high',
  };

  const doFetch = () =>
    fetch(url, { signal: controller.signal }).then((response) => {
      if (!response.ok) throw new Error(`Failed to load waveform (${response.status})`);
      return response.arrayBuffer();
    });

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
          controller.abort();
          reject(new DOMException('Aborted background audio fetch', 'AbortError'));
        },
      };
      backgroundQueue.push(queuedEntry);
      pumpBackgroundQueue();
    });
  }

  entryState.promise = raw;
  inFlightFetches.set(url, entryState);
  return raw;
}

export function getDecodedAudioBuffer(url: string, priority: AudioLoadPriority = 'normal'): Promise<AudioBuffer> {
  if (!url) return Promise.reject(new Error('Audio source is required'));
  if (priority === 'high') {
    void fetchAudioArrayBuffer(url, 'high').catch(() => {});
  }
  const existing = decodedBufferCache.get(url);
  if (existing) {
    decodedBufferCache.delete(url);
    decodedBufferCache.set(url, existing);
    return existing;
  }

  const pending = fetchAudioArrayBuffer(url, priority).then((raw) => decodeAudioBuffer(raw.slice(0)));
  if (decodedBufferCache.size >= MAX_DECODED_BUFFERS) {
    const oldestKey = decodedBufferCache.keys().next().value;
    if (oldestKey !== undefined) decodedBufferCache.delete(oldestKey);
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

function peakKey(url: string, bins: number, offset: number, duration?: number) {
  return `waveform:${JSON.stringify([url, bins, offset, duration])}`;
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
  const exact = readExactPeaks(url, bins, offset, duration);
  if (exact) return exact;
  if (offset === 0) {
    const full512 = readExactPeaks(url, 512, 0, undefined);
    if (full512 && (duration === undefined || Math.abs(duration - full512.duration) <= 1.5)) {
      return resampleBipolarPeaks(full512, bins);
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
  const key = JSON.stringify([url, bins, offset, duration]);
  if (!cache.has(key)) {
    const pending = (async () => {
      const stored = readPeaks(url, bins, offset, duration);
      if (stored) return stored;
      const raw = await fetchAudioArrayBuffer(url, priority);
      if (offset === 0 && bins <= 512) {
        const fullWav = extractBipolarPeaksFromWav(raw, 512, 0, undefined);
        if (fullWav && (duration === undefined || Math.abs(duration - fullWav.duration) <= 1.5)) {
          try {
            localStorage.setItem(peakKey(url, 512, 0, undefined), JSON.stringify({
              mins: [...fullWav.mins], maxs: [...fullWav.maxs], rms: [...fullWav.rms], duration: fullWav.duration,
            }));
          } catch { /* Storage may be unavailable or full. */ }
          return resampleBipolarPeaks(fullWav, bins);
        }
      }
      const wav = extractBipolarPeaksFromWav(raw, bins, offset, duration);
      const result = wav ?? extractBipolarPeaksFromBuffer(await decodeAudioBuffer(raw.slice(0)), bins, offset, duration);
      try {
        localStorage.setItem(peakKey(url, bins, offset, duration), JSON.stringify({
          mins: [...result.mins], maxs: [...result.maxs], rms: [...result.rms], duration: result.duration,
        }));
      } catch { /* Storage may be unavailable or full. */ }
      return result;
    })();
    cache.set(key, pending); pending.catch(() => cache.delete(key));
  } else if (priority === 'high') {
    void fetchAudioArrayBuffer(url, 'high').catch(() => {});
  }
  return cache.get(key)!;
}


export function contributions(master: number[], lanes: number[][]) {
  return lanes.map((lane, index) => master.map((peak, bin) => {
    const total = lanes.reduce((sum, values) => sum + Math.max(0, values[bin] ?? 0), 0);
    const before = lanes.slice(0, index).reduce((sum, values) => sum + Math.max(0, values[bin] ?? 0), 0);
    return { start: total ? peak * before / total : 0, end: total ? peak * (before + Math.max(0, lane[bin] ?? 0)) / total : 0 };
  }));
}
