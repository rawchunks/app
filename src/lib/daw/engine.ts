import * as Tone from 'tone';
import { DAWTrack, DSPFxConfig, useDawStore } from './store';
import { parseStrudelPattern } from './strudelEvaluator';
import { bus } from '../bus';
import { BEAT_STEPS, DRUM_STEPS } from './notes';

export interface TrackAudioNodes {
  input: Tone.Gain;
  source?: Tone.Gain;
  eq: Tone.EQ3;
  filter: Tone.Filter;
  sectionGain?: Tone.Gain;
  distortion: Tone.Distortion;
  chorus: Tone.Chorus;
  delay: Tone.FeedbackDelay;
  reverb: Tone.Reverb;
  compressor: Tone.Compressor;
  panner: Tone.Panner;
  volume: Tone.Volume;
  meter: Tone.Meter;
  players: Map<string, Tone.Player>;
  polySynth?: Tone.PolySynth;
  drumSynths?: {
    kick: Tone.MembraneSynth;
    snare: Tone.NoiseSynth;
    hihat: Tone.MetalSynth;
    clap: Tone.NoiseSynth;
    tom: Tone.MembraneSynth;
    perc: Tone.MembraneSynth;
    crash: Tone.MetalSynth;
  };
}

class DAWEngine {
  private isInitialized = false;
  private trackNodes = new Map<string, TrackAudioNodes>();
  private masterCompressor: Tone.Compressor | null = null;
  private masterLimiter: Tone.Limiter | null = null;
  private sequencerScheduleIds = new Map<string, number>();
  private strudelScheduleIds = new Map<string, number>();
  private pianoScheduleIds = new Map<string, number[]>();
  private targetTransportState: 'started' | 'stopped' | 'paused' = 'stopped';
  private onStepCallback: ((step: number) => void) | null = null;
  private onTimeCallback: ((seconds: number) => void) | null = null;
  private timeUpdateTimer: number | null = null;
  private auditionTakeAudio: HTMLAudioElement | null = null;
  private auditionReadyHandler: (() => void) | null = null;
  private auditionOffset = 0;
  private auditionTrackId: string | null = null;
  private auditionLayerIds: string[] | null = null;
  private isAuditionLooping = false;
  private auditionStart: number | null = null;
  private auditionEnd: number | null = null;
  private currentSectionGainLinear = 1.0;
  private originalScheduleIds: number[] = [];
  private loading = new Map<string, Promise<void>>();
  private clipLoads = new Map<string, { signature: string; promise: Promise<void> }>();
  private project = 0;

  constructor(private offline = false) {
    if (!offline) bus.registerDaw(() => {
      this.pauseTransport();
    });
  }

  private ensureMasterBus(): Tone.Compressor {
    if (!this.masterCompressor) {
      this.masterCompressor = new Tone.Compressor({
        threshold: -12,
        ratio: 3,
        attack: 0.003,
        release: 0.25,
      });
      this.masterLimiter = new Tone.Limiter(-0.5);
      this.masterCompressor.connect(this.masterLimiter);
      this.masterLimiter.toDestination();
    }
    return this.masterCompressor;
  }

  public async resumeAudioContext() {
    if (typeof window === 'undefined') return;
    try {
      if (Tone.context.state !== 'running') {
        await Tone.start();
        await Tone.context.resume();
      }
    } catch (err) {
      console.warn('AudioContext resume error:', err);
    }
  }

  public async init() {
    if (this.isInitialized) {
      await this.resumeAudioContext();
      return;
    }
    await this.resumeAudioContext();
    this.ensureMasterBus();
    this.isInitialized = true;
  }

  public setStepCallback(cb: (step: number) => void) {
    this.onStepCallback = cb;
  }

  public setTimeCallback(cb: (seconds: number) => void) {
    this.onTimeCallback = cb;
  }

  public async startTransport(preserveAudition = false) {
    const project = this.project;
    this.stopAuditionTake(!preserveAudition);
    const transport = Tone.getTransport();
    this.isAuditionLooping = transport.loop;
    this.auditionStart = transport.loop ? Tone.Time(transport.loopStart).toSeconds() : null;
    this.auditionEnd = transport.loop ? Tone.Time(transport.loopEnd).toSeconds() : null;
    this.targetTransportState = 'started';
    await this.resumeAudioContext();
    await this.init();
    if (project !== this.project || this.targetTransportState !== 'started') return;

    const waited = new Set<Promise<void>>();
    let pending = [...this.loading.values()];
    while (pending.length) {
      pending.forEach(load => waited.add(load));
      await Promise.all(pending);
      if (project !== this.project || this.targetTransportState !== 'started') return;
      pending = [...this.loading.values()].filter(load => !waited.has(load));
    }
    bus.request('daw');
    useDawStore.getState().setPlaying(true);
    for (const track of useDawStore.getState().tracks) {
      this.scheduleTrack(track);
    }
    this.updateTrackMixer('master');
    this.syncOriginals();

    if (Tone.getTransport().state !== 'started') {
      Tone.getTransport().start();
    }

    this.startTimeTracker();
  }

