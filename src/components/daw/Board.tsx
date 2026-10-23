import React, { useState, useRef, useLayoutEffect, useEffect } from 'react';
import { useDawStore, type LyricsAlignment } from '../../lib/daw/store';
import { dawEngine } from '../../lib/daw/engine';
import { isIdentityWaveSculpt } from '../../lib/daw/peaks';
import { Waveform } from '../waveform';
import { Clip } from './Clip';
import { Notes } from './Notes';
import { Tooltip } from './Tooltip';
import { Canvas } from './Canvas';
import {
  Play,
  Square,
  RotateCcw,
  Volume2,
  Plus,
  Split,
  Check,
  Sparkles,
  Scissors,
  Trash2,
  Minimize2,
  Drum,
  Key as KeyIcon,
  Layers,
  FilePenLine,
  Music,
  Code,
  Undo2,
  Redo2,
  GitCommit,
} from 'lucide-react';
import { Song, Task } from '../../lib/schema';
import { toast } from 'sonner';
import { TrackType } from '../../lib/daw/store';
import { getStemColor, formatTrackBadgeCode, formatTrackBadgeFull } from '../../lib/daw/palette';
import { isBase, mounted, preview, interval, pending, masterArrangement, taskLabel, isLayerTake, layerTrackName, isFullSongRestyleTake } from '../../lib/daw/takes';

export interface BoardProps {
  song: Song;
  selectedTrackId: string;
  onSelectTrack: (trackId: string) => void;
  onAddTrack: (type: TrackType) => void;
  onOpenTool?: (tool: 'studio' | 'mixer' | 'keys' | 'drums' | 'strudel' | 'dsp' | 'sample' | 'history', studioTask?: Task) => void;
  onSeparateStems: () => void;
  isSeparating: boolean;
  onReworkSection?: () => void;
  lyrics?: string;
  onLyricsChange?: (lyrics: string) => void;
  vocalLanguage?: string;
  onVocalLanguageChange?: (language: string) => void;
  languages?: Array<{ id: string; label: string }>;
  hasExistingLyrics?: boolean;
  isTranscribingLyrics?: boolean;
  onExtractLyrics?: () => void;
  lyricsAlignment?: LyricsAlignment | null;
  isAligningLyrics?: boolean;
  onAlignLyrics?: (customLyrics?: string) => void;
  task?: Task;
  instrument?: string;
  processing?: boolean;
  reveal?: number;
  toolboxSlot?: React.ReactNode;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  onOpenCommitModal?: () => void;
}

const BoardPlayheadLine: React.FC<{ totalDuration: number; showCap?: boolean }> = ({
  totalDuration,
  showCap = false,
}) => {
  const lineRef = useRef<HTMLDivElement>(null);
  const initialPlayhead = useDawStore.getState().playhead;
  const initialPct =
    totalDuration > 0 ? Math.max(0, Math.min(100, (initialPlayhead / totalDuration) * 100)) : 0;

  useEffect(() => {
    const updateLine = (playhead: number) => {
      if (!lineRef.current) return;
      const pct = totalDuration > 0 ? Math.max(0, Math.min(100, (playhead / totalDuration) * 100)) : 0;
      lineRef.current.style.setProperty('--pos-pct', `${pct}%`);
    };
    updateLine(useDawStore.getState().playhead);
    return useDawStore.subscribe((state, prevState) => {
      if (state.playhead !== prevState.playhead) {
        updateLine(state.playhead);
      }
    });
  }, [totalDuration]);

  return (
    <div
      ref={lineRef}
      className="board-playhead-line"
      style={{ '--pos-pct': `${initialPct}%` } as React.CSSProperties}
    >
      {showCap && <div className="board-playhead-cap" />}
    </div>
  );
};

