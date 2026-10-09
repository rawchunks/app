export {};
import { useDawStore } from '../store';
import { dawEngine } from '../engine';

// Mock WebAudio for Node testing environment
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

const mockAudioCtx: any = {
  state: 'running',
  currentTime: 0,
  sampleRate: 44100,
  destination: new MockAudioNode(null),
  createGain: () => new MockGainNode(null),
  createBiquadFilter: () => new MockBiquadFilterNode(null),
  createDynamicsCompressor: () => new MockDynamicsCompressorNode(null),
  createStereoPanner: () => new MockStereoPannerNode(null),
  createDelay: () => new MockDelayNode(null),
  createOscillator: () => new MockOscillatorNode(null),
  resume: async () => {},
  suspend: async () => {},
};

(globalThis as any).AudioContext = function () { return mockAudioCtx; };
(globalThis as any).window = globalThis;
(globalThis as any).window.AudioContext = (globalThis as any).AudioContext;

async function runEmpiricalStressTest() {
  console.log('=== STARTING EMPIRICAL CHALLENGER STRESS TESTS ===');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`  [PASS] ${msg}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${msg}`);
      failed++;
    }
  }

  // 1. Initialize Store & DAW Track
  const store = useDawStore.getState();
  store.initProject('test-song', 'Test Song', 60, '');
  const seqTrack = store.addTrack('sequencer', 'Drum Sequencer');
  assert(seqTrack !== undefined, 'Added sequencer track successfully');

  // 2. Test Out-of-bounds toggleSequencerStep
  try {
    store.toggleSequencerStep(seqTrack.id, -1, 0);
    assert(true, 'toggleSequencerStep handles negative voiceIdx without crash');
  } catch (err: any) {
    assert(false, `toggleSequencerStep CRASHED on negative voiceIdx: ${err.message}`);
  }

  try {
    store.toggleSequencerStep(seqTrack.id, 999, 0);
    assert(true, 'toggleSequencerStep handles out-of-bounds voiceIdx (999) without crash');
  } catch (err: any) {
    assert(false, `toggleSequencerStep CRASHED on voiceIdx=999: ${err.message}`);
  }

  try {
    store.toggleSequencerStep(seqTrack.id, 0, -1);
    assert(true, 'toggleSequencerStep handles negative stepIdx without crash');
  } catch (err: any) {
    assert(false, `toggleSequencerStep CRASHED on negative stepIdx: ${err.message}`);
  }

  try {
    store.toggleSequencerStep(seqTrack.id, 0, 999);
    assert(true, 'toggleSequencerStep handles out-of-bounds stepIdx (999) without crash');
  } catch (err: any) {
    assert(false, `toggleSequencerStep CRASHED on stepIdx=999: ${err.message}`);
  }

  // 3. Test Out-of-bounds setSequencerVoiceVolume
  try {
    store.setSequencerVoiceVolume(seqTrack.id, -1, 0, 0.8);
    assert(true, 'setSequencerVoiceVolume handles negative voiceIdx without crash');
  } catch (err: any) {
    assert(false, `setSequencerVoiceVolume CRASHED on negative voiceIdx: ${err.message}`);
  }

  try {
    store.setSequencerVoiceVolume(seqTrack.id, 999, 0, 0.8);
    assert(true, 'setSequencerVoiceVolume handles out-of-bounds voiceIdx (999) without crash');
  } catch (err: any) {
    assert(false, `setSequencerVoiceVolume CRASHED on voiceIdx=999: ${err.message}`);
  }

  // 4. Test Empty Sequencer Voices
  const emptySeqTrack = store.addTrack('sequencer', 'Empty Sequencer');
  useDawStore.setState((state) => ({
    tracks: state.tracks.map((t) =>
      t.id === emptySeqTrack.id ? { ...t, sequencerVoices: [] } : t
    ),
  }));

  try {
    store.toggleSequencerStep(emptySeqTrack.id, 0, 0);
    assert(true, 'toggleSequencerStep handles empty sequencerVoices without crash');
  } catch (err: any) {
    assert(false, `toggleSequencerStep CRASHED on empty voices: ${err.message}`);
  }

  try {
    store.loadSequencerPreset(emptySeqTrack.id, 'house');
    assert(true, 'loadSequencerPreset handles empty sequencerVoices without crash');
  } catch (err: any) {
    assert(false, `loadSequencerPreset CRASHED on empty voices: ${err.message}`);
  }

  // 5. Test dawEngine triggerDrum edge cases
  try {
    dawEngine.triggerDrum('non-existent-track', 'kick', 0.8);
    assert(true, 'triggerDrum handles non-existent track without crash');
  } catch (err: any) {
    assert(false, `triggerDrum CRASHED on non-existent track: ${err.message}`);
  }

  try {
    dawEngine.triggerDrum(seqTrack.id, 'invalid_voice' as any, 0.8);
    assert(true, 'triggerDrum handles invalid voice name without crash');
  } catch (err: any) {
    assert(false, `triggerDrum CRASHED on invalid voice name: ${err.message}`);
  }

  try {
    dawEngine.triggerDrum(seqTrack.id, 'kick', -5);
    assert(true, 'triggerDrum handles negative velocity without crash');
  } catch (err: any) {
    assert(false, `triggerDrum CRASHED on negative velocity: ${err.message}`);
  }

  // 6. Test Valid Sequencer Operations
  store.toggleSequencerStep(seqTrack.id, 0, 0);
  const updatedTrack = useDawStore.getState().tracks.find((t) => t.id === seqTrack.id);
  assert(updatedTrack?.sequencerVoices?.[0]?.steps[0] !== undefined, 'Step state toggled cleanly');

  store.setSequencerVoiceVolume(seqTrack.id, 0, 0, 0.5);
  const updatedTrack2 = useDawStore.getState().tracks.find((t) => t.id === seqTrack.id);
  assert(updatedTrack2?.sequencerVoices?.[0]?.velocity[0] === 0.5, 'Step velocity updated cleanly to 0.5');

  console.log(`\n=== STRESS TEST RESULTS: ${passed} PASSED, ${failed} FAILED ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

runEmpiricalStressTest();
