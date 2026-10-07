import { dawEngine } from '../src/lib/daw/engine';
import { useDawStore } from '../src/lib/daw/store';

console.log("Store initial tracks:", useDawStore.getState().tracks);
try {
  const nodes = dawEngine.getOrCreateTrackNodes('test-track');
  console.log("Created track nodes:", !!nodes);
} catch (e) {
  console.error("Error creating track nodes:", e);
}
