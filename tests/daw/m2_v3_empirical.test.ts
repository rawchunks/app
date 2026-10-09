import { describe, test, expect, beforeEach, vi } from 'vitest';

type ScheduleRepeatFn = (time: number) => void;

const {
  scheduledRepeats,
  MockGain,
  MockVolume,
  MockPanner,
  MockEQ3,
  MockFilter,
  MockDistortion,
  MockChorus,
  MockFeedbackDelay,
  MockReverb,
  MockCompressor,
  MockPolySynth,
  MockMembraneSynth,
  MockNoiseSynth,
  MockMetalSynth,
  MockPlayer,
} = vi.hoisted(() => {
  const scheduledRepeats = new Map<number, ScheduleRepeatFn>();
  let nextScheduleId = 1;

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
    connect = vi.fn().mockReturnThis();
    disconnect = vi.fn();
    chain = vi.fn().mockReturnThis();
    toDestination = vi.fn().mockReturnThis();
    dispose = vi.fn();
  }

  class MockGain extends MockAudioNode {
    gain: MockParam;
    constructor(val = 1) {
      super();
      this.gain = new MockParam(val);
    }
  }

  class MockVolume extends MockAudioNode {
    volume: MockParam;
    constructor(val = 0) {
      super();
      this.volume = new MockParam(val);
    }
  }

  class MockPanner extends MockAudioNode {
    pan: MockParam;
    constructor(val = 0) {
      super();
      this.pan = new MockParam(val);
    }
  }

  class MockEQ3 extends MockAudioNode {
    low: MockParam;
    mid: MockParam;
    high: MockParam;
    constructor(opts?: any) {
      super();
      this.low = new MockParam(opts?.low ?? 0);
      this.mid = new MockParam(opts?.mid ?? 0);
      this.high = new MockParam(opts?.high ?? 0);
    }
  }

  class MockFilter extends MockAudioNode {
    frequency: MockParam;
    Q: MockParam;
    type: string;
    constructor(opts?: any) {
      super();
      this.frequency = new MockParam(opts?.frequency ?? 1000);
      this.Q = new MockParam(opts?.Q ?? 1);
      this.type = opts?.type ?? 'lowpass';
    }
  }

  class MockDistortion extends MockAudioNode {
    distortion: number;
    wet: MockParam;
    constructor(opts?: any) {
      super();
      this.distortion = opts?.distortion ?? 0;
      this.wet = new MockParam(opts?.wet ?? 0);
    }
  }

  class MockChorus extends MockAudioNode {
    frequency: MockParam;
    depth: number;
    wet: MockParam;
    constructor(opts?: any) {
      super();
      this.frequency = new MockParam(opts?.frequency ?? 1.5);
      this.depth = opts?.depth ?? 0.7;
      this.wet = new MockParam(opts?.wet ?? 0);
    }
  }

  class MockFeedbackDelay extends MockAudioNode {
    delayTime: MockParam;
    feedback: MockParam;
    wet: MockParam;
    constructor(opts?: any) {
      super();
      this.delayTime = new MockParam(opts?.delayTime ?? 0.25);
      this.feedback = new MockParam(opts?.feedback ?? 0.25);
      this.wet = new MockParam(opts?.wet ?? 0);
    }
  }

  class MockReverb extends MockAudioNode {
    decay: number;
    wet: MockParam;
    constructor(opts?: any) {
      super();
      this.decay = opts?.decay ?? 2;
      this.wet = new MockParam(opts?.wet ?? 0);
    }
  }

  class MockCompressor extends MockAudioNode {
    threshold: MockParam;
    ratio: MockParam;
    attack: MockParam;
    release: MockParam;
    constructor(opts?: any) {
      super();
      this.threshold = new MockParam(opts?.threshold ?? -24);
      this.ratio = new MockParam(opts?.ratio ?? 4);
      this.attack = new MockParam(opts?.attack ?? 0.01);
      this.release = new MockParam(opts?.release ?? 0.25);
    }
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
    url: string;
    sync = vi.fn().mockReturnThis();
    start = vi.fn();
    constructor(opts?: any) {
      super();
      this.url = opts?.url ?? '';
      if (opts?.onload) {
        setTimeout(() => opts.onload(), 0);
      }
    }
  }

  return {
    scheduledRepeats,
    nextScheduleId,
    MockGain,
    MockVolume,
    MockPanner,
    MockEQ3,
    MockFilter,
    MockDistortion,
    MockChorus,
    MockFeedbackDelay,
    MockReverb,
    MockCompressor,
    MockPolySynth,
    MockMembraneSynth,
    MockNoiseSynth,
    MockMetalSynth,
    MockPlayer,
  };
});

