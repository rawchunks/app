import { describe, test, expect, beforeEach, vi } from 'vitest';

type ScheduleRepeatFn = (time: number) => void;

const {
  scheduledRepeats,
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
  MockPolySynth,
  MockMembraneSynth,
  MockNoiseSynth,
  MockMetalSynth,
  MockPlayer,
  MockMeter,
} = vi.hoisted(() => {
  (globalThis as any).window ??= globalThis;
  (globalThis as any).AudioContext ??= class {};
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

  class MockPanner3D extends MockAudioNode {
    positionX: MockParam;
    positionY: MockParam;
    positionZ: MockParam;
    panningModel: string;
    constructor(opts?: any) {
      super();
      this.positionX = new MockParam(opts?.positionX ?? 0);
      this.positionY = new MockParam(opts?.positionY ?? 0);
      this.positionZ = new MockParam(opts?.positionZ ?? -1);
      this.panningModel = opts?.panningModel ?? 'HRTF';
    }
    setPosition = vi.fn((x: number, y: number, z: number) => {
      this.positionX.value = x;
      this.positionY.value = y;
      this.positionZ.value = z;
    });
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
    loaded = true;
    load = vi.fn().mockResolvedValue(undefined);
    sync = vi.fn().mockReturnThis();
    unsync = vi.fn().mockReturnThis();
    start = vi.fn();
    stop = vi.fn();
    constructor(opts?: any) {
      super();
      this.url = opts?.url ?? '';
      if (opts?.onload) {
        setTimeout(() => opts.onload(), 0);
      }
    }
  }

  class MockMeter extends MockAudioNode {
    getValue = vi.fn(() => -12);
  }

  return {
    scheduledRepeats,
    nextScheduleId,
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
    MockPolySynth,
    MockMembraneSynth,
    MockNoiseSynth,
    MockMetalSynth,
    MockPlayer,
    MockMeter,
  };
});