  public syncOriginals() {
    const transport = Tone.getTransport(), nodes = this.trackNodes.get('master');
    for (const id of this.originalScheduleIds) transport.clear(id);
    this.originalScheduleIds = [];
    if (!nodes) return;
    const state = useDawStore.getState();
    const master = state.tracks.find(track => track.id === 'master');
    const muted = this.auditionLayerIds ? Boolean(master?.mixer?.muted ?? master?.muted) || !this.auditionLayerIds.includes('master') : this.auditionTrackId ? this.auditionTrackId !== 'master' :
      Boolean(master?.mixer?.muted ?? master?.muted) ||
      (state.tracks.some(track => track.mixer?.solo ?? track.solo) && !(master?.mixer?.solo ?? master?.solo));
    const regions = [...state.originals].sort((a, b) => a.start - b.start).reduce<{ start: number; end: number }[]>((all, region) => {
      const last = all[all.length - 1];
      if (last && region.start <= last.end) last.end = Math.max(last.end, region.end);
      else all.push({ ...region });
      return all;
    }, []);
    (nodes.source ?? nodes.input).gain.value = muted || regions.some(region => transport.seconds >= region.start && transport.seconds < region.end) ? 0 : 1;
    for (const region of regions) {
      this.originalScheduleIds.push(transport.schedule(time => (nodes.source ?? nodes.input).gain.setValueAtTime(0, time), region.start));
      this.originalScheduleIds.push(transport.schedule(time => (nodes.source ?? nodes.input).gain.setValueAtTime(muted ? 0 : 1, time), region.end));
    }
  }

  public pauseTransport() {
    this.cancelAuditionReady();
    this.targetTransportState = 'paused';
    if (Tone.getTransport().state === 'started') {
      Tone.getTransport().pause();
    }
    if (this.auditionTakeAudio) {
      this.auditionTakeAudio.pause();
    }
    this.stopTimeTracker();
    bus.release('daw');
    useDawStore.getState().setPlaying(false);
  }

  public stopTransport() {
    this.cancelAuditionReady();
    this.targetTransportState = 'stopped';
    Tone.getTransport().stop();
    Tone.getTransport().seconds = 0;
    if (this.auditionTakeAudio) {
      this.auditionTakeAudio.pause();
      this.auditionTakeAudio.currentTime = 0;
    }
    this.stopTimeTracker();
    bus.release('daw');
    useDawStore.getState().setPlaying(false);
    if (this.onTimeCallback) this.onTimeCallback(0);
  }

  public seek(seconds: number) {
    if (isNaN(seconds)) return;
    const target = Math.max(0, seconds);
    Tone.getTransport().seconds = target;
    this.syncOriginals();

    if (this.auditionTakeAudio && this.auditionTakeAudio.readyState >= 1) {
      try {
        this.auditionTakeAudio.currentTime = Math.max(0, target - this.auditionOffset);
      } catch (err) {
        console.warn('Take seek warning:', err);
      }
    }

    if (this.onTimeCallback) this.onTimeCallback(target);
  }

  public auditionTake(url: string, startSec = 0, endSec?: number, timelineStart = startSec) {
    if (typeof window === 'undefined' || !url) return;
    this.pauseTransport();
    if (!this.auditionTakeAudio) {
      this.auditionTakeAudio = new Audio();
      this.auditionTakeAudio.crossOrigin = 'anonymous';
      this.auditionTakeAudio.preload = 'auto';
      this.auditionTakeAudio.addEventListener('ended', () => {
        this.stopTimeTracker();
        useDawStore.getState().setPlaying(false);
      });
    }

    const safeStart = Math.max(0, startSec);
    this.auditionOffset = timelineStart - safeStart;
    this.auditionStart = timelineStart;
    this.auditionEnd = endSec !== undefined ? Math.max(safeStart + 0.1, endSec) + this.auditionOffset : null;
    this.isAuditionLooping = false;

    const playTake = () => {
      if (!this.auditionTakeAudio) return;
      try {
        this.auditionTakeAudio.currentTime = safeStart;
      } catch (err) {
        console.warn('Take seek deferred:', err);
      }
      this.seek(timelineStart);
      this.auditionTakeAudio.play().catch((e) => console.warn('Take audition error:', e));
      useDawStore.getState().setPlaying(true);
      this.startTimeTracker();
    };

    if (this.auditionTakeAudio.src !== url) {
      this.auditionTakeAudio.src = url;
      this.auditionTakeAudio.load();
      if (this.auditionTakeAudio.readyState >= 1) {
        playTake();
      } else {
        const onCanPlay = () => {
          this.cancelAuditionReady();
          playTake();
        };
        this.auditionReadyHandler = onCanPlay;
        this.auditionTakeAudio.addEventListener('canplay', onCanPlay, { once: true });
      }
    } else {
      playTake();
    }
  }

  private cancelAuditionReady() {
    if (this.auditionReadyHandler) {
      this.auditionTakeAudio?.removeEventListener('canplay', this.auditionReadyHandler);
      this.auditionReadyHandler = null;
    }
  }

  public stopAuditionTake(restoreMixer = true) {
    if (restoreMixer && (this.auditionTrackId || this.auditionLayerIds)) {
      this.auditionTrackId = null;
      this.auditionLayerIds = null;
      this.updateTrackMixer('master');
    }
    this.cancelAuditionReady();
    if (this.auditionTakeAudio) {
      this.auditionTakeAudio.pause();
      this.auditionTakeAudio.currentTime = 0;
    }
    this.stopTimeTracker();
    useDawStore.getState().setPlaying(false);
    useDawStore.setState({ auditionId: null });
  }

