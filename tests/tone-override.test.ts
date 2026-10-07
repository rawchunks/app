import * as Tone from 'tone';

class MockParam {
  value: number;
  constructor(init = 0) { this.value = init; }
  rampTo(val: number, duration?: number) { this.value = val; }
}

class MockGain {
  gain: MockParam;
  constructor(val = 1) { this.gain = new MockParam(val); }
  chain(...args: any[]) {}
  connect() {}
  dispose() {}
}

(Tone as any).Gain = MockGain;

const g = new Tone.Gain(0.5);
console.log("Mock Gain created successfully, gain value:", g.gain.value);
