// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { parseStrudelPattern } from '../../src/lib/daw/strudel';
import { extractPeaksFromBuffer, extractBipolarPeaksFromUrl, clearMemoryAudioCaches } from '../../src/lib/daw/peaks';

class MockAudioBuffer {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  duration: number;
  private _data: Float32Array;

  constructor(channels: number, length: number, sampleRate: number, data?: Float32Array) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this._data = data || new Float32Array(length);
  }

  getChannelData(_channel: number) {
    return this._data;
  }
}

class MockAudioContext {
  state = 'running';
  decodeAudioData(
    buffer: ArrayBuffer,
    onSuccess?: (decoded: any) => void,
    onError?: (err: any) => void
  ): Promise<any> {
    const arr = new Uint8Array(buffer);
    const str = String.fromCharCode(...arr.slice(0, 20));
    if (str.includes('CORRUPT') || str.includes('<html>')) {
      const err = new Error('Unable to decode audio data');
      if (onError) {
        onError(err);
        return Promise.resolve(null);
      }
      return Promise.reject(err);
    }
    const len = 44100;
    const channel = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      channel[i] = Math.sin((i / 44100) * 440 * 2 * Math.PI) * (i / len);
    }
    const decoded = new MockAudioBuffer(1, len, 44100, channel);
    onSuccess?.(decoded);
    return Promise.resolve(decoded);
  }

  close() {
    this.state = 'closed';
    return Promise.resolve();
  }
}

describe('Challenger Empirical Harness', () => {
  beforeEach(() => {
    clearMemoryAudioCaches();
    (globalThis as any).AudioContext = MockAudioContext;
    (globalThis as any).OfflineAudioContext = MockAudioContext;
    (globalThis as any).window = {
      AudioContext: MockAudioContext,
      OfflineAudioContext: MockAudioContext,
    };

    (globalThis as any).fetch = async (url: string) => {
      if (url === 'https://valid.example.com/audio.mp3') {
        const encoder = new TextEncoder();
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          arrayBuffer: async () => encoder.encode('VALID_AUDIO_DATA_HEADER').buffer,
        };
      }
      if (url === 'https://corrupt.example.com/corrupt.mp3') {
        const encoder = new TextEncoder();
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          arrayBuffer: async () => encoder.encode('CORRUPT_DATA_HEADER').buffer,
        };
      }
      if (url === 'https://html404.example.com/notfound') {
        const encoder = new TextEncoder();
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          arrayBuffer: async () => encoder.encode('<html>404 Not Found</html>').buffer,
        };
      }
      if (url === 'https://error404.example.com/notfound') {
        return {
          ok: false,
          status: 404,
          statusText: 'Not Found',
          arrayBuffer: async () => new ArrayBuffer(0),
        };
      }
      if (url === 'https://network-error.example.com/fail') {
        throw new Error('Network fetch failed');
      }
      return {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    };
  });

  it('evaluates Strudel patterns accurately across edge cases', () => {
    const r1 = parseStrudelPattern('s("bd sd hh cp")');
    expect(r1.events.length).toBe(4);
    expect(r1.events[0].value).toBe('bd');

    const r2 = parseStrudelPattern('note("c3 e3 g3 b3")');
    expect(r2.events.length).toBe(4);
    expect(r2.events[0].value).toBe('C3');

    const r3 = parseStrudelPattern('s("bd sd").fast(2).slow(0.5).speed(1.5)');
    expect(r3.rateModifier).toBe(6.0);

    const r4 = parseStrudelPattern('s("bd(3,8)")');
    expect(r4.events.length).toBe(3);

    const r5 = parseStrudelPattern('s("bd hh"), note("c2 g2")');
    expect(r5.events.length).toBe(4);
    expect(r5.events.some((e) => e.type === 'note')).toBe(true);

    const r6 = parseStrudelPattern('s("bd*4 [sd hh]*2")');
    expect(r6.events.length).toBe(8);

    const r7 = parseStrudelPattern('s("[[bd sd] [hh cp]]")');
    expect(r7.events.length).toBe(4);
    expect(Math.abs(r7.events[1].time - 0.25)).toBeLessThan(0.001);

    const r8 = parseStrudelPattern('');
    expect(r8.events.length).toBe(0);

    const r9 = parseStrudelPattern('s("[bd sd hh")');
    expect(Array.isArray(r9.events)).toBe(true);

    const r10 = parseStrudelPattern('s("bd(0,0)")');
    expect(Array.isArray(r10.events)).toBe(true);

    const r11 = parseStrudelPattern('s("bd ~ sd . hh rest cp _")');
    expect(r11.events.length).toBe(4);

    const r12 = parseStrudelPattern('s("bd").fast(0)');
    expect(r12.rateModifier).toBeGreaterThan(0);
  });

  it('extracts audio peaks from buffers and URLs with bounds and error validation', async () => {
    const dummyChannel = new Float32Array(1000);
    for (let i = 0; i < 1000; i++) dummyChannel[i] = i / 1000;
    const buf = new MockAudioBuffer(1, 1000, 44100, dummyChannel) as any;

    const p1 = extractPeaksFromBuffer(buf, 10);
    expect(p1.length).toBe(10);
    expect(p1[9]).toBeGreaterThan(0.95);

    expect(() => extractPeaksFromBuffer(buf, -5)).toThrow('Invalid waveform range');

    const pValid = await extractBipolarPeaksFromUrl('https://valid.example.com/audio.mp3', 20);
    expect(pValid.bins).toBe(20);
    expect(Array.from(pValid.maxs).some((v) => v > 0.1)).toBe(true);

    await expect(extractBipolarPeaksFromUrl('', 15)).rejects.toThrow('Audio source is required');
    await expect(extractBipolarPeaksFromUrl('https://error404.example.com/notfound', 15)).rejects.toThrow();
    await expect(extractBipolarPeaksFromUrl('https://html404.example.com/notfound', 15)).rejects.toThrow();
    await expect(extractBipolarPeaksFromUrl('https://corrupt.example.com/corrupt.mp3', 15)).rejects.toThrow();
  });
});
