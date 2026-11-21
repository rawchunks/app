import { GoogleGenAI, InteractionWebRTCTransport, type InteractionWebRTCConnection } from '@google/genai';
import { api, RAWCHUNKS_API_URL } from './api';
import { audio } from './audio';
import type { LyricsAlignment } from './lyrics';
import type { Song } from './schema';

export type Key =
  | 'key_w'
  | 'key_a'
  | 'key_s'
  | 'key_d'
  | 'arrow_up'
  | 'arrow_down'
  | 'arrow_left'
  | 'arrow_right';

export interface Timing {
  fps: number;
  stepFrames: number;
  stepMs: number;
  setupLeadSec: number;
  steerLeadSec: number;
  impulseRepeats: number;
  impulseIntervalMs: number;
  steerCooldownSec: number;
  actionLeadSec: number;
  maxActionHoldSec?: number;
  hardCapSec: number;
  actMinSec: number;
  actTargetSec: number;
  actMaxSec: number;
  prewarmLeadSec: number;
  stabilizeLeadSec: number;
  crossfadeMs: number;
  finalActCutoffSec?: number;
  maxSeedBytes: number;
}

export interface Act {
  index: number;
  startSec: number;
  endSec: number;
  durationSec: number;
  captureSec: number | null;
  stabilizeSec: number | null;
  cutSec: number | null;
  usesReferenceFrame: boolean;
  transition?: 'open' | 'cut' | 'continue';
  worldPrompt: string;
  continuityNote?: string;
}

export interface Cue {
  id: string;
  actIndex: number;
  kind: 'input' | 'action';
  targetSec: number;
  fireSec: number;
  prompt?: string;
  key?: Key;
  durationSec?: number;
  reason: string;
}

export interface Plan {
  songId: string;
  title: string;
  durationSec: number;
  bpm: number;
  acts: Act[];
  cues: Cue[];
  timing: Timing;
}

export interface Beat {
  section: string;
  startSec: number;
  endSec: number;
  energy: string;
  controlTags: string[];
  lyricAnchor: string;
  visualShift: string;
}

export interface Seam {
  fromAct: number;
  toAct: number;
  cutSec: number;
  preservedElements: string;
  evolution: string;
}

export interface Board {
  medium?: string;
  subjects?: string[];
  lighting?: string[];
  camera?: string;
  pacing?: string[];
  concept: string;
  vibe: string;
  sonicVisualMap: string;
  artMedium: string;
  palette: string;
  propulsion: string;
  motifs: string[];
  beats: Beat[];
  seams: Seam[];
}

export interface Section {
  label: string;
  startSec: number;
  endSec: number;
  energy: number;
  energyDelta: number;
  controlTags: string[];
  lines: Array<{ text: string; startSec: number | null; endSec: number | null }>;
}

export interface Slot {
  index: number;
  startSec: number;
  endSec: number;
  durationSec: number;
  captureSec: number | null;
  stabilizeSec: number | null;
  cutSec: number | null;
  usesReferenceFrame: boolean;
}

export interface VideoWip {
  songId: string;
  runId: string;
  updatedAt: number;
  guidance?: string;
  board?: Board | null;
  plan?: Plan | null;
  previewUrl?: string | null;
  previewKey?: string | null;
  durationSec?: number;
  actsCount?: number;
}

export interface StudioAnalysis {
  songId: string;
  title: string;
  durationSec: number;
  bpm: number;
  timeSignature: string;
  beatsPerBar: number;
  barSec: number;
  keyScale: string;
  stylePrompt: string;
  genres: string[];
  production: string[];
  mood: string[];
  vocal: string[];
  stems: string[];
  lyrics: string;
  alignment: LyricsAlignment | null;
  lyricsStatus: 'cached' | 'transcribing' | 'none';
  sections: Section[];
  slots: Slot[];
}

export interface StudioBundle {
  song: Song;
  wip: VideoWip | null;
  analysis: StudioAnalysis;
}

export interface Steer {
  prompt: string;
  key?: Key;
  durationSec?: number;
}

export type DirectorEvent =
  | { type: 'status'; step: string }
  | { type: 'analysis'; analysis: StudioAnalysis }
  | { type: 'sketchboard'; board: Board }
  | {
      type: 'acts';
      acts: Array<{
        index: number;
        transition?: 'open' | 'cut' | 'continue';
        worldPrompt: string;
        continuityNote?: string;
      }>;
    }
  | { type: 'plan'; plan: Plan }
  | { type: 'done'; runId: string; board: Board | null; plan: Plan }
  | { type: 'error'; message: string };

export type Phase =
  | 'idle'
  | 'planning'
  | 'warming'
  | 'live'
  | 'rolling'
  | 'stitching'
  | 'ready'
  | 'saving'
  | 'error';

export interface Telemetry {
  phase: Phase;
  status: string;
  actIndex: number;
  totalActs: number;
  rttMs: number;
  frameWidth: number;
  frameHeight: number;
  fps: number;
  activeCue: Cue | null;
  nextCue: Cue | null;
  firedCount: number;
  recordedSec: number;
  chunksBuffered: number;
}

export interface DeckVisibility {
  activeSlot: 0 | 1;
  fadingSlot: 0 | 1 | null;
}

export interface SessionToken {
  interactionId: string;
  authToken: string;
  expiresAt?: string;
  stopToken: string;
  songId: string;
}

interface Deck {
  slot: 0 | 1;
  actIndex: number;
  recordIndex: number;
  interactionId: string;
  stopToken: string;
  session: InteractionWebRTCConnection;
  transport: InteractionWebRTCTransport;
  video: HTMLVideoElement;
  peerConnection: RTCPeerConnection | null;
  remoteVideoTrack: MediaStreamTrack | null;
  recorder: MediaRecorder | null;
  capturedChunks: Blob[];
  heldKeys: Set<Key>;
  capTimer: ReturnType<typeof setTimeout> | null;
  endedEarly: boolean;
  closed: boolean;
}

const WIDTH = 1280;
const HEIGHT = 720;
const DEFAULT_MAX_SEED_BYTES = 46_000;
const RECORDER_BITRATE_BPS = 4_500_000;
const RECORDER_TIMESLICE_MS = 4_000;
const SCHEDULE_POLL_MS = 100;

