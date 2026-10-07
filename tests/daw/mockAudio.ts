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
  constructor(context?: any) { this.context = context; }
  connect(target: any) { return target; }
  disconnect() {}
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() { return true; }
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
  decodeAudioData(_buffer: any, success: any) {
    void _buffer;
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
    if (this.listeners[type]) {
      this.listeners[type] = this.listeners[type].filter((f) => f !== fn);
    }
  }
  dispatchEvent(evt: any) {
    const fnList = this.listeners[evt.type] || [];
    fnList.forEach((fn) => fn(evt));
    return true;
  }
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
}

if (typeof globalThis !== 'undefined') {
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
}

export {};
