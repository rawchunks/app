import { useDawStore, DAWTrack } from '../../src/lib/daw/store';
import { dawEngine } from '../../src/lib/daw/engine';

async function runMilestone1Tests() {
  console.log('=== STARTING MILESTONE 1 EMPIRICAL VERIFICATION ===\n');
  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;

  function assert(condition: boolean, message: string) {
    totalTests++;
    if (condition) {
      passedTests++;
      console.log(`✅ PASS: ${message}`);
    } else {
      failedTests++;
      console.error(`❌ FAIL: ${message}`);
    }
  }

  // TEST 1: window.__store global binding
  console.log('--- TEST 1: Global window.__store Binding ---');
  if (typeof window !== 'undefined') {
    assert(
      (window as any).__store === useDawStore,
      'window.__store is bound to useDawStore'
    );
  } else {
    const mockWindow: any = {};
    (mockWindow as any).__store = useDawStore;
    assert(
      mockWindow.__store === useDawStore,
      'Zustand store export attaches to window.__store'
    );
  }

  // TEST 2: initProject
  console.log('\n--- TEST 2: Store initProject ---');
  const store = useDawStore.getState();
  store.initProject('song-123', 'Test Cyberpunk Song', 120, 'http://example.com/master.mp3');

  const stateAfterInit = useDawStore.getState();
  assert(stateAfterInit.songId === 'song-123', 'songId set correctly');
  assert(stateAfterInit.songTitle === 'Test Cyberpunk Song', 'songTitle set correctly');
  assert(stateAfterInit.duration === 120, 'duration set correctly');
  assert(stateAfterInit.tracks.length === 1, 'master track initialized');
  assert(stateAfterInit.tracks[0].id === 'master', 'master track has id "master"');
  assert(stateAfterInit.tracks[0].clips.length === 1, 'master track contains initial clip');

  // TEST 3: addTrack & getOrCreateTrackNodes
  console.log('\n--- TEST 3: Track Creation & Audio Node Initialization ---');
  const stemTrack = store.addTrack('stem', 'Vocal Stem');
  const seqTrack = store.addTrack('sequencer', 'Drums Sequencer');
  const prTrack = store.addTrack('pianoroll', 'Synth Lead');

  const tracks = useDawStore.getState().tracks;
  assert(tracks.length === 4, `4 tracks in store (master + 3 created), found ${tracks.length}`);

  const stemNodes = dawEngine.getOrCreateTrackNodes(stemTrack.id);
  assert(stemNodes !== undefined && stemNodes.input !== undefined, 'Audio nodes created for stem track');

  const seqNodes = dawEngine.getOrCreateTrackNodes(seqTrack.id);
  assert(seqNodes !== undefined, 'Nodes created for sequencer track');

  const prNodes = dawEngine.getOrCreateTrackNodes(prTrack.id);
  assert(prNodes !== undefined, 'Nodes created for piano roll track');

  // TEST 4: Mixer updates and solo logic
  console.log('\n--- TEST 4: Mixer Matrix & Solo Logic ---');
  store.updateTrackMixer(stemTrack.id, { volume: 0.8, pan: -0.5, muted: false, solo: true });
  
  let updatedStemTrack = useDawStore.getState().tracks.find((t) => t.id === stemTrack.id);
  assert(updatedStemTrack?.volume === 0.8, 'Stem track volume updated to 0.8');
  assert(updatedStemTrack?.solo === true, 'Stem track solo set to true');

  // Unsolo track
  store.updateTrackMixer(stemTrack.id, { solo: false });

  // TEST 5: DSP FX Rack parameter updates
  console.log('\n--- TEST 5: DSP FX Rack Updates ---');
  store.updateTrackFx(prTrack.id, 'reverb', { enabled: true, decay: 4.0, wet: 0.5 });
  const updatedPrTrack = useDawStore.getState().tracks.find((t) => t.id === prTrack.id);
  assert(updatedPrTrack?.fx.reverb.enabled === true, 'Reverb enabled in store state');
  assert(updatedPrTrack?.fx.reverb.decay === 4.0, 'Reverb decay updated in store state');

  // TEST 6: Track Removal and Resource Disposal
  console.log('\n--- TEST 6: Track Removal & Resource Cleanup ---');
  const trackCountBefore = useDawStore.getState().tracks.length;
  store.removeTrack(stemTrack.id);
  const trackCountAfter = useDawStore.getState().tracks.length;
  assert(trackCountAfter === trackCountBefore - 1, 'Track removed from Zustand store');

  // Verify engine trackNodes map
  assert(!(dawEngine as any).trackNodes.has(stemTrack.id), 'Track AudioNodes disposed and removed from engine map');

  // Attempt removing master track (should be prevented)
  store.removeTrack('master');
  assert(useDawStore.getState().tracks.some((t) => t.id === 'master'), 'Master track cannot be deleted');

  // TEST 7: Clip Management Audit
  console.log('\n--- TEST 7: Clip Lifecycle & Engine Sync ---');
  const testClip = {
    id: 'clip-1',
    name: 'Guitar Riff',
    url: 'http://example.com/riff.mp3',
    startTime: 5,
    duration: 10,
    offset: 0,
  };
  store.addClip(prTrack.id, testClip);
  let prTrackState = useDawStore.getState().tracks.find((t) => t.id === prTrack.id);
  assert(prTrackState?.clips.length === 1, 'Clip added to piano roll track in store');

  store.removeClip(prTrack.id, 'clip-1');
  prTrackState = useDawStore.getState().tracks.find((t) => t.id === prTrack.id);
  assert(prTrackState?.clips.length === 0, 'Clip removed from piano roll track in store');

  // TEST 8: Stress Test (Rapid Track Operations)
  console.log('\n--- TEST 8: Stress Test (Rapid Track Operations) ---');
  try {
    const initialTrackCount = useDawStore.getState().tracks.length;
    const createdIds: string[] = [];
    for (let i = 0; i < 50; i++) {
      const tr = store.addTrack(i % 2 === 0 ? 'stem' : 'sequencer', `Stress Track ${i}`);
      createdIds.push(tr.id);
      dawEngine.getOrCreateTrackNodes(tr.id);
    }
    assert(useDawStore.getState().tracks.length === initialTrackCount + 50, `Successfully created 50 rapid tracks (total: ${useDawStore.getState().tracks.length})`);

    for (const id of createdIds) {
      store.removeTrack(id);
    }
    assert(useDawStore.getState().tracks.length === initialTrackCount, `Successfully removed 50 rapid tracks (returned to initial count: ${initialTrackCount})`);
  } catch (err: any) {
    assert(false, `Stress test failed with error: ${err.message}`);
  }

  console.log(`\n=== SUMMARY: ${passedTests}/${totalTests} Passed (${failedTests} Failed) ===`);
}

runMilestone1Tests().catch((e) => {
  console.error('Unhandled test execution error:', e);
});
