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

async function readJson<T>(res: Response, fallback: string): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof data?.error === 'string' && data.error ? data.error : fallback);
  }
  return data as T;
}

async function readNdjson(
  res: Response,
  onEvent: (ev: Event) => void,
  signal?: AbortSignal
): Promise<void> {
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(typeof data?.error === 'string' && data.error ? data.error : 'Request failed');
  }
  if (!res.body) throw new Error('Stream unavailable');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  const onAbort = () => {
    void reader.cancel().catch(() => {});
  };
  if (signal) {
    if (signal.aborted) {
      onAbort();
      reader.releaseLock();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    while (true) {
      if (signal?.aborted) break;
      const { value, done } = await reader.read();
      if (done || signal?.aborted) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (signal?.aborted) break;
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as Event;
          if (parsed.type === 'ping') continue;
          onEvent(parsed);
        } catch {
          // Skip malformed chunk
        }
      }
    }
    const tail = buf.trim();
    if (tail && !signal?.aborted) {
      try {
        const parsed = JSON.parse(tail) as Event;
        if (parsed.type !== 'ping') onEvent(parsed);
      } catch {
        // ignore
      }
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
}

const VIDEO_BUNDLE_CACHE_PREFIX = 'video-bundle:';
const inMemoryBundles = new Map<string, { score: Score; wip: Wip }>();
const inFlightStemIsolation = new Map<string, Promise<any>>();

export function createClientIdleWip(songId: string, quality: Quality = '720p'): Wip {
  return {
    songId,
    rev: 0,
    stage: 'idle',
    quality,
    updatedAt: 0,
    plan: null,
    messages: [],
    previewUrl: null,
    previewKey: null,
    previewRev: 0,
    masterResolution: null,
    edl: null,
    assemblyStale: false,
    jobs: [],
    error: null,
  };
}

export function buildClientFallbackScore(song: Song): Score {
  const durationSec = Math.max(5, Number(song.duration) > 0 ? Number(song.duration) : 120);
  const bpm = 120;
  const meter = 4;
  const beatPeriod = 60 / bpm;
  const barPeriod = beatPeriod * meter;
  const beats: Beat[] = [];
  const bars: Bar[] = [];
  let beatIdx = 0;
  for (let t = 0; t < durationSec; t += beatPeriod) {
    const bar = Math.floor(beatIdx / meter);
    const beatInBar = beatIdx % meter;
    beats.push({
      index: beatIdx,
      bar,
      beatInBar,
      t: Math.round(t * 1000) / 1000,
      strength: beatInBar === 0 ? 0.9 : 0.6,
    });
    beatIdx++;
  }
  const barCount = Math.max(1, Math.ceil(durationSec / barPeriod));
  for (let b = 0; b < barCount; b++) {
    const startSec = Math.round(b * barPeriod * 1000) / 1000;
    const endSec = Math.round(Math.min(durationSec, (b + 1) * barPeriod) * 1000) / 1000;
    bars.push({
      index: b,
      startSec,
      endSec,
      energy: 0.65,
      centroidHz: 1500,
      bandwidthHz: 1500,
      flatness: 0.05,
      chroma: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    });
  }
  const sectionCount = durationSec < 45 ? 2 : 4;
  const sections: Structure[] = [];
  for (let i = 0; i < sectionCount; i++) {
    const startSec = Math.round(((durationSec * i) / sectionCount) * 1000) / 1000;
    const endSec = Math.round(((durationSec * (i + 1)) / sectionCount) * 1000) / 1000;
    const startBar = Math.floor(startSec / barPeriod);
    const endBar = Math.max(startBar, Math.ceil(endSec / barPeriod) - 1);
    const label = `Section ${i + 1}`;
    sections.push({
      id: `sec-${String(i + 1).padStart(2, '0')}`,
      label,
      tags: [],
      cues: [],
      startSec,
      endSec,
      startBar,
      endBar,
      energy: 0.65,
      lyrics: [],
    });
  }
  return {
    songId: song.id,
    title: song.title || 'Untitled',
    prompt: '',
    genres: Array.isArray(song.genres) ? song.genres : [],
    mood: Array.isArray(song.mood) ? song.mood : [],
    production: Array.isArray(song.production) ? song.production : [],
    vocal: Array.isArray(song.vocal) ? song.vocal : [],
    bpm,
    pulseBpm: bpm,
    meter,
    keyScale: '',
    vocalLanguage: '',
    durationSec,
    beats,
    bars,
    hits: [],
    segments: [0],
    sections,
    tags: [],
    vocalStemUrl: null,
  };
}