vi.mock('tone', () => {
  let scheduleCounter = 1;
  return {
    start: vi.fn().mockResolvedValue(undefined),
    gainToDb: (gain: number) => (gain > 0 ? 20 * Math.log10(gain) : -100),
    dbToGain: (db: number) => Math.pow(10, db / 20),
    now: () => 0,
    getContext: () => ({
      state: 'running',
      resume: vi.fn().mockResolvedValue(undefined),
      rawContext: {},
    }),
    getTransport: () => ({
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
    Panner3D: MockPanner3D,
    EQ3: MockEQ3,
    Filter: MockFilter,
    Distortion: MockDistortion,
    Chorus: MockChorus,
    FeedbackDelay: MockFeedbackDelay,
    Reverb: MockReverb,
    Compressor: MockCompressor,
    Limiter: MockGain,
    Meter: MockMeter,
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
  beforeEach(async () => {
    scheduledRepeats.clear();
    (dawEngine as any).trackNodes.clear();
    (dawEngine as any).sequencerScheduleIds.clear();
    (dawEngine as any).clipLoads.clear();
    await dawEngine.init();
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
      seq2Cb(0);
      expect(useDawStore.getState().sequencerSteps[track2.id]).toBe(0);
      seq2Cb(0.125);
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

    test('lazily creates audio nodes on triggerNote for uninitialized pianoroll track', async () => {
      const prTrack = useDawStore.getState().addTrack('pianoroll', 'Piano Roll Track');

      expect((dawEngine as any).trackNodes.has(prTrack.id)).toBe(false);

      // Call triggerNote
      await dawEngine.triggerNote(prTrack.id, 'C4', '8n', 0.8);

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

  describe('4. 2D Wave-Sculpting, Spectral Peaks & 3D Spatial Audio', () => {
    test('evaluates 2D peak-sculpting (vertical gain/crest/drive) and wave-design (horizontal warp/texture)', async () => {
      const { createDefaultWaveSculpt, evaluateSculptField, sculptBipolarPeaks } = await import('../../src/lib/daw/peaks');
      const state = createDefaultWaveSculpt();
      state.fadeIn = 0.1;
      state.fadeOut = 0.1;
      state.crest = 0.5;
      state.drive = 0.4;
      state.texture = 0.3;
      state.nodes[1].gainDb = 6;
      state.nodes[1].warpOffset = 0.05;

      const fieldStart = evaluateSculptField(state, 0);
      expect(fieldStart.fadeMultiplier).toBeCloseTo(0, 4);

      const fieldMid = evaluateSculptField(state, state.nodes[1].position + state.nodes[1].warpOffset);
      expect(fieldMid.gainLinear).toBeGreaterThan(1.5);
      expect(fieldMid.warpedTime).toBeGreaterThan(0);
      expect(fieldMid.warpedTime).toBeLessThan(1);

      const basePeaks = {
        mins: new Float32Array([-0.5, -0.6, -0.7, -0.5]),
        maxs: new Float32Array([0.5, 0.6, 0.7, 0.5]),
        rms: new Float32Array([0.3, 0.4, 0.45, 0.3]),
        low: new Float32Array([0.4, 0.3, 0.2, 0.4]),
        mid: new Float32Array([0.3, 0.4, 0.4, 0.3]),
        high: new Float32Array([0.3, 0.3, 0.4, 0.3]),
        bins: 4,
        duration: 4,
      };
      const sculpted = sculptBipolarPeaks(basePeaks, state);
      expect(sculpted.maxs.length).toBe(4);
      expect(sculpted.maxs[0]).toBeCloseTo(0, 3);
      expect(sculpted.maxs[1]).toBeGreaterThan(0.5);
    });

    test('synthesizes Strudel bipolar + 3-band spectral peaks and preserves immutable .rev() and .s() sound override', async () => {
      const { parseStrudelPattern, synthesizeStrudelBipolarPeaks } = await import('../../src/lib/daw/strudel');
      const parsed = parseStrudelPattern('note("c3 e3 g3 b3").s("sawtooth").rev().fast(2).lpf(1800)');
      expect(parsed.isValid).toBe(true);
      expect(parsed.events.length).toBeGreaterThan(0);
      expect(parsed.events[0].synthSound).toBe('sawtooth');
      expect(parsed.events[0].lpf).toBe(1800);

      const peaks = synthesizeStrudelBipolarPeaks('s("bd sd hh cp")', 64, 4);
      expect(peaks.maxs.length).toBe(64);
      expect(peaks.mins.length).toBe(64);
      expect(peaks.low?.length).toBe(64);
      expect(peaks.mid?.length).toBe(64);
      expect(peaks.high?.length).toBe(64);
    });

    test('updates 3D binaural spatial panner state on track FX', () => {
      const track = useDawStore.getState().addTrack('stem', 'Spatial Stem');
      useDawStore.getState().updateTrackFx(track.id, 'spatial', {
        enabled: true,
        azimuth: 60,
        elevation: 20,
        distance: 1.8,
      });
      const updated = useDawStore.getState().tracks.find((t) => t.id === track.id)!;
      expect(updated.fx.spatial).toEqual({
        enabled: true,
        azimuth: 60,
        elevation: 20,
        distance: 1.8,
      });
    });

    test('composes Master and Stem wave sculpts two-ways without losing stem or master deltas', async () => {
      const {
        createDefaultWaveSculpt,
        composeWaveSculpts,
        getTrackOwnSculpt,
        sculptBipolarPeaks,
      } = await import('../../src/lib/daw/peaks');

      const stemTrack = useDawStore.getState().addTrack('stem', 'Vocals');
      useDawStore.setState((s) => ({
        tracks: [
          ...(s.tracks.some((t) => t.id === 'master')
            ? []
            : [
                {
                  ...stemTrack,
                  id: 'master',
                  name: 'Master',
                  clips: [],
                },
              ]),
          ...s.tracks.map((t) =>
            t.id === stemTrack.id
              ? {
                  ...t,
                  clips: [
                    {
                      id: 'clip-v1',
                      name: 'Vocals',
                      url: '/test-vocals.mp3',
                      startTime: 0,
                      duration: 4,
                      offset: 0,
                    },
                  ],
                }
              : t
          ),
        ],
      }));

      // 1. Sculpt Master (add granular anchor at 0.25 with +6dB and node[0] +3dB)
      const masterSculpt = createDefaultWaveSculpt();
      masterSculpt.nodes[0].gainDb = 3;
      masterSculpt.anchors = [
        { id: 'm-a1', position: 0.25, radius: 0.08, gainDb: 6, timeShift: 0.02, polarity: 'both' },
      ];
      masterSculpt.granularAnchors = masterSculpt.anchors;
      masterSculpt.drive = 0.2;
      useDawStore.getState().updateTrackSculpt('master', masterSculpt);

      // 2. Sculpt Stem (add granular anchor at 0.75 with -5dB and node[0] +2dB)
      const stemSculpt = createDefaultWaveSculpt();
      stemSculpt.nodes[0].gainDb = 2;
      stemSculpt.anchors = [
        { id: 's-a1', position: 0.75, radius: 0.08, gainDb: -5, timeShift: -0.01, polarity: 'both' },
      ];
      stemSculpt.granularAnchors = stemSculpt.anchors;
      stemSculpt.drive = 0.3;
      useDawStore.getState().updateClipSculpt(stemTrack.id, 'clip-v1', stemSculpt);

      const updatedMaster = useDawStore.getState().tracks.find((t) => t.id === 'master')!;
      const updatedStem = useDawStore.getState().tracks.find((t) => t.id === stemTrack.id)!;

      const composed = composeWaveSculpts(
        getTrackOwnSculpt(updatedMaster),
        getTrackOwnSculpt(updatedStem)
      );

      // Nodes and global scalars compose additively
      expect(composed.nodes[0].gainDb).toBe(5);
      expect(composed.drive).toBeCloseTo(0.5, 4);
      // Both Master and Stem anchors are preserved in sorted order
      expect(composed.anchors?.length).toBe(2);
      expect(composed.anchors?.[0].id).toBe('m-a1');
      expect(composed.anchors?.[1].id).toBe('s-a1');

      // Engine resolves composed sculpt for stem clip
      const engineSculpt = (dawEngine as any).getEffectiveClipSculpt(stemTrack.id, 'clip-v1');
      expect(engineSculpt).toBeDefined();
      expect(engineSculpt.nodes[0].gainDb).toBe(5);
      expect(engineSculpt.anchors.length).toBe(2);

      // Bipolar peak array transforms cleanly with composed sculpt (5 bins -> t = 0, 0.25, 0.5, 0.75, 1.0)
      const rawPeaks = {
        mins: new Float32Array([-0.4, -0.4, -0.4, -0.4, -0.4]),
        maxs: new Float32Array([0.4, 0.4, 0.4, 0.4, 0.4]),
        rms: new Float32Array([0.25, 0.25, 0.25, 0.25, 0.25]),
        bins: 5,
        duration: 4,
      };
      const reshaped = sculptBipolarPeaks(rawPeaks, composed);
      expect(reshaped.maxs[1]).toBeGreaterThan(reshaped.maxs[2]); // boosted by Master anchor at t=0.25
      expect(reshaped.maxs[3]).toBeLessThan(reshaped.maxs[2]); // attenuated by Stem anchor at t=0.75
    });
  });
});
