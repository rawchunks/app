import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  AlignLeft,
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Download,
  Film,
  Image as ImageIcon,
  Layers,
  Loader2,
  Lock,
  Maximize2,
  Merge,
  Mic,
  Minimize2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Repeat,
  Save,
  Scissors,
  Send,
  SkipBack,
  Sliders,
  Sparkles,
  Square,
  Trash2,
  Unlock,
  Upload,
  Wand2,
  X,
} from 'lucide-react';
import { AccountChip } from '../components/account';
import { Button } from '../components/button';
import { Glitch } from '../components/glitch';
import { Modal } from '../components/modal';
import { Session } from '../components/session';
import { Tooltip } from '../components/daw/Tooltip';
import { Waveform } from '../components/waveform';
import type { Song } from '../lib/schema';
import {
  attachJobStream,
  buildClientFallbackScore,
  cancelRender,
  createClientIdleWip,
  Deck,
  discardProject,
  editClip,
  ensureSongStemsInBackground,
  formatClock,
  formatTime,
  loadProject,
  readCachedVideoBundle,
  removeAsset,
  requestFrame,
  runAssemble,
  runPlan,
  runRender,
  runSketch,
  saveVideo,
  updateBible,
  updateShot,
  uploadImage,
  writeCachedVideoBundle,
  type Accent,
  type Asset,
  type DeckVisualState,
  type EditKind,
  type Event as StreamEvent,
  type JobType,
  type Master,
  type Mode,
  type Quality,
  type Score,
  type Section,
  type Shot,
  type TimelineSlot,
  type Transition,
  type Vocal,
  type Wip,
} from '../lib/video';

export interface Props {
  song: Song;
  onBack: () => void;
  onSongUpdated?: (song: Song) => void;
}

type CenterView = 'player' | 'storyboard';
type RailTab = 'director' | 'shot' | 'refs';
type Scope = 'song' | 'section' | 'shot';
type MobilePane = 'player' | 'storyboard' | 'director' | 'shot' | 'refs';

interface ActivityStep {
  id: string;
  label: string;
  detail?: string;
  status: 'running' | 'done' | 'error';
}

interface ClientOp {
  id: string;
  serverJobId?: string;
  type: JobType;
  label: string;
  detail?: string;
  status: 'running' | 'done' | 'error';
  targetIds?: string[];
  startedAt: number;
}

const QUALITIES: Array<{ value: Quality; label: string }> = [
  { value: '544p', label: '544p' },
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' },
];

const EDIT_KINDS: Array<{ value: EditKind; label: string }> = [
  { value: 'restyle', label: 'Edit' },
  { value: 'day_to_night', label: 'Night' },
  { value: 'clean_plate', label: 'Remove' },
  { value: 'refine', label: 'Refine' },
  { value: 'retake', label: 'Retake' },
];

const TRANSITIONS: Array<{ value: Transition; label: string }> = [
  { value: 'cut', label: 'Hard Cut' },
  { value: 'flash', label: 'White Flash' },
  { value: 'whip', label: 'Whip Pan' },
  { value: 'punch', label: 'Zoom Punch' },
  { value: 'dissolve', label: 'Dissolve' },
  { value: 'fade', label: 'Fade' },
];

const ACCENTS: Array<{ value: Accent; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'pulse', label: 'Beat Pulse' },
  { value: 'ramp', label: 'Energy Ramp' },
  { value: 'strobe', label: 'Drop Strobe' },
];

function transitionLabel(tx: Transition): string {
  return TRANSITIONS.find((t) => t.value === tx)?.label ?? tx;
}

function sectionTagBadge(label: string, tags: string[]): string | null {
  const norm = label.trim().toLowerCase();
  const extra = tags.find((t) => t.trim().toLowerCase() !== norm);
  return extra ?? null;
}

function cleanMessage(text: string): string {
  return text.replaceAll('**', '').replaceAll('`', '').trim();
}

function shotLyricSummary(shot: Shot): string {
  const words = shot.vocals ?? [];
  if (words.length === 0) return '';
  return words.map((w) => w.text).join(' ');
}

function sectionVisualStatus(sec: Section): 'ready' | 'rendering' | 'queued' | 'failed' | 'partial' | 'draft' {
  if (!sec.shots.length) return 'draft';
  if (sec.shots.some((s) => s.status === 'rendering' || s.status === 'checking')) return 'rendering';
  if (sec.shots.some((s) => s.status === 'queued')) return 'queued';
  if (sec.shots.some((s) => s.status === 'failed')) return 'failed';
  if (sec.shots.every((s) => Boolean(s.clipUrl))) return 'ready';
  if (sec.shots.some((s) => Boolean(s.clipUrl))) return 'partial';
  return 'draft';
}

function shortSectionCode(label: string): string {
  const clean = label.trim();
  const numMatch = clean.match(/(\d+)\s*$/);
  const num = numMatch ? numMatch[1] : '';
  const low = clean.toLowerCase();
  if (low.includes('pre-chorus') || low.includes('prechorus')) return `PC${num}`;
  if (low.includes('post-chorus') || low.includes('postchorus')) return `PO${num}`;
  if (low.includes('instrumental') || low.includes('interlude')) return `INS${num}`;
  if (low.includes('intro')) return `INT${num}`;
  if (low.includes('outro')) return `OUT${num}`;
  if (low.includes('verse')) return `V${num || '1'}`;
  if (low.includes('chorus') || low.includes('hook')) return `CH${num}`;
  if (low.includes('bridge')) return `BR${num}`;
  if (low.includes('breakdown')) return `BD${num}`;
  if (low.includes('drop')) return `DRP${num}`;
  if (low.includes('solo')) return `SOL${num}`;
  return clean.slice(0, 3).toUpperCase();
}

function shotStatusTitle(shot: Shot): string {
  const base = `Shot ${String(shot.index + 1).padStart(2, '0')} · ${formatClock(shot.startSec)}–${formatClock(shot.endSec)}`;
  if (shot.status === 'failed') return `${base} · Failed${shot.error ? `: ${shot.error}` : ''}`;
  if (shot.status === 'rendering' || shot.status === 'checking') return `${base} · Rendering`;
  if (shot.status === 'queued') return `${base} · Queued`;
  if (shot.clipUrl) return `${base} · Ready`;
  if (shot.startFrame?.url) return `${base} · Sketched`;
  return `${base} · Script`;
}

