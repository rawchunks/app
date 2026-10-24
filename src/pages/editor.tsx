import { sdk } from '@/lib/sdk';
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { Glitch } from '../components/glitch';
import { Button } from '../components/button';
import { Badge } from '../components/badge';
import { Modal } from '../components/modal';
import { Song, Task } from '../lib/schema';
import { useDawStore, TrackType, type Take, type LyricsAlignment } from '../lib/daw/store';
import { dawEngine } from '../lib/daw/engine';
import { useOptions } from '../hooks/use-options';
import { useSelectedUserAddress } from '../hooks/use-address';
import { useSession, promptSessionModal, SessionControl } from '../components/session';
import { WalletConnector } from '../components/connector';
import { Board } from '../components/daw/Board';
import { Toolbox, ManualToolTab } from '../components/daw/Toolbox';
import { Studio } from '../components/daw/Studio';
import { Tooltip } from '../components/daw/Tooltip';
import { ArrowLeft, Play, Pause, Square, SkipBack, Repeat } from 'lucide-react';
import { source, sourceInterval, interval, isLayerTake, layerTrackName, isFullSongRestyleTake } from '../lib/daw/takes';
import { readProject, writeProject } from '../lib/cache';
import { useQueryClient } from '@tanstack/react-query';
import { GuideTrigger } from '../components/guide/Tour';

export interface Props {
  song: Song;
  onBack: () => void;
  className?: string;
}

const fmtHeaderTime = (sec: number) => {
  if (!Number.isFinite(sec) || sec < 0) return '0:00.0';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 10);
  return `${m}:${s < 10 ? '0' : ''}${s}.${ms}`;
};

const EditorTransportDeck: React.FC<{
  fallbackDuration?: number;
}> = ({ fallbackDuration = 0 }) => {
  const playhead = useDawStore((s) => s.playhead);
  const duration = useDawStore((s) => s.duration);
  const isPlaying = useDawStore((s) => s.isPlaying);
  const setPlaying = useDawStore((s) => s.setPlaying);
  const setPlayhead = useDawStore((s) => s.setPlayhead);
  const loop = useDawStore((s) => s.loop);
  const setLoop = useDawStore((s) => s.setLoop);
  const selection = useDawStore((s) => s.selection);
  const total = duration > 0 ? duration : fallbackDuration;

  const handleTogglePlay = useCallback(async () => {
    if (useDawStore.getState().isPlaying) {
      dawEngine.pauseTransport();
      setPlaying(false);
    } else {
      try {
        await dawEngine.startTransport();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Could not play the arrangement');
      }
    }
  }, [setPlaying]);

  const handleStop = useCallback(() => {
    dawEngine.stopTransport();
    setPlaying(false);
    setPlayhead(0);
  }, [setPlaying, setPlayhead]);

  const handleReturnToZero = useCallback(() => {
    dawEngine.seek(0);
    setPlayhead(0);
  }, [setPlayhead]);

  const handleToggleLoop = useCallback(() => {
    const nextLoop = !loop;
    setLoop(nextLoop);
    if (selection) {
      dawEngine.setLoop(nextLoop, selection.start, selection.end);
    } else {
      dawEngine.setLoop(nextLoop, 0, total);
    }
  }, [loop, setLoop, selection, total]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.tagName === 'BUTTON' ||
          target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      void handleTogglePlay();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleTogglePlay]);

  return (
    <div className={`editor-transport-deck ${isPlaying ? 'is-playing' : ''}`} role="group" aria-label="Master Transport">
      <div className="editor-transport-controls">
        <Tooltip title="Return to Zero" description="Rewind playhead to 0:00.0">
          <button
            type="button"
            className="editor-transport-btn editor-transport-rtz-btn"
            onClick={handleReturnToZero}
            aria-label="Return to Zero"
          >
            <SkipBack size={12} />
          </button>
        </Tooltip>

        <Tooltip
          title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
          description={isPlaying ? 'Pause master playback' : 'Start master playback'}
        >
          <button
            type="button"
            className={`editor-transport-play-btn ${isPlaying ? 'active' : ''}`}
            onClick={handleTogglePlay}
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause size={13} /> : <Play size={13} className="play-icon-nudge" />}
            <span className="editor-transport-play-label">{isPlaying ? 'PAUSE' : 'PLAY'}</span>
          </button>
        </Tooltip>

        <Tooltip title="Stop" description="Stop playback and reset playhead to 0:00.0">
          <button
            type="button"
            className="editor-transport-btn editor-transport-stop-btn"
            onClick={handleStop}
            aria-label="Stop"
          >
            <Square size={11} />
          </button>
        </Tooltip>

        <Tooltip
          title="Loop"
          description={selection ? 'Loop active timeline region (A-B)' : 'Loop full arrangement'}
        >
          <button
            type="button"
            className={`editor-transport-btn ${loop ? 'active' : ''}`}
            onClick={handleToggleLoop}
            aria-label="Toggle Loop"
          >
            <Repeat size={12} />
          </button>
        </Tooltip>
      </div>

      <div className={`editor-header-time ${isPlaying ? 'playing' : ''}`} aria-label="Playback time">
        <span className="editor-header-time-current">{fmtHeaderTime(playhead)}</span>
        <span className="editor-header-time-sep">/</span>
        <span className="editor-header-time-total">{fmtHeaderTime(total)}</span>
      </div>
    </div>
  );
};

const BPM_PRESETS: Array<{ bpm: number; label: string }> = [
  { bpm: 80, label: 'LO-FI' },
  { bpm: 95, label: 'HIP-HOP' },
  { bpm: 110, label: 'GROOVE' },
  { bpm: 120, label: 'HOUSE' },
  { bpm: 128, label: 'TECHNO' },
  { bpm: 140, label: 'TRAP / D&B' },
  { bpm: 160, label: 'JUNGLE' },
];