vi.mock('tone', () => {
  let scheduleCounter = 1;
  return {
    start: vi.fn().mockResolvedValue(undefined),
    gainToDb: (gain: number) => (gain > 0 ? 20 * Math.log10(gain) : -100),
    now: () => 0,
    getTransport: () => ({
      state: 'stopped',
      seconds: 0,
      bpm: { rampTo: vi.fn() },
      loop: false,
      loopStart: 0,
      loopEnd: 30,
      start: vi.fn(),
      pause: vi.fn(),
      stop: vi.fn(),
      scheduleRepeat: (fn: ScheduleRepeatFn) => {
        const id = scheduleCounter++;
        scheduledRepeats.set(id, fn);
        return id;
      },
      clear: (id: number) => {
        scheduledRepeats.delete(id);
      },
    }),
    getDraw: () => ({
      schedule: (fn: () => void) => {
        fn(); // execute draw callback synchronously for deterministic testing
      },
    }),
    Gain: MockGain,
    Volume: MockVolume,
    Panner: MockPanner,
    EQ3: MockEQ3,
    Filter: MockFilter,
    Distortion: MockDistortion,
    Chorus: MockChorus,
    FeedbackDelay: MockFeedbackDelay,
    Reverb: MockReverb,
    Compressor: MockCompressor,
    Limiter: MockGain,
    PolySynth: MockPolySynth,
    MembraneSynth: MockMembraneSynth,
    NoiseSynth: MockNoiseSynth,
    MetalSynth: MockMetalSynth,
    Player: MockPlayer,
    Synth: class { },
  };
});

// Import dawEngine and useDawStore after mocking Tone
import { dawEngine } from '../../src/lib/daw/engine';
import { useDawStore } from '../../src/lib/daw/store';