export async function fetchVideoWip(songId: string, userAddress?: string | null): Promise<StudioBundle> {
  const response = await api.fetch(`/api/director/wip/${encodeURIComponent(songId)}`, {
    ...(userAddress ? { userAddress } : {}),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.song) {
    throw new Error(data?.error || 'Could not load video studio state');
  }
  return data as StudioBundle;
}

export async function streamDirectorPlan(params: {
  songId: string;
  guidance?: string;
  userAddress?: string | null;
  onEvent: (event: DirectorEvent) => void;
  signal?: AbortSignal;
}): Promise<{ runId: string; board: Board | null; plan: Plan }> {
  const response = await api.fetch('/api/director/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      songId: params.songId,
      ...(params.guidance?.trim() ? { guidance: params.guidance.trim() } : {}),
    }),
    ...(params.userAddress ? { userAddress: params.userAddress } : {}),
    signal: params.signal,
  });

  if (!response.ok || !response.body) {
    const err = await response.json().catch(() => null);
    throw new Error(err?.error || `Director planning failed (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let runId = '';
  let board: Board | null = null;
  let plan: Plan | null = null;
  let streamError: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      let event: DirectorEvent;
      try {
        event = JSON.parse(line) as DirectorEvent;
      } catch {
        continue;
      }
      if (event.type === 'sketchboard') board = event.board;
      if (event.type === 'plan') plan = event.plan;
      if (event.type === 'done') {
        if (event.runId) runId = event.runId;
        if (event.board) board = event.board;
        if (event.plan) plan = event.plan;
      }
      if (event.type === 'error') streamError = event.message;
      params.onEvent(event);
    }
  }

  if (streamError) throw new Error(streamError);
  if (!plan) throw new Error('Director finished without a Genie 4 plan');
  if (!runId) runId = crypto.randomUUID?.() ?? `run-${Date.now()}`;
  return { runId, board, plan };
}

export async function translateLiveSteer(params: {
  songId: string;
  note: string;
  currentSec?: number;
  concept?: string;
  userAddress?: string | null;
}): Promise<Steer> {
  const response = await api.fetch('/api/director/steer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      songId: params.songId,
      note: params.note,
      ...(typeof params.currentSec === 'number' ? { currentSec: params.currentSec } : {}),
      ...(params.concept ? { concept: params.concept } : {}),
    }),
    ...(params.userAddress ? { userAddress: params.userAddress } : {}),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.prompt) {
    throw new Error(data?.error || 'Could not translate live steering direction');
  }
  return data as Steer;
}

async function pushVideoChunk(params: {
  songId: string;
  runId: string;
  actIndex: number;
  chunk: Blob;
  userAddress?: string | null;
}): Promise<void> {
  const ext = params.chunk.type.includes('mp4') ? 'mp4' : 'webm';
  const form = new FormData();
  form.append('file', params.chunk, `act-${params.actIndex}.${ext}`);
  const qs = `?runId=${encodeURIComponent(params.runId)}&actIndex=${params.actIndex}`;
  const response = await api.fetch(`/api/director/wip/${encodeURIComponent(params.songId)}/chunk${qs}`, {
    method: 'POST',
    body: form,
    ...(params.userAddress ? { userAddress: params.userAddress } : {}),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => null);
    throw new Error(err?.error || `Chunk upload failed (${response.status})`);
  }
}

export interface ActSpan {
  actIndex: number;
  startSec: number;
  endSec: number;
}

export async function finalizeVideoWip(params: {
  songId: string;
  runId: string;
  actCount: number;
  actSpans?: ActSpan[];
  userAddress?: string | null;
}): Promise<{ wip: VideoWip; previewUrl: string; durationSec: number }> {
  const response = await api.fetch(`/api/director/wip/${encodeURIComponent(params.songId)}/finalize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      runId: params.runId,
      actCount: Math.max(1, params.actCount),
      ...(params.actSpans?.length ? { actSpans: params.actSpans } : {}),
    }),
    ...(params.userAddress ? { userAddress: params.userAddress } : {}),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.previewUrl) {
    throw new Error(data?.error || 'Could not stitch recorded Genie 4 video');
  }
  return data as { wip: VideoWip; previewUrl: string; durationSec: number };
}

export async function saveVideoWip(
  songId: string,
  userAddress?: string | null
): Promise<{ video: string; song: Song }> {
  const response = await api.fetch(`/api/director/wip/${encodeURIComponent(songId)}/save`, {
    method: 'POST',
    ...(userAddress ? { userAddress } : {}),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.video) {
    throw new Error(data?.error || 'Could not save video to R2');
  }
  return data as { video: string; song: Song };
}

export async function discardVideoWip(songId: string, userAddress?: string | null): Promise<void> {
  await api
    .fetch(`/api/director/wip/${encodeURIComponent(songId)}`, {
      method: 'DELETE',
      ...(userAddress ? { userAddress } : {}),
    })
    .catch(() => {});
}

export async function mintGenieSession(songId: string, userAddress?: string | null): Promise<SessionToken> {
  const response = await api.fetch('/api/director/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ songId }),
    ...(userAddress ? { userAddress } : {}),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.interactionId || !data?.authToken) {
    throw new Error(data?.error || 'Could not start Genie 4 session');
  }
  return data as SessionToken;
}

export function sendEndBeacon(interactionId: string, stopToken: string): void {
  const url = `${RAWCHUNKS_API_URL}/api/director/session/${encodeURIComponent(
    interactionId
  )}/end?token=${encodeURIComponent(stopToken)}`;
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(url, new Blob([], { type: 'text/plain' }));
      return;
    }
  } catch {
    // Fall through to keepalive fetch
  }
  void fetch(url, { method: 'POST', keepalive: true }).catch(() => {});
}

export async function uploadSongVideo(
  songId: string,
  blob: Blob,
  userAddress?: string | null
): Promise<{ video: string; song: Song }> {
  const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
  const form = new FormData();
  form.append('file', blob, `${songId}.${ext}`);
  const response = await api.fetch(`/api/director/video/${encodeURIComponent(songId)}`, {
    method: 'POST',
    body: form,
    ...(userAddress ? { userAddress } : {}),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.video) {
    throw new Error(data?.error || 'Could not save video to R2');
  }
  return data as { video: string; song: Song };
}

export async function deleteSongVideo(songId: string, userAddress?: string | null): Promise<Song> {
  const response = await api.fetch(`/api/director/video/${encodeURIComponent(songId)}`, {
    method: 'DELETE',
    ...(userAddress ? { userAddress } : {}),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.song) {
    throw new Error(data?.error || 'Could not remove saved video');
  }
  return data.song as Song;
}

/**
 * Estimates image sharpness via mean horizontal/vertical luminance gradient magnitude
 * on a 64x36 downsample so ~2-minute rollover selects the crispest recent frame.
 */
function measureSharpness(video: HTMLVideoElement, probeCanvas: HTMLCanvasElement): number {
  const ctx = probeCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return 0;
  ctx.drawImage(video, 0, 0, probeCanvas.width, probeCanvas.height);
  const data = ctx.getImageData(0, 0, probeCanvas.width, probeCanvas.height).data;
  const w = probeCanvas.width;
  const h = probeCanvas.height;
  let score = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = (y * w + x) * 4;
      const lum = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
      const lumR = data[idx + 4] * 0.299 + data[idx + 5] * 0.587 + data[idx + 6] * 0.114;
      const lumD = data[idx + w * 4] * 0.299 + data[idx + w * 4 + 1] * 0.587 + data[idx + w * 4 + 2] * 0.114;
      score += Math.abs(lum - lumR) + Math.abs(lum - lumD);
    }
  }
  return score;
}

