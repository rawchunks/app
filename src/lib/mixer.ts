export interface Track {
  id: string;
  name: string;
  url: string;
  volume: number;
  pan: number;
  isMuted: boolean;
  isSolo: boolean;
  eqLow: number;  // -12 to +12 dB
  eqMid: number;  // -12 to +12 dB
  eqHigh: number; // -12 to +12 dB
  peaks: number[];
  buffer?: AudioBuffer;
}

export interface NodeChain {
  source?: AudioBufferSourceNode;
  eqLow: BiquadFilterNode;
  eqMid: BiquadFilterNode;
  eqHigh: BiquadFilterNode;
  panner: StereoPannerNode;
  gain: GainNode;
}

export class Mixer {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private tracks: Map<string, Track> = new Map();
  private chains: Map<string, NodeChain> = new Map();
  private isPlaying = false;
  private startOffset = 0;
  private startTime = 0;
  private animId: number | null = null;
  private onTimeUpdate: ((time: number) => void) | null = null;
  private onEnded: (() => void) | null = null;
  private duration = 0;

  private initContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -12;
      this.compressor.knee.value = 6;
      this.compressor.ratio.value = 3;
      this.compressor.attack.value = 0.003;
      this.compressor.release.value = 0.25;

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 1.0;

      this.compressor.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  public setOnTimeUpdate(cb: (time: number) => void) {
    this.onTimeUpdate = cb;
  }

  public setOnEnded(cb: () => void) {
    this.onEnded = cb;
  }

  public getDuration(): number {
    return this.duration;
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  public async decodeAudio(url: string, bins = 160): Promise<{ buffer: AudioBuffer; peaks: number[] }> {
    const ctx = this.initContext();
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch audio from ${url}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    const buffer = await ctx.decodeAudioData(arrayBuffer);
    const peaks = this.extractPeaks(buffer, bins);
    return { buffer, peaks };
  }

  public extractPeaks(buffer: AudioBuffer, bins = 160): number[] {
    const channelData = buffer.getChannelData(0);
    const step = Math.floor(channelData.length / bins);
    const peaks: number[] = [];

    for (let i = 0; i < bins; i++) {
      const start = i * step;
      const end = start + step;
      let max = 0;
      for (let j = start; j < end; j++) {
        const val = Math.abs(channelData[j]);
        if (val > max) max = val;
      }
      peaks.push(Math.max(0.06, Math.min(1.0, max)));
    }
    return peaks;
  }

  public registerTrack(track: Track) {
    this.tracks.set(track.id, { ...track });
    if (track.buffer && track.buffer.duration > this.duration) {
      this.duration = track.buffer.duration;
    }
  }

  public updateTrack(id: string, updates: Partial<Track>) {
    const existing = this.tracks.get(id);
    if (!existing) return;
    const updated = { ...existing, ...updates };
    this.tracks.set(id, updated);

    const chain = this.chains.get(id);
    if (chain && this.ctx) {
      if (updates.volume !== undefined || updates.isMuted !== undefined || updates.isSolo !== undefined) {
        this.updateGain(id, chain.gain);
      }
      if (updates.pan !== undefined) {
        chain.panner.pan.setTargetAtTime(updated.pan, this.ctx.currentTime, 0.02);
      }
      if (updates.eqLow !== undefined) {
        chain.eqLow.gain.setTargetAtTime(updated.eqLow, this.ctx.currentTime, 0.02);
      }
      if (updates.eqMid !== undefined) {
        chain.eqMid.gain.setTargetAtTime(updated.eqMid, this.ctx.currentTime, 0.02);
      }
      if (updates.eqHigh !== undefined) {
        chain.eqHigh.gain.setTargetAtTime(updated.eqHigh, this.ctx.currentTime, 0.02);
      }
    }
  }

  private updateGain(id: string, gainNode: GainNode) {
    if (!this.ctx) return;
    const track = this.tracks.get(id);
    if (!track) return;

    let hasAnySolo = false;
    for (const t of this.tracks.values()) {
      if (t.isSolo) {
        hasAnySolo = true;
        break;
      }
    }

    let targetGain = 0;
    if (track.isMuted) {
      targetGain = 0;
    } else if (hasAnySolo) {
      targetGain = track.isSolo ? track.volume : 0;
    } else {
      targetGain = track.volume;
    }

    gainNode.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.02);
  }