export function readCachedVideoBundle(songId: string): { score: Score; wip: Wip } | null {
  if (!songId) return null;
  const mem = inMemoryBundles.get(songId);
  if (mem) return mem;
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`${VIDEO_BUNDLE_CACHE_PREFIX}${songId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { score?: Score; wip?: Wip };
    const firstBar = parsed?.score?.bars?.[0];
    const hasLibrosaSchema =
      Array.isArray(parsed?.score?.segments) &&
      typeof firstBar?.centroidHz === 'number' &&
      Array.isArray(firstBar?.chroma);
    if (parsed?.score?.songId === songId && parsed?.wip?.songId === songId && hasLibrosaSchema) {
      const entry = { score: parsed.score, wip: parsed.wip };
      inMemoryBundles.set(songId, entry);
      return entry;
    }
  } catch {
    // ignore storage errors
  }
  return null;
}

export function writeCachedVideoBundle(songId: string, score: Score | null, wip: Wip | null): void {
  if (!songId || !score || !wip) return;
  const entry = { score, wip };
  inMemoryBundles.set(songId, entry);
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`${VIDEO_BUNDLE_CACHE_PREFIX}${songId}`, JSON.stringify(entry));
  } catch {
    // ignore quota errors
  }
}

export function ensureSongStemsInBackground(
  song: Song,
  userAddress?: string,
  onStemsReady?: (stems: any[]) => void,
  signal?: AbortSignal
): Promise<any> {
  const addr = userAddress || song.creator || '';
  const storageAddr = addr || 'public';
  if (!song.id || !song.url || !addr) return Promise.resolve(null);

  const cachedProject = readProject(song.id, storageAddr) ?? (song.creator ? readProject(song.id, song.creator) : null);
  const alreadyHasCachedStems =
    Array.isArray(cachedProject?.stems) &&
    cachedProject.stems.some((s: any) => String(s?.name || '').toLowerCase() !== 'master' && Boolean(s?.url));
  if (alreadyHasCachedStems && cachedProject?.stems) {
    onStemsReady?.(cachedProject.stems);
    return Promise.resolve({ status: 'ready', stems: cachedProject.stems });
  }

  const existing = inFlightStemIsolation.get(song.id);
  if (existing) return existing;

  const syncToDawAndCache = async (stems: any[]) => {
    try {
      if (useDawStore.getState().songId === song.id && Array.isArray(stems) && stems.length > 0) {
        useDawStore.getState().syncStems(stems);
      }
      const histRes = await api.fetch(`/api/editing/history/${encodeURIComponent(song.id)}`, addr ? { userAddress: addr } : {});
      if (histRes.ok) {
        const history = await histRes.json();
        const prev = readProject(song.id, storageAddr);
        writeProject(
          {
            song: prev?.song ?? song,
            stems: Array.isArray(history.stems) && history.stems.length > 0 ? history.stems : stems,
            takes: Array.isArray(history.takes) ? history.takes : prev?.takes ?? [],
            commits: Array.isArray(history.commits) ? history.commits : prev?.commits ?? [],
            ...(prev?.session ? { session: prev.session } : {}),
          },
          storageAddr
        );
      }
    } catch {
      // non-fatal cache sync
    }
    onStemsReady?.(stems);
  };

  const task = (async () => {
    try {
      const res = await api.fetch('/api/editing/isolate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          songId: song.id,
          userAddress: addr,
          stemType: 'all',
        }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (data.status === 'ready') {
        if (Array.isArray(data.stems) && data.stems.length > 0) {
          await syncToDawAndCache(data.stems);
        }
        return data;
      }
      if (data.taskId) {
        const query = new URLSearchParams({
          songId: song.id,
          task: data.task || 'extract',
          userAddress: addr,
        });
        const ctrl = new AbortController();
        if (signal) {
          signal.addEventListener('abort', () => ctrl.abort(), { once: true });
        }
        await watch(
          `/api/editing/events/${encodeURIComponent(data.taskId)}?${query}`,
          ctrl.signal,
          async (ev) => {
            if (!ev || !ev.status) return false;
            if (ev.status === 'error') return true;
            if (ev.status === 'ready') {
              if (Array.isArray(ev.stems) && ev.stems.length > 0) {
                await syncToDawAndCache(ev.stems);
              }
              return true;
            }
            return false;
          },
          { userAddress: addr }
        );
      }
      return data;
    } catch {
      return null;
    } finally {
      inFlightStemIsolation.delete(song.id);
    }
  })();

  inFlightStemIsolation.set(song.id, task);
  return task;
}

export async function loadProject(songId: string): Promise<Bundle> {
  const res = await api.fetch(`/api/video/wip/${encodeURIComponent(songId)}`, { method: 'GET' });
  const bundle = await readJson<Bundle>(res, 'Could not load video project');
  writeCachedVideoBundle(songId, bundle.score, bundle.wip);
  return bundle;
}

export async function runPlan(
  params: { songId: string; instruction?: string; sectionId?: string; shotId?: string; quality?: Quality },
  onEvent: (ev: Event) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await api.fetch('/api/video/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal,
  });
  await readNdjson(res, onEvent, signal);
}

export async function updateBible(songId: string, patch: Partial<Omit<Bible, 'assets'>> & { quality?: Quality }): Promise<Wip> {
  const res = await api.fetch('/api/video/bible', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ songId, ...patch }),
  });
  const data = await readJson<{ wip: Wip }>(res, 'Could not update visual style');
  return data.wip;
}

export async function updateShot(
  songId: string,
  shotId: string,
  patch: Partial<
    Pick<
      Shot,
      | 'prompt'
      | 'camera'
      | 'motion'
      | 'lipSync'
      | 'vocalCue'
      | 'continuity'
      | 'audioTrack'
      | 'mode'
      | 'transition'
      | 'accent'
      | 'startFramePrompt'
      | 'endFramePrompt'
      | 'assetIds'
      | 'approved'
      | 'activeTakeId'
      | 'trimInSec'
      | 'syncNudgeMs'
    >
  > & {
    splitAtSec?: number;
    mergeWithNext?: boolean;
    delete?: boolean;
  }
): Promise<Wip> {
  const res = await api.fetch('/api/video/shot', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ songId, shotId, ...patch }),
  });
  const data = await readJson<{ wip: Wip }>(res, 'Could not update shot');
  return data.wip;
}

export async function requestFrame(
  songId: string,
  body: {
    target: 'start' | 'end' | 'asset';
    shotId?: string;
    assetId?: string;
    label?: string;
    role?: Asset['role'];
    prompt: string;
    edit?: boolean;
    imageSize?: '1K' | '2K';
  }
): Promise<Wip> {
  const res = await api.fetch('/api/video/frame', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ songId, ...body }),
  });
  const data = await readJson<{ wip: Wip }>(res, 'Could not generate frame');
  return data.wip;
}

export async function uploadImage(
  songId: string,
  file: File,
  opts: { target: 'asset' | 'start' | 'end'; shotId?: string; label?: string; role?: Asset['role'] }
): Promise<Wip> {
  const qs = new URLSearchParams({ songId, target: opts.target });
  if (opts.shotId) qs.set('shotId', opts.shotId);
  if (opts.label) qs.set('label', opts.label);
  if (opts.role) qs.set('role', opts.role);

  const form = new FormData();
  form.append('file', file);

  const res = await api.fetch(`/api/video/upload?${qs.toString()}`, {
    method: 'POST',
    body: form,
  });
  const data = await readJson<{ wip: Wip }>(res, 'Could not upload image');
  return data.wip;
}

export async function removeAsset(songId: string, assetId: string): Promise<Wip> {
  const res = await api.fetch(
    `/api/video/asset/${encodeURIComponent(songId)}/${encodeURIComponent(assetId)}`,
    { method: 'DELETE' }
  );
  const data = await readJson<{ wip: Wip }>(res, 'Could not remove reference');
  return data.wip;
}

export async function runSketch(
  songId: string,
  params: { sectionId?: string; onlyUnsketched?: boolean },
  onEvent: (ev: Event) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await api.fetch('/api/video/sketch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ songId, ...params }),
    signal,
  });
  await readNdjson(res, onEvent, signal);
}

export async function runRender(
  songId: string,
  params: { quality?: Quality; sectionId?: string; shotId?: string; onlyUnrendered?: boolean },
  onEvent: (ev: Event) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await api.fetch('/api/video/render', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ songId, ...params }),
    signal,
  });
  await readNdjson(res, onEvent, signal);
}

export async function editClip(
  songId: string,
  shotId: string,
  instruction: string,
  opts?: { quality?: Quality; editKind?: EditKind; startTime?: number; endTime?: number }
): Promise<Wip> {
  const res = await api.fetch('/api/video/edit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      songId,
      shotId,
      instruction,
      quality: opts?.quality,
      editKind: opts?.editKind,
      startTime: opts?.startTime,
      endTime: opts?.endTime,
    }),
  });
  const data = await readJson<{ wip: Wip }>(res, 'Could not edit clip');
  return data.wip;
}

export async function runAssemble(
  songId: string,
  params: { useProducer?: boolean; instruction?: string; upscale?: Master; saveAfter?: boolean },
  onEvent: (ev: Event) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await api.fetch('/api/video/assemble', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ songId, ...params }),
    signal,
  });
  await readNdjson(res, onEvent, signal);
}

export async function attachJobStream(
  songId: string,
  onEvent: (ev: Event) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await api.fetch(`/api/video/stream/${encodeURIComponent(songId)}`, {
    method: 'GET',
    signal,
  });
  await readNdjson(res, onEvent, signal);
}

export async function cancelRender(songId: string, jobId?: string): Promise<Wip | null> {
  const res = await api.fetch('/api/video/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(jobId ? { songId, jobId } : { songId }),
  });
  const data = await readJson<{ wip: Wip | null }>(res, 'Could not cancel operation');
  return data.wip;
}

export async function saveVideo(songId: string): Promise<{ video: string; wip: Wip }> {
  const res = await api.fetch('/api/video/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ songId }),
  });
  return readJson<{ video: string; wip: Wip }>(res, 'Could not save video');
}

export async function discardProject(songId: string): Promise<Wip> {
  const res = await api.fetch(`/api/video/wip/${encodeURIComponent(songId)}`, { method: 'DELETE' });
  const data = await readJson<{ wip: Wip }>(res, 'Could not discard project');
  return data.wip;
}

export async function removeVideo(songId: string): Promise<void> {
  const res = await api.fetch(`/api/video/${encodeURIComponent(songId)}`, { method: 'DELETE' });
  await readJson<{ ok: boolean }>(res, 'Could not remove saved video');
}

export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00.0';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ds = Math.floor((sec % 1) * 10);
  return `${m}:${String(s).padStart(2, '0')}.${ds}`;
}