const EditorBpmControl: React.FC<{
  bpm: number;
  onChange: (nextBpm: number) => void;
}> = ({ bpm, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState(String(bpm));
  const tapTimesRef = useRef<number[]>([]);

  useEffect(() => {
    setDraft(String(bpm));
  }, [bpm]);

  const commitBpm = (val: number) => {
    const clamped = Math.max(40, Math.min(240, Math.round(val)));
    setDraft(String(clamped));
    onChange(clamped);
  };

  const handleTapTempo = () => {
    const now = performance.now();
    const taps = tapTimesRef.current.filter((t) => now - t < 2500);
    taps.push(now);
    tapTimesRef.current = taps;
    if (taps.length >= 2) {
      let sum = 0;
      for (let i = 1; i < taps.length; i++) {
        sum += taps[i] - taps[i - 1];
      }
      const avgMs = sum / (taps.length - 1);
      if (avgMs > 0) {
        commitBpm(60000 / avgMs);
      }
    }
  };

  return (
    <>
      <Tooltip title="Project Tempo (BPM)" description="Click to open Tempo & BPM Studio Modal">
        <button
          type="button"
          className="editor-bpm-trigger daw-badge"
          onClick={() => setIsOpen(true)}
          aria-label={`Project Tempo ${bpm} BPM — Click to edit`}
        >
          <span className="editor-bpm-trigger-val">{bpm}</span>
          <span className="editor-bpm-trigger-unit">BPM</span>
        </button>
      </Tooltip>

      <Modal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title="TEMPO // BPM CONTROLLER"
        size="sm"
      >
        <div className="editor-bpm-modal">
          <div className="editor-bpm-modal-top">
            <button
              type="button"
              className="daw-ctrl-btn editor-bpm-nudge"
              onClick={() => commitBpm(bpm - 5)}
              aria-label="Decrease BPM by 5"
            >
              −5
            </button>
            <button
              type="button"
              className="daw-ctrl-btn editor-bpm-nudge"
              onClick={() => commitBpm(bpm - 1)}
              aria-label="Decrease BPM by 1"
            >
              −1
            </button>

            <div className="editor-bpm-typer-wrap">
              <input
                type="number"
                min={40}
                max={240}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v) && v >= 40 && v <= 240) {
                    onChange(v);
                  }
                }}
                onBlur={() => {
                  const v = parseInt(draft, 10);
                  if (!isNaN(v)) commitBpm(v);
                  else setDraft(String(bpm));
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const v = parseInt(draft, 10);
                    if (!isNaN(v)) commitBpm(v);
                    setIsOpen(false);
                  }
                }}
                className="editor-bpm-typer-input"
                aria-label="Direct BPM value"
              />
              <span className="editor-bpm-typer-unit">BPM</span>
            </div>

            <button
              type="button"
              className="daw-ctrl-btn editor-bpm-nudge"
              onClick={() => commitBpm(bpm + 1)}
              aria-label="Increase BPM by 1"
            >
              +1
            </button>
            <button
              type="button"
              className="daw-ctrl-btn editor-bpm-nudge"
              onClick={() => commitBpm(bpm + 5)}
              aria-label="Increase BPM by 5"
            >
              +5
            </button>
          </div>

          <div className="editor-bpm-slider-row">
            <span className="daw-field-label">40</span>
            <input
              type="range"
              min={40}
              max={240}
              step={1}
              value={bpm}
              onChange={(e) => commitBpm(parseInt(e.target.value, 10))}
              className="editor-bpm-range"
              aria-label="BPM Tempo Slider"
            />
            <span className="daw-field-label">240</span>
          </div>

          <div className="editor-bpm-presets-grid">
            {BPM_PRESETS.map((preset) => (
              <button
                key={preset.bpm}
                type="button"
                className={`daw-ctrl-btn editor-bpm-preset-btn ${bpm === preset.bpm ? 'active' : ''}`}
                onClick={() => commitBpm(preset.bpm)}
              >
                <span className="editor-bpm-preset-num">{preset.bpm}</span>
                <span className="editor-bpm-preset-tag">{preset.label}</span>
              </button>
            ))}
          </div>

          <div className="editor-bpm-modal-footer">
            <button
              type="button"
              className="daw-ctrl-btn editor-bpm-tap-btn"
              onClick={handleTapTempo}
            >
              TAP TEMPO
            </button>
            <Button size="sm" variant="primary" onClick={() => setIsOpen(false)}>
              DONE
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
};

