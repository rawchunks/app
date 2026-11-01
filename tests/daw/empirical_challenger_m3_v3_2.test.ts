// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useDawStore } from '../../src/lib/daw/store';
import { dawEngine } from '../../src/lib/daw/engine';

describe('Empirical Challenger M3 Stress Tests', () => {
  beforeEach(() => {
    vi.spyOn(dawEngine, 'init').mockResolvedValue();
    vi.spyOn(dawEngine, 'scheduleSequencer').mockImplementation(() => {});
    vi.spyOn(dawEngine, 'updateTrackMixer').mockImplementation(() => {});
    vi.spyOn(dawEngine, 'loadClip').mockResolvedValue();
  });

  it('handles out-of-bounds sequencer indices, empty voices, and drum triggers without crashing', () => {
    const store = useDawStore.getState();
    store.initProject('test-song', 'Test Song', 60, '');
    const seqTrack = store.addTrack('sequencer', 'Drum Sequencer');
    expect(seqTrack).toBeDefined();

    // Out-of-bounds toggleSequencerStep
    expect(() => store.toggleSequencerStep(seqTrack.id, -1, 0)).not.toThrow();
    expect(() => store.toggleSequencerStep(seqTrack.id, 999, 0)).not.toThrow();
    expect(() => store.toggleSequencerStep(seqTrack.id, 0, -1)).not.toThrow();
    expect(() => store.toggleSequencerStep(seqTrack.id, 0, 999)).not.toThrow();

    // Out-of-bounds setSequencerVoiceVolume
    expect(() => store.setSequencerVoiceVolume(seqTrack.id, -1, 0, 0.8)).not.toThrow();
    expect(() => store.setSequencerVoiceVolume(seqTrack.id, 999, 0, 0.8)).not.toThrow();
    expect(() => store.setSequencerVoiceVolume(seqTrack.id, 0, -1, 0.8)).not.toThrow();
    expect(() => store.setSequencerVoiceVolume(seqTrack.id, 0, 999, 0.8)).not.toThrow();

    // Valid sequencer operations
    store.toggleSequencerStep(seqTrack.id, 0, 0);
    const updatedTrack = useDawStore.getState().tracks.find((t) => t.id === seqTrack.id);
    expect(updatedTrack?.sequencerVoices?.[0]?.steps[0]).toBe(true);

    store.setSequencerVoiceVolume(seqTrack.id, 0, 0, 0.5);
    const updatedTrack2 = useDawStore.getState().tracks.find((t) => t.id === seqTrack.id);
    expect(updatedTrack2?.sequencerVoices?.[0]?.velocity[0]).toBe(0.5);

    // Empty sequencerVoices handling
    useDawStore.setState((state) => ({
      tracks: state.tracks.map((t) =>
        t.id === seqTrack.id ? { ...t, sequencerVoices: [] } : t
      ),
    }));

    expect(() => store.toggleSequencerStep(seqTrack.id, 0, 0)).not.toThrow();
    expect(() => store.clearSequencerSteps(seqTrack.id)).not.toThrow();

    // dawEngine triggerDrum edge cases
    expect(() => dawEngine.triggerDrum('non-existent-track', 'kick', 0.8)).not.toThrow();
    expect(() => dawEngine.triggerDrum(seqTrack.id, 'invalid_voice' as any, 0.8)).not.toThrow();
    expect(() => dawEngine.triggerDrum(seqTrack.id, 'kick', -5)).not.toThrow();
  });
});
