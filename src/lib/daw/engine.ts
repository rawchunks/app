import * as Tone from 'tone';
import { DAWTrack, DSPFxConfig, useDawStore } from './store';
import { masterArrangement } from './takes';
import { parseStrudelPattern } from './strudelEvaluator';
import { bus } from '../bus';
import { BEAT_STEPS, DRUM_STEPS } from './notes';
import { abortBackgroundAudioFetches, fetchAudioArrayBuffer, getDecodedAudioBuffer } from './peaks';

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
  private lastMasterSegmentsKey = '';
  private loading = new Map<string, Promise<void>>();
  private clipLoads = new Map<string, { trackId: string; url: string; signature: string; promise: Promise<void> }>();
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

  private getAudibleLoadingPromises(): Promise<void>[] {
    const state = useDawStore.getState();
    const tracks = state.tracks;
    if (tracks.length === 0) {
      return [...this.loading.values()];
    }

    const audibleTrackIds = new Set<string>();
    if (this.auditionLayerIds && this.auditionLayerIds.length > 0) {
      for (const id of this.auditionLayerIds) audibleTrackIds.add(id);
      if (tracks.some((t) => t.id === t.activeTakeId && this.auditionLayerIds!.includes(t.id))) {
        audibleTrackIds.add('master');
      }
    } else if (this.auditionTrackId) {
      audibleTrackIds.add(this.auditionTrackId);
      if (tracks.some((t) => t.id === this.auditionTrackId && t.id === t.activeTakeId)) {
        audibleTrackIds.add('master');
      }
    } else {
      const hasSolo = tracks.some((t) => Boolean(t.mixer?.solo ?? t.solo));
      if (hasSolo) {
        for (const t of tracks) {
          if (Boolean(t.mixer?.solo ?? t.solo)) {
            audibleTrackIds.add(t.id);
            if (t.id === t.activeTakeId) audibleTrackIds.add('master');
          }
        }
      } else {
        const masterTrack = tracks.find((t) => t.id === 'master');
        const masterMuted = Boolean(masterTrack?.mixer?.muted ?? masterTrack?.muted);
        if (!masterMuted) {
          audibleTrackIds.add('master');
        }
        for (const t of tracks) {
          const isMuted = Boolean(t.mixer?.muted ?? t.muted);
          const hasActiveOverlay = Boolean(
            t.activeTakeId ||
            t.type === 'sample' ||
            (t.activeVersionTakeId && t.activeVersionTakeId !== 'ORG')
          );
          if (!isMuted && (hasActiveOverlay || (masterMuted && t.id !== 'master'))) {
            audibleTrackIds.add(t.id);
          }
        }
      }
    }

    for (const t of tracks) {
      if (!audibleTrackIds.has(t.id) || !Array.isArray(t.clips)) continue;
      for (const clip of t.clips) {
        if (!clip.url) continue;
        const key = `${t.id}:${clip.id}`;
        const loaded = this.trackNodes.get(t.id)?.players.get(clip.id)?.loaded;
        if (!loaded && !this.loading.has(key)) {
          void this.loadClip(t.id, clip.id, clip.url, clip.startTime, clip.offset, clip.duration);
        }
      }
    }

    if (this.loading.size === 0) return [];

    const result: Promise<void>[] = [];
    for (const [key, loadPromise] of this.loading.entries()) {
      const meta = this.clipLoads.get(key);
      const trackId = meta?.trackId ?? key.split(':')[0];
      if (audibleTrackIds.has(trackId)) {
        if (meta?.url) {
          void fetchAudioArrayBuffer(meta.url, 'high').catch(() => {});
        }
        result.push(loadPromise);
      }
    }
    return result;
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
    let pending = this.getAudibleLoadingPromises();
    while (pending.length) {
      pending.forEach(load => waited.add(load));
      await Promise.all(pending);
      if (project !== this.project || this.targetTransportState !== 'started') return;
      pending = this.getAudibleLoadingPromises().filter(load => !waited.has(load));
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
    } else if (waited.size > 0) {
      Tone.getTransport().seconds = Tone.getTransport().seconds;
    }

    this.startTimeTracker();
  }

  public syncOriginals() {
    const transport = Tone.getTransport(), nodes = this.trackNodes.get('master');
    for (const id of this.originalScheduleIds) transport.clear(id);
    this.originalScheduleIds = [];
    if (!nodes) return;
    const state = useDawStore.getState();
    const extendClips = state.tracks
      .filter(track => track.activeTakeId && !track.muted && (state.takes ?? []).some(t => t.id === track.activeTakeId && t.task === 'extend'))
      .flatMap(track => track.clips.map(clip => ({ startTime: clip.startTime, duration: clip.duration })));
    const layout = masterArrangement(state.duration, extendClips);
    const segKey = JSON.stringify(layout.segments);
    const mainPlayer = nodes.players?.get('clip-master');
    if (mainPlayer?.loaded && segKey !== this.lastMasterSegmentsKey && (layout.segments.length > 1 || this.lastMasterSegmentsKey !== '')) {
      this.lastMasterSegmentsKey = segKey;
      for (const [id, p] of [...nodes.players.entries()]) {
        if (id.startsWith('clip-master-seg-')) {
          p.dispose();
          nodes.players.delete(id);
        }
      }
      const firstSeg = layout.segments[0];
      mainPlayer.unsync();
      if (firstSeg) {
        mainPlayer.sync().start(firstSeg.startTime, firstSeg.offset, firstSeg.duration);
      }
      for (let i = 1; i < layout.segments.length; i++) {
        const seg = layout.segments[i];
        const segPlayer = new Tone.Player(mainPlayer.buffer);
        segPlayer.connect(nodes.source ?? nodes.input);
        segPlayer.sync().start(seg.startTime, seg.offset, seg.duration);
        nodes.players.set(`clip-master-seg-${i}`, segPlayer);
      }
    }
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
    if (this.auditionTrackId || this.auditionLayerIds) {
      this.auditionTrackId = null;
      this.auditionLayerIds = null;
      this.updateTrackMixer('master');
    }
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
        const extendClips = state.tracks
          .filter(track => track.activeTakeId && !track.muted && (state.takes ?? []).some(t => t.id === track.activeTakeId && t.task === 'extend'))
          .flatMap(track => track.clips.map(clip => ({ startTime: clip.startTime, duration: clip.duration })));
        const masterEnd = masterArrangement(state.duration, extendClips).duration;
        const end = Math.max(masterEnd, ...state.tracks.filter(track => track.activeTakeId && !track.muted).flatMap(track => track.clips.map(clip => clip.startTime + clip.duration)));
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
    const audioBuffer = await getDecodedAudioBuffer(audioUrl, 'high');

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
    const entry = { trackId, url, signature, promise: Promise.resolve() };
    entry.promise = Promise.resolve().then(async () => {
      await this.init();
      if (project !== this.project || this.clipLoads.get(key) !== entry) return;
      const nodes = this.getOrCreateTrackNodes(trackId);
      nodes.players.get(clipId)?.dispose();
      const player = new Tone.Player({ autostart: false });
      player.connect(nodes.source ?? nodes.input);
      nodes.players.set(clipId, player);
      const priority =
        trackId === 'master' ||
        this.auditionTrackId === trackId ||
        Boolean(this.auditionLayerIds?.includes(trackId))
          ? 'high'
          : 'normal';
      try {
        if (player.buffer && typeof player.buffer.set === 'function') {
          const audioBuffer = await getDecodedAudioBuffer(url, priority);
          if (project !== this.project || this.clipLoads.get(key) !== entry || nodes.players.get(clipId) !== player) return;
          player.buffer.set(audioBuffer);
        } else {
          await player.load(url);
          if (project !== this.project || this.clipLoads.get(key) !== entry || nodes.players.get(clipId) !== player) return;
        }
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

  public async render(trackIds: string[], duration: number, commit = false, startTime = 0): Promise<Blob> {
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
          const sectionGainLinear = state.sectionGain <= -24 ? 0 : Math.max(0, Math.min(2.0, Tone.dbToGain(state.sectionGain)));
          nodes.sectionGain?.gain.setValueAtTime(sectionGainLinear, state.selection.start);
          nodes.sectionGain?.gain.setValueAtTime(1, state.selection.end);
        }
        if (track.id === 'master') {
          const muted = track.muted || (solo && !track.solo);
          (nodes.source ?? nodes.input).gain.setValueAtTime(muted ? 0 : 1, 0);
          const boundaries = [...new Set(state.originals.flatMap(region => [region.start, region.end]))].sort((a,b) => a-b);
          for (const time of boundaries) (nodes.source ?? nodes.input).gain.setValueAtTime(muted || state.originals.some(region => time >= region.start && time < region.end) ? 0 : 1, time);
        }
        const extendClips = track.id === 'master'
          ? state.tracks
              .filter(t => t.activeTakeId && !t.muted && trackIds.includes(t.id) && (state.takes ?? []).some(take => take.id === t.activeTakeId && take.task === 'extend'))
              .flatMap(t => t.clips.map(c => ({ startTime: c.startTime, duration: c.duration })))
          : [];
        const masterSegs = track.id === 'master' && extendClips.length > 0
          ? masterArrangement(state.duration, extendClips).segments
          : null;
        if (masterSegs && masterSegs.length > 1 && track.clips[0]) {
          const clip = track.clips[0];
          masterSegs.forEach((seg, idx) => {
            const player = new Tone.Player(buffers.get(clip.url)!);
            player.connect(nodes.source ?? nodes.input);
            nodes.players.set(`${clip.id}-${idx}`, player);
            player.sync().start(seg.startTime, seg.offset, seg.duration);
          });
        } else {
          for (const clip of track.clips) {
            const player = new Tone.Player(buffers.get(clip.url)!);
            player.connect(nodes.source ?? nodes.input);
            nodes.players.set(clip.id, player);
            player.sync().start(clip.startTime, clip.offset, clip.duration);
          }
        }
        engine.scheduleTrack(track);
      }
      context.transport.start(0);
      Tone.setContext(original);
      await Promise.all([...engine.trackNodes.values()].map(nodes => nodes.reverb.ready));
      const result = await context.render();
      const startSample = startTime > 0 ? Math.max(0, Math.min(result.length, Math.round(startTime * result.sampleRate))) : 0;
      const numSamples = result.length - startSample;
      const channels = Array.from({ length: result.numberOfChannels }, (_, index) => {
        const data = result.getChannelData(index);
        return startSample > 0 ? data.subarray(startSample) : data;
      });
      if (!channels.some(channel => channel.some(value => Math.abs(value) > 0))) throw new Error('Selected reference lanes contain no audible sound');
      return this.encodeWavBlob(channels, result.sampleRate, numSamples, commit);
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
  public updateTrackMixer(
    trackId: string,
    volumeOrMixer?: number | { volume?: number; pan?: number; muted?: boolean; solo?: boolean },
    panArg?: number,
    mutedArg?: boolean,
    soloArg?: boolean
  ) {
    this.getOrCreateTrackNodes(trackId);

    let volumeVal: number | undefined;
    let panVal: number | undefined;
    let mutedVal: boolean | undefined;
    let soloVal: boolean | undefined;

    if (typeof volumeOrMixer === 'object' && volumeOrMixer !== null) {
      volumeVal = volumeOrMixer.volume;
      panVal = volumeOrMixer.pan;
      mutedVal = volumeOrMixer.muted;
      soloVal = volumeOrMixer.solo;
    } else if (typeof volumeOrMixer === 'number') {
      volumeVal = volumeOrMixer;
      panVal = panArg;
      mutedVal = mutedArg;
      soloVal = soloArg;
    }

    const storeTracks = useDawStore.getState().tracks;

    const tracksToEval = storeTracks.length > 0 ? storeTracks : Array.from(this.trackNodes.keys()).map((id) => ({
      id,
      volume: id === trackId && volumeVal !== undefined ? volumeVal : 0.9,
      pan: id === trackId && panVal !== undefined ? panVal : 0,
      muted: id === trackId && mutedVal !== undefined ? mutedVal : false,
      solo: id === trackId && soloVal !== undefined ? soloVal : false,
      mixer: id === trackId ? { volume: volumeVal ?? 0.9, pan: panVal ?? 0, muted: mutedVal ?? false, solo: soloVal ?? false } : undefined,
    }));

    const hasSolo = tracksToEval.some((t: any) => {
      const isTrackSolo = t.id === trackId && soloVal !== undefined ? soloVal : (t.mixer?.solo ?? t.solo ?? false);
      return Boolean(isTrackSolo);
    });

    const allTrackIds = new Set([
      ...tracksToEval.map((t: any) => t.id),
      ...Array.from(this.trackNodes.keys()),
    ]);

    for (const id of allTrackIds) {
      const trackObj = tracksToEval.find((t: any) => t.id === id) as any;
      const isMuted = id === trackId && mutedVal !== undefined
        ? mutedVal
        : Boolean(trackObj?.mixer?.muted ?? trackObj?.muted ?? false);
      const isSoloed = id === trackId && soloVal !== undefined
        ? soloVal
        : Boolean(trackObj?.mixer?.solo ?? trackObj?.solo ?? false);

      let nodes = this.trackNodes.get(id);
      if (!nodes && isSoloed && Array.isArray(trackObj?.clips)) {
        for (const clip of trackObj.clips) {
          if (clip.url) {
            void this.loadClip(id, clip.id, clip.url, clip.startTime, clip.offset, clip.duration);
          }
        }
        nodes = this.trackNodes.get(id);
      }
      if (!nodes) continue;

      const vol = id === trackId && volumeVal !== undefined
        ? volumeVal
        : trackObj?.mixer?.volume ?? trackObj?.volume ?? 0.9;

      const pan = id === trackId && panVal !== undefined
        ? panVal
        : trackObj?.mixer?.pan ?? trackObj?.pan ?? 0;

      const targetDb = Tone.gainToDb(Math.max(0.0001, vol));
      nodes.volume.volume.rampTo(targetDb, 0.05);
      nodes.panner.pan.rampTo(pan, 0.05);

      const childSoloed = id === 'master' && tracksToEval.some((track: any) => track.id === track.activeTakeId && (track.id === trackId && soloVal !== undefined ? soloVal : track.solo));
      const shouldBeMuted = this.auditionLayerIds
        ? (id !== 'master' && isMuted) || (!this.auditionLayerIds.includes(id) && !(id === 'master' && tracksToEval.some((track: any) => track.id === track.activeTakeId && this.auditionLayerIds!.includes(track.id))))
        : this.auditionTrackId
        ? id !== this.auditionTrackId && !(id === 'master' && tracksToEval.some((track: any) => track.id === this.auditionTrackId && track.id === track.activeTakeId))
        : (id !== 'master' && isMuted) || (hasSolo && !isSoloed && !childSoloed);
      nodes.volume.mute = shouldBeMuted;
    }
    this.syncOriginals();
  }

  /**
   * Resets DAW Engine state for a clean project switch or editor re-entry.
   */
  public resetProject() {
    this.project++;
    this.pauseTransport();
    this.stopAuditionTake();
    for (const id of this.originalScheduleIds) Tone.getTransport().clear(id);
    this.originalScheduleIds = [];
    this.lastMasterSegmentsKey = '';
    this.loading.clear();
    this.clipLoads.clear();
    if (!this.offline) abortBackgroundAudioFetches();
    this.disposeTrack('master');

    for (const id of [...this.trackNodes.keys()]) {
      if (id !== 'master') this.disposeTrack(id);
    }
    Tone.getTransport().stop();
    Tone.getTransport().seconds = 0;

    // Reset master DSP nodes
    const masterNodes = this.trackNodes.get('master');
    if (masterNodes) {
      try {
        masterNodes.volume.volume.rampTo(0, 0.05);
        masterNodes.volume.mute = false;
        masterNodes.filter.frequency.rampTo(20000, 0.05);
        masterNodes.panner.pan.rampTo(0, 0.05);
        masterNodes.eq.low.rampTo(0, 0.05);
        masterNodes.eq.mid.rampTo(0, 0.05);
        masterNodes.eq.high.rampTo(0, 0.05);
        masterNodes.sectionGain?.gain.rampTo(1.0, 0.05);
      } catch {}
    }

    Tone.getDestination().mute = false;
    this.isAuditionLooping = false;
    this.auditionStart = null;
    this.auditionEnd = null;
    this.setLoop(false);
    this.currentSectionGainLinear = 1.0;
  }

  /**
   * Audition an individual track exclusively (soloed)
   */
  public auditionTrack(trackId: string, startSec?: number, endSec?: number) {
    const store = useDawStore.getState();
    const tracks = store.tracks;
    if (!tracks.some(track => track.id === trackId)) return;
    this.auditionLayerIds = null;
    this.auditionTrackId = trackId;
    this.updateTrackMixer(trackId);

    if (startSec !== undefined && startSec >= 0) {
      this.seek(startSec);
    }

    if (endSec !== undefined && endSec > (startSec ?? 0)) {
      this.setLoop(true, startSec ?? 0, endSec);
    }

    void this.startTransport(true);
    useDawStore.setState({ auditionId: trackId });
  }

  /**
   * Update DSP effects parameters in real-time
   */
  public updateTrackFx(trackId: string, fx: DSPFxConfig): void;
  public updateTrackFx<K extends keyof DSPFxConfig>(trackId: string, fxKey: K, partial: Partial<DSPFxConfig[K]>): void;
  public updateTrackFx(trackId: string, fxOrKey: any, partial?: any) {
    const nodes = this.getOrCreateTrackNodes(trackId);

    if (typeof fxOrKey === 'string') {
      const fxKey = fxOrKey as keyof DSPFxConfig;
      if (fxKey === 'eq' && partial) {
        if (partial.low !== undefined) nodes.eq.low.rampTo(partial.low, 0.05);
        if (partial.mid !== undefined) nodes.eq.mid.rampTo(partial.mid, 0.05);
        if (partial.high !== undefined) nodes.eq.high.rampTo(partial.high, 0.05);
      } else if (fxKey === 'filter' && partial) {
        if (partial.cutoff !== undefined) nodes.filter.frequency.rampTo(partial.cutoff, 0.05);
        if (partial.resonance !== undefined) nodes.filter.Q.rampTo(partial.resonance, 0.05);
        if (partial.type !== undefined) nodes.filter.type = partial.type;
      } else if (fxKey === 'distortion' && partial) {
        if (partial.drive !== undefined) nodes.distortion.distortion = partial.drive;
        if (partial.wet !== undefined) nodes.distortion.wet.rampTo(partial.wet, 0.05);
      } else if (fxKey === 'chorus' && partial) {
        if (partial.rate !== undefined) nodes.chorus.frequency.rampTo(partial.rate, 0.05);
        if (partial.depth !== undefined) nodes.chorus.depth = partial.depth;
        if (partial.wet !== undefined) nodes.chorus.wet.rampTo(partial.wet, 0.05);
      } else if (fxKey === 'delay' && partial) {
        if (partial.delayTime !== undefined) nodes.delay.delayTime.rampTo(partial.delayTime, 0.05);
        if (partial.feedback !== undefined) nodes.delay.feedback.rampTo(partial.feedback, 0.05);
        if (partial.wet !== undefined) nodes.delay.wet.rampTo(partial.wet, 0.05);
      } else if (fxKey === 'reverb' && partial) {
        if (partial.decay !== undefined) nodes.reverb.decay = partial.decay;
        if (partial.wet !== undefined) nodes.reverb.wet.rampTo(partial.wet, 0.05);
      } else if (fxKey === 'compressor' && partial) {
        if (partial.threshold !== undefined) nodes.compressor.threshold.rampTo(partial.threshold, 0.05);
        if (partial.ratio !== undefined) nodes.compressor.ratio.rampTo(partial.ratio, 0.05);
        if (partial.attack !== undefined) nodes.compressor.attack.rampTo(partial.attack, 0.05);
        if (partial.release !== undefined) nodes.compressor.release.rampTo(partial.release, 0.05);
      }
      return;
    }

    const fx: DSPFxConfig = fxOrKey;

    // EQ3
    nodes.eq.low.rampTo(fx.eq.enabled ? fx.eq.low : 0, 0.05);
    nodes.eq.mid.rampTo(fx.eq.enabled ? fx.eq.mid : 0, 0.05);
    nodes.eq.high.rampTo(fx.eq.enabled ? fx.eq.high : 0, 0.05);

    // Filter
    nodes.filter.frequency.rampTo(fx.filter.enabled ? fx.filter.cutoff : 20000, 0.05);
    nodes.filter.Q.rampTo(fx.filter.resonance, 0.05);
    nodes.filter.type = fx.filter.type;

    // Distortion
    nodes.distortion.distortion = fx.distortion.drive;
    nodes.distortion.wet.rampTo(fx.distortion.enabled ? fx.distortion.wet : 0, 0.05);

    // Chorus
    nodes.chorus.frequency.rampTo(fx.chorus.rate, 0.05);
    nodes.chorus.depth = fx.chorus.depth;
    nodes.chorus.wet.rampTo(fx.chorus.enabled ? fx.chorus.wet : 0, 0.05);

    // Delay
    nodes.delay.delayTime.rampTo(fx.delay.delayTime, 0.05);
    nodes.delay.feedback.rampTo(fx.delay.feedback, 0.05);
    nodes.delay.wet.rampTo(fx.delay.enabled ? fx.delay.wet : 0, 0.05);

    // Reverb
    nodes.reverb.decay = fx.reverb.decay;
    nodes.reverb.wet.rampTo(fx.reverb.enabled ? fx.reverb.wet : 0, 0.05);

    // Compressor
    nodes.compressor.threshold.rampTo(fx.compressor.threshold, 0.05);
    nodes.compressor.ratio.rampTo(fx.compressor.enabled ? fx.compressor.ratio : 1, 0.05);
    nodes.compressor.attack.rampTo(fx.compressor.attack, 0.05);
    nodes.compressor.release.rampTo(fx.compressor.release, 0.05);
  }

  public disposeTrack(trackId: string, transport = Tone.getTransport()) {
    for (const key of this.clipLoads.keys()) if (key.startsWith(`${trackId}:`)) {
      this.clipLoads.delete(key);
      this.loading.delete(key);
    }
    const scheduleId = this.sequencerScheduleIds.get(trackId);
    if (scheduleId !== undefined) {
      transport.clear(scheduleId);
      this.sequencerScheduleIds.delete(trackId);
    }

    const strudelScheduleId = this.strudelScheduleIds.get(trackId);
    if (strudelScheduleId !== undefined) {
      transport.clear(strudelScheduleId);
      this.strudelScheduleIds.delete(trackId);
    }
    for (const id of this.pianoScheduleIds.get(trackId) ?? []) transport.clear(id);
    this.pianoScheduleIds.delete(trackId);

    const nodes = this.trackNodes.get(trackId);
    if (!nodes) return;

    nodes.players.forEach((p) => p.dispose());
    nodes.players.clear();
    nodes.polySynth?.dispose();
    if (nodes.drumSynths) {
      nodes.drumSynths.kick.dispose();
      nodes.drumSynths.snare.dispose();
      nodes.drumSynths.hihat.dispose();
      nodes.drumSynths.clap.dispose();
      nodes.drumSynths.tom.dispose();
      nodes.drumSynths.perc.dispose();
      nodes.drumSynths.crash.dispose();
    }
    nodes.source?.dispose();
    nodes.input.dispose();
    nodes.sectionGain?.dispose();
    nodes.eq.dispose();
    nodes.filter.dispose();
    nodes.distortion.dispose();
    nodes.chorus.dispose();
    nodes.delay.dispose();
    nodes.reverb.dispose();
    nodes.compressor.dispose();
    nodes.panner.dispose();
    nodes.volume.dispose();
    nodes.meter.dispose();

    this.trackNodes.delete(trackId);
  }
}

export const dawEngine = new DAWEngine();