function base64ByteLength(b64: string): number {
  return Math.floor((b64.length * 3) / 4);
}

/**
 * Captures the sharpest recent live frame from a visible Genie 4 video deck and encodes it
 * as a 16:9 JPEG strictly under `maxBytes` (< 48 KB) to respect WebRTC's 64 KB SCTP cap.
 */
async function captureSeedFrame(video: HTMLVideoElement, maxBytes = DEFAULT_MAX_SEED_BYTES): Promise<string> {
  const probe = document.createElement('canvas');
  probe.width = 64;
  probe.height = 36;

  const bestCanvas = document.createElement('canvas');
  bestCanvas.width = WIDTH;
  bestCanvas.height = HEIGHT;
  const bestCtx = bestCanvas.getContext('2d')!;

  let bestScore = -1;
  for (let sample = 0; sample < 3; sample++) {
    const score = measureSharpness(video, probe);
    if (score >= bestScore) {
      bestScore = score;
      bestCtx.drawImage(video, 0, 0, WIDTH, HEIGHT);
    }
    if (sample < 2) {
      await new Promise((r) => setTimeout(r, 45));
    }
  }

  for (const quality of [0.84, 0.74, 0.64, 0.54, 0.44]) {
    const dataUrl = bestCanvas.toDataURL('image/jpeg', quality);
    const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    if (base64ByteLength(b64) <= maxBytes) {
      return b64;
    }
  }

  const half = document.createElement('canvas');
  half.width = 640;
  half.height = 360;
  half.getContext('2d')!.drawImage(bestCanvas, 0, 0, 640, 360);
  for (const quality of [0.8, 0.68, 0.55]) {
    const dataUrl = half.toDataURL('image/jpeg', quality);
    const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    if (base64ByteLength(b64) <= maxBytes) {
      return b64;
    }
  }
  const finalUrl = half.toDataURL('image/jpeg', 0.45);
  return finalUrl.slice(finalUrl.indexOf(',') + 1);
}

function waitForFirstFrame(video: HTMLVideoElement, timeoutMs = 28_000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 2 && video.videoWidth > 0) {
      resolve();
      return;
    }
    let settled = false;
    let rafId: number | null = null;
    const cleanup = () => {
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('playing', onReady);
      clearTimeout(timer);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const onReady = () => {
      if (video.videoWidth > 0) finish();
    };
    const poll = () => {
      if (settled) return;
      if (video.videoWidth > 0 && video.readyState >= 2) {
        finish();
        return;
      }
      rafId = requestAnimationFrame(poll);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Timed out waiting for Genie 4 first frame'));
    }, timeoutMs);

    video.addEventListener('loadeddata', onReady);
    video.addEventListener('playing', onReady);
    rafId = requestAnimationFrame(poll);
  });
}

function pickHighQualityMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  // Prefer hardware-accelerated H.264 (VideoToolbox/NVENC/QuickSync) over software VP9 so recording
  // never starves the live WebRTC 1280x720 @ 24fps decode pipeline!
  const candidates = [
    'video/webm;codecs=h264',
    'video/mp4;codecs=avc1.640028',
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4;codecs=avc1',
    'video/webm;codecs=vp8',
    'video/webm;codecs=vp9',
    'video/webm',
  ];
  for (const mime of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(mime)) return mime;
    } catch {
      // ignore
    }
  }
  return '';
}

/**
 * Live Genie 4 (`models/genie-4`) Native-Quality Dual-Deck WebRTC Runtime:
 * - Binds directly to TWO visible hardware-decoded `<video autoplay playsinline muted>` DOM decks
 *   using Google's official unified-stream WebRTC path (no detached paused `<audio>` element that
 *   stalls Chromium's RtpStreamsSynchronizer A/V clock).
 * - Silences Genie 4 audio natively via `<video muted>` + video-only `MediaRecorder` track + server `ffmpeg -an`.
 * - Buffers intercepted hardware-H.264 chunks off-heap during streaming (zero uplink bufferbloat) and
 *   flushes cleanly into `valkeyWips` -> stitched R2 preview on completion.
 */
export class GenieDirector {
  private readonly deckElements: [HTMLVideoElement, HTMLVideoElement];
  private readonly plan: Plan;
  private readonly runId: string;
  private readonly userAddress: string | null;
  private readonly onTelemetry: (t: Telemetry) => void;
  private readonly onDeckVisibility: (v: DeckVisibility) => void;
  private readonly onError: (msg: string) => void;
  private prefetchedAct0Token: Promise<SessionToken> | null = null;

  private activeDeck: Deck | null = null;
  private standbyDeck: Deck | null = null;
  private prewarmingDeck: Deck | null = null;
  private slotOwner: [Deck | null, Deck | null] = [null, null];
  private capturedByAct = new Map<number, Blob[]>();
  private actSpans = new Map<number, ActSpan>();
  private nextRecordIndex = 0;
  private maxActRecorded = 0;
  private totalChunksBuffered = 0;
  private recordingStartedAt = 0;
  private rolloverGen = 0;
  private rollingInFlight = false;

  private firedCues = new Set<string>();
  private stabilizedActs = new Set<number>();
  private prewarmedActs = new Set<number>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private intervals = new Set<ReturnType<typeof setInterval>>();

  private scheduleTimer: ReturnType<typeof setInterval> | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private hiddenTimer: ReturnType<typeof setTimeout> | null = null;

  private clockAnchorSec = 0;
  private clockAnchorMs = 0;
  private clockPaused = false;

  private rttMs = 80;
  private frameWidth = 0;
  private frameHeight = 0;
  private fps = 0;
  private activeCue: Cue | null = null;
  private phase: Phase = 'idle';
  private status = '';
  private stopped = false;

