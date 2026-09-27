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
}