  public setBpm(bpm: number) {
    if (Tone.getTransport()?.bpm?.rampTo) {
      Tone.getTransport().bpm.rampTo(bpm, 0.05);
    } else if (Tone.getTransport()?.bpm) {
      Tone.getTransport().bpm.value = bpm;
    }
  }

  public setLoop(loop: boolean, start = 0, end = 30) {
    Tone.getTransport().loop = loop;
    Tone.getTransport().loopStart = start;
    Tone.getTransport().loopEnd = end;
    this.isAuditionLooping = loop;
    if (loop) {
      this.auditionStart = start;
      this.auditionEnd = end;
    } else {
      this.auditionStart = null;
      this.auditionEnd = null;
    }
  }

  public async auditionSection(start: number, end: number, loop = false) {
    const safeStart = Math.max(0, start);
    const safeEnd = Math.max(safeStart + 0.1, end);

    this.seek(safeStart);
    await this.startTransport();
    this.auditionStart = safeStart;
    this.auditionEnd = safeEnd;
    this.isAuditionLooping = loop;
  }

  public async auditionLayer(ids: string[], start: number, end: number) {
    if (!ids.length) throw new Error('Select original or take audio to play');
    this.auditionTrackId = null;
    this.auditionLayerIds = ids;
    this.seek(start);
    await this.startTransport(true);
    this.auditionStart = start;
    this.auditionEnd = end;
    this.isAuditionLooping = false;
  }

  private startTimeTracker() {
    if (this.timeUpdateTimer !== null) clearInterval(this.timeUpdateTimer);

    const trackerStartTime = Date.now();

    this.timeUpdateTimer = window.setInterval(() => {
      const isToneRunning = Tone.getTransport().state === 'started';
      const isTakeRunning = this.auditionTakeAudio && !this.auditionTakeAudio.paused;

      if (isToneRunning || isTakeRunning) {
        const sec = isTakeRunning && this.auditionTakeAudio
          ? this.auditionTakeAudio.currentTime + this.auditionOffset
          : Tone.getTransport().seconds;

        if (this.onTimeCallback) {
          this.onTimeCallback(sec);
        }
        const state = useDawStore.getState();
        const end = Math.max(state.duration, ...state.tracks.filter(track => track.activeTakeId && !track.muted).flatMap(track => track.clips.map(clip => clip.startTime + clip.duration)));
        if (!isTakeRunning && !Tone.getTransport().loop && sec >= end) { this.stopTransport(); return; }

        // Real-time Section Gain Automation across selection bounds
        const selection = useDawStore.getState().selection;
        const masterNodes = this.trackNodes.get('master');
        if (masterNodes?.sectionGain) {
          const inSection = selection && sec >= selection.start && sec <= selection.end;
          const targetGain = inSection ? (this.currentSectionGainLinear ?? 1.0) : 1.0;
          if (Math.abs(masterNodes.sectionGain.gain.value - targetGain) > 0.02) {
            masterNodes.sectionGain.gain.rampTo(targetGain, 0.04);
          }
        }

        // Audition boundary enforcement (require at least 150ms elapsed and seeking settled to prevent premature abort)
        if (this.auditionEnd !== null && Date.now() - trackerStartTime > 150) {
          if (this.auditionStart !== null && sec < this.auditionStart - 0.25) {
            return;
          }

          if (sec >= this.auditionEnd) {
            const restartPos = this.auditionStart ?? 0;
            if (this.isAuditionLooping) {
              this.seek(restartPos);
              if (isTakeRunning && this.auditionTakeAudio && this.auditionTakeAudio.paused) {
                this.auditionTakeAudio.play().catch(() => {});
              }
            } else {
              this.pauseTransport();
              this.seek(restartPos);
            }
          }
        }
      }
    }, 25);
  }

  private stopTimeTracker() {
    this.auditionEnd = null;
    this.auditionStart = null;
    if (this.timeUpdateTimer !== null) {
      clearInterval(this.timeUpdateTimer);
      this.timeUpdateTimer = null;
    }
  }