  constructor(params: {
    deckElements: [HTMLVideoElement, HTMLVideoElement];
    plan: Plan;
    runId: string;
    userAddress?: string | null;
    prefetchedAct0Token?: Promise<SessionToken> | null;
    onTelemetry: (t: Telemetry) => void;
    onDeckVisibility: (v: DeckVisibility) => void;
    onError: (msg: string) => void;
  }) {
    this.deckElements = params.deckElements;
    this.plan = params.plan;
    this.runId = params.runId;
    this.userAddress = params.userAddress ?? null;
    this.prefetchedAct0Token = params.prefetchedAct0Token ?? null;
    this.onTelemetry = params.onTelemetry;
    this.onDeckVisibility = params.onDeckVisibility;
    this.onError = params.onError;
  }

  private emitTelemetry(overrides?: Partial<Telemetry>): void {
    const pos = audio.position() ?? 0;
    const nextCue =
      this.plan.cues.find((c) => !this.firedCues.has(c.id) && c.targetSec >= pos - 0.5) ?? null;
    const recordedSec =
      this.recordingStartedAt > 0 ? Math.max(0, (performance.now() - this.recordingStartedAt) / 1000) : 0;

    this.onTelemetry({
      phase: this.phase,
      status: this.status,
      actIndex: this.activeDeck?.actIndex ?? 0,
      totalActs: this.plan.acts.length,
      rttMs: Math.round(this.rttMs),
      frameWidth: this.frameWidth || this.activeDeck?.video.videoWidth || 0,
      frameHeight: this.frameHeight || this.activeDeck?.video.videoHeight || 0,
      fps: Math.round(this.fps),
      activeCue: this.activeCue,
      nextCue,
      firedCount: this.firedCues.size,
      recordedSec,
      chunksBuffered: this.totalChunksBuffered,
      ...overrides,
    });
  }

  private prepareDeckVideo(slot: 0 | 1): HTMLVideoElement {
    const video = this.deckElements[slot];
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    video.defaultMuted = true;
    video.volume = 0;
    return video;
  }

  private startDirectTrackRecorder(deck: Deck): void {
    if (typeof MediaRecorder === 'undefined') return;
    if (this.nextRecordIndex >= 24) return;
    const remoteStream = deck.transport.remoteMediaStream as MediaStream | undefined;
    const videoTrack = deck.remoteVideoTrack ?? remoteStream?.getVideoTracks?.()[0] ?? null;
    if (!videoTrack) return;

    const recordIndex = this.nextRecordIndex++;
    deck.recordIndex = recordIndex;

    // Pure video-only stream from native remote WebRTC track — ZERO audio tracks, ZERO canvas re-encode!
    const videoOnly = new MediaStream([videoTrack]);
    const mimeType = pickHighQualityMimeType();
    const recorder = new MediaRecorder(videoOnly, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: RECORDER_BITRATE_BPS,
    });

    recorder.ondataavailable = (ev) => {
      if (!ev.data || ev.data.size === 0) return;
      // Keep compressed chunks in browser Blob storage during live WebRTC so HTTP uploads
      // NEVER saturate the user's uplink or cause bufferbloat/FPS throttling during streaming.
      deck.capturedChunks.push(ev.data);
      this.totalChunksBuffered += 1;
      this.maxActRecorded = Math.max(this.maxActRecorded, recordIndex + 1);
    };