describe('Milestone M2 Iteration 3 Empirical Stress Suite', () => {
  beforeEach(() => {
    scheduledRepeats.clear();
    useDawStore.setState({
      tracks: [],
      sequencerSteps: {},
    });
  });

  describe('1. Multi-Sequencer Concurrent Playback Stress Test', () => {
    test('supports 2+ active sequencer tracks with independent step advancement', () => {
      const track1 = useDawStore.getState().addTrack('sequencer', 'Sequencer Track 1');
      const track2 = useDawStore.getState().addTrack('sequencer', 'Sequencer Track 2');
      const track3 = useDawStore.getState().addTrack('sequencer', 'Sequencer Track 3');

      expect(track1.id).not.toBe(track2.id);
      expect(track2.id).not.toBe(track3.id);

      // Schedule all 3 tracks
      dawEngine.scheduleSequencer(track1);
      dawEngine.scheduleSequencer(track2);
      dawEngine.scheduleSequencer(track3);

      expect(scheduledRepeats.size).toBe(3);

      const repeatFns = Array.from(scheduledRepeats.values()) as ScheduleRepeatFn[];
      const repeat1 = repeatFns[0];
      const repeat2 = repeatFns[1];
      const repeat3 = repeatFns[2];

      // Simulate 32 ticks on track 1 independently
      for (let i = 0; i < 32; i++) {
        repeat1(i * 0.125);
        const currentStepTrack1 = useDawStore.getState().sequencerSteps[track1.id];
        expect(currentStepTrack1).toBe(i % 16);
      }

      // Verify track 2 and 3 remained un-advanced by track 1 ticks
      expect(useDawStore.getState().sequencerSteps[track2.id]).toBeUndefined();
      expect(useDawStore.getState().sequencerSteps[track3.id]).toBeUndefined();

      // Interleave ticks across track 1, track 2, and track 3
      for (let step = 0; step < 16; step++) {
        repeat1(step * 0.125);
        repeat2(step * 0.125);
        repeat3(step * 0.125);

        const state = useDawStore.getState().sequencerSteps;
        expect(state[track1.id]).toBe((step + 32) % 16); // step + 32 because track 1 ran 32 times before
        expect(state[track2.id]).toBe(step % 16);
        expect(state[track3.id]).toBe(step % 16);
      }
    });

    test('re-scheduling or clearing track 1 does not disturb track 2 schedule', () => {
      const track1 = useDawStore.getState().addTrack('sequencer', 'Seq 1');
      const track2 = useDawStore.getState().addTrack('sequencer', 'Seq 2');

      dawEngine.scheduleSequencer(track1);
      dawEngine.scheduleSequencer(track2);

      expect(scheduledRepeats.size).toBe(2);

      // Re-schedule track 1 (e.g. pattern updated)
      dawEngine.scheduleSequencer(track1);

      expect(scheduledRepeats.size).toBe(2);

      // Dispose track 1
      dawEngine.disposeTrack(track1.id);

      expect(scheduledRepeats.size).toBe(1);

      // Track 2 callback still exists and advances track 2
      const [seq2Cb] = Array.from(scheduledRepeats.values()) as ScheduleRepeatFn[];
      seq2Cb(0.125);
      expect(useDawStore.getState().sequencerSteps[track2.id]).toBe(0);
      seq2Cb(0.250);
      expect(useDawStore.getState().sequencerSteps[track2.id]).toBe(1);
    });
  });

  describe('2. Non-Sequencer Track Audio Node Lazy Instantiation Test', () => {
    test('lazily creates audio nodes on loadClip for uninitialized stem track', async () => {
      const stemTrack = useDawStore.getState().addTrack('stem', 'Stem Track');

      // Nodes do not exist yet
      expect((dawEngine as any).trackNodes.has(stemTrack.id)).toBe(false);

      // Call loadClip on stem track
      await dawEngine.loadClip(stemTrack.id, 'clip-1', 'http://example.com/audio.mp3', 0, 0, 10);

      // Nodes must be created now
      expect((dawEngine as any).trackNodes.has(stemTrack.id)).toBe(true);
      const nodes = dawEngine.getOrCreateTrackNodes(stemTrack.id);
      expect(nodes.input).toBeDefined();
      expect(nodes.players.has('clip-1')).toBe(true);
    });

    test('lazily creates audio nodes on triggerNote for uninitialized pianoroll track', () => {
      const prTrack = useDawStore.getState().addTrack('pianoroll', 'Piano Roll Track');

      expect((dawEngine as any).trackNodes.has(prTrack.id)).toBe(false);

      // Call triggerNote
      dawEngine.triggerNote(prTrack.id, 'C4', '8n', 0.8);

      expect((dawEngine as any).trackNodes.has(prTrack.id)).toBe(true);
      const nodes = dawEngine.getOrCreateTrackNodes(prTrack.id);
      expect(nodes.polySynth).toBeDefined();
      expect(nodes.polySynth?.triggerAttackRelease).toHaveBeenCalledWith('C4', '8n', undefined, 0.8);
    });

    test('lazily creates audio nodes on updateTrackMixer for uninitialized sample track', () => {
      const sampleTrack = useDawStore.getState().addTrack('sample', 'Sample Track');

      expect((dawEngine as any).trackNodes.has(sampleTrack.id)).toBe(false);

      // Call updateTrackMixer directly on engine
      dawEngine.updateTrackMixer(sampleTrack.id, 0.75, 0.25, false);

      expect((dawEngine as any).trackNodes.has(sampleTrack.id)).toBe(true);
      const nodes = dawEngine.getOrCreateTrackNodes(sampleTrack.id);
      expect(nodes.volume.volume.rampTo).toHaveBeenCalled();
      expect(nodes.panner.pan.rampTo).toHaveBeenCalledWith(0.25, 0.05);
    });

    test('lazily creates audio nodes on updateTrackFx for uninitialized strudel track', () => {
      const strudelTrack = useDawStore.getState().addTrack('strudel', 'Strudel Track');

      expect((dawEngine as any).trackNodes.has(strudelTrack.id)).toBe(false);

      // Call updateTrackFx with single parameter overload
      dawEngine.updateTrackFx(strudelTrack.id, 'filter', { cutoff: 3500, resonance: 2.5 });

      expect((dawEngine as any).trackNodes.has(strudelTrack.id)).toBe(true);
      const nodes = dawEngine.getOrCreateTrackNodes(strudelTrack.id);
      expect(nodes.filter.frequency.rampTo).toHaveBeenCalledWith(3500, 0.05);
      expect(nodes.filter.Q.rampTo).toHaveBeenCalledWith(2.5, 0.05);
    });

    test('lazily creates audio nodes on updateTrackFx full config overload', () => {
      const track = useDawStore.getState().addTrack('stem', 'Stem Track 2');

      expect((dawEngine as any).trackNodes.has(track.id)).toBe(false);

      const fullFxConfig = {
        eq: { enabled: true, low: 2, mid: -1, high: 4 },
        compressor: { enabled: true, threshold: -18, ratio: 3, attack: 0.005, release: 0.2 },
        reverb: { enabled: true, decay: 3, wet: 0.4 },
        delay: { enabled: true, delayTime: 0.3, feedback: 0.5, wet: 0.2 },
        distortion: { enabled: true, drive: 0.6, wet: 0.3 },
        chorus: { enabled: true, rate: 2.0, depth: 0.8, wet: 0.4 },
        filter: { enabled: true, cutoff: 4000, resonance: 1.5, type: 'highpass' as const },
      };

      dawEngine.updateTrackFx(track.id, fullFxConfig);

      expect((dawEngine as any).trackNodes.has(track.id)).toBe(true);
      const nodes = dawEngine.getOrCreateTrackNodes(track.id);
      expect(nodes.eq.low.rampTo).toHaveBeenCalledWith(2, 0.05);
      expect(nodes.filter.frequency.rampTo).toHaveBeenCalledWith(4000, 0.05);
      expect(nodes.filter.type).toBe('highpass');
    });
  });

  describe('3. Edge Cases & Robustness', () => {
    test('triggerDrum gracefully handles uninitialized or non-sequencer track', () => {
      expect(() => {
        dawEngine.triggerDrum('non-existent-track', 'kick', 0.9);
      }).not.toThrow();
    });

    test('addTrack and removeTrack cleanly clean up audio nodes without leaks', () => {
      const seqTrack = useDawStore.getState().addTrack('sequencer', 'Temp Sequencer');
      dawEngine.scheduleSequencer(seqTrack);

      expect((dawEngine as any).trackNodes.has(seqTrack.id)).toBe(true);
      expect(scheduledRepeats.size).toBe(1);

      useDawStore.getState().removeTrack(seqTrack.id);

      expect((dawEngine as any).trackNodes.has(seqTrack.id)).toBe(false);
      expect(scheduledRepeats.size).toBe(0);
    });
  });
});
