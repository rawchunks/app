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
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }

  const bufferCopy = arrayBuffer.slice(0);
  return new Promise<AudioBuffer>((resolve, reject) => {
    audioCtx.decodeAudioData(
      bufferCopy,
      (decoded) => resolve(decoded),
      (err) => reject(err)
    );
  });
}


/**
 * Fetches audio from URL, decodes real PCM samples, and returns high-resolution peaks.
 */
export async function extractPeaksFromUrl(url: string, bins = 256): Promise<number[]> {
  return magnitudes(await extractBipolarPeaksFromUrl(url, bins));
}

const audioCache = new Map<string, Promise<ArrayBuffer>>();
const cache = new Map<string, Promise<BipolarPeaks>>();

function peakKey(url: string, bins: number, offset: number, duration?: number) {
  return `waveform:${JSON.stringify([url, bins, offset, duration])}`;
}

export function readPeaks(url: string, bins = 512, offset = 0, duration?: number): BipolarPeaks | null {
  try {
    const raw = localStorage.getItem(peakKey(url, bins, offset, duration));
    if (!raw) return null;
    const saved = JSON.parse(raw);
    const count = Math.min(2048, Math.floor(bins));
    if (![saved.mins, saved.maxs, saved.rms].every(values => Array.isArray(values) && values.length === count && values.every(Number.isFinite)) || !Number.isFinite(saved.duration)) return null;
    return { mins: Float32Array.from(saved.mins), maxs: Float32Array.from(saved.maxs), rms: Float32Array.from(saved.rms), bins: count, duration: saved.duration };
  } catch { return null; }
}

export async function extractBipolarPeaksFromUrl(url: string, bins = 512, offset = 0, duration?: number): Promise<BipolarPeaks> {
  if (!url) throw new Error('Audio source is required');
  const key = JSON.stringify([url, bins, offset, duration]);
  if (!cache.has(key)) {
    const pending = (async () => {
      const stored = readPeaks(url, bins, offset, duration);
      if (stored) return stored;
      if (!audioCache.has(url)) {
        const raw = fetch(url).then(response => {
          if (!response.ok) throw new Error(`Failed to load waveform (${response.status})`);
          return response.arrayBuffer();
        });
        audioCache.set(url, raw); raw.catch(() => audioCache.delete(url));
      }
      const raw = await audioCache.get(url)!;
      const wav = extractBipolarPeaksFromWav(raw, bins, offset, duration);
      const result = wav ?? extractBipolarPeaksFromBuffer(await decodeAudioBuffer(raw), bins, offset, duration);
      try {
        localStorage.setItem(peakKey(url, bins, offset, duration), JSON.stringify({
          mins: [...result.mins], maxs: [...result.maxs], rms: [...result.rms], duration: result.duration,
        }));
      } catch { /* Storage may be unavailable or full. */ }
      return result;
    })();
    cache.set(key, pending); pending.catch(() => cache.delete(key));
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
