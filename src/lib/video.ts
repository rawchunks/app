import { api, watch } from './api';
import { bus } from './bus';
import { readProject, writeProject } from './cache';
import { useDawStore } from './daw/store';
import type { Song } from './schema';

export type Stage =
  | 'idle'
  | 'planning'
  | 'review'
  | 'rendering'
  | 'assembling'
  | 'ready'
  | 'saved'
  | 'error';

export type Quality = '544p' | '720p' | '1080p';
export type Resolution = Quality | '4k';
export type Master = 'none' | '1080p' | '4k';
export type EditKind = 'restyle' | 'retake' | 'day_to_night' | 'clean_plate' | 'refine' | 'inpaint';
export type Continuity = 'continue' | 'cut';
export type Track = 'vocals' | 'drums' | 'bass' | 'other' | 'guitar' | 'piano' | 'instrumental' | 'mix' | 'none';
export type Mode = 'image' | 'refs' | 'text';
export type Transition = 'cut' | 'flash' | 'whip' | 'punch' | 'dissolve' | 'fade';
export type Accent = 'none' | 'pulse' | 'ramp' | 'strobe';
export type Status = 'draft' | 'queued' | 'rendering' | 'checking' | 'ready' | 'failed';

export interface Beat {
  index: number;
  bar: number;
  beatInBar: number;
  t: number;
  strength: number;
}

export interface Bar {
  index: number;
  startSec: number;
  endSec: number;
  energy: number;
  centroidHz: number;
  bandwidthHz: number;
  flatness: number;
  chroma: number[];
}

export interface Hit {
  t: number;
  strength: number;
}

export interface Lyric {
  text: string;
  startSec: number;
  endSec: number;
  words?: Array<{ text: string; start: number; end: number }>;
}

export interface Vocal {
  text: string;
  songStartMs: number;
  songEndMs: number;
  localStartMs: number;
  localEndMs: number;
  startFrame: number;
  endFrame: number;
}

export interface Cue {
  tag: string;
  t: number;
  bar: number;
}

export interface Structure {
  id: string;
  label: string;
  tags: string[];
  cues: Cue[];
  startSec: number;
  endSec: number;
  startBar: number;
  endBar: number;
  energy: number;
  lyrics: Lyric[];
}

export interface Score {
  songId: string;
  title: string;
  prompt: string;
  genres: string[];
  mood: string[];
  production: string[];
  vocal: string[];
  bpm: number;
  pulseBpm: number;
  meter: number;
  keyScale: string;
  vocalLanguage: string;
  durationSec: number;
  beats: Beat[];
  bars: Bar[];
  hits: Hit[];
  segments: number[];
  sections: Structure[];
  tags: string[];
  vocalStemUrl?: string | null;
  stems?: Record<string, string>;
}

export interface Asset {
  id: string;
  label: string;
  role: 'character' | 'world' | 'style' | 'prop';
  url: string;
  key: string;
  prompt?: string;
  interactionId?: string;
  source: 'generated' | 'uploaded';
}

export interface Frame {
  url: string;
  key: string;
  prompt: string;
  interactionId?: string;
  source: 'generated' | 'uploaded';
}

export interface Review {
  passed: boolean;
  frozen: boolean;
  motionMean: number;
  motionPeakSec: number;
  durationSec: number;
  hasMotion?: number;
  followsDirection?: number;
  matchesReferences?: number;
  artifactFree?: number;
  energyFit?: number;
  lipSyncScore?: number;
  alignedTrimSec?: number;
  syncOffsetMs?: number;
  score?: number;
  notes?: string;
}

export interface Take {
  id: string;
  url: string;
  key: string;
  resolution: Resolution;
  seed?: number;
  trimInSec?: number;
  syncOffsetMs?: number;
  motionPeakSec?: number;
  durationSec?: number;
  qa?: Review | null;
  createdAt: number;
}

export interface Grade {
  brightness: number;
  contrast: number;
  saturation: number;
}

export interface Cut {
  shotId: string;
  trimInSec: number;
  speedFactor: number;
  transition: Transition;
  transitionFrames: number;
  accent: Accent;
  grade?: Grade;
  note?: string;
}

export interface Edl {
  rev: number;
  createdAt: number;
  summary: string;
  cuts: Cut[];
}

export type JobType = 'plan' | 'sketch' | 'frame' | 'render' | 'edit' | 'assemble';

export interface Job {
  id: string;
  type: JobType;
  status: 'running' | 'done' | 'cancelled' | 'error';
  label: string;
  detail?: string;
  targetIds?: string[];
  startedAt: number;
  updatedAt: number;
}

export interface Shot {
  id: string;
  sectionId: string;
  index: number;
  startSec: number;
  endSec: number;
  startFrameIdx: number;
  endFrameIdx: number;
  renderSec: number;
  primaryHitSec: number | null;
  prompt: string;
  camera: string;
  motion: string;
  vocals?: Vocal[];
  lipSync?: boolean;
  vocalCue?: string;
  continuity?: Continuity;
  chainedFromPrev?: boolean;
  audioTrack?: Track;
  mode: Mode;
  transition: Transition;
  accent: Accent;
  startFramePrompt?: string;
  endFramePrompt?: string;
  startFrame?: Frame | null;
  endFrame?: Frame | null;
  assetIds: string[];
  status: Status;
  resolution: Resolution;
  clipUrl?: string | null;
  clipKey?: string | null;
  seed?: number;
  editTurns: number;
  trimInSec?: number;
  syncOffsetMs?: number;
  syncNudgeMs?: number;
  motionPeakSec?: number;
  qa?: Review | null;
  error?: string | null;
  approved?: boolean;
  takes?: Take[];
  activeTakeId?: string;
}

export interface Section {
  id: string;
  label: string;
  tags: string[];
  startSec: number;
  endSec: number;
  energy: number;
  location?: string;
  notes: string;
  shots: Shot[];
}

export interface Bible {
  concept: string;
  look: string;
  palette: string;
  lens: string;
  lighting: string;
  motif: string;
  assets: Asset[];
}

export interface Message {
  id: string;
  role: 'user' | 'director';
  text: string;
  createdAt: number;
}

export interface Plan {
  bible: Bible;
  sections: Section[];
}

export interface Wip {
  songId: string;
  rev: number;
  stage: Stage;
  quality: Quality;
  updatedAt: number;
  directorInteractionId?: string;
  plan: Plan | null;
  messages: Message[];
  previewUrl?: string | null;
  previewKey?: string | null;
  previewRev: number;
  masterResolution?: Resolution | null;
  durationSec?: number;
  edl?: Edl | null;
  assemblyStale?: boolean;
  jobs: Job[];
  error?: string | null;
}

export interface Bundle {
  song: Song;
  score: Score;
  wip: Wip;
}

export interface Event {
  type: 'step' | 'thought' | 'section' | 'sketch' | 'status' | 'shot' | 'edl' | 'wip' | 'done' | 'cancelled' | 'error' | 'ping';
  jobId?: string;
  stepId?: string;
  label?: string;
  detail?: string;
  text?: string;
  sectionId?: string;
  shotId?: string;
  url?: string;
  video?: string;
  doneCount?: number;
  totalCount?: number;
  completed?: number;
  failed?: number;
  message?: string;
  status?: Status | 'running' | 'done' | 'error';
  summary?: string;
  edl?: Edl;
  wip?: Wip;
}