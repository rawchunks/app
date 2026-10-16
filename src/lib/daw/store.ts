import { sdk } from '../sdk';
import { promptSessionModal } from '../../hooks/use-session';
import { toast } from 'sonner';
import { create } from 'zustand';
import { dawEngine } from './engine';
import { isBase, preview, interval, source, clips, sourceInterval, retained, masterArrangement, pending, isLayerTake, layerTrackName, isFullSongRestyleTake, isMasterTargetTake } from './takes';
import type { Project } from '../cache';
import { DRUM_STEPS } from './notes';

export type TrackType = 'stem' | 'sample' | 'sequencer' | 'pianoroll' | 'strudel';

export interface DAWClip {
  id: string;
  name: string;
  url: string;
  startTime: number;    // Timeline start in seconds
  duration: number;     // Clip duration in seconds
  origin?: number;
  offset: number;       // Offset into source audio
  peaks?: number[];
  buffer?: AudioBuffer;
  fadeIn?: number;      // Fade in time in seconds
  fadeOut?: number;     // Fade out time in seconds
}

export function snapTime(time: number, bpm: number, grid: string, triplet?: boolean): number {
  const secondsPerBeat = 60 / (bpm || 120);
  let stepSec = secondsPerBeat / 4; // default 1/16
  if (grid === '1/4') stepSec = secondsPerBeat;
  else if (grid === '1/8') stepSec = secondsPerBeat / 2;
  else if (grid === '1/16') stepSec = secondsPerBeat / 4;
  else if (grid === '1/32') stepSec = secondsPerBeat / 8;
  if (triplet) stepSec = (stepSec * 2) / 3;
  return Math.round(time / stepSec) * stepSec;
}

export interface SequencerVoice {
  name: string;
  steps: boolean[];     // 16 steps
  velocity: number[];   // 16 velocities (0.0 - 1.0)
  muted: boolean;
}

export interface PianoRollNote {
  id: string;
  pitch: string;        // e.g. "C4", "F#3"
  midi: number;         // 60 = C4
  startTime: number;    // Sixteenth-note steps
  duration: number;     // Sixteenth-note steps
  velocity: number;     // 0.0 - 1.0
}

export interface DSPFxConfig {
  eq: {
    enabled: boolean;
    low: number;        // -12 to +12 dB
    mid: number;        // -12 to +12 dB
    high: number;       // -12 to +12 dB
  };
  compressor: {
    enabled: boolean;
    threshold: number;  // -60 to 0 dB
    ratio: number;      // 1 to 20
    attack: number;     // 0.001 to 1s
    release: number;    // 0.01 to 1s
  };
  reverb: {
    enabled: boolean;
    decay: number;      // 0.1 to 10s
    wet: number;        // 0 to 1
  };
  delay: {
    enabled: boolean;
    delayTime: number;  // 0.05 to 1s
    feedback: number;   // 0 to 0.95
    wet: number;        // 0 to 1
  };
  distortion: {
    enabled: boolean;
    drive: number;      // 0 to 1
    wet: number;        // 0 to 1
  };
  chorus: {
    enabled: boolean;
    rate: number;       // 0.1 to 10 Hz
    depth: number;      // 0 to 1
    wet: number;        // 0 to 1
  };
  filter: {
    enabled: boolean;
    cutoff: number;     // 20 to 20000 Hz
    resonance: number;  // 0.1 to 20
    type: 'lowpass' | 'highpass' | 'bandpass';
  };
}

export interface DAWTrack {
  id: string;
  stemId?: string;
  name: string;
  layerName?: string;
  stemType?: string;
  type: TrackType;
  color: string;
  volume: number;       // 0.0 to 1.2
  pan: number;          // -1.0 to 1.0
  muted: boolean;
  solo: boolean;
  mixer?: { volume: number; pan: number; muted: boolean; solo: boolean };
  fx: DSPFxConfig;
  clips: DAWClip[];
  sequencerVoices?: SequencerVoice[];
  pianoRollNotes?: PianoRollNote[];
  strudelCode?: string;
  activeTakeId?: string;
  hasOriginalStem?: boolean;
  originalUrl?: string;
  activeVersionTakeId?: string | null;
}

export interface AlignedWord {
  text: string;
  start: number;
  end: number;
  loss?: number;
}

export interface AlignedLine {
  index: number;
  text: string;
  isTag?: boolean;
  start: number | null;
  end: number | null;
  words: AlignedWord[];
}

export interface LyricsAlignment {
  source: 'scribe_v2' | 'forced_alignment';
  updatedAt: string;
  lines: AlignedLine[];
  words: AlignedWord[];
}

export interface Take {
  id: string;
  song_id: string;
  stem_id?: string | null;
  take_number: number;
  model: string;
  task: string;
  prompt?: string | null;
  lyrics?: string | null;
  repainting_start?: number | null;
  repainting_end?: number | null;
  url: string;
  is_active: boolean;
  created_at: string;
  provenance?: { taskId?: string; target?: string; layerName?: string; region?: { start: number; end: number } | null; regions?: {start:number; end:number}[]; audioOffset?: number; outputDuration?: number | null; sourceTakeId?: string | null; targetStemId?: string | null; mergedInto?: string; parameters?: Record<string, any> };
}

export interface Commit {
  id: string;
  song_id: string;
  user_address: string;
  parent_commit_id?: string | null;
  message: string;
  created_at: string;
  timeline_snapshot?: { action?: string; activeTakeId?: string; provenance?: { target?: string; region?: { start: number; end: number } | null }; [key: string]: unknown };
}

export type DAWView = 'timeline' | 'sequencer' | 'pianoroll' | 'strudel' | 'mixer' | 'ai-lab' | 'history' | 'sample';

export interface DAWState {
  songId: string;
  songTitle: string;
  tracks: DAWTrack[];
  selectedTrackId: string;
  activeView: DAWView;

  // Transport
  isPlaying: boolean;
  playhead: number;
  duration: number;
  bpm: number;
  timeSignature: [number, number];
  loop: boolean;
  loopStart: number;
  loopEnd: number;
  snapToGrid: boolean;
  gridSnap: string;

  // Editing selection (range pincher)
  selection: { start: number; end: number } | null;
  sectionGain: number;
  sectionLow: number;
  sectionMid: number;
  sectionHigh: number;
  originalMasterUrl: string | null;
  originals: { start: number; end: number }[];
  operations: { id: string; task: string; status: 'submitting' | 'pending' | 'processing' | 'ready' | 'error'; progress?: number; error?: string; stemId?: string }[];
  auditionId: string | null;

  // LEGO conditioning context
  legoContextTrackIds: string[];

  // Database models
  takes: Take[];
  commits: Commit[];

  // Actions
  initProject: (songId: string, songTitle: string, duration: number, masterUrl: string, project?: Pick<Project, 'stems' | 'takes' | 'commits' | 'session'>) => void;
  setPlaying: (isPlaying: boolean) => void;
  setPlayhead: (time: number) => void;
  setDuration: (duration: number) => void;
  setBpm: (bpm: number) => void;
  setLoop: (loop: boolean) => void;
  setLoopRange: (start: number, end: number) => void;
  setSnapToGrid: (snap: boolean) => void;
  setGridSnap: (grid: string) => void;
  setSelection: (selection: { start: number; end: number } | null) => void;
  setSectionGain: (gain: number) => void;
  setSectionTone: (low: number, mid: number, high: number) => void;
  extractCurrentSection: () => Promise<Take | null>;
  revertToOriginalMaster: () => void;
  setSelectedTrackId: (trackId: string) => void;
  setActiveView: (view: DAWView) => void;