export const Video: React.FC<Props> = ({ song: initialSong, onBack, onSongUpdated }) => {
  const initialCachedBundle = useMemo(() => readCachedVideoBundle(initialSong.id), [initialSong.id]);
  const [song, setSong] = useState<Song>(initialSong);
  const [score, setScore] = useState<Score | null>(
    () => initialCachedBundle?.score ?? buildClientFallbackScore(initialSong)
  );
  const [wip, setWip] = useState<Wip | null>(
    () => initialCachedBundle?.wip ?? createClientIdleWip(initialSong.id)
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  const [centerView, setCenterView] = useState<CenterView>('player');
  const [railTab, setRailTab] = useState<RailTab>('director');
  const [shotTab, setShotTab] = useState<'frames' | 'prompt' | 'timing' | 'edit'>('frames');
  const [mobilePane, setMobilePane] = useState<MobilePane>('player');
  const [scope, setScope] = useState<Scope>('song');
  const [stageView, setStageView] = useState<'full' | 'shot'>('full');
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null);
  const [storyboardPage, setStoryboardPage] = useState(0);
  const [filmstripPage, setFilmstripPage] = useState(0);
  const [isCompactViewport, setIsCompactViewport] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 640px)').matches : false
  );
  const [isTabletViewport, setIsTabletViewport] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 960px)').matches : false
  );
  const [cinemaOpen, setCinemaOpen] = useState(false);
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false);

  // Playback state
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  const [displayTime, setDisplayTime] = useState(0);
  const [deckVisual, setDeckVisual] = useState<DeckVisualState>({
    activeShotId: null,
    activeSectionId: null,
    hasVideo: false,
  });

  // Live concurrent operation registry (unlimited concurrent Redos, Sketches, Edits & Refs!)
  const [ops, setOps] = useState<ClientOp[]>([]);
  const [steps, setSteps] = useState<ActivityStep[]>([]);
  const [thoughtStream, setThoughtStream] = useState('');
  const [completedSectionIds, setCompletedSectionIds] = useState<string[]>([]);
  const [sketchingIds, setSketchingIds] = useState<string[]>([]);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [showAllMessages, setShowAllMessages] = useState(false);
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const repairCountsRef = useRef<{ qa: number; render: number }>({ qa: 0, render: 0 });
  const latestRevRef = useRef<number>(-1);

  // Interactive form states
  const [chatInput, setChatInput] = useState('');
  const [frameEditTarget, setFrameEditTarget] = useState<'start' | 'end' | null>(null);
  const [frameEditInput, setFrameEditInput] = useState('');
  const [clipEditInput, setClipEditInput] = useState('');
  const [clipEditKind, setClipEditKind] = useState<EditKind>('restyle');
  const [retakeFrom, setRetakeFrom] = useState('1.0');
  const [retakeTo, setRetakeTo] = useState('3.0');
  const [upscaleDialog, setUpscaleDialog] = useState<null | 'assemble' | 'save'>(null);
  const [upscaleChoice, setUpscaleChoice] = useState<Master>('none');
  const [newAssetLabel, setNewAssetLabel] = useState('');
  const [newAssetRole, setNewAssetRole] = useState<Asset['role']>('character');
  const [newAssetPrompt, setNewAssetPrompt] = useState('');
  const [busyFrames, setBusyFrames] = useState<Set<string>>(() => new Set());
  const [busySaving, setBusySaving] = useState(false);

  const deckRef = useRef<Deck | null>(null);
  const slotARef = useRef<HTMLVideoElement | null>(null);
  const slotBRef = useRef<HTMLVideoElement | null>(null);
  const cinemaSlotARef = useRef<HTMLVideoElement | null>(null);
  const cinemaSlotBRef = useRef<HTMLVideoElement | null>(null);
  const cinemaDialogRef = useRef<HTMLDialogElement | null>(null);
  const playheadRef = useRef<HTMLDivElement | null>(null);
  const railPlayheadRef = useRef<HTMLDivElement | null>(null);
  const cinemaPlayheadRef = useRef<HTMLDivElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const cinemaTimelineRef = useRef<HTMLDivElement | null>(null);
  const opControllersRef = useRef<Map<string, AbortController>>(new Map());
  const pendingShotPatchesRef = useRef<Map<string, Promise<void>>>(new Map());
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const uploadTargetRef = useRef<{ target: 'asset' | 'start' | 'end'; shotId?: string; role?: Asset['role'] }>({
    target: 'asset',
  });
  const timeSecRef = useRef(0);
  const lastUiTimeRef = useRef(0);
  const baseId = useId();

  const durationSec = score?.durationSec || song.duration || 0;

  const sections = useMemo<Section[]>(() => wip?.plan?.sections ?? [], [wip?.plan]);
  const shots = useMemo<Shot[]>(() => sections.flatMap((s) => s.shots), [sections]);

  const selectedShot = useMemo<Shot | null>(() => {
    if (!shots.length) return null;
    return shots.find((s) => s.id === selectedShotId) ?? shots[0];
  }, [shots, selectedShotId]);

  const selectedSection = useMemo<Section | null>(() => {
    if (!sections.length) return null;
    if (selectedSectionId) {
      const exact = sections.find((s) => s.id === selectedSectionId);
      if (exact) return exact;
    }
    if (selectedShot) {
      const byShot = sections.find((s) => s.id === selectedShot.sectionId);
      if (byShot) return byShot;
    }
    return sections[0];
  }, [sections, selectedSectionId, selectedShot]);

  const scoreRef = useRef<Score | null>(score);
  scoreRef.current = score;

  const applyWip = useCallback((incoming: Wip | null) => {
    if (!incoming) return;
    const rev = Number.isFinite(incoming.rev) ? incoming.rev : 0;
    if (rev > 0 && rev < latestRevRef.current) return;
    latestRevRef.current = rev;
    setWip(incoming);
    if (scoreRef.current) {
      writeCachedVideoBundle(incoming.songId, scoreRef.current, incoming);
    }
  }, []);

  const upsertOp = useCallback((id: string, patch: Partial<ClientOp> & Pick<ClientOp, 'type' | 'label'>) => {
    setOps((prev) => {
      const idx = prev.findIndex((o) => o.id === id);
      let next: ClientOp[];
      if (idx >= 0) {
        next = [...prev];
        next[idx] = { ...next[idx], ...patch };
      } else {
        next = [
          {
            id,
            type: patch.type,
            label: patch.label,
            detail: patch.detail,
            status: patch.status ?? 'running',
            serverJobId: patch.serverJobId,
            targetIds: patch.targetIds,
            startedAt: patch.startedAt ?? Date.now(),
          },
          ...prev,
        ];
      }
      const running = next.filter((o) => o.status === 'running');
      const settled = next.filter((o) => o.status !== 'running').slice(0, 4);
      return [...running, ...settled];
    });
  }, []);

  const addBusyFrame = useCallback((key: string) => {
    setBusyFrames((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);

  const delBusyFrame = useCallback((key: string) => {
    setBusyFrames((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const runningOps = useMemo(() => ops.filter((o) => o.status === 'running'), [ops]);
  const runningOpsCount = runningOps.length;
  const hasPlan = Boolean(wip?.plan && shots.some((s) => s.prompt));
  const isPlanning = runningOps.some((o) => o.type === 'plan') || wip?.stage === 'planning';
  const isPlanningFresh = isPlanning && !hasPlan;
  const isRendering = runningOps.some((o) => o.type === 'render' || o.type === 'edit') || wip?.stage === 'rendering';
  const isAssembling = runningOps.some((o) => o.type === 'assemble') || wip?.stage === 'assembling';
  const isSketchingAll = runningOps.some((o) => o.type === 'sketch');
  const hasRunningPipeline = runningOpsCount > 0 || isPlanning || isAssembling;

  const busyShotIds = useMemo<Set<string>>(() => {
    const busy = new Set<string>();
    for (const sh of shots) {
      if (sh.status === 'queued' || sh.status === 'rendering' || sh.status === 'checking') {
        busy.add(sh.id);
      }
    }
    for (const op of runningOps) {
      if (op.type === 'render' || op.type === 'edit') {
        for (const tid of op.targetIds ?? []) busy.add(tid);
      }
    }
    return busy;
  }, [shots, runningOps]);

  const readyCount = useMemo(() => shots.filter((s) => Boolean(s.clipUrl)).length, [shots]);
  const failedCount = useMemo(() => shots.filter((s) => s.status === 'failed').length, [shots]);
  const sketchedCount = useMemo(() => shots.filter((s) => Boolean(s.startFrame?.url)).length, [shots]);
  const unsketchedCount = useMemo(
    () => shots.filter((s) => s.mode !== 'text' && !s.startFrame?.url).length,
    [shots]
  );
  const remainingRenderCount = useMemo(
    () => shots.filter((s) => !s.approved && (!s.clipUrl || s.status !== 'ready') && !busyShotIds.has(s.id)).length,
    [shots, busyShotIds]
  );
  const allShotsReady = shots.length > 0 && readyCount === shots.length;
  const hasAssembledMaster = Boolean(wip?.previewUrl);
  const isAssemblyStale = Boolean(wip?.previewUrl && wip?.assemblyStale);
  const downloadableUrl = wip?.previewUrl || (!hasPlan ? song.video : null) || null;

  const masterVideoUrl = useMemo<string | null>(() => {
    if (!isRendering && !isAssembling && wip?.previewUrl && !wip?.assemblyStale) return wip.previewUrl;
    if (!hasPlan && song.video) return song.video;
    return null;
  }, [isRendering, isAssembling, wip?.previewUrl, wip?.assemblyStale, hasPlan, song.video]);

  const timelineSlots = useMemo<TimelineSlot[]>(
    () =>
      shots.map((s) => ({
        id: s.id,
        sectionId: s.sectionId,
        startSec: s.startSec,
        endSec: s.endSec,
        clipUrl: s.clipUrl ?? null,
        trimInSec: s.chainedFromPrev ? 0 : (s.trimInSec ?? 0),
        syncNudgeMs: s.chainedFromPrev ? 0 : (s.syncNudgeMs ?? 0),
        startFrameUrl: s.startFrame?.url ?? null,
        status: s.status,
        transition: s.transition,
        chainedFromPrev: s.chainedFromPrev,
        lipSync: s.lipSync,
      })),
    [shots]
  );

  const stageShot = useMemo<Shot | null>(() => {
    if (playing && stageView === 'full' && deckVisual.activeShotId) {
      return shots.find((s) => s.id === deckVisual.activeShotId) ?? selectedShot;
    }
    return selectedShot;
  }, [playing, stageView, deckVisual.activeShotId, shots, selectedShot]);

  const stageSection = useMemo<Section | null>(() => {
    if (stageShot) {
      return sections.find((s) => s.id === stageShot.sectionId) ?? selectedSection;
    }
    return selectedSection;
  }, [stageShot, sections, selectedSection]);

  const hasExpandableVisual = Boolean(masterVideoUrl || readyCount > 0 || stageShot?.startFrame?.url);

  // Live elapsed timer while any operation is running
  useEffect(() => {
    if (!hasRunningPipeline) return;
    setElapsedSec(0);
    const t0 = Date.now();
    const id = window.setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - t0) / 1000));
    }, 500);
    return () => window.clearInterval(id);
  }, [hasRunningPipeline]);

  const upsertStep = useCallback((step: ActivityStep) => {
    let normalized = step;
    if (step.id.startsWith('qa-repair-')) {
      if (step.status === 'done') repairCountsRef.current.qa += 1;
      const n = Math.max(1, repairCountsRef.current.qa);
      normalized = {
        id: 'qa-repairs',
        label: step.status === 'running' ? 'Refining take' : `Refined ${n} take${n === 1 ? '' : 's'}`,
        detail: step.status === 'running' ? step.label : step.detail,
        status: step.status,
      };
    } else if (step.id.startsWith('repair-')) {
      if (step.status === 'done') repairCountsRef.current.render += 1;
      const n = Math.max(1, repairCountsRef.current.render);
      normalized = {
        id: 'render-repairs',
        label: step.status === 'running' ? 'Adjusting scene' : `Adjusted ${n} scene${n === 1 ? '' : 's'}`,
        detail: step.status === 'running' ? step.label : step.detail,
        status: step.status,
      };
    }

    setSteps((prev) => {
      const cleaned = prev.filter((item) => item.id !== 'init' || normalized.id === 'init');
      const idx = cleaned.findIndex((item) => item.id === normalized.id);
      let next: ActivityStep[];
      if (idx >= 0) {
        next = [...cleaned];
        next[idx] = { ...next[idx], ...normalized };
      } else {
        next = [...cleaned, normalized];
      }
      // Strictly cap Activity Card to max 5 rows so Director chat is never pushed out of view
      if (next.length > 5) {
        const running = next.filter((s) => s.status === 'running');
        const settled = next.filter((s) => s.status !== 'running');
        const keepSettled = Math.max(0, 5 - running.length);
        next = [...settled.slice(-keepSettled), ...running].slice(-5);
      }
      return next;
    });
  }, []);

  const restoreLocalStage = useCallback((prev: Wip | null): Wip | null => {
    if (!prev) return prev;
    if (prev.stage !== 'planning' && prev.stage !== 'rendering' && prev.stage !== 'assembling') return prev;
    const plan = prev.plan
      ? {
          ...prev.plan,
          sections: prev.plan.sections.map((sec) => ({
            ...sec,
            shots: sec.shots.map((sh) =>
              sh.status === 'queued' || sh.status === 'rendering'
                ? { ...sh, status: sh.clipUrl ? ('ready' as const) : ('draft' as const) }
                : sh
            ),
          })),
        }
      : null;
    const hasDirected = Boolean(plan && plan.sections.some((sec) => sec.shots.some((sh) => Boolean(sh.prompt))));
    return {
      ...prev,
      plan,
      stage: prev.previewUrl ? 'ready' : hasDirected ? 'review' : 'idle',
    };
  }, []);

  const reconcileDisconnectedStream = useCallback(
    async (
      songId: string,
      serverJobId: () => string | undefined,
      onEvent: (ev: StreamEvent) => void,
      isSettled: () => boolean,
      signal: AbortSignal
    ): Promise<void> => {
      for (let attempt = 0; attempt < 6; attempt++) {
        if (signal.aborted || isSettled()) return;
        const bundle = await loadProject(songId).catch(() => null);
        if (!bundle || signal.aborted) return;
        setSong(bundle.song);
        applyWip(bundle.wip);
        const targetId = serverJobId();
        const jobs = Array.isArray(bundle.wip.jobs) ? bundle.wip.jobs : [];
        const matched = targetId
          ? jobs.find((j) => j.id === targetId)
          : jobs.find((j) => j.status === 'running');
        const freshRunning =
          matched?.status === 'running' &&
          Date.now() - (matched.updatedAt || matched.startedAt || 0) < 10 * 60_000;
        if (freshRunning) {
          await attachJobStream(songId, onEvent, signal).catch(() => {});
          continue;
        }
        if (matched?.status === 'cancelled') {
          onEvent({ type: 'cancelled', jobId: matched.id, wip: bundle.wip });
          return;
        }
        if (matched?.status === 'error') {
          onEvent({
            type: 'error',
            jobId: matched.id,
            message: matched.detail || bundle.wip.error || 'Operation failed. Please retry.',
            wip: bundle.wip,
          });
          return;
        }
        if (matched?.status === 'done') {
          onEvent({ type: 'done', jobId: matched.id, wip: bundle.wip, video: bundle.song.video ?? undefined });
          return;
        }
        onEvent({ type: 'done', wip: bundle.wip });
        return;
      }
      if (!signal.aborted && !isSettled()) {
        onEvent({ type: 'error', message: 'Connection interrupted. Please retry.' });
      }
    },
    [applyWip]
  );

  // Hydrate song, musical score, and draft project (non-blocking 0ms open; auto-reattach if any background jobs are actively running)
  useEffect(() => {
    let active = true;
    const stemAbort = new AbortController();
    const cached = readCachedVideoBundle(initialSong.id);
    latestRevRef.current = cached?.wip?.rev ?? -1;
    setSong(initialSong);
    setScore(cached?.score ?? buildClientFallbackScore(initialSong));
    setWip(cached?.wip ?? createClientIdleWip(initialSong.id));
    setLoadError(null);
    const cachedFirstSec = cached?.wip?.plan?.sections[0];
    setSelectedSectionId(cachedFirstSec?.id ?? null);
    setSelectedShotId(cachedFirstSec?.shots[0]?.id ?? null);
    setOps([]);
    setSteps([]);

    loadProject(initialSong.id)
      .then((bundle) => {
        if (!active) return;
        setSong(bundle.song);
        setScore(bundle.score);
        applyWip(bundle.wip);
        const firstSec = bundle.wip.plan?.sections[0];
        if (firstSec) {
          setSelectedSectionId((prev) => prev ?? firstSec.id);
          if (firstSec.shots[0]) setSelectedShotId((prev) => prev ?? firstSec.shots[0].id);
        }
        if ((bundle.wip.previewUrl && !bundle.wip.assemblyStale) || bundle.song.video) {
          setStageView('full');
        }

        const hasStems = Boolean(bundle.score.stems && Object.keys(bundle.score.stems).length > 0);
        if (!hasStems && bundle.song.url) {
          void ensureSongStemsInBackground(
            bundle.song,
            bundle.song.creator,
            () => {
              if (!active) return;
              void loadProject(initialSong.id)
                .then((refreshed) => {
                  if (!active) return;
                  setScore(refreshed.score);
                })
                .catch(() => {});
            },
            stemAbort.signal
          );
        }

        // Seamless reload recovery: re-attach to ALL active server-side jobs without restarting or aborting
        const freshRunning = (Array.isArray(bundle.wip.jobs) ? bundle.wip.jobs : []).filter(
          (j) => j.status === 'running' && Date.now() - (j.updatedAt || j.startedAt || 0) < 10 * 60_000
        );
        if (freshRunning.length > 0) {
          repairCountsRef.current = { qa: 0, render: 0 };
          for (const liveJob of freshRunning) {
            upsertOp(liveJob.id, {
              serverJobId: liveJob.id,
              type: liveJob.type,
              label: liveJob.label || `Resuming ${liveJob.type}`,
              detail: liveJob.detail,
              status: 'running',
              targetIds: liveJob.targetIds,
              startedAt: liveJob.startedAt,
            });
          }
          const resumeKey = `resume-${Date.now()}`;
          const ac = new AbortController();
          opControllersRef.current.set(resumeKey, ac);
          const onResumeEvent = (ev: StreamEvent) => {
            if (!active || ac.signal.aborted) return;
            if (ev.wip) {
              applyWip(ev.wip);
              for (const j of ev.wip.jobs ?? []) {
                if (j.status === 'running' || freshRunning.some((f) => f.id === j.id)) {
                  upsertOp(j.id, {
                    serverJobId: j.id,
                    type: j.type,
                    label: j.label,
                    detail: j.detail,
                    status: j.status === 'running' ? 'running' : j.status === 'done' ? 'done' : 'error',
                    targetIds: j.targetIds,
                    startedAt: j.startedAt,
                  });
                }
              }
            }
            if (ev.type === 'step' && ev.stepId && ev.label) {
              upsertStep({
                id: ev.stepId,
                label: ev.label,
                detail: ev.detail,
                status: ev.status === 'done' || ev.status === 'error' ? ev.status : 'running',
              });
            } else if (ev.type === 'thought' && ev.text) {
              setThoughtStream((prev) => (prev + ev.text).slice(-1400));
            } else if (ev.type === 'error' && ev.message) {
              toast.error(ev.message);
            }
          };
          void attachJobStream(initialSong.id, onResumeEvent, ac.signal)
            .catch(() => {})
            .finally(() => {
              opControllersRef.current.delete(resumeKey);
              if (active) {
                void loadProject(initialSong.id)
                  .then((latest) => {
                    if (!active) return;
                    applyWip(latest.wip);
                    setOps((prev) =>
                      prev.map((o) => {
                        const match = latest.wip.jobs?.find((j) => j.id === (o.serverJobId ?? o.id));
                        if (!match) return o.status === 'running' ? { ...o, status: 'done' } : o;
                        return {
                          ...o,
                          detail: match.detail,
                          status: match.status === 'running' ? 'running' : match.status === 'done' ? 'done' : 'error',
                        };
                      })
                    );
                  })
                  .catch(() => {});
              }
            });
        }
      })
      .catch((err: any) => {
        if (!active) return;
        setLoadError(err?.message || 'Could not load video project');
      });

    return () => {
      active = false;
      stemAbort.abort();
      for (const ac of opControllersRef.current.values()) ac.abort();
      opControllersRef.current.clear();
    };
  }, [initialSong.id, applyWip, upsertOp, upsertStep]);

  // Keep selectedSection & selectedShot valid when plan updates
  useEffect(() => {
    if (!sections.length) return;
    if (!selectedSectionId || !sections.some((s) => s.id === selectedSectionId)) {
      setSelectedSectionId(sections[0].id);
    }
  }, [sections, selectedSectionId]);

  useEffect(() => {
    if (!shots.length) return;
    if (!selectedShotId || !shots.some((s) => s.id === selectedShotId)) {
      setSelectedShotId(shots[0].id);
    }
  }, [shots, selectedShotId]);

  // Reset storyboard & filmstrip pagination when section changes
  useEffect(() => {
    setStoryboardPage(0);
    setFilmstripPage(0);
  }, [selectedSection?.id]);

  // Isolated Deck double-buffered audio/video synchronizer
  useEffect(() => {
    if (!song.url) return;
    const deck = new Deck(
      song.url,
      (t, isNowPlaying) => {
        timeSecRef.current = t;
        setPlaying(isNowPlaying);
        if (durationSec > 0) {
          const pct = `${Math.max(0, Math.min(100, (t / durationSec) * 100))}%`;
          if (playheadRef.current) playheadRef.current.style.left = pct;
          if (railPlayheadRef.current) railPlayheadRef.current.style.left = pct;
          if (cinemaPlayheadRef.current) cinemaPlayheadRef.current.style.left = pct;
        }
        const now = performance.now();
        if (now - lastUiTimeRef.current >= 90 || !isNowPlaying) {
          lastUiTimeRef.current = now;
          setDisplayTime(t);
        }
      },
      (visual) => {
        setDeckVisual(visual);
      }
    );
    deckRef.current = deck;
    return () => {
      deck.dispose();
      deckRef.current = null;
    };
  }, [song.url, durationSec]);

  // Keep Deck source updated live as clips stream in (never interrupts audio playback!)
  useEffect(() => {
    const deck = deckRef.current;
    if (!deck) return;
    const useMaster = stageView === 'full' && Boolean(masterVideoUrl);
    deck.setSource({
      mode: useMaster ? 'master' : 'timeline',
      masterUrl: masterVideoUrl,
      timeline: timelineSlots,
      lockedShotId: stageView === 'shot' ? (selectedShot?.id ?? null) : null,
    });
  }, [stageView, masterVideoUrl, timelineSlots, selectedShot?.id]);

  // Bind active double-buffered <video> pair (Cinema dialog takes priority when open)
  useEffect(() => {
    const deck = deckRef.current;
    if (!deck) return;
    if (cinemaOpen) {
      deck.bindSlots(cinemaSlotARef.current, cinemaSlotBRef.current);
    } else if (centerView === 'player') {
      deck.bindSlots(slotARef.current, slotBRef.current);
    } else {
      deck.bindSlots(null, null);
    }
  }, [cinemaOpen, centerView, loadError]);

  // Auto-follow active section & shot during live playback (without clobbering Edit Shot inputs)
  useEffect(() => {
    if (!playing || stageView !== 'full') return;
    if (deckVisual.activeSectionId) {
      setSelectedSectionId((prev) => (prev === deckVisual.activeSectionId ? prev : deckVisual.activeSectionId));
    }
    if (deckVisual.activeShotId && railTab !== 'shot') {
      setSelectedShotId((prev) => (prev === deckVisual.activeShotId ? prev : deckVisual.activeShotId));
    }
  }, [playing, stageView, deckVisual.activeSectionId, deckVisual.activeShotId, railTab]);

  // Sync native <dialog> Cinema modal open/close & Safari click-outside fallback
  useEffect(() => {
    const dialog = cinemaDialogRef.current;
    if (!dialog) return;

    if (cinemaOpen && !dialog.open) {
      dialog.showModal();
    } else if (!cinemaOpen && dialog.open) {
      dialog.close();
    }

    const onClose = () => {
      dialog.returnValue = '';
      setCinemaOpen(false);
      if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => {});
      }
    };
    dialog.addEventListener('close', onClose);

    // Safari fallback where closedby="any" is unsupported (modern-web-guidance dialog rule)
    let pressedOutside = false;
    const isOutside = (e: PointerEvent) => {
      const r = dialog.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!('closedBy' in HTMLDialogElement.prototype)) {
        pressedOutside = isOutside(e);
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      if (!('closedBy' in HTMLDialogElement.prototype) && pressedOutside && isOutside(e)) {
        dialog.close();
      }
      pressedOutside = false;
    };
    dialog.addEventListener('pointerdown', onPointerDown);
    dialog.addEventListener('pointerup', onPointerUp);

    return () => {
      dialog.removeEventListener('close', onClose);
      dialog.removeEventListener('pointerdown', onPointerDown);
      dialog.removeEventListener('pointerup', onPointerUp);
    };
  }, [cinemaOpen]);

  useEffect(() => {
    const onFs = () => setIsNativeFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const togglePlay = useCallback(() => {
    const deck = deckRef.current;
    if (!deck) return;
    if (deck.isPlaying()) deck.pause();
    else void deck.play();
  }, []);

  const handleStop = useCallback(() => {
    const deck = deckRef.current;
    if (!deck) return;
    deck.stop();
    const t = deck.getTime();
    timeSecRef.current = t;
    setDisplayTime(t);
  }, []);

  const handleReturnToZero = useCallback(() => {
    const deck = deckRef.current;
    if (!deck) return;
    deck.seek(0);
    timeSecRef.current = 0;
    setDisplayTime(0);
    if (playheadRef.current) playheadRef.current.style.left = '0%';
    if (railPlayheadRef.current) railPlayheadRef.current.style.left = '0%';
    if (cinemaPlayheadRef.current) cinemaPlayheadRef.current.style.left = '0%';
  }, []);

  const handleToggleLoop = useCallback(() => {
    setLoop((prev) => {
      const next = !prev;
      deckRef.current?.setLoop(next);
      return next;
    });
  }, []);

  const seekTo = useCallback(
    (sec: number) => {
      const deck = deckRef.current;
      if (!deck) return;
      const clamped = Math.max(0, Math.min(durationSec || sec, sec));
      deck.seek(clamped);
      timeSecRef.current = clamped;
      setDisplayTime(clamped);
      if (durationSec > 0) {
        const pct = `${(clamped / durationSec) * 100}%`;
        if (playheadRef.current) playheadRef.current.style.left = pct;
        if (railPlayheadRef.current) railPlayheadRef.current.style.left = pct;
        if (cinemaPlayheadRef.current) cinemaPlayheadRef.current.style.left = pct;
      }
    },
    [durationSec]
  );

  const selectSection = useCallback(
    (sec: Section, jumpAudio = true) => {
      setSelectedSectionId(sec.id);
      if (sec.shots[0]) setSelectedShotId(sec.shots[0].id);
      if (jumpAudio) seekTo(sec.startSec);
    },
    [seekTo]
  );

  const selectShot = useCallback(
    (shot: Shot, openInspector = false) => {
      setSelectedSectionId(shot.sectionId);
      setSelectedShotId(shot.id);
      seekTo(shot.startSec);
      if (openInspector) {
        setRailTab('shot');
        setMobilePane('shot');
      }
    },
    [seekTo]
  );

  const flushPendingShotPatches = useCallback(async (shotId?: string) => {
    if (shotId) {
      const pending = pendingShotPatchesRef.current.get(shotId);
      if (pending) await pending;
      return;
    }
    const allPending = Array.from(pendingShotPatchesRef.current.values());
    if (allPending.length > 0) {
      await Promise.allSettled(allPending);
    }
  }, []);

  const handleShotPatch = useCallback(
    (shotId: string, patch: Parameters<typeof updateShot>[2]): Promise<void> => {
      const prev = pendingShotPatchesRef.current.get(shotId) ?? Promise.resolve();
      const nextTask = prev
        .catch(() => {})
        .then(async () => {
          try {
            const next = await updateShot(song.id, shotId, patch);
            applyWip(next);
          } catch (err: any) {
            toast.error(err?.message || 'Could not save shot');
          }
        });
      const tail = nextTask.finally(() => {
        if (pendingShotPatchesRef.current.get(shotId) === tail) {
          pendingShotPatchesRef.current.delete(shotId);
        }
      });
      pendingShotPatchesRef.current.set(shotId, tail);
      return tail;
    },
    [song.id, applyWip]
  );

  const handleSplitShot = useCallback(
    (shot: Shot) => {
      if (busyShotIds.has(shot.id)) return;
      const dur = shot.endSec - shot.startSec;
      if (dur < 1.7) {
        toast.info('Shot is too short to split');
        return;
      }
      const playhead = timeSecRef.current;
      const inBounds = playhead > shot.startSec + 0.8 && playhead < shot.endSec - 0.8;
      const splitAtSec = inBounds ? playhead : (shot.startSec + shot.endSec) / 2;
      void handleShotPatch(shot.id, { splitAtSec });
    },
    [handleShotPatch, busyShotIds]
  );

  // NLE Keyboard Shortcuts: Space (play/pause), ArrowLeft/ArrowRight (step shot), S (split at playhead)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;

      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.code === 'ArrowLeft' && shots.length > 0 && selectedShot) {
        e.preventDefault();
        const idx = shots.findIndex((s) => s.id === selectedShot.id);
        if (idx > 0) selectShot(shots[idx - 1]);
      } else if (e.code === 'ArrowRight' && shots.length > 0 && selectedShot) {
        e.preventDefault();
        const idx = shots.findIndex((s) => s.id === selectedShot.id);
        if (idx >= 0 && idx + 1 < shots.length) selectShot(shots[idx + 1]);
      } else if (e.code === 'KeyS' && selectedShot && !busyShotIds.has(selectedShot.id) && !isPlanningFresh) {
        e.preventDefault();
        handleSplitShot(selectedShot);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [togglePlay, shots, selectedShot, selectShot, busyShotIds, isPlanningFresh, handleSplitShot]);

  const handleTimelinePointer = (e: React.PointerEvent<HTMLDivElement>, ref: React.RefObject<HTMLDivElement | null>) => {
    if (!ref.current || durationSec <= 0) return;
    const rect = ref.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const sec = ratio * durationSec;
    seekTo(sec);
    const matchingSec = sections.find((s) => sec >= s.startSec && sec < s.endSec);
    if (matchingSec) {
      setSelectedSectionId(matchingSec.id);
      const matchingShot = matchingSec.shots.find((sh) => sec >= sh.startSec && sec < sh.endSec);
      if (matchingShot) setSelectedShotId(matchingShot.id);
    }
  };

  const handlePlanSubmit = async (overrideInstruction?: string, overrideScope?: Scope, overrideSectionId?: string) => {
    if (isPlanningFresh) return;
    const text = (overrideInstruction ?? chatInput).trim();
    const activeScope = overrideScope ?? scope;
    const secId = overrideSectionId ?? (activeScope === 'section' ? selectedSection?.id : undefined);
    const shId = activeScope === 'shot' ? selectedShot?.id : undefined;

    if (hasPlan && !text && !overrideScope && !overrideSectionId) {
      toast.info('Type an instruction for the Director first');
      return;
    }

    const opId = `op-plan-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const opLabel = shId
      ? `Revising ${shId.toUpperCase()}`
      : secId
        ? `Revising ${sections.find((s) => s.id === secId)?.label ?? 'section'}`
        : hasPlan
          ? 'Updating storyboard'
          : 'Planning storyboard';

    setChatInput('');
    upsertOp(opId, { type: 'plan', label: opLabel, status: 'running', targetIds: shId ? [shId] : undefined });
    repairCountsRef.current = { qa: 0, render: 0 };
    if (!hasPlan) {
      setSteps([{ id: 'init', label: 'Starting Director', status: 'running' }]);
      setCompletedSectionIds([]);
    }
    setThoughtStream('');
    setRailTab('director');

    const ac = new AbortController();
    opControllersRef.current.set(opId, ac);

    let serverJobId: string | undefined;
    let settled = false;
    const onPlanEvent = (ev: StreamEvent) => {
      if (ac.signal.aborted) return;
      if (ev.jobId && !serverJobId) {
        serverJobId = ev.jobId;
        upsertOp(opId, { type: 'plan', label: opLabel, serverJobId });
      }
      if (ev.wip) applyWip(ev.wip);
      if (ev.type === 'step' && ev.stepId && ev.label) {
        upsertStep({
          id: ev.stepId,
          label: ev.label,
          detail: ev.detail,
          status: ev.status === 'done' || ev.status === 'error' ? ev.status : 'running',
        });
        upsertOp(opId, { type: 'plan', label: opLabel, detail: ev.detail || ev.label });
      } else if (ev.type === 'thought' && ev.text) {
        setThoughtStream((prev) => (prev + ev.text).slice(-1400));
      } else if (ev.type === 'section' && ev.sectionId) {
        setCompletedSectionIds((prev) => (prev.includes(ev.sectionId!) ? prev : [...prev, ev.sectionId!]));
      } else if (ev.type === 'done') {
        settled = true;
        upsertOp(opId, { type: 'plan', label: opLabel, detail: 'Ready', status: 'done' });
        setSteps((prev) => prev.map((st) => (st.status === 'running' ? { ...st, status: 'done' } : st)));
        if (!secId && !shId && !wip?.previewUrl) {
          setCenterView('storyboard');
        }
      } else if (ev.type === 'cancelled') {
        settled = true;
        upsertOp(opId, { type: 'plan', label: opLabel, detail: 'Stopped', status: 'error' });
        setSteps((prev) =>
          prev.map((st) => (st.status === 'running' ? { ...st, status: 'error', detail: 'Stopped' } : st))
        );
      } else if (ev.type === 'error' && ev.message) {
        settled = true;
        upsertOp(opId, { type: 'plan', label: opLabel, detail: ev.message, status: 'error' });
        setSteps((prev) =>
          prev.map((st) => (st.status === 'running' ? { ...st, status: 'error', detail: ev.message } : st))
        );
        toast.error(ev.message);
      }
    };

    try {
      await runPlan(
        {
          songId: song.id,
          instruction: text || undefined,
          sectionId: secId,
          shotId: shId,
          quality: wip?.quality ?? '720p',
        },
        onPlanEvent,
        ac.signal
      );
      if (!settled && !ac.signal.aborted) {
        await reconcileDisconnectedStream(song.id, () => serverJobId, onPlanEvent, () => settled, ac.signal);
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError' && !ac.signal.aborted) {
        upsertOp(opId, { type: 'plan', label: opLabel, detail: err?.message, status: 'error' });
        toast.error(err?.message || 'Could not update storyboard');
      }
    } finally {
      opControllersRef.current.delete(opId);
      if (!settled) {
        upsertOp(opId, { type: 'plan', label: opLabel, status: ac.signal.aborted ? 'error' : 'done' });
      }
    }
  };

  const handleSketchSection = async (sectionId?: string) => {
    if (!wip?.plan) return;
    const targets = sectionId
      ? wip.plan.sections.find((s) => s.id === sectionId)?.shots.filter((sh) => sh.mode !== 'text' && !sh.startFrame?.url) ?? []
      : shots.filter((sh) => sh.mode !== 'text' && !sh.startFrame?.url);

    if (targets.length === 0) {
      toast.info('All frames already have sketches');
      return;
    }

    const opId = `op-sketch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const opLabel = sectionId
      ? `Sketching ${sections.find((s) => s.id === sectionId)?.label ?? 'section'} (${targets.length})`
      : `Sketching all (${targets.length})`;
    const targetIds = targets.map((t) => t.id);

    upsertOp(opId, { type: 'sketch', label: opLabel, detail: `0 / ${targets.length}`, status: 'running', targetIds });
    setSketchingIds((prev) => Array.from(new Set([...prev, ...targetIds])));

    const ac = new AbortController();
    opControllersRef.current.set(opId, ac);

    let serverJobId: string | undefined;
    let completedCleanly = false;
    let settled = false;
    const onSketchEvent = (ev: StreamEvent) => {
      if (ac.signal.aborted) return;
      if (ev.jobId && !serverJobId) {
        serverJobId = ev.jobId;
        upsertOp(opId, { type: 'sketch', label: opLabel, serverJobId });
      }
      if (ev.wip) applyWip(ev.wip);
      if (ev.type === 'sketch' && ev.shotId) {
        setSketchingIds((prev) => prev.filter((id) => id !== ev.shotId));
        const done = ev.doneCount ?? 0;
        const tot = ev.totalCount ?? targets.length;
        upsertOp(opId, {
          type: 'sketch',
          label: opLabel,
          detail: `${done} / ${tot}`,
          status: done >= tot ? 'done' : 'running',
        });
      } else if (ev.type === 'done') {
        settled = true;
        completedCleanly = true;
        upsertOp(opId, { type: 'sketch', label: opLabel, detail: 'Ready', status: 'done' });
      } else if (ev.type === 'cancelled') {
        settled = true;
        upsertOp(opId, { type: 'sketch', label: opLabel, detail: 'Stopped', status: 'error' });
      } else if (ev.type === 'error' && ev.message) {
        settled = true;
        upsertOp(opId, { type: 'sketch', label: opLabel, detail: ev.message, status: 'error' });
        toast.error(ev.message);
      }
    };
    try {
      await flushPendingShotPatches();
      await runSketch(song.id, { sectionId, onlyUnsketched: true }, onSketchEvent, ac.signal);
      if (!settled && !ac.signal.aborted) {
        await reconcileDisconnectedStream(song.id, () => serverJobId, onSketchEvent, () => settled, ac.signal);
      }
      if (completedCleanly && !ac.signal.aborted) {
        toast.success('Storyboard sketches ready');
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError' && !ac.signal.aborted) {
        upsertOp(opId, { type: 'sketch', label: opLabel, detail: err?.message, status: 'error' });
        toast.error(err?.message || 'Sketching failed');
      }
    } finally {
      opControllersRef.current.delete(opId);
      setSketchingIds((prev) => prev.filter((id) => !targetIds.includes(id)));
      if (!settled) {
        upsertOp(opId, { type: 'sketch', label: opLabel, status: ac.signal.aborted ? 'error' : 'done' });
      }
    }
  };

  const handleQualityChange = async (quality: Quality) => {
    if (!wip || wip.quality === quality || isAssembling) return;
    setWip({ ...wip, quality });
    try {
      const next = await updateBible(song.id, { quality });
      applyWip(next);
    } catch (err: any) {
      toast.error(err?.message || 'Could not update quality');
    }
  };

  const handleRender = async (opts: { shotId?: string; sectionId?: string; onlyUnrendered?: boolean } = {}) => {
    if (!wip?.plan) return;
    if (opts.shotId && busyShotIds.has(opts.shotId)) return;

    const targetShot = opts.shotId ? shots.find((s) => s.id === opts.shotId) : undefined;
    const opId = `op-render-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const label = targetShot
      ? `Shot ${String(targetShot.index + 1).padStart(2, '0')} (${wip.quality})`
      : opts.sectionId
        ? `${sections.find((s) => s.id === opts.sectionId)?.label ?? 'Section'} (${wip.quality})`
        : `Render clips (${wip.quality})`;
    const initialTargets = opts.shotId
      ? [opts.shotId]
      : opts.sectionId
        ? (sections.find((s) => s.id === opts.sectionId)?.shots.map((s) => s.id) ?? [])
        : shots.filter((s) => !s.approved).map((s) => s.id);

    upsertOp(opId, {
      type: 'render',
      label,
      detail: opts.shotId ? 'Queued' : 'Starting',
      status: 'running',
      targetIds: initialTargets,
    });
    if (!opts.shotId) {
      setCenterView('player');
    }

    const ac = new AbortController();
    opControllersRef.current.set(opId, ac);

    let serverJobId: string | undefined;
    let settled = false;
    const onRenderEvent = (ev: StreamEvent) => {
      if (ac.signal.aborted) return;
      if (ev.jobId && !serverJobId) {
        serverJobId = ev.jobId;
        upsertOp(opId, { type: 'render', label, serverJobId });
      }
      if (ev.wip) applyWip(ev.wip);
      if (ev.type === 'shot' && ev.shotId) {
        const liveShots = ev.wip?.plan?.sections.flatMap((s) => s.shots) ?? [];
        if (opts.shotId) {
          upsertOp(opId, {
            type: 'render',
            label,
            detail: ev.status === 'ready' ? 'Ready' : ev.status === 'failed' ? 'Failed' : 'Rendering',
            status: ev.status === 'failed' ? 'error' : 'running',
          });
        } else {
          const liveReady = liveShots.filter((s) => Boolean(s.clipUrl)).length;
          upsertOp(opId, {
            type: 'render',
            label,
            detail: `${liveReady}/${liveShots.length} ready`,
            status: 'running',
          });
        }
      } else if (ev.type === 'done') {
        settled = true;
        const liveShots = ev.wip?.plan?.sections.flatMap((s) => s.shots) ?? [];
        const allFailed = (ev.failed ?? 0) > 0 && (ev.completed ?? 0) === 0;
        upsertOp(opId, {
          type: 'render',
          label,
          detail: allFailed
            ? 'Failed'
            : opts.shotId
              ? 'Ready'
              : `${liveShots.filter((s) => Boolean(s.clipUrl)).length}/${liveShots.length} ready`,
          status: allFailed ? 'error' : 'done',
        });
        if (allFailed) {
          const shotErr = opts.shotId ? liveShots.find((s) => s.id === opts.shotId)?.error : null;
          toast.error(shotErr || 'Could not render shot. Please retry.');
        }
      } else if (ev.type === 'cancelled') {
        settled = true;
        upsertOp(opId, { type: 'render', label, detail: 'Stopped', status: 'error' });
      } else if (ev.type === 'error' && ev.message) {
        settled = true;
        upsertOp(opId, { type: 'render', label, detail: ev.message, status: 'error' });
        toast.error(ev.message);
      }
    };

    try {
      await flushPendingShotPatches(opts.shotId);
      await runRender(
        song.id,
        {
          quality: wip.quality,
          shotId: opts.shotId,
          sectionId: opts.sectionId,
          onlyUnrendered: opts.onlyUnrendered,
        },
        onRenderEvent,
        ac.signal
      );
      if (!settled && !ac.signal.aborted) {
        await reconcileDisconnectedStream(song.id, () => serverJobId, onRenderEvent, () => settled, ac.signal);
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError' && !ac.signal.aborted) {
        upsertOp(opId, { type: 'render', label, detail: err?.message, status: 'error' });
        toast.error(err?.message || 'Render failed');
      }
    } finally {
      opControllersRef.current.delete(opId);
      if (!settled) {
        upsertOp(opId, { type: 'render', label, status: ac.signal.aborted ? 'error' : 'done' });
      }
    }
  };

  const handleAssemble = async (instruction?: string, upscale: Master = 'none', saveAfter = false) => {
    if (!wip?.plan || isAssembling || readyCount === 0) return;
    const opId = `op-assemble-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const opLabel = upscale !== 'none' ? `Assemble (${upscale.toUpperCase()})` : 'Assemble master';
    upsertOp(opId, { type: 'assemble', label: opLabel, detail: 'Reviewing clips', status: 'running' });
    repairCountsRef.current = { qa: 0, render: 0 };
    setSteps([
      upscale !== 'none'
        ? { id: 'upscale', label: `Upscaling clips to ${upscale.toUpperCase()}`, status: 'running' }
        : { id: 'producer-sample', label: 'Reviewing rendered clips', status: 'running' },
    ]);
    setThoughtStream('');
    setRailTab('director');

    const ac = new AbortController();
    opControllersRef.current.set(opId, ac);

    let serverJobId: string | undefined;
    let assembledOk = false;
    let settled = false;
    let savedVideoUrl: string | undefined;
    const onAssembleEvent = (ev: StreamEvent) => {
      if (ac.signal.aborted) return;
      if (ev.jobId && !serverJobId) {
        serverJobId = ev.jobId;
        upsertOp(opId, { type: 'assemble', label: opLabel, serverJobId });
      }
      if (ev.wip) applyWip(ev.wip);
      if (ev.type === 'step' && ev.stepId && ev.label) {
        upsertStep({
          id: ev.stepId,
          label: ev.label,
          detail: ev.detail,
          status: ev.status === 'done' || ev.status === 'error' ? ev.status : 'running',
        });
        upsertOp(opId, { type: 'assemble', label: opLabel, detail: ev.detail || ev.label });
      } else if (ev.type === 'thought' && ev.text) {
        setThoughtStream((prev) => (prev + ev.text).slice(-1400));
      } else if (ev.type === 'done') {
        settled = true;
        assembledOk = true;
        if (ev.video) {
          savedVideoUrl = ev.video;
          const updated = { ...song, video: ev.video };
          setSong(updated);
          onSongUpdated?.(updated);
        }
        upsertOp(opId, { type: 'assemble', label: opLabel, detail: 'Ready', status: 'done' });
        setSteps((prev) => prev.map((st) => (st.status === 'running' ? { ...st, status: 'done' } : st)));
        setCenterView('player');
        setStageView('full');
      } else if (ev.type === 'cancelled') {
        settled = true;
        upsertOp(opId, { type: 'assemble', label: opLabel, detail: 'Stopped', status: 'error' });
        setSteps((prev) =>
          prev.map((st) => (st.status === 'running' ? { ...st, status: 'error', detail: 'Stopped' } : st))
        );
      } else if (ev.type === 'error' && ev.message) {
        settled = true;
        upsertOp(opId, { type: 'assemble', label: opLabel, detail: ev.message, status: 'error' });
        setSteps((prev) =>
          prev.map((st) => (st.status === 'running' ? { ...st, status: 'error', detail: ev.message } : st))
        );
        toast.error(ev.message);
      }
    };

    try {
      await runAssemble(
        song.id,
        { useProducer: true, instruction, upscale, saveAfter },
        onAssembleEvent,
        ac.signal
      );
      if (!settled && !ac.signal.aborted) {
        await reconcileDisconnectedStream(song.id, () => serverJobId, onAssembleEvent, () => settled, ac.signal);
      }
      if (assembledOk && !ac.signal.aborted) {
        toast.success(savedVideoUrl ? 'Video saved to song' : 'Master video assembled');
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError' && !ac.signal.aborted) {
        upsertOp(opId, { type: 'assemble', label: opLabel, detail: err?.message, status: 'error' });
        toast.error(err?.message || 'Assembly failed');
      }
    } finally {
      opControllersRef.current.delete(opId);
      if (!settled) {
        upsertOp(opId, { type: 'assemble', label: opLabel, status: ac.signal.aborted ? 'error' : 'done' });
      }
    }
  };

  const downloadMp4 = async (url: string, filename: string, key: string) => {
    if (!url || downloadingKey) return;
    setDownloadingKey(key);
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('Download failed');
      const blob = await resp.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(objUrl), 10_000);
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer');
    } finally {
      setDownloadingKey(null);
    }
  };

  const slugTitle = () =>
    (song.title || 'video').replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '') || 'video';

  const handleDownload = async () => {
    if (!downloadableUrl) return;
    await downloadMp4(downloadableUrl, `${slugTitle()}.mp4`, 'master');
  };

  const handleDownloadShot = async (shot: Shot) => {
    if (!shot.clipUrl) return;
    const shotNum = String(shot.index + 1).padStart(2, '0');
    const takeIdx = shot.takes?.findIndex(
      (tk) => (shot.activeTakeId && tk.id === shot.activeTakeId) || tk.url === shot.clipUrl
    );
    const takeSuffix = shot.takes && shot.takes.length > 1 && takeIdx !== undefined && takeIdx >= 0 ? `-t${takeIdx + 1}` : '';
    await downloadMp4(shot.clipUrl, `${slugTitle()}-shot-${shotNum}${takeSuffix}.mp4`, shot.id);
  };

  const handleCancelOp = async (op: ClientOp) => {
    const ac = opControllersRef.current.get(op.id);
    opControllersRef.current.delete(op.id);
    ac?.abort();
    upsertOp(op.id, { type: op.type, label: op.label, detail: 'Stopped', status: 'error' });
    const cancelId = op.serverJobId ?? (op.id.startsWith('job-') ? op.id : undefined);
    try {
      const next = await cancelRender(song.id, cancelId);
      if (next) applyWip(next);
    } catch (err: any) {
      toast.error(err?.message || 'Could not stop operation');
    }
  };

  const handleStopPipeline = async () => {
    for (const ac of opControllersRef.current.values()) ac.abort();
    opControllersRef.current.clear();

    setOps((prev) =>
      prev.map((op) => (op.status === 'running' ? { ...op, status: 'error', detail: 'Stopped' } : op))
    );
    setSketchingIds([]);
    setWip(restoreLocalStage);
    setSteps((prev) =>
      prev.map((st) => (st.status === 'running' ? { ...st, status: 'error', detail: 'Stopped' } : st))
    );

    try {
      const next = await cancelRender(song.id);
      if (next) applyWip(next);
      toast.info('Stopped');
    } catch (err: any) {
      toast.error(err?.message || 'Could not stop operation');
    }
  };

  const handleGenerateFrame = async (shot: Shot, target: 'start' | 'end', edit = false) => {
    const prompt = edit
      ? frameEditInput.trim()
      : (target === 'end'
          ? shot.endFramePrompt || `${shot.prompt}. Closing moment.`
          : shot.startFramePrompt || shot.prompt
        ).trim();
    if (!prompt) {
      toast.error('Add a scene description first');
      return;
    }

    const frameKey = `${shot.id}:${target}`;
    if (busyFrames.has(frameKey)) return;
    const opId = `op-frame-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const opLabel = `Sketching Shot ${String(shot.index + 1).padStart(2, '0')}`;

    addBusyFrame(frameKey);
    upsertOp(opId, { type: 'frame', label: opLabel, detail: target === 'end' ? 'End frame' : 'Start frame', status: 'running', targetIds: [shot.id] });
    try {
      await flushPendingShotPatches(shot.id);
      const next = await requestFrame(song.id, {
        target,
        shotId: shot.id,
        prompt,
        edit,
        imageSize: '1K',
      });
      applyWip(next);
      upsertOp(opId, { type: 'frame', label: opLabel, detail: 'Ready', status: 'done' });
      if (edit) {
        setFrameEditTarget(null);
        setFrameEditInput('');
      }
      toast.success(edit ? 'Frame updated' : 'Sketch ready');
    } catch (err: any) {
      upsertOp(opId, { type: 'frame', label: opLabel, detail: err?.message, status: 'error' });
      toast.error(err?.message || 'Could not generate sketch');
    } finally {
      delBusyFrame(frameKey);
    }
  };

  const handleGenerateAsset = async () => {
    if (!newAssetPrompt.trim() || busyFrames.has('asset')) {
      if (!newAssetPrompt.trim()) toast.error('Describe the character or location');
      return;
    }
    const labelText = newAssetLabel.trim() || 'Reference';
    const opId = `op-asset-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    addBusyFrame('asset');
    upsertOp(opId, { type: 'frame', label: `Reference: ${labelText}`, detail: 'Generating', status: 'running' });
    try {
      const next = await requestFrame(song.id, {
        target: 'asset',
        label: labelText,
        role: newAssetRole,
        prompt: newAssetPrompt.trim(),
        imageSize: '1K',
      });
      applyWip(next);
      upsertOp(opId, { type: 'frame', label: `Reference: ${labelText}`, detail: 'Ready', status: 'done' });
      setNewAssetLabel('');
      setNewAssetPrompt('');
      toast.success('Reference sheet added');
    } catch (err: any) {
      upsertOp(opId, { type: 'frame', label: `Reference: ${labelText}`, detail: err?.message, status: 'error' });
      toast.error(err?.message || 'Reference generation failed');
    } finally {
      delBusyFrame('asset');
    }
  };

  const triggerUpload = (target: 'asset' | 'start' | 'end', shotId?: string, role?: Asset['role']) => {
    uploadTargetRef.current = { target, shotId, role };
    uploadInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const cfg = uploadTargetRef.current;
    const frameKey = cfg.target === 'asset' ? 'asset' : `${cfg.shotId}:${cfg.target}`;
    addBusyFrame(frameKey);
    try {
      const next = await uploadImage(song.id, file, {
        target: cfg.target,
        shotId: cfg.shotId,
        label: cfg.target === 'asset' ? newAssetLabel.trim() || file.name.replace(/\.[^.]+$/, '') : undefined,
        role: cfg.role ?? newAssetRole,
      });
      applyWip(next);
      if (cfg.target === 'asset') setNewAssetLabel('');
      toast.success('Image uploaded');
    } catch (err: any) {
      toast.error(err?.message || 'Upload failed');
    } finally {
      delBusyFrame(frameKey);
    }
  };

  useEffect(() => {
    if (!selectedShot) return;
    const dur = Math.max(2.0, selectedShot.qa?.durationSec ?? (selectedShot.endSec - selectedShot.startSec));
    const from = Math.min(1.0, Math.max(0.3, dur * 0.25));
    const to = Math.max(from + 0.7, dur - 0.3);
    setRetakeFrom(from.toFixed(1));
    setRetakeTo(to.toFixed(1));
  }, [selectedShot?.id, selectedShot?.qa?.durationSec, selectedShot?.startSec, selectedShot?.endSec]);

  const handleEditClip = async () => {
    if (!selectedShot || !clipEditInput.trim() || busyShotIds.has(selectedShot.id)) return;
    const targetShot = selectedShot;
    const instruction = clipEditInput.trim();
    const kind = clipEditKind;
    const fromSec = Number.parseFloat(retakeFrom);
    const toSec = Number.parseFloat(retakeTo);
    const opId = `op-edit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const opLabel = `Editing Shot ${String(targetShot.index + 1).padStart(2, '0')}`;

    setClipEditInput('');
    upsertOp(opId, { type: 'edit', label: opLabel, detail: 'Queued', status: 'running', targetIds: [targetShot.id] });
    try {
      await flushPendingShotPatches(targetShot.id);
      const next = await editClip(song.id, targetShot.id, instruction, {
        quality: wip?.quality,
        editKind: kind,
        ...(kind === 'retake' && Number.isFinite(fromSec) && Number.isFinite(toSec) && toSec > fromSec
          ? { startTime: fromSec, endTime: toSec }
          : {}),
      });
      applyWip(next);
      upsertOp(opId, { type: 'edit', label: opLabel, detail: 'Ready', status: 'done' });
      toast.success('Clip updated');
    } catch (err: any) {
      upsertOp(opId, { type: 'edit', label: opLabel, detail: err?.message, status: 'error' });
      toast.error(err?.message || 'Clip edit failed');
    }
  };

  const openUpscaleDialog = (mode: 'assemble' | 'save') => {
    if (mode === 'save' && wip?.masterResolution === '4k') {
      void handleSave();
      return;
    }
    setUpscaleChoice('none');
    setUpscaleDialog(mode);
  };

  const confirmUpscaleDialog = () => {
    const mode = upscaleDialog;
    const choice = upscaleChoice;
    setUpscaleDialog(null);
    if (!mode) return;
    if (mode === 'save' && choice === 'none') {
      void handleSave();
      return;
    }
    void handleAssemble(undefined, choice, mode === 'save');
  };

  const handleSave = async () => {
    if (!wip?.previewUrl || busySaving) return;
    setBusySaving(true);
    try {
      const res = await saveVideo(song.id);
      applyWip(res.wip);
      const updated = { ...song, video: res.video };
      setSong(updated);
      onSongUpdated?.(updated);
      toast.success('Video saved to song');
    } catch (err: any) {
      toast.error(err?.message || 'Could not save video');
    } finally {
      setBusySaving(false);
    }
  };

  const handleDiscard = async () => {
    if (busySaving) return;
    setBusySaving(true);
    try {
      for (const ac of opControllersRef.current.values()) ac.abort();
      opControllersRef.current.clear();
      const next = await discardProject(song.id);
      latestRevRef.current = 0;
      setWip(next);
      setSelectedSectionId(null);
      setSelectedShotId(null);
      setOps([]);
      setSteps([]);
      setThoughtStream('');
      setCompletedSectionIds([]);
      setSketchingIds([]);
      setCenterView('player');
      toast.info('Draft discarded');
    } catch (err: any) {
      toast.error(err?.message || 'Could not discard draft');
    } finally {
      setBusySaving(false);
    }
  };

  const toggleAssetOnShot = (assetId: string) => {
    if (!selectedShot) return;
    const shotId = selectedShot.id;
    const has = selectedShot.assetIds.includes(assetId);
    if (!has && selectedShot.assetIds.length >= 4) {
      toast.info('Up to 4 references can be attached per shot');
      return;
    }
    const nextIds = has
      ? selectedShot.assetIds.filter((id) => id !== assetId)
      : [...selectedShot.assetIds, assetId].slice(0, 4);

    // Optimistic local state update so rapid multi-ref toggling computes against latest pills
    setWip((prev) => {
      if (!prev?.plan) return prev;
      return {
        ...prev,
        plan: {
          ...prev.plan,
          sections: prev.plan.sections.map((sec) => ({
            ...sec,
            shots: sec.shots.map((sh) => (sh.id === shotId ? { ...sh, assetIds: nextIds } : sh)),
          })),
        },
      };
    });
    void handleShotPatch(shotId, { assetIds: nextIds });
  };

  const toggleNativeFullscreen = async () => {
    const el = cinemaDialogRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // Browser declined fullscreen; cinema dialog still fills viewport
    }
  };

  useEffect(() => {
    const mqCompact = window.matchMedia('(max-width: 640px)');
    const mqTablet = window.matchMedia('(max-width: 960px)');
    const onCompact = (e: MediaQueryListEvent) => setIsCompactViewport(e.matches);
    const onTablet = (e: MediaQueryListEvent) => setIsTabletViewport(e.matches);
    setIsCompactViewport(mqCompact.matches);
    setIsTabletViewport(mqTablet.matches);
    mqCompact.addEventListener('change', onCompact);
    mqTablet.addEventListener('change', onTablet);
    return () => {
      mqCompact.removeEventListener('change', onCompact);
      mqTablet.removeEventListener('change', onTablet);
    };
  }, []);

  const sectionShots = selectedSection?.shots ?? [];
  const filmstripPerPage = isCompactViewport ? 2 : isTabletViewport ? 3 : 6;
  const filmstripPageCount = Math.max(1, Math.ceil(sectionShots.length / filmstripPerPage));
  const clampedFilmstripPage = Math.min(filmstripPage, filmstripPageCount - 1);
  const pagedFilmstripShots = sectionShots.slice(
    clampedFilmstripPage * filmstripPerPage,
    (clampedFilmstripPage + 1) * filmstripPerPage
  );

  // Keep the active playing/selected shot visible in the paginated filmstrip automatically
  useEffect(() => {
    const focusId = playing && stageView === 'full' ? (deckVisual.activeShotId ?? selectedShotId) : selectedShotId;
    if (!focusId || sectionShots.length <= filmstripPerPage) return;
    const idx = sectionShots.findIndex((s) => s.id === focusId);
    if (idx >= 0) {
      const targetPage = Math.floor(idx / filmstripPerPage);
      setFilmstripPage((prev) => (prev === targetPage ? prev : targetPage));
    }
  }, [playing, stageView, deckVisual.activeShotId, selectedShotId, sectionShots, filmstripPerPage]);

  const storyboardPerPage = isCompactViewport ? 2 : 6;
  const storyboardPageCount = Math.max(1, Math.ceil(sectionShots.length / storyboardPerPage));
  const clampedStoryboardPage = Math.min(storyboardPage, storyboardPageCount - 1);
  const pagedSectionShots = sectionShots.slice(
    clampedStoryboardPage * storyboardPerPage,
    (clampedStoryboardPage + 1) * storyboardPerPage
  );
  const unsketchedInSection = sectionShots.filter((sh) => !sh.startFrame?.url).length;
  const allMessages = wip?.messages ?? [];
  const visibleMessages = showAllMessages ? allMessages : allMessages.slice(-4);
  const hiddenMessageCount = Math.max(0, allMessages.length - visibleMessages.length);

  const sectionUnsketchedOrReadyLabel = (sec: Section) => {
    const ready = sec.shots.filter((sh) => Boolean(sh.clipUrl)).length;
    const sketched = sec.shots.filter((sh) => Boolean(sh.startFrame?.url)).length;
    if (ready > 0) return `${ready}/${sec.shots.length}`;
    if (sketched > 0) return `${sketched}/${sec.shots.length}`;
    return `${sec.shots.length}`;
  };

  return (
    <div className="video-studio" data-mobile-pane={mobilePane}>
      <input
        ref={uploadInputRef}
        name="uploadImage"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="video-hidden-input"
        onChange={handleFileSelected}
      />

      {/* Row 1: Exact Rawchunks Editor Header + Master Transport Deck (100% DRY Reuse) */}
      <header className="editor-header-bar">
        <div className="editor-header-left">
          <Tooltip title="Return to Workspace" description="Back to your songs">
            <Button variant="ghost" size="sm" onClick={onBack} className="editor-back-btn" aria-label="Return to Workspace">
              <ArrowLeft size={14} /> <span className="editor-btn-label">WORKSPACE</span>
            </Button>
          </Tooltip>
          <div className="editor-header-text">
            <div className="editor-title-row">
              <Glitch text={song.title} className="editor-track-title" />
            </div>
            <div className="editor-track-sub">
              <span>{score?.bpm ? `${score.bpm} BPM` : '— BPM'}</span>
              <span>•</span>
              <span>{score?.meter ? `${score.meter}/4` : '4/4'}</span>
              {hasPlan && (
                <>
                  <span>•</span>
                  <span>
                    {readyCount > 0
                      ? `${readyCount}/${shots.length} CLIPS`
                      : `${sketchedCount}/${shots.length} SKETCHES`}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Exact Rawchunks Transport Deck — Play/Pause is center-stage and unmistakable */}
        <div className={`editor-transport-deck ${playing ? 'is-playing' : ''}`} role="group" aria-label="Playback Transport">
          <div className="editor-transport-controls">
            <Tooltip title="Back to Start" description="Jump to 0:00">
              <button
                type="button"
                className="editor-transport-btn"
                onClick={handleReturnToZero}
                aria-label="Back to start"
              >
                <SkipBack size={12} />
              </button>
            </Tooltip>

            <Tooltip title={playing ? 'Pause (Space)' : 'Play (Space)'} description={playing ? 'Pause playback' : 'Play video and audio'}>
              <button
                type="button"
                className={`editor-transport-play-btn ${playing ? 'active' : ''}`}
                onClick={togglePlay}
                aria-label={playing ? 'Pause' : 'Play'}
              >
                {playing ? <Pause size={13} /> : <Play size={13} />}
                <span className="editor-transport-play-label">{playing ? 'PAUSE' : 'PLAY'}</span>
              </button>
            </Tooltip>

            <Tooltip title="Stop" description="Stop and return to start">
              <button type="button" className="editor-transport-btn" onClick={handleStop} aria-label="Stop">
                <Square size={11} />
              </button>
            </Tooltip>

            <Tooltip title="Loop" description="Loop playback">
              <button
                type="button"
                className={`editor-transport-btn ${loop ? 'active' : ''}`}
                onClick={handleToggleLoop}
                aria-label="Toggle loop"
                aria-pressed={loop}
              >
                <Repeat size={12} />
              </button>
            </Tooltip>
          </div>

          <div className={`editor-header-time ${playing ? 'playing' : ''}`} aria-label="Playback time">
            <span className="editor-header-time-current">{formatClock(displayTime)}</span>
            <span className="editor-header-time-sep">/</span>
            <span className="editor-header-time-total">{formatClock(durationSec)}</span>
          </div>
        </div>

        <div className="editor-header-actions">
          <Session />
          <AccountChip />
        </div>
      </header>

      {/* Main 2-Column NLE Studio Shell */}
      {loadError ? (
        <div className="video-center-state">
          <span className="video-error-text">{loadError}</span>
          <Button variant="ghost" size="sm" onClick={onBack}>
            Return to Workspace
          </Button>
        </div>
      ) : (
        <div className="video-body">
          {/* LEFT WORKSPACE: Unified Toolbar + Player or Storyboard */}
          <main className="video-main">
            {/* Compact Mode & Render Toolbar — single unified home for project actions */}
            <div className="video-toolbar" role="toolbar" aria-label="Workspace Controls">
              <div className="video-view-tabs" role="tablist" aria-label="Canvas View">
                <button
                  type="button"
                  role="tab"
                  id={`${baseId}-tab-player`}
                  aria-selected={centerView === 'player'}
                  className="video-view-tab"
                  onClick={() => setCenterView('player')}
                >
                  <Film size={13} aria-hidden="true" />
                  <span>Player</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  id={`${baseId}-tab-storyboard`}
                  aria-selected={centerView === 'storyboard'}
                  className="video-view-tab"
                  onClick={() => setCenterView('storyboard')}
                >
                  <Layers size={13} aria-hidden="true" />
                  <span>Storyboard{hasPlan ? ` (${sections.length})` : ''}</span>
                </button>
              </div>

              <div className="video-toolbar-right" role="group" aria-label="Output & Actions">
                <div className="video-quality-group" role="group" aria-label="Video Quality">
                  {QUALITIES.map((q) => (
                    <button
                      key={q.value}
                      type="button"
                      className="video-seg-btn"
                      aria-pressed={(wip?.quality ?? '720p') === q.value}
                      disabled={isAssembling}
                      onClick={() => void handleQualityChange(q.value)}
                    >
                      {q.label}
                    </button>
                  ))}
                </div>

                {!hasPlan ? (
                  <>
                    {isPlanningFresh ? (
                      <Tooltip title="Stop Planning" description="Cancel storyboard planning">
                        <button
                          type="button"
                          className="video-stop-btn"
                          onClick={() => void handleStopPipeline()}
                          aria-label="Stop planning"
                        >
                          <Square size={12} aria-hidden="true" />
                          <span className="video-btn-label">Stop</span>
                        </button>
                      </Tooltip>
                    ) : (
                      <Tooltip
                        title="Plan Storyboard"
                        description="Generate beat-locked scenes and opening sketches across every section"
                      >
                        <button
                          type="button"
                          className="video-primary-btn"
                          onClick={() => void handlePlanSubmit()}
                          aria-label="Plan Storyboard"
                        >
                          <Sparkles size={13} aria-hidden="true" />
                          <span className="video-btn-label">Plan</span>
                        </button>
                      </Tooltip>
                    )}
                    {downloadableUrl && (
                      <Tooltip title="Download MP4" description="Download saved video with audio">
                        <button
                          type="button"
                          className="video-icon-btn video-download-btn"
                          disabled={downloadingKey !== null}
                          onClick={() => void handleDownload()}
                          aria-label="Download MP4"
                        >
                          {downloadingKey === 'master' ? <Loader2 size={13} className="video-spin" /> : <Download size={13} />}
                        </button>
                      </Tooltip>
                    )}
                  </>
                ) : (
                  <>
                    {unsketchedCount > 0 && (
                      <Tooltip
                        title={`Sketch All (${unsketchedCount})`}
                        description="Generate opening sketches for all unsketched shots"
                      >
                        <button
                          type="button"
                          className="video-mini-btn video-sketch-all-btn"
                          disabled={isSketchingAll}
                          onClick={() => void handleSketchSection(undefined)}
                          aria-label={`Sketch all ${unsketchedCount} missing frames`}
                        >
                          {isSketchingAll ? (
                            <Loader2 size={13} className="video-spin" />
                          ) : (
                            <ImageIcon size={13} aria-hidden="true" />
                          )}
                          <span className="video-btn-label">Sketch</span>
                          <span className="video-btn-count">{unsketchedCount}</span>
                        </button>
                      </Tooltip>
                    )}

                    <Tooltip
                      title={
                        readyCount === 0
                          ? 'Render Clips'
                          : remainingRenderCount > 0
                            ? `Render Left (${remainingRenderCount})`
                            : 'Re-render Clips'
                      }
                      description="Render unlocked shots at selected quality"
                    >
                      <button
                        type="button"
                        className={readyCount > 0 && remainingRenderCount === 0 ? 'video-mini-btn' : 'video-primary-btn'}
                        disabled={isPlanningFresh || isAssembling}
                        onClick={() => void handleRender({ onlyUnrendered: readyCount > 0 && remainingRenderCount > 0 })}
                        aria-label={
                          readyCount === 0
                            ? 'Render Clips'
                            : remainingRenderCount > 0
                              ? `Render Left (${remainingRenderCount})`
                              : 'Re-render Clips'
                        }
                      >
                        <Clapperboard size={13} aria-hidden="true" />
                        <span className="video-btn-label">
                          {readyCount === 0 ? 'Render' : remainingRenderCount > 0 ? 'Render' : 'Re-render'}
                        </span>
                        {remainingRenderCount > 0 && (
                          <span className="video-btn-count">{remainingRenderCount}</span>
                        )}
                      </button>
                    </Tooltip>

                    {readyCount > 0 && (
                      <Tooltip
                        title={hasAssembledMaster ? 'Re-assemble Master' : 'Assemble Master'}
                        description="Mount rendered clips into final music video"
                      >
                        <button
                          type="button"
                          className={!hasAssembledMaster || isAssemblyStale ? 'video-primary-btn' : 'video-mini-btn'}
                          disabled={isAssembling}
                          onClick={() => openUpscaleDialog('assemble')}
                          aria-label={hasAssembledMaster ? 'Re-assemble Master' : 'Assemble Master'}
                        >
                          {isAssembling ? <Loader2 size={13} className="video-spin" /> : <Film size={13} aria-hidden="true" />}
                          <span className="video-btn-label">{hasAssembledMaster ? 'Re-assemble' : 'Assemble'}</span>
                        </button>
                      </Tooltip>
                    )}

                    {hasAssembledMaster && (
                      <Tooltip title="Save to Song" description="Attach assembled video to this song">
                        <button
                          type="button"
                          className="video-save-btn"
                          disabled={busySaving || isAssembling}
                          onClick={() => openUpscaleDialog('save')}
                          aria-label="Save video to song"
                        >
                          {busySaving ? <Loader2 size={13} className="video-spin" /> : <Save size={13} />}
                          <span className="video-btn-label">Save</span>
                        </button>
                      </Tooltip>
                    )}

                    {runningOpsCount > 0 && (
                      <Tooltip
                        title={runningOpsCount > 1 ? `Stop All (${runningOpsCount})` : 'Stop Active Task'}
                        description="Cancel all running operations"
                      >
                        <button
                          type="button"
                          className="video-stop-btn"
                          onClick={() => void handleStopPipeline()}
                          aria-label="Stop running tasks"
                        >
                          <Square size={11} aria-hidden="true" />
                          <span className="video-btn-label">Stop</span>
                          {runningOpsCount > 1 && <span className="video-btn-count">{runningOpsCount}</span>}
                        </button>
                      </Tooltip>
                    )}

                    {downloadableUrl && (
                      <Tooltip title="Download MP4" description="Download assembled video with master audio">
                        <button
                          type="button"
                          className="video-icon-btn video-download-btn"
                          disabled={downloadingKey !== null}
                          onClick={() => void handleDownload()}
                          aria-label="Download MP4"
                        >
                          {downloadingKey === 'master' ? <Loader2 size={13} className="video-spin" /> : <Download size={13} />}
                        </button>
                      </Tooltip>
                    )}

                    <Tooltip title="Discard Draft" description="Clear storyboard and start fresh">
                      <button
                        type="button"
                        className="video-icon-btn"
                        disabled={busySaving}
                        onClick={() => void handleDiscard()}
                        aria-label="Discard draft"
                      >
                        <Trash2 size={13} />
                      </button>
                    </Tooltip>
                  </>
                )}
              </div>
            </div>

            {/* VIEW A: PURE CINEMA PLAYER + FULL-SONG ALL-SCENES MICRO-BALL RAIL + ACTIVE FILMSTRIP */}
            {centerView === 'player' && (
              <div className="video-player-view" role="tabpanel" aria-labelledby={`${baseId}-tab-player`}>
                {/* Unobstructed 16:9 Stage with Double-Buffered Progressive Multi-Shot Playback */}
                <div className="video-stage-shell">
                  <div
                    className="video-stage-media"
                    onClick={togglePlay}
                    role="button"
                    tabIndex={0}
                    aria-label={playing ? 'Pause video' : 'Play video'}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        togglePlay();
                      }
                    }}
                  >
                    {stageShot?.startFrame?.url ? (
                      <img
                        src={stageShot.startFrame.url}
                        alt={stageShot.prompt || 'Opening sketch'}
                        className="video-player-backdrop"
                      />
                    ) : (
                      <div className="video-stage-empty">
                        <img
                          src={song.image || '/favicon.svg'}
                          alt={song.title}
                          className="video-stage-cover"
                        />
                        {!hasPlan && !isPlanning && (
                          <div className="video-stage-cta">
                            <span className="video-stage-cta-title">{song.title}</span>
                            <span className="video-stage-cta-sub">
                              {score ? `${score.bpm} BPM · ${score.sections.length} sections ready` : 'Ready'}
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Double-Buffered Video Slots (Zero-Flicker Progressive Playback, Zero Overlays) */}
                    <video
                      ref={slotARef}
                      playsInline
                      muted
                      preload="auto"
                      data-active="false"
                      className="video-player-slot"
                    />
                    <video
                      ref={slotBRef}
                      playsInline
                      muted
                      preload="auto"
                      data-active="false"
                      className="video-player-slot"
                    />
                  </div>

                  {/* Clean Attached Bottom Player Bar */}
                  <div className="video-player-bar">
                    <div className="video-player-bar-left">
                      {(readyCount > 0 || masterVideoUrl) && selectedShot?.clipUrl && (
                        <div className="video-source-toggle" role="group" aria-label="Playback Source">
                          <Tooltip
                            title={allShotsReady && masterVideoUrl ? 'Full Video' : 'Live Preview'}
                            description="Play assembled music video"
                          >
                            <button
                              type="button"
                              className="video-seg-btn"
                              aria-pressed={stageView === 'full'}
                              onClick={() => setStageView('full')}
                            >
                              <Layers size={11} aria-hidden="true" />
                              <span>{allShotsReady && masterVideoUrl ? 'Full' : 'Mix'}</span>
                            </button>
                          </Tooltip>
                          <Tooltip
                            title={`Shot ${String(selectedShot.index + 1).padStart(2, '0')}`}
                            description="Preview selected shot only"
                          >
                            <button
                              type="button"
                              className="video-seg-btn"
                              aria-pressed={stageView === 'shot'}
                              onClick={() => {
                                setStageView('shot');
                                seekTo(selectedShot.startSec);
                              }}
                            >
                              <Clapperboard size={11} aria-hidden="true" />
                              <span>#{String(selectedShot.index + 1).padStart(2, '0')}</span>
                            </button>
                          </Tooltip>
                        </div>
                      )}

                      {stageShot && (
                        <div className="video-player-meta">
                          <span
                            className={`video-micro-ball is-${stageShot.clipUrl && stageShot.status === 'draft' ? 'ready' : stageShot.status}`}
                            aria-hidden="true"
                          />
                          <span className="video-shot-code">
                            {stageSection?.label ?? 'Section'} · Shot {String(stageShot.index + 1).padStart(2, '0')}
                          </span>
                          <span className="video-shot-span">
                            {formatClock(stageShot.startSec)}–{formatClock(stageShot.endSec)}
                          </span>
                          {stageShot.lipSync && (
                            <span className="video-sync-chip">
                              <Mic size={10} /> SYNC
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="video-player-bar-right">
                      {failedCount > 0 && (
                        <Tooltip title={`Retry Failed (${failedCount})`} description="Re-render failed shots">
                          <button
                            type="button"
                            className="video-mini-btn video-retry-btn"
                            onClick={() => void handleRender({ onlyUnrendered: true })}
                            aria-label={`Retry ${failedCount} failed shots`}
                          >
                            <RefreshCw size={12} />
                            <span className="video-btn-label">Retry</span>
                            <span className="video-btn-count">{failedCount}</span>
                          </button>
                        </Tooltip>
                      )}
                      {stageShot?.clipUrl && railTab !== 'shot' && (
                        <Tooltip
                          title={`Download Shot ${String(stageShot.index + 1).padStart(2, '0')}`}
                          description="Download this shot's rendered MP4 clip"
                        >
                          <button
                            type="button"
                            className="video-icon-btn"
                            disabled={downloadingKey !== null}
                            onClick={() => void handleDownloadShot(stageShot)}
                            aria-label={`Download Shot ${String(stageShot.index + 1).padStart(2, '0')} MP4`}
                          >
                            {downloadingKey === stageShot.id ? (
                              <Loader2 size={12} className="video-spin" />
                            ) : (
                              <Download size={12} />
                            )}
                          </button>
                        </Tooltip>
                      )}
                      {selectedShot && (
                        <Tooltip title="Edit Shot" description="Open shot inspector">
                          <button
                            type="button"
                            className="video-mini-btn"
                            onClick={() => {
                              setRailTab('shot');
                              setMobilePane('shot');
                            }}
                            aria-label="Edit selected shot"
                          >
                            <Sliders size={12} />
                            <span className="video-btn-label">Edit</span>
                          </button>
                        </Tooltip>
                      )}
                      <Tooltip title="Expand Fullscreen" description="Open cinema viewer">
                        <button
                          type="button"
                          className="video-mini-btn video-expand-btn"
                          disabled={!hasExpandableVisual}
                          onClick={() => setCinemaOpen(true)}
                          aria-label="Expand video fullscreen"
                        >
                          <Maximize2 size={12} />
                          <span className="video-btn-label">Expand</span>
                        </button>
                      </Tooltip>
                    </div>
                  </div>
                </div>

                {/* 4-Track Synchronized DAW Timeline: Sections + Waveform + All-Scenes Micro-Ball Rail + Active Section Filmstrip */}
                <section className="video-timeline" aria-label="Song Timeline">
                  {/* Track 1: Clickable Song Sections with Section Status Micro-Balls */}
                  <div className="video-track-sections">
                    {(hasPlan ? sections : score?.sections ?? []).map((sec) => {
                      const pct = durationSec > 0 ? ((sec.endSec - sec.startSec) / durationSec) * 100 : 12.5;
                      const active = selectedSection?.id === sec.id;
                      const justDone = completedSectionIds.includes(sec.id);
                      const secStatus = hasPlan ? sectionVisualStatus(sec as Section) : 'draft';
                      return (
                        <button
                          key={sec.id}
                          type="button"
                          className={`video-sec-tab ${active ? 'is-active' : ''} ${justDone ? 'is-done' : ''}`}
                          style={{ width: `${pct}%` }}
                          onClick={() => {
                            if (hasPlan) {
                              selectSection(sec as Section, true);
                            } else {
                              seekTo(sec.startSec);
                            }
                          }}
                          title={`${sec.label} (${formatTime(sec.startSec)}–${formatTime(sec.endSec)})`}
                        >
                          {hasPlan && <span className={`video-sec-ball is-${secStatus}`} aria-hidden="true" />}
                          <span className="video-sec-tab-full">{sec.label}</span>
                          <span className="video-sec-tab-short" aria-hidden="true">
                            {shortSectionCode(sec.label)}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Track 2: Master Waveform + Energy Shifts + Playhead */}
                  <div
                    ref={timelineRef}
                    className="video-wave-track"
                    onPointerDown={(e) => handleTimelinePointer(e, timelineRef)}
                  >
                    <Waveform
                      audioUrl={song.url}
                      height={46}
                      interactive={false}
                      showSelection={false}
                      className="video-wave-canvas"
                    />
                    {score && durationSec > 0 && (
                      <div className="video-markers" aria-hidden="true">
                        {(score.segments ?? []).filter((t) => t > 0).map((segT, i) => (
                          <span
                            key={`seg-${i}`}
                            className="video-shift-line is-drop"
                            style={{ left: `${(segT / durationSec) * 100}%` }}
                          />
                        ))}
                      </div>
                    )}
                    <div ref={playheadRef} className="video-playhead" aria-hidden="true" />
                  </div>

                  {/* Track 3 (RESTORED): Full-Song All-Scenes Rail with Glowing Green / Yellow / Red Micro-Balls */}
                  {hasPlan && shots.length > 0 && durationSec > 0 && (
                    <div className="video-all-shots-rail" role="group" aria-label="All Song Scenes">
                      {shots.map((shot) => {
                        const pct = Math.max(0.6, ((shot.endSec - shot.startSec) / durationSec) * 100);
                        const isPlayingHere = playing && stageView === 'full' && deckVisual.activeShotId === shot.id;
                        const isSelectedHere = selectedShot?.id === shot.id;
                        const visualStatus = shot.status === 'draft' && shot.clipUrl ? 'ready' : shot.status;
                        return (
                            <button
                              key={shot.id}
                              type="button"
                              className={`video-rail-shot is-${visualStatus} ${shot.approved ? 'is-approved' : ''} ${shot.startFrame?.url ? 'has-sketch' : ''} ${isSelectedHere ? 'is-selected' : ''} ${isPlayingHere ? 'is-playing' : ''}`}
                              style={{ width: `${pct}%` }}
                              onClick={() => {
                                selectShot(shot);
                                if (stageView === 'shot') setStageView('full');
                              }}
                              title={shot.approved ? `${shotStatusTitle(shot)} · Locked` : shotStatusTitle(shot)}
                              aria-label={shot.approved ? `${shotStatusTitle(shot)} · Locked` : shotStatusTitle(shot)}
                            >
                              <span className={`video-micro-ball is-${visualStatus}`} aria-hidden="true" />
                              <span className="video-rail-shot-num">{String(shot.index + 1).padStart(2, '0')}</span>
                            </button>
                        );
                      })}
                      <div ref={railPlayheadRef} className="video-playhead" aria-hidden="true" />
                    </div>
                  )}

                  {/* Track 4: Active Section Filmstrip (Paginated so any Director shot count fits with ZERO scroll) */}
                  {hasPlan && selectedSection ? (
                    <div className="video-filmstrip-wrap">
                      <div className="video-filmstrip-head">
                        <div className="video-filmstrip-title">
                          <strong>{selectedSection.label}</strong>
                          <span className="video-dim">
                            {formatTime(selectedSection.startSec)}–{formatTime(selectedSection.endSec)}
                          </span>
                          {sectionTagBadge(selectedSection.label, selectedSection.tags) && (
                            <span className="video-tag-chip">
                              [{sectionTagBadge(selectedSection.label, selectedSection.tags)}]
                            </span>
                          )}
                          {filmstripPageCount > 1 && (
                            <div className="video-pager">
                              <button
                                type="button"
                                className="video-icon-btn"
                                disabled={clampedFilmstripPage === 0}
                                onClick={() => setFilmstripPage(Math.max(0, clampedFilmstripPage - 1))}
                                aria-label="Previous section shots"
                              >
                                <ChevronLeft size={12} />
                              </button>
                              <span className="video-dim">
                                {clampedFilmstripPage + 1}/{filmstripPageCount}
                              </span>
                              <button
                                type="button"
                                className="video-icon-btn"
                                disabled={clampedFilmstripPage >= filmstripPageCount - 1}
                                onClick={() => setFilmstripPage(Math.min(filmstripPageCount - 1, clampedFilmstripPage + 1))}
                                aria-label="Next section shots"
                              >
                                <ChevronRight size={12} />
                              </button>
                            </div>
                          )}
                        </div>
                        <div className="video-filmstrip-actions">
                          {unsketchedInSection > 0 && (
                            <Tooltip
                              title={`Sketch Section (${unsketchedInSection})`}
                              description={`Generate opening frames for ${selectedSection.label}`}
                            >
                              <button
                                type="button"
                                className="video-mini-btn"
                                disabled={isSketchingAll}
                                onClick={() => void handleSketchSection(selectedSection.id)}
                                aria-label={`Sketch ${unsketchedInSection} shots in ${selectedSection.label}`}
                              >
                                <ImageIcon size={12} />
                                <span className="video-btn-label">Sketch</span>
                                <span className="video-btn-count">{unsketchedInSection}</span>
                              </button>
                            </Tooltip>
                          )}
                          <Tooltip
                            title={`Render ${selectedSection.label}`}
                            description="Render all unlocked shots in this section"
                          >
                            <button
                              type="button"
                              className="video-mini-btn"
                              disabled={isPlanningFresh}
                              onClick={() => void handleRender({ sectionId: selectedSection.id })}
                              aria-label={`Render ${selectedSection.label}`}
                            >
                              <Clapperboard size={12} />
                              <span className="video-btn-label">Render</span>
                            </button>
                          </Tooltip>
                          <Tooltip title="Storyboard View" description="Open section script & storyboard grid">
                            <button
                              type="button"
                              className="video-mini-btn"
                              onClick={() => setCenterView('storyboard')}
                              aria-label="Open storyboard view"
                            >
                              <Layers size={12} />
                              <span className="video-btn-label">Board</span>
                            </button>
                          </Tooltip>
                        </div>
                      </div>

                      <div
                        className="video-filmstrip-grid"
                        style={{ gridTemplateColumns: `repeat(${Math.max(1, pagedFilmstripShots.length)}, minmax(0, 1fr))` }}
                      >
                        {pagedFilmstripShots.map((shot) => {
                          const active = selectedShot?.id === shot.id;
                          const isPlayingHere = playing && stageView === 'full' && deckVisual.activeShotId === shot.id;
                          const isSketching = sketchingIds.includes(shot.id) || busyFrames.has(`${shot.id}:start`);
                          const visualStatus = shot.status === 'draft' && shot.clipUrl ? 'ready' : shot.status;
                          return (
                            <div
                              key={shot.id}
                              role="button"
                              tabIndex={0}
                              className={`video-strip-card ${active ? 'is-active' : ''} ${isPlayingHere ? 'is-playing' : ''} is-${visualStatus}`}
                              onClick={() => selectShot(shot)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  selectShot(shot);
                                }
                              }}
                              title={shotStatusTitle(shot)}
                            >
                              <div className="video-strip-thumb">
                                {shot.startFrame?.url ? (
                                  <img src={shot.startFrame.url} alt="" className="video-strip-img" />
                                ) : shot.clipUrl ? (
                                  <video
                                    src={`${shot.clipUrl}#t=0.5`}
                                    muted
                                    playsInline
                                    preload="metadata"
                                    className="video-strip-img"
                                  />
                                ) : isSketching ? (
                                  <div className="video-shimmer">
                                    <Loader2 size={14} className="video-spin" />
                                  </div>
                                ) : (
                                  <div className="video-strip-empty">
                                    <span>{String(shot.index + 1).padStart(2, '0')}</span>
                                  </div>
                                )}
                                <span className="video-strip-num">{String(shot.index + 1).padStart(2, '0')}</span>
                                <span className="video-strip-dur">{(shot.endSec - shot.startSec).toFixed(1)}s</span>
                                {shot.approved && (
                                  <span className="video-strip-lock" title="Locked shot">
                                    <Lock size={9} aria-hidden="true" />
                                  </span>
                                )}
                                {shot.lipSync && (
                                  <span className="video-strip-sync" title="Lip-synced vocals">
                                    <Mic size={10} aria-hidden="true" />
                                  </span>
                                )}
                                <span className={`video-strip-dot is-${visualStatus}`} aria-hidden="true" />
                                {visualStatus === 'failed' && !busyShotIds.has(shot.id) && (
                                  <button
                                    type="button"
                                    className="video-strip-retry"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void handleRender({ shotId: shot.id });
                                    }}
                                    title={shot.error || 'Retry failed shot'}
                                    aria-label={`Retry Shot ${String(shot.index + 1).padStart(2, '0')}`}
                                  >
                                    <RefreshCw size={10} />
                                  </button>
                                )}
                              </div>
                              <span className="video-strip-caption">
                                {visualStatus === 'failed' && shot.error ? shot.error : shot.prompt || 'Waiting for direction…'}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="video-idle-strip">
                      <span>Click Plan Storyboard above or describe a visual concept in the Director panel to map every section.</span>
                    </div>
                  )}
                </section>
              </div>
            )}

            {/* VIEW B: STORYBOARD — Readable Section-by-Section Scripts, Lyrics & Sketches */}
            {centerView === 'storyboard' && (
              <div className="video-storyboard-view" role="tabpanel" aria-labelledby={`${baseId}-tab-storyboard`}>
                {!hasPlan ? (
                  <div className="video-center-state">
                    <span>No storyboard yet.</span>
                    <button
                      type="button"
                      className="video-primary-btn"
                      disabled={isPlanningFresh}
                      onClick={() => void handlePlanSubmit()}
                    >
                      <Sparkles size={13} />
                      <span>Plan Storyboard</span>
                    </button>
                  </div>
                ) : (
                  <>
                    {/* Progressive-disclosure Visual World summary (<details> keeps workspace clean) */}
                    {wip?.plan?.bible.concept && (
                      <details className="video-world-disclosure">
                        <summary className="video-world-summary">
                          <span className="video-world-label">Visual World</span>
                          <span className="video-world-preview">{wip.plan.bible.concept}</span>
                        </summary>
                        <div className="video-world-grid">
                          <div><strong>Look:</strong> {wip.plan.bible.look}</div>
                          <div><strong>Palette:</strong> {wip.plan.bible.palette}</div>
                          <div><strong>Lens:</strong> {wip.plan.bible.lens}</div>
                          <div><strong>Lighting:</strong> {wip.plan.bible.lighting}</div>
                        </div>
                      </details>
                    )}

                    {/* Section Switcher Pills + Per-Section Actions */}
                    <div className="video-sb-head">
                      <div className="video-sb-sections" role="tablist" aria-label="Song Sections">
                        {sections.map((sec) => {
                          const active = selectedSection?.id === sec.id;
                          return (
                            <button
                              key={sec.id}
                              type="button"
                              role="tab"
                              aria-selected={active}
                              className="video-sb-sec-pill"
                              onClick={() => selectSection(sec, false)}
                            >
                              <span>{sec.label}</span>
                              <span className="video-sb-sec-count">{sectionUnsketchedOrReadyLabel(sec)}</span>
                            </button>
                          );
                        })}
                      </div>

                      {selectedSection && (
                        <div className="video-sb-actions">
                          {unsketchedInSection > 0 && (
                            <Tooltip
                              title={`Sketch Section (${unsketchedInSection})`}
                              description={`Sketch missing frames in ${selectedSection.label}`}
                            >
                              <button
                                type="button"
                                className="video-mini-btn"
                                disabled={isSketchingAll}
                                onClick={() => void handleSketchSection(selectedSection.id)}
                                aria-label={`Sketch ${unsketchedInSection} missing frames`}
                              >
                                <ImageIcon size={12} />
                                <span className="video-btn-label">Sketch</span>
                                <span className="video-btn-count">{unsketchedInSection}</span>
                              </button>
                            </Tooltip>
                          )}
                          <Tooltip
                            title={`Render ${selectedSection.label}`}
                            description="Render unlocked shots in this section"
                          >
                            <button
                              type="button"
                              className="video-mini-btn"
                              disabled={isPlanningFresh}
                              onClick={() => void handleRender({ sectionId: selectedSection.id })}
                              aria-label={`Render ${selectedSection.label}`}
                            >
                              <Clapperboard size={12} />
                              <span className="video-btn-label">Render</span>
                            </button>
                          </Tooltip>
                          <Tooltip
                            title={`Re-plan ${selectedSection.label}`}
                            description="Re-imagine shots for this section"
                          >
                            <button
                              type="button"
                              className="video-mini-btn"
                              disabled={isPlanning}
                              onClick={() =>
                                void handlePlanSubmit(
                                  `Re-imagine ${selectedSection.label} with fresh shots matching its music and tags.`,
                                  'section',
                                  selectedSection.id
                                )
                              }
                              aria-label={`Re-plan ${selectedSection.label}`}
                            >
                              <RefreshCw size={12} />
                              <span className="video-btn-label">Re-plan</span>
                            </button>
                          </Tooltip>
                        </div>
                      )}
                    </div>

                    {/* Section Note & Pagination (keeps zero internal vertical scrolling!) */}
                    {selectedSection && (
                      <div className="video-sb-subbar">
                        <span className="video-sb-note">
                          <strong>{selectedSection.label}</strong> · {formatTime(selectedSection.startSec)}–{formatTime(selectedSection.endSec)}
                          {selectedSection.notes ? ` — ${selectedSection.notes}` : ''}
                        </span>
                        {storyboardPageCount > 1 && (
                          <div className="video-pager">
                            <button
                              type="button"
                              className="video-icon-btn"
                              disabled={clampedStoryboardPage === 0}
                              onClick={() => setStoryboardPage(Math.max(0, clampedStoryboardPage - 1))}
                              aria-label="Previous shots"
                            >
                              <ChevronLeft size={13} />
                            </button>
                            <span className="video-dim">
                              {clampedStoryboardPage + 1}/{storyboardPageCount}
                            </span>
                            <button
                              type="button"
                              className="video-icon-btn"
                              disabled={clampedStoryboardPage >= storyboardPageCount - 1}
                              onClick={() => setStoryboardPage(Math.min(storyboardPageCount - 1, clampedStoryboardPage + 1))}
                              aria-label="Next shots"
                            >
                              <ChevronRight size={13} />
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Clean 3-Column Shot Card Grid — readable scripts, lyrics, lip-sync & sketches */}
                    <div className="video-sb-grid">
                      {pagedSectionShots.map((shot) => {
                        const active = selectedShot?.id === shot.id;
                        const isSketching = sketchingIds.includes(shot.id) || busyFrames.has(`${shot.id}:start`);
                        const isShotBusy = busyShotIds.has(shot.id);
                        const lyrics = shotLyricSummary(shot);
                        return (
                          <article
                            key={shot.id}
                            className={`video-sb-card ${active ? 'is-active' : ''}`}
                            onClick={() => selectShot(shot)}
                          >
                            <div className="video-sb-media">
                              {shot.clipUrl ? (
                                <video
                                  src={shot.startFrame?.url ? shot.clipUrl : `${shot.clipUrl}#t=0.5`}
                                  poster={shot.startFrame?.url}
                                  muted
                                  playsInline
                                  preload="metadata"
                                  className="video-sb-img"
                                />
                              ) : shot.startFrame?.url ? (
                                <img src={shot.startFrame.url} alt={shot.prompt} className="video-sb-img" />
                              ) : isSketching ? (
                                <div className="video-shimmer">
                                  <Loader2 size={16} className="video-spin" />
                                  <span>Sketching frame…</span>
                                </div>
                              ) : (
                                <div className="video-sb-placeholder">
                                  <button
                                    type="button"
                                    className="video-mini-btn"
                                    disabled={isSketching}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void handleGenerateFrame(shot, 'start', false);
                                    }}
                                  >
                                    <ImageIcon size={12} />
                                    <span>Sketch Frame</span>
                                  </button>
                                </div>
                              )}

                              <div className="video-sb-badges">
                                <span className="video-sb-id">SHOT {String(shot.index + 1).padStart(2, '0')}</span>
                                <span className="video-sb-time">
                                  {formatClock(shot.startSec)}–{formatClock(shot.endSec)}
                                </span>
                                {shot.lipSync && (
                                  <span className="video-sync-chip">
                                    <Mic size={10} /> SYNC
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="video-sb-body">
                              {lyrics && <p className="video-sb-lyrics">“{lyrics}”</p>}
                              <p className="video-sb-prompt">{shot.prompt || 'Direction pending…'}</p>
                              <div className="video-sb-meta-row">
                                <span className="video-sb-chip">{transitionLabel(shot.transition)}</span>
                                <span
                                  className={`video-sb-status is-${shot.status === 'draft' && shot.clipUrl ? 'ready' : shot.status}`}
                                  title={shot.error || undefined}
                                >
                                  <span
                                    className={`video-micro-ball is-${shot.status === 'draft' && shot.clipUrl ? 'ready' : shot.status}`}
                                    aria-hidden="true"
                                  />
                                  <span>
                                    {shot.status === 'failed'
                                      ? 'Failed'
                                      : shot.status === 'rendering' || shot.status === 'checking'
                                        ? 'Rendering'
                                        : shot.status === 'queued'
                                          ? 'Queued'
                                          : shot.clipUrl
                                            ? 'Ready'
                                            : shot.startFrame?.url
                                              ? 'Sketched'
                                              : 'Script'}
                                  </span>
                                </span>
                              </div>
                              <div className="video-sb-card-actions" onClick={(e) => e.stopPropagation()}>
                                <Tooltip title={shot.startFrame?.url ? 'Re-sketch Frame' : 'Sketch Frame'}>
                                  <button
                                    type="button"
                                    className="video-mini-btn"
                                    disabled={isSketching}
                                    onClick={() => void handleGenerateFrame(shot, 'start', false)}
                                    aria-label={shot.startFrame?.url ? 'Re-sketch Frame' : 'Sketch Frame'}
                                  >
                                    {isSketching ? <Loader2 size={11} className="video-spin" /> : <ImageIcon size={11} />}
                                    <span className="video-btn-label">{shot.startFrame?.url ? 'Redo' : 'Sketch'}</span>
                                  </button>
                                </Tooltip>
                                <Tooltip title="Edit Shot">
                                  <button
                                    type="button"
                                    className="video-mini-btn"
                                    onClick={() => selectShot(shot, true)}
                                    aria-label="Edit Shot"
                                  >
                                    <Sliders size={11} />
                                    <span className="video-btn-label">Edit</span>
                                  </button>
                                </Tooltip>
                                <Tooltip title={shot.clipUrl ? 'Re-render Shot' : 'Render Shot'}>
                                  <button
                                    type="button"
                                    className="video-mini-btn"
                                    disabled={isShotBusy}
                                    onClick={() => void handleRender({ shotId: shot.id })}
                                    aria-label={shot.clipUrl ? 'Re-render Shot' : 'Render Shot'}
                                  >
                                    {isShotBusy ? <Loader2 size={11} className="video-spin" /> : <Clapperboard size={11} />}
                                    <span className="video-btn-label">
                                      {isShotBusy ? (shot.status === 'queued' ? 'Queued' : 'Busy') : shot.clipUrl ? 'Redo' : 'Render'}
                                    </span>
                                  </button>
                                </Tooltip>
                              </div>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}
          </main>

          {/* RIGHT STUDIO RAIL: Director Chat & Activity | Edit Shot | References */}
          <aside className="video-rail" aria-label="Director & Shot Inspector">
            <div className="video-rail-tabs" role="tablist" aria-label="Studio Panels">
              <button
                type="button"
                role="tab"
                id={`${baseId}-rail-director`}
                aria-selected={railTab === 'director'}
                className="video-rail-tab"
                onClick={() => setRailTab('director')}
              >
                <Sparkles size={13} aria-hidden="true" />
                <span>Director</span>
              </button>
              <button
                type="button"
                role="tab"
                id={`${baseId}-rail-shot`}
                aria-selected={railTab === 'shot'}
                className="video-rail-tab"
                onClick={() => setRailTab('shot')}
              >
                <Sliders size={13} aria-hidden="true" />
                <span>Edit Shot</span>
              </button>
              <button
                type="button"
                role="tab"
                id={`${baseId}-rail-refs`}
                aria-selected={railTab === 'refs'}
                className="video-rail-tab"
                onClick={() => setRailTab('refs')}
              >
                <ImageIcon size={13} aria-hidden="true" />
                <span>Refs ({wip?.plan?.bible.assets.length ?? 0}/6)</span>
              </button>
            </div>

            {/* RAIL TAB 1: DIRECTOR (Live Transparent Progress + Chat) */}
            {railTab === 'director' && (
              <div className="video-rail-panel" role="tabpanel" aria-labelledby={`${baseId}-rail-director`}>
                {/* Live Concurrent Activity Queue Card — capped at 4 rows for zero scroll */}
                {(ops.length > 0 || steps.length > 0) && (
                  <div className={`video-activity-card ${hasRunningPipeline ? 'is-live' : ''}`}>
                    <div className="video-activity-head">
                      <span className="video-activity-title">
                        {hasRunningPipeline ? (
                          <>
                            <Loader2 size={12} className="video-spin" />
                            <span>
                              {runningOpsCount > 1 ? `${runningOpsCount} Tasks` : 'Working'} · {formatTime(elapsedSec)}
                            </span>
                          </>
                        ) : ops.some((o) => o.status === 'error') || steps.some((st) => st.status === 'error') ? (
                          <>
                            <X size={12} />
                            <span>
                              {ops.some((o) => o.detail === 'Stopped') ? 'Stopped' : 'Attention'}
                            </span>
                          </>
                        ) : (
                          <>
                            <Check size={12} />
                            <span>Completed</span>
                          </>
                        )}
                      </span>
                      {hasRunningPipeline ? (
                        <button
                          type="button"
                          className="video-stop-btn"
                          onClick={() => void handleStopPipeline()}
                        >
                          <Square size={11} />
                          <span>{runningOpsCount > 1 ? 'Stop all' : 'Stop'}</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="video-clear-btn"
                          onClick={() => {
                            setOps([]);
                            setSteps([]);
                            setThoughtStream('');
                          }}
                          aria-label="Dismiss activity log"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>

                    {ops.length > 0 && !(ops.length === 1 && (ops[0].type === 'plan' || ops[0].type === 'assemble') && steps.length > 0) ? (
                      <ul className="video-step-list">
                        {ops.slice(0, 4).map((op) => (
                          <li key={op.id} className={`video-step-row is-${op.status}`}>
                            {op.status === 'running' ? (
                              <Loader2 size={11} className="video-spin" />
                            ) : op.status === 'done' ? (
                              <Check size={11} />
                            ) : (
                              <X size={11} />
                            )}
                            <span className="video-step-label">{op.label}</span>
                            {op.detail && <span className="video-step-detail">{op.detail}</span>}
                            {op.status === 'running' && (
                              <button
                                type="button"
                                className="video-op-cancel"
                                onClick={() => void handleCancelOp(op)}
                                title={`Stop ${op.label}`}
                                aria-label={`Stop ${op.label}`}
                              >
                                <X size={10} />
                              </button>
                            )}
                          </li>
                        ))}
                        {ops.length > 4 && (
                          <li className="video-step-row video-step-overflow">
                            <span>+{ops.length - 4} more in queue</span>
                          </li>
                        )}
                      </ul>
                    ) : (
                      <ul className="video-step-list">
                        {steps.slice(0, 4).map((st) => (
                          <li key={st.id} className={`video-step-row is-${st.status}`}>
                            {st.status === 'running' ? (
                              <Loader2 size={11} className="video-spin" />
                            ) : st.status === 'done' ? (
                              <Check size={11} />
                            ) : (
                              <X size={11} />
                            )}
                            <span className="video-step-label">{st.label}</span>
                            {st.detail && <span className="video-step-detail">{st.detail}</span>}
                          </li>
                        ))}
                      </ul>
                    )}

                    {isPlanning && sections.length > 0 && (
                      <div className="video-sec-pills-live">
                        {sections.map((sec) => {
                          const done = completedSectionIds.includes(sec.id) || sec.shots.some((sh) => Boolean(sh.prompt));
                          return (
                            <span key={sec.id} className={`video-sec-live-pill ${done ? 'is-done' : ''}`}>
                              {sec.label}
                            </span>
                          );
                        })}
                      </div>
                    )}

                    {thoughtStream && (
                      <details className="video-thought-box">
                        <summary>Director notes</summary>
                        <p>{thoughtStream}</p>
                      </details>
                    )}
                  </div>
                )}

                {/* Editor EDL Summary Card (shown once master video has been mounted) */}
                {wip?.edl?.summary && !hasRunningPipeline && (
                  <div className={`video-edl-card ${isAssemblyStale ? 'is-stale' : ''}`}>
                    <div className="video-edl-head">
                      <span className="video-edl-badge">
                        <Film size={11} aria-hidden="true" />
                        <span>Producer · Cut #{wip.edl.rev}</span>
                      </span>
                      {isAssemblyStale && <span className="video-edl-stale">Changes pending</span>}
                    </div>
                    <p className="video-edl-summary">{cleanMessage(wip.edl.summary)}</p>
                  </div>
                )}

                {/* Clean Chat History */}
                <div className="video-chat-body">
                  {hiddenMessageCount > 0 && (
                    <button
                      type="button"
                      className="video-earlier-btn"
                      onClick={() => setShowAllMessages(true)}
                    >
                      Show {hiddenMessageCount} earlier messages
                    </button>
                  )}

                  {visibleMessages.length === 0 ? (
                    <div className="video-chat-empty">
                      <strong>Direct your music video</strong>
                      <p>
                        Describe a visual concept, mood, or story below — or click Plan Storyboard to pitch beat-locked scenes and opening sketches across every section.
                      </p>
                    </div>
                  ) : (
                    visibleMessages.map((m) => (
                      <div key={m.id} className={`video-msg is-${m.role}`}>
                        <span className="video-msg-role">{m.role === 'user' ? 'You' : 'Director'}</span>
                        <p className="video-msg-text">{cleanMessage(m.text)}</p>
                      </div>
                    ))
                  )}
                </div>

                {/* Unmistakable Chat Composer */}
                <form
                  className="video-chat-composer"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const fd = new FormData(e.currentTarget);
                    const raw = String(fd.get('direction') ?? chatInput);
                    void handlePlanSubmit(raw);
                  }}
                >
                  {hasPlan && (
                    <div className="video-scope-row" role="group" aria-label="Chat Target">
                      <span className="video-scope-label">Target:</span>
                      <button
                        type="button"
                        className="video-seg-btn"
                        aria-pressed={scope === 'song'}
                        onClick={() => setScope('song')}
                      >
                        Whole Song
                      </button>
                      {selectedSection && (
                        <button
                          type="button"
                          className="video-seg-btn"
                          aria-pressed={scope === 'section'}
                          onClick={() => setScope('section')}
                        >
                          {selectedSection.label}
                        </button>
                      )}
                      {selectedShot && (
                        <button
                          type="button"
                          className="video-seg-btn"
                          aria-pressed={scope === 'shot'}
                          onClick={() => setScope('shot')}
                        >
                          Shot {String(selectedShot.index + 1).padStart(2, '0')}
                        </button>
                      )}
                    </div>
                  )}

                  <div className="video-composer-row">
                    <textarea
                      name="direction"
                      rows={2}
                      className="video-textarea"
                      value={chatInput}
                      disabled={isPlanningFresh}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                          void handlePlanSubmit(e.currentTarget.value);
                        }
                      }}
                      placeholder={
                        hasPlan
                          ? `Chat with Director about ${
                              scope === 'shot' && selectedShot
                                ? `Shot ${String(selectedShot.index + 1).padStart(2, '0')}`
                                : scope === 'section' && selectedSection
                                  ? selectedSection.label
                                  : 'this song'
                            }…`
                          : 'Describe a style, setting, or story (optional)…'
                      }
                    />
                    <button
                      type="submit"
                      className="video-send-btn"
                      disabled={isPlanningFresh}
                      aria-label={hasPlan ? 'Send message to Director' : 'Plan Storyboard'}
                    >
                      {isPlanning ? (
                        <Loader2 size={14} className="video-spin" />
                      ) : hasPlan ? (
                        <Send size={14} />
                      ) : (
                        <Sparkles size={14} />
                      )}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* RAIL TAB 2: EDIT SHOT (Plain-English Single-Shot Editor + Lip-Sync) */}
            {railTab === 'shot' && (
              <div className="video-rail-panel" role="tabpanel" aria-labelledby={`${baseId}-rail-shot`}>
                {selectedShot ? (
                  <div className="video-inspector">
                    <div className="video-inspector-head">
                      <div className="video-inspector-title">
                        <strong className="video-shot-code">
                          Shot {String(selectedShot.index + 1).padStart(2, '0')}
                        </strong>
                        <span className="video-dim">
                          {' '}· {(selectedShot.endSec - selectedShot.startSec).toFixed(2)}s
                        </span>
                      </div>
                      <div className="video-inspector-actions">
                        <Tooltip
                          title={selectedShot.approved ? 'Unlock Shot' : 'Lock Shot'}
                          description={
                            selectedShot.approved
                              ? 'Allow batch renders and Producer to modify this shot'
                              : 'Keep this shot intact during batch renders and assembly'
                          }
                        >
                          <button
                            type="button"
                            className={`video-icon-btn video-lock-btn ${selectedShot.approved ? 'is-locked' : ''}`}
                            aria-pressed={Boolean(selectedShot.approved)}
                            aria-label={selectedShot.approved ? 'Unlock shot' : 'Lock shot'}
                            onClick={() =>
                              void handleShotPatch(selectedShot.id, { approved: !selectedShot.approved })
                            }
                          >
                            {selectedShot.approved ? <Lock size={11} /> : <Unlock size={11} />}
                          </button>
                        </Tooltip>
                        <Tooltip title="Split at Playhead (S)" description="Split this shot at playhead or midpoint">
                          <button
                            type="button"
                            className="video-icon-btn"
                            disabled={busyShotIds.has(selectedShot.id) || selectedShot.endSec - selectedShot.startSec < 1.7}
                            onClick={() => handleSplitShot(selectedShot)}
                            aria-label="Split shot at playhead"
                          >
                            <Scissors size={11} />
                          </button>
                        </Tooltip>
                        {(() => {
                          const pos = sectionShots.findIndex((s) => s.id === selectedShot.id);
                          const nextInSec = pos >= 0 ? sectionShots[pos + 1] : undefined;
                          const canMerge = Boolean(
                            nextInSec &&
                              !busyShotIds.has(nextInSec.id) &&
                              nextInSec.endSec - selectedShot.startSec <= 15.0
                          );
                          return (
                            <>
                              <Tooltip title="Merge Next" description="Merge with the next shot in this section">
                                <button
                                  type="button"
                                  className="video-icon-btn"
                                  disabled={busyShotIds.has(selectedShot.id) || !canMerge}
                                  onClick={() => void handleShotPatch(selectedShot.id, { mergeWithNext: true })}
                                  aria-label="Merge with next shot"
                                >
                                  <Merge size={11} />
                                </button>
                              </Tooltip>
                              <Tooltip title="Delete Shot" description="Remove shot and extend adjacent shot">
                                <button
                                  type="button"
                                  className="video-icon-btn"
                                  disabled={busyShotIds.has(selectedShot.id) || sectionShots.length <= 1}
                                  onClick={() => void handleShotPatch(selectedShot.id, { delete: true })}
                                  aria-label="Delete shot"
                                >
                                  <Trash2 size={11} />
                                </button>
                              </Tooltip>
                            </>
                          );
                        })()}
                        {selectedShot.clipUrl && (
                          <Tooltip
                            title={`Download Shot ${String(selectedShot.index + 1).padStart(2, '0')}`}
                            description="Download active take as MP4"
                          >
                            <button
                              type="button"
                              className="video-icon-btn"
                              disabled={downloadingKey !== null}
                              onClick={() => void handleDownloadShot(selectedShot)}
                              aria-label={`Download Shot ${String(selectedShot.index + 1).padStart(2, '0')} MP4`}
                            >
                              {downloadingKey === selectedShot.id ? (
                                <Loader2 size={11} className="video-spin" />
                              ) : (
                                <Download size={11} />
                              )}
                            </button>
                          </Tooltip>
                        )}
                        <Tooltip
                          title={selectedShot.clipUrl ? 'Redo Shot' : 'Render Shot'}
                          description="Render this shot clip"
                        >
                          <button
                            type="button"
                            className="video-mini-btn"
                            disabled={busyShotIds.has(selectedShot.id)}
                            onClick={() => void handleRender({ shotId: selectedShot.id })}
                            aria-label={selectedShot.clipUrl ? 'Redo shot' : 'Render shot'}
                          >
                            {busyShotIds.has(selectedShot.id) ? (
                              <Loader2 size={11} className="video-spin" />
                            ) : (
                              <Clapperboard size={11} aria-hidden="true" />
                            )}
                            <span className="video-btn-label">
                              {busyShotIds.has(selectedShot.id)
                                ? selectedShot.status === 'queued'
                                  ? 'Queued'
                                  : 'Rendering'
                                : selectedShot.clipUrl
                                  ? 'Redo'
                                  : 'Render'}
                            </span>
                          </button>
                        </Tooltip>
                      </div>
                    </div>

                    {/* Zero-Scroll 4-Tab Shot Inspector (Frames | Prompt | Timing | Edit) */}
                    <div className="video-shot-subtabs" role="tablist" aria-label="Shot inspector sections">
                      <Tooltip title="Frames & Refs" description="Start/end keyframes and attached references">
                        <button
                          type="button"
                          role="tab"
                          className="video-shot-subtab"
                          aria-selected={shotTab === 'frames'}
                          onClick={() => setShotTab('frames')}
                          aria-label="Frames"
                        >
                          <ImageIcon size={12} aria-hidden="true" />
                          <span className="video-shot-subtab-label">Frames</span>
                        </button>
                      </Tooltip>
                      <Tooltip title="Prompt & Motion" description="Scene, camera, motion, and lip-sync cues">
                        <button
                          type="button"
                          role="tab"
                          className="video-shot-subtab"
                          aria-selected={shotTab === 'prompt'}
                          onClick={() => setShotTab('prompt')}
                          aria-label="Prompt"
                        >
                          <AlignLeft size={12} aria-hidden="true" />
                          <span className="video-shot-subtab-label">Prompt</span>
                        </button>
                      </Tooltip>
                      <Tooltip title="Timing & Cut" description="Takes, trim-in, lip-sync nudge, transition & beat">
                        <button
                          type="button"
                          role="tab"
                          className="video-shot-subtab"
                          aria-selected={shotTab === 'timing'}
                          onClick={() => setShotTab('timing')}
                          aria-label="Timing"
                        >
                          <Sliders size={12} aria-hidden="true" />
                          <span className="video-shot-subtab-label">Timing</span>
                        </button>
                      </Tooltip>
                      <Tooltip title="Clip Edit" description="Restyle, relight, or retake rendered clip">
                        <button
                          type="button"
                          role="tab"
                          className="video-shot-subtab"
                          aria-selected={shotTab === 'edit'}
                          onClick={() => setShotTab('edit')}
                          aria-label="Edit"
                        >
                          <Wand2 size={12} aria-hidden="true" />
                          <span className="video-shot-subtab-label">Edit</span>
                        </button>
                      </Tooltip>
                    </div>

                    {selectedShot.status === 'failed' && selectedShot.error && (
                      <div className="video-shot-error-box">
                        <span className="video-shot-error-msg">{selectedShot.error}</span>
                        <button
                          type="button"
                          className="video-mini-btn video-retry-btn"
                          disabled={busyShotIds.has(selectedShot.id)}
                          onClick={() => void handleRender({ shotId: selectedShot.id })}
                        >
                          <RefreshCw size={11} />
                          <span>Retry</span>
                        </button>
                      </div>
                    )}

                    {/* SUBTAB 1: FRAMES & ATTACHED REFS */}
                    {shotTab === 'frames' && (
                      <div className="video-shot-pane">
                        <div className="video-frames-row">
                          {(['start', 'end'] as const).map((slot) => {
                            const frame = slot === 'start' ? selectedShot.startFrame : selectedShot.endFrame;
                            const slotKey = `${selectedShot.id}:${slot}`;
                            const busy = busyFrames.has(slotKey) || (slot === 'start' && sketchingIds.includes(selectedShot.id));
                            return (
                              <div key={slot} className="video-frame-card">
                                <div className="video-frame-box">
                                  {frame?.url ? (
                                    <img src={frame.url} alt={`${slot} keyframe`} className="video-frame-img" />
                                  ) : (
                                    <span className="video-frame-empty">
                                      {slot === 'start' ? 'Start' : 'End'}
                                    </span>
                                  )}
                                </div>
                                <div className="video-frame-btns">
                                  <Tooltip title={frame ? `Redo ${slot}` : `Sketch ${slot}`} description="Generate keyframe image">
                                    <button
                                      type="button"
                                      className="video-mini-btn"
                                      disabled={busy}
                                      onClick={() => void handleGenerateFrame(selectedShot, slot, false)}
                                      aria-label={frame ? `Redo ${slot} frame` : `Sketch ${slot} frame`}
                                    >
                                      {busy ? <Loader2 size={11} className="video-spin" /> : <Sparkles size={11} />}
                                    </button>
                                  </Tooltip>
                                  {frame && (
                                    <Tooltip title={`Edit ${slot}`} description="Edit lighting, pose, or props">
                                      <button
                                        type="button"
                                        className={`video-mini-btn ${frameEditTarget === slot ? 'active' : ''}`}
                                        disabled={busy}
                                        onClick={() => {
                                          setFrameEditTarget((cur) => (cur === slot ? null : slot));
                                          setFrameEditInput('');
                                        }}
                                        aria-label={`Edit ${slot} frame`}
                                      >
                                        <Wand2 size={11} />
                                      </button>
                                    </Tooltip>
                                  )}
                                  <Tooltip title="Upload Image" description="Use a custom keyframe">
                                    <button
                                      type="button"
                                      className="video-mini-btn"
                                      disabled={busy}
                                      onClick={() => triggerUpload(slot, selectedShot.id)}
                                      aria-label={`Upload ${slot} frame`}
                                    >
                                      <Upload size={11} />
                                    </button>
                                  </Tooltip>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {frameEditTarget && (
                          <form
                            className="video-inline-form"
                            onSubmit={(e) => {
                              e.preventDefault();
                              void handleGenerateFrame(selectedShot, frameEditTarget, true);
                            }}
                          >
                            <input
                              name="frameEdit"
                              className="video-input"
                              value={frameEditInput}
                              onChange={(e) => setFrameEditInput(e.target.value)}
                              placeholder={`Edit ${frameEditTarget} sketch (lighting, pose, prop)…`}
                            />
                            <button
                              type="submit"
                              className="video-mini-btn"
                              disabled={busyFrames.has(`${selectedShot.id}:${frameEditTarget}`)}
                            >
                              Apply
                            </button>
                          </form>
                        )}

                        {(wip?.plan?.bible.assets.length ?? 0) > 0 && (
                          <div className="video-ref-row">
                            <span className="video-field-label">
                              Refs ({selectedShot.assetIds.length}/{wip!.plan!.bible.assets.length})
                            </span>
                            <div className="video-ref-pills">
                              {wip!.plan!.bible.assets.map((asset) => {
                                const bound = selectedShot.assetIds.includes(asset.id);
                                return (
                                  <Tooltip key={asset.id} title={asset.label} description={bound ? 'Remove ref from shot' : 'Attach ref to shot'}>
                                    <button
                                      type="button"
                                      className="video-ref-pill video-ref-thumb-chip"
                                      aria-pressed={bound}
                                      onClick={() => toggleAssetOnShot(asset.id)}
                                    >
                                      <img src={asset.url} alt="" className="video-ref-mini" />
                                      <span>{asset.label}</span>
                                    </button>
                                  </Tooltip>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* SUBTAB 2: SCENE PROMPT, CAMERA, MOTION & VOCAL SYNC */}
                    {shotTab === 'prompt' && (
                      <div className="video-shot-pane">
                        {(selectedShot.vocals?.length ?? 0) > 0 && (
                          <div className={`video-lipsync-box ${selectedShot.lipSync ? 'is-on' : ''}`}>
                            <div className="video-lipsync-head">
                              <Tooltip
                                title="Lip-Sync Vocals"
                                description={
                                  selectedShot.lipSync
                                    ? 'Vocal lip-sync enabled for this shot'
                                    : 'Sync character mouth movement to vocal lyrics'
                                }
                              >
                                <button
                                  type="button"
                                  className="video-lipsync-toggle"
                                  aria-pressed={Boolean(selectedShot.lipSync)}
                                  onClick={() =>
                                    void handleShotPatch(selectedShot.id, { lipSync: !selectedShot.lipSync })
                                  }
                                >
                                  <Mic size={12} />
                                  <span>Sync: {selectedShot.lipSync ? 'ON' : 'OFF'}</span>
                                </button>
                              </Tooltip>
                              {selectedShot.lipSync && selectedShot.syncOffsetMs !== undefined && (
                                <span className="video-dim">
                                  Lock {selectedShot.syncOffsetMs >= 0 ? `+${selectedShot.syncOffsetMs}` : selectedShot.syncOffsetMs}ms
                                </span>
                              )}
                            </div>
                            <div className="video-vocal-chips">
                              {(selectedShot.vocals ?? []).slice(0, 5).map((v: Vocal, idx: number) => (
                                <span key={`${v.songStartMs}-${idx}`} className="video-vocal-chip">
                                  <span className="video-vocal-ms">{(v.localStartMs / 1000).toFixed(2)}s</span>
                                  <span>{v.text}</span>
                                </span>
                              ))}
                              {(selectedShot.vocals?.length ?? 0) > 5 && (
                                <span className="video-dim">+{(selectedShot.vocals?.length ?? 0) - 5}</span>
                              )}
                            </div>
                            {selectedShot.lipSync && (
                              <input
                                name="vocalCue"
                                className="video-input"
                                value={selectedShot.vocalCue ?? ''}
                                placeholder="Vocal delivery (e.g. shouts into mic, jaw tense)…"
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setWip((prev) => {
                                    if (!prev?.plan) return prev;
                                    const copy = structuredClone(prev);
                                    const hit = copy.plan!.sections.flatMap((s) => s.shots).find((s) => s.id === selectedShot.id);
                                    if (hit) hit.vocalCue = val;
                                    return copy;
                                  });
                                }}
                                onBlur={(e) => void handleShotPatch(selectedShot.id, { vocalCue: e.target.value })}
                              />
                            )}
                          </div>
                        )}

                        <label className="video-field">
                          <span>Scene</span>
                          <textarea
                            name="shotPrompt"
                            rows={4}
                            className="video-textarea"
                            value={selectedShot.prompt}
                            onChange={(e) => {
                              const val = e.target.value;
                              setWip((prev) => {
                                if (!prev?.plan) return prev;
                                const copy = structuredClone(prev);
                                const hit = copy.plan!.sections.flatMap((s) => s.shots).find((s) => s.id === selectedShot.id);
                                if (hit) hit.prompt = val;
                                return copy;
                              });
                            }}
                            onBlur={(e) => void handleShotPatch(selectedShot.id, { prompt: e.target.value })}
                          />
                        </label>

                        <div className="video-two-col">
                          <label className="video-field">
                            <span>Camera</span>
                            <input
                              name="shotCamera"
                              className="video-input"
                              value={selectedShot.camera}
                              onChange={(e) => {
                                const val = e.target.value;
                                setWip((prev) => {
                                  if (!prev?.plan) return prev;
                                  const copy = structuredClone(prev);
                                  const hit = copy.plan!.sections.flatMap((s) => s.shots).find((s) => s.id === selectedShot.id);
                                  if (hit) hit.camera = val;
                                  return copy;
                                });
                              }}
                              onBlur={(e) => void handleShotPatch(selectedShot.id, { camera: e.target.value })}
                            />
                          </label>
                          <label className="video-field">
                            <span>Motion</span>
                            <input
                              name="shotMotion"
                              className="video-input"
                              value={selectedShot.motion}
                              onChange={(e) => {
                                const val = e.target.value;
                                setWip((prev) => {
                                  if (!prev?.plan) return prev;
                                  const copy = structuredClone(prev);
                                  const hit = copy.plan!.sections.flatMap((s) => s.shots).find((s) => s.id === selectedShot.id);
                                  if (hit) hit.motion = val;
                                  return copy;
                                });
                              }}
                              onBlur={(e) => void handleShotPatch(selectedShot.id, { motion: e.target.value })}
                            />
                          </label>
                        </div>
                      </div>
                    )}

                    {/* SUBTAB 3: TIMING, TAKES, CUT & BEAT ACCENT */}
                    {shotTab === 'timing' && (
                      <div className="video-shot-pane">
                        {(selectedShot.clipUrl || (selectedShot.takes?.length ?? 0) > 1) && (
                          <div className="video-nle-strip">
                            {(selectedShot.takes?.length ?? 0) > 1 && (
                              <div className="video-take-group" role="group" aria-label="Shot Takes">
                                {selectedShot.takes!.map((tk, idx) => (
                                  <button
                                    key={tk.id}
                                    type="button"
                                    className="video-seg-btn"
                                    aria-pressed={(selectedShot.activeTakeId ?? selectedShot.clipKey) === tk.id || selectedShot.clipUrl === tk.url}
                                    onClick={() => void handleShotPatch(selectedShot.id, { activeTakeId: tk.id })}
                                    title={`Take ${idx + 1} · ${tk.resolution}`}
                                  >
                                    T{idx + 1}
                                  </button>
                                ))}
                              </div>
                            )}

                            <div className="video-nudge-group" role="group" aria-label="Trim In">
                              <span className="video-nudge-label">In</span>
                              <button
                                type="button"
                                className="video-nudge-btn"
                                aria-label="Decrease trim in"
                                onClick={() =>
                                  void handleShotPatch(selectedShot.id, {
                                    trimInSec: Math.max(0, Math.round(((selectedShot.trimInSec ?? 0) - 0.1) * 100) / 100),
                                  })
                                }
                              >
                                −
                              </button>
                              <span className="video-nudge-val">{(selectedShot.trimInSec ?? 0).toFixed(2)}s</span>
                              <button
                                type="button"
                                className="video-nudge-btn"
                                aria-label="Increase trim in"
                                onClick={() =>
                                  void handleShotPatch(selectedShot.id, {
                                    trimInSec: Math.min(10, Math.round(((selectedShot.trimInSec ?? 0) + 0.1) * 100) / 100),
                                  })
                                }
                              >
                                +
                              </button>
                            </div>

                            {selectedShot.lipSync && (
                              <div className="video-nudge-group" role="group" aria-label="Lip-Sync Nudge">
                                <span className="video-nudge-label">Sync</span>
                                <button
                                  type="button"
                                  className="video-nudge-btn"
                                  aria-label="Shift sync earlier by 50ms"
                                  onClick={() =>
                                    void handleShotPatch(selectedShot.id, {
                                      syncNudgeMs: Math.max(-500, (selectedShot.syncNudgeMs ?? 0) - 50),
                                    })
                                  }
                                >
                                  −
                                </button>
                                <span className="video-nudge-val">
                                  {(selectedShot.syncNudgeMs ?? 0) >= 0
                                    ? `+${selectedShot.syncNudgeMs ?? 0}`
                                    : selectedShot.syncNudgeMs}
                                  ms
                                </span>
                                <button
                                  type="button"
                                  className="video-nudge-btn"
                                  aria-label="Shift sync later by 50ms"
                                  onClick={() =>
                                    void handleShotPatch(selectedShot.id, {
                                      syncNudgeMs: Math.min(500, (selectedShot.syncNudgeMs ?? 0) + 50),
                                    })
                                  }
                                >
                                  +
                                </button>
                              </div>
                            )}
                          </div>
                        )}

                        <div className="video-three-col">
                          <label className="video-field">
                            <span>Source</span>
                            <select
                              name="shotMode"
                              className="video-select"
                              value={selectedShot.mode}
                              onChange={(e) => void handleShotPatch(selectedShot.id, { mode: e.target.value as Mode })}
                            >
                              <option value="image">Keyframe</option>
                              <option value="refs">Refs</option>
                              <option value="text">Prompt</option>
                            </select>
                          </label>
                          <label className="video-field">
                            <span>Cut</span>
                            <select
                              name="shotTransition"
                              className="video-select"
                              value={selectedShot.transition}
                              onChange={(e) =>
                                void handleShotPatch(selectedShot.id, { transition: e.target.value as Transition })
                              }
                            >
                              {TRANSITIONS.map((tx) => (
                                <option key={tx.value} value={tx.value}>
                                  {tx.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="video-field">
                            <span>Beat</span>
                            <select
                              name="shotAccent"
                              className="video-select"
                              value={selectedShot.accent}
                              onChange={(e) =>
                                void handleShotPatch(selectedShot.id, { accent: e.target.value as Accent })
                              }
                            >
                              {ACCENTS.map((ac) => (
                                <option key={ac.value} value={ac.value}>
                                  {ac.label}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                      </div>
                    )}

                    {/* SUBTAB 4: SURGICAL CLIP EDIT */}
                    {shotTab === 'edit' && (
                      <div className="video-shot-pane">
                        {selectedShot.clipUrl ? (
                          <form
                            className="video-clip-edit-pane"
                            onSubmit={(e) => {
                              e.preventDefault();
                              void handleEditClip();
                            }}
                          >
                            <div className="video-edit-kind-row" role="radiogroup" aria-label="Edit mode">
                              {EDIT_KINDS.map((k) => (
                                <button
                                  key={k.value}
                                  type="button"
                                  role="radio"
                                  aria-checked={clipEditKind === k.value}
                                  className={`video-seg-btn ${clipEditKind === k.value ? 'active' : ''}`}
                                  disabled={busyShotIds.has(selectedShot.id)}
                                  onClick={() => setClipEditKind(k.value as EditKind)}
                                >
                                  {k.label}
                                </button>
                              ))}
                            </div>
                            {clipEditKind === 'retake' && (
                              <div className="video-retake-bounds" aria-label="Retake window in seconds">
                                <span className="video-dim">Window</span>
                                <input
                                  type="number"
                                  step="0.1"
                                  min="0"
                                  max={Math.max(1, Number((selectedShot.qa?.durationSec ?? selectedShot.renderSec).toFixed(1)))}
                                  className="video-input video-retake-num"
                                  aria-label="Retake start seconds"
                                  value={retakeFrom}
                                  disabled={busyShotIds.has(selectedShot.id)}
                                  onChange={(e) => setRetakeFrom(e.target.value)}
                                />
                                <span className="video-dim">–</span>
                                <input
                                  type="number"
                                  step="0.1"
                                  min="0.5"
                                  max={Math.max(1, Number((selectedShot.qa?.durationSec ?? selectedShot.renderSec).toFixed(1)))}
                                  className="video-input video-retake-num"
                                  aria-label="Retake end seconds"
                                  value={retakeTo}
                                  disabled={busyShotIds.has(selectedShot.id)}
                                  onChange={(e) => setRetakeTo(e.target.value)}
                                />
                                <span className="video-dim">s</span>
                              </div>
                            )}
                            <textarea
                              name="clipEdit"
                              rows={3}
                              className="video-textarea"
                              value={clipEditInput}
                              disabled={busyShotIds.has(selectedShot.id)}
                              onChange={(e) => setClipEditInput(e.target.value)}
                              placeholder={
                                clipEditKind === 'retake'
                                  ? 'Describe action for this window…'
                                  : 'Edit clip (style, lighting, props)…'
                              }
                            />
                            <button
                              type="submit"
                              className="video-primary-btn"
                              disabled={busyShotIds.has(selectedShot.id) || !clipEditInput.trim()}
                            >
                              {busyShotIds.has(selectedShot.id) ? <Loader2 size={12} className="video-spin" /> : <Wand2 size={12} />}
                              <span>Apply</span>
                            </button>
                          </form>
                        ) : (
                          <div className="video-chat-empty">
                            <strong>Render shot first</strong>
                            <p>Render this shot to unlock restyle, relight, and windowed retakes.</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="video-chat-empty">
                    <strong>No shot selected</strong>
                    <p>Plan your storyboard first, then click any shot to edit its sketch, lyrics sync, camera, or cut.</p>
                  </div>
                )}
              </div>
            )}

            {/* RAIL TAB 3: REFERENCES (Shared Characters, Locations, Style) */}
            {railTab === 'refs' && (
              <div className="video-rail-panel" role="tabpanel" aria-labelledby={`${baseId}-rail-refs`}>
                <div className="video-assets-grid">
                  {(wip?.plan?.bible.assets ?? []).map((asset) => {
                    const bound = Boolean(selectedShot?.assetIds.includes(asset.id));
                    return (
                      <div key={asset.id} className={`video-asset-card ${bound ? 'is-bound' : ''}`}>
                        <img
                          src={asset.url}
                          alt={asset.label}
                          className="video-asset-img"
                          onClick={() => selectedShot && toggleAssetOnShot(asset.id)}
                        />
                        <div className="video-asset-meta">
                          <span title={asset.label}>{asset.label}</span>
                          <button
                            type="button"
                            className="video-clear-btn"
                            onClick={async () => {
                              try {
                                const next = await removeAsset(song.id, asset.id);
                                applyWip(next);
                              } catch (err: any) {
                                toast.error(err?.message || 'Could not remove reference');
                              }
                            }}
                            aria-label={`Remove ${asset.label}`}
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {(wip?.plan?.bible.assets.length ?? 0) < 6 && (
                  <div className="video-asset-form">
                    <div className="video-two-col">
                      <input
                        name="assetLabel"
                        className="video-input"
                        value={newAssetLabel}
                        onChange={(e) => setNewAssetLabel(e.target.value)}
                        placeholder="Name (e.g. Lead Singer)"
                      />
                      <select
                        name="assetRole"
                        className="video-select"
                        value={newAssetRole}
                        onChange={(e) => setNewAssetRole(e.target.value as Asset['role'])}
                      >
                        <option value="character">Character</option>
                        <option value="world">Location</option>
                        <option value="style">Style</option>
                        <option value="prop">Prop</option>
                      </select>
                    </div>
                    <textarea
                      name="assetPrompt"
                      rows={2}
                      className="video-textarea"
                      value={newAssetPrompt}
                      onChange={(e) => setNewAssetPrompt(e.target.value)}
                      placeholder="Describe reference sheet to generate…"
                    />
                    <div className="video-asset-actions">
                      <button
                        type="button"
                        className="video-mini-btn"
                        disabled={busyFrames.has('asset') || !newAssetPrompt.trim()}
                        onClick={() => void handleGenerateAsset()}
                      >
                        {busyFrames.has('asset') ? <Loader2 size={12} className="video-spin" /> : <Plus size={12} />}
                        <span>Generate</span>
                      </button>
                      <button
                        type="button"
                        className="video-mini-btn"
                        disabled={busyFrames.has('asset')}
                        onClick={() => triggerUpload('asset', undefined, newAssetRole)}
                      >
                        <Upload size={12} />
                        <span>Upload</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </aside>
        </div>
      )}

      {/* Subtle Brand Attribution Footer */}
      <footer className="video-attribution" aria-label="Video engine">
        <span className="video-attribution-text">Powered by</span>
        <a
          href="https://ltx.io"
          target="_blank"
          rel="noopener noreferrer"
          className="video-attribution-brand"
          aria-label="LTX 2.5 by Lightricks"
        >
          <span className="video-attribution-model">LTX 2.5</span>
          <span className="video-attribution-sep" aria-hidden="true">·</span>
          <svg
            className="video-attribution-logo"
            viewBox="0 0 142 31"
            fill="none"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M101.048 14.5365C101.099 14.5431 101.153 14.5266 101.194 14.4903C101.235 14.454 101.258 14.4045 101.261 14.3484L101.334 12.474C101.344 12.2265 101.178 12.012 100.946 11.9691C99.1707 11.6259 97.5513 12.4839 96.7273 13.9095V12.6918C96.7273 12.4179 96.5141 12.1968 96.2501 12.1968H94.7516C94.4875 12.1968 94.2744 12.4179 94.2744 12.6918V24.2483C94.2744 24.5222 94.4875 24.7433 94.7516 24.7433H96.2501C96.5141 24.7433 96.7273 24.5222 96.7273 24.2483V18.4469C96.7273 17.1236 97.0136 16.1403 97.5799 15.5199C98.4071 14.6091 99.9215 14.4078 101.048 14.5365Z" fill="currentColor" />
            <path d="M51.149 24.7465C50.8849 24.7465 50.6718 24.5254 50.6718 24.2515V12.695C50.6718 12.4211 50.8849 12.2 51.149 12.2H52.6475C52.9115 12.2 53.1247 12.4211 53.1247 12.695V24.2515C53.1247 24.5254 52.9115 24.7465 52.6475 24.7465H51.149ZM51.8966 9.59631C50.9804 9.59631 50.2327 8.81422 50.2327 7.86712C50.2327 6.92003 50.9836 6.13794 51.8966 6.13794C52.8161 6.13794 53.5638 6.92663 53.5638 7.86712C53.5606 8.81752 52.8066 9.59631 51.8966 9.59631Z" fill="currentColor" />
            <path d="M103.914 24.7465C103.65 24.7465 103.437 24.5254 103.437 24.2515V12.695C103.437 12.4211 103.65 12.2 103.914 12.2H105.413C105.677 12.2 105.89 12.4211 105.89 12.695V24.2515C105.89 24.5254 105.677 24.7465 105.413 24.7465H103.914Z" fill="currentColor" />
            <path d="M128.88 24.7465C128.743 24.7465 128.615 24.6871 128.523 24.5815L123.277 18.4963V24.2515C123.277 24.5254 123.064 24.7465 122.8 24.7465H121.301C121.037 24.7465 120.824 24.5254 120.824 24.2515V6.59659C120.824 6.3227 121.037 6.1016 121.301 6.1016H122.8C123.064 6.1016 123.277 6.3227 123.277 6.59659V17.4238L128.126 12.3716C128.215 12.2792 128.335 12.2264 128.463 12.2264H131.212C131.288 12.2264 131.358 12.2759 131.387 12.3485C131.415 12.4244 131.399 12.5069 131.342 12.563L126.026 17.9287L131.841 24.4132C131.892 24.4693 131.908 24.5551 131.876 24.6277C131.848 24.7003 131.778 24.7465 131.702 24.7465H128.88Z" fill="currentColor" />
            <path d="M80.1866 24.7465C79.9225 24.7465 79.7094 24.5254 79.7094 24.2515V17.3545C79.7094 15.5395 78.8504 14.2756 77.091 14.2756C74.8671 14.2756 73.8713 15.9553 73.8713 18.2917V24.2515C73.8713 24.5254 73.6582 24.7465 73.3941 24.7465H71.8956C71.6316 24.7465 71.4184 24.5254 71.4184 24.2515V6.59659C71.4184 6.3227 71.6316 6.1016 71.8956 6.1016H73.3941C73.6582 6.1016 73.8713 6.3227 73.8713 6.59659V13.8862C74.6158 12.5267 76.2225 11.8832 77.7432 11.8832C80.3711 11.8832 82.1591 13.6091 82.1591 16.6978V24.2482C82.1591 24.5221 81.946 24.7432 81.6819 24.7432H80.1866V24.7465Z" fill="currentColor" />
            <path d="M38.5249 24.7465C38.2608 24.7465 38.0476 24.5254 38.0476 24.2515V6.59659C38.0476 6.3227 38.2608 6.1016 38.5249 6.1016H40.1729C40.4369 6.1016 40.6501 6.3227 40.6501 6.59659V22.2022H48.3366C48.6007 22.2022 48.8138 22.4233 48.8138 22.6972V24.2515C48.8138 24.5254 48.6007 24.7465 48.3366 24.7465H38.5249Z" fill="currentColor" />
            <path d="M118.721 22.7302C118.813 22.8226 118.861 22.9513 118.861 23.0866C118.858 23.2186 118.804 23.3473 118.711 23.4397C117.544 24.5881 116.099 25.0798 114.4 25.0798C110.777 25.0798 108.076 22.5355 108.076 18.5458C108.076 14.7443 110.564 11.9327 114.4 11.9327C116.033 11.9327 117.537 12.4607 118.74 13.6091C118.839 13.7048 118.896 13.8368 118.896 13.9754C118.893 14.114 118.839 14.246 118.74 14.3417L117.668 15.3548C117.49 15.5231 117.219 15.5297 117.035 15.368C116.297 14.7179 115.333 14.3186 114.302 14.3186C111.922 14.3186 110.678 16.3118 110.678 18.5953C110.678 20.8261 112.129 22.6906 114.426 22.6906C115.368 22.6906 116.284 22.3639 117.012 21.6874C117.114 21.5983 117.194 21.5257 117.362 21.5257C117.496 21.5257 117.614 21.5818 117.7 21.6709L118.721 22.7302Z" fill="currentColor" />
            <path d="M135.472 15.5528C135.472 14.8862 136.13 14.2724 137.371 14.2724C138.227 14.2724 139.019 14.642 139.608 15.1799C139.776 15.335 140.031 15.3482 140.212 15.203L141.297 14.3516C141.402 14.2691 141.469 14.147 141.485 14.0117C141.501 13.8764 141.459 13.7411 141.373 13.6388C140.47 12.53 139.168 11.8865 137.501 11.8865C135.052 11.8865 132.875 13.2923 132.875 15.8102C132.875 16.9949 133.416 18.338 135.211 18.9815C137.04 19.6382 139.391 19.6415 139.391 21.2057C139.391 22.2056 138.198 22.6709 137.075 22.6709C136.197 22.6709 135.157 22.2617 134.431 21.539C134.256 21.3641 133.986 21.3542 133.798 21.5126L132.77 22.3904C132.672 22.4762 132.608 22.5983 132.599 22.7336C132.589 22.8689 132.63 23.0009 132.716 23.0999C133.744 24.3043 135.246 25.0765 137.05 25.0765C139.639 25.0765 142 23.7731 142 21.0869C141.997 16.193 135.472 18.2027 135.472 15.5528Z" fill="currentColor" />
            <path d="M88.7576 20.9747C88.7417 20.6414 88.7321 20.2982 88.7321 19.9517V14.4507H91.4937C91.7577 14.4507 91.9709 14.2296 91.9709 13.9557V12.7149C91.9709 12.441 91.7577 12.2199 91.4937 12.2199H88.7321V9.2499C88.7321 8.976 88.519 8.75491 88.2549 8.75491H86.7564C86.4924 8.75491 86.2792 8.976 86.2792 9.2499V12.2199H84.1444C83.8803 12.2199 83.6672 12.441 83.6672 12.7149V13.9557C83.6672 14.2296 83.8803 14.4507 84.1444 14.4507H86.2792V20.7866C86.2792 22.3145 86.3301 23.5487 87.3418 24.3605C88.484 25.2779 90.6379 25.2086 91.7387 24.7697C91.9232 24.6971 92.0441 24.5123 92.0441 24.3077V22.6478C92.0441 22.5818 92.0123 22.5224 91.9614 22.4861C91.9105 22.4498 91.8468 22.4399 91.7864 22.463C90.2656 23.0372 88.8467 22.7468 88.7576 20.9747Z" fill="currentColor" />
            <path d="M66.4171 12.2C66.1531 12.2 65.9399 12.4211 65.9399 12.695V13.8368C65.0077 12.5663 63.3565 11.8865 61.8421 11.8865C58.0784 11.8865 55.6923 14.7971 55.6923 18.4733C55.6923 22.166 58.3011 24.9049 61.8421 24.9049C63.4329 24.9049 65.0332 24.2515 65.9399 22.8359C65.9399 24.5716 66.4076 28.6141 61.7403 28.6141C60.2577 28.6405 58.8451 28.0564 57.7921 27.0202C57.6966 26.9245 57.563 26.875 57.4326 26.8849C57.3021 26.8948 57.1749 26.9608 57.0921 27.0697L56.1186 28.3303C55.9563 28.5382 55.985 28.8451 56.1822 29.0167C57.6266 30.2839 59.2874 31 61.7912 31C65.6154 31 68.3928 28.459 68.3928 24.5452V12.6983C68.3928 12.4244 68.1797 12.2033 67.9156 12.2033H66.4171V12.2ZM62.1157 22.5158C59.7232 22.5158 58.2916 20.8922 58.2916 18.4733C58.2916 15.9026 59.8759 14.2724 62.1157 14.2724C64.3682 14.2724 65.9399 15.9158 65.9399 18.4733C65.9399 20.8922 64.5114 22.5158 62.1157 22.5158Z" fill="currentColor" />
            <path d="M104.662 9.59631C103.746 9.59631 102.998 8.81422 102.998 7.86712C102.998 6.92003 103.749 6.13794 104.662 6.13794C105.581 6.13794 106.329 6.92663 106.329 7.86712C106.329 8.81752 105.575 9.59631 104.662 9.59631Z" fill="currentColor" />
            <path d="M22.8177 17.1038C22.8209 17.1038 22.8209 17.1038 22.8177 17.1038C23.5177 15.5297 24.0235 14.0381 24.2176 12.7874C24.4658 11.1902 24.2271 9.92964 23.5049 9.03864C22.6396 7.96945 21.2906 7.67245 19.9448 7.66255C18.9554 7.66255 17.7973 7.83415 16.5597 8.12455C15.688 4.77177 13.9 0 10.5403 0C6.66207 0 3.58237 6.86726 1.78164 12.9095C1.11989 15.1304 0 19.5458 0 21.7139C0 26.8321 4.04687 30.9967 9.01956 30.9967C14.6508 30.9967 25.4234 27.3799 25.4234 21.7139C25.4234 19.9649 24.3989 18.4172 22.8177 17.1038ZM19.9385 9.71514C20.6384 9.72174 21.5865 9.81414 22.016 10.3883C22.4073 10.9097 22.3692 11.804 22.2673 12.4607C22.0892 13.6157 21.6279 14.8829 21.1761 15.9488C20.1103 15.2954 18.9204 14.7179 17.6764 14.2361C17.5142 12.8798 17.2978 11.4806 17.0179 10.1177C18.0996 9.86364 19.0986 9.71514 19.9385 9.71514ZM17.9023 16.5164C18.7422 16.8827 19.5376 17.2853 20.3203 17.7737C19.6553 19.0871 18.8759 20.4236 18.055 21.6842C18.1059 20.3543 18.0678 18.5393 17.9023 16.5164ZM15.5989 13.5233C13.7886 12.9821 11.9815 12.629 10.4099 12.4937C11.9402 11.7776 13.5627 11.1341 15.1121 10.6424C15.303 11.5895 15.4653 12.5597 15.5989 13.5233ZM5.03314 9.41814C6.84341 4.80477 8.90821 2.05259 10.553 2.05259C12.6624 2.05259 14.1004 6.53726 14.654 8.64925C12.6051 9.28614 10.4481 10.1771 8.50098 11.1605C6.58889 12.1208 4.67045 13.4045 3.37239 14.4836C3.77963 12.8402 4.63863 10.4312 5.03314 9.41814ZM8.97184 28.9441C5.10949 28.9177 1.97889 25.6837 1.97889 21.7139C1.97889 17.7242 5.13813 14.4803 9.02274 14.4803C11.0207 14.4803 13.515 14.9522 15.863 15.7343C16.1207 18.3809 16.1716 20.8064 16.0411 22.3475C15.7103 26.2249 12.4079 28.9342 8.97184 28.9441ZM18.3286 26.7199C17.5714 27.0697 16.7697 27.3865 15.9457 27.6637C17.9373 25.5484 20.2344 22.2221 21.9174 18.9749C22.9068 19.8824 23.4445 20.8196 23.4445 21.7139C23.4477 23.3936 21.5801 25.2184 18.3286 26.7199Z" fill="currentColor" />
          </svg>
        </a>
      </footer>

      {/* Mobile Bottom Focus Switcher (matches Rawchunks Editor responsive pattern) */}
      <nav className="video-mobile-nav" aria-label="Studio Views">
        {(
          [
            { id: 'player', label: 'Player', icon: Film },
            { id: 'storyboard', label: 'Board', icon: Layers },
            { id: 'director', label: 'Director', icon: Sparkles },
            { id: 'shot', label: 'Shot', icon: Sliders },
            { id: 'refs', label: 'Refs', icon: ImageIcon },
          ] as const
        ).map((item) => {
          const Icon = item.icon;
          const active = mobilePane === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className={`video-mobile-btn ${active ? 'is-active' : ''}`}
              onClick={() => {
                setMobilePane(item.id);
                if (item.id === 'player' || item.id === 'storyboard') setCenterView(item.id);
                else setRailTab(item.id);
              }}
            >
              <Icon size={14} aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Minimal Pre-Assemble / Pre-Save Master Upscale Dialog (reuses existing Modal + Button) */}
      <Modal
        isOpen={Boolean(upscaleDialog)}
        onClose={() => setUpscaleDialog(null)}
        title={upscaleDialog === 'save' ? 'Save Master' : 'Assemble Master'}
        size="sm"
      >
        {(() => {
          const rawRes = wip?.masterResolution ?? wip?.quality ?? '720p';
          const currentRes = rawRes === '4k' ? '4K' : rawRes;
          const show1080 = rawRes !== '1080p' && rawRes !== '4k';
          const options: Array<{ value: Master; label: string; badge: string; detail: string }> = [
            {
              value: 'none',
              label: `Keep ${currentRes}`,
              badge: 'FAST',
              detail: upscaleDialog === 'save' ? 'Save current master immediately' : 'Mount cuts at current resolution',
            },
            ...(show1080
              ? [
                  {
                    value: '1080p' as const,
                    label: 'Upscale to 1080p',
                    badge: 'HD',
                    detail: 'Super-resolve master to 1080p without altering shots',
                  },
                ]
              : []),
            {
              value: '4k',
              label: 'Upscale to 4K',
              badge: 'UHD',
              detail: 'Super-resolve master to 4K without altering shots',
            },
          ];
          return (
            <div className="video-upscale-body">
              <div className="video-upscale-options" role="radiogroup" aria-label="Output resolution">
                {options.map((opt) => {
                  const active = upscaleChoice === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      className={`video-upscale-opt ${active ? 'is-selected' : ''}`}
                      onClick={() => setUpscaleChoice(opt.value)}
                    >
                      <span className="video-upscale-opt-head">
                        <span className="video-upscale-opt-title">{opt.label}</span>
                        <span className="video-upscale-badge">{opt.badge}</span>
                      </span>
                      <span className="video-upscale-opt-detail">{opt.detail}</span>
                    </button>
                  );
                })}
              </div>
              <div className="video-upscale-actions">
                <Button variant="ghost" size="sm" onClick={() => setUpscaleDialog(null)}>
                  Cancel
                </Button>
                <Button variant="primary" size="sm" onClick={confirmUpscaleDialog}>
                  {upscaleDialog === 'save'
                    ? upscaleChoice === 'none'
                      ? 'Save'
                      : `Upscale & Save`
                    : upscaleChoice === 'none'
                      ? 'Assemble'
                      : `Upscale & Assemble`}
                </Button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Native <dialog> Full-Viewport Cinema Expand Viewer (modern-web-guidance dialog pattern) */}
      <dialog
        ref={cinemaDialogRef}
        className="video-cinema-dialog"
        aria-labelledby={`${baseId}-cinema-title`}
        {...({ closedby: 'any' } as any)}
      >
        <div className="video-cinema-shell">
          <div className="video-cinema-head">
            <h2 id={`${baseId}-cinema-title`} className="video-cinema-title">
              {song.title}
              {selectedShot && stageView === 'shot' ? ` · Shot ${String(selectedShot.index + 1).padStart(2, '0')}` : ''}
            </h2>
            <div className="video-cinema-head-actions">
              <button
                type="button"
                className="video-mini-btn"
                onClick={() => void toggleNativeFullscreen()}
                aria-label={isNativeFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              >
                {isNativeFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                <span>{isNativeFullscreen ? 'Window' : 'Fullscreen'}</span>
              </button>
              <button
                type="button"
                className="video-mini-btn"
                autoFocus
                onClick={() => setCinemaOpen(false)}
                aria-label="Close expanded video"
              >
                <X size={13} />
                <span>Close</span>
              </button>
            </div>
          </div>

          <div className="video-cinema-stage" onClick={togglePlay}>
            {stageShot?.startFrame?.url ? (
              <img src={stageShot.startFrame.url} alt={song.title} className="video-player-backdrop" />
            ) : (
              <img src={song.image || '/favicon.svg'} alt={song.title} className="video-stage-cover" />
            )}

            <video
              ref={cinemaSlotARef}
              playsInline
              muted
              preload="auto"
              data-active="false"
              className="video-player-slot"
            />
            <video
              ref={cinemaSlotBRef}
              playsInline
              muted
              preload="auto"
              data-active="false"
              className="video-player-slot"
            />
          </div>

          <div className="video-cinema-foot">
            <div className={`editor-transport-deck ${playing ? 'is-playing' : ''}`}>
              <div className="editor-transport-controls">
                <button type="button" className="editor-transport-btn" onClick={handleReturnToZero} aria-label="Back to start">
                  <SkipBack size={12} />
                </button>
                <button
                  type="button"
                  className={`editor-transport-play-btn ${playing ? 'active' : ''}`}
                  onClick={togglePlay}
                  aria-label={playing ? 'Pause' : 'Play'}
                >
                  {playing ? <Pause size={13} /> : <Play size={13} />}
                  <span className="editor-transport-play-label">{playing ? 'PAUSE' : 'PLAY'}</span>
                </button>
                <button type="button" className="editor-transport-btn" onClick={handleStop} aria-label="Stop">
                  <Square size={11} />
                </button>
              </div>
              <div className={`editor-header-time ${playing ? 'playing' : ''}`}>
                <span className="editor-header-time-current">{formatClock(displayTime)}</span>
                <span className="editor-header-time-sep">/</span>
                <span className="editor-header-time-total">{formatClock(durationSec)}</span>
              </div>
            </div>

            <div
              ref={cinemaTimelineRef}
              className="video-cinema-scrub"
              onPointerDown={(e) => handleTimelinePointer(e, cinemaTimelineRef)}
            >
              <Waveform
                audioUrl={song.url}
                height={36}
                interactive={false}
                showSelection={false}
                className="video-wave-canvas"
              />
              <div ref={cinemaPlayheadRef} className="video-playhead" aria-hidden="true" />
            </div>
          </div>
        </div>
      </dialog>
    </div>
  );
};

export default Video;