    recorder.start(RECORDER_TIMESLICE_MS);
    deck.recorder = recorder;
    const plannedAct = this.plan.acts[deck.actIndex];
    const audioPos = audio.position();
    const startSec =
      recordIndex === 0
        ? 0
        : typeof audioPos === 'number' && Number.isFinite(audioPos) && audioPos > 0
          ? Math.round(audioPos * 1000) / 1000
          : plannedAct?.startSec ?? 0;
    this.actSpans.set(recordIndex, {
      actIndex: recordIndex,
      startSec,
      endSec: plannedAct?.endSec ?? startSec,
    });
    if (this.recordingStartedAt === 0) {
      this.recordingStartedAt = performance.now();
    }
  }

  private async stopDirectTrackRecorder(deck: Deck): Promise<void> {
    const recordIndex = deck.recordIndex;
    const span = recordIndex >= 0 ? this.actSpans.get(recordIndex) : undefined;
    if (span) {
      const audioPos = audio.position();
      if (typeof audioPos === 'number' && Number.isFinite(audioPos) && audioPos > span.startSec) {
        span.endSec = Math.round(audioPos * 1000) / 1000;
      } else {
        const plannedEnd = this.plan.acts[deck.actIndex]?.endSec ?? span.startSec + 0.1;
        span.endSec = Math.max(span.startSec + 0.1, plannedEnd);
      }
    }
    const rec = deck.recorder;
    deck.recorder = null;
    if (rec && rec.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 2500);
        rec.onstop = () => {
          clearTimeout(timer);
          resolve();
        };
        try {
          rec.stop();
        } catch {
          clearTimeout(timer);
          resolve();
        }
      });
    }
    if (recordIndex >= 0 && deck.capturedChunks.length > 0) {
      const existing = this.capturedByAct.get(recordIndex) ?? [];
      existing.push(...deck.capturedChunks);
      this.capturedByAct.set(recordIndex, existing);
      deck.capturedChunks = [];
    }
  }

  private async openDeck(
    act: Act,
    slot: 0 | 1,
    referenceImageBase64?: string,
    expectedGen?: number
  ): Promise<Deck | null> {
    const isSuperseded = () => this.stopped || (expectedGen !== undefined && this.rolloverGen !== expectedGen);

    let token: SessionToken;
    if (act.index === 0 && this.prefetchedAct0Token) {
      const pending = this.prefetchedAct0Token;
      this.prefetchedAct0Token = null;
      token = await pending;
    } else {
      token = await mintGenieSession(this.plan.songId, this.userAddress);
    }
    if (isSuperseded()) {
      sendEndBeacon(token.interactionId, token.stopToken);
      return null;
    }

    const video = this.prepareDeckVideo(slot);
    let peerConnection: RTCPeerConnection | null = null;
    let remoteVideoTrack: MediaStreamTrack | null = null;

    // Pass ONLY `videoElement` (official Genie 4 unified-stream path) so Chromium's WebRTC A/V
    // synchronizer keeps both tracks clocked continuously at 24 fps while `<video muted>` silences output!
    const transport = new InteractionWebRTCTransport({
      videoElement: video as any,
      onPeerConnection: (pc: any) => {
        peerConnection = pc as RTCPeerConnection;
        pc.addEventListener('track', (ev: RTCTrackEvent) => {
          if (ev.track.kind === 'video') {
            remoteVideoTrack = ev.track;
          }
        });
      },
    });

    const clientAi = new GoogleGenAI({ apiKey: token.authToken, apiVersion: 'v1beta' });
    const session = await clientAi.interactions.connect(
      token.interactionId,
      { transport, api_version: 'v1beta' },
      { timeout_ms: 30_000 }
    );

    const deck: Deck = {
      slot,
      actIndex: act.index,
      recordIndex: -1,
      interactionId: token.interactionId,
      stopToken: token.stopToken,
      session,
      transport,
      video,
      peerConnection,
      remoteVideoTrack,
      recorder: null,
      capturedChunks: [],
      heldKeys: new Set<Key>(),
      capTimer: null,
      endedEarly: false,
      closed: false,
    };

    if (isSuperseded()) {
      await this.closeDeck(deck);
      return null;
    }
    this.slotOwner[slot] = deck;
    if (expectedGen !== undefined) {
      this.prewarmingDeck = deck;
    }

    void (async () => {
      try {
        for await (const event of session.receive()) {
          if (deck.closed) break;
          const evType = (event as any)?.event_type;
          if (evType === 'error') {
            const msg = (event as any)?.error?.message || 'Live video stream interrupted';
            console.warn('[GenieDirector] server error:', event);
            if (deck === this.activeDeck && !this.stopped) {
              this.onError(msg);
            }
          } else if (evType === 'interaction.cancelled' || evType === 'interaction.completed') {
            deck.endedEarly = true;
            console.debug('[GenieDirector] server ended interaction:', evType, { actIndex: deck.actIndex });
            if (deck === this.activeDeck && !this.stopped && !this.clockPaused) {
              this.recoverEndedActiveDeck(deck);
            }
          } else if (evType) {
            console.debug('[GenieDirector] server event:', evType, event);
          }
        }
      } catch {
        // Normal closure after complete()
      }
    })();

    // Empirical Genie 4 v1beta interaction cap (~30s / 184,320 tokens): proactively roll over at 28.5s
    // if still active so the viewer NEVER sees a frozen or black frame!
    const capMs = Math.max(18_000, Math.round(((this.plan.timing.hardCapSec || 30) - 1.5) * 1000));
    deck.capTimer = setTimeout(() => {
      if (deck.closed) return;
      deck.endedEarly = true;
      if (deck === this.activeDeck && !this.stopped && !this.clockPaused) {
        this.recoverEndedActiveDeck(deck);
      } else if (deck !== this.activeDeck) {
        void this.closeDeck(deck);
      }
    }, capMs);

    const setupPayload: Record<string, unknown> = {
      event_type: 'world_setup',
      world_prompt: { text: act.worldPrompt },
    };
    if (referenceImageBase64) {
      setupPayload.reference_image = {
        mime_type: 'image/jpeg',
        data: referenceImageBase64,
      };
    }
    console.debug('[GenieDirector] world_setup ->', {
      actIndex: act.index,
      hasRefImage: Boolean(referenceImageBase64),
      prompt: act.worldPrompt.slice(0, 120),
    });
    await session.send(setupPayload as any);
    await waitForFirstFrame(video);

    // Keep native video muted (0 speaker bleed) while leaving RTCP audio clock uninterrupted
    video.muted = true;
    video.volume = 0;
    void video.play().catch(() => {});

    const remoteStream = transport.remoteMediaStream as MediaStream | undefined;
    if (!deck.remoteVideoTrack) {
      deck.remoteVideoTrack = remoteStream?.getVideoTracks?.()[0] ?? null;
    }

    this.frameWidth = video.videoWidth || this.frameWidth;
    this.frameHeight = video.videoHeight || this.frameHeight;

    return deck;
  }

  private async releaseHeldKeys(deck: Deck | null): Promise<void> {
    if (!deck || deck.closed || deck.heldKeys.size === 0) return;
    const keys = Array.from(deck.heldKeys);
    deck.heldKeys.clear();
    await Promise.all(
      keys.map((key) =>
        deck.session
          .send({
            event_type: 'user_action',
            action: 'key_up',
            input: key,
          } as any)
          .catch(() => {})
      )
    );
  }

  private async closeDeck(deck: Deck | null): Promise<void> {
    if (!deck || deck.closed) return;
    deck.closed = true;
    if (this.prewarmingDeck === deck) {
      this.prewarmingDeck = null;
    }
    if (deck.capTimer) {
      clearTimeout(deck.capTimer);
      deck.capTimer = null;
    }
    await this.stopDirectTrackRecorder(deck).catch(() => {});
    await this.releaseHeldKeys(deck).catch(() => {});
    try {
      await deck.session.complete();
    } catch {
      sendEndBeacon(deck.interactionId, deck.stopToken);
    }
    // Only reset the DOM `<video>` element if this deck is still the active owner of that slot
    // so a cancelled older rollover NEVER wipes a newer deck's WebRTC `srcObject`!
    if (this.slotOwner[deck.slot] === deck) {
      this.slotOwner[deck.slot] = null;
      try {
        deck.video.pause();
        deck.video.srcObject = null;
        deck.video.removeAttribute('src');
        deck.video.load();
      } catch {
        // ignore
      }
    }
    deck.remoteVideoTrack = null;
    deck.peerConnection = null;
  }

  private fireInputCue(deck: Deck, cue: Cue): void {
    if (!cue.prompt || deck.closed || this.stopped) return;
    this.activeCue = cue;
    this.status = cue.reason;
    // Per @google/genai InputEvent spec: send ONE atomic `event_type: "input"` message
    // so Genie 4's closed-loop milestone planner completes the transformation cleanly.
    console.debug('[GenieDirector] input ->', {
      id: cue.id,
      targetSec: cue.targetSec,
      prompt: cue.prompt,
    });
    void deck.session.send(cue.prompt).catch((err) => {
      console.warn('[GenieDirector] input dispatch failed:', err);
    });
    this.emitTelemetry();
  }

  private fireActionCue(deck: Deck, cue: Cue): void {
    if (!cue.key || deck.closed || this.stopped) return;
    const key = cue.key;
    const maxHoldSec = this.plan.timing.maxActionHoldSec || 4.5;
    const holdMs = Math.max(250, Math.min(maxHoldSec * 1000, Math.round((cue.durationSec || 2) * 1000)));
    deck.heldKeys.add(key);
    console.debug('[GenieDirector] action ->', {
      id: cue.id,
      key,
      holdMs,
      targetSec: cue.targetSec,
    });
    void deck.session
      .send({
        event_type: 'user_action',
        action: 'key_down',
        input: key,
      } as any)
      .catch(() => {});

    const t = setTimeout(() => {
      this.timers.delete(t);
      if (deck.closed || !deck.heldKeys.has(key)) return;
      deck.heldKeys.delete(key);
      void deck.session
        .send({
          event_type: 'user_action',
          action: 'key_up',
          input: key,
        } as any)
        .catch(() => {});
    }, holdMs);
    this.timers.add(t);
    this.emitTelemetry();
  }

  private resolveSongClock(): number | null {
    const audioPos = audio.position();
    if (audio.getIsPlaying() && audioPos !== null && Number.isFinite(audioPos)) {
      this.clockAnchorSec = audioPos;
      this.clockAnchorMs = performance.now();
      this.clockPaused = false;
      return audioPos;
    }
    if (this.clockPaused) {
      return null;
    }
    if (this.clockAnchorMs > 0) {
      const elapsed = Math.max(0, (performance.now() - this.clockAnchorMs) / 1000);
      return Math.min(this.plan.durationSec, this.clockAnchorSec + elapsed);
    }
    return null;
  }

  public setPaused(paused: boolean): void {
    if (paused) {
      const current = this.resolveSongClock();
      if (current !== null) this.clockAnchorSec = current;
      this.clockPaused = true;
      void this.releaseHeldKeys(this.activeDeck);
    } else {
      this.clockAnchorMs = performance.now();
      this.clockPaused = false;
      if (this.activeDeck && (this.activeDeck.endedEarly || this.activeDeck.closed) && !this.stopped) {
        this.recoverEndedActiveDeck(this.activeDeck);
      }
    }
  }

  private recoverEndedActiveDeck(deck: Deck): void {
    if (this.stopped || deck !== this.activeDeck || this.rollingInFlight) return;
    const pos = this.resolveSongClock() ?? 0;
    const byTime = this.plan.acts.find((a) => pos >= a.startSec && pos < a.endSec);
    const nextAct =
      byTime && byTime.index !== deck.actIndex
        ? byTime
        : this.plan.acts[deck.actIndex + 1] ?? byTime ?? this.plan.acts[deck.actIndex];
    if (!nextAct) return;
    this.prewarmedActs.add(deck.actIndex);
    void this.beginActRollover(nextAct, {
      immediate: true,
      forceFresh: nextAct.index === deck.actIndex ? false : !nextAct.usesReferenceFrame,
    });
  }

  /**
   * Re-syncs the live Genie 4 scene & camera scheduler when the creator seeks backward
   * or forward on the song timeline: re-arms upcoming cues/seams and hot-swaps the
   * standby deck into the sought scene whenever crossing a scene boundary.
   */
  public seekTo(targetSec: number): void {
    const clamped = Math.max(0, Math.min(this.plan.durationSec, Number(targetSec) || 0));
    this.clockAnchorSec = clamped;
    this.clockAnchorMs = performance.now();
    this.clockPaused = false;
    void this.releaseHeldKeys(this.activeDeck);

    // Re-arm all cues at or after the sought position
    for (const cue of this.plan.cues) {
      if (cue.targetSec >= clamped - 0.2) {
        this.firedCues.delete(cue.id);
      } else {
        this.firedCues.add(cue.id);
      }
    }

    // Re-arm rollover stabilization/prewarm for all scenes at or after the sought position
    let clearedPrewarm = false;
    for (const act of this.plan.acts) {
      if (act.stabilizeSec !== null && clamped < act.stabilizeSec) {
        this.stabilizedActs.delete(act.index);
      }
      if (act.captureSec !== null && clamped < act.captureSec) {
        if (this.prewarmedActs.delete(act.index)) {
          clearedPrewarm = true;
        }
      }
    }

    if (clearedPrewarm || this.prewarmingDeck) {
      this.rolloverGen++;
      this.rollingInFlight = false;
      const stale = this.prewarmingDeck;
      this.prewarmingDeck = null;
      if (stale) void this.closeDeck(stale);
    }

    const deck = this.activeDeck;
    if (deck && !this.stopped) {
      const targetAct =
        this.plan.acts.find((a) => clamped >= a.startSec && clamped < a.endSec) ??
        this.plan.acts[this.plan.acts.length - 1];
      if (targetAct && (targetAct.index !== deck.actIndex || deck.endedEarly || deck.closed)) {
        void this.beginActRollover(targetAct, { immediate: true, forceFresh: true });
      }
    }

    this.emitTelemetry();
  }

  /**
   * Hot-swaps the standby Genie 4 deck immediately into a live creator-directed scene
   * (`world_setup` on a fresh interaction, since `models/genie-4` ignores mid-session text input)
   * and fires any requested camera choreography move as soon as the new scene lands on-screen.
   */
  public steerNow(prompt: string, key?: Key, durationSec?: number): boolean {
    const deck = this.activeDeck;
    if (!deck || this.stopped) return false;
    const nowSec = this.resolveSongClock() ?? audio.position() ?? 0;
    const currentPlanAct = this.plan.acts[deck.actIndex];
    const liveAct: Act = {
      index: deck.actIndex,
      startSec: nowSec,
      endSec: currentPlanAct?.endSec ?? Math.min(this.plan.durationSec, nowSec + 20),
      durationSec: currentPlanAct?.durationSec ?? 20,
      captureSec: currentPlanAct?.captureSec ?? null,
      stabilizeSec: currentPlanAct?.stabilizeSec ?? null,
      cutSec: currentPlanAct?.cutSec ?? null,
      usesReferenceFrame: false,
      transition: 'cut',
      worldPrompt: prompt,
      continuityNote: 'Live direction',
    };
    this.activeCue = {
      id: `live-${Date.now()}`,
      actIndex: deck.actIndex,
      kind: 'input',
      targetSec: nowSec,
      fireSec: nowSec,
      prompt,
      reason: `Live direction: ${prompt.slice(0, 52)}`,
    };
    void this.beginActRollover(liveAct, {
      immediate: true,
      forceFresh: true,
      postKey: key,
      postKeyDurationSec: durationSec ?? 1.8,
    });
    this.emitTelemetry();
    return true;
  }

  private async beginActRollover(
    nextAct: Act,
    opts?: {
      immediate?: boolean;
      forceFresh?: boolean;
      postKey?: Key;
      postKeyDurationSec?: number;
    }
  ): Promise<void> {
    if (!this.activeDeck || this.stopped) return;
    const gen = ++this.rolloverGen;
    this.rollingInFlight = true;
    this.phase = 'rolling';
    this.status = '';
    this.emitTelemetry();

    let nextDeck: Deck | null = null;
    try {
      const outgoingAtStart = this.activeDeck;
      if (!outgoingAtStart || this.stopped) return;

      // Ensure any prior off-screen pre-warm or fading standby deck is completely closed before binding `nextSlot`
      if (this.prewarmingDeck && this.prewarmingDeck !== outgoingAtStart) {
        const stalePrewarm = this.prewarmingDeck;
        this.prewarmingDeck = null;
        await this.closeDeck(stalePrewarm);
        if (this.stopped || this.rolloverGen !== gen) return;
      }
      if (this.standbyDeck && this.standbyDeck !== outgoingAtStart) {
        const staleStandby = this.standbyDeck;
        this.standbyDeck = null;
        this.onDeckVisibility({ activeSlot: outgoingAtStart.slot, fadingSlot: null });
        await this.closeDeck(staleStandby);
        if (this.stopped || this.rolloverGen !== gen) return;
      }

      const shouldUseSeed = Boolean(
        nextAct.usesReferenceFrame &&
          !opts?.forceFresh &&
          !outgoingAtStart.closed &&
          !outgoingAtStart.endedEarly &&
          outgoingAtStart.video.videoWidth > 0
      );

      let seedFrame: string | undefined;
      if (shouldUseSeed) {
        await this.releaseHeldKeys(outgoingAtStart);
        seedFrame = await captureSeedFrame(
          outgoingAtStart.video,
          this.plan.timing.maxSeedBytes || DEFAULT_MAX_SEED_BYTES
        );
        if (this.stopped || this.rolloverGen !== gen) return;
      }

      const nextSlot: 0 | 1 = outgoingAtStart.slot === 0 ? 1 : 0;
      nextDeck = await this.openDeck(nextAct, nextSlot, seedFrame, gen);
      if (!nextDeck || this.stopped || this.rolloverGen !== gen) {
        if (nextDeck) await this.closeDeck(nextDeck);
        return;
      }

      // If pre-warmed early ahead of a planned scene cut, hold quietly off-screen until the exact beat
      // (unless immediate hot-swap or outgoing deck reached Google's ~30s token cap early).
      if (!opts?.immediate) {
        const waitStartMs = performance.now();
        while (
          !this.stopped &&
          this.rolloverGen === gen &&
          !nextDeck.closed &&
          !nextDeck.endedEarly &&
          this.activeDeck === outgoingAtStart &&
          !outgoingAtStart.closed &&
          !outgoingAtStart.endedEarly
        ) {
          const pos = this.resolveSongClock();
          if (pos !== null && pos >= nextAct.startSec - 0.15) break;
          if (performance.now() - waitStartMs > 8_000) break;
          await new Promise((r) => setTimeout(r, 50));
        }
      }

      if (this.stopped || this.rolloverGen !== gen) {
        await this.closeDeck(nextDeck);
        return;
      }

      const outgoing = this.activeDeck;
      if (!outgoing) {
        await this.closeDeck(nextDeck);
        return;
      }

      // Start native video-only recording RIGHT at the swap instant so off-screen pre-warm frames never bleed!
      this.startDirectTrackRecorder(nextDeck);

      if (this.prewarmingDeck === nextDeck) {
        this.prewarmingDeck = null;
      }
      this.standbyDeck = outgoing;
      this.activeDeck = nextDeck;
      this.phase = 'live';
      this.status = '';
      this.activeCue = null;
      this.onDeckVisibility({ activeSlot: nextDeck.slot, fadingSlot: outgoing.slot });
      this.emitTelemetry();

      console.debug('[GenieDirector] scene swap ->', {
        fromAct: outgoing.actIndex,
        toAct: nextAct.index,
        transition: nextAct.transition ?? (shouldUseSeed ? 'continue' : 'cut'),
        recordIndex: nextDeck.recordIndex,
      });

      if (opts?.postKey) {
        const nowSec = this.resolveSongClock() ?? nextAct.startSec;
        this.fireActionCue(nextDeck, {
          id: `live-act-${Date.now()}`,
          actIndex: nextDeck.actIndex,
          kind: 'action',
          targetSec: nowSec,
          fireSec: nowSec,
          key: opts.postKey,
          durationSec: opts.postKeyDurationSec ?? 1.8,
          reason: `Camera move (${opts.postKey})`,
        });
      }

      const fadeMs = this.plan.timing.crossfadeMs || 600;
      const swappedInDeck = nextDeck;
      const closeTimer = setTimeout(() => {
        this.timers.delete(closeTimer);
        if (this.standbyDeck === outgoing) {
          this.standbyDeck = null;
        }
        if (this.activeDeck === swappedInDeck) {
          this.onDeckVisibility({ activeSlot: swappedInDeck.slot, fadingSlot: null });
        }
        void this.closeDeck(outgoing);
      }, fadeMs);
      this.timers.add(closeTimer);
    } catch (err) {
      console.warn('[GenieDirector] rollover failed:', err);
      if (nextDeck && nextDeck !== this.activeDeck) {
        void this.closeDeck(nextDeck);
      }
      if (!this.stopped && this.rolloverGen === gen) {
        this.phase = 'live';
        this.status = '';
        this.emitTelemetry();
      }
    } finally {
      if (this.rolloverGen === gen) {
        this.rollingInFlight = false;
      }
    }
  }

  private tickSchedule = (): void => {
    if (this.stopped) return;

    const pos = this.resolveSongClock();
    if (pos !== null && this.activeDeck && !this.activeDeck.closed) {
      const rttHalfSec = Math.min(0.4, this.rttMs / 2000);
      const act = this.plan.acts[this.activeDeck.actIndex];

      if (act) {
        if (act.stabilizeSec !== null && pos >= act.stabilizeSec && !this.stabilizedActs.has(act.index)) {
          this.stabilizedActs.add(act.index);
          void this.releaseHeldKeys(this.activeDeck);
        }

        if (
          act.captureSec !== null &&
          pos >= act.captureSec &&
          !this.prewarmedActs.has(act.index)
        ) {
          const nextAct = this.plan.acts[act.index + 1];
          if (nextAct) {
            this.prewarmedActs.add(act.index);
            void this.beginActRollover(nextAct);
          }
        }

        for (const cue of this.plan.cues) {
          if (this.firedCues.has(cue.id)) continue;
          // Allow matching active act cues (and if user sought past act boundary on a single live session, still steer)
          if (cue.actIndex !== act.index && pos < act.endSec) continue;
          const dispatchSec = Math.max(act.startSec, cue.fireSec - rttHalfSec);
          if (pos >= dispatchSec) {
            this.firedCues.add(cue.id);
            if (cue.kind === 'input') {
              this.fireInputCue(this.activeDeck, cue);
            } else {
              this.fireActionCue(this.activeDeck, cue);
            }
          }
        }
      }
    }
  };

  private handlePageHide = (): void => {
    if (this.activeDeck && !this.activeDeck.closed) {
      sendEndBeacon(this.activeDeck.interactionId, this.activeDeck.stopToken);
    }
    if (this.standbyDeck && !this.standbyDeck.closed) {
      sendEndBeacon(this.standbyDeck.interactionId, this.standbyDeck.stopToken);
    }
    if (this.prewarmingDeck && !this.prewarmingDeck.closed) {
      sendEndBeacon(this.prewarmingDeck.interactionId, this.prewarmingDeck.stopToken);
    }
  };

  private handleVisibilityChange = (): void => {
    if (typeof document === 'undefined') return;
    if (document.hidden) {
      if (!this.hiddenTimer) {
        this.hiddenTimer = setTimeout(() => {
          this.hiddenTimer = null;
          if (!this.stopped) {
            void this.stop(true);
          }
        }, 12_000);
      }
    } else if (this.hiddenTimer) {
      clearTimeout(this.hiddenTimer);
      this.hiddenTimer = null;
    }
  };

  /**
   * Warms up Act 1 directly on visible DOM deck 0 (~5-9s), begins 10 Mbps native remote
   * video track chunk interception into `valkeyWips`, and calls `onFirstFrame()` to lock audio at t = 0.00s.
   */
  public async start(onFirstFrame: () => void | Promise<void>): Promise<void> {
    const act1 = this.plan.acts[0];
    if (!act1) throw new Error('Direction plan contains no acts');

    this.stopped = false;
    this.phase = 'warming';
    this.status = 'Starting live video…';
    this.onDeckVisibility({ activeSlot: 0, fadingSlot: null });
    this.emitTelemetry();

    window.addEventListener('pagehide', this.handlePageHide);
    window.addEventListener('beforeunload', this.handlePageHide);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);

    try {
      const opened = await this.openDeck(act1, 0);
      if (!opened || this.stopped) {
        if (opened) await this.closeDeck(opened);
        return;
      }
      this.activeDeck = opened;

      this.startDirectTrackRecorder(this.activeDeck);

      this.phase = 'live';
      this.status = '';
      this.clockAnchorSec = 0;
      this.clockAnchorMs = performance.now();
      this.clockPaused = false;
      this.emitTelemetry();

      await onFirstFrame();
      this.clockAnchorSec = audio.position() ?? 0;
      this.clockAnchorMs = performance.now();

      this.scheduleTimer = setInterval(this.tickSchedule, SCHEDULE_POLL_MS);
      // Sample WebRTC RTT quietly every 5s strictly for internal cue lead-time compensation (no UI re-renders!)
      this.statsTimer = setInterval(() => {
        if (this.stopped) return;
        const pc = this.activeDeck?.peerConnection;
        if (pc && typeof pc.getStats === 'function') {
          void pc
            .getStats()
            .then((stats) => {
              stats.forEach((report: any) => {
                if (
                  report.type === 'candidate-pair' &&
                  report.state === 'succeeded' &&
                  typeof report.currentRoundTripTime === 'number'
                ) {
                  this.rttMs = Math.max(10, report.currentRoundTripTime * 1000);
                }
              });
            })
            .catch(() => {});
        }
      }, 5000);
    } catch (err: any) {
      await this.stop(false);
      throw err;
    }
  }

  /**
   * Terminates active Genie 4 sessions (`complete()`), flushes intercepted video chunks
   * into `valkeyWips`, and optionally stitches them server-side into a crisp CRF-17 silent preview MP4.
   */
  public async stop(shouldFinalize = true): Promise<{ wip: VideoWip; previewUrl: string; durationSec: number } | null> {
    if (this.stopped) return null;
    this.stopped = true;

    window.removeEventListener('pagehide', this.handlePageHide);
    window.removeEventListener('beforeunload', this.handlePageHide);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);

    if (this.scheduleTimer) {
      clearInterval(this.scheduleTimer);
      this.scheduleTimer = null;
    }
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
    if (this.hiddenTimer) {
      clearTimeout(this.hiddenTimer);
      this.hiddenTimer = null;
    }
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    for (const iv of this.intervals) clearInterval(iv);
    this.intervals.clear();

    const pendingPrefetch = this.prefetchedAct0Token;
    this.prefetchedAct0Token = null;
    if (pendingPrefetch) {
      void pendingPrefetch
        .then((tok) => sendEndBeacon(tok.interactionId, tok.stopToken))
        .catch(() => {});
    }

    const active = this.activeDeck;
    const standby = this.standbyDeck;
    const prewarming = this.prewarmingDeck;
    this.activeDeck = null;
    this.standbyDeck = null;
    this.prewarmingDeck = null;

    await Promise.all([this.closeDeck(active), this.closeDeck(standby), this.closeDeck(prewarming)]);

    if (!shouldFinalize || this.capturedByAct.size === 0) {
      this.capturedByAct.clear();
      this.actSpans.clear();
      this.phase = 'idle';
      this.status = 'Stopped';
      this.emitTelemetry();
      return null;
    }

    this.phase = 'stitching';
    this.status = 'Preparing preview…';
    this.emitTelemetry();

    try {
      const actIndices = Array.from(this.capturedByAct.keys()).sort((a, b) => a - b);
      for (const actIndex of actIndices) {
        const parts = this.capturedByAct.get(actIndex) ?? [];
        let batch: Blob[] = [];
        let batchBytes = 0;
        const flushBatch = async () => {
          if (batch.length === 0) return;
          const combined = new Blob(batch, { type: batch[0].type || 'video/webm' });
          batch = [];
          batchBytes = 0;
          await pushVideoChunk({
            songId: this.plan.songId,
            runId: this.runId,
            actIndex,
            chunk: combined,
            userAddress: this.userAddress,
          });
        };
        for (const part of parts) {
          batch.push(part);
          batchBytes += part.size;
          if (batchBytes >= 4_000_000) {
            await flushBatch();
          }
        }
        await flushBatch();
        this.capturedByAct.delete(actIndex);
      }

      const actSpans = Array.from(this.actSpans.values()).sort((a, b) => a.actIndex - b.actIndex);
      this.actSpans.clear();

      const result = await finalizeVideoWip({
        songId: this.plan.songId,
        runId: this.runId,
        actCount: Math.max(1, this.maxActRecorded),
        actSpans: actSpans.length > 0 ? actSpans : undefined,
        userAddress: this.userAddress,
      });
      this.phase = 'ready';
      this.status = '';
      this.emitTelemetry();
      return result;
    } catch (err: any) {
      this.capturedByAct.clear();
      this.actSpans.clear();
      this.phase = 'error';
      this.status = err?.message || 'Could not prepare preview';
      this.emitTelemetry();
      throw err;
    }
  }
}
