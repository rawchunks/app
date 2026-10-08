export {};
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
}

class MockAudioNode {
  context: any;
  numberOfInputs = 1;
  numberOfOutputs = 1;
  channelCount = 2;
  channelCountMode = 'max';
  channelInterpretation = 'speakers';
  constructor(context: any) { this.context = context; }
  connect(target: any) { return target; }
  disconnect() {}
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() { return true; }
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
  decodeAudioData(buffer: any, success: any) {
    void buffer;
    const mockBuf = this.createBuffer(2, 44100, 44100);
    if (success) success(mockBuf);
    return Promise.resolve(mockBuf);
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
    const evt = { type: 'statechange', target: this };
    setTimeout(() => {
      if (this.listeners['statechange']) {
        this.listeners['statechange'].forEach(fn => fn(evt));
      }
      if ((this as any).onstatechange) {
        (this as any).onstatechange(evt);
      }
    }, 0);
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

async function runChallengeTests() {
  console.log('=== STARTING EMPIRICAL CHALLENGE TESTS ===\n');

  const Tone = await import('tone');
  Tone.setContext(new Tone.Context());

  const { dawEngine } = await import('../engine');
  const { useDawStore } = await import('../store');

  let testPassedCount = 0;
  let testFailedCount = 0;

  function assert(condition: boolean, message: string) {
    if (condition) {
      console.log(`  [PASS] ${message}`);
      testPassedCount++;
    } else {
      console.error(`  [FAIL] ${message}`);
      testFailedCount++;
    }
  }

  // -------------------------------------------------------------
  // TEST 1: Master bus routing for pre/post-init tracks
  // -------------------------------------------------------------
  console.log('--- Test 1: Master Bus Routing (Pre & Post-Init) ---');
  try {
    const engineAny = dawEngine as any;
    
    assert(!engineAny.isInitialized, 'Engine is not initialized initially');
    assert(engineAny.masterCompressor === null, 'masterCompressor is null before track creation');

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

    const _preNodes = dawEngine.getOrCreateTrackNodes(preTrack);
    assert(_preNodes !== null, 'preNodes created successfully');

    assert(engineAny.masterCompressor !== null, 'masterCompressor lazily created via ensureMasterBus() before init()');
    assert(engineAny.masterLimiter !== null, 'masterLimiter lazily created before init()');
    
    const masterCompressorRef = engineAny.masterCompressor;

    console.log('Calling dawEngine.init()...');
    await dawEngine.init();
    console.log('dawEngine.init() completed!');
    assert(engineAny.isInitialized, 'Engine initialized after init()');

    const postTrack: any = {
      id: 'test-post-track',
      name: 'Post-Init Track',
      type: 'stem',
      color: '#00ff00',
      volume: 0.8,
      pan: 0,
      muted: false,
      solo: false,
      fx: preTrack.fx,
      clips: [],
    };

    const _postNodes = dawEngine.getOrCreateTrackNodes(postTrack);
    assert(_postNodes !== null, 'postNodes created successfully');
    assert(engineAny.masterCompressor === masterCompressorRef, 'Post-init track routes to exact same masterCompressor instance as pre-init track');

    dawEngine.disposeTrack('test-pre-track');
    dawEngine.disposeTrack('test-post-track');
  } catch (err) {
    console.error('Test 1 error:', err);
    assert(false, `Test 1 threw error: ${err}`);
  }

  // -------------------------------------------------------------
  // TEST 2: Multi-sequencer concurrent playback without schedule overwrite
  // -------------------------------------------------------------
  console.log('\n--- Test 2: Multi-Sequencer Concurrent Playback ---');
  try {
    const engineAny = dawEngine as any;

    const seqTrack1: any = {
      id: 'seq-track-1',
      name: 'Sequencer 1',
      type: 'sequencer',
      color: '#0000ff',
      volume: 0.9,
      pan: -0.5,
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
      sequencerVoices: [
        { name: 'KICK', steps: [true, false, false, false], velocity: [1, 0, 0, 0], muted: false },
        { name: 'SNARE', steps: [false, false, true, false], velocity: [0, 0, 1, 0], muted: false },
      ],
    };

    const seqTrack2: any = {
      id: 'seq-track-2',
      name: 'Sequencer 2',
      type: 'sequencer',
      color: '#00ffff',
      volume: 0.9,
      pan: 0.5,
      muted: false,
      solo: false,
      fx: seqTrack1.fx,
      clips: [],
      sequencerVoices: [
        { name: 'KICK', steps: [true, true, false, false], velocity: [1, 1, 0, 0], muted: false },
        { name: 'SNARE', steps: [false, false, true, true], velocity: [0, 0, 1, 1], muted: false },
      ],
    };

    dawEngine.scheduleSequencer(seqTrack1);
    const sched1 = engineAny.sequencerScheduleIds.get('seq-track-1');
    assert(sched1 !== undefined, 'Sequencer track 1 scheduled successfully');

    dawEngine.scheduleSequencer(seqTrack2);
    const sched2 = engineAny.sequencerScheduleIds.get('seq-track-2');
    assert(sched2 !== undefined, 'Sequencer track 2 scheduled successfully');
    assert(sched1 !== sched2, 'Sequencer 1 and 2 have distinct schedule IDs');
    assert(engineAny.sequencerScheduleIds.has('seq-track-1'), 'Sequencer 1 schedule ID was NOT overwritten when Sequencer 2 was scheduled');

    // Update seqTrack1 pattern
    dawEngine.scheduleSequencer(seqTrack1);
    const newSched1 = engineAny.sequencerScheduleIds.get('seq-track-1');
    assert(newSched1 !== undefined && newSched1 !== sched1, 'Sequencer 1 schedule updated to new schedule ID');
    assert(engineAny.sequencerScheduleIds.get('seq-track-2') === sched2, 'Sequencer 2 schedule ID remained unchanged when Sequencer 1 was re-scheduled');

    // Dispose seqTrack1
    dawEngine.disposeTrack('seq-track-1');
    assert(!engineAny.sequencerScheduleIds.has('seq-track-1'), 'Sequencer 1 schedule ID cleared upon disposeTrack');
    assert(engineAny.sequencerScheduleIds.get('seq-track-2') === sched2, 'Sequencer 2 schedule ID intact after Sequencer 1 disposed');

    // Clean up
    dawEngine.disposeTrack('seq-track-2');
    assert(!engineAny.sequencerScheduleIds.has('seq-track-2'), 'Sequencer 2 schedule ID cleared upon disposeTrack');
  } catch (err) {
    console.error('Test 2 error:', err);
    assert(false, `Test 2 threw error: ${err}`);
  }

  // -------------------------------------------------------------
  // TEST 3: Transport start/stop race condition safety
  // -------------------------------------------------------------
  console.log('\n--- Test 3: Transport Start/Stop Race Condition Safety ---');
  try {
    const engineAny = dawEngine as any;

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
    const origTransportStart = Tone.getTransport().start.bind(Tone.getTransport());
    Tone.getTransport().start = (() => { startCalled = true; return Tone.getTransport(); }) as any;

    const startPromise = dawEngine.startTransport();
    assert(engineAny.targetTransportState === 'started', 'targetTransportState set to started immediately on startTransport call');

    dawEngine.stopTransport();
    assert(engineAny.targetTransportState === 'stopped', 'targetTransportState updated to stopped immediately on stopTransport call');

    resolveInitPromise();
    await startPromise;

    assert(!startCalled, 'Tone.getTransport().start() was NOT called because targetTransportState was stopped');

    // Test pauseTransport during pending startTransport
    engineAny.isInitialized = false;
    let resolveInitPromise2: () => void = () => {};
    const initSlowPromise2 = new Promise<void>((resolve) => {
      resolveInitPromise2 = resolve;
    });
    dawEngine.init = async () => {
      await initSlowPromise2;
      engineAny.isInitialized = true;
    };

    startCalled = false;
    const startPromise2 = dawEngine.startTransport();
    dawEngine.pauseTransport();
    assert(engineAny.targetTransportState === 'paused', 'targetTransportState updated to paused on pauseTransport call');

    resolveInitPromise2();
    await startPromise2;
    assert(!startCalled, 'Tone.getTransport().start() was NOT called because targetTransportState was paused');

    // Restore originals
    Tone.getTransport().start = origTransportStart;
    dawEngine.init = originalInit;
    engineAny.isInitialized = true;
  } catch (err) {
    console.error('Test 3 error:', err);
    assert(false, `Test 3 threw error: ${err}`);
  }

  // -------------------------------------------------------------
  // TEST 4: removeTrack properly disposes track synths & audio nodes
  // -------------------------------------------------------------
  console.log('\n--- Test 4: removeTrack Resource Disposal ---');
  try {
    const engineAny = dawEngine as any;

    const newSeqTrack = useDawStore.getState().addTrack('sequencer', 'Test Seq Track');
    dawEngine.getOrCreateTrackNodes(newSeqTrack);
    dawEngine.scheduleSequencer(newSeqTrack);

    const trackNodesBefore = engineAny.trackNodes.get(newSeqTrack.id);
    assert(trackNodesBefore !== undefined, 'Track nodes created and registered in dawEngine');
    assert(engineAny.sequencerScheduleIds.has(newSeqTrack.id), 'Sequencer schedule registered in dawEngine');

    const kickSynth = trackNodesBefore.drumSynths?.kick;
    const inputNode = trackNodesBefore.input;

    assert(kickSynth && !kickSynth.disposed, 'Kick synth active and not disposed before removeTrack');
    assert(inputNode && !inputNode.disposed, 'Input node active and not disposed before removeTrack');

    useDawStore.getState().removeTrack(newSeqTrack.id);

    const trackInStore = useDawStore.getState().tracks.find((t: any) => t.id === newSeqTrack.id);
    assert(trackInStore === undefined, 'Track removed from useDawStore state');

    assert(!engineAny.trackNodes.has(newSeqTrack.id), 'Track nodes removed from dawEngine.trackNodes map');
    assert(!engineAny.sequencerScheduleIds.has(newSeqTrack.id), 'Sequencer schedule removed from dawEngine.sequencerScheduleIds map');

    assert(kickSynth?.disposed === true, 'Kick synth was disposed via dawEngine.disposeTrack');
    assert(inputNode?.disposed === true, 'Input node was disposed via dawEngine.disposeTrack');

    const newPianoTrack = useDawStore.getState().addTrack('pianoroll', 'Test Piano Track');
    dawEngine.getOrCreateTrackNodes(newPianoTrack);
    const pianoNodes = engineAny.trackNodes.get(newPianoTrack.id);
    const polySynth = pianoNodes?.polySynth;

    assert(polySynth && !polySynth.disposed, 'polySynth active before removeTrack');
    useDawStore.getState().removeTrack(newPianoTrack.id);
    assert(polySynth?.disposed === true, 'polySynth disposed after removeTrack');

    const masterTrackBefore = useDawStore.getState().tracks.find((t: any) => t.id === 'master');
    if (masterTrackBefore) {
      useDawStore.getState().removeTrack('master');
      const masterTrackAfter = useDawStore.getState().tracks.find((t: any) => t.id === 'master');
      assert(masterTrackAfter !== undefined, 'Master track cannot be removed by removeTrack');
    }

  } catch (err) {
    console.error('Test 4 error:', err);
    assert(false, `Test 4 threw error: ${err}`);
  }

  console.log(`\n=== TEST SUMMARY: ${testPassedCount} PASSED, ${testFailedCount} FAILED ===`);
  if (testFailedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runChallengeTests();
