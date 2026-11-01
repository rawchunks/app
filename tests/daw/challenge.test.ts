// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

const {
  scheduledRepeats,
  transportMock,
  MockGain,
  MockVolume,
  MockPanner,
  MockPanner3D,
  MockEQ3,
  MockFilter,
  MockDistortion,
  MockChorus,
  MockFeedbackDelay,
  MockReverb,
  MockCompressor,
  MockLimiter,
  MockPolySynth,
  MockMembraneSynth,
  MockNoiseSynth,
  MockMetalSynth,
  MockPlayer,
  MockMeter,
} = vi.hoisted(() => {
  (globalThis as any).window ??= globalThis;
  (globalThis as any).AudioContext ??= class {};
  const scheduledRepeats = new Map<number, (time: number) => void>();
  let scheduleCounter = 1;

  class MockParam {
    value: number;
    constructor(init = 0) {
      this.value = init;
    }
    rampTo = vi.fn((val: number) => {
      this.value = val;
    });
  }

  class MockAudioNode {
    disposed = false;
    connect = vi.fn().mockReturnThis();
    disconnect = vi.fn();
    chain = vi.fn().mockReturnThis();
    toDestination = vi.fn().mockReturnThis();
    dispose = vi.fn(() => {
      this.disposed = true;
    });
  }

  class MockGain extends MockAudioNode {
    gain = new MockParam(1);
  }
  class MockVolume extends MockAudioNode {
    volume = new MockParam(0);
  }
  class MockPanner extends MockAudioNode {
    pan = new MockParam(0);
  }
  class MockPanner3D extends MockAudioNode {
    positionX = new MockParam(0);
    positionY = new MockParam(0);
    positionZ = new MockParam(-1);
    setPosition = vi.fn();
  }
  class MockEQ3 extends MockAudioNode {
    low = new MockParam(0);
    mid = new MockParam(0);
    high = new MockParam(0);
  }
  class MockFilter extends MockAudioNode {
    frequency = new MockParam(1000);
    Q = new MockParam(1);
    type = 'lowpass';
  }
  class MockDistortion extends MockAudioNode {
    distortion = 0;
    wet = new MockParam(0);
  }
  class MockChorus extends MockAudioNode {
    frequency = new MockParam(1.5);
    depth = 0.7;
    wet = new MockParam(0);
  }
  class MockFeedbackDelay extends MockAudioNode {
    delayTime = new MockParam(0.25);
    feedback = new MockParam(0.25);
    wet = new MockParam(0);
  }
  class MockReverb extends MockAudioNode {
    decay = 2;
    wet = new MockParam(0);
  }
  class MockCompressor extends MockAudioNode {
    threshold = new MockParam(-24);
    ratio = new MockParam(4);
    attack = new MockParam(0.01);
    release = new MockParam(0.25);
  }
  class MockLimiter extends MockAudioNode {
    threshold = new MockParam(-1);
  }
  class MockPolySynth extends MockAudioNode {
    triggerAttackRelease = vi.fn();
  }
  class MockMembraneSynth extends MockAudioNode {
    triggerAttackRelease = vi.fn();
  }
  class MockNoiseSynth extends MockAudioNode {
    triggerAttackRelease = vi.fn();
  }
  class MockMetalSynth extends MockAudioNode {
    triggerAttackRelease = vi.fn();
  }
  class MockPlayer extends MockAudioNode {
    loaded = true;
    load = vi.fn().mockResolvedValue(undefined);
    sync = vi.fn().mockReturnThis();
    unsync = vi.fn().mockReturnThis();
    start = vi.fn();
    stop = vi.fn();
  }
  class MockMeter extends MockAudioNode {
    getValue = vi.fn(() => -12);
  }

  const transportMock = {
    state: 'stopped',
    seconds: 0,
    PPQ: 192,
    getTicksAtTime: (time: number) => Math.round(time / 0.125) * 48,
    bpm: { value: 120, rampTo: vi.fn() },
    loop: false,
    loopStart: 0,
    loopEnd: 30,
    start: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    cancel: vi.fn(),
    scheduleRepeat: (fn: (time: number) => void) => {
      const id = scheduleCounter++;
      scheduledRepeats.set(id, fn);
      return id;
    },
    clear: (id: number) => {
      scheduledRepeats.delete(id);
    },
  };

  return {
    scheduledRepeats,
    transportMock,
    MockGain,
    MockVolume,
    MockPanner,
    MockPanner3D,
    MockEQ3,
    MockFilter,
    MockDistortion,
    MockChorus,
    MockFeedbackDelay,
    MockReverb,
    MockCompressor,
    MockLimiter,
    MockPolySynth,
    MockMembraneSynth,
    MockNoiseSynth,
    MockMetalSynth,
    MockPlayer,
    MockMeter,
  };
});

