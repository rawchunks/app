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
}
