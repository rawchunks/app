if (typeof window !== 'undefined') {
  (window as any).TONE_SILENCE_LOGGING = true;
}

import * as Tone from 'tone';
import { type DAWTrack, type DSPFxConfig, useDawStore } from './store';
import { masterArrangement } from './takes';

const ENGINE_DEFAULT_FX: DSPFxConfig = {
  eq: { low: 0, mid: 0, high: 0, enabled: false },
  reverb: { decay: 2.5, wet: 0.25, enabled: false },
  delay: { delayTime: 0.25, feedback: 0.35, wet: 0.2, enabled: false },
  filter: { type: 'lowpass', cutoff: 20000, resonance: 1, enabled: false },
  distortion: { drive: 0.2, wet: 0.3, enabled: false },
  chorus: { rate: 1.5, depth: 0.5, wet: 0.25, enabled: false },
  compressor: { threshold: -18, ratio: 4, attack: 0.01, release: 0.15, enabled: false },
  spatial: { azimuth: 0, elevation: 0, distance: 1, enabled: false },
};
import { parseStrudelPattern } from './strudel';
import { bus } from '../bus';
import { BEAT_STEPS, DRUM_STEPS } from './notes';
import {
  applyWaveSculptToAudioBuffer,
  clearMemoryAudioCaches,
  composeWaveSculpts,
  fetchAudioArrayBuffer,
  getDecodedAudioBuffer,
  getTrackOwnSculpt,
  isIdentityWaveSculpt,
  type WaveSculptState,
} from './peaks';

export interface TrackAudioNodes {
  input: Tone.Gain;
  source?: Tone.Gain;
  eq: Tone.EQ3;
  filter: Tone.Filter;
  sectionGain?: Tone.Gain;
  distortion?: Tone.Distortion;
  chorus?: Tone.Chorus;
  delay?: Tone.FeedbackDelay;
  reverb?: Tone.Reverb;
  compressor?: Tone.Compressor;
  panner3d?: Tone.Panner3D;
  fxChainSignature?: string;
  lastSynthSound?: string;
  lastPan?: number;
  lastFilterType?: string;
  lastFilterCutoff?: number;
  lastRoomWet?: number;
  lastDelayWet?: number;
  pendingReverbInit?: boolean;
  spatialState?: DSPFxConfig['spatial'];
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
    disposeAll?: () => void;
  };
}

interface ClipLoadEntry {
  trackId: string;
  clipId: string;
  url: string;
  startTime: number;
  offset: number;
  duration?: number;
  signature: string;
  buffer?: AudioBuffer;
  sculpt?: WaveSculptState;
  promise: Promise<void>;
}

class DAWEngine {
  private isInitialized = false;
  private trackNodes = new Map<string, TrackAudioNodes>();
  private masterCompressor: Tone.Compressor | null = null;
  private masterLimiter: Tone.Limiter | null = null;
  private sequencerScheduleIds = new Map<string, number>();
  private strudelScheduleIds = new Map<string, number>();
  private strudelScheduledKeys = new Map<string, string>();
  private pianoScheduleIds = new Map<string, number[]>();
  private targetTransportState: 'started' | 'stopped' | 'paused' = 'stopped';
  private onStepCallback: ((step: number) => void) | null = null;
  private onTimeCallback: ((seconds: number) => void) | null = null;
  private timeUpdateTimer: number | null = null;
  private auditionTakeAudio: HTMLAudioElement | null = null;
  private auditionMediaSource: MediaElementAudioSourceNode | null = null;
  private auditionReadyHandler: (() => void) | null = null;
  private auditionOffset = 0;
  private auditionTrackId: string | null = null;
  private auditionLayerIds: string[] | null = null;
  private isAuditionLooping = false;
  private auditionStart: number | null = null;
  private auditionEnd: number | null = null;
  private loopEnabled = false;
  private loopStart = 0;
  private loopEnd = 30;
  private pendingSeekSeconds = 0;
  private pendingBpm = 120;
  private currentSectionGainLinear = 1.0;
  private originalScheduleIds: number[] = [];
  private lastMasterSegmentsKey = '';
  private loading = new Map<string, Promise<void>>();
  private clipLoads = new Map<string, ClipLoadEntry>();
  private sculptWorkingBuffers = new Map<string, AudioBuffer>();
  private sculptTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private sculptDirtyRanges = new Map<string, [number, number] | null>();
  private reverbTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private transportStartId = 0;
  private project = 0;

  constructor(private offline = false) {
    if (!offline) bus.registerDaw(() => {
      this.pauseTransport();
    });
  }

