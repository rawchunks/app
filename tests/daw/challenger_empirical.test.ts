import { parseStrudelPattern } from '../strudelEvaluator';
import { extractPeaksFromBuffer, extractPeaksFromUrl } from '../peaks';

// WebAudio Mocks for Node testing environment
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
  decodeAudioData(buffer: ArrayBuffer): Promise<any> {
    const arr = new Uint8Array(buffer);
    const str = String.fromCharCode(...arr.slice(0, 20));
    if (str.includes('CORRUPT') || str.includes('<html>')) {
      return Promise.reject(new Error('Unable to decode audio data'));
    }
    const len = 44100;
    const channel = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      channel[i] = Math.sin((i / 44100) * 440 * 2 * Math.PI) * (i / len);
    }
    return Promise.resolve(new MockAudioBuffer(1, len, 44100, channel));
  }

  close() {
    this.state = 'closed';
    return Promise.resolve();
  }
}

(globalThis as any).AudioContext = MockAudioContext;
(globalThis as any).window = { AudioContext: MockAudioContext };

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

export async function runEmpiricalHarness() {
  console.log('====================================================');
  console.log('   CHALLENGER EMPIRICAL TEST RESULTS                ');
  console.log('====================================================\n');

  const results: { test: string; status: 'PASS' | 'FAIL'; detail?: string }[] = [];

  function record(test: string, pass: boolean, detail?: string) {
    results.push({ test, status: pass ? 'PASS' : 'FAIL', detail });
    if (pass) {
      console.log(`[PASS] ${test}`);
    } else {
      console.error(`[FAIL] ${test} ${detail ? `-> ${detail}` : ''}`);
    }
  }

  // --- 1. STRUDEL EVALUATOR ---
  const r1 = parseStrudelPattern('s("bd sd hh cp")');
  record('Strudel: basic sound mini-notation', r1.events.length === 4 && r1.events[0].value === 'bd');

  const r2 = parseStrudelPattern('note("c3 e3 g3 b3")');
  record('Strudel: basic note mini-notation', r2.events.length === 4 && r2.events[0].value === 'C3');

  const r3 = parseStrudelPattern('s("bd sd").fast(2).slow(0.5).speed(1.5)');
  record('Strudel: rate modifiers calculation (.fast, .slow, .speed)', r3.rateModifier === 6.0, `got ${r3.rateModifier}`);

  const r4 = parseStrudelPattern('s("bd(3,8)")');
  record('Strudel: Euclidean rhythm expander bd(3,8)', r4.events.length === 3);

  // Multi-lane / polyphony test
  const r5 = parseStrudelPattern('s("bd hh"), note("c2 g2")');
  const r5Pass = r5.events.length === 4 && r5.events.some(e => e.type === 'note');
  record(
    'Strudel: multi-function polyphony s("bd hh"), note("c2 g2")',
    r5Pass,
    `expected 4 events with notes, got ${r5.events.length} events (${r5.events.map(e => e.value).join(', ')}) because match(/s(...) extracts first match and drops remaining functions`
  );

  const r6 = parseStrudelPattern('s("bd*4 [sd hh]*2")');
  record('Strudel: step multipliers bd*4', r6.events.length === 8);

  const r7 = parseStrudelPattern('s("[[bd sd] [hh cp]]")');
  record('Strudel: nested bracket subdivisions', r7.events.length === 4 && Math.abs(r7.events[1].time - 0.25) < 0.001);

  const r8 = parseStrudelPattern('');
  record('Strudel: empty pattern handling', r8.events.length === 0);

  const r9 = parseStrudelPattern('s("[bd sd hh")');
  record('Strudel: unbalanced brackets stability', Array.isArray(r9.events));

  const r10 = parseStrudelPattern('s("bd(0,0)")');
  record('Strudel: Euclidean division by zero safety', Array.isArray(r10.events));

  const r11 = parseStrudelPattern('s("bd ~ sd . hh rest cp _")');
  record('Strudel: rest filtering (~, ., rest, _)', r11.events.length === 4);

  // Rate modifier .fast(0) test
  const r12 = parseStrudelPattern('s("bd").fast(0)');
  record('Strudel: zero rate modifier handling .fast(0)', r12.rateModifier > 0, `rateModifier = ${r12.rateModifier}`);

  // --- 2. AUDIO PEAK EXTRACTOR ---
  const dummyChannel = new Float32Array(1000);
  for (let i = 0; i < 1000; i++) dummyChannel[i] = i / 1000;
  const buf = new MockAudioBuffer(1, 1000, 44100, dummyChannel) as any;

  const p1 = extractPeaksFromBuffer(buf, 10);
  record('PeakExtractor: buffer peak extraction (10 samples)', p1.length === 10 && p1[9] === 1.0);

  let pNegError = false;
  try {
    extractPeaksFromBuffer(buf, -5);
  } catch (err: any) {
    pNegError = true;
  }
  record(
    'PeakExtractor: negative numSamples bounds safety',
    !pNegError,
    `threw RangeError: Invalid array length on extractPeaksFromBuffer(buf, -5) because new Array(-5) is evaluated`
  );

  const pValid = await extractPeaksFromUrl('https://valid.example.com/audio.mp3', 20);
  record('PeakExtractor: valid URL audio peak fetch & decode', pValid.length === 20 && pValid.some(v => v > 0.1));

  const pEmpty = await extractPeaksFromUrl('', 15);
  record('PeakExtractor: empty URL fallback', pEmpty.length === 15 && pEmpty.every(v => v === 0.1));

  const p404 = await extractPeaksFromUrl('https://error404.example.com/notfound', 15);
  record('PeakExtractor: HTTP 404 response fallback', p404.length === 15 && p404.every(v => v === 0.1));

  const pHtml = await extractPeaksFromUrl('https://html404.example.com/notfound', 15);
  record('PeakExtractor: HTML response decode error fallback', pHtml.length === 15 && pHtml.every(v => v === 0.1));

  const pCorrupt = await extractPeaksFromUrl('https://corrupt.example.com/corrupt.mp3', 15);
  record('PeakExtractor: corrupt audio header decode error fallback', pCorrupt.length === 15 && pCorrupt.every(v => v === 0.1));

  console.log('\n====================================================');
  const passes = results.filter(r => r.status === 'PASS').length;
  const fails = results.filter(r => r.status === 'FAIL').length;
  console.log(`TOTAL: ${passes} PASSED, ${fails} FAILED out of ${results.length} tests.`);
  console.log('====================================================');

  return { passes, fails, results };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runEmpiricalHarness().then(({ fails }) => {
    process.exit(fails > 0 ? 1 : 0);
  });
}
