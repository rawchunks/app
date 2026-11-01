// @vitest-environment node
/**
 * RawChunks AI-Native Studio — Milestone M5 E2E & Adversarial Hardening Test Suite
 * Functional test suite covering Features 1-11 across Tiers 1-5 (Unit, Boundary, Pairwise, Workload, Adversarial)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useDawStore } from '../src/lib/daw/store';
import { dawEngine } from '../src/lib/daw/engine';
import { parseStrudelPattern, evaluateStrudelPattern } from '../src/lib/daw/strudel';
import { extractPeaksFromBuffer, extractBipolarPeaksFromUrl } from '../src/lib/daw/peaks';

describe('Milestone M5 E2E & Adversarial Suite', () => {
  beforeEach(() => {
    vi.spyOn(dawEngine, 'loadClip').mockResolvedValue();
    vi.spyOn(dawEngine, 'scheduleSequencer').mockImplementation(() => {});
    vi.spyOn(dawEngine, 'schedulePiano').mockImplementation(() => {});
    vi.spyOn(dawEngine, 'scheduleStrudel').mockImplementation(() => {});
    vi.spyOn(dawEngine, 'updateTrackMixer').mockImplementation(() => {});
    vi.spyOn(dawEngine, 'updateTrackFx').mockImplementation(() => {});
    vi.spyOn(dawEngine, 'disposeTrack').mockImplementation(() => {});
  });

  it('passes Tiers 1-5 unit, boundary, pairwise, workload, and adversarial checks', async () => {
    // =========================================================================
    // TIER 1: CORE FEATURE INVENTORY UNIT TESTS (Features 1 - 11)
    // =========================================================================
    const store = useDawStore.getState();
    store.initProject('song-m5-001', 'Hyperborea Protocol', 60, 'http://localhost/audio/main.wav');
    expect(useDawStore.getState().songId).toBe('song-m5-001');
    expect(useDawStore.getState().songTitle).toBe('Hyperborea Protocol');
    expect(useDawStore.getState().duration).toBe(60);
    expect(useDawStore.getState().tracks.length).toBe(1);
    expect(useDawStore.getState().tracks[0].id).toBe('master');
    expect(useDawStore.getState().legoContextTrackIds.includes('master')).toBe(true);

    // Feature 3: Multi-Track Workstation Management
    const stem = store.addTrack('stem', 'Vocal Stems');
    const sample = store.addTrack('sample', 'Synth Loop');
    const seq = store.addTrack('sequencer', '909 Drum Kit');
    const piano = store.addTrack('pianoroll', 'Arp Lead');
    const strudel = store.addTrack('strudel', 'Algorithmic Generator');

    expect(useDawStore.getState().tracks.length).toBe(6);
    expect(stem.type).toBe('stem');
    expect(sample.type).toBe('sample');
    expect(seq.type).toBe('sequencer');
    expect(piano.type).toBe('pianoroll');
    expect(strudel.type).toBe('strudel');

    // Feature 4: Reactive Selection & Mixer Controls
    store.setSelectedTrackId(piano.id);
    expect(useDawStore.getState().selectedTrackId).toBe(piano.id);

    store.updateTrackMixer(piano.id, { volume: 0.85, pan: -0.25, muted: false, solo: true });
    const pianoTrackState = useDawStore.getState().tracks.find((t) => t.id === piano.id);
    expect(pianoTrackState?.volume).toBe(0.85);
    expect(pianoTrackState?.pan).toBe(-0.25);
    expect(pianoTrackState?.solo).toBe(true);

    // Feature 5: Step Sequencer Grid (16 steps x 5 voices)
    expect(seq.sequencerVoices?.length).toBe(5);
    store.toggleSequencerStep(seq.id, 0, 0); // Toggle Kick step 0 on
    store.toggleSequencerStep(seq.id, 0, 1); // Toggle Kick step 1 on
    store.toggleSequencerStep(seq.id, 0, 0); // Toggle Kick step 0 back off
    const updatedSeq = useDawStore.getState().tracks.find((t) => t.id === seq.id);
    expect(updatedSeq?.sequencerVoices?.[0].steps[0]).toBe(false);
    expect(updatedSeq?.sequencerVoices?.[0].steps[1]).toBe(true);

    // Feature 6: Piano Roll & MIDI Editor
    store.addPianoRollNote(piano.id, { pitch: 'C4', midi: 60, startTime: 0, duration: 1.5, velocity: 0.9 });
    store.addPianoRollNote(piano.id, { pitch: 'E4', midi: 64, startTime: 1.5, duration: 1.5, velocity: 0.8 });
    store.addPianoRollNote(piano.id, { pitch: 'G4', midi: 67, startTime: 3.0, duration: 3.0, velocity: 1.0 });

    let updatedPiano = useDawStore.getState().tracks.find((t) => t.id === piano.id);
    expect(updatedPiano?.pianoRollNotes?.length).toBe(3);

    const noteId = updatedPiano?.pianoRollNotes?.[0].id;
    if (noteId) {
      store.removePianoRollNote(piano.id, noteId);
      updatedPiano = useDawStore.getState().tracks.find((t) => t.id === piano.id);
      expect(updatedPiano?.pianoRollNotes?.length).toBe(2);
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
    expect(sampleFxTrack?.fx.eq.low).toBe(-3);
    expect(sampleFxTrack?.fx.filter.type).toBe('highpass');
    expect(sampleFxTrack?.fx.distortion.drive).toBe(0.4);
    expect(sampleFxTrack?.fx.chorus.depth).toBe(0.6);
    expect(sampleFxTrack?.fx.delay.feedback).toBe(0.45);
    expect(sampleFxTrack?.fx.reverb.decay).toBe(4.2);
    expect(sampleFxTrack?.fx.compressor.threshold).toBe(-18);

    // Feature 8: LEGO Cumulative Acoustic Conditioning
    store.toggleLegoContext(stem.id);
    store.toggleLegoContext(sample.id);
    let legoTrackIds = useDawStore.getState().legoContextTrackIds;
    expect(legoTrackIds.includes(stem.id) && legoTrackIds.includes(sample.id)).toBe(true);

    store.toggleLegoContext(stem.id);
    legoTrackIds = useDawStore.getState().legoContextTrackIds;
    expect(legoTrackIds.includes(stem.id)).toBe(false);

    // Feature 9: Selection & Pincher Region Bounds
    store.setSelection({ start: 12.5, end: 28.0 });
    const sel = useDawStore.getState().selection;
    expect(sel?.start).toBe(12.5);
    expect(sel?.end).toBe(28.0);

    // Feature 10: Strudel Mini-Notation Evaluator
    const strudelCode = 's("bd [sd hh]*2").fast(2).slow(1).rev()';
    const parsed = parseStrudelPattern(strudelCode);
    expect(parsed.events.some((e) => e.value === 'bd')).toBe(true);
    expect(parsed.rateModifier).toBe(2.0);
    expect(parsed.isReversed).toBe(true);

    const evalResult = evaluateStrudelPattern(strudelCode);
    expect(evalResult.isValid).toBe(true);
    expect(evalResult.events.length).toBeGreaterThan(0);

    // Feature 11: Audio Peak Utility Safety Guards
    const mockBuf = {
      numberOfChannels: 1,
      length: 100,
      sampleRate: 44100,
      duration: 100 / 44100,
      getChannelData: () => new Float32Array(100),
    } as any;
    expect(() => extractPeaksFromBuffer(mockBuf, 0)).toThrow('Invalid waveform range');
    expect(() => extractPeaksFromBuffer(mockBuf, -100)).toThrow('Invalid waveform range');
    await expect(extractBipolarPeaksFromUrl('', 30)).rejects.toThrow('Audio source is required');

    // =========================================================================
    // TIER 2: BOUNDARY VALUE ANALYSIS & EDGE CASES
    // =========================================================================
    store.setBpm(20);
    expect(useDawStore.getState().bpm).toBe(20);
    store.setBpm(300);
    expect(useDawStore.getState().bpm).toBe(300);

    const negativeRateStrudel = parseStrudelPattern('s("synth").fast(-10)');
    expect(negativeRateStrudel.rateModifier).toBe(1.0);

    store.removeTrack('master');
    expect(useDawStore.getState().tracks.some((t) => t.id === 'master')).toBe(true);

    store.setSelection(null);
    expect(useDawStore.getState().selection).toBeNull();

    // =========================================================================
    // TIER 3: PAIRWISE COMBINATION TESTS
    // =========================================================================
    store.updateTrackMixer(seq.id, { muted: true, solo: false });
    store.updateTrackFx(seq.id, 'reverb', { enabled: true, wet: 0.8 });
    const seqMixerFx = useDawStore.getState().tracks.find((t) => t.id === seq.id);
    expect(seqMixerFx?.muted).toBe(true);
    expect(seqMixerFx?.fx.reverb.wet).toBe(0.8);

    if (!useDawStore.getState().legoContextTrackIds.includes(sample.id)) {
      store.toggleLegoContext(sample.id);
    }
    store.setSelection({ start: 5, end: 15 });
    const pairwiseLego = useDawStore.getState().legoContextTrackIds;
    const pairwiseSel = useDawStore.getState().selection;
    expect(pairwiseLego.includes(sample.id)).toBe(true);
    expect(pairwiseSel?.start).toBe(5);

    // =========================================================================
    // TIER 4: REAL-WORLD APPLICATION WORKLOADS
    // =========================================================================
    const takesMock = [
      { id: 'take-v1', song_id: 'song-m5-001', take_number: 1, model: 'acestep-v15-xl-turbo', task: 'text2music', url: 'http://localhost/t1.wav', is_active: true, created_at: new Date().toISOString() },
      { id: 'take-v2', song_id: 'song-m5-001', take_number: 2, model: 'acestep-v15-xl-base', task: 'repaint', url: 'http://localhost/t2.wav', is_active: false, created_at: new Date().toISOString() },
    ];
    store.setTakes(takesMock);
    store.toggleTake('take-v2');
    expect(useDawStore.getState().tracks.some((t) => t.activeTakeId === 'take-v2')).toBe(true);
    store.toggleTake('take-v2');
    expect(useDawStore.getState().tracks.some((t) => t.activeTakeId === 'take-v2')).toBe(false);

    // =========================================================================
    // TIER 5: ADVERSARIAL COVERAGE HARDENING
    // =========================================================================
    const tempTrackIds: string[] = [];
    for (let i = 0; i < 50; i++) {
      const t = store.addTrack('stem', `Stress ${i}`);
      tempTrackIds.push(t.id);
    }
    expect(useDawStore.getState().tracks.length).toBe(56);

    for (const tid of tempTrackIds) {
      store.removeTrack(tid);
    }
    expect(useDawStore.getState().tracks.length).toBe(6);

    const malformedStrudel = 's("bd [sd hh").fast(0).slow(-5)';
    const malformedEval = evaluateStrudelPattern(malformedStrudel);
    expect(typeof malformedEval.isValid).toBe('boolean');
  });
});