export const Editor: React.FC<Props> = ({ song, onBack, className = '' }) => {
  const tracks = useDawStore((s) => s.tracks);
  const isPlaying = useDawStore((s) => s.isPlaying);
  const duration = useDawStore((s) => s.duration);
  const bpm = useDawStore((s) => s.bpm);
  const loop = useDawStore((s) => s.loop);
  const selection = useDawStore((s) => s.selection);
  const legoContextTrackIds = useDawStore((s) => s.legoContextTrackIds);
  const takes = useDawStore((s) => s.takes);
  const selectedTrackId = useDawStore((s) => s.selectedTrackId);
  const initProject = useDawStore((s) => s.initProject);
  const setPlaying = useDawStore((s) => s.setPlaying);
  const setPlayhead = useDawStore((s) => s.setPlayhead);
  const setBpm = useDawStore((s) => s.setBpm);
  const setLoop = useDawStore((s) => s.setLoop);
  const setSelection = useDawStore((s) => s.setSelection);
  const setSelectedTrackId = useDawStore((s) => s.setSelectedTrackId);
  const addTrack = useDawStore((s) => s.addTrack);
  const setTakes = useDawStore((s) => s.setTakes);
  const setCommits = useDawStore((s) => s.setCommits);
  const syncStems = useDawStore((s) => s.syncStems);
  const restoreSession = useDawStore((s) => s.restoreSession);

  // Connected wallet address
  const { userAddress, readAddress } = useSelectedUserAddress();
  const { session } = useSession();
  const effectiveAddress = userAddress;
  const queryClient = useQueryClient();

  // Active Manual Tool View (Supports deep-linking via ?tab=mixer, etc.)
  const [activeTool, setActiveTool] = useState<ManualToolTab>(() => {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search).get('tab');
      if (p && ['mixer', 'keys', 'drums', 'strudel', 'dsp', 'sample', 'history'].includes(p)) {
        return p as ManualToolTab;
      }
    }
    return 'mixer';
  });

  // Mobile Mission-Control Focus ('toolbox' | 'studio' — both remain visible via live graphical telemetry bars)
  const [mobileFocus, setMobileFocus] = useState<'toolbox' | 'studio'>(() => {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search).get('tab');
      if (p === 'studio') return 'studio';
    }
    return 'toolbox';
  });

  // Sync with interactive Guide steps on /editor
  useEffect(() => {
    const onGuideAction = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail || detail.type !== 'editor-focus') return;
      if (detail.editorFocus === 'studio' || detail.editorFocus === 'toolbox') {
        setMobileFocus(detail.editorFocus);
      }
    };
    window.addEventListener('rawchunks:guide-action', onGuideAction);
    return () => window.removeEventListener('rawchunks:guide-action', onGuideAction);
  }, []);

  // Client-side Undo / Redo History Stack
  const historyRef = useRef<{
    past: Array<{ tracks: ReturnType<typeof useDawStore.getState>['tracks']; bpm: number; originals: ReturnType<typeof useDawStore.getState>['originals'] }>;
    future: Array<{ tracks: ReturnType<typeof useDawStore.getState>['tracks']; bpm: number; originals: ReturnType<typeof useDawStore.getState>['originals'] }>;
    isApplying: boolean;
    lastPushTime: number;
  }>({
    past: [],
    future: [],
    isApplying: false,
    lastPushTime: 0,
  });
  const [historyCounts, setHistoryCounts] = useState<{ past: number; future: number }>({ past: 0, future: 0 });

  const applyHistorySnapshot = useCallback(
    (snap: { tracks: ReturnType<typeof useDawStore.getState>['tracks']; bpm: number; originals: ReturnType<typeof useDawStore.getState>['originals'] }) => {
      historyRef.current.isApplying = true;
      try {
        useDawStore.setState({
          tracks: structuredClone(snap.tracks),
          bpm: snap.bpm,
          originals: structuredClone(snap.originals),
        });
        dawEngine.setBpm(snap.bpm);
        for (const t of snap.tracks) {
          dawEngine.updateTrackMixer(t.id);
        }
      } finally {
        historyRef.current.isApplying = false;
      }
    },
    [],
  );

  const handleUndo = useCallback(() => {
    const past = historyRef.current.past;
    if (past.length === 0) return;
    const prevSnap = past[past.length - 1];
    const current = useDawStore.getState();
    historyRef.current.past = past.slice(0, -1);
    historyRef.current.future = [
      ...historyRef.current.future,
      {
        tracks: structuredClone(current.tracks),
        bpm: current.bpm,
        originals: structuredClone(current.originals),
      },
    ];
    applyHistorySnapshot(prevSnap);
    setHistoryCounts({ past: historyRef.current.past.length, future: historyRef.current.future.length });
  }, [applyHistorySnapshot]);

  const handleRedo = useCallback(() => {
    const future = historyRef.current.future;
    if (future.length === 0) return;
    const nextSnap = future[future.length - 1];
    const current = useDawStore.getState();
    historyRef.current.future = future.slice(0, -1);
    historyRef.current.past = [
      ...historyRef.current.past,
      {
        tracks: structuredClone(current.tracks),
        bpm: current.bpm,
        originals: structuredClone(current.originals),
      },
    ];
    applyHistorySnapshot(nextSnap);
    setHistoryCounts({ past: historyRef.current.past.length, future: historyRef.current.future.length });
  }, [applyHistorySnapshot]);

  // AI Generation & Studio Parameters
  const [task, setTask] = useState<Task>('repaint');
  const [selectedQuality, setSelectedQuality] = useState<string>('');
  const [prompt, setPrompt] = useState<string>('');
  const [lyrics, setLyrics] = useState<string>('');
  const [vocalLanguage, setVocalLanguage] = useState<string>('en');
  const [hasExistingLyrics, setHasExistingLyrics] = useState<boolean>(false);
  const [isTranscribingLyrics, setIsTranscribingLyrics] = useState<boolean>(false);
  const [lyricsAlignment, setLyricsAlignment] = useState<LyricsAlignment | null>(null);
  const [isAligningLyrics, setIsAligningLyrics] = useState<boolean>(false);
  const [stemType, setStemType] = useState<string>('all');
  const [coverStrength, setCoverStrength] = useState<number>(0.65);
  const [repaintMode, setRepaintMode] = useState<'conservative' | 'balanced' | 'aggressive'>('balanced');
  const [repaintStrength, setRepaintStrength] = useState<number>(0.5);
  const [instrument, setInstrument] = useState('guitar');
  const [targetDuration, setTargetDuration] = useState<number>(duration > 0 ? Math.ceil(duration) + 30 : 60);

  const options = useOptions();
  const editing = options.data?.editing;
  const [parameters, setParameters] = useState<Record<string, string | number | string[]>>({});
  useEffect(() => {
    const action = editing?.tasks.find(action => action.id === task);
    if (action?.modes.length && !action.modes.includes(selectedQuality)) setSelectedQuality(action.modes[0]);
  }, [editing, task, selectedQuality]);
  useEffect(() => {
    if (duration > 0) {
      const maxDur = editing?.duration.max ?? 300;
      setTargetDuration(prev => (prev <= duration ? Math.min(maxDur, Math.ceil(duration) + 30) : Math.min(maxDur, Math.round(prev))));
    }
  }, [duration, editing?.duration.max]);

  // Commit Modal
  const [isCommitModalOpen, setIsCommitModalOpen] = useState<boolean>(false);
  const [commitMessage, setCommitMessage] = useState<string>('');

  // Processing & Poller
  const [processing, setProcessing] = useState<boolean>(false);
  const [progress, setProgress] = useState<number | undefined>(undefined);
  const [toolboxRevision, setToolboxRevision] = useState(0);
  const pollTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const lyricsPollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scopeRef = useRef(0);
  const sessionRef = useRef(false);
  useEffect(() => {
    scopeRef.current++;
    setProcessing(false);
    setVocalLanguage('en');
    setHasExistingLyrics(false);
    setIsTranscribingLyrics(false);
    setLyricsAlignment(null);
    setIsAligningLyrics(false);
    const leave = () => {
      scopeRef.current++;
      for (const timer of pollTimersRef.current.values()) clearTimeout(timer);
      pollTimersRef.current.clear();
      if (lyricsPollTimerRef.current) {
        clearTimeout(lyricsPollTimerRef.current);
        lyricsPollTimerRef.current = null;
      }
    };
    window.addEventListener('pagehide', leave);
    return () => { window.removeEventListener('pagehide', leave); leave(); };
  }, [song.id, readAddress]);

  // Non-blocking background poller for ElevenLabs Scribe vocal stem transcription & forced alignment
  const pollSongLyrics = useCallback((targetSongId: string, attempt = 0) => {
    if (!readAddress) return;
    if (lyricsPollTimerRef.current) {
      clearTimeout(lyricsPollTimerRef.current);
      lyricsPollTimerRef.current = null;
    }
    const scope = scopeRef.current;
    void (async () => {
      try {
        const res = await sdk.fetch(
          `/api/editing/lyrics/${encodeURIComponent(targetSongId)}?language=${encodeURIComponent(vocalLanguage || 'en')}`,
          { userAddress: readAddress },
        );
        if (!res.ok || scope !== scopeRef.current || useDawStore.getState().songId !== targetSongId) return;
        const data = await res.json();
        if (data.alignment && Array.isArray(data.alignment.lines) && data.alignment.lines.length > 0) {
          setLyricsAlignment(data.alignment);
        }
        if (typeof data.lyrics === 'string' && data.lyrics.trim() && data.lyrics.trim() !== '[Instrumental]') {
          setLyrics(prev => {
            if (!prev) return data.lyrics;
            if (prev.replace(/\s+/g, ' ').trim() === data.lyrics.replace(/\s+/g, ' ').trim()) {
              return data.lyrics;
            }
            return prev;
          });
          setHasExistingLyrics(true);
        }
        if ((data.status === 'transcribing' || data.status === 'aligning') && attempt < 20) {
          setIsTranscribingLyrics(data.status === 'transcribing');
          setIsAligningLyrics(data.status === 'aligning');
          lyricsPollTimerRef.current = setTimeout(() => {
            pollSongLyrics(targetSongId, attempt + 1);
          }, 2500);
        } else {
          setIsTranscribingLyrics(false);
          setIsAligningLyrics(false);
        }
      } catch {
        setIsTranscribingLyrics(false);
        setIsAligningLyrics(false);
      }
    })();
  }, [readAddress, vocalLanguage]);

  const wipHydratedRef = useRef<boolean>(false);
  const lastWipRef = useRef<any>(null);

  // Fetch real takes, commits, and multitrack stems from API
  const loadSongData = useCallback(async () => {
    const effectiveAddress = readAddress || song.creator || '';
    const storageAddress = readAddress || song.creator || 'public';
    const scope = scopeRef.current;

    const fetchAndHydrateRemoteWip = async () => {
      try {
        const wipRes = await sdk.fetch(`/api/editing/wip/${encodeURIComponent(song.id)}`, {
          ...(effectiveAddress ? { userAddress: effectiveAddress } : {}),
        });
        if (wipRes.ok) {
          const wipData = await wipRes.json();
          if (wipData?.wip && scope === scopeRef.current && useDawStore.getState().songId === song.id) {
            const remoteUpdatedAt = Number(wipData.wip.updatedAt || 0);
            const localUpdatedAt = Number(lastWipRef.current?.updatedAt || 0);
            if (!lastWipRef.current || remoteUpdatedAt >= localUpdatedAt) {
              lastWipRef.current = wipData.wip;
              try {
                localStorage.setItem(`rawchunks:wip:v1:${song.id}`, JSON.stringify(wipData.wip));
              } catch { }
              useDawStore.getState().hydrateWipSnapshot(wipData.wip);
            }
          }
        }
      } catch { }
    };

    try {
      const history = await queryClient.fetchQuery({
        queryKey: ['history', song.id, effectiveAddress || 'public'], staleTime: 0,
        queryFn: async () => {
          const response = await sdk.fetch(`/api/editing/history/${song.id}`, effectiveAddress ? { userAddress: effectiveAddress } : {});
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || 'Could not load song history');
          return result;
        },
      });
      if (scope !== scopeRef.current || useDawStore.getState().songId !== song.id) return;
      setTakes(history.takes);
      setCommits(history.commits);
      const baseTake =
        history.takes.find((t: Take) => t.task === 'text2music') ??
        history.takes.find((t: Take) => t.is_active);
      const initialLyrics =
        history.takes.find((t: Take) => t.is_active && t.lyrics && t.lyrics !== '[Instrumental]')?.lyrics ??
        history.takes.find((t: Take) => t.task === 'text2music' && t.lyrics && t.lyrics !== '[Instrumental]')?.lyrics ??
        history.takes.find((t: Take) => t.task === 'extract' && t.lyrics && t.lyrics !== '[Instrumental]')?.lyrics ??
        history.takes.map((t: Take) => (t.provenance?.parameters as any)?.transcribedLyrics).find((l: any) => typeof l === 'string' && l.trim() && l.trim() !== '[Instrumental]');
      const initialAlignment =
        history.takes
          .map((t: Take) => (t.provenance?.parameters as any)?.lyricsAlignment)
          .find((a: any) => a && Array.isArray(a.lines) && a.lines.length > 0) ?? null;
      if (initialAlignment) {
        setLyricsAlignment(initialAlignment);
      }
      const hasVocalsStem =
        Array.isArray(history.stems) &&
        history.stems.some((s: any) => String(s.name || s.stem_type || '').toLowerCase() === 'vocals' && s.url);
      if (initialLyrics) {
        setLyrics(prev => prev || initialLyrics);
        setHasExistingLyrics(true);
        setIsTranscribingLyrics(false);
        if (!initialAlignment && hasVocalsStem) {
          pollSongLyrics(song.id);
        }
      } else if (hasVocalsStem) {
        pollSongLyrics(song.id);
      }
      if (baseTake?.provenance?.parameters) {
        const rawParams = baseTake.provenance.parameters as Record<string, any>;
        const submitted = (rawParams.submitted ?? rawParams) as Record<string, any>;
        const resolved = (rawParams.resolved ?? {}) as Record<string, any>;
        const explicitSubmittedLang =
          rawParams.submitted?.vocalLanguage ||
          rawParams.submitted?.vocal_language ||
          resolved.vocal_language;
        if (typeof explicitSubmittedLang === 'string' && explicitSubmittedLang && explicitSubmittedLang !== 'unknown') {
          setVocalLanguage(explicitSubmittedLang);
        }
        setParameters(prev => {
          const next = { ...prev };
          const baseBpm = submitted.bpm ?? resolved.bpm;
          const baseKey = submitted.keyScale ?? submitted.keyscale ?? resolved.keyscale;
          const baseTimeSig = submitted.timeSignature ?? submitted.time_signature ?? submitted.timesignature ?? resolved.timesignature;
          if (baseBpm && !next.bpm) next.bpm = Number(baseBpm);
          if (baseKey && !next.keyScale) next.keyScale = String(baseKey);
          if (baseTimeSig && !next.timeSignature) next.timeSignature = String(baseTimeSig);
          return next;
        });
      }
      const completed = new Set(history.takes.map((take: Take) => take.provenance?.taskId).filter(Boolean));
      useDawStore.setState(state => ({ operations: state.operations.filter(operation => !completed.has(operation.id)) }));
      if (!sessionRef.current) { restoreSession(history.commits); sessionRef.current = true; }
      syncStems(history.stems);
      if (lastWipRef.current) {
        useDawStore.getState().hydrateWipSnapshot(lastWipRef.current);
      }
      await fetchAndHydrateRemoteWip();
      wipHydratedRef.current = true;
      const state = useDawStore.getState();
      writeProject({ song: { ...song, url: state.tracks.find(track => track.id === 'master')?.clips[0]?.url ?? song.url, duration: state.duration }, ...history, session: { tracks: state.tracks, originals: state.originals, operations: state.operations, bpm: state.bpm } }, storageAddress);
    } catch (err) {
      await fetchAndHydrateRemoteWip();
      wipHydratedRef.current = true;
    }
  }, [song, readAddress, setTakes, setCommits, syncStems, restoreSession, queryClient, pollSongLyrics]);

  const activeSongIdRef = useRef<string | null>(null);

  // Initialize DAW Engine and Project Store on Mount
  useEffect(() => {
    const isNewSong = activeSongIdRef.current !== song.id;
    if (isNewSong) {
      dawEngine.resetProject();
      activeSongIdRef.current = song.id;
      wipHydratedRef.current = false;
      lastWipRef.current = null;
    } else if (sessionRef.current) {
      return;
    }
    const initialDur = typeof song.duration === 'number' && song.duration > 0 ? song.duration : 60;
    const cached =
      (readAddress ? readProject(song.id, readAddress) : null) ??
      (song.creator ? readProject(song.id, song.creator) : null) ??
      readProject(song.id, 'public');
    sessionRef.current = Boolean(cached?.session || cached?.commits.some(commit => Array.isArray(commit.timeline_snapshot?.tracks)));
    initProject(song.id, song.title, initialDur, song.url, cached ?? undefined);

    try {
      const rawLocalWip = localStorage.getItem(`rawchunks:wip:v1:${song.id}`);
      if (rawLocalWip) {
        const parsedLocalWip = JSON.parse(rawLocalWip);
        if (parsedLocalWip && typeof parsedLocalWip === 'object') {
          lastWipRef.current = parsedLocalWip;
          useDawStore.getState().hydrateWipSnapshot(parsedLocalWip);
        }
      }
    } catch { }

    const master = useDawStore.getState().tracks.find(track => track.id === 'master')?.clips[0];
    if (master) {
      void dawEngine.loadClip('master', master.id, master.url, master.startTime, master.offset, master.duration);
    }

    dawEngine.setTimeCallback((seconds) => {
      setPlayhead(seconds);
    });
  }, [song.id, song.url, readAddress, initProject, setPlayhead]);

  useEffect(() => {
    return () => {
      activeSongIdRef.current = null;
      dawEngine.resetProject();
      for (const timer of pollTimersRef.current.values()) clearTimeout(timer);
      pollTimersRef.current.clear();
    };
  }, [song.id]);

  useEffect(() => { void loadSongData(); }, [loadSongData]);

  const autoPolledSongRef = useRef<string>('');
  useEffect(() => {
    if (!readAddress || lyricsAlignment || isTranscribingLyrics || isAligningLyrics) return;
    const hasVocalsTrack = tracks.some(
      t => String(t.stemType || t.name || '').toLowerCase() === 'vocals' && t.clips.length > 0,
    );
    if (hasVocalsTrack && autoPolledSongRef.current !== song.id) {
      autoPolledSongRef.current = song.id;
      pollSongLyrics(song.id);
    }
  }, [song.id, readAddress, tracks, lyricsAlignment, isTranscribingLyrics, isAligningLyrics, pollSongLyrics]);

  const synthScheduleSignature = useMemo(() => {
    return tracks
      .filter((t) => t.type === 'pianoroll' || t.type === 'sequencer' || t.type === 'strudel')
      .map((t) => JSON.stringify({
        id: t.id,
        type: t.type,
        mounted: t.mounted,
        muted: t.mixer?.muted ?? t.muted,
        solo: t.mixer?.solo ?? t.solo,
        activeVersionId: t.activeVersionId,
        notes: t.pianoRollNotes,
        voices: t.sequencerVoices,
        code: t.strudelCode,
      }))
      .join('|');
  }, [tracks]);

  useEffect(() => {
    for (const track of useDawStore.getState().tracks) {
      if (track.type === 'pianoroll' || track.type === 'sequencer' || track.type === 'strudel') {
        dawEngine.scheduleTrack(track);
      }
    }
  }, [synthScheduleSignature]);

  // Master Transport Controls
  const handleTogglePlay = async () => {
    if (isPlaying) {
      dawEngine.pauseTransport();
      setPlaying(false);
    } else {
      try { await dawEngine.startTransport(); }
      catch (error) { toast.error(error instanceof Error ? error.message : 'Could not play the arrangement'); }
    }
  };

  const handleReturnToZero = () => {
    dawEngine.seek(0);
    setPlayhead(0);
  };

  const handleToggleLoop = () => {
    const nextLoop = !loop;
    setLoop(nextLoop);
    if (selection) {
      dawEngine.setLoop(nextLoop, selection.start, selection.end);
    } else {
      dawEngine.setLoop(nextLoop, 0, duration > 0 ? duration : 60);
    }
  };

  const handleAuditionSelection = () => {
    if (selection) {
      void dawEngine.auditionSection(selection.start, selection.end, false).catch(error => toast.error(error instanceof Error ? error.message : 'Could not play the section'));
    }
  };

  // Global Keyboard Shortcuts (Space, Shift+Space, L, 0, M, S, Escape, Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName) || (e.target as HTMLElement)?.isContentEditable) {
        return;
      }
      if (e.metaKey || e.ctrlKey) {
        if ((e.key === 'z' || e.key === 'Z') && !e.altKey) {
          e.preventDefault();
          if (e.shiftKey) {
            handleRedo();
          } else {
            handleUndo();
          }
        } else if ((e.key === 'y' || e.key === 'Y') && !e.altKey) {
          e.preventDefault();
          handleRedo();
        }
        return;
      }
      if (e.altKey) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (e.shiftKey) {
          handleAuditionSelection();
        } else {
          handleTogglePlay();
        }
      } else if (e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        handleToggleLoop();
      } else if (e.key === 'Home' || e.key === '0') {
        e.preventDefault();
        handleReturnToZero();
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        const targetId = selectedTrackId || 'master';
        const st = useDawStore.getState();
        const track = st.tracks.find((t) => t.id === targetId);
        if (track) {
          const currentMuted = track.mixer?.muted ?? track.muted ?? false;
          st.updateTrackMixer(targetId, { muted: !currentMuted });
        }
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        const targetId = selectedTrackId || 'master';
        const st = useDawStore.getState();
        const track = st.tracks.find((t) => t.id === targetId);
        if (track) {
          const currentSolo = track.mixer?.solo ?? track.solo ?? false;
          st.updateTrackMixer(targetId, { solo: !currentSolo });
        }
      } else if (e.key === 'Escape') {
        if (useDawStore.getState().selection) {
          e.preventDefault();
          setSelection(null);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlaying, loop, selection, selectedTrackId, takes, setSelection, handleUndo, handleRedo]);

  // Track Creation via '+' Tool Selector
  const handleAddTrack = (type: TrackType) => {
    const newTrack = addTrack(type);
    setSelectedTrackId(newTrack.id);
    if (type === 'sample') setActiveTool('sample');
    if (type === 'pianoroll') setActiveTool('keys');
    if (type === 'sequencer') setActiveTool('drums');
    if (type === 'strudel') setActiveTool('strudel');
    setMobileFocus('toolbox');
    setToolboxRevision((v) => v + 1);
  };

  // Commit Snapshot
  const handleCreateCommit = async () => {
    if (!commitMessage.trim()) {
      toast.error('Please enter a commit message');
      return;
    }
    if (!effectiveAddress) {
      toast.error('Wallet connection required to commit snapshots');
      return;
    }
    try {
      const st = useDawStore.getState();
      const res = await sdk.fetch('/api/editing/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          songId: song.id,
          userAddress: effectiveAddress,
          message: commitMessage,
          snapshot: {
            tracks,
            bpm,
            duration,
            originals: st.originals,
          },
        }),
      });

      if (!res.ok) throw new Error('Failed to create commit');
      toast.success('Project snapshot committed to studio timeline!');
      setIsCommitModalOpen(false);
      setCommitMessage('');
      await loadSongData();
    } catch (err: any) {
      toast.error(err.message || 'Commit snapshot failed');
    }
  };

  const showResult = async (data: { take?: Take }) => {
    if (data.take) useDawStore.getState().upsertTake(data.take);
    await loadSongData();
    if (data.take) {
      if (isFullSongRestyleTake(data.take)) {
        setSelectedTrackId('master');
        toast.success('Master restyle take ready');
        return;
      }
      if (isLayerTake(data.take)) {
        const stemType = layerTrackName(data.take);
        const laneTrack = useDawStore.getState().tracks.find(t => t.stemType === stemType);
        setSelectedTrackId(laneTrack?.id ?? 'master');
        setSelection(interval(data.take, useDawStore.getState().duration));
        toast.success('Layer take ready in Lanes');
        return;
      }
      const currentState = useDawStore.getState();
      const isAlreadyMounted = currentState.tracks.some(
        t => t.id === data.take!.id && t.activeTakeId === data.take!.id,
      );
      if (!isAlreadyMounted) {
        await currentState.toggleTake(data.take.id);
      }
      setSelectedTrackId(data.take.id);
      setSelection(interval(data.take, useDawStore.getState().duration));
      toast.success('Section ready');
    } else {
      if (!lyrics.trim() || !lyricsAlignment) pollSongLyrics(song.id);
      toast.success('Tracks ready');
    }
  };

  const pollTask = (job: { taskId: string; task: Task; stemId?: string }, address: string) => {
    const scope = scopeRef.current;
    const prevTimer = pollTimersRef.current.get(job.taskId);
    if (prevTimer) clearTimeout(prevTimer);
    const query = new URLSearchParams({ songId: song.id, task: job.task, userAddress: address });
    if (job.stemId) query.set('stemId', job.stemId);
    const poll = async () => {
      try {
        const response = await sdk.fetch(`/api/editing/status/${encodeURIComponent(job.taskId)}?${query}`, { userAddress: address });
        const data = await response.json();
        if (scope !== scopeRef.current) return;
        if (!response.ok || data.status === 'error') throw new Error(data.error || 'Audio processing failed');
        setProgress(data.progress);
        useDawStore.setState(state => ({ operations: state.operations.map(item => item.id === job.taskId ? { ...item, status: data.status, progress: data.progress } : item) }));
        if (data.status === 'ready') {
          pollTimersRef.current.delete(job.taskId);
          const remaining = useDawStore.getState().operations.filter(item => item.id !== job.taskId && (item.status === 'pending' || item.status === 'processing' || item.status === 'submitting')).length;
          if (remaining === 0) setProcessing(false);
          setProgress(100);
          await showResult(data);
          useDawStore.setState(state => ({ operations: state.operations.filter(item => item.id !== job.taskId) }));
        } else {
          pollTimersRef.current.set(job.taskId, setTimeout(poll, 1000));
        }
      } catch (error) {
        if (scope !== scopeRef.current) return;
        pollTimersRef.current.delete(job.taskId);
        const remaining = useDawStore.getState().operations.filter(item => item.id !== job.taskId && (item.status === 'pending' || item.status === 'processing' || item.status === 'submitting')).length;
        if (remaining === 0) setProcessing(false);
        const message = error instanceof Error ? error.message : 'Failed to check audio status';
        useDawStore.setState(state => ({ operations: state.operations.filter(item => item.id !== job.taskId) }));
        toast.error(message);
      }
    };
    pollTimersRef.current.set(job.taskId, setTimeout(poll, 600));
  };

  useEffect(() => {
    const storageAddress = readAddress || song.creator || 'public';
    let saveTimer: ReturnType<typeof setTimeout> | null = null;

    const persistLocalAndRemote = (state: ReturnType<typeof useDawStore.getState>, syncRemote = true) => {
      if (!wipHydratedRef.current || state.songId !== song.id) return;
      const cached =
        (readAddress ? readProject(song.id, readAddress) : null) ??
        (song.creator ? readProject(song.id, song.creator) : null) ??
        readProject(song.id, 'public');
      const masterUrl = state.tracks.find(track => track.id === 'master')?.clips[0]?.url ?? cached?.song.url ?? song.url;
      const updatedSong = { ...(cached?.song ?? song), url: masterUrl, duration: state.duration };
      const updatedStems = (cached?.stems ?? []).map(stem =>
        stem.name?.toLowerCase() === 'master' || stem.id.startsWith('stem-master') || stem.id.startsWith('stm-master')
          ? { ...stem, url: masterUrl }
          : stem
      );
      writeProject(
        {
          song: updatedSong,
          stems: updatedStems,
          takes: state.takes,
          commits: state.commits,
          session: {
            tracks: state.tracks,
            originals: state.originals,
            operations: state.operations,
            bpm: state.bpm,
          },
        },
        storageAddress,
      );
      try {
        const raw = sessionStorage.getItem('rawchunks_editing_song');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.id === song.id) {
            sessionStorage.setItem('rawchunks_editing_song', JSON.stringify({ ...parsed, url: masterUrl, duration: state.duration }));
          }
        }
      } catch { }

      const wipSnapshot = {
        ...state.buildWipSnapshot(),
        updatedAt: Date.now(),
      };
      lastWipRef.current = wipSnapshot;
      try {
        localStorage.setItem(`rawchunks:wip:v1:${song.id}`, JSON.stringify(wipSnapshot));
      } catch { }

      if (syncRemote) {
        void sdk.fetch(`/api/editing/wip/${encodeURIComponent(song.id)}`, {
          method: 'PUT',
          ...(readAddress ? { userAddress: readAddress } : {}),
          keepalive: true,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...wipSnapshot,
            userAddress: storageAddress,
            wip: wipSnapshot,
          }),
        }).catch(() => { });
      }
    };

    const unsub = useDawStore.subscribe((state, previous) => {
      if (!wipHydratedRef.current || state.songId !== song.id) return;
      if (
        !historyRef.current.isApplying &&
        (state.tracks !== previous.tracks || state.bpm !== previous.bpm || state.originals !== previous.originals)
      ) {
        const now = performance.now();
        if (now - historyRef.current.lastPushTime > 400 || historyRef.current.past.length === 0) {
          historyRef.current.past = [
            ...historyRef.current.past.slice(-34),
            {
              tracks: structuredClone(previous.tracks),
              bpm: previous.bpm,
              originals: structuredClone(previous.originals),
            },
          ];
        }
        historyRef.current.lastPushTime = now;
        historyRef.current.future = [];
        setHistoryCounts({ past: historyRef.current.past.length, future: 0 });
      }
      if (
        state.tracks !== previous.tracks ||
        state.takes !== previous.takes ||
        state.commits !== previous.commits ||
        state.operations !== previous.operations ||
        state.originals !== previous.originals ||
        state.bpm !== previous.bpm ||
        state.sectionGain !== previous.sectionGain ||
        state.sectionLow !== previous.sectionLow ||
        state.sectionMid !== previous.sectionMid ||
        state.sectionHigh !== previous.sectionHigh
      ) {
        persistLocalAndRemote(state, false);
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          saveTimer = null;
          persistLocalAndRemote(useDawStore.getState(), true);
        }, 250);
      }
    });

    const handleFlush = () => {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      persistLocalAndRemote(useDawStore.getState(), true);
    };
    window.addEventListener('pagehide', handleFlush);
    window.addEventListener('beforeunload', handleFlush);

    return () => {
      window.removeEventListener('pagehide', handleFlush);
      window.removeEventListener('beforeunload', handleFlush);
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
        persistLocalAndRemote(useDawStore.getState(), true);
      }
      unsub();
    };
  }, [song, readAddress]);

  useEffect(() => {
    if (!readAddress) return;
    const pending = useDawStore.getState().operations.find(operation => ['pending', 'processing'].includes(operation.status));
    if (pending) { setProcessing(true); pollTask({ taskId: pending.id, task: pending.task as Task, stemId: pending.stemId }, readAddress); }
  }, [song.id, readAddress]);

  // Demix Stems
  const handleSeparateStems = async () => {
    if (processing) return;
    if (!effectiveAddress) { toast.error('Connect your account to separate tracks'); return; }
    if (!session.active) {
      toast.error('Active session required to separate tracks. Please create a session.');
      promptSessionModal();
      return;
    }
    setProcessing(true);
    setProgress(undefined);
    const operation = crypto.randomUUID();
    const scope = scopeRef.current;
    useDawStore.setState(state => ({ operations: [...state.operations, { id: operation, task: 'extract', status: 'submitting' }] }));
    try {
      const res = await sdk.fetch('/api/editing/separate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          songId: song.id,
          userAddress: effectiveAddress,
          stemType: 'all',
        }),
      });

      if (!res.ok) {
        if (res.status === 402) {
          setProcessing(false);
          useDawStore.setState(state => ({ operations: state.operations.filter(item => item.id !== operation) }));
          toast.error('Active session required or session budget exhausted. Please top up your session.');
          promptSessionModal();
          return;
        }
        const err = await res.json();
        throw new Error(err.error || 'Failed to separate stems');
      }

      const data = await res.json();
      if (scope !== scopeRef.current) return;
      useDawStore.setState(state => ({ operations: state.operations.map(item => item.id === operation ? { ...item, id: data.taskId ?? operation, status: data.status } : item) }));
      if (data.status === 'ready') {
        setProcessing(false);
        setProgress(100);
        await loadSongData();
        if (!lyrics.trim() || !lyricsAlignment) pollSongLyrics(song.id);
        useDawStore.setState(state => ({ operations: state.operations.filter(item => item.id !== (data.taskId ?? operation)) }));
        toast.success('Tracks separated');
        return;
      }
      toast.success('Separating tracks...');
      if (data.taskId) {
        pollTask({ taskId: data.taskId, task: data.task, stemId: data.stemId }, effectiveAddress!);
      }
    } catch (err: any) {
      if (scope !== scopeRef.current) return;
      setProcessing(false);
      useDawStore.setState(state => ({ operations: state.operations.filter(item => item.id !== operation) }));
      toast.error(err.message || 'Stem isolation failed');
    }
  };

  // Explicit on-demand Scribe lyrics extraction from the isolated vocal stem
  const handleExtractLyrics = useCallback(async () => {
    const addr = effectiveAddress || readAddress;
    if (!addr) {
      toast.error('Connect your account to extract lyrics');
      return;
    }
    if (isTranscribingLyrics) return;
    setIsTranscribingLyrics(true);
    const scope = scopeRef.current;
    try {
      const res = await sdk.fetch(`/api/editing/lyrics/${encodeURIComponent(song.id)}`, {
        method: 'POST',
        userAddress: addr,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocalLanguage: vocalLanguage || 'en', mode: 'extract' }),
      });
      const data = await res.json();
      if (scope !== scopeRef.current || useDawStore.getState().songId !== song.id) return;
      if (!res.ok) {
        throw new Error(data.error || 'Failed to extract lyrics');
      }
      if (data.status === 'no_vocals_stem') {
        setIsTranscribingLyrics(false);
        toast.info('Separating stems first to isolate the vocal lane for lyrics extraction...');
        await handleSeparateStems();
        return;
      }
      if (data.alignment && Array.isArray(data.alignment.lines) && data.alignment.lines.length > 0) {
        setLyricsAlignment(data.alignment);
      }
      if (typeof data.lyrics === 'string' && data.lyrics.trim()) {
        setLyrics(data.lyrics);
        setHasExistingLyrics(data.lyrics.trim() !== '[Instrumental]');
        toast.success('Lyrics extracted & synced from vocal stem');
      } else {
        toast.info('No vocals detected in the isolated vocal stem');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Could not extract lyrics');
    } finally {
      if (scope === scopeRef.current) {
        setIsTranscribingLyrics(false);
      }
    }
  }, [effectiveAddress, readAddress, isTranscribingLyrics, song.id, vocalLanguage]);

  // Explicit forced-alignment of existing/edited lyrics against the isolated vocal stem
  const handleAlignLyrics = useCallback(async (customLyrics?: string) => {
    const addr = effectiveAddress || readAddress;
    if (!addr) {
      toast.error('Connect your account to sync lyrics');
      return;
    }
    const textToAlign = (customLyrics ?? lyrics).trim();
    if (!textToAlign || textToAlign === '[Instrumental]') {
      toast.info('Add or extract lyrics first before syncing to timeline');
      return;
    }
    if (isAligningLyrics) return;
    setIsAligningLyrics(true);
    const scope = scopeRef.current;
    try {
      const res = await sdk.fetch(`/api/editing/lyrics/${encodeURIComponent(song.id)}`, {
        method: 'POST',
        userAddress: addr,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vocalLanguage: vocalLanguage || 'en',
          lyrics: textToAlign,
          mode: 'align',
        }),
      });
      const data = await res.json();
      if (scope !== scopeRef.current || useDawStore.getState().songId !== song.id) return;
      if (!res.ok) {
        throw new Error(data.error || 'Failed to sync lyrics to timeline');
      }
      if (data.status === 'no_vocals_stem') {
        setIsAligningLyrics(false);
        toast.info('Separating stems first to isolate the vocal lane for timeline sync...');
        await handleSeparateStems();
        return;
      }
      if (data.alignment && Array.isArray(data.alignment.lines) && data.alignment.lines.length > 0) {
        setLyricsAlignment(data.alignment);
        toast.success('Lyrics synced with vocal timeline');
      } else {
        toast.info('Could not align lyrics to vocal audio');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Could not sync lyrics to timeline');
    } finally {
      if (scope === scopeRef.current) {
        setIsAligningLyrics(false);
      }
    }
  }, [effectiveAddress, readAddress, isAligningLyrics, lyrics, song.id, vocalLanguage]);

  // AI Task Execution Dispatcher
  const handleApplyEdit = async () => {
    if (processing) return;

    if (!effectiveAddress) {
      toast.error('Wallet connection required to process audio');
      return;
    }

    if (!session.active) {
      toast.error('Active session required to process audio. Please create a session.');
      promptSessionModal();
      return;
    }

    setProcessing(true);
    setProgress(undefined);
    const operation = crypto.randomUUID();
    const scope = scopeRef.current;
    useDawStore.setState(state => ({ operations: [...state.operations, { id: operation, task, status: 'submitting' }] }));

    try {
      if (!editing || (task !== 'extract' && !selectedQuality)) throw new Error('Music options are unavailable');
      const baseTake = takes.find(t => t.task === 'text2music') ?? takes.find(t => t.is_active);
      const globalCaption = [
        ...(Array.isArray(song.tags) ? song.tags : []),
        baseTake?.prompt || '',
      ]
        .map(s => s.trim())
        .filter(Boolean)
        .join(', ');

      let endpoint = '/api/editing/repaint';
      let payload: any = {
        songId: song.id,
        stemId: (() => { const candidate = takes.find(take => take.id === selectedTrackId); const id = candidate ? source(candidate, tracks) : selectedTrackId; if (!id) throw new Error('The source lane is unavailable'); return id !== 'master' ? id : undefined; })(),
        userAddress: effectiveAddress,
        modelQuality:
          task === 'extract'
            ? undefined
            : task === 'lego' || task === 'complete'
              ? 'base'
              : selectedQuality,
        vocalLanguage: vocalLanguage || 'en',
        globalCaption: globalCaption || undefined,
        ...Object.fromEntries(Object.entries(parameters).filter(([key]) => editing.parameters[key]?.tasks?.includes(task))),
      };
      if (typeof payload.trackClasses === 'string') payload.trackClasses = payload.trackClasses.split(',').map((value: string) => value.trim()).filter(Boolean);

      if (task === 'repaint' && !selection) throw new Error('Select a section to rework');
      const selectedTake = takes.find(take => take.id === selectedTrackId);
      const sourceRegion = selection && selectedTake ? sourceInterval(selectedTake, tracks, selection) : selection;
      const start = sourceRegion?.start;
      const end = sourceRegion?.end;

      const mountedOverlayIds = tracks
        .filter(
          t =>
            t.id === t.activeTakeId &&
            !t.muted &&
            takes.some(
              tk =>
                tk.id === t.id &&
                !tk.provenance?.mergedInto &&
                (!tk.stem_id || tk.provenance?.target === 'master'),
            ),
        )
        .map(t => t.id);

      if (selectedTake && task !== 'lego') {
        payload.sourceTakeId = selectedTake.id;
        payload.srcAudioUrl = selectedTake.url;
      } else if (!payload.stemId && task !== 'lego' && (mountedOverlayIds.length > 0 || useDawStore.getState().originals.length > 0)) {
        try {
          const compositeAudio = await dawEngine.render(['master', ...mountedOverlayIds], duration, true);
          const form = new FormData();
          form.append('file', compositeAudio, 'master-composite.wav');
          const upload = await sdk.fetch(`/api/editing/source?songId=${encodeURIComponent(song.id)}`, { method: 'POST', body: form });
          const uploaded = await upload.json();
          if (upload.ok && uploaded.url) {
            payload.srcAudioUrl = uploaded.url;
          }
        } catch (_) {
          // Fallback to backend active master URL if offline audio rendering is unavailable
        }
      }

      if (task === 'repaint') {
        endpoint = '/api/editing/repaint';
        payload = {
          ...payload,
          prompt: prompt.trim() ? prompt.trim() : undefined,
          lyrics: lyrics.trim() ? lyrics : undefined,
          start,
          end,
          repaint_mode: repaintMode,
          repaint_strength: repaintMode === 'balanced' ? repaintStrength : undefined,
        };
      } else if (task === 'lego') {
        if (!instrument.trim()) throw new Error('Enter the instrument to add');
        if (!prompt.trim()) throw new Error('Describe the new part');
        const replacementOverlayIds = mountedOverlayIds.filter(id => {
          const tk = takes.find(t => t.id === id);
          return tk && tk.task !== 'lego';
        });
        const effectiveLegoIds = legoContextTrackIds.includes('master')
          ? Array.from(new Set([...legoContextTrackIds, ...replacementOverlayIds]))
          : legoContextTrackIds;
        const audio = await dawEngine.render(effectiveLegoIds, duration, true);
        const source = new FormData();
        source.append('file', audio, 'reference.wav');
        const upload = await sdk.fetch(`/api/editing/source?songId=${encodeURIComponent(song.id)}`, { method: 'POST', body: source });
        const uploaded = await upload.json();
        if (!upload.ok || !uploaded.url) throw new Error(uploaded.error || 'Could not save reference audio');
        const isVocalInstrument = instrument.trim() === 'vocals' || instrument.trim() === 'backing_vocals';
        endpoint = '/api/editing/layer';
        payload = {
          ...payload,
          stemId: undefined,
          srcAudioUrl: uploaded.url,
          trackName: instrument.trim(),
          prompt: prompt.trim(),
          lyrics: isVocalInstrument ? (lyrics.trim() ? lyrics : undefined) : '[Instrumental]',
          vocalLanguage: vocalLanguage || 'en',
          globalCaption: globalCaption || undefined,
          start,
          end,
          audioDuration: duration,
          legoContextTrackIds,
        };
      } else if (task === 'complete') {
        if (!prompt.trim()) throw new Error('Describe the accompaniment');
        endpoint = '/api/editing/apply';
        payload = {
          ...payload,
          task: 'complete',
          prompt: prompt.trim(),
          lyrics: lyrics.trim() ? lyrics : undefined,
          start,
          end,
          audioDuration: duration,
        };
      } else if (task === 'extend') {
        endpoint = '/api/editing/extend';
        payload = {
          ...payload,
          prompt: prompt.trim() ? prompt.trim() : undefined,
          lyrics: lyrics.trim() ? lyrics : undefined,
          start,
          end,
          audioDuration: targetDuration,
        };
      } else if (task === 'cover') {
        if (!prompt.trim()) throw new Error('Describe the style transformation');
        endpoint = '/api/editing/remix';
        payload = {
          ...payload,
          prompt: prompt.trim(),
          lyrics: lyrics.trim() ? lyrics : undefined,
          start,
          end,
          coverStrength,
          coverNoiseStrength: parameters.coverNoiseStrength,
        };
      } else if (task === 'extract') {
        const demucsStems = new Set(['all', 'vocals', 'drums', 'bass', 'other', 'instrumental']);
        const normalizedStem = (stemType || 'all').trim().toLowerCase();
        if (demucsStems.has(normalizedStem)) {
          endpoint = '/api/editing/separate';
          payload = {
            ...payload,
            stemType: normalizedStem,
          };
        } else {
          endpoint = '/api/editing/apply';
          payload = {
            ...payload,
            task: 'extract',
            trackName: normalizedStem,
            modelQuality: 'base',
          };
        }
      }

      const res = await sdk.fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        if (res.status === 402) {
          setProcessing(false);
          useDawStore.setState(state => ({ operations: state.operations.filter(item => item.id !== operation) }));
          toast.error('Active session required or session budget exhausted. Please top up your session.');
          promptSessionModal();
          return;
        }
        const err = await res.json();
        throw new Error(err.error || `Failed to dispatch ${task}`);
      }

      const data = await res.json();
      if (scope !== scopeRef.current) return;
      useDawStore.setState(state => ({ operations: state.operations.map(item => item.id === operation ? { ...item, id: data.taskId ?? operation, status: data.status, stemId: data.stemId } : item) }));
      if (data.status === 'ready') {
        setProcessing(false);
        setProgress(100);
        await showResult(data);
        useDawStore.setState(state => ({ operations: state.operations.filter(item => item.id !== (data.taskId ?? operation)) }));
        return;
      }
      toast.success('Processing audio...');
      if (data.taskId) {
        pollTask({ taskId: data.taskId, task: data.task, stemId: data.stemId }, effectiveAddress!);
      }
    } catch (err: any) {
      if (scope !== scopeRef.current) return;
      setProcessing(false);
      useDawStore.setState(state => ({ operations: state.operations.filter(item => item.id !== operation) }));
      toast.error(err.message || 'Failed to process audio');
    }
  };

  const handleSelectTrack = useCallback((trackId: string) => {
    setSelectedTrackId(trackId);

    if (trackId === 'master') return;

    const currentTakes = useDawStore.getState().takes;
    const selectedTake = currentTakes.find((t) => t.id === trackId);
    if (selectedTake && selectedTake.url) {
      const mounted = useDawStore.getState().tracks.find(track => track.id === trackId && track.id === track.activeTakeId);
      const region = mounted?.clips.length ? { start: Math.min(...mounted.clips.map(clip => clip.startTime)), end: Math.max(...mounted.clips.map(clip => clip.startTime + clip.duration)) } : interval(selectedTake, useDawStore.getState().duration);
      if (region && (!useDawStore.getState().selection || useDawStore.getState().selection!.start < region.start || useDawStore.getState().selection!.end > region.end)) setSelection(region);
      return;
    }

  }, [setSelectedTrackId, setSelection]);

  const handleReworkSection = useCallback(() => {
    const sel = useDawStore.getState().selection;
    if (sel) {
      setTask('repaint');
      setMobileFocus('studio');
      setToolboxRevision(value => value + 1);
    } else {
      toast.error('Select a region on the timeline first to rework');
    }
  }, [setTask]);

  return (
    <div className={`editor-container ${className}`} data-mobile-focus={mobileFocus}>
      {/* Row 1: Top Workstation Bar — [BACK-ARROW] | [TITLE-SECTION] | [CONTROLLERS] | [SESSION+PROFILE] */}
      <div className="editor-header-bar">
        <div className="editor-header-left">
          <Tooltip title="Return to your Page" description="Exit workstation and return to your tracks">
            <Button variant="ghost" size="sm" onClick={onBack} className="editor-back-btn" aria-label="Return to Profile">
              <ArrowLeft size={14} /> <span className="editor-btn-label">PROFILE</span>
            </Button>
          </Tooltip>
          <div className="editor-header-text">
            <div className="editor-title-row">
              <Glitch text={song.title} className="editor-track-title" />
            </div>
            <div className="editor-track-sub">
              <span>{tracks.length} TRACKS</span>
              <span>•</span>
              <span>{takes.length} TAKES</span>
              <span>•</span>
              <EditorBpmControl
                bpm={bpm}
                onChange={(v) => {
                  setBpm(v);
                  dawEngine.setBpm(v);
                }}
              />
              {processing && (
                <>
                  <span>•</span>
                  <Badge variant="secondary">
                    PROCESSING {progress === undefined ? '' : `${progress}%`}
                  </Badge>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="editor-header-actions">
          <GuideTrigger compact />
          <SessionControl />
          <WalletConnector compact />
        </div>
      </div>

      {/* Row 1B: Dedicated Transport Row */}
      <div className="editor-transport-row">
        <EditorTransportDeck fallbackDuration={song.duration} />
      </div>

      {/* Rows 2 & 3: Selected Lane (with Embedded Master Horizon) + Middle Split (Stems Matrix | Manual Toolbox) */}
      <div className="editor-board-wrapper">
        <Board
          song={song}
          selectedTrackId={selectedTrackId}
          onSelectTrack={handleSelectTrack}
          onAddTrack={handleAddTrack}
          onOpenTool={(tool, studioTask) => {
            if (tool === 'studio') {
              if (studioTask) setTask(studioTask);
              setMobileFocus('studio');
            } else {
              setActiveTool(tool as ManualToolTab);
              setMobileFocus('toolbox');
            }
            setToolboxRevision((v) => v + 1);
          }}
          onSeparateStems={handleSeparateStems}
          isSeparating={processing}
          onReworkSection={handleReworkSection}
          lyrics={lyrics}
          onLyricsChange={setLyrics}
          vocalLanguage={vocalLanguage}
          onVocalLanguageChange={setVocalLanguage}
          languages={options.data?.generation?.languages}
          hasExistingLyrics={hasExistingLyrics}
          isTranscribingLyrics={isTranscribingLyrics}
          onExtractLyrics={handleExtractLyrics}
          lyricsAlignment={lyricsAlignment}
          isAligningLyrics={isAligningLyrics}
          onAlignLyrics={handleAlignLyrics}
          task={task}
          instrument={instrument}
          processing={processing}
          reveal={toolboxRevision}
          canUndo={historyCounts.past > 0}
          canRedo={historyCounts.future > 0}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onOpenCommitModal={() => setIsCommitModalOpen(true)}
          toolboxSlot={
            <Toolbox
              activeTool={activeTool}
              onSelectTool={(tool) => {
                if (tool && tool !== 'studio') {
                  setActiveTool(tool);
                }
                setMobileFocus('toolbox');
              }}
              selectedTrackId={selectedTrackId}
              onSelectTrack={handleSelectTrack}
              onOpenCommitModal={() => setIsCommitModalOpen(true)}
              mobileFocused={mobileFocus === 'toolbox'}
              onMobileFocus={() => setMobileFocus('toolbox')}
            />
          }
        />
      </div>

      {/* Row 4: Bottom Split — Standalone AI Studio ([SELECTED AI] | [AI ICON x 6]) */}
      <div className="editor-studio-wrapper">
        <Studio
          options={editing}
          optionsError={options.error?.message}
          languages={options.data?.generation?.languages}
          parameters={parameters}
          onParametersChange={setParameters}
          task={task}
          onSelectTask={(nextTask) => {
            setTask(nextTask);
            setMobileFocus('studio');
          }}
          prompt={prompt}
          onPromptChange={setPrompt}
          lyrics={lyrics}
          onLyricsChange={setLyrics}
          vocalLanguage={vocalLanguage}
          onVocalLanguageChange={setVocalLanguage}
          hasExistingLyrics={hasExistingLyrics}
          isTranscribingLyrics={isTranscribingLyrics}
          onExtractLyrics={handleExtractLyrics}
          lyricsAlignment={lyricsAlignment}
          isAligningLyrics={isAligningLyrics}
          onAlignLyrics={handleAlignLyrics}
          selectedQuality={selectedQuality}
          onQualityChange={setSelectedQuality}
          repaintMode={repaintMode}
          onRepaintModeChange={setRepaintMode}
          repaintStrength={repaintStrength}
          onRepaintStrengthChange={setRepaintStrength}
          instrument={instrument}
          onInstrumentChange={setInstrument}
          coverStrength={coverStrength}
          onCoverStrengthChange={setCoverStrength}
          targetDuration={targetDuration}
          onTargetDurationChange={setTargetDuration}
          stemType={stemType}
          onStemTypeChange={setStemType}
          onExecute={handleApplyEdit}
          processing={processing}
          progress={progress}
          selectedTrackId={selectedTrackId}
          onClearSelection={() => setSelection(null)}
          isFocusedMobile={mobileFocus === 'studio'}
          onFocusMobile={() => setMobileFocus('studio')}
        />
      </div>

      {/* Commit Snapshot Modal Dialog */}
      <Modal
        isOpen={isCommitModalOpen}
        onClose={() => setIsCommitModalOpen(false)}
        title="COMMIT"
        size="sm"
      >
        <div className="editor-modal-body">
          <textarea
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            placeholder="Enter snapshot description (e.g., Added vocal harmony and bassline)..."
            rows={3}
            className="editor-modal-textarea"
          />
          <div className="editor-modal-actions">
            <Button size="sm" variant="ghost" onClick={() => setIsCommitModalOpen(false)}>
              CANCEL
            </Button>
            <Button size="sm" variant="primary" onClick={handleCreateCommit}>
              SAVE
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