  // Track actions
  setTracks: (tracks: DAWTrack[]) => void;
  syncStems: (stems: any[]) => void;
  syncLayerTracks: (preferredTakeId?: string) => void;
  selectLaneVersion: (trackId: string, versionId: string | null) => Promise<void>;
  selectMasterVersion: (versionId: string | null) => Promise<void>;
  addTrack: (type: TrackType, name?: string) => DAWTrack;
  removeTrack: (trackId: string) => void;
  updateTrackMixer: (trackId: string, partial: Partial<Pick<DAWTrack, 'volume' | 'pan' | 'muted' | 'solo'>> | { volume?: number; pan?: number; muted?: boolean; solo?: boolean }) => void;
  updateTrackFx: <K extends keyof DSPFxConfig>(trackId: string, fxKeyOrConfig: K | DSPFxConfig, partial?: Partial<DSPFxConfig[K]>) => void;

  // Clip actions
  addClip: (trackId: string, clip: DAWClip) => void;
  updateClip: (trackId: string, clipId: string, partial: Partial<DAWClip>) => void;
  removeClip: (trackId: string, clipId: string) => void;

  // Sequencer actions
  sequencerSteps: Record<string, number>;
  setSequencerStep: (trackId: string, step: number) => void;
  toggleSequencerStep: (trackId: string, voiceIdx: number, stepIdx: number) => void;
  setSequencerVoiceVolume: (trackId: string, voiceIdx: number, stepIdx: number, velocity: number) => void;
  clearSequencerSteps: (trackId: string) => void;
  randomizeSequencerSteps: (trackId: string, density?: number) => void;

  // Piano Roll actions
  addPianoRollNote: (trackId: string, note: Omit<PianoRollNote, 'id'>) => void;
  removePianoRollNote: (trackId: string, noteId: string) => void;
  clearPianoRollNotes: (trackId: string) => void;
  quantizePianoRoll: (trackId: string, gridDivision: number) => void;

  // Strudel actions
  updateStrudelCode: (trackId: string, code: string) => void;

  // LEGO context
  toggleLegoContext: (trackId: string) => void;

  // Takes & Commits
  setTakes: (takes: Take[]) => void;
  toggleTake: (takeId: string) => Promise<void>;
  moveTake: (takeId: string, shift: number) => Promise<void>;
  toggleOriginal: (region: { start: number; end: number }) => void;
  mergeTakes: (takeIds: string[], region?: {start:number; end:number}) => Promise<void>;
  upsertTake: (take: Take) => void;
  activateTake: (takeId: string, action?: 'base' | 'merge') => Promise<void>;
  pendingTake: string | null;
  deleteTake: (takeId: string) => Promise<void>;
  setCommits: (commits: Commit[]) => void;
  restoreSession: (commits: Commit[]) => void;
}

const STEM_COLORS: Record<string, string> = {
  vocals: '#00ffff',
  vocal: '#00ffff',
  backing_vocals: '#38bdf8',
  'backing vocals': '#38bdf8',
  drums: '#ff0055',
  drum: '#ff0055',
  percussion: '#fb7185',
  bass: '#ffaa00',
  instrumental: '#00ff66',
  synth: '#9933ff',
  lead: '#ec4899',
  guitar: '#f59e0b',
  keyboard: '#a855f7',
  strings: '#10b981',
  brass: '#eab308',
  woodwinds: '#14b8a6',
  fx: '#ec4899',
  other: '#38bdf8',
};

function getStemTrackColor(name: string): string {
  const lower = (name || 'stem').toLowerCase().trim();
  return STEM_COLORS[lower] || STEM_COLORS[lower.replace(/\s+/g, '_')] || '#00ffff';
}

