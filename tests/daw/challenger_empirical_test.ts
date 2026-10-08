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
  state = 'running';
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
      this.listeners[type] = this.listeners[type].filter((f) => f !== fn);
    }
  }
  dispatchEvent() { return true; }
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
  suspend() {
    this.state = 'suspended';
    return Promise.resolve();
  }
  close() {
    this.state = 'closed';
    return Promise.resolve();
  }
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

async function runChallengerEmpiricalTests() {
  console.log('=== STARTING CHALLENGER EMPIRICAL STRESS & VALIDATION TESTS ===\n');

  const Tone = await import('tone');
  Tone.setContext(new Tone.Context());

  const { dawEngine } = await import('../engine');
  const { useDawStore } = await import('../store');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`  [PASS] ${msg}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${msg}`);
      failed++;
    }
  }

  // Reset store
  useDawStore.setState({
    tracks: [],
    selectedTrackId: 'master',
    isPlaying: false,
    tempo: 120,
  });

  // --- SECTION 1: Solo Logic & Multi-Track Isolation ---
  console.log('--- SECTION 1: Solo Logic & Multi-Track Isolation ---');

  const t1 = useDawStore.getState().addTrack('Track 1', 'stem');
  const t2 = useDawStore.getState().addTrack('Track 2', 'stem');
  const t3 = useDawStore.getState().addTrack('Track 3', 'stem');

  // Initially none soloed, none muted
  const nodes1 = dawEngine.getOrCreateTrackNodes(t1.id);
  const nodes2 = dawEngine.getOrCreateTrackNodes(t2.id);
  const nodes3 = dawEngine.getOrCreateTrackNodes(t3.id);

  assert(nodes1.volume.mute === false, 'T1 volume.mute initially false');
  assert(nodes2.volume.mute === false, 'T2 volume.mute initially false');
  assert(nodes3.volume.mute === false, 'T3 volume.mute initially false');

  // Explicitly mute T3 in store
  useDawStore.getState().updateTrackMixer(t3.id, { muted: true });
  assert(nodes3.volume.mute === true, 'T3 volume.mute true after updateTrackMixer muted:true');

  // Solo T1
  useDawStore.getState().updateTrackMixer(t1.id, { solo: true });
  assert(nodes1.volume.mute === false, 'T1 (soloed) volume.mute remains false');
  assert(nodes2.volume.mute === true, 'T2 (non-soloed) volume.mute muted due to T1 solo');
  assert(nodes3.volume.mute === true, 'T3 (non-soloed & muted) volume.mute muted due to T1 solo');

  // Solo T2 as well (Multi-Solo)
  useDawStore.getState().updateTrackMixer(t2.id, { solo: true });
  assert(nodes1.volume.mute === false, 'T1 (soloed) volume.mute remains false during multi-solo');
  assert(nodes2.volume.mute === false, 'T2 (soloed) volume.mute becomes false during multi-solo');
  assert(nodes3.volume.mute === true, 'T3 (non-soloed) volume.mute remains true during multi-solo');

  // Un-solo T1
  useDawStore.getState().updateTrackMixer(t1.id, { solo: false });
  assert(nodes1.volume.mute === true, 'T1 (un-soloed) volume.mute becomes true while T2 remains soloed');
  assert(nodes2.volume.mute === false, 'T2 (soloed) volume.mute remains false');
  assert(nodes3.volume.mute === true, 'T3 (non-soloed) volume.mute remains true');

  // Un-solo T2 (No solos active)
  useDawStore.getState().updateTrackMixer(t2.id, { solo: false });
  assert(nodes1.volume.mute === false, 'T1 volume.mute restored to false (unmuted state)');
  assert(nodes2.volume.mute === false, 'T2 volume.mute restored to false (unmuted state)');
  assert(nodes3.volume.mute === true, 'T3 volume.mute restored to true (its original muted state)');

  // Solo a muted track (T3 is muted and soloed)
  useDawStore.getState().updateTrackMixer(t3.id, { solo: true });
  assert(nodes3.volume.mute === true, 'T3 (soloed AND muted) volume.mute is true because it is explicitly muted');
  assert(nodes1.volume.mute === true, 'T1 volume.mute is true because T3 is soloed');
  assert(nodes2.volume.mute === true, 'T2 volume.mute is true because T3 is soloed');

  // Clear solo on T3, unmute T3
  useDawStore.getState().updateTrackMixer(t3.id, { solo: false, muted: false });
  assert(nodes1.volume.mute === false, 'T1 volume.mute false after clearing all solos');
  assert(nodes2.volume.mute === false, 'T2 volume.mute false after clearing all solos');
  assert(nodes3.volume.mute === false, 'T3 volume.mute false after clearing all solos and unmuting');


  // --- SECTION 2: Store Mixer and FX Updates Propagation ---
  console.log('\n--- SECTION 2: Store Mixer and FX Updates Propagation ---');

  useDawStore.getState().updateTrackMixer(t1.id, { volume: 0.5, pan: -0.75, muted: false });
  const storeTrack1 = useDawStore.getState().tracks.find((t) => t.id === t1.id);
  assert(storeTrack1?.mixer.volume === 0.5, 'Store T1 volume updated to 0.5');
  assert(storeTrack1?.mixer.pan === -0.75, 'Store T1 pan updated to -0.75');

  // Update FX via store
  useDawStore.getState().updateTrackFx(t1.id, 'eq', { low: 6, mid: -3, high: 2 });
  const storeTrack1Fx = useDawStore.getState().tracks.find((t) => t.id === t1.id)?.fx;
  assert(storeTrack1Fx?.eq.low === 6, 'Store T1 EQ low updated to 6');
  assert(storeTrack1Fx?.eq.mid === -3, 'Store T1 EQ mid updated to -3');

  // Update full FX config via store
  useDawStore.getState().updateTrackFx(t2.id, {
    eq: { enabled: true, low: 2, mid: 1, high: -1 },
    compressor: { enabled: true, threshold: -15, ratio: 3, attack: 0.01, release: 0.1 },
    reverb: { enabled: true, decay: 3.0, wet: 0.5 },
    delay: { enabled: false, delayTime: 0.2, feedback: 0.3, wet: 0.1 },
    distortion: { enabled: false, drive: 0.1, wet: 0.1 },
    chorus: { enabled: false, rate: 1.0, depth: 0.5, wet: 0.2 },
    filter: { enabled: true, cutoff: 5000, resonance: 2.0, type: 'highpass' },
  });
  const storeTrack2Fx = useDawStore.getState().tracks.find((t) => t.id === t2.id)?.fx;
  assert(storeTrack2Fx?.filter.cutoff === 5000, 'Store T2 FX filter cutoff updated to 5000');
  assert(storeTrack2Fx?.reverb.wet === 0.5, 'Store T2 FX reverb wet updated to 0.5');


  // --- SECTION 3: Dynamic Audio Node Upgrade Test ---
  console.log('\n--- SECTION 3: Dynamic Audio Node Upgrade Test ---');

  const dynTrack = useDawStore.getState().addTrack('Dynamic Type Track', 'stem');
  const dynNodesInitial = dawEngine.getOrCreateTrackNodes(dynTrack.id);
  assert(dynNodesInitial.polySynth === undefined, 'Initial stem track has no polySynth');
  assert(dynNodesInitial.drumSynths === undefined, 'Initial stem track has no drumSynths');

  // Mutate track type in store to 'sequencer'
  useDawStore.setState((state) => ({
    tracks: state.tracks.map((t) => (t.id === dynTrack.id ? { ...t, type: 'sequencer' as const } : t)),
  }));

  // Trigger drum voice -> should dynamically upgrade nodes without error
  let drumError: any = null;
  try {
    dawEngine.triggerDrum(dynTrack.id, 'kick');
  } catch (err) {
    drumError = err;
  }
  assert(drumError === null, 'triggerDrum executed without error after track type changed to sequencer');
  const upgradedNodes = dawEngine.getOrCreateTrackNodes(dynTrack.id);
  assert(upgradedNodes.drumSynths !== undefined, 'upgradedNodes contains drumSynths');

  // Mutate track type in store to 'pianoroll'
  useDawStore.setState((state) => ({
    tracks: state.tracks.map((t) => (t.id === dynTrack.id ? { ...t, type: 'pianoroll' as const } : t)),
  }));

  let noteError: any = null;
  try {
    dawEngine.triggerNote(dynTrack.id, 'C4');
  } catch (err) {
    noteError = err;
  }
  assert(noteError === null, 'triggerNote executed without error after track type changed to pianoroll');
  assert(upgradedNodes.polySynth !== undefined, 'upgradedNodes contains polySynth');


  // --- SECTION 4: 100 Rapid Mixer & Solo Stress Operations ---
  console.log('\n--- SECTION 4: 100 Rapid Mixer & Solo Stress Operations ---');

  let stressErrors = 0;
  const trackIds = [t1.id, t2.id, t3.id, dynTrack.id];

  for (let i = 0; i < 100; i++) {
    try {
      const targetId = trackIds[i % trackIds.length];
      const randomVol = Math.random();
      const randomPan = (Math.random() - 0.5) * 2;
      const randomMute = Math.random() > 0.7;
      const randomSolo = Math.random() > 0.8;

      useDawStore.getState().updateTrackMixer(targetId, {
        volume: randomVol,
        pan: randomPan,
        muted: randomMute,
        solo: randomSolo,
      });
    } catch (err) {
      console.error(`Error at stress iteration ${i}:`, err);
      stressErrors++;
    }
  }

  assert(stressErrors === 0, '100 rapid random updateTrackMixer calls completed with 0 errors');

  // Check state consistency
  const finalTracks = useDawStore.getState().tracks;
  const hasSoloFinal = finalTracks.some((t) => t.mixer?.solo || t.solo);

  for (const track of finalTracks) {
    const nodes = dawEngine.getOrCreateTrackNodes(track.id);
    const isMuted = track.mixer?.muted ?? track.muted;
    const isSoloed = track.mixer?.solo ?? track.solo;

    let expectedMuteInTone = isMuted;
    if (hasSoloFinal) {
      expectedMuteInTone = isSoloed ? isMuted : true;
    }

    assert(
      nodes.volume.mute === expectedMuteInTone,
      `Track ${track.name} (${track.id}) audio node mute (${nodes.volume.mute}) matches store solo/mute calculation (${expectedMuteInTone})`
    );
  }


  // --- SECTION 5: Track Removal and Node Disposal Verification ---
  console.log('\n--- SECTION 5: Track Removal and Node Disposal Verification ---');

  const removeId = dynTrack.id;
  useDawStore.getState().removeTrack(removeId);

  const trackInStoreAfterRemove = useDawStore.getState().tracks.find((t) => t.id === removeId);
  assert(trackInStoreAfterRemove === undefined, 'Removed track no longer exists in Zustand store');

  // Ensure nodes map in dawEngine does not hold stale reference
  const hasNodeRef = (dawEngine as any).trackNodes.has(removeId);
  assert(hasNodeRef === false, 'dawEngine trackNodes map cleared removed track reference');


  console.log(`\n====================================================`);
  console.log(` FINAL RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log(`====================================================`);

  if (failed > 0) {
    process.exit(1);
  }
}

runChallengerEmpiricalTests().catch((err) => {
  console.error('Fatal error during challenger tests:', err);
  process.exit(1);
});