export const Board: React.FC<BoardProps> = ({
  song,
  selectedTrackId,
  onSelectTrack,
  onAddTrack,
  onOpenTool,
  onSeparateStems,
  isSeparating,
  onReworkSection,
  lyrics = '',
  onLyricsChange,
  vocalLanguage = 'en',
  onVocalLanguageChange,
  languages,
  hasExistingLyrics = false,
  isTranscribingLyrics = false,
  onExtractLyrics,
  lyricsAlignment = null,
  isAligningLyrics = false,
  onAlignLyrics,
  task,
  instrument,
  processing = false,
  reveal: _reveal,
  toolboxSlot,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  onOpenCommitModal,
}) => {
  const tracks = useDawStore((s) => s.tracks);
  const duration = useDawStore((s) => s.duration);
  const isPlaying = useDawStore((s) => s.isPlaying);
  const bpm = useDawStore((s) => s.bpm);
  const selection = useDawStore((s) => s.selection);
  const legoContextTrackIds = useDawStore((s) => s.legoContextTrackIds);
  const takes = useDawStore((s) => s.takes);
  const setPlayhead = useDawStore((s) => s.setPlayhead);
  const setSelection = useDawStore((s) => s.setSelection);
  const extractCurrentSection = useDawStore((s) => s.extractCurrentSection);
  const toggleLegoContext = useDawStore((s) => s.toggleLegoContext);
  const updateTrackMixer = useDawStore((s) => s.updateTrackMixer);
  const removeTrack = useDawStore((s) => s.removeTrack);
  const toggleTake = useDawStore((s) => s.toggleTake);
  const activateTake = useDawStore((s) => s.activateTake);
  const selectLaneVersion = useDawStore((s) => s.selectLaneVersion);
  const selectMasterVersion = useDawStore((s) => s.selectMasterVersion);
  const addSynthVersion = useDawStore((s) => s.addSynthVersion);
  const selectSynthVersion = useDawStore((s) => s.selectSynthVersion);
  const pendingTake = useDawStore((s) => s.pendingTake);
  const deleteTake = useDawStore((s) => s.deleteTake);
  const revertToOriginalMaster = useDawStore((s) => s.revertToOriginalMaster);
  const originals = useDawStore((s) => s.originals);
  const operations = useDawStore((s) => s.operations);
  const auditionId = useDawStore((s) => s.auditionId);
  const toggleOriginal = useDawStore((s) => s.toggleOriginal);
  const mergeTakes = useDawStore((s) => s.mergeTakes);
  const moveTake = useDawStore((s) => s.moveTake);
  const sculptMode = useDawStore((s) => s.sculptMode);
  const setSculptMode = useDawStore((s) => s.setSculptMode);
  const resetTrackSculpt = useDawStore((s) => s.resetTrackSculpt);

  const [masterExpanded, setMasterExpanded] = useState(true);
  const [isCanvasOpen, setIsCanvasOpen] = useState<boolean>(false);
  const [isAddMenuOpen, setIsAddMenuOpen] = useState<boolean>(false);
  const [isVaultOpen, setIsVaultOpen] = useState<boolean>(false);
  const [mruIds, setMruIds] = useState<string[]>([]);
  const addMenuRef = useRef<HTMLDivElement | null>(null);
  const vaultMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isAddMenuOpen) return;
    const handlePointerDownOutside = (e: PointerEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setIsAddMenuOpen(false);
      }
    };
    window.addEventListener('pointerdown', handlePointerDownOutside);
    return () => window.removeEventListener('pointerdown', handlePointerDownOutside);
  }, [isAddMenuOpen]);

  useEffect(() => {
    if (!isVaultOpen) return;
    const handlePointerDownOutside = (e: PointerEvent) => {
      if (vaultMenuRef.current && !vaultMenuRef.current.contains(e.target as Node)) {
        setIsVaultOpen(false);
      }
    };
    window.addEventListener('pointerdown', handlePointerDownOutside);
    return () => window.removeEventListener('pointerdown', handlePointerDownOutside);
  }, [isVaultOpen]);

  useEffect(() => {
    if (!selectedTrackId || selectedTrackId === 'master') return;
    setMruIds((prev) => [selectedTrackId, ...prev.filter((id) => id !== selectedTrackId)]);
  }, [selectedTrackId]);

  const hasVocalStem = tracks.some(
    (t) =>
      ['vocals', 'backing_vocals'].includes((t.stemType || t.name || '').toLowerCase()) &&
      t.clips.length > 0,
  );
  const isVocalMacro =
    task === 'repaint' ||
    task === 'cover' ||
    task === 'complete' ||
    task === 'extend' ||
    (task === 'lego' && (instrument === 'vocals' || instrument === 'backing_vocals'));
  const canShowCanvas = Boolean(
    hasExistingLyrics ||
      lyrics.trim().length > 0 ||
      (lyricsAlignment?.lines && lyricsAlignment.lines.length > 0) ||
      hasVocalStem ||
      isVocalMacro,
  );
  const playingTakeId = isPlaying ? auditionId : null;
  const overlays = tracks.filter(
    track =>
      track.id === track.activeTakeId &&
      takes.some(
        take =>
          take.id === track.id &&
          !take.provenance?.mergedInto &&
          !isBase(take, tracks, takes) &&
          !isLayerTake(take) &&
          !isFullSongRestyleTake(take)
      )
  );
  const [drag, setDrag] = useState<{id:string;shift:number} | null>(null);
  const dragging = useRef<{id:string;x:number;shift:number;width:number;minimum:number;maximum:number;current:number} | null>(null);
  const didDrag = useRef(false);
  const selectedOverlay = overlays.find(track => track.id === selectedTrackId);
  const audibleOverlays = overlays.filter(track => !track.muted && (!tracks.some(lane => lane.solo) || track.solo));
  const selectedClip = selectedOverlay?.clips.find(clip => selection && clip.startTime <= selection.start && clip.startTime + clip.duration >= selection.end) ?? selectedOverlay?.clips[0];
  const originalEnabled = Boolean(selectedClip && !originals.some(region => region.start <= selectedClip.startTime && region.end >= selectedClip.startTime + selectedClip.duration));
  const selectedTake = takes.find(take => take.id === selectedOverlay?.id);

  // Group takes by task category & track active take per category
  const [, setActiveCategoryTakeId] = useState<Record<string, string>>({});

  const takesByCategory = React.useMemo(() => {
    const groups: Record<string, typeof takes> = {};
    takes.forEach((take) => {
      if (!pending(take) || isLayerTake(take) || isFullSongRestyleTake(take)) return;
      const cat = (take.task || 'extract').toLowerCase();
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(take);
    });
    return groups;
  }, [takes]);
  const pendingCount = Object.values(takesByCategory).reduce((count, group) => count + group.length, 0);
  const masterRestyleTakes = React.useMemo(
    () =>
      takes
        .filter(take => !take.provenance?.mergedInto && !take.is_active && isFullSongRestyleTake(take))
        .sort((a, b) => a.take_number - b.take_number),
    [takes]
  );

  const extendClips = React.useMemo(
    () =>
      overlays
        .filter(track => !track.muted && takes.some(t => t.id === track.activeTakeId && t.task === 'extend'))
        .flatMap(track =>
          track.clips.map(clip => {
            const shift = drag?.id === track.id ? drag.shift - (clip.startTime - (clip.origin ?? clip.startTime)) : 0;
            return { startTime: clip.startTime + shift, duration: clip.duration };
          }),
        ),
    [overlays, takes, drag],
  );
  const masterLayout = React.useMemo(
    () => masterArrangement(duration > 0 ? duration : 60, extendClips),
    [duration, extendClips],
  );
  const totalDuration = Math.max(
    masterLayout.duration,
    ...overlays.flatMap(track => track.clips.map(clip => clip.startTime + clip.duration)),
  );
  const viewportRef = useRef<HTMLDivElement | null>(null);

  // Group tracks into: Master, Lanes (stems + custom tracks), and Extracted (Takes / isolates)
  const masterTrack = tracks.find((t) => t.id === 'master') || tracks[0];
  const laneTracks = tracks.filter((t) => t.id !== 'master' && t.id !== t.activeTakeId);
  const positions = useRef(new Map<string, number>());
  const movements = useRef(new Map<string, Animation>());
  useLayoutEffect(() => () => {
    movements.current.forEach(animation => animation.cancel());
    movements.current.clear();
  }, []);
  useLayoutEffect(() => {
    const rows = viewportRef.current?.querySelectorAll<HTMLElement>('[data-track-id]');
    const next = new Map<string, number>();
    rows?.forEach(row => {
      const id = row.dataset.trackId!;
      const top = row.offsetTop;
      const previous = positions.current.get(id);
      next.set(id, top);
      if (previous === undefined || previous === top || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      movements.current.get(id)?.cancel();
      movements.current.set(id, row.animate([
        { transform: `translateY(${previous - top}px)` },
        { transform: 'translateY(0)' },
      ], { duration: 420, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }));
    });
    positions.current = next;
  }, [tracks, selectedTrackId]);
  const hasExtractedStems = laneTracks.some(track => track.type === 'stem' && track.clips.length > 0);
  const separated = laneTracks.filter(
    track =>
      track.mounted !== false &&
      (track.clips.length > 0 ||
        track.type === 'pianoroll' ||
        track.type === 'sequencer' ||
        track.type === 'strudel' ||
        track.type === 'sample')
  );
  const completeSeparation = ['drums', 'bass', 'other'].every(name => separated.some(track => track.name.toLowerCase() === name));
  const masterLanes = separated.filter(track => !completeSeparation || track.name.toLowerCase() !== 'instrumental');
  const selectedLane = separated.find(track => track.id === selectedTrackId);
  const highlighted = completeSeparation && selectedLane?.name.toLowerCase() === 'instrumental'
    ? masterLanes.filter(track => track.name.toLowerCase() !== 'vocals').map(track => track.id)
    : [selectedTrackId];

  // Format seconds to mm:ss.ms
  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 10);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms}`;
  };

  // Helper to clear any soloed non-master tracks so Master plays all instruments together
  const clearNonMasterSolos = () => {
    const currentTracks = useDawStore.getState().tracks;
    currentTracks.forEach((t) => {
      if (t.id !== 'master' && t.solo) {
        updateTrackMixer(t.id, { solo: false });
      }
    });
  };

  // Timeline seek & interactive scrubbing on ruler
  const isScrubbingRulerRef = useRef(false);
  const scrubRulerAtClientX = (el: HTMLElement, clientX: number, startIfPaused = false) => {
    const rect = el.getBoundingClientRect();
    const clickX = clientX - rect.left;
    const ratio = rect.width > 0 ? Math.max(0, Math.min(1, clickX / rect.width)) : 0;
    const targetTime = ratio * totalDuration;
    if (startIfPaused) {
      const focusedLane = laneTracks.find((t) => t.id === selectedTrackId);
      const focusedTake = takes.find((t) => t.id === selectedTrackId);
      if (focusedLane) {
        setPlayhead(targetTime);
        dawEngine.auditionTrack(focusedLane.id, targetTime);
      } else if (focusedTake && focusedTake.url) {
        const takeRange = interval(focusedTake, totalDuration || 60);
        const range = preview(focusedTake);
        const segDur = Math.max(0, takeRange.end - takeRange.start);
        const offsetInSeg =
          segDur > 0 ? Math.max(0, Math.min(Math.max(0, segDur - 0.05), targetTime - takeRange.start)) : 0;
        const timelineStart = takeRange.start + offsetInSeg;
        setPlayhead(timelineStart);
        dawEngine.auditionTake(focusedTake.url, range.start + offsetInSeg, range.end, timelineStart);
        useDawStore.setState({ auditionId: focusedTake.id });
      } else {
        dawEngine.stopAuditionTake(true);
        dawEngine.seek(targetTime);
        setPlayhead(targetTime);
        void dawEngine.startTransport(false);
      }
    } else {
      dawEngine.seek(targetTime);
      setPlayhead(targetTime);
    }
  };

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    scrubRulerAtClientX(e.currentTarget, e.clientX, true);
  };

  const playExtractedTakeAtClick = (take: typeof takes[number], e?: React.MouseEvent<HTMLElement>) => {
    onSelectTrack(take.id);
    if (!take.url) return;
    const takeRange = interval(take, totalDuration || 60);
    const rowDuration = Math.max(totalDuration, takeRange.end);
    const range = preview(take);
    let offsetInSeg = 0;
    if (e) {
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = rect.width > 0 ? Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) : 0;
      const clickedSec = ratio * rowDuration;
      const segDur = Math.max(0, takeRange.end - takeRange.start);
      if (segDur > 0) {
        offsetInSeg = Math.max(0, Math.min(Math.max(0, segDur - 0.05), clickedSec - takeRange.start));
      }
    }
    const audioStart = range.start + offsetInSeg;
    const timelineStart = takeRange.start + offsetInSeg;
    setPlayhead(timelineStart);
    dawEngine.auditionTake(take.url, audioStart, range.end, timelineStart);
    useDawStore.setState({ auditionId: take.id });
  };

  // Generate ticks for time ruler (every 15s or 30s)
  const tickIntervalSec = totalDuration > 120 ? 30 : 15;
  const tickCount = Math.floor(totalDuration / tickIntervalSec);
  const tickMarkers: number[] = [];
  for (let i = 0; i <= tickCount; i++) {
    tickMarkers.push(i * tickIntervalSec);
  }

  // Determine if master is currently playing
  const isMasterPlaying = isPlaying && !playingTakeId && (selectedTrackId === 'master' || !tracks.some((t) => t.solo));
  const isMasterSculpted = !isIdentityWaveSculpt(masterTrack?.sculpt);
  const hasActiveMasterTake = takes.some((t) => t.is_active);
  const canRevertMaster = isMasterSculpted || hasActiveMasterTake;

  type StageItem =
    | { kind: 'master'; id: 'master' }
    | { kind: 'lane'; id: string; track: (typeof laneTracks)[number] }
    | {
        kind: 'extracted';
        id: string;
        category: string;
        catTakes: typeof takes;
        currentTake: (typeof takes)[number];
      };

  const resolveStageItem = (id: string | null | undefined): StageItem | null => {
    if (!id || id === 'master') return { kind: 'master', id: 'master' };
    const lane = laneTracks.find((t) => t.id === id);
    if (lane) return { kind: 'lane', id: lane.id, track: lane };
    for (const [category, catTakes] of Object.entries(takesByCategory)) {
      const found = catTakes.find((t) => t.id === id);
      if (found) {
        return { kind: 'extracted', id: found.id, category, catTakes, currentTake: found };
      }
    }
    return null;
  };

  // Stage 1: Primary Focus (selected 'lane' / 'extracted' / 'master')
  const focusItem: StageItem = resolveStageItem(selectedTrackId) ?? { kind: 'master', id: 'master' };

  const renderAddLaneDropdown = () => (
    <div className="board-add-dropdown" ref={addMenuRef} onClick={(e) => e.stopPropagation()}>
      <Tooltip
        title="Add Lane / Tool"
        description="Add an instrument lane or open a generator tool"
      >
        <button
          type="button"
          className={`board-transport-btn board-add-trigger ${isAddMenuOpen ? 'active' : ''}`}
          onClick={() => setIsAddMenuOpen((prev) => !prev)}
          aria-expanded={isAddMenuOpen}
          aria-haspopup="menu"
          aria-label="Add track or tool"
        >
          <Plus size={12} />
        </button>
      </Tooltip>

      {isAddMenuOpen && (
        <div className="board-add-menu" role="menu" aria-label="Add lane or tool">
          <button
            type="button"
            role="menuitem"
            className="board-add-menu-item"
            onClick={() => {
              setIsAddMenuOpen(false);
              onOpenTool?.('studio', 'lego');
            }}
          >
            <Sparkles size={12} />
            <span>AI LAYER</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="board-add-menu-item"
            onClick={() => {
              setIsAddMenuOpen(false);
              onAddTrack('pianoroll');
            }}
          >
            <KeyIcon size={12} />
            <span>KEYS SYNTH</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="board-add-menu-item"
            onClick={() => {
              setIsAddMenuOpen(false);
              onAddTrack('sequencer');
            }}
          >
            <Drum size={12} />
            <span>DRUM SEQ</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="board-add-menu-item"
            onClick={() => {
              setIsAddMenuOpen(false);
              onAddTrack('sample');
            }}
          >
            <Music size={12} />
            <span>SAMPLER</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="board-add-menu-item"
            onClick={() => {
              setIsAddMenuOpen(false);
              onAddTrack('strudel');
            }}
          >
            <Code size={12} />
            <span>LIVE CODE</span>
          </button>
        </div>
      )}
    </div>
  );

  const renderFocusGlobalUtilities = () => (
    <div className="board-focus-utilities" onClick={(e) => e.stopPropagation()}>
      {!selection && (
        <Tooltip
          title="Select Section"
          description="Drop a section selector at the playhead or drag horizontally anywhere on the lane"
        >
          <button
            type="button"
            className="board-transport-btn board-section-trigger"
            aria-label="Select Section"
            onClick={() => {
              const currentPlayhead = useDawStore.getState().playhead;
              const start = Math.max(0, Math.min(currentPlayhead, Math.max(0, totalDuration - 5)));
              const end = Math.min(totalDuration, Math.max(start + 5, start + 15));
              useDawStore.getState().setSelection({ start, end });
            }}
          >
            <Scissors size={11} />
            <span className="board-btn-label">SECTION</span>
          </button>
        </Tooltip>
      )}

      <Tooltip
        title={
          sculptMode === 'granular'
            ? 'Wave Mode: Granular (Spiky)'
            : 'Wave Mode: Smooth Curve (Timer)'
        }
        description="Switch wave sculpting between Granular Peak Mode and Smooth Time-Envelope Mode"
      >
        <div className="wave-rocker-switch" role="radiogroup" aria-label="Wave sculpt mode">
          <button
            type="button"
            role="radio"
            className={`rocker-half rocker-left ${sculptMode === 'granular' ? 'is-pressed' : 'is-raised'}`}
            aria-checked={sculptMode === 'granular'}
            aria-label="Granular wave mode"
            onClick={() => setSculptMode('granular')}
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M1.5 8h2l1.8-4.5 2.4 9 2.4-7 1.7 2.5h2.7" />
            </svg>
          </button>
          <button
            type="button"
            role="radio"
            className={`rocker-half rocker-right ${sculptMode === 'curve' ? 'is-pressed' : 'is-raised'}`}
            aria-checked={sculptMode === 'curve'}
            aria-label="Smooth curve timer mode"
            onClick={() => setSculptMode('curve')}
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="8" cy="8.8" r="5.5" />
              <path d="M6.2 1.6h3.6M8 1.6v1.7M8 8.8V5.8M8 8.8l2.2 1.5" />
            </svg>
          </button>
        </div>
      </Tooltip>

      {canShowCanvas && (
        <Tooltip
          title="Song Lyrics Document"
          description="Open or hide the general song lyrics sheet"
        >
          <button
            type="button"
            className={`board-transport-btn board-canvas-toggle ${isCanvasOpen ? 'active' : ''}`}
            aria-pressed={isCanvasOpen || undefined}
            aria-label={isCanvasOpen ? 'Hide Song Lyrics Document' : 'Open Song Lyrics Document'}
            onClick={() => setIsCanvasOpen((prev) => !prev)}
          >
            <FilePenLine size={13} />
          </button>
        </Tooltip>
      )}

      {onUndo && (
        <Tooltip title="Undo" description="Undo last edit (Cmd/Ctrl+Z)">
          <button
            type="button"
            className="board-transport-btn"
            disabled={!canUndo}
            aria-label="Undo"
            onClick={onUndo}
          >
            <Undo2 size={12} />
          </button>
        </Tooltip>
      )}

      {onRedo && (
        <Tooltip title="Redo" description="Redo edit (Cmd/Ctrl+Shift+Z)">
          <button
            type="button"
            className="board-transport-btn"
            disabled={!canRedo}
            aria-label="Redo"
            onClick={onRedo}
          >
            <Redo2 size={12} />
          </button>
        </Tooltip>
      )}

      {onOpenCommitModal && (
        <Tooltip title="Commit Snapshot" description="Save a milestone snapshot of the current arrangement">
          <button
            type="button"
            className="board-transport-btn board-commit-btn"
            aria-label="Commit Snapshot"
            onClick={onOpenCommitModal}
          >
            <GitCommit size={12} />
            <span className="board-btn-label">COMMIT</span>
          </button>
        </Tooltip>
      )}
    </div>
  );

  const renderEmbeddedMasterHorizon = () => {
    const isMasterFocused = focusItem.kind === 'master';
    return (
      <div
        className={`board-master-horizon ${isMasterFocused ? 'is-focused' : ''}`}
        role="button"
        tabIndex={0}
        aria-label="Focus Master track"
        aria-pressed={isMasterFocused}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setIsVaultOpen(false);
          setMasterExpanded(true);
          onSelectTrack('master');
          clearNonMasterSolos();
          dawEngine.stopAuditionTake(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            setIsVaultOpen(false);
            setMasterExpanded(true);
            onSelectTrack('master');
            clearNonMasterSolos();
            dawEngine.stopAuditionTake(true);
          }
        }}
      >
        <span className="board-master-horizon-tag">MST</span>
        <Waveform
          audioUrl={masterTrack?.clips[0]?.url}
          timelineDuration={totalDuration}
          segments={masterLayout.segments}
          interactive={false}
          showSelection={false}
          lanes={masterExpanded ? masterLanes : []}
          selectedTrackId={selectedTrackId}
          highlighted={highlighted}
          className="board-master-horizon-wave"
        />
      </div>
    );
  };

  const laneRangeDragRef = useRef<{
    mode: 'create' | 'start' | 'end' | 'pan';
    originSec: number;
    initialStart: number;
    initialEnd: number;
    startClientX: number;
    width: number;
    rowDur: number;
    moved: boolean;
  } | null>(null);

  const startLaneBackgroundRangeDrag = (
    e: React.PointerEvent<HTMLElement>,
    rowDur: number = totalDuration
  ) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (
      target?.closest(
        'button, input, a, .board-segment-hud, .waveform-selection, .board-clip-container, .stem-clip-waveform-container, .waveform-box, .board-embedded-horizon, .clip-sculpt-toolbar, .waveform-mode-toolbar, .board-overlay'
      )
    ) {
      return;
    }
    const laneEl = e.currentTarget;
    const rect = laneEl.getBoundingClientRect();
    if (rect.width <= 0) return;
    const safeDur = Math.max(rowDur, 1);
    const originRatio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const originSec = originRatio * safeDur;
    laneRangeDragRef.current = {
      mode: 'create',
      originSec,
      initialStart: originSec,
      initialEnd: originSec,
      startClientX: e.clientX,
      width: rect.width,
      rowDur: safeDur,
      moved: false,
    };
    const onMove = (ev: PointerEvent) => {
      const st = laneRangeDragRef.current;
      if (!st || st.mode !== 'create') return;
      if (!st.moved && Math.abs(ev.clientX - st.startClientX) < 5) return;
      st.moved = true;
      const curRatio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / Math.max(1, st.width)));
      const curSec = curRatio * st.rowDur;
      const start = Math.max(0, Math.min(st.originSec, curSec));
      const end = Math.min(st.rowDur, Math.max(st.originSec, curSec));
      if (end - start >= 0.25) {
        setSelection({
          start: Number(start.toFixed(2)),
          end: Number(end.toFixed(2)),
        });
      }
    };
    const onUp = () => {
      laneRangeDragRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const renderUniversalSelectionHandles = (rowDur: number = totalDuration) => {
    if (!selection || selection.end <= selection.start) return null;
    const safeDur = Math.max(rowDur, 1);
    const selLeftPct = Math.max(0, Math.min(100, (selection.start / safeDur) * 100));
    const selWidthPct = Math.max(0.5, Math.min(100 - selLeftPct, ((selection.end - selection.start) / safeDur) * 100));

    const startHandleDrag = (
      e: React.PointerEvent<HTMLElement>,
      mode: 'start' | 'end' | 'pan'
    ) => {
      e.stopPropagation();
      e.preventDefault();
      const laneEl = e.currentTarget.closest('.board-lane-waveform-row') as HTMLElement | null;
      const width = laneEl?.getBoundingClientRect().width || 300;
      laneRangeDragRef.current = {
        mode,
        originSec: selection.start,
        initialStart: selection.start,
        initialEnd: selection.end,
        startClientX: e.clientX,
        width,
        rowDur: safeDur,
        moved: true,
      };
      const onMove = (ev: PointerEvent) => {
        const st = laneRangeDragRef.current;
        if (!st) return;
        const deltaSec = ((ev.clientX - st.startClientX) / Math.max(1, st.width)) * st.rowDur;
        if (st.mode === 'start') {
          const nextStart = Math.max(0, Math.min(st.initialEnd - 0.5, st.initialStart + deltaSec));
          setSelection({ start: Number(nextStart.toFixed(2)), end: st.initialEnd });
        } else if (st.mode === 'end') {
          const nextEnd = Math.min(st.rowDur, Math.max(st.initialStart + 0.5, st.initialEnd + deltaSec));
          setSelection({ start: st.initialStart, end: Number(nextEnd.toFixed(2)) });
        } else if (st.mode === 'pan') {
          const span = st.initialEnd - st.initialStart;
          const nextStart = Math.max(0, Math.min(st.rowDur - span, st.initialStart + deltaSec));
          setSelection({
            start: Number(nextStart.toFixed(2)),
            end: Number((nextStart + span).toFixed(2)),
          });
        }
      };
      const onUp = () => {
        laneRangeDragRef.current = null;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    };

    return (
      <div
        className="waveform-selection board-universal-selection"
        style={
          {
            '--range-start': `${selLeftPct}%`,
            '--range-width': `${selWidthPct}%`,
          } as React.CSSProperties
        }
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="waveform-range start"
          style={{ '--range-left': `${selLeftPct}%` } as React.CSSProperties}
          onPointerDown={(e) => startHandleDrag(e, 'start')}
          aria-label="Selection start"
        />
        <button
          type="button"
          className="waveform-range pan"
          style={
            {
              '--range-left': `${selLeftPct}%`,
              '--range-width': `${selWidthPct}%`,
            } as React.CSSProperties
          }
          onPointerDown={(e) => startHandleDrag(e, 'pan')}
          aria-label="Move selection"
        />
        <button
          type="button"
          className="waveform-range end"
          style={{ '--range-left': `${selLeftPct + selWidthPct}%` } as React.CSSProperties}
          onPointerDown={(e) => startHandleDrag(e, 'end')}
          aria-label="Selection end"
        />
      </div>
    );
  };

  const renderOnboardingHint = () => {
    if (selection || isMasterSculpted) return null;
    return (
      <div className="board-onboarding-hint" aria-hidden="true">
        <span>↔ Drag horizontally to select section</span>
        <span className="board-onboarding-sep">•</span>
        <span>↕ Drag vertically to sculpt wave</span>
      </div>
    );
  };

  const renderInLaneSegmentHud = (rowDur: number = totalDuration) => {
    if (!selection || selection.end <= selection.start) return null;
    const safeDur = Math.max(rowDur, 1);
    const leftPct = Math.max(0, Math.min(82, (selection.start / safeDur) * 100));
    const widthPct = Math.max(0, Math.min(100 - leftPct, ((selection.end - selection.start) / safeDur) * 100));
    return (
      <div
        className="board-segment-hud"
        style={
          {
            '--seg-left-pct': `${leftPct}%`,
            '--seg-width-pct': `${widthPct}%`,
          } as React.CSSProperties
        }
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <span className="board-segment-hud-range">
          {formatTime(selection.start).slice(0, 5)} – {formatTime(selection.end).slice(0, 5)}
        </span>
        <Tooltip title="Audition Section" description="Play only the selected time range once">
          <button
            type="button"
            className="board-segment-hud-btn active"
            aria-label="Audition Section"
            onClick={() => dawEngine.auditionSection(selection.start, selection.end, false)}
          >
            <Play size={11} />
            <span className="board-segment-hud-label">AUDITION</span>
          </button>
        </Tooltip>
        <Tooltip title="Extract Section" description="Extract selected section as a new take">
          <button
            type="button"
            className="board-segment-hud-btn"
            aria-label="Extract Section"
            onClick={() => {
              void extractCurrentSection();
            }}
          >
            <Scissors size={11} />
            <span className="board-segment-hud-label">EXTRACT</span>
          </button>
        </Tooltip>
        {onReworkSection && (
          <Tooltip title="Rework Section" description="Focus AI Studio on this selected section">
            <button
              type="button"
              className="board-segment-hud-btn accent"
              aria-label="Rework Section"
              onClick={onReworkSection}
            >
              <Sparkles size={11} />
              <span className="board-segment-hud-label">REWORK</span>
            </button>
          </Tooltip>
        )}
        <Tooltip title="Clear Section" description="Dismiss section selector">
          <button
            type="button"
            className="board-segment-hud-btn clear"
            aria-label="Clear Section"
            onClick={() => setSelection(null)}
          >
            ×
          </button>
        </Tooltip>
      </div>
    );
  };

  const renderMasterStage = (role: 'focus' | 'reference') => {
    const showFullControllers = role === 'focus';
    return (
      <div
        key="stage-master"
        data-track-id="master"
        className={`board-row master board-stage-card is-${role} ${takes.some((take) => take.provenance?.region) ? 'expanded' : ''}`}
        onClick={() => {
          onSelectTrack('master');
          clearNonMasterSolos();
          dawEngine.stopAuditionTake(true);
          void dawEngine.startTransport(false);
        }}
      >
        {/* Row 1: Full-Width Master Controller Strip */}
        <div
          className={`board-track-header board-lane-controller-row ${!showFullControllers ? 'is-compact-ref' : ''}`}
        >
          <div className="board-controller-left">
            {showFullControllers && renderAddLaneDropdown()}
            <Tooltip title="Master" description={song.title}>
              <button
                type="button"
                className={`board-track-badge board-badge-mst board-track-badge-btn ${masterRestyleTakes.length > 0 && (!masterTrack?.activeVersionTakeId || masterTrack.activeVersionTakeId === 'MST') ? 'selected' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (masterRestyleTakes.length > 0) {
                    void selectMasterVersion(null);
                  } else {
                    onSelectTrack('master');
                  }
                  clearNonMasterSolos();
                  dawEngine.stopAuditionTake(true);
                  void dawEngine.startTransport(false);
                }}
              >
                {showFullControllers ? 'MASTER' : 'MST'}
              </button>
            </Tooltip>

            {role === 'reference' && (
              <span className="board-master-map-hint">MASTER MAP</span>
            )}

            {masterRestyleTakes.length > 0 && (
              <div className="board-master-badges" aria-label="Restyle version controls">
                {masterRestyleTakes.map((take, idx) => {
                  const isVersionActive = masterTrack?.activeVersionTakeId === take.id;
                  return (
                    <Tooltip
                      key={take.id}
                      title={`Restyle #TK${idx + 1}`}
                      description={take.prompt || `Full-song Restyle Take #${take.take_number}`}
                    >
                      <button
                        type="button"
                        aria-pressed={isVersionActive}
                        className={`board-take-badge-pill board-badge-sub ${isVersionActive ? 'selected mix-active' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void selectMasterVersion(take.id);
                        }}
                      >
                        #TK{idx + 1}
                      </button>
                    </Tooltip>
                  );
                })}
              </div>
            )}

            {overlays.length > 0 && (
              <div
                className="board-master-badges"
                aria-label="Mounted layer controls"
              >
                {overlays.map((track) => {
                  const take = takes.find((t) => t.id === track.id)!;
                  return (
                    <Tooltip
                      key={track.id}
                      title={`Take #${take.take_number}`}
                      description="Enable or silence this mounted section. It stays mounted until removed in Extracted."
                    >
                      <button
                        type="button"
                        className={`board-track-badge board-badge-sub board-track-badge-colored ${selectedTrackId === track.id ? 'selected' : ''} ${track.muted ? 'is-muted' : ''}`}
                        style={{ '--track-color': track.color } as React.CSSProperties}
                        aria-label={`Toggle Take #${take.take_number} in master`}
                        aria-pressed={!track.muted}
                        onClick={(event) => {
                          event.stopPropagation();
                          updateTrackMixer(track.id, { muted: !track.muted });
                          setSelection({
                            start: track.clips[0].startTime,
                            end: track.clips[0].startTime + track.clips[0].duration,
                          });
                          onSelectTrack(track.id);
                        }}
                      >
                        TK#{take.take_number}
                      </button>
                    </Tooltip>
                  );
                })}
              </div>
            )}
          </div>

          <div className="board-track-header-bottom board-controller-right">
            {showFullControllers && (
              <div className="board-fader-wrap">
                <Volume2 size={12} color="var(--accent)" />
                <input
                  type="range"
                  name="master-volume"
                  aria-label="Master Volume"
                  className="board-slider"
                  min="0"
                  max="1.2"
                  step="0.01"
                  value={masterTrack?.volume ?? 1}
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    updateTrackMixer('master', { volume: 1 });
                  }}
                  onChange={(e) => updateTrackMixer('master', { volume: parseFloat(e.target.value) })}
                />
                <span className="board-fader-val">{Math.round((masterTrack?.volume ?? 1) * 100)}%</span>
              </div>
            )}

            <div className="board-track-controls">
              <Tooltip
                title={isMasterPlaying ? 'Stop Master' : 'Play Master'}
                description="Toggle Master track playback (Space)"
              >
                <button
                  type="button"
                  className={`board-btn-mini play ${isMasterPlaying ? 'active playing' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectTrack('master');
                    clearNonMasterSolos();
                    dawEngine.stopAuditionTake(true);
                    if (isMasterPlaying) {
                      dawEngine.pauseTransport();
                    } else {
                      void dawEngine
                        .startTransport(false)
                        .catch((error) =>
                          toast.error(
                            error instanceof Error ? error.message : 'Could not play the arrangement'
                          )
                        );
                    }
                  }}
                >
                  {isMasterPlaying ? <Square size={10} /> : <Play size={10} />}
                </button>
              </Tooltip>

              {showFullControllers && (
                <>
                  <Tooltip
                    title="Mute"
                    description="Silence the original recording. Enabled mounted layers keep playing."
                  >
                    <button
                      type="button"
                      className={`board-btn-mini mute ${masterTrack?.muted ? 'active' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        updateTrackMixer('master', { muted: !masterTrack?.muted });
                      }}
                    >
                      M
                    </button>
                  </Tooltip>

                  <Tooltip title="Solo" description="Solo master output">
                    <button
                      type="button"
                      className={`board-btn-mini solo ${masterTrack?.solo ? 'active' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        updateTrackMixer('master', { solo: !masterTrack?.solo });
                      }}
                    >
                      S
                    </button>
                  </Tooltip>
                </>
              )}

              {canRevertMaster && (
                <Tooltip
                  title="Reset / Revert Master"
                  description="Reset Master wave edits and restore original mix"
                >
                  <button
                    type="button"
                    className="board-btn-mini reset"
                    aria-label="Reset Master"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isMasterSculpted) {
                        resetTrackSculpt('master');
                      }
                      if (hasActiveMasterTake) {
                        revertToOriginalMaster();
                      }
                    }}
                  >
                    <RotateCcw size={10} />
                  </button>
                </Tooltip>
              )}

              {masterTrack?.activeVersionTakeId && masterTrack.activeVersionTakeId !== 'MST' && (
                <>
                  <Tooltip title="Merge Restyle" description="Commit this Restyle version as the new Master.">
                    <button
                      type="button"
                      className="board-btn-mini active"
                      aria-label="Merge Restyle version into Master"
                      disabled={Boolean(pendingTake)}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (
                          masterTrack.activeVersionTakeId &&
                          masterTrack.activeVersionTakeId !== 'MST'
                        ) {
                          void activateTake(masterTrack.activeVersionTakeId, 'merge');
                        }
                      }}
                    >
                      <Check size={11} />
                    </button>
                  </Tooltip>
                  <Tooltip
                    title="Discard Restyle"
                    description="Delete this Restyle version and restore Master."
                  >
                    <button
                      type="button"
                      className="board-btn-mini delete"
                      aria-label="Discard Restyle version"
                      disabled={Boolean(pendingTake)}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (
                          masterTrack.activeVersionTakeId &&
                          masterTrack.activeVersionTakeId !== 'MST'
                        ) {
                          void deleteTake(masterTrack.activeVersionTakeId);
                        }
                      }}
                    >
                      <Trash2 size={10} />
                    </button>
                  </Tooltip>
                </>
              )}

              {showFullControllers && (
                <Tooltip
                  title={!hasExtractedStems ? 'Extract stems' : masterExpanded ? 'Compact waveform' : 'Expand stems'}
                  description={
                    !hasExtractedStems
                      ? 'Separate the recording into instruments and vocals.'
                      : masterExpanded
                        ? 'Show the master as one waveform. Keep the extracted lanes.'
                        : 'Show instrument and vocal colors in the master waveform.'
                  }
                >
                  <button
                    type="button"
                    className="board-btn-mini"
                    aria-label={
                      !hasExtractedStems
                        ? 'Extract stems'
                        : masterExpanded
                          ? 'Compact waveform'
                          : 'Expand stems'
                    }
                    disabled={isSeparating}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (!hasExtractedStems) {
                        setMasterExpanded(true);
                        onSeparateStems();
                      } else {
                        setMasterExpanded(!masterExpanded);
                        if (masterExpanded) onSelectTrack('master');
                      }
                    }}
                  >
                    {hasExtractedStems && masterExpanded ? <Minimize2 size={11} /> : <Split size={11} />}
                  </button>
                </Tooltip>
              )}

              <Tooltip title="Merge all" description="Commit all enabled mounted sections to the master.">
                <button
                  type="button"
                  className="board-btn-mini"
                  aria-label="Merge all mounted sections"
                  disabled={Boolean(pendingTake) || !audibleOverlays.length}
                  onClick={(event) => {
                    event.stopPropagation();
                    void mergeTakes(audibleOverlays.map((track) => track.id));
                  }}
                >
                  <Layers size={11} />
                </button>
              </Tooltip>
            </div>

            {showFullControllers && renderFocusGlobalUtilities()}
          </div>
        </div>

        {/* Row 2: 100%-Width Master Waveform & Overlays Row */}
        <div
          className="board-track-lane board-lane-waveform-row"
          onClick={(e) => {
            if (role === 'reference') {
              onSelectTrack('master');
              return;
            }
            e.stopPropagation();
          }}
        >
          <div className="board-lane-grid" />

          <Waveform
            audioUrl={masterTrack?.clips[0]?.url}
            timelineDuration={totalDuration}
            segments={masterLayout.segments}
            interactive={role === 'focus'}
            showSelection={true}
            onReworkSection={onReworkSection}
            onSelectTrack={onSelectTrack}
            lanes={masterExpanded ? masterLanes : []}
            selectedTrackId={selectedTrackId}
            highlighted={highlighted}
            className="board-master-waveform"
          />

          {showFullControllers && renderEmbeddedMasterHorizon()}
          {showFullControllers && renderInLaneSegmentHud(totalDuration)}
          {showFullControllers && renderOnboardingHint()}

          <div className="board-overlays" aria-label="Mounted sections">
            {overlays.flatMap((track) =>
              track.clips.map((clip) => {
                const take = takes.find((t) => t.id === track.activeTakeId)!;
                const shift =
                  drag?.id === track.id
                    ? drag.shift - (clip.startTime - (clip.origin ?? clip.startTime))
                    : 0;
                const start = clip.startTime + shift,
                  end = start + clip.duration;
                const selected = selectedTrackId === take.id;
                return (
                  <div
                    key={`${track.id}:${clip.id ?? clip.startTime}`}
                    className={`board-overlay ${selected ? 'selected' : ''} ${track.muted ? 'muted' : ''}`}
                    style={
                      {
                        left: `${(start / totalDuration) * 100}%`,
                        width: `${((end - start) / totalDuration) * 100}%`,
                        '--start-pct': `${(start / totalDuration) * 100}%`,
                        '--width-pct': `${((end - start) / totalDuration) * 100}%`,
                        '--track-color': track.color,
                      } as React.CSSProperties
                    }
                  >
                    <button
                      type="button"
                      className="board-overlay-wave"
                      aria-label={`Select Take #${take.take_number} section`}
                      aria-pressed={selected}
                      onPointerDown={(event) => {
                        if (event.button !== 0 || pendingTake) return;
                        event.stopPropagation();
                        didDrag.current = false;
                        const width = event.currentTarget
                          .closest('.board-track-lane')!
                          .getBoundingClientRect().width;
                        const origins = track.clips.map((part) => part.origin ?? part.startTime);
                        const curShift = clip.startTime - (clip.origin ?? clip.startTime);
                        dragging.current = {
                          id: track.id,
                          x: event.clientX,
                          shift: curShift,
                          width,
                          minimum: -Math.min(...origins),
                          maximum:
                            totalDuration -
                            Math.max(
                              ...track.clips.map((part, index) => origins[index] + part.duration)
                            ),
                          current: curShift,
                        };
                        event.currentTarget.setPointerCapture(event.pointerId);
                      }}
                      onPointerMove={(event) => {
                        const state = dragging.current;
                        if (
                          !state ||
                          state.id !== track.id ||
                          (Math.abs(event.clientX - state.x) < 3 && !didDrag.current)
                        )
                          return;
                        didDrag.current = true;
                        state.current = Math.max(
                          state.minimum,
                          Math.min(
                            state.maximum,
                            state.shift + ((event.clientX - state.x) / state.width) * totalDuration
                          )
                        );
                        setDrag({ id: state.id, shift: state.current });
                      }}
                      onPointerUp={(event) => {
                        const state = dragging.current;
                        dragging.current = null;
                        setDrag(null);
                        if (didDrag.current && state) {
                          event.stopPropagation();
                          void moveTake(track.id, state.current);
                          onSelectTrack(track.id);
                        }
                      }}
                      onPointerCancel={() => {
                        dragging.current = null;
                        setDrag(null);
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (didDrag.current) {
                          didDrag.current = false;
                          return;
                        }
                        setSelection({ start, end });
                        onSelectTrack(take.id);
                        const laneRect = event.currentTarget
                          .closest('.board-track-lane')
                          ?.getBoundingClientRect();
                        const ratio =
                          laneRect && laneRect.width > 0
                            ? Math.max(
                                0,
                                Math.min(1, (event.clientX - laneRect.left) / laneRect.width)
                              )
                            : start / totalDuration;
                        const clickTime = Math.max(
                          start,
                          Math.min(Math.max(start, end - 0.05), ratio * totalDuration)
                        );
                        setPlayhead(clickTime);
                        if (!track.muted) {
                          void dawEngine.auditionLayer(['master', track.id], clickTime, end);
                        } else {
                          dawEngine.auditionTake(
                            clip.url,
                            (clip.offset ?? 0) + (clickTime - start),
                            (clip.offset ?? 0) + clip.duration,
                            clickTime
                          );
                          useDawStore.setState({ auditionId: take.id });
                        }
                      }}
                    >
                      <Clip clip={clip} color={track.color} trackId={track.id} />
                    </button>
                  </div>
                );
              })
            )}
            {selectedOverlay && selectedClip && (
              <div
                className="board-overlay-actions"
                style={
                  {
                    '--actions-left': `${(selectedClip.startTime / totalDuration) * 100}%`,
                  } as React.CSSProperties
                }
                onClick={(event) => event.stopPropagation()}
              >
                <div className="board-overlay-player">
                  <Tooltip
                    title="Play section"
                    description="Play the selected original and take audio for this segment."
                  >
                    <button
                      type="button"
                      aria-label={`Play selected audio for Take #${selectedTake!.take_number}`}
                      disabled={!originalEnabled && selectedOverlay.muted}
                      onClick={() => {
                        void dawEngine
                          .auditionLayer(
                            ['master', selectedOverlay.id],
                            selectedClip.startTime,
                            selectedClip.startTime + selectedClip.duration
                          )
                          .catch((error) =>
                            toast.error(
                              error instanceof Error ? error.message : 'Could not play the section'
                            )
                          );
                      }}
                    >
                      <Play size={10} />
                    </button>
                  </Tooltip>
                  <div className="board-overlay-choices">
                    <Tooltip
                      title="Original section"
                      description="Enable or silence the original audio underneath this layer."
                    >
                      <button
                        type="button"
                        aria-label="Toggle original section"
                        aria-pressed={originalEnabled}
                        onClick={() =>
                          toggleOriginal({
                            start: selectedClip.startTime,
                            end: selectedClip.startTime + selectedClip.duration,
                          })
                        }
                      >
                        ORG
                      </button>
                    </Tooltip>
                    <Tooltip
                      title={`Take #${selectedTake!.take_number}`}
                      description="Enable or silence this edited section."
                    >
                      <button
                        type="button"
                        aria-label={`Toggle Take #${selectedTake!.take_number} section`}
                        aria-pressed={!selectedOverlay.muted}
                        onClick={() =>
                          updateTrackMixer(selectedOverlay.id, { muted: !selectedOverlay.muted })
                        }
                      >
                        TK#
                      </button>
                    </Tooltip>
                  </div>
                </div>
                <Tooltip
                  title="Merge"
                  description="Commit this enabled section at its current position."
                >
                  <button
                    type="button"
                    aria-label={`Merge Take #${takes.find((t) => t.id === selectedOverlay.id)!.take_number}`}
                    disabled={Boolean(pendingTake) || !audibleOverlays.includes(selectedOverlay)}
                    onClick={() =>
                      void mergeTakes(
                        [selectedOverlay.id],
                        selection &&
                          selection.start >= selectedClip.startTime &&
                          selection.end <= selectedClip.startTime + selectedClip.duration
                          ? selection
                          : {
                              start: selectedClip.startTime,
                              end: selectedClip.startTime + selectedClip.duration,
                            }
                      )
                    }
                  >
                    <Check size={13} />
                  </button>
                </Tooltip>
                <Tooltip
                  title="Discard"
                  description="Remove this pending take and its mounted sections."
                >
                  <button
                    type="button"
                    aria-label={`Discard Take #${takes.find((t) => t.id === selectedOverlay.id)!.take_number}`}
                    disabled={Boolean(pendingTake)}
                    onClick={() => void deleteTake(selectedOverlay.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                </Tooltip>
                <Tooltip
                  title="Reset"
                  description="Return this layer to its original timeline position."
                >
                  <button
                    type="button"
                    aria-label={`Reset Take #${takes.find((t) => t.id === selectedOverlay.id)!.take_number} position`}
                    disabled={Boolean(pendingTake)}
                    onClick={() => void moveTake(selectedOverlay.id, 0)}
                  >
                    <RotateCcw size={13} />
                  </button>
                </Tooltip>
              </div>
            )}
          </div>

          <BoardPlayheadLine totalDuration={totalDuration} />
        </div>
      </div>
    );
  };

  const renderLaneStage = (trackItem: (typeof laneTracks)[number], role: 'focus' | 'reference') => {
    const isSelected = selectedTrackId === trackItem.id;
    const anySoloed = tracks.some((t) => t.solo);
    const isDimmed =
      (anySoloed && !trackItem.solo) ||
      (laneTracks.some((track) => track.id === selectedTrackId) && !isSelected && !anySoloed);
    const isLego = legoContextTrackIds.includes(trackItem.id);
    const clip = trackItem.clips[0];
    const isTrackPlaying = playingTakeId === trackItem.id;

    const brandColor = getStemColor(trackItem.name);
    const normalizedLaneName = (trackItem.layerName || trackItem.name)
      .toLowerCase()
      .replace(/\s+/g, '_');
    const laneLayerTakes = takes
      .filter(
        (t) =>
          isLayerTake(t) &&
          !t.provenance?.mergedInto &&
          !t.is_active &&
          (layerTrackName(t) ?? 'other') === normalizedLaneName
      )
      .sort((a, b) => a.take_number - b.take_number);
    const activeLayerTakeId =
      trackItem.activeVersionTakeId && trackItem.activeVersionTakeId !== 'ORG'
        ? trackItem.activeVersionTakeId
        : null;
    const hasOriginal =
      trackItem.type === 'stem' &&
      trackItem.hasOriginalStem !== false &&
      !trackItem.id.startsWith('layer-');
    const isSynthTrack =
      trackItem.type === 'pianoroll' ||
      trackItem.type === 'sequencer' ||
      trackItem.type === 'strudel';
    const hasSynthVersions =
      isSynthTrack || Boolean(trackItem.versions && trackItem.versions.length > 0);
    const synthVersions = hasSynthVersions
      ? trackItem.versions && trackItem.versions.length > 0
        ? trackItem.versions
        : [{ id: '1', number: 1, createdAt: 0 }]
      : [];
    const activeSynthVerId = isSynthTrack
      ? trackItem.activeVersionId || synthVersions[synthVersions.length - 1]?.id || '1'
      : trackItem.activeVersionId || null;
    const isSynthVersionActiveOnStem =
      trackItem.type === 'stem' && Boolean(activeSynthVerId && trackItem.sequencerVoices?.length);
    const isTrackSculpted = !isIdentityWaveSculpt(trackItem.sculpt);
    const canDeleteLaneOrTake =
      Boolean(activeLayerTakeId) || !hasOriginal || laneLayerTakes.length > 0;
    const showFullControllers = role === 'focus';

    return (
      <div
        key={`stage-lane-${trackItem.id}`}
        data-track-id={trackItem.id}
        className={`board-row board-stage-card is-${role} ${laneLayerTakes.length > 0 || hasSynthVersions ? 'has-versions' : ''} ${isSelected ? 'selected' : ''} ${isDimmed ? 'dimmed' : ''}`}
        onClick={() => {
          onSelectTrack(trackItem.id);
          dawEngine.auditionTrack(trackItem.id);
        }}
      >
        {/* Row 1: Separated Horizontal Controller Strip */}
        <div
          className={`board-track-header board-lane-controller-row ${!showFullControllers ? 'is-compact-ref' : ''}`}
        >
          <div className="board-controller-left">
            {showFullControllers && renderAddLaneDropdown()}
            <Tooltip title={trackItem.name} description={`Stem channel: ${trackItem.name}`}>
              <span
                className="board-track-badge board-badge-track board-track-badge-colored"
                style={{ '--track-color': brandColor } as React.CSSProperties}
              >
                {showFullControllers ? formatTrackBadgeFull(trackItem) : formatTrackBadgeCode(trackItem)}
              </span>
            </Tooltip>

            {showFullControllers && (hasSynthVersions || laneLayerTakes.length > 0) && (
              <div className="board-category-badges-row" onClick={(e) => e.stopPropagation()}>
                <div className="board-category-badges-list">
                  {hasOriginal && (
                    <Tooltip title="Original Stem" description={`Original ${trackItem.name} stem`}>
                      <button
                        type="button"
                        aria-pressed={!activeLayerTakeId && !activeSynthVerId}
                        className={`board-take-badge-pill board-badge-sub ${!activeLayerTakeId && !activeSynthVerId ? 'selected mix-active' : ''}`}
                        onClick={() => {
                          if (hasSynthVersions) {
                            selectSynthVersion(trackItem.id, 'ORG');
                          }
                          void selectLaneVersion(trackItem.id, null);
                        }}
                      >
                        ORG
                      </button>
                    </Tooltip>
                  )}
                  {laneLayerTakes.map((take, idx) => {
                    const isVersionActive = activeLayerTakeId === take.id && !activeSynthVerId;
                    return (
                      <Tooltip
                        key={take.id}
                        title={`${trackItem.name} Layer #${idx + 1}`}
                        description={take.prompt || `Layer Take #${take.take_number}`}
                      >
                        <button
                          type="button"
                          aria-pressed={isVersionActive}
                          className={`board-take-badge-pill board-badge-sub ${isVersionActive ? 'selected mix-active' : ''}`}
                          onClick={() => {
                            if (hasSynthVersions) {
                              selectSynthVersion(trackItem.id, 'ORG');
                            }
                            void selectLaneVersion(trackItem.id, take.id);
                          }}
                        >
                          #{idx + 1}
                        </button>
                      </Tooltip>
                    );
                  })}
                  {synthVersions.map((ver) => {
                    const isVerActive = activeSynthVerId === ver.id;
                    return (
                      <Tooltip
                        key={ver.id}
                        title={`${trackItem.name} #${ver.number}`}
                        description={`Switch to version #${ver.number}`}
                      >
                        <button
                          type="button"
                          aria-pressed={isVerActive}
                          className={`board-take-badge-pill board-badge-sub ${isVerActive ? 'selected mix-active' : ''}`}
                          onClick={() => selectSynthVersion(trackItem.id, ver.id)}
                        >
                          #{ver.number}
                        </button>
                      </Tooltip>
                    );
                  })}
                  {hasSynthVersions && (
                    <Tooltip
                      title={`New ${trackItem.name} Version`}
                      description={`Create version #${synthVersions.length + 1} on this lane`}
                    >
                      <button
                        type="button"
                        className="board-take-badge-pill board-badge-sub add"
                        aria-label={`Create new ${trackItem.name} version`}
                        onClick={() => addSynthVersion(trackItem.id)}
                      >
                        +
                      </button>
                    </Tooltip>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Expanded Controllers shown when lane is Selected (Stage 1 Focus) */}
          {showFullControllers ? (
            <div className="board-controller-right">
              <div className="board-fader-wrap">
                <Volume2 size={12} color={brandColor} />
                <input
                  type="range"
                  name={`track-volume-${trackItem.id}`}
                  aria-label={`${trackItem.name} Volume`}
                  className="board-slider"
                  min="0"
                  max="1.2"
                  step="0.01"
                  value={trackItem.volume}
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    updateTrackMixer(trackItem.id, { volume: 1 });
                  }}
                  title="Double-click to reset volume to 100%"
                  onChange={(e) =>
                    updateTrackMixer(trackItem.id, { volume: parseFloat(e.target.value) })
                  }
                />
                <span className="board-fader-val">{Math.round(trackItem.volume * 100)}%</span>
              </div>

              <div className="board-track-controls">
                <Tooltip
                  title={isTrackPlaying ? 'Stop track' : 'Audition track'}
                  description={`Solo audition of ${trackItem.name}`}
                >
                  <button
                    type="button"
                    className={`board-btn-mini play ${isTrackPlaying ? 'active playing' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isTrackPlaying) {
                        dawEngine.pauseTransport();
                      } else {
                        onSelectTrack(trackItem.id);
                        dawEngine.auditionTrack(trackItem.id);
                      }
                    }}
                  >
                    {isTrackPlaying ? <Square size={10} /> : <Play size={10} />}
                  </button>
                </Tooltip>

                <Tooltip title="Mute Track" description={`Mute ${trackItem.name}`}>
                  <button
                    type="button"
                    className={`board-btn-mini mute ${trackItem.muted ? 'active' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      updateTrackMixer(trackItem.id, { muted: !trackItem.muted });
                    }}
                  >
                    M
                  </button>
                </Tooltip>

                <Tooltip title="Solo Track" description={`Solo ${trackItem.name}`}>
                  <button
                    type="button"
                    className={`board-btn-mini solo ${trackItem.solo ? 'active' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      updateTrackMixer(trackItem.id, { solo: !trackItem.solo });
                    }}
                  >
                    S
                  </button>
                </Tooltip>

                <Tooltip
                  title="Layer Guide Context"
                  description="Use as harmonic reference guide when generating new stems"
                >
                  <button
                    type="button"
                    className={`board-btn-mini arm ${isLego ? 'active' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleLegoContext(trackItem.id);
                    }}
                  >
                    L
                  </button>
                </Tooltip>

                {(isTrackSculpted ||
                  activeLayerTakeId ||
                  (trackItem.type === 'stem' && activeSynthVerId)) && (
                  <Tooltip
                    title={`Reset ${trackItem.name}`}
                    description={`Revert wave-sculpt edits and return ${trackItem.name} to original`}
                  >
                    <button
                      type="button"
                      className="board-btn-mini reset"
                      aria-label={`Reset ${trackItem.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        resetTrackSculpt(trackItem.id);
                        if (activeLayerTakeId) {
                          void selectLaneVersion(trackItem.id, null);
                        }
                        if (trackItem.type === 'stem' && activeSynthVerId) {
                          selectSynthVersion(trackItem.id, 'ORG');
                        }
                        toast.success(`${trackItem.name} reset to original`);
                      }}
                    >
                      <RotateCcw size={10} />
                    </button>
                  </Tooltip>
                )}

                {activeLayerTakeId && (
                  <Tooltip
                    title="Merge Layer"
                    description={`Commit this layer take into the ${trackItem.name} lane`}
                  >
                    <button
                      type="button"
                      className="board-btn-mini active"
                      aria-label={`Merge Layer into ${trackItem.name}`}
                      disabled={Boolean(pendingTake)}
                      onClick={(e) => {
                        e.stopPropagation();
                        void activateTake(activeLayerTakeId, 'merge');
                      }}
                    >
                      <Check size={10} />
                    </button>
                  </Tooltip>
                )}

                {canDeleteLaneOrTake && (
                  <Tooltip
                    title={
                      activeLayerTakeId || laneLayerTakes.length > 0
                        ? 'Discard Layer'
                        : `Delete ${trackItem.name}`
                    }
                    description={
                      activeLayerTakeId || laneLayerTakes.length > 0
                        ? 'Remove unmerged layer take'
                        : `Delete ${trackItem.name} lane`
                    }
                  >
                    <button
                      type="button"
                      className="board-btn-mini delete"
                      aria-label={
                        activeLayerTakeId || laneLayerTakes.length > 0
                          ? `Discard Layer take`
                          : `Delete ${trackItem.name} lane`
                      }
                      disabled={Boolean(pendingTake)}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (activeLayerTakeId) {
                          void deleteTake(activeLayerTakeId);
                        } else if (laneLayerTakes.length > 0) {
                          void deleteTake(laneLayerTakes[laneLayerTakes.length - 1].id);
                        } else {
                          removeTrack(trackItem.id);
                        }
                      }}
                    >
                      <Trash2 size={10} />
                    </button>
                  </Tooltip>
                )}
              </div>

              {renderFocusGlobalUtilities()}
            </div>
          ) : (
            <div className="board-controller-right">
              <div className="board-track-controls">
                <Tooltip
                  title={isTrackPlaying ? 'Stop track' : 'Audition track'}
                  description={`Quick audition of ${trackItem.name}`}
                >
                  <button
                    type="button"
                    className={`board-btn-mini play ${isTrackPlaying ? 'active playing' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isTrackPlaying) {
                        dawEngine.pauseTransport();
                      } else {
                        dawEngine.auditionTrack(trackItem.id);
                      }
                    }}
                  >
                    {isTrackPlaying ? <Square size={10} /> : <Play size={10} />}
                  </button>
                </Tooltip>
              </div>
            </div>
          )}
        </div>

        {/* Row 2: 100%-Width Waveform & Notes Row */}
        <div
          className="board-track-lane board-lane-waveform-row"
          onPointerDown={(e) => {
            if (showFullControllers) {
              startLaneBackgroundRangeDrag(e, totalDuration);
            }
          }}
          onClick={(e) => {
            e.stopPropagation();
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio =
              rect.width > 0 ? Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) : 0;
            const targetTime = ratio * totalDuration;
            onSelectTrack(trackItem.id);
            setPlayhead(targetTime);
            dawEngine.auditionTrack(trackItem.id, targetTime);
          }}
        >
          <div className="board-lane-grid" />

          {showFullControllers && renderEmbeddedMasterHorizon()}

          {(isSynthTrack || isSynthVersionActiveOnStem) && (
            <Notes track={trackItem} bpm={bpm} duration={totalDuration} color={brandColor} />
          )}

          {!isSynthVersionActiveOnStem && clip && clip.url && (
            <div
              className="board-clip-container"
              style={
                {
                  '--start-pct': `${(clip.startTime / totalDuration) * 100}%`,
                  '--width-pct': `${(clip.duration / totalDuration) * 100}%`,
                } as React.CSSProperties
              }
            >
              <Clip
                clip={clip}
                color={brandColor}
                trackId={trackItem.id}
                enableSelection={showFullControllers}
              />
            </div>
          )}

          {showFullControllers && (isSynthTrack || isSynthVersionActiveOnStem) && renderUniversalSelectionHandles(totalDuration)}
          {showFullControllers && renderInLaneSegmentHud(totalDuration)}
          {showFullControllers && renderOnboardingHint()}

          <BoardPlayheadLine totalDuration={totalDuration} />
        </div>
      </div>
    );
  };

  const renderExtractedStage = (
    category: string,
    catTakes: typeof takes,
    currentTake: (typeof takes)[number],
    role: 'focus' | 'reference'
  ) => {
    const categoryTitle = taskLabel(category);
    const isCurrentActive = mounted(currentTake, tracks, takes);
    const isTakePlaying = playingTakeId === currentTake.id;
    const isSelected = selectedTrackId === currentTake.id;
    const showFullControllers = role === 'focus';
    const rowDuration = Math.max(totalDuration, interval(currentTake, totalDuration || 60).end);

    return (
      <div
        key={`stage-take-${currentTake.id}`}
        data-track-id={currentTake.id}
        className={`board-row board-stage-card is-${role} ${isSelected ? 'selected' : ''} ${isCurrentActive ? 'active-take' : ''}`}
        onClick={() => {
          playExtractedTakeAtClick(currentTake);
        }}
      >
        {/* Row 1: Separated Horizontal Controller Strip */}
        <div
          className={`board-track-header board-lane-controller-row ${!showFullControllers ? 'is-compact-ref' : ''}`}
        >
          <div className="board-controller-left">
            {showFullControllers && renderAddLaneDropdown()}
            <Tooltip
              title={categoryTitle}
              description={`Take #${currentTake.take_number} • ${currentTake.prompt || 'Session take'}`}
            >
              <span
                className={`board-track-badge board-badge-track board-track-badge-category ${isCurrentActive ? 'active' : ''}`}
                aria-label={`Category: ${categoryTitle}, Take #${currentTake.take_number}`}
              >
                {categoryTitle}
              </span>
            </Tooltip>

            <span className="board-take-interval-label">
              #{currentTake.take_number}{' '}
              {currentTake.repainting_start != null && currentTake.repainting_end != null
                ? `[${formatTime(currentTake.repainting_start)} ➔ ${formatTime(currentTake.repainting_end)}]`
                : ''}
            </span>
            <span className="board-section-badge">{pendingCount} TAKES</span>

            {showFullControllers && (
              <div className="board-category-badges-row" onClick={(e) => e.stopPropagation()}>
                <div className="board-category-badges-list">
                  {catTakes.map((take) => {
                    const isTakeSelected = selectedTrackId === take.id;
                    const isTakeMixActive = mounted(take, tracks, takes);
                    return (
                      <button
                        key={take.id}
                        type="button"
                        aria-pressed={isTakeSelected}
                        className={`board-take-badge-pill board-badge-sub ${isTakeSelected ? 'selected' : ''} ${isTakeMixActive ? 'mix-active' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveCategoryTakeId((prev) => ({ ...prev, [category]: take.id }));
                          playExtractedTakeAtClick(take);
                        }}
                        title={`Take #${take.take_number}${isTakeMixActive ? ' · Base' : ''}`}
                      >
                        #{take.take_number}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="board-controller-right">
            <div className="board-track-controls">
              <Tooltip
                title={isTakePlaying ? 'Stop playback' : 'Play take'}
                description={`Preview Take #${currentTake.take_number}`}
              >
                <button
                  type="button"
                  className={`board-btn-mini play ${isTakePlaying ? 'active playing' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isTakePlaying) {
                      dawEngine.stopAuditionTake();
                    } else {
                      onSelectTrack(currentTake.id);
                      const range = preview(currentTake);
                      dawEngine.auditionTake(
                        currentTake.url,
                        range.start,
                        range.end,
                        range.timelineStart
                      );
                      useDawStore.setState({ auditionId: currentTake.id });
                    }
                  }}
                >
                  {isTakePlaying ? <Square size={10} /> : <Play size={10} />}
                </button>
              </Tooltip>

              <Tooltip
                title={isCurrentActive ? 'Unmount take' : 'Set as Base'}
                description={
                  isCurrentActive
                    ? 'Remove this take from playback. Keep the other mounted takes.'
                    : 'Mount this take alongside the current arrangement.'
                }
              >
                <button
                  type="button"
                  aria-label={
                    isCurrentActive
                      ? `Unmount Take #${currentTake.take_number}`
                      : `Use Take #${currentTake.take_number} as base`
                  }
                  aria-pressed={isCurrentActive}
                  disabled={Boolean(pendingTake)}
                  className={`board-btn-mini solo ${isCurrentActive ? 'active' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveCategoryTakeId((prev) => ({
                      ...prev,
                      [category]: currentTake.id,
                    }));
                    toggleTake(currentTake.id);
                  }}
                >
                  {isCurrentActive ? <Check size={11} /> : 'BASE'}
                </button>
              </Tooltip>

              <Tooltip
                title="Delete Take"
                description={`Permanently remove Take #${currentTake.take_number}`}
              >
                <button
                  type="button"
                  className="board-btn-mini delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteTake(currentTake.id);
                  }}
                >
                  <Trash2 size={10} />
                </button>
              </Tooltip>
            </div>

            {showFullControllers && renderFocusGlobalUtilities()}
          </div>
        </div>

        {/* Row 2: 100%-Width Extracted Take Waveform Row */}
        <div
          className="board-track-lane board-lane-waveform-row"
          onPointerDown={(e) => {
            if (showFullControllers) {
              startLaneBackgroundRangeDrag(e, rowDuration);
            }
          }}
          onClick={(e) => {
            e.stopPropagation();
            playExtractedTakeAtClick(currentTake, e);
          }}
        >
          <div className="board-lane-grid" />

          {showFullControllers && renderEmbeddedMasterHorizon()}

          {currentTake.url
            ? (() => {
                const takeRange = interval(currentTake, totalDuration || 60);
                return (
                  <div
                    className="board-clip-container"
                    style={
                      {
                        left: `${(takeRange.start / rowDuration) * 100}%`,
                        width: `${((takeRange.end - takeRange.start) / rowDuration) * 100}%`,
                        '--start-pct': `${(takeRange.start / rowDuration) * 100}%`,
                        '--width-pct': `${((takeRange.end - takeRange.start) / rowDuration) * 100}%`,
                      } as React.CSSProperties
                    }
                  >
                    <Clip
                      clip={{
                        id: currentTake.id,
                        name: `Take #${currentTake.take_number}`,
                        url: currentTake.url,
                        startTime: takeRange.start,
                        duration: takeRange.end - takeRange.start,
                        offset: preview(currentTake).start,
                      }}
                      color={isCurrentActive ? '#00ff41' : '#00ccff'}
                      enableSelection={showFullControllers}
                    />
                  </div>
                );
              })()
            : null}

          {showFullControllers && !currentTake.url && renderUniversalSelectionHandles(rowDuration)}
          {showFullControllers && renderInLaneSegmentHud(rowDuration)}
          {showFullControllers && renderOnboardingHint()}

          <BoardPlayheadLine totalDuration={rowDuration} />
        </div>
      </div>
    );
  };

  const renderStageItem = (item: StageItem, role: 'focus' | 'reference') => {
    if (item.kind === 'master') return renderMasterStage(role);
    if (item.kind === 'lane') return renderLaneStage(item.track, role);
    return renderExtractedStage(item.category, item.catTakes, item.currentTake, role);
  };

  // Build Row 3 Stem Matrix items ([MST] | [STEM] | [STEM] | [STEM] | [+N])
  type MatrixEntry =
    | { kind: 'lane'; id: string; track: (typeof laneTracks)[number] }
    | { kind: 'take'; id: string; category: string; take: (typeof takes)[number] };

  const rawMatrixEntries: MatrixEntry[] = [
    ...laneTracks.map((track): MatrixEntry => ({ kind: 'lane', id: track.id, track })),
    ...Object.entries(takesByCategory).flatMap(([category, catTakes]) =>
      catTakes.map((take): MatrixEntry => ({ kind: 'take', id: take.id, category, take }))
    ),
  ];

  // Order unselected lanes by decreasing "latest-opened" (MRU), excluding focused lane and Master
  const allMatrixEntries = [...rawMatrixEntries]
    .filter((entry) => entry.id !== focusItem.id)
    .sort((a, b) => {
      const idxA = mruIds.indexOf(a.id);
      const idxB = mruIds.indexOf(b.id);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return 0;
    });

  const MAX_VISIBLE_SQUARES = 3;
  const visibleMatrixEntries = allMatrixEntries.slice(0, MAX_VISIBLE_SQUARES);
  const vaultMatrixEntries = allMatrixEntries.slice(MAX_VISIBLE_SQUARES);

  const renderMatrixSquare = (entry: MatrixEntry, inVault = false) => {
    if (entry.kind === 'lane') {
      const trackItem = entry.track;
      const isFocused = focusItem.id === trackItem.id;
      const brandColor = getStemColor(trackItem.name);
      const clip = trackItem.clips[0];
      const isTrackPlaying = playingTakeId === trackItem.id;
      const isSynthTrack =
        trackItem.type === 'pianoroll' ||
        trackItem.type === 'sequencer' ||
        trackItem.type === 'strudel';
      return (
        <div
          key={`${inVault ? 'vault' : 'matrix'}-lane-${trackItem.id}`}
          data-track-id={!isFocused ? trackItem.id : undefined}
          data-matrix-id={trackItem.id}
          className={`board-mini-square ${inVault ? 'in-vault' : ''} ${isFocused ? 'is-selected' : ''} ${trackItem.muted ? 'is-muted' : ''} ${trackItem.solo ? 'is-solo' : ''} ${isTrackPlaying ? 'is-playing' : ''}`}
          style={{ '--track-color': brandColor } as React.CSSProperties}
          role="button"
          tabIndex={0}
          aria-label={`Focus ${trackItem.name} lane`}
          aria-pressed={isFocused}
          onClick={() => {
            setIsVaultOpen(false);
            onSelectTrack(trackItem.id);
            dawEngine.auditionTrack(trackItem.id);
          }}
        >
          <div className="board-mini-square-top">
            <span
              className="board-track-badge board-badge-track board-track-badge-colored"
              style={{ '--track-color': brandColor } as React.CSSProperties}
            >
              {formatTrackBadgeCode(trackItem)}
            </span>
            <button
              type="button"
              className={`board-mini-square-play ${isTrackPlaying ? 'active playing' : ''}`}
              aria-label={isTrackPlaying ? `Stop ${trackItem.name}` : `Audition ${trackItem.name}`}
              onClick={(e) => {
                e.stopPropagation();
                if (isTrackPlaying) {
                  dawEngine.pauseTransport();
                } else {
                  dawEngine.auditionTrack(trackItem.id);
                }
              }}
            >
              {isTrackPlaying ? <Square size={10} /> : <Play size={10} />}
            </button>
          </div>
          <div className="board-mini-square-wave">
            {isSynthTrack ? (
              <Notes track={trackItem} bpm={bpm} duration={totalDuration} color={brandColor} />
            ) : clip && clip.url ? (
              <Clip clip={clip} color={brandColor} />
            ) : null}
            <BoardPlayheadLine totalDuration={totalDuration} />
          </div>
        </div>
      );
    }

    const { category, take } = entry;
    const isFocused = focusItem.id === take.id;
    const categoryTitle = taskLabel(category);
    const isTakeMounted = mounted(take, tracks, takes);
    const isTakePlaying = playingTakeId === take.id;
    const takeRange = interval(take, totalDuration || 60);
    const rowDuration = Math.max(totalDuration, takeRange.end);
    return (
      <div
        key={`${inVault ? 'vault' : 'matrix'}-take-${take.id}`}
        data-track-id={!isFocused ? take.id : undefined}
        data-matrix-id={take.id}
        className={`board-mini-square is-take ${inVault ? 'in-vault' : ''} ${isFocused ? 'is-selected' : ''} ${isTakeMounted ? 'is-mounted' : ''} ${isTakePlaying ? 'is-playing' : ''}`}
        style={{ '--track-color': isTakeMounted ? '#00ff41' : '#00ccff' } as React.CSSProperties}
        role="button"
        tabIndex={0}
        aria-label={`Focus ${categoryTitle} Take #${take.take_number}`}
        aria-pressed={isFocused}
        onClick={() => {
          setIsVaultOpen(false);
          setActiveCategoryTakeId((prev) => ({ ...prev, [category]: take.id }));
          playExtractedTakeAtClick(take);
        }}
      >
        <div className="board-mini-square-top">
          <span
            className={`board-track-badge board-badge-track board-track-badge-category ${isTakeMounted ? 'active' : ''}`}
            aria-label={`Category: ${categoryTitle}, Take #${take.take_number}`}
          >
            {categoryTitle.slice(0, 3)} #{take.take_number}
          </span>
          <button
            type="button"
            className={`board-mini-square-play ${isTakePlaying ? 'active playing' : ''}`}
            aria-label={
              isTakePlaying
                ? `Stop Take #${take.take_number}`
                : `Audition Take #${take.take_number}`
            }
            onClick={(e) => {
              e.stopPropagation();
              if (isTakePlaying) {
                dawEngine.stopAuditionTake();
              } else if (take.url) {
                const range = preview(take);
                dawEngine.auditionTake(take.url, range.start, range.end, range.timelineStart);
                useDawStore.setState({ auditionId: take.id });
              }
            }}
          >
            {isTakePlaying ? <Square size={10} /> : <Play size={10} />}
          </button>
        </div>
        <div className="board-mini-square-wave">
          {take.url && (
            <div
              className="board-clip-container"
              style={
                {
                  left: `${(takeRange.start / rowDuration) * 100}%`,
                  width: `${((takeRange.end - takeRange.start) / rowDuration) * 100}%`,
                  '--start-pct': `${(takeRange.start / rowDuration) * 100}%`,
                  '--width-pct': `${((takeRange.end - takeRange.start) / rowDuration) * 100}%`,
                } as React.CSSProperties
              }
            >
              <Clip
                clip={{
                  id: take.id,
                  name: `Take #${take.take_number}`,
                  url: take.url,
                  startTime: takeRange.start,
                  duration: Math.max(0.5, takeRange.end - takeRange.start),
                  offset: preview(take).start,
                }}
                color={isTakeMounted ? '#00ff41' : '#00ccff'}
              />
            </div>
          )}
          <BoardPlayheadLine totalDuration={rowDuration} />
        </div>
      </div>
    );
  };

  return (
    <div className="board-container">
      {/* Unified DAW Board Viewport + Foldable Right Canvas */}
      <div
        className={`board-main-split ${canShowCanvas && isCanvasOpen ? 'with-canvas' : ''}`}
        data-pocket={canShowCanvas && isCanvasOpen ? 'canvas' : 'tracks'}
      >
        <div ref={viewportRef} className="board-viewport">
          {/* ROW 2: SELECTED LANE (Time Ruler + Focused Lane with Embedded Master Horizon) */}
          <div className="board-stage-focus" aria-label="Selected Lane">
            <div className="board-ruler-row">
              <div
                className="board-ruler-timeline"
                onClick={handleTimelineClick}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  isScrubbingRulerRef.current = true;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  scrubRulerAtClientX(e.currentTarget, e.clientX, false);
                }}
                onPointerMove={(e) => {
                  if (!isScrubbingRulerRef.current) return;
                  scrubRulerAtClientX(e.currentTarget, e.clientX, false);
                }}
                onPointerUp={(e) => {
                  if (!isScrubbingRulerRef.current) return;
                  isScrubbingRulerRef.current = false;
                  e.currentTarget.releasePointerCapture(e.pointerId);
                }}
                onPointerCancel={() => {
                  isScrubbingRulerRef.current = false;
                }}
              >
                <div className="board-ruler-ticks">
                  {tickMarkers.map((sec) => (
                    <div
                      key={sec}
                      className="board-ruler-marker"
                      style={{ '--pos-pct': `${(sec / totalDuration) * 100}%` } as React.CSSProperties}
                    >
                      <span>{formatTime(sec).slice(0, 5)}</span>
                    </div>
                  ))}
                </div>

                <BoardPlayheadLine totalDuration={totalDuration} showCap />
              </div>
            </div>

            {renderStageItem(focusItem, 'focus')}
          </div>

          {/* ROW 3: MIDDLE SPLIT (Left: Stems Matrix [MST | STEM x 3 | +N] • Right: Standalone Toolbox) */}
          <div className="board-middle-split">
            <div className="board-stems-card" aria-label="Stems Matrix">
              <div className="board-stage-matrix">
                {visibleMatrixEntries.map((entry) => renderMatrixSquare(entry, false))}

                {!hasExtractedStems && visibleMatrixEntries.length < 3 && (
                  <button
                    type="button"
                    className="board-mini-square board-extract-cta"
                    disabled={isSeparating}
                    onClick={() => {
                      setMasterExpanded(true);
                      onSeparateStems();
                    }}
                  >
                    <Split size={14} />
                    <span>{isSeparating ? 'SPLITTING...' : 'SPLIT STEMS'}</span>
                  </button>
                )}

                {vaultMatrixEntries.length > 0 && (
                  <div className="board-vault-wrap" ref={vaultMenuRef}>
                    <Tooltip
                      title="Track & Take Vault"
                      description={`View ${vaultMatrixEntries.length} more stems and session takes`}
                    >
                      <button
                        type="button"
                        className={`board-vault-trigger ${isVaultOpen ? 'active' : ''}`}
                        aria-label={`Open track vault (${vaultMatrixEntries.length} more)`}
                        aria-expanded={isVaultOpen}
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsVaultOpen((prev) => !prev);
                        }}
                      >
                        <Layers size={13} />
                        <span>+{vaultMatrixEntries.length}</span>
                      </button>
                    </Tooltip>

                    <div
                      className={`board-vault-popover ${isVaultOpen ? 'is-open' : ''}`}
                      role="dialog"
                      aria-label="Overflow Track and Take Vault"
                      hidden={!isVaultOpen}
                    >
                      <div className="board-vault-header">
                        <span>OTHER STEMS & TAKES ({vaultMatrixEntries.length})</span>
                      </div>
                      <div className="board-vault-grid">
                        {vaultMatrixEntries.map((entry) => renderMatrixSquare(entry, true))}
                      </div>
                    </div>
                  </div>
                )}

                {operations.map((operation) => (
                  <div
                    key={operation.id}
                    className="board-mini-square board-operation"
                    role={operation.status === 'error' ? 'alert' : 'status'}
                    aria-live="polite"
                  >
                    <span>{taskLabel(operation.task)}</span>
                    <span>
                      {operation.status === 'submitting'
                        ? 'SUBMITTING'
                        : operation.status === 'pending'
                          ? 'QUEUED'
                          : operation.status.toUpperCase()}
                      {operation.progress === undefined ? '' : ` ${operation.progress}%`}
                    </span>
                    {operation.error && <span>{operation.error}</span>}
                  </div>
                ))}
              </div>
            </div>

            {toolboxSlot && <div className="board-toolbox-slot">{toolboxSlot}</div>}
          </div>
        </div>

        {canShowCanvas && isCanvasOpen && (
          <Canvas
            lyrics={lyrics}
            onLyricsChange={onLyricsChange || (() => {})}
            vocalLanguage={vocalLanguage}
            onVocalLanguageChange={onVocalLanguageChange || (() => {})}
            languages={languages}
            hasExistingLyrics={hasExistingLyrics}
            isTranscribingLyrics={isTranscribingLyrics}
            onExtractLyrics={onExtractLyrics}
            lyricsAlignment={lyricsAlignment}
            isAligningLyrics={isAligningLyrics}
            onAlignLyrics={onAlignLyrics}
            processing={processing}
            onClose={() => {
              setIsCanvasOpen(false);
            }}
          />
        )}
      </div>
    </div>
  );
};
