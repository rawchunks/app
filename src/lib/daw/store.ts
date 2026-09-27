import { sdk } from '@/lib/sdk';
import { toast } from 'sonner';
import { create } from 'zustand';
import { dawEngine } from './engine';
import { isBase, preview, interval, source, clips, sourceInterval, retained } from './takes';
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
  provenance?: { taskId?: string; target?: string; region?: { start: number; end: number } | null; regions?: {start:number; end:number}[]; audioOffset?: number; outputDuration?: number | null; sourceTakeId?: string | null; targetStemId?: string | null; mergedInto?: string; parameters?: Record<string, any> };
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
      sectionGain: 1.0,
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
      set({ ...project.session, tracks: saved, operations: project.session.operations.filter(operation => operation.status !== 'submitting') });
      for (const track of saved) for (const clip of track.clips) if (clip.url) void dawEngine.loadClip(track.id, clip.id, clip.url, clip.startTime, clip.offset, clip.duration);
    }
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
    const operation = crypto.randomUUID();
    set(state => ({ operations: [...state.operations, { id: operation, task: 'extract', status: 'submitting' }] }));
    try {
      const response = await sdk.fetch('/api/editing/extract', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ songId, stemId: trackId === 'master' ? undefined : trackId, ...(candidate ? sourceInterval(candidate,tracks,selection) : selection) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to extract section');
      if (get().songId !== songId) return null;
      get().upsertTake(result.take);
      set(state => ({ operations: state.operations.filter(item => item.id !== operation), selectedTrackId: result.take.id }));
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
    if (masterStem && masterTrack) masterTrack = { ...masterTrack, stemId: masterStem.id };
    if (masterStem && masterTrack && masterStem.url && masterTrack.clips[0]?.url !== masterStem.url) {
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

    const stemColors: Record<string, string> = {
      vocals: '#00ffff',
      vocal: '#00ffff',
      drums: '#ff0055',
      drum: '#ff0055',
      bass: '#ffaa00',
      instrumental: '#00ff66',
      synth: '#9933ff',
      lead: '#ec4899',
      guitar: '#f59e0b',
      other: '#38bdf8',
    };

    const newStemTracks: DAWTrack[] = nonMasterStems.map((stem) => {
      const existing = currentTracks.find((t) => t.id === stem.id);
      if (existing) {
        if (existing.clips[0]?.url === stem.url) return existing;
        const clips = existing.clips.map(clip => ({ ...clip, url: stem.url, peaks: undefined }));
        for (const clip of clips) void dawEngine.loadClip(stem.id, clip.id, clip.url, clip.startTime, clip.offset, clip.duration);
        return { ...existing, clips };
      }
      const lowerName = (stem.name || 'stem').toLowerCase();
      const color = stemColors[lowerName] || '#00ffff';
      const stemTrack: DAWTrack = {
        id: stem.id,
        name: stem.name.charAt(0).toUpperCase() + stem.name.slice(1),
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
        clips: [
          {
            id: `clip-${stem.id}`,
            name: stem.name,
            url: stem.url,
            startTime: 0,
            duration: dur,
            offset: 0,
          },
        ],
      };

      if (stem.url) {
        dawEngine.loadClip(stem.id, `clip-${stem.id}`, stem.url, 0, 0, dur);
      }

      return stemTrack;
    });

    const nonStemCustomTracks = currentTracks.filter(
      (t) => t.id !== 'master' && !stems.some((s) => s.id === t.id)
    );

    const mergedTracks = masterTrack ? [masterTrack, ...newStemTracks, ...nonStemCustomTracks] : [...newStemTracks, ...nonStemCustomTracks];
    set({ tracks: mergedTracks });
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
    dawEngine.disposeTrack(trackId);
    set((state) => ({
      tracks: state.tracks.filter((t) => t.id !== trackId),
      selectedTrackId: state.selectedTrackId === trackId ? 'master' : state.selectedTrackId,
      legoContextTrackIds: state.legoContextTrackIds.filter((id) => id !== trackId),
    }));
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
          const currentFxObj = (t.fx as any)[fxKey] || {};
          return {
            ...t,
            fx: {
              ...t.fx,
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
  },
  upsertTake: (take) => set(state => ({ takes: [...state.takes.filter(item => item.id !== take.id), take] })),
  moveTake: async (takeId, shift) => {
    if (!Number.isFinite(shift) || get().pendingTake) return;
    const track = get().tracks.find(track => track.id === takeId && track.activeTakeId === takeId);
    const take = get().takes.find(take => take.id === takeId);
    if (!track || !take || !track.clips.length) return;
    const original = clips(take, get().duration);
    const starts = track.clips.map((clip, index) => clip.origin ?? original[index]?.startTime ?? clip.startTime);
    const moved = Math.max(shift, -Math.min(...starts));
    const next = track.clips.map((clip, index) => ({ ...clip, origin: starts[index], startTime: starts[index] + moved }));
    dawEngine.pauseTransport();
    dawEngine.disposeTrack(takeId);
    set(state => ({ tracks: state.tracks.map(item => item.id === takeId ? { ...item, clips: next } : item),
      selection: {start:Math.min(...next.map(clip => clip.startTime)),end:Math.max(...next.map(clip => clip.startTime + clip.duration))} }));
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
      const rendered = await dawEngine.render(ids, Math.max(state.duration, region.end), true);
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
      set(current => ({ takes: project.takes, commits: project.commits, duration: result.take.provenance.outputDuration, originals: current.originals.flatMap(item => item.end <= region.start || item.start >= region.end ? [item] : [...(item.start < region.start ? [{start:item.start,end:region.start}] : []), ...(item.end > region.end ? [{start:region.end,end:item.end}] : [])]), selectedTrackId: 'master', isPlaying: false }));
      get().syncStems(project.stems);
      toast.success('Section merged');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not merge the section'); }
    finally { if (get().songId === songId) set({ pendingTake: null }); }
  },

  toggleTake: async (takeId) => {
    const { takes, tracks, duration, selectedTrackId } = get();
    const take = takes.find(take => take.id === takeId);
    if (!take) return;
    const mounted = tracks.find(track => track.id === takeId && track.activeTakeId === takeId);
    if (selectedTrackId === takeId) dawEngine.stopAuditionTake();
    if (mounted) {
      get().removeTrack(mounted.id);
      return;
    }
    const lane = take.stem_id
      ? tracks.find(track => track.id === take.stem_id || track.stemId === take.stem_id)
      : tracks.find(track => track.id === 'master');
    if (lane && isBase(take, tracks, takes)) {
      get().updateTrackMixer(lane.id, { muted: !lane.muted, solo: false });
      return;
    }
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
    set({ tracks: [...tracks, track] });
    try {
      for (const part of track.clips) await dawEngine.loadClip(track.id, part.id, part.url, part.startTime, part.offset, part.duration);
    } catch (error) {
      if (get().tracks.includes(track)) get().removeTrack(track.id);
      toast.error(error instanceof Error ? error.message : 'Could not load take');
    }
  },

  activateTake: async (takeId, action = 'base') => {
    if (action === 'merge') return get().mergeTakes([takeId]);
    const target = get().takes.find(take => take.id === takeId);
    if (!target || (action === 'base' && isBase(target, get().tracks, get().takes)) || get().pendingTake) return;
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
      if (result.take?.provenance?.outputDuration && result.take.provenance.target === 'master') set({ duration: result.take.provenance.outputDuration });
      set({ takes: project.takes, commits: project.commits, selectedTrackId: 'master', isPlaying: false });
      dawEngine.stopAuditionTake();
      if (get().tracks.some(track => track.id === target.id && track.activeTakeId === target.id)) get().removeTrack(target.id);
      get().syncStems(project.stems);
      toast.success('Base selected');
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
      for (const clip of track.clips) if (clip.url) void dawEngine.loadClip(track.id, clip.id, clip.url, clip.startTime, clip.offset, clip.duration);
    }
  },
}));