  /**
   * Builds or updates the Tone.js node graph for a track (lazily created if not exists)
   */
  public getOrCreateTrackNodes(trackOrId: string | DAWTrack): TrackAudioNodes {
    const trackId = typeof trackOrId === 'string' ? trackOrId : trackOrId.id;
    let nodes = this.trackNodes.get(trackId);

    if (typeof window === 'undefined' || typeof globalThis.AudioContext === 'undefined') {
      throw new Error('Audio playback is unavailable in this browser');
    }

    let track: DAWTrack | undefined;
    if (typeof trackOrId === 'string') {
      track = useDawStore.getState().tracks.find((t: DAWTrack) => t.id === trackId);
    } else {
      track = trackOrId;
    }

    if (nodes) {
      const currentType = track?.type || useDawStore.getState().tracks.find((t: DAWTrack) => t.id === trackId)?.type;
      if ((currentType === 'pianoroll' || currentType === 'strudel') && !nodes.polySynth) {
        nodes.polySynth = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'triangle' },
          envelope: { attack: 0.02, decay: 0.1, sustain: 0.3, release: 0.8 },
        });
        nodes.polySynth.connect(nodes.input);
      }
      if ((currentType === 'sequencer' || currentType === 'strudel') && !nodes.drumSynths) {
        const kick = new Tone.MembraneSynth({
          pitchDecay: 0.05, octaves: 8, oscillator: { type: 'sine' }, envelope: { attack: 0.001, decay: 0.4, sustain: 0.01, release: 0.4 },
        });
        const snare = new Tone.NoiseSynth({
          noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.2, sustain: 0 },
        });
        const hihat = new Tone.MetalSynth({
          envelope: { attack: 0.001, decay: 0.05, release: 0.05 }, harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5,
        });
        const clap = new Tone.NoiseSynth({
          noise: { type: 'pink' }, envelope: { attack: 0.005, decay: 0.15, sustain: 0 },
        });
        const tom = new Tone.MembraneSynth({
          pitchDecay: 0.03, octaves: 4, oscillator: { type: 'sine' }, envelope: { attack: 0.001, decay: 0.3, sustain: 0.01, release: 0.3 },
        });
        const perc = new Tone.MembraneSynth({
          pitchDecay: 0.02, octaves: 4, oscillator: { type: 'triangle' }, envelope: { attack: 0.001, decay: 0.15, sustain: 0.01, release: 0.2 },
        });
        const crash = new Tone.MetalSynth({
          envelope: { attack: 0.001, decay: 0.8, release: 0.8 }, harmonicity: 3.2, modulationIndex: 64, resonance: 2000, octaves: 2.0,
        });

        kick.connect(nodes.input);
        snare.connect(nodes.input);
        hihat.connect(nodes.input);
        clap.connect(nodes.input);
        tom.connect(nodes.input);
        perc.connect(nodes.input);
        crash.connect(nodes.input);

        nodes.drumSynths = { kick, snare, hihat, clap, tom, perc, crash };
      }
      return nodes;
    }

    const trackType = track?.type || 'stem';
    const volumeVal = track?.volume ?? 0.9;
    const panVal = track?.pan ?? 0;
    const mutedVal = track?.muted ?? false;
    const fxConfig = track?.fx || {
      eq: { enabled: true, low: 0, mid: 0, high: 0 },
      compressor: { enabled: false, threshold: -20, ratio: 4, attack: 0.005, release: 0.2 },
      reverb: { enabled: false, decay: 2.5, wet: 0.3 },
      delay: { enabled: false, delayTime: 0.35, feedback: 0.4, wet: 0.25 },
      distortion: { enabled: false, drive: 0.4, wet: 0.3 },
      chorus: { enabled: false, rate: 1.5, depth: 0.7, wet: 0.3 },
      filter: { enabled: false, cutoff: 8000, resonance: 1.0, type: 'lowpass' },
    };

    const input = new Tone.Gain(1.0);
    const source = track?.id === 'master' ? new Tone.Gain(1).connect(input) : undefined;
    const eq = new Tone.EQ3({
      low: fxConfig.eq.enabled ? fxConfig.eq.low : 0,
      mid: fxConfig.eq.enabled ? fxConfig.eq.mid : 0,
      high: fxConfig.eq.enabled ? fxConfig.eq.high : 0,
    });
    const filter = new Tone.Filter({
      frequency: fxConfig.filter.enabled ? fxConfig.filter.cutoff : 20000,
      type: fxConfig.filter.type,
      Q: fxConfig.filter.resonance,
    });
    const distortion = new Tone.Distortion({
      distortion: fxConfig.distortion.drive,
      wet: fxConfig.distortion.enabled ? fxConfig.distortion.wet : 0,
    });
    const chorus = new Tone.Chorus({
      frequency: fxConfig.chorus.rate,
      depth: fxConfig.chorus.depth,
      wet: fxConfig.chorus.enabled ? fxConfig.chorus.wet : 0,
    });
    const delay = new Tone.FeedbackDelay({
      delayTime: fxConfig.delay.delayTime,
      feedback: fxConfig.delay.feedback,
      wet: fxConfig.delay.enabled ? fxConfig.delay.wet : 0,
    });
    const reverb = new Tone.Reverb({
      decay: fxConfig.reverb.decay,
      wet: fxConfig.reverb.enabled ? fxConfig.reverb.wet : 0,
    });
    const compressor = new Tone.Compressor({
      threshold: fxConfig.compressor.threshold,
      ratio: fxConfig.compressor.enabled ? fxConfig.compressor.ratio : 1,
      attack: fxConfig.compressor.attack,
      release: fxConfig.compressor.release,
    });
    const panner = new Tone.Panner(panVal);
    const volume = new Tone.Volume(Tone.gainToDb(Math.max(0.0001, volumeVal)))
    volume.mute = mutedVal;

    const sectionGain = new Tone.Gain(1.0);
    const meter = new Tone.Meter({ smoothing: 0.8 });
    volume.connect(meter);

    // Connect DSP Serial Chain:
    // Input -> EQ -> Filter -> SectionGain -> Distortion -> Chorus -> Delay -> Reverb -> Compressor -> Panner -> Volume -> MasterCompressor
    input.chain(
      eq,
      filter,
      sectionGain,
      distortion,
      chorus,
      delay,
      reverb,
      compressor,
      panner,
      volume,
      track && track.id === track.activeTakeId ? this.getOrCreateTrackNodes('master').input : this.ensureMasterBus()
    );

    const players = new Map<string, Tone.Player>();
    let polySynth: Tone.PolySynth | undefined;
    let drumSynths: TrackAudioNodes['drumSynths'] | undefined;

    if (trackType === 'pianoroll' || trackType === 'strudel') {
      polySynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.02, decay: 0.1, sustain: 0.3, release: 0.8 },
      });
      polySynth.connect(input);
    }

    if (trackType === 'sequencer' || trackType === 'strudel') {
      const kick = new Tone.MembraneSynth({
        pitchDecay: 0.05, octaves: 8, oscillator: { type: 'sine' }, envelope: { attack: 0.001, decay: 0.4, sustain: 0.01, release: 0.4 },
      });
      const snare = new Tone.NoiseSynth({
        noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.2, sustain: 0 },
      });
      const hihat = new Tone.MetalSynth({
        envelope: { attack: 0.001, decay: 0.05, release: 0.05 }, harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5,
      });
      const clap = new Tone.NoiseSynth({
        noise: { type: 'pink' }, envelope: { attack: 0.005, decay: 0.15, sustain: 0 },
      });
      const tom = new Tone.MembraneSynth({
        pitchDecay: 0.03, octaves: 4, oscillator: { type: 'sine' }, envelope: { attack: 0.001, decay: 0.3, sustain: 0.01, release: 0.3 },
      });
      const perc = new Tone.MembraneSynth({
        pitchDecay: 0.02, octaves: 4, oscillator: { type: 'triangle' }, envelope: { attack: 0.001, decay: 0.15, sustain: 0.01, release: 0.2 },
      });
      const crash = new Tone.MetalSynth({
        envelope: { attack: 0.001, decay: 0.8, release: 0.8 }, harmonicity: 3.2, modulationIndex: 64, resonance: 2000, octaves: 2.0,
      });

      kick.connect(input);
      snare.connect(input);
      hihat.connect(input);
      clap.connect(input);
      tom.connect(input);
      perc.connect(input);
      crash.connect(input);

      drumSynths = { kick, snare, hihat, clap, tom, perc, crash };
    }

    nodes = {
      input,
      source,
      eq,
      filter,
      sectionGain,
      distortion,
      chorus,
      delay,
      reverb,
      compressor,
      panner,
      volume,
      meter,
      players,
      polySynth,
      drumSynths,
    };

    this.trackNodes.set(trackId, nodes);
    return nodes;
  }

  public level(trackId: string): number {
    const value = this.trackNodes.get(trackId)?.meter.getValue();
    return typeof value === 'number' ? value : -Infinity;
  }

  public getCurrentTime(): number {
    if (this.auditionTakeAudio && !this.auditionTakeAudio.paused) {
      return this.auditionTakeAudio.currentTime + this.auditionOffset;
    }
    return Tone.getTransport().seconds;
  }

  public setSectionGain(gainDb: number, trackId = 'master') {
    const linear = gainDb <= -24 ? 0 : Tone.dbToGain(gainDb);
    this.currentSectionGainLinear = Math.max(0, Math.min(2.0, linear));
    const nodes = this.getOrCreateTrackNodes(trackId);
    if (nodes?.sectionGain) {
      const sec = this.getCurrentTime();
      const selection = useDawStore.getState().selection;
      const inSection = selection && sec >= selection.start && sec <= selection.end;
      const targetGain = inSection ? this.currentSectionGainLinear : 1.0;
      nodes.sectionGain.gain.rampTo(targetGain, 0.04);
    }
  }

  public setSectionTone(lowDb: number, midDb: number, highDb: number, trackId = 'master') {
    const nodes = this.getOrCreateTrackNodes(trackId);
    if (nodes?.eq) {
      nodes.eq.low.rampTo(Math.max(-24, Math.min(12, lowDb)), 0.05);
      nodes.eq.mid.rampTo(Math.max(-24, Math.min(12, midDb)), 0.05);
      nodes.eq.high.rampTo(Math.max(-24, Math.min(12, highDb)), 0.05);
    }
  }

  /**
   * Client-side lossless extraction of an audio slice into a 16-bit PCM WAV Blob
   */
  public async extractAudioSection(
    audioUrl: string,
    startTime: number,
    endTime: number
  ): Promise<{ blobUrl: string; duration: number }> {
    const res = await fetch(audioUrl);
    const arrayBuffer = await res.arrayBuffer();
    const rawCtx = (Tone.getContext().rawContext as AudioContext) || new (window.AudioContext || (window as any).webkitAudioContext)();
    const audioBuffer = await rawCtx.decodeAudioData(arrayBuffer);

    const safeStart = Math.max(0, Math.min(startTime, audioBuffer.duration));
    const safeEnd = Math.max(safeStart + 0.05, Math.min(endTime, audioBuffer.duration));
    const duration = safeEnd - safeStart;

    const sampleRate = audioBuffer.sampleRate;
    const startSample = Math.floor(safeStart * sampleRate);
    const endSample = Math.floor(safeEnd * sampleRate);
    const numSamples = Math.max(1, endSample - startSample);
    const numChannels = audioBuffer.numberOfChannels;

    const channels: Float32Array[] = [];
    for (let c = 0; c < numChannels; c++) {
      channels.push(audioBuffer.getChannelData(c).slice(startSample, endSample));
    }

    const wavBlob = this.encodeWavBlob(channels, sampleRate, numSamples);
    const blobUrl = URL.createObjectURL(wavBlob);

    return { blobUrl, duration };
  }

  public encodeWavBlob(channels: Float32Array[], sampleRate: number, numSamples: number, floating = false): Blob {
    const numChannels = channels.length;
    const bytesPerSample = floating ? 4 : 2;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = numSamples * blockAlign;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    const writeStr = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, floating ? 3 : 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bytesPerSample * 8, true);
    writeStr(36, 'data');
    view.setUint32(40, dataSize, true);

    let offset = 44;
    for (let i = 0; i < numSamples; i++) {
      for (let c = 0; c < numChannels; c++) {
        const sample = channels[c][i] || 0;
        if (floating) view.setFloat32(offset, sample, true);
        else { const s = Math.max(-1, Math.min(1, sample)); view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
        offset += bytesPerSample;
      }
    }

    return new Blob([buffer], { type: 'audio/wav' });
  }

  /**
   * Syncs an audio clip to Tone.Transport
   */
  public loadClip(trackId: string, clipId: string, url: string, startTime: number, offset = 0, duration?: number): Promise<void> {
    const key = `${trackId}:${clipId}`;
    const signature = JSON.stringify([url, startTime, offset, duration]);
    const previous = this.clipLoads.get(key);
    if (previous?.signature === signature) return previous.promise;
    const project = this.project;
    const entry = { signature, promise: Promise.resolve() };
    entry.promise = Promise.resolve().then(async () => {
      if (!this.offline) await this.init();
      if (project !== this.project || this.clipLoads.get(key) !== entry) return;
      const nodes = this.getOrCreateTrackNodes(trackId);
      nodes.players.get(clipId)?.dispose();
      const player = new Tone.Player({ autostart: false });
      player.connect(nodes.source ?? nodes.input);
      nodes.players.set(clipId, player);
      try {
        await player.load(url);
        if (project !== this.project || this.clipLoads.get(key) !== entry || nodes.players.get(clipId) !== player) return;
        player.sync().start(startTime, offset, duration);
      } catch (error) {
        if (project !== this.project || this.clipLoads.get(key) !== entry) return;
        nodes.players.delete(clipId);
        player.dispose();
        throw error;
      }
    }).finally(() => {
      if (this.loading.get(key) === entry.promise) this.loading.delete(key);
    });
    this.clipLoads.set(key, entry);
    this.loading.set(key, entry.promise);
    return entry.promise.catch(error => {
      if (this.clipLoads.get(key) === entry) this.clipLoads.delete(key);
      throw error;
    });
  }

  /**
   * Re-syncs player transport bounds when clip is dragged, trimmed or slip-edited
   */
  public updateClipTransport(trackId: string, clipId: string, startTime: number, offset = 0, duration?: number) {
    const trackNode = this.trackNodes.get(trackId);
    if (!trackNode) return;
    const player = trackNode.players.get(clipId);
    if (player && player.loaded) {
      player.unsync();
      player.sync().start(startTime, offset, duration);
    }
  }

  /**
   * Play real-time synthesis note preview or triggered note
   */
  public async playNote(pitch: string, duration = '8n', velocity = 0.8, trackId?: string) {
    await this.resumeAudioContext();
    const targetTrackId = trackId || useDawStore.getState().selectedTrackId || 'master';
    const trackNode = this.getOrCreateTrackNodes(targetTrackId);
    if (!trackNode.polySynth) {
      trackNode.polySynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.02, decay: 0.1, sustain: 0.3, release: 0.8 },
      });
      trackNode.polySynth.connect(trackNode.input);
    }
    trackNode.polySynth.triggerAttackRelease(pitch, duration, undefined, velocity);
  }

  public triggerNote(trackId: string, pitch: string, duration = '8n', velocity = 0.8) {
    this.playNote(pitch, duration, velocity, trackId);
  }

  /**
   * Trigger drum step hit directly for an instrument voice
   */
  public async triggerDrumStep(instrument: string, time?: number, velocity = 0.8, trackId?: string) {
    await this.resumeAudioContext();
    const targetTrackId = trackId || useDawStore.getState().selectedTrackId || 'master';
    const trackNode = this.getOrCreateTrackNodes(targetTrackId);
    if (!trackNode.drumSynths) {
      const kick = new Tone.MembraneSynth({
        pitchDecay: 0.05, octaves: 8, oscillator: { type: 'sine' }, envelope: { attack: 0.001, decay: 0.4, sustain: 0.01, release: 0.4 },
      });
      const snare = new Tone.NoiseSynth({
        noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.2, sustain: 0 },
      });
      const hihat = new Tone.MetalSynth({
        envelope: { attack: 0.001, decay: 0.05, release: 0.05 }, harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5,
      });
      const clap = new Tone.NoiseSynth({
        noise: { type: 'pink' }, envelope: { attack: 0.005, decay: 0.15, sustain: 0 },
      });
      const tom = new Tone.MembraneSynth({
        pitchDecay: 0.03, octaves: 4, oscillator: { type: 'sine' }, envelope: { attack: 0.001, decay: 0.3, sustain: 0.01, release: 0.3 },
      });
      const perc = new Tone.MembraneSynth({
        pitchDecay: 0.02, octaves: 4, oscillator: { type: 'triangle' }, envelope: { attack: 0.001, decay: 0.15, sustain: 0.01, release: 0.2 },
      });
      const crash = new Tone.MetalSynth({
        envelope: { attack: 0.001, decay: 0.8, release: 0.8 }, harmonicity: 3.2, modulationIndex: 64, resonance: 2000, octaves: 2.0,
      });

      kick.connect(trackNode.input);
      snare.connect(trackNode.input);
      hihat.connect(trackNode.input);
      clap.connect(trackNode.input);
      tom.connect(trackNode.input);
      perc.connect(trackNode.input);
      crash.connect(trackNode.input);

      trackNode.drumSynths = { kick, snare, hihat, clap, tom, perc, crash };
    }

    this.playDrum(trackNode, instrument, time ?? Tone.now(), velocity);
  }

  private playDrum(trackNode: TrackAudioNodes, instrument: string, triggerTime: number, velocity: number) {
    if (!trackNode.drumSynths) throw new Error('Drum instrument is unavailable');
    const inst = instrument.toLowerCase();

    if (inst === 'kick' || inst === 'bd') {
      trackNode.drumSynths.kick.triggerAttackRelease('C1', '8n', triggerTime, velocity);
    } else if (inst === 'snare' || inst === 'sd') {
      trackNode.drumSynths.snare.triggerAttackRelease('8n', triggerTime, velocity);
    } else if (inst === 'hihat' || inst === 'hi-hat' || inst === 'hh') {
      trackNode.drumSynths.hihat.triggerAttackRelease('16n', triggerTime, velocity);
    } else if (inst === 'clap' || inst === 'cp') {
      trackNode.drumSynths.clap.triggerAttackRelease('16n', triggerTime, velocity);
    } else if (inst === 'tom') {
      trackNode.drumSynths.tom.triggerAttackRelease('G1', '8n', triggerTime, velocity);
    } else if (inst === 'perc' || inst === 'rim') {
      trackNode.drumSynths.perc.triggerAttackRelease('G2', '16n', triggerTime, velocity);
    } else if (inst === 'crash' || inst === 'cymbal' || inst === 'cr') {
      trackNode.drumSynths.crash.triggerAttackRelease('8n', triggerTime, velocity);
    }
  }

  public triggerDrum(trackIdOrVoice: string, voiceOrVelocity?: string | number, maybeVelocity?: number) {
    if (typeof voiceOrVelocity === 'number' || voiceOrVelocity === undefined) {
      // Called as triggerDrum(voice, velocity)
      this.triggerDrumStep(trackIdOrVoice, undefined, (voiceOrVelocity as number) || 0.8);
    } else {
      // Called as triggerDrum(trackId, voice, velocity)
      this.triggerDrumStep(voiceOrVelocity, undefined, maybeVelocity || 0.8, trackIdOrVoice);
    }
  }

  /**
   * Schedules a 16-step sequencer pattern on the transport
   */
  public scheduleSequencer(track: DAWTrack) {
    const existingScheduleId = this.sequencerScheduleIds.get(track.id);
    if (existingScheduleId !== undefined) {
      Tone.getTransport().clear(existingScheduleId);
      this.sequencerScheduleIds.delete(track.id);
    }

    if (track.type !== 'sequencer' || !track.sequencerVoices) return;

    const voices = track.sequencerVoices;
    const trackNode = this.getOrCreateTrackNodes(track);

    const scheduleId = Tone.getTransport().scheduleRepeat((time) => {
      const ticks = Tone.getTransport().getTicksAtTime(time);
      const step = Math.floor(ticks / (Tone.getTransport().PPQ / BEAT_STEPS)) % DRUM_STEPS;
      if (!this.offline) Tone.getDraw().schedule(() => {
        if (this.onStepCallback) {
          this.onStepCallback(step);
        }
        useDawStore.getState().setSequencerStep(track.id, step);
      }, time);

      if (trackNode.drumSynths) {
        voices.forEach((voice) => {
          if (voice.steps[step] && !voice.muted) {
            this.playDrum(trackNode, voice.name, time, voice.velocity[step] ?? 0.8);
          }
        });
      }

    }, '16n');

    this.sequencerScheduleIds.set(track.id, scheduleId);
  }

  /**
   * Schedules a Strudel live coding algorithmic pattern on Tone.Transport
   */
  public scheduleStrudel(trackId: string, patternCode: string, bpm?: number) {
    const existingScheduleId = this.strudelScheduleIds.get(trackId);
    if (existingScheduleId !== undefined) {
      Tone.getTransport().clear(existingScheduleId);
      this.strudelScheduleIds.delete(trackId);
    }

    if (!patternCode || !patternCode.trim()) return;

    if (bpm && bpm > 0) {
      this.setBpm(bpm);
    }

    const parsed = parseStrudelPattern(patternCode);
    if (!parsed.events || parsed.events.length === 0) return;
    const track = useDawStore.getState().tracks.find(track => track.id === trackId);
    const nodes = this.getOrCreateTrackNodes(track ?? trackId);

    const currentBpm = bpm && bpm > 0 ? bpm : (Tone.getTransport()?.bpm?.value || 120);
    const baseCycleSeconds = (60 / currentBpm) * 4;
    const cycleDurationSeconds = baseCycleSeconds / Math.max(0.1, parsed.rateModifier);

    if (Tone.getTransport()?.scheduleRepeat) {
      const scheduleId = Tone.getTransport().scheduleRepeat((time) => {
        for (const event of parsed.events) {
          const eventTime = time + event.time * cycleDurationSeconds;
          const eventDuration = Math.max(0.05, event.duration * cycleDurationSeconds);

          if (event.type === 'sound') {
            this.playDrum(nodes, event.value, eventTime, 0.8);
          } else if (event.type === 'note') {
            nodes.polySynth?.triggerAttackRelease(event.value, eventDuration, eventTime, 0.8);
          }
        }
      }, cycleDurationSeconds);

      this.strudelScheduleIds.set(trackId, scheduleId);
    }
  }

  public schedulePiano(track: DAWTrack) {
    for (const id of this.pianoScheduleIds.get(track.id) ?? []) Tone.getTransport().clear(id);
    this.pianoScheduleIds.delete(track.id);
    if (!track.pianoRollNotes?.length) return;
    const nodes = this.getOrCreateTrackNodes(track);
    const schedules = track.pianoRollNotes.map(note => Tone.getTransport().scheduleRepeat(time => {
      nodes.polySynth?.triggerAttackRelease(note.pitch, Tone.Time(note.duration * Tone.getTransport().PPQ / BEAT_STEPS, 'i').toSeconds(), time, note.velocity);
    }, '2m', `${note.startTime * Tone.getTransport().PPQ / BEAT_STEPS}i`));
    this.pianoScheduleIds.set(track.id, schedules);
  }

  public scheduleTrack(track: DAWTrack) {
    if (track.type === 'sequencer') this.scheduleSequencer(track);
    if (track.type === 'pianoroll') this.schedulePiano(track);
    if (track.type === 'strudel') this.scheduleStrudel(track.id, track.strudelCode ?? '');
  }

  public async render(trackIds: string[], duration: number, commit = false): Promise<Blob> {
    if (!trackIds.length || !Number.isFinite(duration) || duration <= 0) throw new Error('Select reference lanes with a valid duration');
    const state = useDawStore.getState();
    const tracks = trackIds.map(id => {
      const track = state.tracks.find(track => track.id === id);
      if (!track) throw new Error('A reference lane is unavailable');
      return structuredClone(track);
    });
    this.pauseTransport();
    const original = Tone.getContext();
    const buffers = new Map<string, AudioBuffer>();
    for (const track of tracks) for (const clip of track.clips) {
      if (buffers.has(clip.url)) continue;
      const response = await fetch(clip.url);
      if (!response.ok) throw new Error('Could not load reference audio');
      buffers.set(clip.url, await original.decodeAudioData(await response.arrayBuffer()));
    }
    const context = new Tone.OfflineContext(2, duration, original.sampleRate);
    const engine = new DAWEngine(true);
    const solo = state.tracks.some(track => track.solo);
    try {
      Tone.setContext(context);
      context.transport.bpm.value = state.bpm;
      for (const track of tracks) {
        const nodes = engine.getOrCreateTrackNodes(track);
        engine.updateTrackFx(track.id, track.fx);
        nodes.volume.mute = (track.id !== 'master' && track.muted) || (solo && !track.solo && !(track.id === 'master' && state.tracks.some(child => child.id === child.activeTakeId && child.solo)));
        if (commit && track.id === 'master') {
          nodes.input.disconnect();
          nodes.input.toDestination();
        }
        if (!commit && track.id === 'master' && state.selection) {
          nodes.sectionGain?.gain.setValueAtTime(state.sectionGain, state.selection.start);
          nodes.sectionGain?.gain.setValueAtTime(1, state.selection.end);
        }
        if (track.id === 'master') {
          const muted = track.muted || (solo && !track.solo);
          (nodes.source ?? nodes.input).gain.setValueAtTime(muted ? 0 : 1, 0);
          const boundaries = [...new Set(state.originals.flatMap(region => [region.start, region.end]))].sort((a,b) => a-b);
          for (const time of boundaries) (nodes.source ?? nodes.input).gain.setValueAtTime(muted || state.originals.some(region => time >= region.start && time < region.end) ? 0 : 1, time);
        }
        for (const clip of track.clips) {
          const player = new Tone.Player(buffers.get(clip.url)!);
          player.connect(nodes.source ?? nodes.input);
          nodes.players.set(clip.id, player);
          player.sync().start(clip.startTime, clip.offset, clip.duration);
        }
        engine.scheduleTrack(track);
      }
      context.transport.start(0);
      Tone.setContext(original);
      await Promise.all([...engine.trackNodes.values()].map(nodes => nodes.reverb.ready));
      const result = await context.render();
      const channels = Array.from({ length: result.numberOfChannels }, (_, index) => result.getChannelData(index));
      if (!channels.some(channel => channel.some(value => Math.abs(value) > 0))) throw new Error('Selected reference lanes contain no audible sound');
      return this.encodeWavBlob(channels, result.sampleRate, result.length, commit);
    } finally {
      for (const track of tracks) engine.disposeTrack(track.id, context.transport);
      engine.masterCompressor?.dispose();
      engine.masterLimiter?.dispose();
      Tone.setContext(original);
      context.dispose();
    }
  }

  /**
   * Update mixer parameters in real-time and evaluate solo logic
   */
}
