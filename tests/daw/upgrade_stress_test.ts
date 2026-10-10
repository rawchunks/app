export {};

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
  constructor(context: any) { this.context = context; }
  connect(target: any) { return target; }
  disconnect() {}
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() { return true; }
  dispose() { this.disposed = true; }
}

class MockGainNode extends MockAudioNode { gain = new MockAudioParam(); }
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
class MockStereoPannerNode extends MockAudioNode { pan = new MockAudioParam(); }
class MockDelayNode extends MockAudioNode { delayTime = new MockAudioParam(); }
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
class MockConvolverNode extends MockAudioNode { buffer = null; normalize = true; }
class MockWaveShaperNode extends MockAudioNode {
  private _curve: Float32Array | null = null;
  get curve() { return this._curve; }
  set curve(val: any) { this._curve = val; }
  oversample = 'none';
}
class MockIIRFilterNode extends MockAudioNode {}
class MockConstantSourceNode extends MockAudioNode { offset = new MockAudioParam(); start() {}; stop() {} }
class MockChannelSplitterNode extends MockAudioNode { constructor(context: any, n = 6) { super(context); this.numberOfOutputs = n; } }
class MockChannelMergerNode extends MockAudioNode { constructor(context: any, n = 6) { super(context); this.numberOfInputs = n; } }
class MockPeriodicWave {}
class MockScriptProcessorNode extends MockAudioNode { bufferSize = 256; onaudioprocess = null; }

