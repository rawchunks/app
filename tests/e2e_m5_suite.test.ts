/**
 * RawChunks AI-Native Studio — Milestone M5 E2E & Adversarial Hardening Test Suite
 * Fully functional test suite covering Features 1-11 across Tiers 1-5 (Unit, Boundary, Pairwise, Workload, Adversarial)
 */

import { useDawStore } from '../src/lib/daw/store';
import { parseStrudelPattern, evaluateStrudelPattern } from '../src/lib/daw/strudelEvaluator';
import { extractPeaksFromUrl } from '../src/lib/daw/peaks';

async function runE2ESuite() {
  console.log('=== STARTING MILESTONE M5 COMPREHENSIVE E2E & ADVERSARIAL TEST SUITE ===\n');
  let passCount = 0;
  let failCount = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      passCount++;
      console.log(`[PASS] ${testName}`);
    } else {
      failCount++;
      console.error(`[FAIL] ${testName}`);
    }
  }

  // =========================================================================
  // TIER 1: CORE FEATURE INVENTORY UNIT TESTS (Features 1 - 11)
  // =========================================================================
  console.log('--- Tier 1: Feature Inventory Unit Tests (Features 1 - 11) ---');

  // Feature 1 & 2: Store & Project Initialization
  const store = useDawStore.getState();
  store.initProject('song-m5-001', 'Hyperborea Protocol', 60, 'http://localhost/audio/main.wav');
  assert(useDawStore.getState().songId === 'song-m5-001', 'F1.1: Store initializes correct songId');
  assert(useDawStore.getState().songTitle === 'Hyperborea Protocol', 'F1.2: Store initializes songTitle');
  assert(useDawStore.getState().duration === 60, 'F1.3: Store initializes duration');
  assert(useDawStore.getState().tracks.length === 1, 'F1.4: Initial state creates master track');
  assert(useDawStore.getState().tracks[0].id === 'master', 'F1.5: Master track ID is "master"');
  assert(useDawStore.getState().legoContextTrackIds.includes('master'), 'F1.6: Master track automatically included in LEGO context');

  // Feature 3: Multi-Track Workstation Management
  const stem = store.addTrack('stem', 'Vocal Stems');
  const sample = store.addTrack('sample', 'Synth Loop');
  const seq = store.addTrack('sequencer', '909 Drum Kit');
  const piano = store.addTrack('pianoroll', 'Arp Lead');
  const strudel = store.addTrack('strudel', 'Algorithmic Generator');

  assert(useDawStore.getState().tracks.length === 6, 'F3.1: Created 5 new tracks plus master (total 6)');
  assert(stem.type === 'stem', 'F3.2: Stem track created');
  assert(sample.type === 'sample', 'F3.3: Sample track created');
  assert(seq.type === 'sequencer', 'F3.4: Sequencer track created');
  assert(piano.type === 'pianoroll', 'F3.5: Piano Roll track created');
  assert(strudel.type === 'strudel', 'F3.6: Strudel track created');

  // Feature 4: Reactive Selection & Mixer Controls
  store.setSelectedTrackId(piano.id);
  assert(useDawStore.getState().selectedTrackId === piano.id, 'F4.1: Selection updates reactively');

  store.updateTrackMixer(piano.id, { volume: 0.85, pan: -0.25, muted: false, solo: true });
  const pianoTrackState = useDawStore.getState().tracks.find((t) => t.id === piano.id);
  assert(pianoTrackState?.volume === 0.85, 'F4.2: Mixer volume updated');
  assert(pianoTrackState?.pan === -0.25, 'F4.3: Mixer pan updated');
  assert(pianoTrackState?.solo === true, 'F4.4: Mixer solo state updated');

  // Feature 5: Step Sequencer Grid (16 steps x 4 voices)
  assert(seq.sequencerVoices?.length === 4, 'F5.1: Default drum sequencer initialized with 4 voices (Kick, Snare, Hihat, Perc)');
  store.toggleSequencerStep(seq.id, 0, 0); // Toggle Kick step 0 off
  store.toggleSequencerStep(seq.id, 0, 1); // Toggle Kick step 1 on
  const updatedSeq = useDawStore.getState().tracks.find((t) => t.id === seq.id);
  assert(updatedSeq?.sequencerVoices?.[0].steps[0] === false, 'F5.2: Step 0 toggled off');
  assert(updatedSeq?.sequencerVoices?.[0].steps[1] === true, 'F5.3: Step 1 toggled on for Kick');

  // Feature 6: Piano Roll & MIDI Editor
  store.addPianoRollNote(piano.id, { pitch: 'C4', midi: 60, startTime: 0, duration: 1.5, velocity: 0.9 });
  store.addPianoRollNote(piano.id, { pitch: 'E4', midi: 64, startTime: 1.5, duration: 1.5, velocity: 0.8 });
  store.addPianoRollNote(piano.id, { pitch: 'G4', midi: 67, startTime: 3.0, duration: 3.0, velocity: 1.0 });

  let updatedPiano = useDawStore.getState().tracks.find((t) => t.id === piano.id);
  assert(updatedPiano?.pianoRollNotes?.length === 3, 'F6.1: 3 MIDI notes added');

  const noteId = updatedPiano?.pianoRollNotes?.[0].id;
  if (noteId) {
    store.removePianoRollNote(piano.id, noteId);
    updatedPiano = useDawStore.getState().tracks.find((t) => t.id === piano.id);
    assert(updatedPiano?.pianoRollNotes?.length === 2, 'F6.2: MIDI note removed from store');
  }

  // Feature 7: 7-Effect Serial DSP Rack
  store.updateTrackFx(sample.id, 'eq', { enabled: true, low: -3, mid: 2, high: 4 });
  store.updateTrackFx(sample.id, 'filter', { enabled: true, type: 'highpass', cutoff: 350, resonance: 2 });
  store.updateTrackFx(sample.id, 'distortion', { enabled: true, drive: 0.4 });
  store.updateTrackFx(sample.id, 'chorus', { enabled: true, depth: 0.6 });
  store.updateTrackFx(sample.id, 'delay', { enabled: true, delayTime: 0.375, feedback: 0.45, wet: 0.3 });
  store.updateTrackFx(sample.id, 'reverb', { enabled: true, decay: 4.2, wet: 0.4 });
  store.updateTrackFx(sample.id, 'compressor', { enabled: true, threshold: -18, ratio: 4, attack: 0.01, release: 0.2 });

  const sampleFxTrack = useDawStore.getState().tracks.find((t) => t.id === sample.id);
  assert(sampleFxTrack?.fx.eq.low === -3, 'F7.1: EQ low gain configured');
  assert(sampleFxTrack?.fx.filter.type === 'highpass', 'F7.2: Filter type configured');
  assert(sampleFxTrack?.fx.distortion.drive === 0.4, 'F7.3: Distortion drive configured');
  assert(sampleFxTrack?.fx.chorus.depth === 0.6, 'F7.4: Chorus depth configured');
  assert(sampleFxTrack?.fx.delay.feedback === 0.45, 'F7.5: Delay feedback configured');
  assert(sampleFxTrack?.fx.reverb.decay === 4.2, 'F7.6: Reverb decay configured');
  assert(sampleFxTrack?.fx.compressor.threshold === -18, 'F7.7: Compressor threshold configured');

  // Feature 8: LEGO Cumulative Acoustic Conditioning
  store.toggleLegoContext(stem.id);
  store.toggleLegoContext(sample.id);
  let legoTrackIds = useDawStore.getState().legoContextTrackIds;
  assert(legoTrackIds.includes(stem.id) && legoTrackIds.includes(sample.id), 'F8.1: LEGO context includes stem and sample tracks');

  store.toggleLegoContext(stem.id);
  legoTrackIds = useDawStore.getState().legoContextTrackIds;
  assert(!legoTrackIds.includes(stem.id), 'F8.2: LEGO context toggled off stem track');

  // Feature 9: Selection & Pincher Region Bounds
  store.setSelection({ start: 12.5, end: 28.0 });
  const sel = useDawStore.getState().selection;
  assert(sel?.start === 12.5 && sel?.end === 28.0, 'F9.1: Selection region start and end updated');

  // Feature 10: Strudel Mini-Notation Evaluator
  const strudelCode = 's("bd [sd hh]*2").fast(2).slow(1).rev()';
  const parsed = parseStrudelPattern(strudelCode);
  assert(parsed.events.some((e) => e.value === 'bd'), 'F10.1: Strudel parser extracts bass drum event');
  assert(parsed.rateModifier === 2.0, 'F10.2: Strudel parser calculates rate multiplier fast(2)');
  assert(parsed.isReversed === true, 'F10.3: Strudel parser detects rev() modifier');

  const evalResult = evaluateStrudelPattern(strudelCode);
  assert(evalResult.isValid === true && evalResult.events.length > 0, 'F10.4: Strudel evaluator validates mini-notation pattern');

  // Feature 11: Audio Peak Utility Safety Guards
  const zeroPeaks = await extractPeaksFromUrl('', 0);
  assert(zeroPeaks.length === 30, 'F11.1: Zero numSamples safe default fallback');
  const negPeaks = await extractPeaksFromUrl('', -100);
  assert(negPeaks.length === 30, 'F11.2: Negative numSamples safe default fallback');

  // =========================================================================
  // TIER 2: BOUNDARY VALUE ANALYSIS & EDGE CASES
  // =========================================================================
  console.log('\n--- Tier 2: Boundary Value Analysis & Edge Cases ---');

  // Boundary 1: Extreme BPM range
  store.setBpm(20);
  assert(useDawStore.getState().bpm === 20, 'T2.1: Min boundary BPM 20 supported');
  store.setBpm(300);
  assert(useDawStore.getState().bpm === 300, 'T2.2: Max boundary BPM 300 supported');

  // Boundary 2: Strudel rate modifiers clamping
  const negativeRateStrudel = parseStrudelPattern('s("synth").fast(-10)');
  assert(negativeRateStrudel.rateModifier === 1.0, 'T2.3: Negative Strudel fast rate clamped to 1.0');

  // Boundary 3: Master Track Deletion Protection
  store.removeTrack('master');
  assert(useDawStore.getState().tracks.some((t) => t.id === 'master'), 'T2.4: Master track protected against removal');

  // Boundary 4: Selection region reset
  store.setSelection(null);
  assert(useDawStore.getState().selection === null, 'T2.5: Selection reset to null');

  // =========================================================================
  // TIER 3: PAIRWISE COMBINATION TESTS
  // =========================================================================
  console.log('\n--- Tier 3: Pairwise Combinations ---');

  // Pairwise 1: Multi-FX serial chain + Mixer Mute/Solo
  store.updateTrackMixer(seq.id, { muted: true, solo: false });
  store.updateTrackFx(seq.id, 'reverb', { enabled: true, wet: 0.8 });
  const seqMixerFx = useDawStore.getState().tracks.find((t) => t.id === seq.id);
  assert(seqMixerFx?.muted === true && seqMixerFx?.fx.reverb.wet === 0.8, 'T3.1: Mixer muted status preserves active FX configuration');

  // Pairwise 2: LEGO Context + Selection Inpainting Region
  if (!useDawStore.getState().legoContextTrackIds.includes(sample.id)) {
    store.toggleLegoContext(sample.id);
  }
  store.setSelection({ start: 5, end: 15 });
  const pairwiseLego = useDawStore.getState().legoContextTrackIds;
  const pairwiseSel = useDawStore.getState().selection;
  assert(pairwiseLego.includes(sample.id) && pairwiseSel?.start === 5, 'T3.2: LEGO context selection and region bounds coexist');

  // =========================================================================
  // TIER 4: REAL-WORLD APPLICATION WORKLOADS
  // =========================================================================
  console.log('\n--- Tier 4: Real-World Application Workloads ---');

  // Workload 1: Non-destructive Take switching & snapshot comping
  const takesMock = [
    { id: 'take-v1', song_id: 'song-m5-001', take_number: 1, model: 'acestep-v15-xl-turbo', task: 'text2music', url: 'http://localhost/t1.wav', is_active: true, created_at: new Date().toISOString() },
    { id: 'take-v2', song_id: 'song-m5-001', take_number: 2, model: 'acestep-v15-xl-base', task: 'repaint', url: 'http://localhost/t2.wav', is_active: false, created_at: new Date().toISOString() },
  ];
  store.setTakes(takesMock);
  store.activateTake('take-v2');
  const takesState = useDawStore.getState().takes;
  assert(takesState.find((t) => t.id === 'take-v2')?.is_active === true, 'T4.1: Take 2 activated non-destructively');
  assert(takesState.find((t) => t.id === 'take-v1')?.is_active === false, 'T4.2: Take 1 deactivated non-destructively');

  // =========================================================================
  // TIER 5: ADVERSARIAL COVERAGE HARDENING
  // =========================================================================
  console.log('\n--- Tier 5: Adversarial Stress Tests ---');

  // Adversarial 1: Stress track allocation (50 rapid track additions & deletions)
  const tempTrackIds: string[] = [];
  for (let i = 0; i < 50; i++) {
    const t = store.addTrack('stem', `Stress ${i}`);
    tempTrackIds.push(t.id);
  }
  assert(useDawStore.getState().tracks.length === 56, 'T5.1: Successfully allocated 50 stress tracks');

  for (const tid of tempTrackIds) {
    store.removeTrack(tid);
  }
  assert(useDawStore.getState().tracks.length === 6, 'T5.2: Cleanly deallocated all 50 stress tracks without residual leak');

  // Adversarial 2: Malformed Strudel code parsing resilience
  const malformedStrudel = 's("bd [sd hh").fast(0).slow(-5)';
  const malformedEval = evaluateStrudelPattern(malformedStrudel);
  assert(typeof malformedEval.isValid === 'boolean', 'T5.3: Malformed Strudel input handled safely without throwing fatal error');

  console.log(`\n=== MILESTONE M5 E2E SUITE RESULTS: ${passCount} PASSED, ${failCount} FAILED ===`);
  if (failCount > 0) {
    process.exit(1);
  }
}

runE2ESuite().catch((err) => {
  console.error('Fatal error in E2E suite:', err);
  process.exit(1);
});