function formatLayerDisplayName(layerName: string): string {
  return layerName
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const DEFAULT_FX: DSPFxConfig = {
  eq: { enabled: true, low: 0, mid: 0, high: 0 },
  compressor: { enabled: false, threshold: -20, ratio: 4, attack: 0.005, release: 0.2 },
  reverb: { enabled: false, decay: 2.5, wet: 0.3 },
  delay: { enabled: false, delayTime: 0.35, feedback: 0.4, wet: 0.25 },
  distortion: { enabled: false, drive: 0.4, wet: 0.3 },
  chorus: { enabled: false, rate: 1.5, depth: 0.7, wet: 0.3 },
  filter: { enabled: false, cutoff: 8000, resonance: 1.0, type: 'lowpass' },
};

const DEFAULT_SEQUENCER_VOICES: SequencerVoice[] = [
  { name: 'KICK', steps: new Array(DRUM_STEPS).fill(false), velocity: new Array(DRUM_STEPS).fill(0.9), muted: false },
  { name: 'SNARE', steps: new Array(DRUM_STEPS).fill(false), velocity: new Array(DRUM_STEPS).fill(0.8), muted: false },
  { name: 'CLAP', steps: new Array(DRUM_STEPS).fill(false), velocity: new Array(DRUM_STEPS).fill(0.85), muted: false },
  { name: 'HI-HAT', steps: new Array(DRUM_STEPS).fill(false), velocity: new Array(DRUM_STEPS).fill(0.7), muted: false },
  { name: 'PERC', steps: new Array(DRUM_STEPS).fill(false), velocity: new Array(DRUM_STEPS).fill(0.75), muted: false },
];

export const useDawStore = create<DAWState>((set, get) => ({
  songId: '',
  songTitle: '',
  tracks: [],
  selectedTrackId: 'master',
  activeView: 'timeline',

  isPlaying: false,
  playhead: 0,
  duration: 60,
  bpm: 128,
  timeSignature: [4, 4],
  loop: false,
  loopStart: 0,
  loopEnd: 30,
  snapToGrid: true,
  gridSnap: '1/16',
  setSnapToGrid: (snapToGrid) => set({ snapToGrid }),
  setGridSnap: (gridSnap) => set({ gridSnap }),

  selection: null,
  sectionGain: 0,
  sectionLow: 0,
  sectionMid: 0,
  sectionHigh: 0,
  originalMasterUrl: null,
  originals: [],
  operations: [],
  auditionId: null,
  legoContextTrackIds: [],
  takes: [],
  commits: [],
  sequencerSteps: {} as Record<string, number>,

  setSequencerStep: (trackId, step) =>
    set((state) => ({
      sequencerSteps: { ...state.sequencerSteps, [trackId]: step },
    })),

  initProject: (songId, songTitle, duration, masterUrl, project) => {
    const dur = duration > 0 ? duration : 60;
    const masterTrack: DAWTrack = {
      id: 'master',
      name: songTitle ? `${songTitle} (Master)` : 'Master Mix',
      type: 'stem',
      color: '#00ffff',
      volume: 1.0,
      pan: 0,
      muted: false,
      solo: false,
      mixer: { volume: 1.0, pan: 0, muted: false, solo: false },
      fx: { ...DEFAULT_FX },
      hasOriginalStem: true,
      originalUrl: masterUrl || undefined,
      activeVersionTakeId: null,
      clips: masterUrl
        ? [
            {
              id: 'clip-master',
              name: songTitle || 'Full Track',
              url: masterUrl,
              startTime: 0,
              duration: dur,
              offset: 0,
            },
          ]
        : [],
    };

    set({
      songId,
      songTitle,
      duration: dur,
      tracks: [masterTrack],
      selectedTrackId: 'master',
      loopEnd: Math.min(30, dur),
      selection: { start: 0, end: Math.min(15, dur) },
      sectionGain: 0,
      originalMasterUrl: masterUrl || null,
      legoContextTrackIds: ['master'],
      takes: project?.takes ?? [],
      commits: project?.commits ?? [],
      isPlaying: false,
      playhead: 0,
      pendingTake: null,
      originals: [], operations: [], auditionId: null,
      bpm: (() => { const take = project?.takes.find(take => take.task === 'text2music'); const p = take?.provenance?.parameters; return p?.submitted?.bpm ?? p?.resolved?.bpm ?? 128; })(),
    });
    if (project) get().restoreSession(project.commits);
    if (project?.stems.length) get().syncStems(project.stems);
    if (project?.session) {
      const saved = retained(project.session.tracks, project.takes);
      set({
        ...project.session,
        tracks: saved,
        selection: get().selection ?? { start: 0, end: Math.min(15, dur) },
        operations: project.session.operations.filter(operation => operation.status !== 'submitting'),
      });
      for (const track of saved) {
        const shouldLoadEagerly =
          track.id === 'master' ||
          Boolean(track.activeTakeId) ||
          track.type === 'sample' ||
          Boolean(track.activeVersionTakeId && track.activeVersionTakeId !== 'ORG') ||
          Boolean(track.mixer?.solo ?? track.solo);
        if (!shouldLoadEagerly) continue;
        for (const clip of track.clips) {
          if (clip.url) void dawEngine.loadClip(track.id, clip.id, clip.url, clip.startTime, clip.offset, clip.duration);
        }
      }
    }
    get().syncLayerTracks();
  },

  setPlaying: (isPlaying) => set({ isPlaying }),
  setPlayhead: (playhead) => set({ playhead }),
  setDuration: (duration) => set({ duration }),
  setBpm: (bpm) => set({ bpm }),
  setLoop: (loop) => set({ loop }),
  setLoopRange: (loopStart, loopEnd) => set({ loopStart, loopEnd }),
  setSelection: (selection) => set({ selection }),
  setSectionGain: (sectionGain) => {
    set({ sectionGain });
    dawEngine.setSectionGain(sectionGain);
  },
  setSectionTone: (sectionLow, sectionMid, sectionHigh) => {
    set({ sectionLow, sectionMid, sectionHigh });
    dawEngine.setSectionTone(sectionLow, sectionMid, sectionHigh);
  },
  extractCurrentSection: async () => {
    const { selection, songId, selectedTrackId, tracks, takes } = get();
    if (!selection) return null;
    const candidate = takes.find(take => take.id === selectedTrackId);
    const trackId = candidate ? source(candidate, tracks) : selectedTrackId;
    if (!tracks.some(track => track.id === trackId)) { toast.error('Select a track before extracting'); return null; }
    const token = sdk.keys.currentToken();
    if (!token) {
      toast.error('Active session required to extract section. Please create a session.');
      promptSessionModal();
      return null;
    }
    const operation = crypto.randomUUID();
    set(state => ({ operations: [...state.operations, { id: operation, task: 'extract', status: 'submitting' }] }));
    try {
      const response = await sdk.fetch('/api/editing/extract', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          songId,
          stemId: trackId === 'master' ? undefined : trackId,
          sourceTakeId: candidate?.id,
          srcAudioUrl: candidate?.url,
          ...(candidate ? sourceInterval(candidate,tracks,selection) : selection),
        }),
      });
      if (response.status === 402) {
        set(state => ({ operations: state.operations.filter(item => item.id !== operation) }));
        toast.error('Active session required or session budget exhausted. Please top up your session.');
        promptSessionModal();
        return null;
      }
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to extract section');
      if (get().songId !== songId) return null;
      get().upsertTake(result.take);
      await get().toggleTake(result.take.id);
      set(state => ({
        operations: state.operations.filter(item => item.id !== operation),
        selectedTrackId: result.take.id,
        selection: interval(result.take, state.duration),
      }));
      return result.take;
    } catch (error) {
      set(state => ({ operations: state.operations.map(item => item.id === operation ? { ...item, status: 'error', error: error instanceof Error ? error.message : 'Extraction failed' } : item) }));
      toast.error(error instanceof Error ? error.message : 'Failed to extract section');
      return null;
    }
  },
  revertToOriginalMaster: () => {
    const original = get().takes.find(take => take.task === 'text2music');
    if (original) void get().activateTake(original.id);
  },
  setSelectedTrackId: (selectedTrackId) => set({ selectedTrackId }),
  setActiveView: (activeView) => set({ activeView }),

  setTracks: (tracks) => set({ tracks }),

  syncStems: (stems) => {
    if (!stems || stems.length === 0) return;
    const dur = get().duration > 0 ? get().duration : 60;
    const currentTracks = get().tracks;
    let masterTrack = currentTracks.find((t) => t.id === 'master') || currentTracks[0];

    // Handle master stem audio if present
    const masterStem = stems.find(
      (s) => s.name?.toLowerCase() === 'master' || s.id.startsWith('stem-master') || s.id.startsWith('stm-master')
    );
    if (masterStem && masterTrack) {
      masterTrack = {
        ...masterTrack,
        stemId: masterStem.id,
        hasOriginalStem: true,
        originalUrl: masterStem.url || masterTrack.originalUrl,
      };
    }
    if (masterStem && masterTrack && masterStem.url && (!masterTrack.activeVersionTakeId || masterTrack.activeVersionTakeId === 'MST') && masterTrack.clips[0]?.url !== masterStem.url) {
      masterTrack = { ...masterTrack, clips: [
        {
          id: 'clip-master',
          name: 'Master Output',
          url: masterStem.url,
          startTime: 0,
          duration: dur,
          offset: 0,
        },
      ] };
      dawEngine.loadClip('master', 'clip-master', masterStem.url, 0, 0, dur);
    }

    // Filter discrete isolated stems (vocals, drums, bass, instrumental, etc.)
    const nonMasterStems = stems.filter(
      (s) => s.name?.toLowerCase() !== 'master' && !s.id.startsWith('stem-master') && !s.id.startsWith('stm-master')
    );

    const realStemLayerNames = new Set(
      nonMasterStems.map((s) => String(s.name || 'stem').toLowerCase().trim().replace(/\s+/g, '_'))
    );

    const newStemTracks: DAWTrack[] = nonMasterStems.map((stem) => {
      const normName = String(stem.name || 'stem').toLowerCase().trim().replace(/\s+/g, '_');
      const existing = currentTracks.find((t) => t.id === stem.id || t.id === `layer-${normName}`);
      if (existing && existing.id === stem.id) {
        const updatedBase: DAWTrack = {
          ...existing,
          layerName: normName,
          stemType: normName,
          hasOriginalStem: true,
          originalUrl: stem.url,
        };
        if (existing.activeVersionTakeId && existing.activeVersionTakeId !== 'ORG') {
          return updatedBase;
        }
        if (existing.clips[0]?.url === stem.url) return updatedBase;
        const nextClips = [
          {
            id: `clip-${stem.id}`,
            name: formatLayerDisplayName(normName),
            url: stem.url,
            startTime: 0,
            duration: dur,
            offset: 0,
          },
        ];
        if (Boolean(existing.mixer?.solo ?? existing.solo)) {
          for (const clip of nextClips) void dawEngine.loadClip(stem.id, clip.id, clip.url, clip.startTime, clip.offset, clip.duration);
        }
        return { ...updatedBase, clips: nextClips };
      }
      if (existing && existing.id === `layer-${normName}`) {
        dawEngine.disposeTrack(existing.id);
      }
      const color = getStemTrackColor(normName);
      const displayName = formatLayerDisplayName(normName);
      const stemTrack: DAWTrack = {
        id: stem.id,
        name: displayName,
        layerName: normName,
        stemType: normName,
        type: 'stem',
        color,
        volume: typeof stem.volume === 'number' ? stem.volume : 1.0,
        pan: typeof stem.pan === 'number' ? stem.pan : 0,
        muted: Boolean(stem.is_muted),
        solo: Boolean(stem.is_solo),
        mixer: {
          volume: typeof stem.volume === 'number' ? stem.volume : 1.0,
          pan: typeof stem.pan === 'number' ? stem.pan : 0,
          muted: Boolean(stem.is_muted),
          solo: Boolean(stem.is_solo),
        },
        fx: JSON.parse(JSON.stringify(DEFAULT_FX)),
        hasOriginalStem: true,
        originalUrl: stem.url,
        activeVersionTakeId: null,
        clips: [
          {
            id: `clip-${stem.id}`,
            name: displayName,
            url: stem.url,
            startTime: 0,
            duration: dur,
            offset: 0,
          },
        ],
      };

      if (stem.url && Boolean(stem.is_solo)) {
        dawEngine.loadClip(stem.id, `clip-${stem.id}`, stem.url, 0, 0, dur);
      }

      return stemTrack;
    });

    const nonStemCustomTracks = currentTracks.filter(
      (t) =>
        t.id !== 'master' &&
        !stems.some((s) => s.id === t.id) &&
        !(t.id.startsWith('layer-') && realStemLayerNames.has(t.id.slice('layer-'.length)))
    );

    const mergedTracks = masterTrack ? [masterTrack, ...newStemTracks, ...nonStemCustomTracks] : [...newStemTracks, ...nonStemCustomTracks];
    set({
      tracks: mergedTracks,
      ...(masterStem?.url ? { originalMasterUrl: masterStem.url } : {}),
    });
    get().syncLayerTracks();
  },

  syncLayerTracks: (preferredTakeId) => {
    const state = get();
    const dur = state.duration > 0 ? state.duration : 60;
    const pendingLayerTakes = state.takes
      .filter((t) => pending(t) && isLayerTake(t))
      .sort((a, b) => a.take_number - b.take_number);

    const layerGroups = new Map<string, Take[]>();
    for (const tk of pendingLayerTakes) {
      const lName = layerTrackName(tk);
      const list = layerGroups.get(lName) || [];
      list.push(tk);
      layerGroups.set(lName, list);
    }

    let nextTracks = [...state.tracks];
    const clipsToLoad: { trackId: string; clips: DAWClip[]; disposeFirst?: boolean; mixer?: DAWTrack['mixer'] }[] = [];

    // 1. Clean up virtual layer tracks (`layer-*` with `hasOriginalStem === false`) that no longer have pending takes
    nextTracks = nextTracks.filter((t) => {
      if (t.id.startsWith('layer-') && t.hasOriginalStem === false) {
        const lName = t.layerName || t.id.slice('layer-'.length);
        if (!layerGroups.has(lName)) {
          dawEngine.disposeTrack(t.id);
          return false;
        }
      }
      return true;
    });

    // 2. Reconcile existing stem lanes whose pending layer takes were all merged or deleted
    nextTracks = nextTracks.map((t) => {
      if (t.id === 'master' || t.id === t.activeTakeId || t.type !== 'stem') return t;
      const lName = t.layerName || t.name.toLowerCase().trim().replace(/\s+/g, '_');
      if (!layerGroups.has(lName) && t.activeVersionTakeId) {
        const baseUrl = t.originalUrl || t.clips[0]?.url;
        const baseClip: DAWClip = {
          id: `clip-${t.id}`,
          name: t.name,
          url: baseUrl || '',
          startTime: 0,
          duration: dur,
          offset: 0,
        };
        if (baseUrl && t.clips[0]?.url !== baseUrl) {
          clipsToLoad.push({ trackId: t.id, clips: [baseClip], disposeFirst: true, mixer: t.mixer });
        }
        return {
          ...t,
          activeVersionTakeId: null,
          clips: baseUrl ? [baseClip] : t.clips,
        };
      }
      return t;
    });

    // 3. Reconcile or create lane tracks for each active layer group
    for (const [lName, groupTakes] of layerGroups.entries()) {
      const matchIdx = nextTracks.findIndex(
        (t) =>
          t.id !== 'master' &&
          t.id !== t.activeTakeId &&
          t.type === 'stem' &&
          ((t.layerName || t.name.toLowerCase().trim().replace(/\s+/g, '_')) === lName || t.id === `layer-${lName}`)
      );

      const preferred = preferredTakeId ? groupTakes.find((tk) => tk.id === preferredTakeId) : undefined;

      if (matchIdx >= 0) {
        const existing = nextTracks[matchIdx];
        const hasOrg = existing.hasOriginalStem !== false && !existing.id.startsWith('layer-');
        const originalUrl = existing.originalUrl || (hasOrg ? existing.clips[0]?.url : undefined);
        let nextVersionId = existing.activeVersionTakeId;
        if (preferred) {
          nextVersionId = preferred.id;
        } else if (nextVersionId === 'ORG' && hasOrg) {
          nextVersionId = 'ORG';
        } else if (!nextVersionId || !groupTakes.some((tk) => tk.id === nextVersionId)) {
          nextVersionId = groupTakes[groupTakes.length - 1].id;
        }

        if (nextVersionId === 'ORG' && originalUrl) {
          const orgClip: DAWClip = {
            id: `clip-${existing.id}`,
            name: existing.name,
            url: originalUrl,
            startTime: 0,
            duration: dur,
            offset: 0,
          };
          const urlChanged = existing.clips.length !== 1 || existing.clips[0]?.url !== originalUrl;
          nextTracks[matchIdx] = {
            ...existing,
            layerName: lName,
            stemType: lName,
            hasOriginalStem: hasOrg,
            originalUrl,
            activeVersionTakeId: 'ORG',
            clips: urlChanged ? [orgClip] : existing.clips,
          };
          if (urlChanged) {
            clipsToLoad.push({ trackId: existing.id, clips: [orgClip], disposeFirst: true, mixer: existing.mixer });
          }
        } else {
          const activeTake = groupTakes.find((tk) => tk.id === nextVersionId) || groupTakes[groupTakes.length - 1];
          const targetClips = clips(activeTake, dur);
          const urlChanged = existing.clips[0]?.url !== activeTake.url || existing.clips.length !== targetClips.length;
          const nextMuted = preferred ? false : existing.muted;
          const nextMixer = existing.mixer ? { ...existing.mixer, muted: nextMuted } : { volume: existing.volume, pan: existing.pan, muted: nextMuted, solo: existing.solo };
          nextTracks[matchIdx] = {
            ...existing,
            layerName: lName,
            stemType: lName,
            hasOriginalStem: hasOrg,
            originalUrl,
            activeVersionTakeId: activeTake.id,
            muted: nextMuted,
            mixer: nextMixer,
            clips: urlChanged ? targetClips : existing.clips,
          };
          if (urlChanged) {
            clipsToLoad.push({ trackId: existing.id, clips: targetClips, disposeFirst: true, mixer: nextMixer });
          }
        }
      } else {
        const activeTake = preferred || groupTakes[groupTakes.length - 1];
        const trackId = `layer-${lName}`;
        const displayName = formatLayerDisplayName(lName);
        const targetClips = clips(activeTake, dur);
        const newLane: DAWTrack = {
          id: trackId,
          name: displayName,
          layerName: lName,
          stemType: lName,
          type: 'stem',
          color: getStemTrackColor(lName),
          volume: 1.0,
          pan: 0,
          muted: false,
          solo: false,
          mixer: { volume: 1.0, pan: 0, muted: false, solo: false },
          fx: JSON.parse(JSON.stringify(DEFAULT_FX)),
          clips: targetClips,
          hasOriginalStem: false,
          activeVersionTakeId: activeTake.id,
        };
        nextTracks.push(newLane);
        clipsToLoad.push({ trackId, clips: targetClips, disposeFirst: false, mixer: newLane.mixer });
      }
    }

    // 4. Reconcile Full-Song Restyle (`cover`) takes on Master
    const masterRestyleTakes = state.takes
      .filter((t) => pending(t) && isFullSongRestyleTake(t))
      .sort((a, b) => a.take_number - b.take_number);
    const masterIdx = nextTracks.findIndex((t) => t.id === 'master');
    if (masterIdx >= 0) {
      const mTrack = nextTracks[masterIdx];
      const baseMasterUrl = mTrack.originalUrl || state.originalMasterUrl || mTrack.clips[0]?.url;
      if (masterRestyleTakes.length > 0) {
        const preferredRestyle = preferredTakeId ? masterRestyleTakes.find((tk) => tk.id === preferredTakeId) : undefined;
        let nextMasterVer = mTrack.activeVersionTakeId;
        if (preferredRestyle) {
          nextMasterVer = preferredRestyle.id;
        } else if (nextMasterVer !== 'MST' && (!nextMasterVer || !masterRestyleTakes.some((tk) => tk.id === nextMasterVer))) {
          nextMasterVer = 'MST';
        }
        const selectedRestyle = nextMasterVer && nextMasterVer !== 'MST'
          ? masterRestyleTakes.find((tk) => tk.id === nextMasterVer)
          : undefined;
        const targetUrl = selectedRestyle ? selectedRestyle.url : baseMasterUrl;
        const urlChanged = Boolean(targetUrl && mTrack.clips[0]?.url !== targetUrl);
        const masterClip: DAWClip = {
          id: 'clip-master',
          name: selectedRestyle ? `${mTrack.name} (#TK${selectedRestyle.take_number})` : (state.songTitle || 'Master Output'),
          url: targetUrl || '',
          startTime: 0,
          duration: dur,
          offset: 0,
        };
        nextTracks[masterIdx] = {
          ...mTrack,
          hasOriginalStem: true,
          originalUrl: baseMasterUrl,
          activeVersionTakeId: selectedRestyle ? selectedRestyle.id : 'MST',
          clips: urlChanged && targetUrl ? [masterClip] : mTrack.clips,
        };
        if (urlChanged && targetUrl) {
          clipsToLoad.push({ trackId: 'master', clips: [masterClip], disposeFirst: false, mixer: mTrack.mixer });
        }
      } else if (mTrack.activeVersionTakeId) {
        const urlChanged = Boolean(baseMasterUrl && mTrack.clips[0]?.url !== baseMasterUrl);
        const masterClip: DAWClip = {
          id: 'clip-master',
          name: state.songTitle || 'Master Output',
          url: baseMasterUrl || '',
          startTime: 0,
          duration: dur,
          offset: 0,
        };
        nextTracks[masterIdx] = {
          ...mTrack,
          originalUrl: baseMasterUrl,
          activeVersionTakeId: null,
          clips: urlChanged && baseMasterUrl ? [masterClip] : mTrack.clips,
        };
        if (urlChanged && baseMasterUrl) {
          clipsToLoad.push({ trackId: 'master', clips: [masterClip], disposeFirst: false, mixer: mTrack.mixer });
        }
      }
    }

    set({ tracks: nextTracks });
    for (const item of clipsToLoad) {
      if (item.disposeFirst && item.trackId !== 'master') {
        dawEngine.disposeTrack(item.trackId);
      }
      for (const clip of item.clips) {
        if (clip.url) {
          void dawEngine.loadClip(item.trackId, clip.id, clip.url, clip.startTime, clip.offset, clip.duration);
        }
      }
      if (item.mixer) {
        dawEngine.updateTrackMixer(item.trackId, item.mixer as any);
      }
    }
  },

  selectLaneVersion: async (trackId, versionId) => {
    const state = get();
    const track = state.tracks.find((t) => t.id === trackId);
    if (!track) return;
    const dur = state.duration > 0 ? state.duration : 60;
    if (versionId === 'ORG' || versionId === null) {
      const baseUrl = track.originalUrl;
      if (!baseUrl) return;
      const orgClip: DAWClip = {
        id: `clip-${track.id}`,
        name: track.name,
        url: baseUrl,
        startTime: 0,
        duration: dur,
        offset: 0,
      };
      dawEngine.disposeTrack(track.id);
      set((s) => ({
        selectedTrackId: track.id,
        tracks: s.tracks.map((t) => (t.id === track.id ? { ...t, activeVersionTakeId: 'ORG', clips: [orgClip] } : t)),
      }));
      await dawEngine.loadClip(track.id, orgClip.id, orgClip.url, orgClip.startTime, orgClip.offset, orgClip.duration);
      if (track.mixer) dawEngine.updateTrackMixer(track.id, track.mixer as any);
      return;
    }
    const take = state.takes.find((tk) => tk.id === versionId);
    if (!take) return;
    const targetClips = clips(take, dur);
    dawEngine.disposeTrack(track.id);
    const nextMixer = track.mixer ? { ...track.mixer, muted: false } : { volume: track.volume, pan: track.pan, muted: false, solo: track.solo };
    set((s) => ({
      selectedTrackId: track.id,
      tracks: s.tracks.map((t) =>
        t.id === track.id
          ? { ...t, activeVersionTakeId: take.id, muted: false, mixer: nextMixer, clips: targetClips }
          : t
      ),
    }));
    for (const part of targetClips) {
      await dawEngine.loadClip(track.id, part.id, part.url, part.startTime, part.offset, part.duration);
    }
    dawEngine.updateTrackMixer(track.id, nextMixer as any);
  },

  selectMasterVersion: async (versionId) => {
    const state = get();
    const masterTrack = state.tracks.find((t) => t.id === 'master');
    if (!masterTrack) return;
    const dur = state.duration > 0 ? state.duration : 60;
    if (versionId === 'MST' || versionId === null) {
      const baseUrl = masterTrack.originalUrl || state.originalMasterUrl;
      if (!baseUrl) return;
      const masterClip: DAWClip = {
        id: 'clip-master',
        name: state.songTitle || 'Master Output',
        url: baseUrl,
        startTime: 0,
        duration: dur,
        offset: 0,
      };
      set((s) => ({
        selectedTrackId: 'master',
        tracks: s.tracks.map((t) => (t.id === 'master' ? { ...t, activeVersionTakeId: 'MST', clips: [masterClip] } : t)),
      }));
      await dawEngine.loadClip('master', 'clip-master', baseUrl, 0, 0, dur);
      return;
    }
    const take = state.takes.find((tk) => tk.id === versionId);
    if (!take) return;
    const masterClip: DAWClip = {
      id: 'clip-master',
      name: `${state.songTitle || 'Master'} (#TK${take.take_number})`,
      url: take.url,
      startTime: 0,
      duration: dur,
      offset: 0,
    };
    set((s) => ({
      selectedTrackId: 'master',
      tracks: s.tracks.map((t) => (t.id === 'master' ? { ...t, activeVersionTakeId: take.id, clips: [masterClip] } : t)),
    }));
    await dawEngine.loadClip('master', 'clip-master', take.url, 0, 0, dur);
  },

  addTrack: (type, name) => {
    const id = `track-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const colors = ['#00ffff', '#ff0055', '#00ff66', '#ffaa00', '#9933ff', '#0099ff'];
    const trackColor = colors[get().tracks.length % colors.length];

    const newTrack: DAWTrack = {
      id,
      name: name || `${type.toUpperCase()} ${get().tracks.length + 1}`,
      type,
      color: trackColor,
      volume: 0.9,
      pan: 0,
      muted: false,
      solo: false,
      mixer: { volume: 0.9, pan: 0, muted: false, solo: false },
      fx: JSON.parse(JSON.stringify(DEFAULT_FX)),
      clips: [],
      sequencerVoices: type === 'sequencer' ? JSON.parse(JSON.stringify(DEFAULT_SEQUENCER_VOICES)) : undefined,
      pianoRollNotes: type === 'pianoroll' ? [] : undefined,
      strudelCode: type === 'strudel' ? '' : undefined,
    };

    set((state) => ({
      tracks: [...state.tracks, newTrack],
      selectedTrackId: id,
      activeView: type === 'sequencer' ? 'sequencer' : type === 'pianoroll' ? 'pianoroll' : type === 'strudel' ? 'strudel' : state.activeView,
    }));

    return newTrack;
  },

  removeTrack: (trackId) => {
    if (trackId === 'master') return; // Cannot delete master
    const removed = get().tracks.find((t) => t.id === trackId);
    const take = get().takes.find((tk) => tk.id === trackId);
    const isReplacement = Boolean(take && isMasterTargetTake(take) && ['repaint', 'complete', 'cover'].includes(take.task));
    dawEngine.disposeTrack(trackId);
    set((state) => {
      let nextOriginals = state.originals;
      if (isReplacement && removed?.clips.length) {
        for (const clip of removed.clips) {
          const rStart = clip.startTime;
          const rEnd = clip.startTime + clip.duration;
          nextOriginals = nextOriginals.flatMap(item =>
            item.end <= rStart || item.start >= rEnd
              ? [item]
              : [
                  ...(item.start < rStart ? [{ start: item.start, end: rStart }] : []),
                  ...(item.end > rEnd ? [{ start: rEnd, end: item.end }] : []),
                ],
          );
        }
      }
      return {
        tracks: state.tracks.filter((t) => t.id !== trackId),
        selectedTrackId: state.selectedTrackId === trackId ? 'master' : state.selectedTrackId,
        legoContextTrackIds: state.legoContextTrackIds.filter((id) => id !== trackId),
        originals: nextOriginals,
      };
    });
    if (isReplacement) dawEngine.syncOriginals();
  },

  updateTrackMixer: (trackId, partial) => {
    set((state) => ({
      tracks: state.tracks.map((t) => {
        if (t.id !== trackId) return t;
        const updated = { ...t, ...partial };
        updated.mixer = {
          volume: updated.volume,
          pan: updated.pan,
          muted: updated.muted,
          solo: updated.solo,
        };
        return updated;
      }),
    }));
    const targetTrack = get().tracks.find((t) => t.id === trackId);
    const mixer = targetTrack?.mixer || (targetTrack ? { volume: targetTrack.volume, pan: targetTrack.pan, muted: targetTrack.muted, solo: targetTrack.solo } : partial);
    dawEngine.updateTrackMixer(trackId, mixer as any);
  },

  updateTrackFx: (trackId: string, fxKeyOrConfig: any, partial?: any) => {
    set((state) => ({
      tracks: state.tracks.map((t) => {
        if (t.id !== trackId) return t;
        if (typeof fxKeyOrConfig === 'string') {
          const fxKey = fxKeyOrConfig;
          const baseFx = t.fx || JSON.parse(JSON.stringify(DEFAULT_FX));
          const currentFxObj = (baseFx as any)[fxKey] || {};
          return {
            ...t,
            fx: {
              ...baseFx,
              [fxKey]: {
                ...currentFxObj,
                ...partial,
              },
            },
          };
        } else {
          return {
            ...t,
            fx: { ...fxKeyOrConfig },
          };
        }
      }),
    }));
    const targetTrack = get().tracks.find((t) => t.id === trackId);
    if (targetTrack) {
      dawEngine.updateTrackFx(trackId, targetTrack.fx);
    } else if (typeof fxKeyOrConfig !== 'string') {
      dawEngine.updateTrackFx(trackId, fxKeyOrConfig);
    }
  },

  addClip: (trackId, clip) => {
    set((state) => ({
      tracks: state.tracks.map((t) => {
        if (t.id !== trackId) return t;
        return {
          ...t,
          clips: [...t.clips, clip],
        };
      }),
    }));
  },

  updateClip: (trackId, clipId, partial) => {
    set((state) => ({
      tracks: state.tracks.map((t) => {
        if (t.id !== trackId) return t;
        return {
          ...t,
          clips: t.clips.map((c) => (c.id === clipId ? { ...c, ...partial } : c)),
        };
      }),
    }));
  },

  removeClip: (trackId, clipId) => {
    set((state) => ({
      tracks: state.tracks.map((t) => {
        if (t.id !== trackId) return t;
        return {
          ...t,
          clips: t.clips.filter((c) => c.id !== clipId),
        };
      }),
    }));
  },

  toggleSequencerStep: (trackId, voiceIdx, stepIdx) => {
    set((state) => ({
      tracks: state.tracks.map((t) => {
        if (t.id !== trackId || !t.sequencerVoices) return t;
        const newVoices = [...t.sequencerVoices];
        const v = { ...newVoices[voiceIdx] };
        const newSteps = [...v.steps];
        newSteps[stepIdx] = !newSteps[stepIdx];
        v.steps = newSteps;
        newVoices[voiceIdx] = v;
        return { ...t, sequencerVoices: newVoices };
      }),
    }));
  },

  setSequencerVoiceVolume: (trackId, voiceIdx, stepIdx, velocity) => {
    set((state) => ({
      tracks: state.tracks.map((t) => {
        if (t.id !== trackId || !t.sequencerVoices) return t;
        const newVoices = [...t.sequencerVoices];
        const v = { ...newVoices[voiceIdx] };
        const newVel = [...v.velocity];
        newVel[stepIdx] = velocity;
        v.velocity = newVel;
        newVoices[voiceIdx] = v;
        return { ...t, sequencerVoices: newVoices };
      }),
    }));
  },

  clearSequencerSteps: (trackId) => {
    set((state) => ({
      tracks: state.tracks.map((t) => {
        if (t.id !== trackId || !t.sequencerVoices) return t;
        const newVoices = t.sequencerVoices.map((v) => ({
          ...v,
          steps: new Array(v.steps.length).fill(false),
        }));
        return { ...t, sequencerVoices: newVoices };
      }),
    }));
  },

  randomizeSequencerSteps: (trackId, density = 0.3) => {
    set((state) => ({
      tracks: state.tracks.map((t) => {
        if (t.id !== trackId || !t.sequencerVoices) return t;
        const newVoices = t.sequencerVoices.map((v) => ({
          ...v,
          steps: v.steps.map(() => Math.random() < density),
        }));
        return { ...t, sequencerVoices: newVoices };
      }),
    }));
  },

  addPianoRollNote: (trackId, note) => {
    const id = `note-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    set((state) => ({
      tracks: state.tracks.map((t) => {
        if (t.id !== trackId) return t;
        const notes = t.pianoRollNotes || [];
        return {
          ...t,
          pianoRollNotes: [...notes, { ...note, id }],
        };
      }),
    }));
  },

  removePianoRollNote: (trackId, noteId) => {
    set((state) => ({
      tracks: state.tracks.map((t) => {
        if (t.id !== trackId || !t.pianoRollNotes) return t;
        return {
          ...t,
          pianoRollNotes: t.pianoRollNotes.filter((n) => n.id !== noteId),
        };
      }),
    }));
  },

  clearPianoRollNotes: (trackId) => {
    set((state) => ({
      tracks: state.tracks.map((t) => {
        if (t.id !== trackId) return t;
        return {
          ...t,
          pianoRollNotes: [],
        };
      }),
    }));
  },

  quantizePianoRoll: (trackId, gridDivision) => {
    set((state) => ({
      tracks: state.tracks.map((t) => {
        if (t.id !== trackId || !t.pianoRollNotes) return t;
        return {
          ...t,
          pianoRollNotes: t.pianoRollNotes.map((n) => ({
            ...n,
            startTime: Math.round(n.startTime / gridDivision) * gridDivision,
            duration: Math.max(gridDivision, Math.round(n.duration / gridDivision) * gridDivision),
          })),
        };
      }),
    }));
  },

  updateStrudelCode: (trackId, strudelCode) => {
    set((state) => ({
      tracks: state.tracks.map((t) => (t.id === trackId ? { ...t, strudelCode } : t)),
    }));
  },

  toggleLegoContext: (trackId) => {
    set((state) => {
      const exists = state.legoContextTrackIds.includes(trackId);
      return {
        legoContextTrackIds: exists
          ? state.legoContextTrackIds.filter((id) => id !== trackId)
          : trackId === 'master' ? ['master'] : [...state.legoContextTrackIds.filter(id => id !== 'master'), trackId],
      };
    });
  },

  pendingTake: null,
  setTakes: (takes) => {
    const state = get();
    const tracks = retained(state.tracks, takes);
    for (const track of state.tracks) if (!tracks.includes(track)) dawEngine.disposeTrack(track.id);
    set({ takes, tracks, ...(!state.takes.some(take => take.task === 'text2music') ? { bpm: takes.find(take => take.task === 'text2music')?.provenance?.parameters?.submitted?.bpm ?? takes.find(take => take.task === 'text2music')?.provenance?.parameters?.resolved?.bpm ?? state.bpm } : {}) });
    get().syncLayerTracks();
  },
  upsertTake: (take) => {
    set(state => ({ takes: [...state.takes.filter(item => item.id !== take.id), take] }));
    get().syncLayerTracks(take.id);
  },
  moveTake: async (takeId, shift) => {
    if (!Number.isFinite(shift) || get().pendingTake) return;
    const track = get().tracks.find(track => track.id === takeId && track.activeTakeId === takeId);
    const take = get().takes.find(take => take.id === takeId);
    if (!track || !take || !track.clips.length) return;
    const isReplacement = isMasterTargetTake(take) && ['repaint', 'complete', 'cover'].includes(take.task);
    const original = clips(take, get().duration);
    const starts = track.clips.map((clip, index) => clip.origin ?? original[index]?.startTime ?? clip.startTime);
    const moved = Math.max(shift, -Math.min(...starts));
    const next = track.clips.map((clip, index) => ({ ...clip, origin: starts[index], startTime: starts[index] + moved }));
    dawEngine.pauseTransport();
    dawEngine.disposeTrack(takeId);
    set(state => {
      let nextOriginals = state.originals;
      if (isReplacement) {
        for (const clip of track.clips) {
          const rStart = clip.startTime;
          const rEnd = clip.startTime + clip.duration;
          nextOriginals = nextOriginals.flatMap(item =>
            item.end <= rStart || item.start >= rEnd
              ? [item]
              : [
                  ...(item.start < rStart ? [{ start: item.start, end: rStart }] : []),
                  ...(item.end > rEnd ? [{ start: rEnd, end: item.end }] : []),
                ],
          );
        }
        nextOriginals = [
          ...nextOriginals,
          ...next.map(clip => ({ start: clip.startTime, end: clip.startTime + clip.duration })),
        ];
      }
      return {
        tracks: state.tracks.map(item => item.id === takeId ? { ...item, clips: next } : item),
        originals: nextOriginals,
        selection: {start:Math.min(...next.map(clip => clip.startTime)),end:Math.max(...next.map(clip => clip.startTime + clip.duration))},
      };
    });
    if (isReplacement) dawEngine.syncOriginals();
    try {
      for (const clip of next) await dawEngine.loadClip(takeId, clip.id, clip.url, clip.startTime, clip.offset, clip.duration);
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not move the section'); }
  },
  toggleOriginal: (region) => {
    set(state => ({ originals: state.originals.some(item => item.start <= region.start && item.end >= region.end) ? state.originals.flatMap(item => item.end <= region.start || item.start >= region.end ? [item] : [...(item.start < region.start ? [{start:item.start,end:region.start}] : []), ...(item.end > region.end ? [{start:region.end,end:item.end}] : [])]) : [...state.originals, region] }));
    dawEngine.syncOriginals();
  },
  mergeTakes: async (takeIds, selectedRegion) => {
    const state = get();
    if (state.pendingTake || !takeIds.length) return;
    const solo = state.tracks.some(track => track.solo);
    if (takeIds.some(id => {const track=state.tracks.find(track=>track.id===id);return !track || track.muted || solo && !track.solo;})) {toast.error('Enable the selected layers and clear other lane solos before merging');return;}
    const candidates = takeIds.map(id => state.takes.find(take => take.id === id)!);
    if (candidates.some(take => !take)) return;
    const placements = candidates.map(take => {
      const track = state.tracks.find(track => track.id === take.id && track.activeTakeId === take.id);
      const clip = track?.clips[0];
      return {takeId:take.id, shift:clip ? clip.startTime - (clip.origin ?? clips(take, state.duration)[0].startTime) : 0};
    });
    const ranges = candidates.flatMap(take => state.tracks.find(track => track.id === take.id)?.clips.map(clip => ({start:clip.startTime,end:clip.startTime + clip.duration})) ?? [interval(take,state.duration)]);
    const region = selectedRegion ?? { start: Math.min(...ranges.map(range => range.start)), end: Math.max(...ranges.map(range => range.end)) };
    const songId = state.songId;
    set({ pendingTake: takeIds[0] });
    try {
      const ids = ['master', ...takeIds];
      const extendClips = candidates
        .filter(take => take.task === 'extend')
        .flatMap(take => state.tracks.find(track => track.id === take.id)?.clips.map(clip => ({ startTime: clip.startTime, duration: clip.duration })) ?? []);
      const renderDuration = extendClips.length > 0
        ? Math.max(masterArrangement(state.duration, extendClips).duration, region.end)
        : region.end;
      const rendered = await dawEngine.render(ids, renderDuration, true, region.start);
      const form = new FormData(); form.append('file', rendered, 'master.wav');
      const upload = await sdk.fetch(`/api/editing/source?songId=${encodeURIComponent(songId)}`, { method: 'POST', body: form });
      const data = await upload.json();
      if (!upload.ok || !data.url) throw new Error(data.error || 'Could not save the selected section');
      const response = await sdk.fetch('/api/editing/activate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ songId, takeId: takeIds[0], action: 'merge', composition: { takeIds, placements, region, original: !state.tracks.find(track => track.id === 'master')?.muted && !state.originals.some(item => item.start <= region.start && item.end >= region.end), commitId: state.commits[0]?.id ?? null, srcAudioUrl: data.url } }) });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'Could not merge the section');
      const history = await sdk.fetch(`/api/editing/history/${encodeURIComponent(songId)}`);
      if (!history.ok) throw new Error('Could not refresh the saved master');
      const project = await history.json();
      if (get().songId !== songId) return;
      for (const id of takeIds) {
        const track = get().tracks.find(track => track.id === id);
        const take = project.takes.find((take: Take) => take.id === id);
        if (!track) continue;
        if (!take || take.provenance?.mergedInto) get().removeTrack(id);
        else if (take) {
          const shift = placements.find(item => item.takeId === id)!.shift;
          const pending = clips(take, result.take.provenance.outputDuration).map(clip => ({...clip,origin:clip.startTime,startTime:clip.startTime + shift}));
          dawEngine.disposeTrack(id);
          set(current => ({ tracks: current.tracks.map(item => item.id === id ? { ...item, clips: pending } : item) }));
          for (const clip of pending) await dawEngine.loadClip(id, clip.id, clip.url, clip.startTime, clip.offset, clip.duration);
        }
      }
      const nextDuration = result.take.provenance.outputDuration;
      const nextMasterUrl = result.take.url;
      set(current => ({
        takes: project.takes,
        commits: project.commits,
        duration: nextDuration,
        originalMasterUrl: nextMasterUrl || current.originalMasterUrl,
        tracks: current.tracks.map(track =>
          track.id === 'master' && nextMasterUrl
            ? {
                ...track,
                activeTakeId: result.take.id,
                activeVersionTakeId: null,
                originalUrl: nextMasterUrl,
                clips: track.clips.length
                  ? track.clips.map((clip, idx) => idx === 0 ? { ...clip, url: nextMasterUrl, offset: 0, duration: nextDuration } : clip)
                  : [{ id: 'clip-master', name: 'Master Output', url: nextMasterUrl, startTime: 0, offset: 0, duration: nextDuration }],
              }
            : track
        ),
        originals: current.originals.flatMap(item => item.end <= region.start || item.start >= region.end ? [item] : [...(item.start < region.start ? [{start:item.start,end:region.start}] : []), ...(item.end > region.end ? [{start:region.end,end:item.end}] : [])]),
        selectedTrackId: 'master',
        isPlaying: false,
      }));
      if (nextMasterUrl) {
        const masterClip = get().tracks.find(track => track.id === 'master')?.clips[0];
        if (masterClip) void dawEngine.loadClip('master', masterClip.id, nextMasterUrl, masterClip.startTime, 0, nextDuration);
      }
      get().syncStems(project.stems);
      toast.success('Section merged');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not merge the section'); }
    finally { if (get().songId === songId) set({ pendingTake: null }); }
  },

  toggleTake: async (takeId) => {
    const initial = get();
    const take = initial.takes.find(item => item.id === takeId);
    if (!take) return;
    if (isLayerTake(take)) {
      const tName = layerTrackName(take) ?? 'other';
      const lane = initial.tracks.find(
        track => track.id !== 'master' && (track.layerName === tName || track.name.toLowerCase().replace(/\s+/g, '_') === tName)
      );
      if (lane) await get().selectLaneVersion(lane.id, take.id);
      return;
    }
    if (isFullSongRestyleTake(take)) {
      await get().selectMasterVersion(take.id);
      return;
    }
    const mounted = initial.tracks.find(track => track.id === takeId && track.activeTakeId === takeId);
    if (initial.selectedTrackId === takeId) dawEngine.stopAuditionTake();
    if (mounted) {
      get().removeTrack(mounted.id);
      if (initial.selectedTrackId === takeId) {
        set({ selectedTrackId: 'master' });
      }
      return;
    }
    const lane = !isMasterTargetTake(take) && take.stem_id
      ? initial.tracks.find(track => track.id === take.stem_id || track.stemId === take.stem_id)
      : initial.tracks.find(track => track.id === 'master');
    if (lane && isBase(take, initial.tracks, initial.takes)) {
      get().updateTrackMixer(lane.id, { muted: !lane.muted, solo: false });
      return;
    }
    for (const existingTrack of initial.tracks) {
      if (!existingTrack.activeTakeId || existingTrack.id === 'master' || existingTrack.stemId) continue;
      const otherTake = initial.takes.find(item => item.id === existingTrack.activeTakeId);
      if (otherTake && otherTake.id !== take.id && otherTake.task === take.task && (isMasterTargetTake(take) ? isMasterTargetTake(otherTake) : (otherTake.stem_id ?? null) === (take.stem_id ?? null))) {
        get().removeTrack(existingTrack.id);
      }
    }
    const { tracks, duration, originals } = get();
    const range = preview(take);
    const clip: DAWClip = {
      id: `clip-${take.id}`, name: `Take #${take.take_number}`, url: take.url,
      startTime: range.timelineStart, offset: range.start,
      duration: range.end === undefined ? take.provenance?.outputDuration ?? duration : range.end - range.start,
    };
    const track: DAWTrack = {
      id: take.id, activeTakeId: take.id, name: clip.name, type: 'sample',
      color: lane?.color ?? '#00ffff', volume: 1, pan: 0, muted: false, solo: false,
      mixer: { volume: 1, pan: 0, muted: false, solo: false },
      fx: JSON.parse(JSON.stringify(DEFAULT_FX)), clips: clips(take, duration),
    };
    const firstClip = track.clips[0];
    const isReplacement = isMasterTargetTake(take) && ['repaint', 'complete', 'cover'].includes(take.task);
    const nextOriginals = isReplacement
      ? [
          ...originals,
          ...track.clips.map(part => ({ start: part.startTime, end: part.startTime + part.duration })),
        ]
      : originals;
    set({
      tracks: [...tracks, track],
      originals: nextOriginals,
      selectedTrackId: take.id,
      selection: firstClip ? { start: firstClip.startTime, end: firstClip.startTime + firstClip.duration } : interval(take, duration),
    });
    if (isReplacement) dawEngine.syncOriginals();
    try {
      for (const part of track.clips) await dawEngine.loadClip(track.id, part.id, part.url, part.startTime, part.offset, part.duration);
    } catch (error) {
      if (get().tracks.includes(track)) get().removeTrack(track.id);
      toast.error(error instanceof Error ? error.message : 'Could not load take');
    }
  },

  activateTake: async (takeId, action = 'base') => {
    const target = get().takes.find(take => take.id === takeId);
    if (!target) return;
    if (action === 'merge' && !isLayerTake(target) && !isFullSongRestyleTake(target) && isMasterTargetTake(target)) {
      return get().mergeTakes([takeId]);
    }
    if ((action === 'base' && isBase(target, get().tracks, get().takes)) || get().pendingTake) return;
    const songId = get().songId;
    set({ pendingTake: takeId });
    try {
      const response = await sdk.fetch('/api/editing/activate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ songId, stemId: target.stem_id ?? undefined, takeId, action }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'Failed to select version');
      const history = await sdk.fetch(`/api/editing/history/${encodeURIComponent(songId)}`);
      if (!history.ok) throw new Error('Version saved, but the arrangement could not be refreshed');
      const project = await history.json();
      if (get().songId !== songId) return;
      const nextMasterBase = project.takes.find((t: Take) => isMasterTargetTake(t) && t.is_active);
      if (result.take?.provenance?.target === 'master' && nextMasterBase) {
        const masterDuration = result.take?.provenance?.outputDuration ?? get().duration;
        set(current => ({
          duration: masterDuration,
          tracks: current.tracks.map(track =>
            track.id === 'master'
              ? {
                  ...track,
                  activeTakeId: nextMasterBase.id,
                  activeVersionTakeId: null,
                  originalUrl: nextMasterBase.url,
                  clips: track.clips.map((clip, idx) =>
                    idx === 0 ? { ...clip, url: nextMasterBase.url, offset: 0, duration: masterDuration } : clip
                  ),
                }
              : track
          ),
        }));
        const masterClip = get().tracks.find(track => track.id === 'master')?.clips[0];
        if (masterClip) {
          void dawEngine.loadClip('master', masterClip.id, nextMasterBase.url, masterClip.startTime, 0, masterDuration);
        }
      }
      set({ takes: project.takes, commits: project.commits, selectedTrackId: 'master', isPlaying: false });
      dawEngine.stopAuditionTake();
      if (get().tracks.some(track => track.id === target.id && track.activeTakeId === target.id)) get().removeTrack(target.id);
      get().syncStems(project.stems);
      toast.success(action === 'merge' ? 'Merged into track' : 'Base selected');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to select version');
    } finally { if (get().songId === songId) set({ pendingTake: null }); }
  },

  deleteTake: async (takeId) => {
    const target = get().takes.find(take => take.id === takeId);
    if (!target || get().pendingTake) return;
    if (target.is_active) { toast.error('Select another base before deleting this version'); return; }
    const songId = get().songId;
    set({ pendingTake: takeId });
    try {
      const response = await sdk.fetch(`/api/editing/takes/${encodeURIComponent(takeId)}`, { method: 'DELETE' });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'Failed to discard segment');
      if (get().songId !== songId) return;
      if (get().selectedTrackId === takeId) dawEngine.stopAuditionTake();
      if (get().tracks.some(track => track.id === takeId && track.activeTakeId === takeId)) get().removeTrack(takeId);
      set(state => ({ takes: state.takes.filter(take => take.id !== takeId), selectedTrackId: state.selectedTrackId === takeId ? 'master' : state.selectedTrackId }));
      get().syncLayerTracks();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to discard segment');
    } finally { if (get().songId === songId) set({ pendingTake: null }); }
  },

  setCommits: (commits) => set({ commits }),
  restoreSession: (commits) => {
    const snapshot = commits.find(commit => Array.isArray(commit.timeline_snapshot?.tracks))?.timeline_snapshot;
    if (!snapshot) return;
    const saved = retained(snapshot.tracks as DAWTrack[], get().takes);
    const current = get().tracks;
    const tracks = current.map(track => {
      const restored = saved.find(item => item.id === track.id);
      return restored ? { ...restored, clips: track.clips } : track;
    });
    tracks.push(...saved.filter(track => !current.some(item => item.id === track.id)));
    set({ tracks, originals: Array.isArray(snapshot.originals) ? snapshot.originals as { start:number; end:number }[] : [], ...(typeof snapshot.bpm === 'number' && snapshot.bpm > 0 ? { bpm: snapshot.bpm } : {}) });
    for (const track of tracks) {
      if (track.id === 'master') continue;
      const shouldLoadEagerly =
        Boolean(track.activeTakeId) ||
        track.type === 'sample' ||
        Boolean(track.activeVersionTakeId && track.activeVersionTakeId !== 'ORG') ||
        Boolean(track.mixer?.solo ?? track.solo);
      if (!shouldLoadEagerly) continue;
      for (const clip of track.clips) if (clip.url) void dawEngine.loadClip(track.id, clip.id, clip.url, clip.startTime, clip.offset, clip.duration);
    }
  },
}));
