// Mock Web Audio / Tone nodes setup for Node execution
import { vi } from 'vitest';

// Let's create dummy AudioContext if missing
if (typeof globalThis.window === 'undefined') {
  (globalThis as any).window = globalThis;
}

class MockAudioParam {
  value = 0;
  rampTo = (val: number) => { this.value = val; };
  cancelScheduledValues = () => {};
}

class MockAudioNode {
  connect() { return this; }
  disconnect() {}
  chain(...nodes: any[]) { return this; }
  toDestination() { return this; }
  dispose() {}
}

console.log("Global window defined.");