vi.mock('tone', () => ({
  start: vi.fn().mockResolvedValue(undefined),
  gainToDb: (gain: number) => (gain > 0 ? 20 * Math.log10(gain) : -100),
  dbToGain: (db: number) => Math.pow(10, db / 20),
  now: () => 0,
  getContext: () => ({
    state: 'running',
    resume: vi.fn().mockResolvedValue(undefined),
    rawContext: {},
  }),
  getTransport: () => transportMock,
  getDraw: () => ({
    schedule: (fn: () => void) => fn(),
  }),
  Gain: MockGain,
  Volume: MockVolume,
  Panner: MockPanner,
  Panner3D: MockPanner3D,
  EQ3: MockEQ3,
  Filter: MockFilter,
  Distortion: MockDistortion,
  Chorus: MockChorus,
  FeedbackDelay: MockFeedbackDelay,
  Reverb: MockReverb,
  Compressor: MockCompressor,
  Limiter: MockLimiter,
  PolySynth: MockPolySynth,
  Synth: class {},
  MembraneSynth: MockMembraneSynth,
  NoiseSynth: MockNoiseSynth,
  MetalSynth: MockMetalSynth,
  Player: MockPlayer,
  Meter: MockMeter,
}));

describe('Empirical Challenge Tests', () => {
  it('validates master bus routing, multi-sequencer scheduling, transport race safety, and track disposal', async () => {
    const Tone = await import('tone');
    const { dawEngine } = await import('../../src/lib/daw/engine');
    const { useDawStore } = await import('../../src/lib/daw/store');

    const engineAny = dawEngine as any;

    // 1. Master Bus Routing (Pre & Post-Init)
    const preTrack: any = {
      id: 'test-pre-track',
      name: 'Pre-Init Track',
      type: 'stem',
      color: '#ff0000',
      volume: 0.8,
      pan: 0,
      muted: false,
      solo: false,
      fx: {
        eq: { enabled: true, low: 0, mid: 0, high: 0 },
        compressor: { enabled: false, threshold: -20, ratio: 4, attack: 0.005, release: 0.2 },
        reverb: { enabled: false, decay: 2.5, wet: 0.3 },
        delay: { enabled: false, delayTime: 0.35, feedback: 0.4, wet: 0.25 },
        distortion: { enabled: false, drive: 0.4, wet: 0.3 },
        chorus: { enabled: false, rate: 1.5, depth: 0.7, wet: 0.3 },
        filter: { enabled: false, cutoff: 8000, resonance: 1.0, type: 'lowpass' },
      },
      clips: [],
    };

    const preNodes = dawEngine.getOrCreateTrackNodes(preTrack);
    expect(preNodes).not.toBeNull();
    expect(engineAny.masterCompressor).not.toBeNull();
    expect(engineAny.masterLimiter).not.toBeNull();

    const masterCompressorRef = engineAny.masterCompressor;
    await dawEngine.init();
    expect(engineAny.isInitialized).toBe(true);

    const postTrack: any = {
      ...preTrack,
      id: 'test-post-track',
      name: 'Post-Init Track',
      color: '#00ff00',
    };

    const postNodes = dawEngine.getOrCreateTrackNodes(postTrack);
    expect(postNodes).not.toBeNull();
    expect(engineAny.masterCompressor).toBe(masterCompressorRef);

    dawEngine.disposeTrack('test-pre-track');
    dawEngine.disposeTrack('test-post-track');

    // 2. Multi-Sequencer Concurrent Playback
    const seqTrack1: any = {
      id: 'seq-track-1',
      name: 'Sequencer 1',
      type: 'sequencer',
      color: '#0000ff',
      volume: 0.9,
      pan: -0.5,
      muted: false,
      solo: false,
      fx: preTrack.fx,
      clips: [],
      sequencerVoices: [
        { name: 'KICK', steps: [true, false, false, false], velocity: [1, 0, 0, 0], muted: false },
        { name: 'SNARE', steps: [false, false, true, false], velocity: [0, 0, 1, 0], muted: false },
      ],
    };

    const seqTrack2: any = {
      ...seqTrack1,
      id: 'seq-track-2',
      name: 'Sequencer 2',
      color: '#00ffff',
      pan: 0.5,
      sequencerVoices: [
        { name: 'KICK', steps: [true, true, false, false], velocity: [1, 1, 0, 0], muted: false },
        { name: 'SNARE', steps: [false, false, true, true], velocity: [0, 0, 1, 1], muted: false },
      ],
    };

    dawEngine.scheduleSequencer(seqTrack1);
    const sched1 = engineAny.sequencerScheduleIds.get('seq-track-1');
    expect(sched1).toBeDefined();

    dawEngine.scheduleSequencer(seqTrack2);
    const sched2 = engineAny.sequencerScheduleIds.get('seq-track-2');
    expect(sched2).toBeDefined();
    expect(sched1).not.toBe(sched2);
    expect(engineAny.sequencerScheduleIds.has('seq-track-1')).toBe(true);

    dawEngine.scheduleSequencer(seqTrack1);
    const newSched1 = engineAny.sequencerScheduleIds.get('seq-track-1');
    expect(newSched1).toBeDefined();
    expect(newSched1).not.toBe(sched1);
    expect(engineAny.sequencerScheduleIds.get('seq-track-2')).toBe(sched2);

    dawEngine.disposeTrack('seq-track-1');
    expect(engineAny.sequencerScheduleIds.has('seq-track-1')).toBe(false);
    expect(engineAny.sequencerScheduleIds.get('seq-track-2')).toBe(sched2);

    dawEngine.disposeTrack('seq-track-2');
    expect(engineAny.sequencerScheduleIds.has('seq-track-2')).toBe(false);

    // 3. Transport Start/Stop Race Condition Safety
    engineAny.isInitialized = false;
    let resolveInitPromise: () => void = () => {};
    const initSlowPromise = new Promise<void>((resolve) => {
      resolveInitPromise = resolve;
    });

    const originalInit = dawEngine.init.bind(dawEngine);
    dawEngine.init = async () => {
      await initSlowPromise;
      engineAny.isInitialized = true;
    };

    let startCalled = false;
    const origTransportStart = Tone.getTransport().start;
    Tone.getTransport().start = (() => {
      startCalled = true;
      return Tone.getTransport();
    }) as any;

    const startPromise = dawEngine.startTransport();
    expect(engineAny.targetTransportState).toBe('started');

    dawEngine.stopTransport();
    expect(engineAny.targetTransportState).toBe('stopped');

    resolveInitPromise();
    await startPromise;
    expect(startCalled).toBe(false);

    // Restore originals
    Tone.getTransport().start = origTransportStart;
    dawEngine.init = originalInit;
    engineAny.isInitialized = true;

    // 4. removeTrack Resource Disposal
    const newSeqTrack = useDawStore.getState().addTrack('sequencer', 'Test Seq Track');
    dawEngine.getOrCreateTrackNodes(newSeqTrack);
    dawEngine.scheduleSequencer(newSeqTrack);

    const trackNodesBefore = engineAny.trackNodes.get(newSeqTrack.id);
    expect(trackNodesBefore).toBeDefined();
    expect(engineAny.sequencerScheduleIds.has(newSeqTrack.id)).toBe(true);

    const kickSynth = trackNodesBefore.drumSynths?.kick;
    const inputNode = trackNodesBefore.input;
    expect(kickSynth && !kickSynth.disposed).toBe(true);
    expect(inputNode && !inputNode.disposed).toBe(true);

    useDawStore.getState().removeTrack(newSeqTrack.id);
    expect(useDawStore.getState().tracks.find((t: any) => t.id === newSeqTrack.id)).toBeUndefined();
    expect(engineAny.trackNodes.has(newSeqTrack.id)).toBe(false);
    expect(engineAny.sequencerScheduleIds.has(newSeqTrack.id)).toBe(false);
    expect(kickSynth?.disposed).toBe(true);
    expect(inputNode?.disposed).toBe(true);

    const newPianoTrack = useDawStore.getState().addTrack('pianoroll', 'Test Piano Track');
    dawEngine.getOrCreateTrackNodes(newPianoTrack);
    const pianoNodes = engineAny.trackNodes.get(newPianoTrack.id);
    const polySynth = pianoNodes?.polySynth;
    expect(polySynth && !polySynth.disposed).toBe(true);

    useDawStore.getState().removeTrack(newPianoTrack.id);
    expect(polySynth?.disposed).toBe(true);
  });
});