class MockAudioContext {
  state = 'suspended';
  currentTime = 0;
  sampleRate = 44100;
  destination = new MockAudioNode(this);
  listener = {
    positionX: new MockAudioParam(), positionY: new MockAudioParam(), positionZ: new MockAudioParam(),
    forwardX: new MockAudioParam(), forwardY: new MockAudioParam(), forwardZ: new MockAudioParam(),
    upX: new MockAudioParam(), upY: new MockAudioParam(), upZ: new MockAudioParam(),
  };
  createGain() { return new MockGainNode(this); }
  createBufferSource() { return new MockAudioBufferSourceNode(this); }
  createBiquadFilter() { return new MockBiquadFilterNode(this); }
  createDynamicsCompressor() { return new MockDynamicsCompressorNode(this); }
  createChannelMerger(n = 6) { return new MockChannelMergerNode(this, n); }
  createChannelSplitter(n = 6) { return new MockChannelSplitterNode(this, n); }
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
  createBuffer(c: number, l: number, s: number) {
    return {
      numberOfChannels: c, length: l, sampleRate: s, duration: l / s,
      getChannelData: () => new Float32Array(l), copyFromChannel: () => {}, copyToChannel: () => {},
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
    if (this.listeners[type]) this.listeners[type] = this.listeners[type].filter(f => f !== fn);
  }
  dispatchEvent() { return true; }
  resume() { this.state = 'running'; return Promise.resolve(); }
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

async function runUpgradeStressTests() {
  console.log('===========================================================');
  console.log('   EMPIRICAL STRESS TEST: TRACK NODE UPGRADE VERIFICATION  ');
  console.log('===========================================================\n');

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
  // TEST 1: Stem -> Late Upgrade to Pianoroll
  // -------------------------------------------------------------------
  console.log('--- TEST 1: Stem -> Late Upgrade to Pianoroll ---');
  try {
    const track = useDawStore.getState().addTrack('stem', 'Stem to Pianoroll');
    const nodes = dawEngine.getOrCreateTrackNodes(track.id);

    report('1a. Initial stem track nodes created without synths', !nodes.polySynth && !nodes.drumSynths);

    // Update track type to pianoroll in store
    useDawStore.getState().tracks = useDawStore.getState().tracks.map((t) =>
      t.id === track.id ? { ...t, type: 'pianoroll' } : t
    );

    // Trigger note on upgraded track
    dawEngine.triggerNote(track.id, 'C4');

    const upgradedNodes = engineAny.trackNodes.get(track.id);
    report('1b. polySynth lazily instantiated on triggerNote', Boolean(upgradedNodes?.polySynth));
    report('1c. drumSynths remains undefined for pianoroll', upgradedNodes?.drumSynths === undefined);

    useDawStore.getState().removeTrack(track.id);
  } catch (err: any) {
    report('TEST 1: Stem -> Pianoroll Upgrade', false, err.stack || err.message);
  }

  // -------------------------------------------------------------------
  // TEST 2: Stem -> Late Upgrade to Sequencer
  // -------------------------------------------------------------------
  console.log('\n--- TEST 2: Stem -> Late Upgrade to Sequencer ---');
  try {
    const track = useDawStore.getState().addTrack('stem', 'Stem to Sequencer');
    const nodes = dawEngine.getOrCreateTrackNodes(track.id);

    report('2a. Initial stem track nodes created without synths', !nodes.polySynth && !nodes.drumSynths);

    // Update track type to sequencer in store
    useDawStore.getState().tracks = useDawStore.getState().tracks.map((t) =>
      t.id === track.id ? { ...t, type: 'sequencer', sequencerVoices: [] } : t
    );

    // Trigger drum on upgraded track
    dawEngine.triggerDrum(track.id, 'kick');

    const upgradedNodes = engineAny.trackNodes.get(track.id);
    report('2b. drumSynths lazily instantiated on triggerDrum', Boolean(upgradedNodes?.drumSynths));
    report('2c. All 4 drum voices (kick, snare, hihat, perc) present',
      Boolean(upgradedNodes?.drumSynths?.kick && upgradedNodes?.drumSynths?.snare && upgradedNodes?.drumSynths?.hihat && upgradedNodes?.drumSynths?.perc)
    );

    useDawStore.getState().removeTrack(track.id);
  } catch (err: any) {
    report('TEST 2: Stem -> Sequencer Upgrade', false, err.stack || err.message);
  }

  // -------------------------------------------------------------------
  // TEST 3: Stem -> Late Upgrade to Strudel
  // -------------------------------------------------------------------
  console.log('\n--- TEST 3: Stem -> Late Upgrade to Strudel ---');
  try {
    const track = useDawStore.getState().addTrack('stem', 'Stem to Strudel');
    dawEngine.getOrCreateTrackNodes(track.id);

    // Update track type to strudel in store
    useDawStore.getState().tracks = useDawStore.getState().tracks.map((t) =>
      t.id === track.id ? { ...t, type: 'strudel' } : t
    );

    // Call scheduleStrudel
    dawEngine.scheduleStrudel(track.id, 's("bd sd hh")');

    const upgradedNodes = engineAny.trackNodes.get(track.id);
    report('3a. Both polySynth and drumSynths instantiated for Strudel',
      Boolean(upgradedNodes?.polySynth) && Boolean(upgradedNodes?.drumSynths)
    );

    useDawStore.getState().removeTrack(track.id);
  } catch (err: any) {
    report('TEST 3: Stem -> Strudel Upgrade', false, err.stack || err.message);
  }

  // -------------------------------------------------------------------
  // TEST 4: Multi-Stage Type Transitions (Stem -> Pianoroll -> Strudel -> Sequencer)
  // -------------------------------------------------------------------
  console.log('\n--- TEST 4: Multi-Stage Type Transitions ---');
  try {
    const track = useDawStore.getState().addTrack('stem', 'Multi Stage Track');
    const tId = track.id;

    // Stage 1: Stem
    dawEngine.getOrCreateTrackNodes(tId);
    let n = engineAny.trackNodes.get(tId);
    report('4a. Stage 1 (Stem): no synths', !n.polySynth && !n.drumSynths);

    // Stage 2: Change to Pianoroll
    useDawStore.getState().tracks = useDawStore.getState().tracks.map((t) => t.id === tId ? { ...t, type: 'pianoroll' } : t);
    dawEngine.getOrCreateTrackNodes(tId);
    n = engineAny.trackNodes.get(tId);
    report('4b. Stage 2 (Pianoroll): polySynth added, drumSynths null', Boolean(n.polySynth) && !n.drumSynths);

    // Stage 3: Change to Strudel
    useDawStore.getState().tracks = useDawStore.getState().tracks.map((t) => t.id === tId ? { ...t, type: 'strudel' } : t);
    dawEngine.getOrCreateTrackNodes(tId);
    n = engineAny.trackNodes.get(tId);
    report('4c. Stage 3 (Strudel): drumSynths added alongside existing polySynth', Boolean(n.polySynth) && Boolean(n.drumSynths));

    // Stage 4: Change to Sequencer
    useDawStore.getState().tracks = useDawStore.getState().tracks.map((t) => t.id === tId ? { ...t, type: 'sequencer' } : t);
    dawEngine.getOrCreateTrackNodes(tId);
    n = engineAny.trackNodes.get(tId);
    report('4d. Stage 4 (Sequencer): retain synths, no crash', Boolean(n.polySynth) && Boolean(n.drumSynths));

    useDawStore.getState().removeTrack(tId);
  } catch (err: any) {
    report('TEST 4: Multi-Stage Transitions', false, err.stack || err.message);
  }

  // -------------------------------------------------------------------
  // TEST 5: Unregistered Track ID Upgrading (Early Access before Store)
  // -------------------------------------------------------------------
  console.log('\n--- TEST 5: Unregistered Track ID Early Access Upgrading ---');
  try {
    const earlyId = 'unregistered-track-99';

    // Access before store addition
    dawEngine.getOrCreateTrackNodes(earlyId);
    let n = engineAny.trackNodes.get(earlyId);
    report('5a. Early access created default nodes without synths', Boolean(n) && !n.polySynth && !n.drumSynths);

    // Add track to store with type = 'pianoroll'
    const newTrack: any = {
      id: earlyId,
      name: 'Late Pianoroll',
      type: 'pianoroll',
      color: '#ff00ff',
      volume: 0.9,
      pan: 0,
      muted: false,
      solo: false,
      fx: storeTrackFxDefault(),
      clips: [],
    };
    useDawStore.getState().tracks.push(newTrack);

    // Now call getOrCreateTrackNodes with track object or ID
    dawEngine.getOrCreateTrackNodes(earlyId);
    n = engineAny.trackNodes.get(earlyId);
    report('5b. Upgraded early nodes to polySynth upon store track match', Boolean(n?.polySynth));

    useDawStore.getState().removeTrack(earlyId);
  } catch (err: any) {
    report('TEST 5: Unregistered Track Early Access', false, err.stack || err.message);
  }

  // -------------------------------------------------------------------
  // TEST 6: Idempotency & Concurrent Calls (500 Iterations)
  // -------------------------------------------------------------------
  console.log('\n--- TEST 6: Idempotency & Concurrent Calls (500 Iterations) ---');
  try {
    const track = useDawStore.getState().addTrack('stem', 'Idempotency Track');
    useDawStore.getState().tracks = useDawStore.getState().tracks.map((t) =>
      t.id === track.id ? { ...t, type: 'pianoroll' } : t
    );

    const firstNode = dawEngine.getOrCreateTrackNodes(track.id);
    const synthRef1 = firstNode.polySynth;

    for (let i = 0; i < 500; i++) {
      const node = dawEngine.getOrCreateTrackNodes(track.id);
      if (node.polySynth !== synthRef1) {
        throw new Error(`PolySynth instance recreated on iteration ${i}!`);
      }
    }

    report('6a. 500 calls to getOrCreateTrackNodes preserved exact same polySynth singleton reference', true);

    useDawStore.getState().removeTrack(track.id);
  } catch (err: any) {
    report('TEST 6: Idempotency & Concurrent Calls', false, err.stack || err.message);
  }

  // -------------------------------------------------------------------
  // TEST 7: Disposal of Upgraded Tracks
  // -------------------------------------------------------------------
  console.log('\n--- TEST 7: Disposal of Upgraded Tracks (50 Tracks) ---');
  try {
    const createdIds: string[] = [];
    for (let i = 0; i < 50; i++) {
      const tr = useDawStore.getState().addTrack('stem', `Disposable ${i}`);
      createdIds.push(tr.id);
      dawEngine.getOrCreateTrackNodes(tr.id);
      // Upgrade
      useDawStore.getState().tracks = useDawStore.getState().tracks.map((t) =>
        t.id === tr.id ? { ...t, type: 'strudel' } : t
      );
      dawEngine.getOrCreateTrackNodes(tr.id);
    }

    report('7a. 50 tracks created and upgraded to Strudel', engineAny.trackNodes.size >= 50);

    for (const id of createdIds) {
      useDawStore.getState().removeTrack(id);
    }

    report('7b. All 50 upgraded tracks disposed cleanly, trackNodes size reduced', engineAny.trackNodes.size === 0);

  } catch (err: any) {
    report('TEST 7: Disposal of Upgraded Tracks', false, err.stack || err.message);
  }

  console.log(`\n===========================================================`);
  console.log(` SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log(`===========================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
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

runUpgradeStressTests().catch(console.error);