  public refreshGains() {
    for (const [id, chain] of this.chains.entries()) {
      this.updateGain(id, chain.gain);
    }
  }

  public play(offset = 0) {
    const ctx = this.initContext();
    this.stopSources();

    this.startOffset = Math.max(0, offset);
    this.startTime = ctx.currentTime;
    this.isPlaying = true;

    for (const [id, track] of this.tracks.entries()) {
      if (!track.buffer) continue;

      const source = ctx.createBufferSource();
      source.buffer = track.buffer;

      // Filter chain: Low -> Mid -> High
      const eqLow = ctx.createBiquadFilter();
      eqLow.type = 'lowshelf';
      eqLow.frequency.value = 120;
      eqLow.gain.value = track.eqLow;

      const eqMid = ctx.createBiquadFilter();
      eqMid.type = 'peaking';
      eqMid.frequency.value = 1000;
      eqMid.Q.value = 1.0;
      eqMid.gain.value = track.eqMid;

      const eqHigh = ctx.createBiquadFilter();
      eqHigh.type = 'highshelf';
      eqHigh.frequency.value = 6000;
      eqHigh.gain.value = track.eqHigh;

      const panner = ctx.createStereoPanner();
      panner.pan.value = track.pan;

      const gain = ctx.createGain();

      source.connect(eqLow);
      eqLow.connect(eqMid);
      eqMid.connect(eqHigh);
      eqHigh.connect(panner);
      panner.connect(gain);
      if (this.compressor) {
        gain.connect(this.compressor);
      }

      const chain: NodeChain = { source, eqLow, eqMid, eqHigh, panner, gain };
      this.chains.set(id, chain);
      this.updateGain(id, gain);

      const trackOffset = Math.min(this.startOffset, track.buffer.duration);
      source.start(0, trackOffset);
    }

    this.startTick();
  }

  public pause() {
    if (!this.isPlaying) return;
    const elapsed = this.getCurrentTime();
    this.startOffset = elapsed;
    this.stopSources();
    this.isPlaying = false;
    this.stopTick();
  }

  public seek(targetTime: number) {
    this.startOffset = Math.max(0, targetTime);
    if (this.isPlaying) {
      this.play(this.startOffset);
    } else {
      if (this.onTimeUpdate) {
        this.onTimeUpdate(this.startOffset);
      }
    }
  }

  public getCurrentTime(): number {
    if (!this.isPlaying || !this.ctx) return this.startOffset;
    const elapsed = this.ctx.currentTime - this.startTime + this.startOffset;
    return Math.min(elapsed, this.duration);
  }

  private stopSources() {
    for (const chain of this.chains.values()) {
      if (chain.source) {
        try {
          chain.source.stop();
          chain.source.disconnect();
        } catch {}
      }
    }
    this.chains.clear();
  }

  private startTick() {
    this.stopTick();
    const tick = () => {
      if (!this.isPlaying) return;
      const current = this.getCurrentTime();
      if (this.onTimeUpdate) {
        this.onTimeUpdate(current);
      }
      if (this.duration > 0 && current >= this.duration) {
        this.pause();
        this.seek(0);
        if (this.onEnded) {
          this.onEnded();
        }
        return;
      }
      this.animId = requestAnimationFrame(tick);
    };
    this.animId = requestAnimationFrame(tick);
  }

  private stopTick() {
    if (this.animId !== null) {
      cancelAnimationFrame(this.animId);
      this.animId = null;
    }
  }

  public destroy() {
    this.pause();
    this.tracks.clear();
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }
  }
}

export const mixer = new Mixer();
