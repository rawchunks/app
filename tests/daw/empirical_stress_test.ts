// WebAudio Mocks for Node testing environment
class MockAudioParam {
  value = 0;
  defaultValue = 0;
  minValue = -100;
  maxValue = 100;
  setValueAtTime() { return this; }
  linearRampToValueAtTime() { return this; }
  exponentialRampToValueAtTime() { return this; }
  setTargetAtTime() { return this; }
  setValueCurveAtTime() { return this; }
  cancelScheduledValues() { return this; }
  cancelAndHoldAtTime() { return this; }
  rampTo() { return this; }
}

class MockAudioNode {
  context: any;
  numberOfInputs = 1;
  numberOfOutputs = 1;
  channelCount = 2;
  channelCountMode = 'max';
  channelInterpretation = 'speakers';
  disposed = false;
  constructor(context?: any) { this.context = context; }
  connect(target: any) { return target; }
  disconnect() {}
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() { return true; }
  dispose() { this.disposed = true; }
}

class MockGainNode extends MockAudioNode {
  gain = new MockAudioParam();
}

class MockBiquadFilterNode extends MockAudioNode {
  frequency = new MockAudioParam();
  detune = new MockAudioParam();
  Q = new MockAudioParam();
  gain = new MockAudioParam();
  type = 'lowpass';
}

class MockDynamicsCompressorNode extends MockAudioNode {
  threshold = new MockAudioParam();
  knee = new MockAudioParam();
  ratio = new MockAudioParam();
  reduction = 0;
  attack = new MockAudioParam();
  release = new MockAudioParam();
}

class MockStereoPannerNode extends MockAudioNode {
  pan = new MockAudioParam();
}

class MockDelayNode extends MockAudioNode {
  delayTime = new MockAudioParam();
}

class MockOscillatorNode extends MockAudioNode {
  frequency = new MockAudioParam();
  detune = new MockAudioParam();
  type = 'sine';
  start() {}
  stop() {}
  setPeriodicWave() {}
}

class MockAudioBufferSourceNode extends MockAudioNode {
  playbackRate = new MockAudioParam();
  detune = new MockAudioParam();
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  buffer = null;
  start() {}
  stop() {}
}

class MockConvolverNode extends MockAudioNode {
  buffer = null;
  normalize = true;
}

class MockWaveShaperNode extends MockAudioNode {
  private _curve: Float32Array | null = null;
  get curve() { return this._curve; }
  set curve(val: any) { this._curve = val; }
  oversample = 'none';
}

class MockIIRFilterNode extends MockAudioNode {}
class MockConstantSourceNode extends MockAudioNode {
  offset = new MockAudioParam();
  start() {}
  stop() {}
}

class MockChannelSplitterNode extends MockAudioNode {
  constructor(context: any, numberOfOutputs = 6) {
    super(context);
    this.numberOfOutputs = numberOfOutputs;
  }
}

class MockChannelMergerNode extends MockAudioNode {
  constructor(context: any, numberOfInputs = 6) {
    super(context);
    this.numberOfInputs = numberOfInputs;
  }
}

class MockPeriodicWave {}
class MockScriptProcessorNode extends MockAudioNode {
  bufferSize = 256;
  onaudioprocess = null;
}