  private get isToneReady(): boolean {
    if (typeof window === 'undefined' && typeof globalThis.AudioContext === 'undefined') {
      return false;
    }
    return this.isInitialized || this.offline || typeof OfflineAudioContext === 'undefined';
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

  public getClipAudioBuffer(trackId: string, clipId: string): AudioBuffer | undefined {
    return this.clipLoads.get(`${trackId}:${clipId}`)?.buffer;
  }

  private getEffectiveClipSculpt(trackId: string, clipId: string): WaveSculptState | undefined {
    const tracks = useDawStore.getState().tracks;
    const track = tracks.find((t) => t.id === trackId);
    const clip = track?.clips?.find((c) => c.id === clipId);
    const ownSculpt =
      clip?.sculpt && !isIdentityWaveSculpt(clip.sculpt)
        ? clip.sculpt
        : track?.sculpt && !isIdentityWaveSculpt(track.sculpt)
        ? track.sculpt
        : undefined;
    if (trackId === 'master') {
      return ownSculpt;
    }
    const masterTrack = tracks.find((t) => t.id === 'master');
    const masterSculpt = getTrackOwnSculpt(masterTrack);
    const composed = composeWaveSculpts(masterSculpt, ownSculpt);
    return composed && !isIdentityWaveSculpt(composed) ? composed : undefined;
  }

  private safeDisposePlayer(player?: Tone.Player) {
    if (!player) return;
    try {
      const activeSources: Set<any> | undefined = (player as any)._activeSources;
      if (activeSources && typeof activeSources.forEach === 'function') {
        for (const src of [...activeSources]) {
          if (src && src._startTime === -1) {
            try {
              src.dispose?.();
            } catch {}
            activeSources.delete(src);
          }
        }
      }
      player.dispose();
    } catch {}
  }

  private getOrCreateWorkingBuffer(key: string, source: AudioBuffer): AudioBuffer {
    const existing = this.sculptWorkingBuffers.get(key);
    if (
      existing &&
      existing !== source &&
      existing.numberOfChannels === source.numberOfChannels &&
      existing.length === source.length &&
      existing.sampleRate === source.sampleRate
    ) {
      return existing;
    }
    const created =
      typeof AudioBuffer === 'function'
        ? new AudioBuffer({
            numberOfChannels: source.numberOfChannels,
            length: source.length,
            sampleRate: source.sampleRate,
          })
        : Tone.getContext().rawContext.createBuffer(
            source.numberOfChannels,
            source.length,
            source.sampleRate
          );
    for (let ch = 0; ch < source.numberOfChannels; ch++) {
      created.getChannelData(ch).set(source.getChannelData(ch));
    }
    this.sculptWorkingBuffers.set(key, created);
    return created;
  }

  private attachClipPlayer(
    trackId: string,
    clipId: string,
    audioBuffer: AudioBuffer,
    startTime: number,
    offset = 0,
    duration?: number,
    dirtyRange?: [number, number],
    _inPlaceOnly = false
  ) {
    const key = `${trackId}:${clipId}`;
    const sculpt = this.getEffectiveClipSculpt(trackId, clipId);
    const loadEntry = this.clipLoads.get(key);
    if (loadEntry) {
      loadEntry.sculpt = sculpt;
    }
    const hasActiveSculpt = Boolean(sculpt && !isIdentityWaveSculpt(sculpt));
    if (!hasActiveSculpt) {
      this.sculptWorkingBuffers.delete(key);
    }
    const workingBuffer = hasActiveSculpt
      ? this.getOrCreateWorkingBuffer(key, audioBuffer)
      : null;
    const effectiveBuffer = workingBuffer
      ? applyWaveSculptToAudioBuffer(audioBuffer, sculpt, workingBuffer, dirtyRange)
      : audioBuffer;
    if (effectiveBuffer !== audioBuffer) {
      this.sculptWorkingBuffers.set(key, effectiveBuffer);
    }

    if (!this.isToneReady) return;

    const nodes = this.getOrCreateTrackNodes(trackId);
    const existing = nodes.players.get(clipId);
    if (
      existing &&
      !(existing as any).disposed &&
      existing.buffer &&
      typeof existing.buffer.set === 'function'
    ) {
      existing.buffer.set(effectiveBuffer);
      if (existing.buffer.loaded || (existing as any).loaded) {
        const activeSources: Set<any> | undefined = (existing as any)._activeSources;
        if (activeSources && typeof activeSources.forEach === 'function') {
          for (const src of [...activeSources]) {
            if (src && src._startTime === -1) {
              try {
                src.dispose?.();
              } catch {}
              activeSources.delete(src);
            }
          }
        }
        try {
          existing.unsync();
        } catch {}
        existing.sync().start(startTime, offset, duration);
      }
      return;
    }

    this.safeDisposePlayer(existing);
    const player = new Tone.Player({ autostart: false });
    player.connect(nodes.source ?? nodes.input);
    nodes.players.set(clipId, player);
    if (player.buffer && typeof player.buffer.set === 'function') {
      player.buffer.set(effectiveBuffer);
    }
    if (!player.buffer || player.buffer.loaded || (player as any).loaded) {
      player.sync().start(startTime, offset, duration);
      if (this.isToneReady && !this.offline && Tone.getTransport().state === 'started') {
        try {
          Tone.getTransport().seconds = Tone.getTransport().seconds;
        } catch {}
      }
    }
  }

  private flushTrackSculpt(trackId: string, clipId?: string, dirtyRange?: [number, number]) {
    const tracks = useDawStore.getState().tracks;
    for (const t of tracks) {
      if (t.id !== trackId) continue;
      for (const c of t.clips ?? []) {
        if (clipId && c.id !== clipId) continue;
        const key = `${t.id}:${c.id}`;
        if (!this.clipLoads.has(key) && c.url) {
          void this.loadClip(t.id, c.id, c.url, c.startTime, c.offset, c.duration);
        }
      }
    }

    let updatedAny = false;
    for (const [, entry] of this.clipLoads.entries()) {
      if (trackId === 'master') {
        if (entry.trackId !== 'master') {
          const entryNodes = this.trackNodes.get(entry.trackId);
          if (!entryNodes || entryNodes.volume.mute) continue;
        } else if (clipId && entry.clipId !== clipId) {
          continue;
        }
      } else {
        if (entry.trackId !== trackId) continue;
        if (clipId && entry.clipId !== clipId) continue;
      }
      if (entry.buffer) {
        this.attachClipPlayer(
          entry.trackId,
          entry.clipId,
          entry.buffer,
          entry.startTime,
          entry.offset,
          entry.duration,
          dirtyRange,
          true
        );
        updatedAny = true;
      }
    }

    if (trackId !== 'master' && this.isToneReady) {
      this.updateTrackMixer(trackId);
    }

    if (updatedAny && this.isToneReady) {
      if (trackId === 'master') {
        this.lastMasterSegmentsKey = '';
        this.syncOriginals();
      }
      if (Tone.getTransport().state === 'started') {
        Tone.getTransport().seconds = Tone.getTransport().seconds;
      }
    }
  }

  public applyTrackSculpt(trackId: string, clipId?: string, dirtyRange?: [number, number]) {
    const timerKey = `${trackId}:${clipId ?? '*'}`;
    if (dirtyRange) {
      const existing = this.sculptDirtyRanges.get(timerKey);
      if (existing === undefined) {
        this.sculptDirtyRanges.set(timerKey, [dirtyRange[0], dirtyRange[1]]);
      } else if (existing !== null) {
        this.sculptDirtyRanges.set(timerKey, [
          Math.min(existing[0], dirtyRange[0]),
          Math.max(existing[1], dirtyRange[1]),
        ]);
      }
    } else {
      this.sculptDirtyRanges.set(timerKey, null);
    }

    if (this.sculptTimers.has(timerKey)) {
      return;
    }

    const timer = setTimeout(() => {
      this.sculptTimers.delete(timerKey);
      const coalescedRange = this.sculptDirtyRanges.get(timerKey);
      this.sculptDirtyRanges.delete(timerKey);
      this.flushTrackSculpt(trackId, clipId, coalescedRange ?? undefined);
    }, 45);
    this.sculptTimers.set(timerKey, timer);
  }

  public async resumeAudioContext() {
    if (typeof window === 'undefined') return;
    try {
      const ctx = Tone.getContext();
      if (ctx.state !== 'running') {
        await Tone.start();
        await ctx.resume();
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

    const transport = Tone.getTransport();
    if (this.pendingBpm > 0 && transport.bpm) {
      transport.bpm.value = this.pendingBpm;
    }
    transport.loop = this.loopEnabled;
    transport.loopStart = this.loopStart;
    transport.loopEnd = this.loopEnd;
    if (this.pendingSeekSeconds > 0) {
      transport.seconds = this.pendingSeekSeconds;
    }

    for (const t of useDawStore.getState().tracks) {
      if (t.fx) {
        this.updateTrackFx(t.id, t.fx);
      }
    }
    this.updateTrackMixer('master');

    for (const [, entry] of this.clipLoads.entries()) {
      if (entry.buffer && !this.trackNodes.get(entry.trackId)?.players.get(entry.clipId)?.loaded) {
        this.attachClipPlayer(entry.trackId, entry.clipId, entry.buffer, entry.startTime, entry.offset, entry.duration);
      }
    }
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
          const isMuted = Boolean(t.mixer?.muted ?? t.muted) || t.mounted === false;
          const isSculpted = !isIdentityWaveSculpt(t.sculpt) || Boolean(t.clips?.some((c) => !isIdentityWaveSculpt(c.sculpt)));
          const hasActiveOverlay = Boolean(
            t.activeTakeId ||
            t.activeVersionId ||
            t.type === 'sample' ||
            isSculpted ||
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
    const startId = ++this.transportStartId;
    this.stopAuditionTake(!preserveAudition);
    this.isAuditionLooping = this.loopEnabled;
    this.auditionStart = this.loopEnabled ? this.loopStart : null;
    this.auditionEnd = this.loopEnabled ? this.loopEnd : null;
    this.targetTransportState = 'started';
    await this.resumeAudioContext();
    await this.init();
    if (project !== this.project || startId !== this.transportStartId || this.targetTransportState !== 'started') return;

    const transport = Tone.getTransport();
    this.isAuditionLooping = transport.loop;
    this.auditionStart = transport.loop ? Tone.Time(transport.loopStart).toSeconds() : null;
    this.auditionEnd = transport.loop ? Tone.Time(transport.loopEnd).toSeconds() : null;

    const waited = new Set<Promise<void>>();
    let pending = this.getAudibleLoadingPromises();
    while (pending.length) {
      pending.forEach(load => waited.add(load));
      await Promise.all(pending);
      if (project !== this.project || startId !== this.transportStartId || this.targetTransportState !== 'started') return;
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
    if (!this.isToneReady) return;
    const transport = Tone.getTransport(), nodes = this.trackNodes.get('master');
    for (const id of this.originalScheduleIds) transport.clear(id);
    this.originalScheduleIds = [];
    if (!nodes) return;
    const state = useDawStore.getState();
    const extendClips = state.tracks
      .filter(track => track.activeTakeId && !track.muted && track.mounted !== false && (state.takes ?? []).some(t => t.id === track.activeTakeId && t.task === 'extend'))
      .flatMap(track => track.clips.map(clip => ({ startTime: clip.startTime, duration: clip.duration })));
    const layout = masterArrangement(state.duration, extendClips);
    const segKey = JSON.stringify(layout.segments);
    const mainPlayer = nodes.players?.get('clip-master');
    if (mainPlayer?.loaded && segKey !== this.lastMasterSegmentsKey && (layout.segments.length > 1 || this.lastMasterSegmentsKey !== '')) {
      this.lastMasterSegmentsKey = segKey;
      for (const [id, p] of [...nodes.players.entries()]) {
        if (id.startsWith('clip-master-seg-')) {
          this.safeDisposePlayer(p);
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
    if (this.isToneReady && Tone.getTransport().state === 'started') {
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
    this.pendingSeekSeconds = 0;
    if (this.isToneReady) {
      Tone.getTransport().stop();
      Tone.getTransport().seconds = 0;
    }
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
    this.pendingSeekSeconds = target;
    if (this.isToneReady) {
      Tone.getTransport().seconds = target;
      this.syncOriginals();
    }

    if (this.auditionTakeAudio && this.auditionTakeAudio.readyState >= 1) {
      try {
        this.auditionTakeAudio.currentTime = Math.max(0, target - this.auditionOffset);
      } catch (err) {
        console.warn('Take seek warning:', err);
      }
    }

    if (this.onTimeCallback) this.onTimeCallback(target);
  }

  public auditionTake(url: string, startSec = 0, endSec?: number, timelineStart = startSec, targetTrackId?: string) {
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

    // Route HTMLAudioElement through the target track's (or Master's) Tone DSP chain so Mixer & FX apply live
    try {
      void this.resumeAudioContext();
      const rawCtx = Tone.getContext().rawContext as AudioContext | undefined;
      if (rawCtx && typeof rawCtx.createMediaElementSource === 'function') {
        if (!this.auditionMediaSource) {
          this.auditionMediaSource = rawCtx.createMediaElementSource(this.auditionTakeAudio);
        }
        const state = useDawStore.getState();
        const destId = targetTrackId || state.selectedTrackId || 'master';
        const nodes = this.getOrCreateTrackNodes(destId);
        const destTrack = state.tracks.find((t) => t.id === destId);
        if (destTrack) {
          this.updateTrackFx(destId, destTrack.fx);
        }
        this.auditionMediaSource.disconnect();
        Tone.connect(this.auditionMediaSource, nodes.input);
        nodes.volume.mute = false;
        const masterNodes = this.trackNodes.get('master');
        if (masterNodes) {
          masterNodes.volume.mute = false;
        }
      }
    } catch {
      // Fallback gracefully if MediaElementAudioSourceNode is unsupported in test env
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
    this.pendingBpm = bpm;
    if (!this.isToneReady) return;
    if (Tone.getTransport()?.bpm?.rampTo) {
      Tone.getTransport().bpm.rampTo(bpm, 0.05);
    } else if (Tone.getTransport()?.bpm) {
      Tone.getTransport().bpm.value = bpm;
    }
  }

  public setLoop(loop: boolean, start = 0, end = 30) {
    this.loopEnabled = loop;
    this.loopStart = start;
    this.loopEnd = end;
    if (this.isToneReady) {
      Tone.getTransport().loop = loop;
      Tone.getTransport().loopStart = start;
      Tone.getTransport().loopEnd = end;
    }
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
      const isToneRunning = this.isToneReady && Tone.getTransport().state === 'started';
      const isTakeRunning = this.auditionTakeAudio && !this.auditionTakeAudio.paused;

      if (isToneRunning || isTakeRunning) {
        const sec = isTakeRunning && this.auditionTakeAudio
          ? this.auditionTakeAudio.currentTime + this.auditionOffset
          : (this.isToneReady ? Tone.getTransport().seconds : this.pendingSeekSeconds);

        if (this.onTimeCallback) {
          this.onTimeCallback(sec);
        }
        const state = useDawStore.getState();
        const extendClips = state.tracks
          .filter(track => track.activeTakeId && !track.muted && (state.takes ?? []).some(t => t.id === track.activeTakeId && t.task === 'extend'))
          .flatMap(track => track.clips.map(clip => ({ startTime: clip.startTime, duration: clip.duration })));
        const masterEnd = masterArrangement(state.duration, extendClips).duration;
        const end = Math.max(masterEnd, ...state.tracks.filter(track => track.activeTakeId && !track.muted).flatMap(track => track.clips.map(clip => clip.startTime + clip.duration)));
        const isLooping = this.isToneReady ? Tone.getTransport().loop : this.loopEnabled;
        if (!isTakeRunning && !isLooping && sec >= end) { this.stopTransport(); return; }

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

  private createLazyDrumSynths(input: Tone.Gain): NonNullable<TrackAudioNodes['drumSynths']> {
    let _kick: Tone.MembraneSynth | undefined;
    let _snare: Tone.NoiseSynth | undefined;
    let _hihat: Tone.MetalSynth | undefined;
    let _clap: Tone.NoiseSynth | undefined;
    let _tom: Tone.MembraneSynth | undefined;
    let _perc: Tone.MembraneSynth | undefined;
    let _crash: Tone.MetalSynth | undefined;

    return {
      get kick() {
        if (!_kick) {
          _kick = new Tone.MembraneSynth({
            pitchDecay: 0.05, octaves: 8, oscillator: { type: 'sine' }, envelope: { attack: 0.001, decay: 0.4, sustain: 0.01, release: 0.4 },
          });
          _kick.connect(input);
        }
        return _kick;
      },
      get snare() {
        if (!_snare) {
          _snare = new Tone.NoiseSynth({
            noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.2, sustain: 0 },
          });
          _snare.connect(input);
        }
        return _snare;
      },
      get hihat() {
        if (!_hihat) {
          _hihat = new Tone.MetalSynth({
            envelope: { attack: 0.001, decay: 0.05, release: 0.05 }, harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5,
          });
          _hihat.connect(input);
        }
        return _hihat;
      },
      get clap() {
        if (!_clap) {
          _clap = new Tone.NoiseSynth({
            noise: { type: 'pink' }, envelope: { attack: 0.005, decay: 0.15, sustain: 0 },
          });
          _clap.connect(input);
        }
        return _clap;
      },
      get tom() {
        if (!_tom) {
          _tom = new Tone.MembraneSynth({
            pitchDecay: 0.03, octaves: 4, oscillator: { type: 'sine' }, envelope: { attack: 0.001, decay: 0.3, sustain: 0.01, release: 0.3 },
          });
          _tom.connect(input);
        }
        return _tom;
      },
      get perc() {
        if (!_perc) {
          _perc = new Tone.MembraneSynth({
            pitchDecay: 0.02, octaves: 4, oscillator: { type: 'triangle' }, envelope: { attack: 0.001, decay: 0.15, sustain: 0.01, release: 0.2 },
          });
          _perc.connect(input);
        }
        return _perc;
      },
      get crash() {
        if (!_crash) {
          _crash = new Tone.MetalSynth({
            envelope: { attack: 0.001, decay: 0.8, release: 0.8 }, harmonicity: 3.2, modulationIndex: 64, resonance: 2000, octaves: 2.0,
          });
          _crash.connect(input);
        }
        return _crash;
      },
      disposeAll() {
        _kick?.dispose();
        _snare?.dispose();
        _hihat?.dispose();
        _clap?.dispose();
        _tom?.dispose();
        _perc?.dispose();
        _crash?.dispose();
      },
    };
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
      const storeTrack = track || useDawStore.getState().tracks.find((t: DAWTrack) => t.id === trackId);
      const currentType = storeTrack?.type;
      const hasPianoNotes = Boolean(storeTrack?.pianoRollNotes?.length);
      const hasDrumVoices = Boolean(storeTrack?.sequencerVoices?.length);
      if ((currentType === 'pianoroll' || currentType === 'strudel' || hasPianoNotes) && !nodes.polySynth) {
        nodes.polySynth = new Tone.PolySynth({
          maxPolyphony: 12,
          voice: Tone.Synth,
          options: {
            oscillator: { type: 'triangle' },
            envelope: { attack: 0.02, decay: 0.1, sustain: 0.3, release: 0.8 },
          },
        });
        nodes.polySynth.connect(nodes.input);
      }
      if ((currentType === 'sequencer' || currentType === 'strudel' || hasDrumVoices) && !nodes.drumSynths) {
        nodes.drumSynths = this.createLazyDrumSynths(nodes.input);
      }
      return nodes;
    }

    const trackType = track?.type || 'stem';
    const hasPianoNotes = Boolean(track?.pianoRollNotes?.length);
    const hasDrumVoices = Boolean(track?.sequencerVoices?.length);
    const volumeVal = track?.volume ?? 0.9;
    const panVal = track?.pan ?? 0;
    const mutedVal = track?.muted ?? false;
    const fxConfig = track?.fx || ENGINE_DEFAULT_FX;

    const input = new Tone.Gain(1.0);
    const source = trackId === 'master' ? new Tone.Gain(1).connect(input) : undefined;
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
    const panner = new Tone.Panner(panVal);
    const volume = new Tone.Volume(Tone.gainToDb(Math.max(0.0001, volumeVal)));
    volume.mute = mutedVal;

    const sectionGain = new Tone.Gain(1.0);
    const meter = new Tone.Meter({ smoothing: 0.8 });
    volume.connect(meter);

    // Connect lightweight core chain immediately; heavy FX nodes are lazily instantiated on demand
    const busDest = trackId === 'master' ? this.ensureMasterBus() : this.getOrCreateTrackNodes('master').input;
    input.chain(eq, filter, sectionGain);
    panner.chain(volume, busDest);

    const players = new Map<string, Tone.Player>();
    let polySynth: Tone.PolySynth | undefined;
    let drumSynths: TrackAudioNodes['drumSynths'] | undefined;

    if (trackType === 'pianoroll' || trackType === 'strudel' || hasPianoNotes) {
      polySynth = new Tone.PolySynth({
        maxPolyphony: 12,
        voice: Tone.Synth,
        options: {
          oscillator: { type: 'triangle' },
          envelope: { attack: 0.02, decay: 0.1, sustain: 0.3, release: 0.8 },
        },
      });
      polySynth.connect(input);
    }

    if (trackType === 'sequencer' || trackType === 'strudel' || hasDrumVoices) {
      drumSynths = this.createLazyDrumSynths(input);
    }

    const spatialState = fxConfig.spatial
      ? { ...fxConfig.spatial }
      : { ...ENGINE_DEFAULT_FX.spatial };

    nodes = {
      input,
      source,
      eq,
      filter,
      sectionGain,
      spatialState,
      panner,
      volume,
      meter,
      players,
      polySynth,
      drumSynths,
    };

    this.syncTrackFxChain(nodes, fxConfig);

    if (spatialState.enabled) {
      this.applySpatialParams(nodes, spatialState);
    }

    this.trackNodes.set(trackId, nodes);
    return nodes;
  }

  private syncTrackFxChain(
    nodes: TrackAudioNodes,
    fxConfig: DSPFxConfig,
    forceEffects?: { reverb?: boolean; delay?: boolean }
  ) {
    if (fxConfig.distortion.enabled && !nodes.distortion) {
      nodes.distortion = new Tone.Distortion({
        distortion: fxConfig.distortion.drive,
        wet: fxConfig.distortion.wet,
      });
    }
    if (fxConfig.chorus.enabled && !nodes.chorus) {
      nodes.chorus = new Tone.Chorus({
        frequency: fxConfig.chorus.rate,
        depth: fxConfig.chorus.depth,
        wet: fxConfig.chorus.wet,
      });
      try {
        nodes.chorus.start();
      } catch {}
    }
    if ((fxConfig.delay.enabled || forceEffects?.delay) && !nodes.delay) {
      nodes.delay = new Tone.FeedbackDelay({
        delayTime: fxConfig.delay.delayTime,
        feedback: fxConfig.delay.feedback,
        wet: fxConfig.delay.enabled ? fxConfig.delay.wet : 0,
      });
    }
    if ((fxConfig.reverb.enabled || forceEffects?.reverb) && !nodes.reverb) {
      nodes.reverb = new Tone.Reverb({
        decay: Math.max(0.01, fxConfig.reverb.decay),
        wet: fxConfig.reverb.enabled ? fxConfig.reverb.wet : 0,
      });
    }
    if (fxConfig.compressor.enabled && !nodes.compressor) {
      nodes.compressor = new Tone.Compressor({
        threshold: fxConfig.compressor.threshold,
        ratio: fxConfig.compressor.ratio,
        attack: fxConfig.compressor.attack,
        release: fxConfig.compressor.release,
      });
    }
    if (fxConfig.spatial?.enabled && !nodes.panner3d) {
      try {
        const rawCtx = Tone.getContext().rawContext as AudioContext | undefined;
        const probe = rawCtx?.createPanner?.();
        if (probe && 'positionX' in probe) {
          nodes.panner3d = new Tone.Panner3D({
            panningModel: 'HRTF',
            distanceModel: 'inverse',
            refDistance: 1,
            rolloffFactor: 1,
          });
        }
      } catch {}
    }

    const sig = [
      Boolean(nodes.distortion),
      Boolean(nodes.chorus),
      Boolean(nodes.delay),
      Boolean(nodes.reverb),
      Boolean(nodes.compressor),
      Boolean(nodes.panner3d),
    ].join(':');

    if (nodes.fxChainSignature !== sig && nodes.sectionGain) {
      nodes.fxChainSignature = sig;
      for (const node of [
        nodes.sectionGain,
        nodes.distortion,
        nodes.chorus,
        nodes.delay,
        nodes.reverb,
        nodes.compressor,
        nodes.panner3d,
      ]) {
        try {
          node?.disconnect();
        } catch {}
      }
      const activeFxNodes = [
        nodes.distortion,
        nodes.chorus,
        nodes.delay,
        nodes.reverb,
        nodes.compressor,
        nodes.panner3d,
      ].filter(Boolean) as any[];
      nodes.sectionGain.chain(...activeFxNodes, nodes.panner);
    }
  }

  public level(trackId: string): number {
    const value = this.trackNodes.get(trackId)?.meter.getValue();
    return typeof value === 'number' ? value : -Infinity;
  }

  public getCurrentTime(): number {
    if (this.auditionTakeAudio && !this.auditionTakeAudio.paused) {
      return this.auditionTakeAudio.currentTime + this.auditionOffset;
    }
    if (!this.isToneReady) return this.pendingSeekSeconds;
    return Tone.getTransport().seconds;
  }

  public setSectionGain(gainDb: number, trackId = 'master') {
    const linear = gainDb <= -24 ? 0 : Tone.dbToGain(gainDb);
    this.currentSectionGainLinear = Math.max(0, Math.min(2.0, linear));
    if (!this.isToneReady) return;
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
    if (!this.isToneReady) return;
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
   * Pre-decodes an audio clip via OfflineAudioContext and attaches it to Tone.Transport once Tone is initialized.
   */
  public loadClip(trackId: string, clipId: string, url: string, startTime: number, offset = 0, duration?: number): Promise<void> {
    const key = `${trackId}:${clipId}`;
    const signature = JSON.stringify([url, startTime, offset, duration]);
    const previous = this.clipLoads.get(key);
    if (previous?.signature === signature) return previous.promise;
    const project = this.project;
    const entry: ClipLoadEntry = {
      trackId,
      clipId,
      url,
      startTime,
      offset,
      duration,
      signature,
      promise: Promise.resolve(),
    };
    entry.promise = Promise.resolve().then(async () => {
      if (project !== this.project || this.clipLoads.get(key) !== entry) return;
      if (typeof OfflineAudioContext === 'undefined') {
        await this.init();
        if (project !== this.project || this.clipLoads.get(key) !== entry) return;
        const nodes = this.getOrCreateTrackNodes(trackId);
        const player = new Tone.Player({ autostart: false });
        player.connect(nodes.source ?? nodes.input);
        this.safeDisposePlayer(nodes.players.get(clipId));
        nodes.players.set(clipId, player);
        await player.load(url);
        if (project !== this.project || nodes.players.get(clipId) !== player) {
          this.safeDisposePlayer(player);
          return;
        }
        player.sync().start(startTime, offset, duration);
        return;
      }
      const priority =
        trackId === 'master' ||
        this.auditionTrackId === trackId ||
        Boolean(this.auditionLayerIds?.includes(trackId))
          ? 'high'
          : 'normal';
      const audioBuffer = await getDecodedAudioBuffer(url, priority);
      if (project !== this.project || this.clipLoads.get(key) !== entry) return;
      entry.buffer = audioBuffer;
      this.attachClipPlayer(
        entry.trackId,
        entry.clipId,
        audioBuffer,
        entry.startTime,
        entry.offset,
        entry.duration
      );
    });
    const handledPromise = entry.promise
      .catch(error => {
        if (this.clipLoads.get(key) === entry) this.clipLoads.delete(key);
        if (
          project !== this.project ||
          this.clipLoads.get(key) !== entry ||
          (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError')
        ) {
          return;
        }
        throw error;
      })
      .finally(() => {
        if (this.loading.get(key) === handledPromise) this.loading.delete(key);
      });
    entry.promise = handledPromise;
    this.clipLoads.set(key, entry);
    this.loading.set(key, handledPromise);
    return handledPromise;
  }

  /**
   * Re-syncs player transport bounds when clip is dragged, trimmed or slip-edited
   */
  public updateClipTransport(trackId: string, clipId: string, startTime: number, offset = 0, duration?: number) {
    const key = `${trackId}:${clipId}`;
    const existing = this.clipLoads.get(key);
    if (existing) {
      existing.startTime = startTime;
      existing.offset = offset;
      existing.duration = duration;
      existing.signature = JSON.stringify([existing.url, startTime, offset, duration]);
    }
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
    await this.init();
    const targetTrackId = trackId || useDawStore.getState().selectedTrackId || 'master';
    const trackNode = this.getOrCreateTrackNodes(targetTrackId);
    if (!trackNode.polySynth) {
      trackNode.polySynth = new Tone.PolySynth({
        maxPolyphony: 12,
        voice: Tone.Synth,
        options: {
          oscillator: { type: 'triangle' },
          envelope: { attack: 0.02, decay: 0.1, sustain: 0.3, release: 0.8 },
        },
      });
      trackNode.polySynth.connect(trackNode.input);
    }
    trackNode.polySynth.triggerAttackRelease(pitch, duration, undefined, velocity);
  }

  public triggerNote(trackId: string, pitch: string, duration = '8n', velocity = 0.8) {
    return this.playNote(pitch, duration, velocity, trackId);
  }

  /**
   * Trigger drum step hit directly for an instrument voice
   */
  public async triggerDrumStep(instrument: string, time?: number, velocity = 0.8, trackId?: string) {
    await this.resumeAudioContext();
    await this.init();
    const targetTrackId = trackId || useDawStore.getState().selectedTrackId || 'master';
    const trackNode = this.getOrCreateTrackNodes(targetTrackId);
    if (!trackNode.drumSynths) {
      trackNode.drumSynths = this.createLazyDrumSynths(trackNode.input);
    }

    this.playDrum(trackNode, instrument, time ?? Tone.now(), velocity);
  }

  private playDrum(trackNode: TrackAudioNodes, instrument: string, triggerTime: number, velocity: number) {
    if (!trackNode.drumSynths) throw new Error('Drum instrument is unavailable');
    const inst = instrument.toLowerCase().split(':')[0];

    if (inst === 'kick' || inst === 'bd') {
      trackNode.drumSynths.kick.triggerAttackRelease('C1', '8n', triggerTime, velocity);
    } else if (inst === 'snare' || inst === 'sd') {
      trackNode.drumSynths.snare.triggerAttackRelease('8n', triggerTime, velocity);
    } else if (inst === 'hihat' || inst === 'hi-hat' || inst === 'hh' || inst === 'ch') {
      trackNode.drumSynths.hihat.triggerAttackRelease('16n', triggerTime, velocity);
    } else if (inst === 'oh' || inst === 'openhat') {
      trackNode.drumSynths.hihat.triggerAttackRelease('8n', triggerTime, Math.min(1, velocity * 0.95));
    } else if (inst === 'clap' || inst === 'cp') {
      trackNode.drumSynths.clap.triggerAttackRelease('16n', triggerTime, velocity);
    } else if (inst === 'tom' || inst === 'mt') {
      trackNode.drumSynths.tom.triggerAttackRelease('D2', '8n', triggerTime, velocity);
    } else if (inst === 'ht') {
      trackNode.drumSynths.tom.triggerAttackRelease('G2', '8n', triggerTime, velocity);
    } else if (inst === 'lt') {
      trackNode.drumSynths.tom.triggerAttackRelease('G1', '8n', triggerTime, velocity);
    } else if (inst === 'perc' || inst === 'rim' || inst === 'cb' || inst === 'shaker') {
      trackNode.drumSynths.perc.triggerAttackRelease('G2', '16n', triggerTime, velocity);
    } else if (inst === 'crash' || inst === 'cymbal' || inst === 'cr') {
      trackNode.drumSynths.crash.triggerAttackRelease('8n', triggerTime, velocity);
    } else if (inst === 'ride') {
      trackNode.drumSynths.crash.triggerAttackRelease('16n', triggerTime, Math.min(1, velocity * 0.7));
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
    if (!this.isToneReady) return;
    const existingScheduleId = this.sequencerScheduleIds.get(track.id);
    if (existingScheduleId !== undefined) {
      Tone.getTransport().clear(existingScheduleId);
      this.sequencerScheduleIds.delete(track.id);
    }

    const isSequencerActive = track.type === 'sequencer' || Boolean(track.activeVersionId);
    if (!isSequencerActive || !track.sequencerVoices?.length) return;

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
    if (bpm && bpm > 0) {
      this.setBpm(bpm);
    }
    if (!this.isToneReady) return;
    const existingScheduleId = this.strudelScheduleIds.get(trackId);
    if (existingScheduleId !== undefined) {
      Tone.getTransport().clear(existingScheduleId);
      this.strudelScheduleIds.delete(trackId);
    }

    if (!patternCode || !patternCode.trim()) return;

    const parsed = parseStrudelPattern(patternCode);
    if (!parsed.events || parsed.events.length === 0) return;
    const track = useDawStore.getState().tracks.find(track => track.id === trackId);
    const nodes = this.getOrCreateTrackNodes(track ?? trackId);
    const needsRoom = parsed.events.some(event => event.room !== undefined);
    const needsDelay = parsed.events.some(event => event.delay !== undefined);
    if (needsRoom || needsDelay) {
      this.syncTrackFxChain(nodes, track?.fx || ENGINE_DEFAULT_FX, { reverb: needsRoom, delay: needsDelay });
    }

    const currentBpm = bpm && bpm > 0 ? bpm : (Tone.getTransport()?.bpm?.value || 120);
    const baseCycleSeconds = (60 / currentBpm) * 4;
    const cycleDurationSeconds = baseCycleSeconds / Math.max(0.1, parsed.rateModifier);

    if (Tone.getTransport()?.scheduleRepeat) {
      const scheduleId = Tone.getTransport().scheduleRepeat((time) => {
        for (const event of parsed.events) {
          const eventTime = time + event.time * cycleDurationSeconds;
          const eventDuration = Math.max(0.05, event.duration * cycleDurationSeconds);
          const vel = Math.max(0.05, Math.min(1, event.gain ?? 0.8));

          if (event.pan !== undefined) {
            nodes.panner.pan.rampTo(Math.max(-1, Math.min(1, event.pan)), 0.02);
          }
          if (event.lpf !== undefined) {
            nodes.filter.type = 'lowpass';
            nodes.filter.frequency.rampTo(Math.max(40, Math.min(20000, event.lpf)), 0.02);
          } else if (event.hpf !== undefined) {
            nodes.filter.type = 'highpass';
            nodes.filter.frequency.rampTo(Math.max(20, Math.min(18000, event.hpf)), 0.02);
          }
          if (event.room !== undefined) {
            nodes.reverb?.wet.rampTo(Math.max(0, Math.min(1, event.room)), 0.03);
          }
          if (event.delay !== undefined) {
            nodes.delay?.wet.rampTo(Math.max(0, Math.min(1, event.delay)), 0.03);
          }

          if (event.type === 'sound') {
            this.playDrum(nodes, event.value, eventTime, vel);
          } else if (event.type === 'note') {
            if (event.synthSound && (nodes.polySynth as any)?.set) {
              try {
                (nodes.polySynth as any).set({ oscillator: { type: event.synthSound } });
              } catch {}
            }
            nodes.polySynth?.triggerAttackRelease(event.value, eventDuration, eventTime, vel);
          }
        }
      }, cycleDurationSeconds);

      this.strudelScheduleIds.set(trackId, scheduleId);
    }
  }

  public schedulePiano(track: DAWTrack) {
    if (!this.isToneReady) return;
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
    if ((track.type === 'sequencer' || Boolean(track.activeVersionId)) && Boolean(track.sequencerVoices?.length)) {
      this.scheduleSequencer(track);
    }
    if ((track.type === 'pianoroll' || Boolean(track.activeVersionId)) && Boolean(track.pianoRollNotes?.length)) {
      this.schedulePiano(track);
    }
    if (track.type === 'strudel' || Boolean(track.strudelCode?.trim())) {
      this.scheduleStrudel(track.id, track.strudelCode ?? '');
    }
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
      buffers.set(clip.url, await getDecodedAudioBuffer(clip.url, 'high'));
    }
    const sampleRate = buffers.values().next().value?.sampleRate || original.sampleRate || 44100;
    const context = new Tone.OfflineContext(2, duration, sampleRate);
    const engine = new DAWEngine(true);
    const solo = state.tracks.some(track => track.solo);
    try {
      Tone.setContext(context);
      context.transport.bpm.value = state.bpm;
      for (const track of tracks) {
        const nodes = engine.getOrCreateTrackNodes(track);
        engine.updateTrackFx(track.id, track.fx);
        nodes.volume.mute = track.id === 'master' ? false : (track.muted || (solo && !track.solo));
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
          const clipSculpt = clip.sculpt && !isIdentityWaveSculpt(clip.sculpt)
            ? clip.sculpt
            : (track.sculpt && !isIdentityWaveSculpt(track.sculpt) ? track.sculpt : undefined);
          const rawBuf = buffers.get(clip.url)!;
          const effectiveBuf = clipSculpt ? applyWaveSculptToAudioBuffer(rawBuf, clipSculpt) : rawBuf;
          masterSegs.forEach((seg, idx) => {
            const player = new Tone.Player(effectiveBuf);
            player.connect(nodes.source ?? nodes.input);
            nodes.players.set(`${clip.id}-${idx}`, player);
            player.sync().start(seg.startTime, seg.offset, seg.duration);
          });
        } else {
          const masterTrack = state.tracks.find(t => t.id === 'master');
          const masterSculpt = getTrackOwnSculpt(masterTrack);
          for (const clip of track.clips) {
            const ownSculpt = clip.sculpt && !isIdentityWaveSculpt(clip.sculpt)
              ? clip.sculpt
              : (track.sculpt && !isIdentityWaveSculpt(track.sculpt) ? track.sculpt : undefined);
            const clipSculpt = track.id === 'master'
              ? ownSculpt
              : composeWaveSculpts(masterSculpt, ownSculpt);
            const rawBuf = buffers.get(clip.url)!;
            const effectiveBuf = clipSculpt && !isIdentityWaveSculpt(clipSculpt)
              ? applyWaveSculptToAudioBuffer(rawBuf, clipSculpt)
              : rawBuf;
            const player = new Tone.Player(effectiveBuf);
            player.connect(nodes.source ?? nodes.input);
            nodes.players.set(clip.id, player);
            player.sync().start(clip.startTime, clip.offset, clip.duration);
          }
        }
        engine.scheduleTrack(track);
      }
      context.transport.start(0);
      Tone.setContext(original);
      await Promise.all([...engine.trackNodes.values()].map(nodes => nodes.reverb?.ready));
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
    if (!this.isToneReady) return;
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

    const masterTrackObj = tracksToEval.find((t: any) => t.id === 'master') as any;
    const masterMuted = 'master' === trackId && mutedVal !== undefined
      ? mutedVal
      : Boolean(masterTrackObj?.mixer?.muted ?? masterTrackObj?.muted ?? false);

    const allTrackIds = new Set([
      ...tracksToEval.map((t: any) => t.id),
      ...Array.from(this.trackNodes.keys()),
    ]);

    for (const id of allTrackIds) {
      const trackObj = tracksToEval.find((t: any) => t.id === id) as any;
      const isUnmounted = trackObj?.mounted === false;
      const isMuted = (id === trackId && mutedVal !== undefined
        ? mutedVal
        : Boolean(trackObj?.mixer?.muted ?? trackObj?.muted ?? false)) || isUnmounted;
      const isSoloed = id === trackId && soloVal !== undefined
        ? soloVal
        : Boolean(trackObj?.mixer?.solo ?? trackObj?.solo ?? false);

      const isSculpted = !isIdentityWaveSculpt(trackObj?.sculpt) || Boolean(trackObj?.clips?.some((c: any) => !isIdentityWaveSculpt(c.sculpt)));
      const isUnmodifiedOrgStem =
        trackObj?.type === 'stem' &&
        !trackObj?.activeTakeId &&
        !trackObj?.activeVersionId &&
        (!trackObj?.activeVersionTakeId || trackObj?.activeVersionTakeId === 'ORG') &&
        !isSculpted;

      const shouldBeMuted = this.auditionLayerIds
        ? isMuted || !this.auditionLayerIds.includes(id)
        : this.auditionTrackId
        ? id !== this.auditionTrackId
        : (isMuted && !isSoloed) ||
          (hasSolo && !isSoloed) ||
          (!hasSolo && !masterMuted && isUnmodifiedOrgStem);

      let nodes = this.trackNodes.get(id);
      if (Array.isArray(trackObj?.clips) && !shouldBeMuted) {
        for (const clip of trackObj.clips) {
          if (!clip.url) continue;
          const key = `${id}:${clip.id}`;
          const loaded = nodes?.players.get(clip.id)?.loaded;
          if (!loaded && !this.loading.has(key)) {
            void this.loadClip(id, clip.id, clip.url, clip.startTime, clip.offset, clip.duration);
          } else {
            const entry = this.clipLoads.get(key);
            const expectedSculpt = this.getEffectiveClipSculpt(id, clip.id);
            if (entry?.buffer && entry.sculpt !== expectedSculpt) {
              this.attachClipPlayer(id, clip.id, entry.buffer, entry.startTime, entry.offset, entry.duration);
            }
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

      if (id === 'master' && nodes.source) {
        nodes.volume.mute = false;
        continue;
      }

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
    if (this.isToneReady) {
      for (const id of this.originalScheduleIds) Tone.getTransport().clear(id);
    }
    this.originalScheduleIds = [];
    this.lastMasterSegmentsKey = '';
    for (const timer of this.sculptTimers.values()) clearTimeout(timer);
    this.sculptTimers.clear();
    this.sculptDirtyRanges.clear();
    for (const timer of this.reverbTimers.values()) clearTimeout(timer);
    this.reverbTimers.clear();
    this.sculptWorkingBuffers.clear();
    this.loading.clear();
    this.clipLoads.clear();
    clearMemoryAudioCaches();
    this.disposeTrack('master');

    for (const id of [...this.trackNodes.keys()]) {
      if (id !== 'master') this.disposeTrack(id);
    }
    this.pendingSeekSeconds = 0;
    if (this.isToneReady) {
      Tone.getTransport().stop();
      Tone.getTransport().seconds = 0;
    }

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

    if (this.isToneReady) {
      Tone.getDestination().mute = false;
    }
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

  private applySpatialParams(nodes: TrackAudioNodes, spatial: DSPFxConfig['spatial']) {
    nodes.spatialState = { ...spatial };
    if (!spatial.enabled) {
      if (nodes.panner3d) {
        nodes.panner3d.positionX.rampTo(0, 0.05);
        nodes.panner3d.positionY.rampTo(0, 0.05);
        nodes.panner3d.positionZ.rampTo(0, 0.05);
      }
      return;
    }
    const azRad = (spatial.azimuth * Math.PI) / 180;
    const elRad = (spatial.elevation * Math.PI) / 180;
    const dist = Math.max(0.1, Math.min(10, spatial.distance));
    const x = dist * Math.cos(elRad) * Math.sin(azRad);
    const y = dist * Math.sin(elRad);
    const z = -dist * Math.cos(elRad) * Math.cos(azRad);
    if (nodes.panner3d) {
      nodes.panner3d.positionX.rampTo(x, 0.05);
      nodes.panner3d.positionY.rampTo(y, 0.05);
      nodes.panner3d.positionZ.rampTo(z, 0.05);
    } else {
      nodes.panner.pan.rampTo(Math.max(-1, Math.min(1, Math.sin(azRad))), 0.05);
    }
  }

  /**
   * Update DSP effects parameters in real-time
   */
  public updateTrackFx(trackId: string, fx: DSPFxConfig): void;
  public updateTrackFx<K extends keyof DSPFxConfig>(trackId: string, fxKey: K, partial: Partial<DSPFxConfig[K]>): void;
  public updateTrackFx(trackId: string, fxOrKey: any, partial?: any) {
    if (!this.isToneReady) return;
    const nodes = this.getOrCreateTrackNodes(trackId);
    const storeTrack = useDawStore.getState().tracks.find((t: DAWTrack) => t.id === trackId);
    const currentFx = storeTrack?.fx || ENGINE_DEFAULT_FX;

    let fx: DSPFxConfig;
    if (typeof fxOrKey === 'string') {
      const fxKey = fxOrKey as keyof DSPFxConfig;
      fx = {
        ...currentFx,
        [fxKey]: {
          ...currentFx[fxKey],
          ...(partial || {}),
        },
      };
    } else {
      fx = fxOrKey || currentFx;
    }

    this.syncTrackFxChain(nodes, fx);

    // EQ3
    nodes.eq.low.rampTo(fx.eq.enabled ? fx.eq.low : 0, 0.05);
    nodes.eq.mid.rampTo(fx.eq.enabled ? fx.eq.mid : 0, 0.05);
    nodes.eq.high.rampTo(fx.eq.enabled ? fx.eq.high : 0, 0.05);

    // Filter
    nodes.filter.frequency.rampTo(fx.filter.enabled ? fx.filter.cutoff : 20000, 0.05);
    nodes.filter.Q.rampTo(fx.filter.resonance, 0.05);
    nodes.filter.type = fx.filter.type;

    // Distortion
    if (nodes.distortion) {
      nodes.distortion.distortion = fx.distortion.drive;
      nodes.distortion.wet.rampTo(fx.distortion.enabled ? fx.distortion.wet : 0, 0.05);
    }

    // Chorus
    if (nodes.chorus) {
      if (fx.chorus.enabled) {
        try { nodes.chorus.start(); } catch {}
      }
      nodes.chorus.frequency.rampTo(fx.chorus.rate, 0.05);
      nodes.chorus.depth = fx.chorus.depth;
      nodes.chorus.wet.rampTo(fx.chorus.enabled ? fx.chorus.wet : 0, 0.05);
    }

    // Delay
    if (nodes.delay) {
      nodes.delay.delayTime.rampTo(fx.delay.delayTime, 0.05);
      nodes.delay.feedback.rampTo(fx.delay.feedback, 0.05);
      nodes.delay.wet.rampTo(fx.delay.enabled ? fx.delay.wet : 0, 0.05);
    }

    // Reverb - only regenerate impulse response when reverb is enabled and decay changed (debounced in live mode)
    if (nodes.reverb) {
      if (fx.reverb.enabled) {
        const targetDecay = Math.max(0.01, fx.reverb.decay);
        if (Math.abs(Number(nodes.reverb.decay) - targetDecay) > 0.01) {
          if (this.offline) {
            nodes.reverb.decay = targetDecay;
          } else {
            const existingTimer = this.reverbTimers.get(trackId);
            if (existingTimer) clearTimeout(existingTimer);
            this.reverbTimers.set(
              trackId,
              setTimeout(() => {
                this.reverbTimers.delete(trackId);
                if (nodes.reverb && Math.abs(Number(nodes.reverb.decay) - targetDecay) > 0.01) {
                  nodes.reverb.decay = targetDecay;
                }
              }, 120)
            );
          }
        }
      }
      nodes.reverb.wet.rampTo(fx.reverb.enabled ? fx.reverb.wet : 0, 0.05);
    }

    // Compressor
    if (nodes.compressor) {
      nodes.compressor.threshold.rampTo(fx.compressor.threshold, 0.05);
      nodes.compressor.ratio.rampTo(fx.compressor.enabled ? fx.compressor.ratio : 1, 0.05);
      nodes.compressor.attack.rampTo(fx.compressor.attack, 0.05);
      nodes.compressor.release.rampTo(fx.compressor.release, 0.05);
    }

    // Spatial 3D Binaural HRTF Panner
    if (fx.spatial) {
      this.applySpatialParams(nodes, fx.spatial);
    }
  }

  /**
   * Clears clip players and scheduled sequences for a track without destroying
   * its DSP effect rack / mixer chain (used when switching versions/takes).
   */
  public clearTrackSources(trackId: string, transport?: ReturnType<typeof Tone.getTransport>) {
    for (const [timerKey, timer] of this.sculptTimers.entries()) {
      if (timerKey.startsWith(`${trackId}:`)) {
        clearTimeout(timer);
        this.sculptTimers.delete(timerKey);
      }
    }
    for (const key of this.sculptDirtyRanges.keys()) {
      if (key.startsWith(`${trackId}:`)) {
        this.sculptDirtyRanges.delete(key);
      }
    }
    for (const key of this.sculptWorkingBuffers.keys()) {
      if (key.startsWith(`${trackId}:`)) {
        this.sculptWorkingBuffers.delete(key);
      }
    }
    for (const key of this.clipLoads.keys()) {
      if (key.startsWith(`${trackId}:`)) {
        this.clipLoads.delete(key);
        this.loading.delete(key);
      }
    }
    const activeTransport = transport ?? (this.isToneReady ? Tone.getTransport() : undefined);
    const scheduleId = this.sequencerScheduleIds.get(trackId);
    if (scheduleId !== undefined) {
      activeTransport?.clear(scheduleId);
      this.sequencerScheduleIds.delete(trackId);
    }
    const strudelScheduleId = this.strudelScheduleIds.get(trackId);
    if (strudelScheduleId !== undefined) {
      activeTransport?.clear(strudelScheduleId);
      this.strudelScheduleIds.delete(trackId);
    }
    for (const id of this.pianoScheduleIds.get(trackId) ?? []) activeTransport?.clear(id);
    this.pianoScheduleIds.delete(trackId);

    const nodes = this.trackNodes.get(trackId);
    if (!nodes) return;
    nodes.players.forEach((p) => this.safeDisposePlayer(p));
    nodes.players.clear();
  }

  public disposeTrack(trackId: string, transport?: ReturnType<typeof Tone.getTransport>) {
    this.clearTrackSources(trackId, transport);
    const revTimer = this.reverbTimers.get(trackId);
    if (revTimer) {
      clearTimeout(revTimer);
      this.reverbTimers.delete(trackId);
    }
    const nodes = this.trackNodes.get(trackId);
    if (!nodes) return;

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
    nodes.distortion?.dispose();
    nodes.chorus?.dispose();
    nodes.delay?.dispose();
    nodes.reverb?.dispose();
    nodes.compressor?.dispose();
    nodes.panner3d?.dispose();
    nodes.panner.dispose();
    nodes.volume.dispose();
    nodes.meter.dispose();

    this.trackNodes.delete(trackId);
  }
}

export const dawEngine = new DAWEngine();