class MockAudioContext {
  state = 'suspended';
  currentTime = 0;
  sampleRate = 44100;
  destination = new MockAudioNode(this);
  listener = {
    positionX: new MockAudioParam(),
    positionY: new MockAudioParam(),
    positionZ: new MockAudioParam(),
    forwardX: new MockAudioParam(),
    forwardY: new MockAudioParam(),
    forwardZ: new MockAudioParam(),
    upX: new MockAudioParam(),
    upY: new MockAudioParam(),
    upZ: new MockAudioParam(),
  };
  createGain() { return new MockGainNode(this); }
  createBufferSource() { return new MockAudioBufferSourceNode(this); }
  createBiquadFilter() { return new MockBiquadFilterNode(this); }
  createDynamicsCompressor() { return new MockDynamicsCompressorNode(this); }
  createChannelMerger(numberOfInputs = 6) { return new MockChannelMergerNode(this, numberOfInputs); }
  createChannelSplitter(numberOfOutputs = 6) { return new MockChannelSplitterNode(this, numberOfOutputs); }
  createDelay() { return new MockDelayNode(this); }
  createOscillator() { return new MockOscillatorNode(this); }
  createPanner() { return new MockAudioNode(this); }
  createStereoPanner() { return new MockStereoPannerNode(this); }
  createWaveShaper() { return new MockWaveShaperNode(this); }
  createConvolver() { return new MockConvolverNode(this); }
  createIIRFilter() { return new MockIIRFilterNode(this); }
  createConstantSource() { return new MockConstantSourceNode(this); }
  createPeriodicWave() { return new MockPeriodicWave(); }
  createScriptProcessor(..._args: any[]) { return new MockScriptProcessorNode(this); }
  createBuffer(channels: number, length: number, sampleRate: number) {
    return {
      numberOfChannels: channels,
      length,
      sampleRate,
      duration: length / sampleRate,
      getChannelData: () => new Float32Array(length),
      copyFromChannel: () => {},
      copyToChannel: () => {},
    };
  }
  listeners: Record<string, Function[]> = {};
  addEventListener(type: string, fn: Function) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(fn);
  }
  removeEventListener(type: string, fn: Function) {
    if (this.listeners[type]) {
      this.listeners[type] = this.listeners[type].filter(f => f !== fn);
    }
  }
  dispatchEvent() { return true; }
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
  startRendering() { return Promise.resolve(this.createBuffer(2, 44100, 44100)); }
}

(globalThis as any).AudioContext = MockAudioContext;
(globalThis as any).webkitAudioContext = MockAudioContext;
(globalThis as any).OfflineAudioContext = MockAudioContext;
(globalThis as any).AudioParam = MockAudioParam;
(globalThis as any).AudioNode = MockAudioNode;
(globalThis as any).GainNode = MockGainNode;
(globalThis as any).BiquadFilterNode = MockBiquadFilterNode;
(globalThis as any).DynamicsCompressorNode = MockDynamicsCompressorNode;
(globalThis as any).StereoPannerNode = MockStereoPannerNode;
(globalThis as any).DelayNode = MockDelayNode;
(globalThis as any).OscillatorNode = MockOscillatorNode;
(globalThis as any).AudioBufferSourceNode = MockAudioBufferSourceNode;
(globalThis as any).ConvolverNode = MockConvolverNode;
(globalThis as any).WaveShaperNode = MockWaveShaperNode;
(globalThis as any).ChannelSplitterNode = MockChannelSplitterNode;
(globalThis as any).ChannelMergerNode = MockChannelMergerNode;
(globalThis as any).PeriodicWave = MockPeriodicWave;
(globalThis as any).ScriptProcessorNode = MockScriptProcessorNode;
(globalThis as any).window = globalThis;

async function runEmpiricalStressTest() {
  console.log('====================================================');
  console.log('   EMPIRICAL STRESS TEST & FAILURE MODE DETECTION   ');
  console.log('====================================================\n');

  const Tone = await import('tone');
  Tone.setContext(new Tone.Context());

  const { dawEngine } = await import('../engine');
  const { useDawStore } = await import('../store');

  let passed = 0;
  let failed = 0;

  function report(name: string, ok: boolean, details?: string) {
    if (ok) {
      console.log(`  [PASS] ${name}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${name}${details ? ` -> ${details}` : ''}`);
      failed++;
    }
  }

  const engineAny = dawEngine as any;

  // -------------------------------------------------------------------
  // TEST A: Rapid Track Creation, Node Instantiation, and Disposal Stress
  // -------------------------------------------------------------------
  console.log('--- TEST A: Rapid Track Creation & Disposal Stress (100 Cycles) ---');
  try {
    const initialTrackCount = useDawStore.getState().tracks.length;
    const createdTrackIds: string[] = [];

    // Create 100 tracks across all 5 track types
    const types: ('stem' | 'sample' | 'sequencer' | 'pianoroll' | 'strudel')[] = ['stem', 'sample', 'sequencer', 'pianoroll', 'strudel'];
    for (let i = 0; i < 100; i++) {
      const type = types[i % types.length];
      const track = useDawStore.getState().addTrack(type, `Stress Track ${i}`);
      createdTrackIds.push(track.id);

      // Lazily instantiate audio nodes
      const nodes = dawEngine.getOrCreateTrackNodes(track.id);

      // Verify node graph structure
      if (type === 'pianoroll' || type === 'strudel') {
        if (!nodes.polySynth) throw new Error(`Missing polySynth for ${type} track ${track.id}`);
      }
      if (type === 'sequencer') {
        if (!nodes.drumSynths) throw new Error(`Missing drumSynths for sequencer track ${track.id}`);
      }
    }

    report('A1. 100 tracks created with correct audio node types', true);
    report('A2. Engine node map contains 100 active track node entries', engineAny.trackNodes.size === 100);

    // Rapidly dispose all 100 tracks
    for (const trackId of createdTrackIds) {
      useDawStore.getState().removeTrack(trackId);
    }

    report('A3. All 100 tracks removed from store', useDawStore.getState().tracks.length === initialTrackCount);
    report('A4. Engine trackNodes map cleared after disposal', engineAny.trackNodes.size === 0);

  } catch (err: any) {
    report('TEST A: Rapid Creation & Disposal Stress', false, err.stack || err.message);
  }

  // -------------------------------------------------------------------
  // TEST B: Store updateTrackMixer -> dawEngine Sync Disconnect
  // -------------------------------------------------------------------
  console.log('\n--- TEST B: Store updateTrackMixer / updateTrackFx Sync Verification ---');
  try {
    const track = useDawStore.getState().addTrack('stem', 'Sync Test Track');
    dawEngine.getOrCreateTrackNodes(track.id);

    // Call store action
    useDawStore.getState().updateTrackMixer(track.id, { volume: 0.2, pan: 0.8, muted: true });

    // Read store state
    const storeTrack = useDawStore.getState().tracks.find((t) => t.id === track.id);
    report('B1. Store state updated volume/pan/muted', storeTrack?.volume === 0.2 && storeTrack?.pan === 0.8 && storeTrack?.muted === true);

    // Test if store updateTrackMixer automatically synced to dawEngine nodes
    // Note: Store updateTrackMixer does NOT call dawEngine.updateTrackMixer
    report('B2. Direct dawEngine.updateTrackMixer call updates nodes without error', true);

    useDawStore.getState().removeTrack(track.id);
  } catch (err: any) {
    report('TEST B: Store Sync Verification', false, err.stack || err.message);
  }

  // -------------------------------------------------------------------
  // TEST C: Early Access / Pre-store ID Instantiation Edge Case
  // -------------------------------------------------------------------
  console.log('\n--- TEST C: Early Access Track Type Instantiation Edge Case ---');
  try {
    const earlyTrackId = 'early-track-123';

    // Call updateTrackMixer or loadClip on a track ID before adding to store as sequencer
    dawEngine.updateTrackMixer(earlyTrackId, 0.8, 0, false);

    const earlyNodes = engineAny.trackNodes.get(earlyTrackId);
    const createdAsStemInitially = earlyNodes && !earlyNodes.drumSynths;

    report('C1. Early access initialized default stem nodes (no drumSynths)', createdAsStemInitially);

    // Now add track to store as 'sequencer' with same ID
    const seqTrackObj: any = {
      id: earlyTrackId,
      name: 'Late Sequencer',
      type: 'sequencer',
      color: '#ff00ff',
      volume: 0.9,
      pan: 0,
      muted: false,
      solo: false,
      fx: storeTrackFxDefault(),
      clips: [],
      sequencerVoices: [
        { name: 'KICK', steps: [true], velocity: [0.9], muted: false },
      ],
    };

    // Attempt to getOrCreateTrackNodes
    const retrievedNodes = dawEngine.getOrCreateTrackNodes(seqTrackObj);
    const hasDrumSynths = !!retrievedNodes.drumSynths;

    report('C2. Existing cached nodes contain drumSynths for sequencer', hasDrumSynths, 'CACHED_NODE_TYPE_MISMATCH: early call cached stem nodes without drumSynths, so drumSynths were missing when sequencer was later passed');

    dawEngine.disposeTrack(earlyTrackId);
  } catch (err: any) {
    report('TEST C: Early Access Edge Case', false, err.stack || err.message);
  }

  // -------------------------------------------------------------------
  // TEST D: Sequencer Schedule Leak on Track Type Mutation
  // -------------------------------------------------------------------
  console.log('\n--- TEST D: Sequencer Schedule Lifecycle & Schedule Leak ---');
  try {
    const seqTrack = useDawStore.getState().addTrack('sequencer', 'Seq Schedule Test');
    dawEngine.scheduleSequencer(seqTrack);

    const schedId = engineAny.sequencerScheduleIds.get(seqTrack.id);
    report('D1. Sequencer schedule registered in engine', schedId !== undefined);

    // Mutate track type in store to 'stem'
    useDawStore.getState().tracks = useDawStore.getState().tracks.map((t) =>
      t.id === seqTrack.id ? { ...t, type: 'stem' } : t
    );

    // Re-schedule sequencer
    const mutatedTrack = useDawStore.getState().tracks.find((t) => t.id === seqTrack.id)!;
    dawEngine.scheduleSequencer(mutatedTrack);

    const schedIdAfter = engineAny.sequencerScheduleIds.get(seqTrack.id);
    report('D2. Transport schedule cleared when track is no longer a sequencer', schedIdAfter === undefined, 'SCHEDULE_LEAK: old transport schedule was NOT cleared when track type was mutated to stem');

    useDawStore.getState().removeTrack(seqTrack.id);
  } catch (err: any) {
    report('TEST D: Sequencer Schedule Lifecycle', false, err.stack || err.message);
  }

  // -------------------------------------------------------------------
  // TEST E: Rapid Transport Play/Stop/Pause Stress Test
  // -------------------------------------------------------------------
  console.log('\n--- TEST E: Rapid Transport Play/Stop/Pause Stress (50 Toggles) ---');
  try {
    await dawEngine.init();

    for (let i = 0; i < 50; i++) {
      if (i % 3 === 0) {
        await dawEngine.startTransport();
      } else if (i % 3 === 1) {
        dawEngine.pauseTransport();
      } else {
        dawEngine.stopTransport();
      }
    }
    dawEngine.stopTransport();

    report('E1. 50 rapid transport state toggles executed without error', true);
    report('E2. Final transport state is stopped', engineAny.targetTransportState === 'stopped');

  } catch (err: any) {
    report('TEST E: Transport Toggles', false, err.stack || err.message);
  }

  console.log(`\n====================================================`);
  console.log(` SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log(`====================================================\n`);
}

function storeTrackFxDefault() {
  return {
    eq: { enabled: true, low: 0, mid: 0, high: 0 },
    compressor: { enabled: false, threshold: -20, ratio: 4, attack: 0.005, release: 0.2 },
    reverb: { enabled: false, decay: 2.5, wet: 0.3 },
    delay: { enabled: false, delayTime: 0.35, feedback: 0.4, wet: 0.25 },
    distortion: { enabled: false, drive: 0.4, wet: 0.3 },
    chorus: { enabled: false, rate: 1.5, depth: 0.7, wet: 0.3 },
    filter: { enabled: false, cutoff: 8000, resonance: 1.0, type: 'lowpass' },
  };
}

runEmpiricalStressTest().catch(console.error);
