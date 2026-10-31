import { useGuideOwner, prepareViews } from '../guide/owners';
import React, { useState, useRef, useLayoutEffect, useEffect } from 'react';
import { useDawStore, type LyricsAlignment } from '../../lib/daw/store';
import { dawEngine } from '../../lib/daw/engine';
import { isIdentityWaveSculpt } from '../../lib/daw/peaks';
import { Waveform } from '../waveform';
import { Clip } from './Clip';
import { Notes } from './Notes';
import { Tooltip } from './Tooltip';
import { Canvas } from './Canvas';
import { useDismiss } from '../../hooks/use-dismiss';
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
import { isBase, mounted, preview, interval, pending, masterArrangement, taskLabel, taskBadgeLabel, isLayerTake, layerTrackName, isFullSongRestyleTake } from '../../lib/daw/takes';

export interface BoardProps {
  song: Song;
  selectedTrackId: string;
  onSelectTrack: (trackId: string) => void;
  onAddTrack: (type: TrackType) => void;
  onOpenTool?: (tool: 'studio' | 'mixer' | 'keys' | 'drums' | 'strudel' | 'dsp' | 'sample' | 'history', studioTask?: Task) => void;
  onIsolateStems: () => void;
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
  onIsolateStems,
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
  const takes = useDawStore((s) => s.takes);
  const originals = useDawStore((s) => s.originals);
  const setPlayhead = useDawStore((s) => s.setPlayhead);
  const setSelection = useDawStore((s) => s.setSelection);
  const extractCurrentSection = useDawStore((s) => s.extractCurrentSection);
  const updateTrackMixer = useDawStore((s) => s.updateTrackMixer);
  const toggleTrackMounted = useDawStore((s) => s.toggleTrackMounted);
  const removeTrack = useDawStore((s) => s.removeTrack);
  const toggleTake = useDawStore((s) => s.toggleTake);
  const toggleOriginal = useDawStore((s) => s.toggleOriginal);
  const activateTake = useDawStore((s) => s.activateTake);
  const selectLaneVersion = useDawStore((s) => s.selectLaneVersion);
  const selectMasterVersion = useDawStore((s) => s.selectMasterVersion);
  const addSynthVersion = useDawStore((s) => s.addSynthVersion);
  const selectSynthVersion = useDawStore((s) => s.selectSynthVersion);
  const pendingTake = useDawStore((s) => s.pendingTake);
  const deleteTake = useDawStore((s) => s.deleteTake);
  const revertToOriginalMaster = useDawStore((s) => s.revertToOriginalMaster);
  const operations = useDawStore((s) => s.operations);
  const auditionId = useDawStore((s) => s.auditionId);
  const mergeTakes = useDawStore((s) => s.mergeTakes);
  const sculptMode = useDawStore((s) => s.sculptMode);
  const setSculptMode = useDawStore((s) => s.setSculptMode);
  const resetTrackSculpt = useDawStore((s) => s.resetTrackSculpt);

  const [masterExpanded, setMasterExpanded] = useState(true);
  const [isCanvasOpen, setIsCanvasOpen] = useState<boolean>(false);
  const [isAddMenuOpen, setIsAddMenuOpen] = useState<boolean>(false);
  const [isVaultOpen, setIsVaultOpen] = useState<boolean>(false);
  const [mruIds, setMruIds] = useState<string[]>([]);
  const [activeExtractedTakeId, setActiveExtractedTakeId] = useState<string | null>(null);
  const [guideDisplayId, setGuideDisplayId] = useState<string | null>(null);
  const [guideTakeId, setGuideTakeId] = useState<string | null>(null);
  const guideProjectId = useDawStore(state => state.songId);
  const guideSelectionRef = useRef(selection); guideSelectionRef.current = selection;
  const addMenuRef = useRef<HTMLDivElement | null>(null);
  const vaultMenuRef = useRef<HTMLDivElement | null>(null);

  useDismiss(isAddMenuOpen, () => setIsAddMenuOpen(false), addMenuRef);
  useDismiss(isVaultOpen, () => setIsVaultOpen(false), vaultMenuRef);


  useEffect(() => {
    if (!selectedTrackId || selectedTrackId === 'master') return;
    const matchedTake = takes.find(
      (t) =>
        t.id === selectedTrackId &&
        pending(t) &&
        !isLayerTake(t) &&
        !isFullSongRestyleTake(t)
    );
    const mruKey = matchedTake
      ? `cat-${(matchedTake.task || 'extract').toLowerCase()}`
      : selectedTrackId;
    setMruIds((prev) => [mruKey, ...prev.filter((id) => id !== mruKey && id !== selectedTrackId)]);
  }, [selectedTrackId, takes]);

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
  const [drag, setDrag] = useState<{ id: string; shift: number } | null>(null);
  const moveTake = useDawStore((s) => s.moveTake);
  const dragging = useRef<{
    id: string;
    x: number;
    shift: number;
    width: number;
    minimum: number;
    maximum: number;
    current: number;
  } | null>(null);
  const didDrag = useRef(false);
  const audibleOverlays = overlays.filter(track => !track.muted && (!tracks.some(lane => lane.solo) || track.solo));

  // Group takes by task category & track active take per category
  const [activeCategoryTakeId, setActiveCategoryTakeId] = useState<Record<string, string>>({});

  const takesByCategory = React.useMemo(() => {
    const groups: Record<string, typeof takes> = {};
    takes.forEach((take) => {
      if (!pending(take) || isLayerTake(take) || isFullSongRestyleTake(take)) return;
      const cat = (take.task || 'extract').toLowerCase();
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(take);
    });
    Object.values(groups).forEach((group) =>
      group.sort((a, b) => a.take_number - b.take_number)
    );
    return groups;
  }, [takes]);

  const getCategoryActiveTake = React.useCallback(
    (category: string, catTakes: typeof takes) => {
      const guideInCat = catTakes.find(t => t.id === guideTakeId);
      if (guideInCat) return guideInCat;
      const selectedInCat = catTakes.find((t) => t.id === selectedTrackId);
      if (selectedInCat) return selectedInCat;
      const savedId = activeCategoryTakeId[category];
      if (savedId) {
        const savedTake = catTakes.find((t) => t.id === savedId);
        if (savedTake) return savedTake;
      }
      const mountedInCat = catTakes.find((t) => mounted(t, tracks, takes));
      return mountedInCat ?? catTakes[catTakes.length - 1] ?? catTakes[0];
    },
    [selectedTrackId, activeCategoryTakeId, tracks, takes, guideTakeId]
  );

  const swapCategoryTake = async (
    category: string,
    targetTake: (typeof takes)[number],
    catTakes: typeof takes,
    focusAndPlay = true
  ) => {
    setActiveCategoryTakeId((prev) => ({ ...prev, [category]: targetTake.id }));
    setActiveExtractedTakeId(targetTake.id);
    // If another take in this category was mounted/audible on Master, swap mount to targetTake
    const mountedSiblings = catTakes.filter(
      (t) => t.id !== targetTake.id && mounted(t, tracks, takes)
    );
    if (mountedSiblings.length > 0) {
      for (const sib of mountedSiblings) {
        const sibTrack = useDawStore.getState().tracks.find((tr) => tr.id === sib.id);
        if (sibTrack && !sibTrack.muted) {
          updateTrackMixer(sibTrack.id, { muted: true });
        }
      }
      const targetOverlay = useDawStore.getState().tracks.find((tr) => tr.id === targetTake.id);
      if (!targetOverlay) {
        await toggleTake(targetTake.id);
      } else if (targetOverlay.muted) {
        updateTrackMixer(targetOverlay.id, { muted: false });
      }
    }
    if (focusAndPlay) {
      await playExtractedTakeAtClick(targetTake);
    }
  };
  const allExtractedTakes = React.useMemo(
    () => Object.values(takesByCategory).flat().sort((a, b) => a.take_number - b.take_number),
    [takesByCategory]
  );
  const selectionMatchesTake = React.useMemo(() => {
    if (!selection) return null;
    return (
      allExtractedTakes.find((take) => {
        const overlayTrack = overlays.find((t) => t.id === take.id);
        const clip = overlayTrack?.clips[0];
        const range = interval(take, duration || 60);
        const start = clip ? clip.startTime : range.start;
        const end = clip ? clip.startTime + clip.duration : range.end;
        return Math.abs(selection.start - start) < 0.05 && Math.abs(selection.end - end) < 0.05;
      }) ?? null
    );
  }, [selection, allExtractedTakes, overlays, duration]);
  const isManualSelection = Boolean(selection && !selectionMatchesTake && !activeExtractedTakeId);

  useEffect(() => {
    if (selection && !selectionMatchesTake) {
      setActiveExtractedTakeId(null);
    }
  }, [selection, selectionMatchesTake]);

  const activeExtractedTake = React.useMemo(() => {
    if (guideTakeId) return allExtractedTakes.find(t => t.id === guideTakeId) ?? null;
    if (isManualSelection) return null;
    if (activeExtractedTakeId) {
      const found = allExtractedTakes.find((t) => t.id === activeExtractedTakeId);
      if (found) return found;
    }
    if (selectionMatchesTake) return selectionMatchesTake;
    const selectedIsExtracted = allExtractedTakes.find((t) => t.id === selectedTrackId);
    if (selectedIsExtracted) return selectedIsExtracted;
    const firstMounted = allExtractedTakes.find((t) => mounted(t, tracks, takes));
    return firstMounted ?? allExtractedTakes[0] ?? null;
  }, [isManualSelection, activeExtractedTakeId, selectionMatchesTake, allExtractedTakes, selectedTrackId, tracks, takes, guideTakeId]);
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
  const laneTracks = React.useMemo(
    () => tracks.filter((t) => t.id !== 'master' && t.id !== t.activeTakeId),
    [tracks]
  );
  const trackOrderKey = React.useMemo(() => tracks.map((t) => t.id).join('|'), [tracks]);
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
  }, [trackOrderKey, selectedTrackId]);
  const hasExtractedStems = React.useMemo(
    () => laneTracks.some(track => track.type === 'stem' && track.clips.length > 0),
    [laneTracks]
  );
  const mountableLanes = React.useMemo(
    () =>
      laneTracks.filter(
        (track) =>
          track.clips.length > 0 ||
          track.type === 'pianoroll' ||
          track.type === 'sequencer' ||
          (track.type === 'strudel' && Boolean(track.strudelCode?.trim())) ||
          track.type === 'sample'
      ),
    [laneTracks]
  );
  const separated = React.useMemo(
    () => mountableLanes.filter((track) => track.mounted !== false),
    [mountableLanes]
  );
  const mergeableMountedIds = React.useMemo(() => {
    const ids = audibleOverlays.map((track) => track.id);
    for (const track of mountableLanes) {
      if (track.mounted === false || track.muted) continue;
      const hasSynthOrSample =
        (track.type === 'strudel' && Boolean(track.strudelCode?.trim())) ||
        (track.type === 'pianoroll' && Boolean(track.pianoRollNotes?.length)) ||
        (track.type === 'sequencer' &&
          Boolean(track.sequencerVoices?.some((v) => !v.muted && v.steps.some(Boolean)))) ||
        (track.type === 'sample' && track.clips.length > 0) ||
        (track.type === 'stem' &&
          (!isIdentityWaveSculpt(track.sculpt) ||
            Boolean(track.activeVersionTakeId && track.activeVersionTakeId !== 'ORG')));
      if (hasSynthOrSample && !ids.includes(track.id)) {
        ids.push(track.id);
      }
    }
    return ids;
  }, [audibleOverlays, mountableLanes]);
  const completeSeparation = React.useMemo(
    () => ['drums', 'bass', 'other'].every(name => separated.some(track => track.name.toLowerCase() === name)),
    [separated]
  );
  const masterLanes = React.useMemo(
    () => separated.filter(track => !completeSeparation || track.name.toLowerCase() !== 'instrumental'),
    [separated, completeSeparation]
  );
  const selectedLane = React.useMemo(
    () => separated.find(track => track.id === selectedTrackId),
    [separated, selectedTrackId]
  );
  const highlighted = React.useMemo(
    () =>
      completeSeparation && selectedLane?.name.toLowerCase() === 'instrumental'
        ? masterLanes.filter(track => track.name.toLowerCase() !== 'vocals').map(track => track.id)
        : [selectedTrackId],
    [completeSeparation, selectedLane, masterLanes, selectedTrackId]
  );

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
      if (focusedLane) {
        setPlayhead(targetTime);
        dawEngine.auditionTrack(focusedLane.id, targetTime);
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

  const playExtractedTakeAtClick = async (
    take: (typeof takes)[number],
    e?: React.MouseEvent<HTMLElement>,
    focusTake = true,
    targetSec?: number
  ) => {
    if (focusTake) {
      onSelectTrack(take.id);
    }
    setActiveExtractedTakeId(take.id);
    if (!take.url) return;
    let { start, end, overlayTrack } = getExtractedTakeInterval(take);
    if (!overlayTrack) {
      await toggleTake(take.id);
      const stateAfter = useDawStore.getState();
      overlayTrack = stateAfter.tracks.find((t) => t.id === take.id && t.activeTakeId === take.id);
      const clipAfter = overlayTrack?.clips[0];
      if (clipAfter) {
        start = clipAfter.startTime;
        end = clipAfter.startTime + clipAfter.duration;
      }
    }
    let offsetInSeg = 0;
    const segDur = Math.max(0, end - start);
    if (typeof targetSec === 'number' && Number.isFinite(targetSec)) {
      if (segDur > 0 && targetSec >= start && targetSec <= end) {
        offsetInSeg = Math.max(0, Math.min(Math.max(0, segDur - 0.05), targetSec - start));
      }
    } else if (e) {
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = rect.width > 0 ? Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) : 0;
      const clickedSec = ratio * totalDuration;
      if (segDur > 0 && clickedSec >= start && clickedSec <= end) {
        offsetInSeg = Math.max(0, Math.min(Math.max(0, segDur - 0.05), clickedSec - start));
      }
    }
    const timelineStart = start + offsetInSeg;
    setPlayhead(timelineStart);
    const currentOriginals = useDawStore.getState().originals;
    const originalEnabled = !currentOriginals.some((r) => r.start < end && r.end > start);
    const isTakeColored = !overlayTrack || !overlayTrack.muted;
    const isTakeSolo = Boolean(overlayTrack?.solo);
    const layerIds = isTakeSolo
      ? [take.id]
      : [
        ...(originalEnabled ? ['master'] : []),
        ...(isTakeColored ? [take.id] : []),
      ];
    const finalLayers = layerIds.length > 0 ? layerIds : ['master', take.id];
    await dawEngine.auditionLayer(finalLayers, timelineStart, end);
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
  const focusItem: StageItem = resolveStageItem(guideDisplayId ?? selectedTrackId) ?? { kind: 'master', id: 'master' };

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
        <div data-guide="board.add-menu" className="board-add-menu" role="menu" aria-label="Add lane or tool">
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
      {!isManualSelection && (
        <Tooltip
          title="Select Section"
          description="Drop a section selector at the playhead or drag horizontally anywhere on the lane"
        >
          <button
            type="button"
            className="board-transport-btn board-section-trigger"
            data-guide="board.section" aria-label="Select Section"
            onClick={() => {
              setActiveExtractedTakeId(null);
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
        <div data-guide="board.sculpt-mode" className="wave-rocker-switch" role="radiogroup" aria-label="Wave sculpt mode">
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

      <span data-guide="board.undo-redo" tabIndex={-1} aria-label="Undo and redo" className="guide-control-group">{onUndo && (
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

      </span>
      {onOpenCommitModal && (
        <Tooltip title="Commit Snapshot" description="Save a milestone snapshot of the current arrangement">
          <button
            type="button"
            className="board-transport-btn board-commit-btn"
            data-guide="board.commit" aria-label="Commit Snapshot"
            onClick={onOpenCommitModal}
          >
            <GitCommit size={12} />
            <span className="board-btn-label">COMMIT</span>
          </button>
        </Tooltip>
      )}
    </div>
  );

  const getExtractedTakeInterval = (take: (typeof takes)[number]) => {
    const overlayTrack = overlays.find((t) => t.id === take.id);
    const clip = overlayTrack?.clips[0];
    if (overlayTrack && clip) {
      const shift =
        drag?.id === overlayTrack.id
          ? drag.shift - (clip.startTime - (clip.origin ?? clip.startTime))
          : 0;
      const start = clip.startTime + shift;
      const end = start + clip.duration;
      return { start, end, overlayTrack, clip };
    }
    const range = interval(take, totalDuration || 60);
    return { start: range.start, end: range.end, overlayTrack: undefined, clip: undefined };
  };

  const renderMasterDents = (variant: 'horizon' | 'stage') => {
    if (allExtractedTakes.length === 0) return null;
    const safeDur = Math.max(totalDuration, 1);
    const sortedDents = allExtractedTakes
      .map((take) => {
        const { start, end, overlayTrack } = getExtractedTakeInterval(take);
        const leftPct = Math.max(0, Math.min(99, (start / safeDur) * 100));
        const widthPct = Math.max(0.8, Math.min(100 - leftPct, ((end - start) / safeDur) * 100));
        return { take, start, end, overlayTrack, leftPct, widthPct };
      })
      .sort((a, b) => a.leftPct - b.leftPct || a.take.take_number - b.take.take_number);
    const seenLeftPcts: number[] = [];
    return (
      <div
        className={`board-sc-dents is-${variant}`}
        aria-label="Extracted take markers"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {sortedDents.map(({ take, start, end, overlayTrack, leftPct, widthPct }, orderIdx) => {
          const stackIdx = seenLeftPcts.filter((p) => Math.abs(p - leftPct) < 2.2).length;
          seenLeftPcts.push(leftPct);
          const isTakeColored = Boolean(overlayTrack && !overlayTrack.muted);
          const isSelectedDent =
            activeExtractedTake?.id === take.id && focusItem.kind === 'master';
          const dentColor = overlayTrack?.color || (isTakeColored ? '#00ff41' : '#00f0ff');
          return (
            <Tooltip
              key={`dent-${variant}-${take.id}`}
              title={`${taskLabel(take.task)} #${take.take_number}`}
              description={`[${formatTime(start).slice(0, 5)} ➔ ${formatTime(end).slice(0, 5)}] • Click to select on Master`}
            >
              <button
                type="button"
                className={`board-sc-dent ${isTakeColored ? 'is-colored' : 'is-uncolored'} ${isSelectedDent ? 'is-selected' : ''}`}
                style={
                  {
                    '--dent-left': `${leftPct}%`,
                    '--dent-width': `${widthPct}%`,
                    '--dent-color': dentColor,
                    '--dent-stack-idx': stackIdx,
                    '--dent-order-idx': orderIdx,
                  } as React.CSSProperties
                }
                aria-label={
                  variant === 'stage'
                    ? `Select Take #${take.take_number} section`
                    : `Focus Take #${take.take_number} marker on Master`
                }
                aria-pressed={isSelectedDent}
                onClick={(e) => {
                  e.stopPropagation();
                  setIsVaultOpen(false);
                  setMasterExpanded(true);
                  const isAlreadySelectedOnMaster =
                    activeExtractedTake?.id === take.id && focusItem.kind === 'master';
                  setActiveExtractedTakeId(take.id);
                  setSelection(null);
                  onSelectTrack('master');
                  clearNonMasterSolos();
                  dawEngine.stopAuditionTake(true);
                  if (!overlayTrack) {
                    toggleTake(take.id);
                  } else if (isAlreadySelectedOnMaster) {
                    updateTrackMixer(overlayTrack.id, { muted: !overlayTrack.muted });
                  }
                }}
              >
                <span className="board-sc-dent-head">#{take.take_number}</span>
                <span className="board-sc-dent-stem" />
              </button>
            </Tooltip>
          );
        })}
      </div>
    );
  };

  const renderMasterExtractedSelector = () => {
    if (focusItem.kind !== 'master' || !activeExtractedTake) return null;
    const { start, end, overlayTrack, clip } = getExtractedTakeInterval(activeExtractedTake);
    const safeDur = Math.max(totalDuration, 1);
    const leftPct = Math.max(0, Math.min(99, (start / safeDur) * 100));
    const widthPct = Math.max(1, Math.min(100 - leftPct, ((end - start) / safeDur) * 100));
    const isTakeColored = Boolean(overlayTrack && !overlayTrack.muted);
    const originalEnabled = !originals.some((region) => region.start < end && region.end > start);
    const selectorColor = overlayTrack?.color || (isTakeColored ? '#00ff41' : '#00f0ff');
    const previewRange = preview(activeExtractedTake);
    const selectorClip =
      clip ??
      (activeExtractedTake.url
        ? {
          id: activeExtractedTake.id,
          name: `Take #${activeExtractedTake.take_number}`,
          url: activeExtractedTake.url,
          startTime: start,
          duration: Math.max(0.5, end - start),
          offset: previewRange.start,
        }
        : undefined);

    return (
      <div
        className={`board-sc-selector ${isTakeColored ? 'is-colored' : 'is-uncolored'}`}
        style={
          {
            left: `${leftPct}%`,
            width: `${widthPct}%`,
            '--start-pct': `${leftPct}%`,
            '--width-pct': `${widthPct}%`,
            '--track-color': selectorColor,
          } as React.CSSProperties
        }
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="board-sc-selector-region"
          aria-label={`Region selector for Take #${activeExtractedTake.take_number}`}
          aria-pressed={isTakeColored}
          onPointerDown={(event) => {
            if (event.button !== 0 || pendingTake || !overlayTrack || !clip) return;
            event.stopPropagation();
            didDrag.current = false;
            const width =
              event.currentTarget.closest('.board-track-lane')?.getBoundingClientRect().width || 300;
            const origins = overlayTrack.clips.map((part) => part.origin ?? part.startTime);
            const curShift = clip.startTime - (clip.origin ?? clip.startTime);
            dragging.current = {
              id: overlayTrack.id,
              x: event.clientX,
              shift: curShift,
              width,
              minimum: -Math.min(...origins),
              maximum:
                totalDuration -
                Math.max(
                  ...overlayTrack.clips.map((part, index) => origins[index] + part.duration)
                ),
              current: curShift,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!overlayTrack) return;
            const state = dragging.current;
            if (
              !state ||
              state.id !== overlayTrack.id ||
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
            if (!overlayTrack) return;
            const state = dragging.current;
            dragging.current = null;
            setDrag(null);
            if (didDrag.current && state) {
              event.stopPropagation();
              void moveTake(overlayTrack.id, state.current);
              onSelectTrack('master');
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
            onSelectTrack('master');
            setActiveExtractedTakeId(activeExtractedTake.id);
            if (!overlayTrack) {
              void toggleTake(activeExtractedTake.id);
            } else {
              const nextMuted = !overlayTrack.muted;
              updateTrackMixer(overlayTrack.id, { muted: nextMuted });
              if (nextMuted && !originalEnabled) {
                toggleOriginal({ start, end });
              }
              if (isMasterPlaying) {
                const nextLayerIds = [
                  ...(originalEnabled || nextMuted ? ['master'] : []),
                  ...(!nextMuted ? [overlayTrack.id] : []),
                ];
                void dawEngine.auditionLayer(nextLayerIds, start, end);
              }
            }
          }}
        >
          {selectorClip && (
            <div className="board-overlay-wave">
              <Clip clip={selectorClip} color={selectorColor} />
            </div>
          )}
          <span className="board-sc-selector-badge">
            #TK{activeExtractedTake.take_number}
          </span>
        </button>

        {/* 3-Icon Controller HUD ON THE SELECTOR when Master is selected */}
        <div
          className={`board-sc-selector-hud ${leftPct < 14 ? 'is-edge-left' : leftPct + widthPct > 86 ? 'is-edge-right' : ''}`}
          role="toolbar"
          aria-label={`Take #${activeExtractedTake.take_number} region controls`}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div data-guide="board.take-comparison" data-guide-entity={activeExtractedTake?.id} className="board-overlay-player">
            <Tooltip
              title={isMasterPlaying ? 'Stop section' : 'Play section'}
              description={`Play [${formatTime(start).slice(0, 5)} – ${formatTime(end).slice(0, 5)}] with selected ORG / TK#${activeExtractedTake.take_number} layers`}
            >
              <button
                type="button"
                className={`board-sc-hud-btn play ${isMasterPlaying ? 'active playing' : ''}`}
                aria-label={`Play selected audio for Take #${activeExtractedTake.take_number}`}
                onClick={async () => {
                  if (isMasterPlaying) {
                    dawEngine.pauseTransport();
                    return;
                  }
                  let currentOverlay = overlayTrack;
                  let currentColored = isTakeColored;
                  if (!originalEnabled && !currentColored) {
                    if (!currentOverlay) {
                      await toggleTake(activeExtractedTake.id);
                      currentOverlay = useDawStore
                        .getState()
                        .tracks.find((t) => t.id === activeExtractedTake.id);
                    } else {
                      updateTrackMixer(currentOverlay.id, { muted: false });
                    }
                    currentColored = true;
                  }
                  const layerIds = [
                    ...(originalEnabled ? ['master'] : []),
                    ...(currentColored && currentOverlay ? [currentOverlay.id] : []),
                  ];
                  const finalLayers = layerIds.length > 0 ? layerIds : ['master'];
                  void dawEngine
                    .auditionLayer(finalLayers, start, end)
                    .catch((error) =>
                      toast.error(
                        error instanceof Error ? error.message : 'Could not play the section'
                      )
                    );
                }}
              >
                {isMasterPlaying ? <Square size={10} /> : <Play size={10} />}
              </button>
            </Tooltip>

            <div className="board-overlay-choices">
              <Tooltip
                title="Original Master"
                description="Include or silence the original Master recording in this section"
              >
                <button
                  type="button"
                  className={`board-sc-choice-btn org ${originalEnabled ? 'active' : ''}`}
                  aria-label={`Original audio for Take #${activeExtractedTake.take_number}`}
                  aria-pressed={originalEnabled}
                  onClick={async () => {
                    const nextOriginal = !originalEnabled;
                    toggleOriginal({ start, end });
                    let currentOverlay = overlayTrack;
                    let currentColored = isTakeColored;
                    if (!nextOriginal && !currentColored) {
                      if (!currentOverlay) {
                        await toggleTake(activeExtractedTake.id);
                        currentOverlay = useDawStore
                          .getState()
                          .tracks.find((t) => t.id === activeExtractedTake.id);
                      } else {
                        updateTrackMixer(currentOverlay.id, { muted: false });
                      }
                      currentColored = true;
                    }
                    if (isMasterPlaying) {
                      const nextLayers = [
                        ...(nextOriginal ? ['master'] : []),
                        ...(currentColored && currentOverlay ? [currentOverlay.id] : []),
                      ];
                      if (nextLayers.length > 0) {
                        void dawEngine.auditionLayer(nextLayers, start, end);
                      }
                    }
                  }}
                >
                  ORG
                </button>
              </Tooltip>

              <Tooltip
                title={`Take #${activeExtractedTake.take_number}`}
                description={`Mount or mute Take #${activeExtractedTake.take_number} on Master`}
              >
                <button
                  type="button"
                  className={`board-sc-choice-btn tk ${isTakeColored ? 'active' : ''}`}
                  aria-label={`Take #${activeExtractedTake.take_number} audio`}
                  aria-pressed={isTakeColored}
                  onClick={async () => {
                    setActiveExtractedTakeId(activeExtractedTake.id);
                    if (!overlayTrack) {
                      await toggleTake(activeExtractedTake.id);
                      if (isMasterPlaying) {
                        const nextLayers = [
                          ...(originalEnabled ? ['master'] : []),
                          activeExtractedTake.id,
                        ];
                        void dawEngine.auditionLayer(nextLayers, start, end);
                      }
                    } else {
                      const nextMuted = !overlayTrack.muted;
                      updateTrackMixer(overlayTrack.id, { muted: nextMuted });
                      let nextOriginal = originalEnabled;
                      if (nextMuted && !originalEnabled) {
                        toggleOriginal({ start, end });
                        nextOriginal = true;
                      }
                      if (isMasterPlaying) {
                        const nextLayers = [
                          ...(nextOriginal ? ['master'] : []),
                          ...(!nextMuted ? [overlayTrack.id] : []),
                        ];
                        if (nextLayers.length > 0) {
                          void dawEngine.auditionLayer(nextLayers, start, end);
                        }
                      }
                    }
                  }}
                >
                  TK#{activeExtractedTake.take_number}
                </button>
              </Tooltip>
            </div>
          </div>

          <Tooltip
            title="Merge into Master"
            description={`Merge Take #${activeExtractedTake.take_number} into the Master track`}
          >
            <button
              type="button"
              data-guide-entity={activeExtractedTake.id} className="board-sc-hud-btn merge"
              data-guide="board.section-merge" aria-label={`Merge Take #${activeExtractedTake.take_number}`}
              disabled={Boolean(pendingTake)}
              onClick={async () => {
                if (!overlayTrack) {
                  await toggleTake(activeExtractedTake.id);
                } else if (overlayTrack.muted) {
                  updateTrackMixer(overlayTrack.id, { muted: false });
                }
                await mergeTakes([activeExtractedTake.id], { start, end });
              }}
            >
              <Check size={11} />
            </button>
          </Tooltip>

          <Tooltip
            title="Delete Take"
            description={`Discard Take #${activeExtractedTake.take_number}`}
          >
            <button
              type="button"
              className="board-sc-hud-btn delete"
              aria-label={`Discard Take #${activeExtractedTake.take_number}`}
              disabled={Boolean(pendingTake)}
              onClick={() => void deleteTake(activeExtractedTake.id)}
            >
              <Trash2 size={11} />
            </button>
          </Tooltip>
        </div>
      </div>
    );
  };

  const renderEmbeddedMasterHorizon = () => {
    const isMasterFocused = focusItem.kind === 'master';
    return (
      <div
        data-guide="board.master-focus" className={`board-master-horizon ${isMasterFocused ? 'is-focused' : ''}`}
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
          const wasPlaying = isPlaying;
          dawEngine.stopAuditionTake(true);
          if (wasPlaying) {
            void dawEngine.startTransport(false);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            setIsVaultOpen(false);
            setMasterExpanded(true);
            onSelectTrack('master');
            clearNonMasterSolos();
            const wasPlaying = isPlaying;
            dawEngine.stopAuditionTake(true);
            if (wasPlaying) {
              void dawEngine.startTransport(false);
            }
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
        {renderMasterDents('horizon')}
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
        setActiveExtractedTakeId(null);
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

  const renderUniversalSelectionHandles = (rowDur: number = totalDuration, trackId?: string) => {
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
      const rect = laneEl?.getBoundingClientRect();
      const width = rect?.width || 300;
      const clickRatio =
        rect && rect.width > 0
          ? Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
          : selection.start / safeDur;
      const clickSec = clickRatio * safeDur;
      laneRangeDragRef.current = {
        mode,
        originSec: clickSec,
        initialStart: selection.start,
        initialEnd: selection.end,
        startClientX: e.clientX,
        width,
        rowDur: safeDur,
        moved: false,
      };
      const onMove = (ev: PointerEvent) => {
        const st = laneRangeDragRef.current;
        if (!st) return;
        if (!st.moved && Math.abs(ev.clientX - st.startClientX) < 5) return;
        st.moved = true;
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
        const st = laneRangeDragRef.current;
        laneRangeDragRef.current = null;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        if (st && !st.moved && st.mode === 'pan') {
          setPlayhead(st.originSec);
          if (trackId && trackId !== 'master') {
            onSelectTrack(trackId);
            dawEngine.auditionTrack(trackId, st.originSec);
          } else {
            dawEngine.stopAuditionTake(true);
            dawEngine.seek(st.originSec);
            void dawEngine.startTransport(false);
          }
        }
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


  const renderInLaneSegmentHud = (rowDur: number = totalDuration) => {
    if (!selection || selection.end <= selection.start) return null;
    const safeDur = Math.max(rowDur, 1);
    const leftPct = Math.max(0, Math.min(82, (selection.start / safeDur) * 100));
    const widthPct = Math.max(0, Math.min(100 - leftPct, ((selection.end - selection.start) / safeDur) * 100));
    return (
      <div
        data-guide="board.selection-actions" className="board-segment-hud"
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
                data-guide="board.master-focus" className={`board-track-badge board-badge-mst board-track-badge-btn ${masterRestyleTakes.length > 0 && (!masterTrack?.activeVersionTakeId || masterTrack.activeVersionTakeId === 'MST') ? 'selected' : ''}`}
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
                {showFullControllers ? 'MST' : 'MST'}
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

            {showFullControllers && mountableLanes.length > 0 && (
              <div
                className="board-lane-mount-pills"
                aria-label="Lane mount controls"
                onClick={(e) => e.stopPropagation()}
              >
                {mountableLanes.map((lane) => {
                  const isLaneMounted = lane.mounted !== false && !lane.muted;
                  const laneColor = getStemColor(lane.name);
                  return (
                    <Tooltip
                      key={`mount-pill-${lane.id}`}
                      title={`${lane.name} (${isLaneMounted ? 'Mounted on Master' : 'Unmounted'})`}
                      description={`Click to ${isLaneMounted ? 'unmount/mute' : 'mount/unmute'} ${lane.name} on Master`}
                    >
                      <button
                        type="button"
                        aria-label={`Mount ${lane.name} on Master`}
                        aria-pressed={isLaneMounted}
                        className={`board-track-badge board-badge-sub board-stem-mount-pill ${isLaneMounted ? 'is-mounted selected' : 'is-muted'}`}
                        style={{ '--track-color': laneColor } as React.CSSProperties}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleTrackMounted(lane.id);
                        }}
                      >
                        {formatTrackBadgeCode(lane)}
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
                  <Tooltip title="Merge Restyle" description="Merge this restyle as the new master.">
                    <button
                      type="button"
                      className="board-btn-mini active"
                      data-guide="board.restyle-actions" aria-label="Merge Restyle version into Master"
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
                      ? 'Isolate the recording into instruments and vocals.'
                      : masterExpanded
                        ? 'Show the master as one waveform. Keep the extracted lanes.'
                        : 'Show instrument and vocal colors in the master waveform.'
                  }
                >
                  <button
                    type="button"
                    className="board-btn-mini"
                    data-guide="board.separate" aria-label={
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
                        onIsolateStems();
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

              <Tooltip title="Merge all" description="Merge all enabled sections and lanes into the master.">
                <button
                  type="button"
                  className="board-btn-mini"
                  data-guide="board.merge-all" aria-label="Merge all mounted sections"
                  disabled={Boolean(pendingTake) || !mergeableMountedIds.length}
                  onClick={(event) => {
                    event.stopPropagation();
                    void mergeTakes(mergeableMountedIds);
                  }}
                >
                  <Layers size={11} />
                </button>
              </Tooltip>
            </div>

            {showFullControllers && renderFocusGlobalUtilities()}
          </div>
        </div>

        {/* Row 2: 100%-Width Master Waveform & SoundCloud-like Dents + Selector Row */}
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
            showSelection={isManualSelection}
            onReworkSection={onReworkSection}
            onSelectTrack={onSelectTrack}
            lanes={masterExpanded ? masterLanes : []}
            selectedTrackId={selectedTrackId}
            highlighted={highlighted}
            className="board-master-waveform"
          />

          {renderMasterDents('stage')}
          {showFullControllers && renderMasterExtractedSelector()}
          {showFullControllers && isManualSelection && renderInLaneSegmentHud(totalDuration)}

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
    const clip = trackItem.clips[0];
    const isLaneMounted = trackItem.mounted !== false && !trackItem.muted;
    const isTrackPlaying =
      isPlaying &&
      (playingTakeId === trackItem.id ||
        (!playingTakeId && isLaneMounted && (!anySoloed || trackItem.solo)));

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
      Boolean(activeLayerTakeId) ||
      !hasOriginal ||
      laneLayerTakes.length > 0;
    const canMergeLane = Boolean(activeLayerTakeId) || !hasOriginal;
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
            <Tooltip
              title={trackItem.name}
              description={`Stem channel: ${trackItem.name}`}
            >
              <span
                className="board-track-badge board-badge-track board-track-badge-colored"
                style={{ '--track-color': brandColor } as React.CSSProperties}
              >
                {showFullControllers ? formatTrackBadgeFull(trackItem) : formatTrackBadgeCode(trackItem)}
              </span>
            </Tooltip>

            {showFullControllers && (hasSynthVersions || laneLayerTakes.length > 0) && (
              <div data-guide="board.layer-versions" data-guide-entity={trackItem.id} className="board-category-badges-row" onClick={(e) => e.stopPropagation()}>
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
                          void selectLaneVersion(trackItem.id, null).then(() => {
                            dawEngine.auditionTrack(trackItem.id);
                          });
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
                            void selectLaneVersion(trackItem.id, take.id).then(() => {
                              dawEngine.auditionTrack(trackItem.id);
                            });
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
                          onClick={() => {
                            selectSynthVersion(trackItem.id, ver.id);
                            dawEngine.auditionTrack(trackItem.id);
                          }}
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
                        onClick={() => {
                          addSynthVersion(trackItem.id);
                          dawEngine.auditionTrack(trackItem.id);
                        }}
                      >
                        +
                      </button>
                    </Tooltip>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 3-Icon Controller Strip (PLAY + color/uncolor mount toggle, MERGE, DELETE) */}
          <div className="board-controller-right">
            {showFullControllers && (
              <div className="board-fader-wrap">
                <Volume2 size={12} color={brandColor} />
                <Tooltip
                  title="Double-click to reset volume to 100%"
                  className="board-fader-slider-wrap"
                >
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
                    onChange={(e) =>
                      updateTrackMixer(trackItem.id, { volume: parseFloat(e.target.value) })
                    }
                  />
                </Tooltip>
                <span className="board-fader-val">{Math.round(trackItem.volume * 100)}%</span>
              </div>
            )}

            <div className="board-track-controls">
              <Tooltip
                title={isTrackPlaying ? 'Stop track' : 'Audition track'}
                description={`Solo audition of ${trackItem.name}`}
              >
                <button
                  type="button"
                  data-guide="board.lane-play"
                  aria-label={isTrackPlaying ? `Stop ${trackItem.name}` : `Play ${trackItem.name}`}
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

              {showFullControllers && (
                <>
                  <Tooltip
                    title={isLaneMounted ? 'Mute / Unmount from Master' : 'Unmute / Mount on Master'}
                    description={`Toggle ${trackItem.name} on/off in Master playback`}
                  >
                    <button
                      type="button"
                      aria-label={`Mute ${trackItem.name}`}
                      aria-pressed={!isLaneMounted}
                      className={`board-btn-mini mute ${!isLaneMounted ? 'active' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleTrackMounted(trackItem.id);
                      }}
                    >
                      M
                    </button>
                  </Tooltip>

                  <Tooltip
                    title="Solo"
                    description={`Play only ${trackItem.name} (or together with Master when off)`}
                  >
                    <button
                      type="button"
                      aria-label={`Solo ${trackItem.name}`}
                      aria-pressed={Boolean(trackItem.solo)}
                      className={`board-btn-mini solo ${trackItem.solo ? 'active' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        dawEngine.stopAuditionTake(true);
                        updateTrackMixer(trackItem.id, { solo: !trackItem.solo });
                      }}
                    >
                      S
                    </button>
                  </Tooltip>
                </>
              )}

              {showFullControllers &&
                (isTrackSculpted || activeLayerTakeId || (trackItem.type === 'stem' && activeSynthVerId)) && (
                  <Tooltip
                    title="Reset Track"
                    description={`Reset ${trackItem.name} to original unsculpted stem`}
                  >
                    <button
                      type="button"
                      className="board-btn-mini"
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

              {/* MERGE (ONLY for non-native added lanes OR when a Layer Take is active on a lane) */}
              {canMergeLane && (
                <Tooltip
                  title={`Merge ${trackItem.name}`}
                  description={
                    activeLayerTakeId
                      ? `Merge this layer into the ${trackItem.name} lane`
                      : `Bake ${trackItem.name} directly into Master`
                  }
                >
                  <button
                    type="button"
                    className="board-btn-mini active"
                    data-guide-entity={trackItem.id}
                    data-guide={activeLayerTakeId ? 'board.layer-merge' : 'board.lane-merge'}
                    aria-label={
                      activeLayerTakeId
                        ? `Merge Layer into ${trackItem.name}`
                        : `Merge ${trackItem.name} into Master`
                    }
                    disabled={Boolean(pendingTake)}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (activeLayerTakeId) {
                        void activateTake(activeLayerTakeId, 'merge');
                      } else {
                        void mergeTakes(
                          [trackItem.id],
                          isManualSelection && selection ? selection : undefined
                        );
                      }
                    }}
                  >
                    <Check size={10} />
                  </button>
                </Tooltip>
              )}

              {/* DELETE */}
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
                      } else if (!hasOriginal) {
                        removeTrack(trackItem.id);
                      }
                    }}
                  >
                    <Trash2 size={10} />
                  </button>
                </Tooltip>
              )}
            </div>

            {showFullControllers && renderFocusGlobalUtilities()}
          </div>
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

          {showFullControllers && (isSynthTrack || isSynthVersionActiveOnStem) && renderUniversalSelectionHandles(totalDuration, trackItem.id)}
          {showFullControllers && renderInLaneSegmentHud(totalDuration)}

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
    const { start: takeStart, end: takeEnd, overlayTrack: takeOverlay } = getExtractedTakeInterval(currentTake);
    const isCurrentActive = Boolean(takeOverlay && !takeOverlay.muted);
    const originalEnabled = !originals.some((r) => r.start < takeEnd && r.end > takeStart);
    const isTakeSolo = Boolean(takeOverlay?.solo);
    const isTakePlaying =
      isPlaying &&
      (playingTakeId === currentTake.id || (!playingTakeId && isCurrentActive));
    const isSelected = selectedTrackId === currentTake.id;
    const showFullControllers = role === 'focus';

    return (
      <div
        key={`stage-take-${currentTake.id}`}
        data-track-id={currentTake.id}
        className={`board-row board-stage-card is-${role} ${isSelected ? 'selected' : ''} ${isCurrentActive ? 'active-take' : ''}`}
        onClick={() => {
          void playExtractedTakeAtClick(currentTake);
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
              description={`Take #${currentTake.take_number} • Click to color/uncolor on Master`}
            >
              <button
                type="button"
                className={`board-track-badge board-badge-track board-track-badge-category ${isCurrentActive ? 'active' : ''}`}
                aria-label={`Category: ${categoryTitle}, Take #${currentTake.take_number}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveCategoryTakeId((prev) => ({
                    ...prev,
                    [category]: currentTake.id,
                  }));
                  void toggleTake(currentTake.id);
                }}
              >
                {categoryTitle}
              </button>
            </Tooltip>

            {showFullControllers && (
              <div
                className="board-category-badges-row"
                aria-label={`${categoryTitle} take selector`}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="board-category-badges-list">
                  {catTakes.map((take) => {
                    const isTakeSelected = currentTake.id === take.id;
                    const isTakeMixActive = mounted(take, tracks, takes);
                    return (
                      <Tooltip
                        key={take.id}
                        title={`${categoryTitle} #${take.take_number}${isTakeMixActive ? ' · Mounted on Master' : ''}`}
                        description={`Swap ${categoryTitle} lane to Take #${take.take_number}`}
                      >
                        <button
                          type="button"
                          aria-label={`Swap ${categoryTitle} to Take #${take.take_number}`}
                          aria-pressed={isTakeSelected}
                          className={`board-take-badge-pill board-badge-sub ${isTakeSelected ? 'selected' : ''} ${isTakeMixActive ? 'mix-active' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            void swapCategoryTake(category, take, catTakes, true);
                          }}
                        >
                          #{take.take_number}
                        </button>
                      </Tooltip>
                    );
                  })}
                </div>
              </div>
            )}

            {currentTake.repainting_start != null && currentTake.repainting_end != null && (
              <span className="board-take-interval-label">
                [{formatTime(currentTake.repainting_start).slice(0, 5)} ➔{' '}
                {formatTime(currentTake.repainting_end).slice(0, 5)}]
              </span>
            )}
          </div>

          <div className="board-controller-right">
            <div className="board-track-controls">
              {/* 1. PLAY + ORG/TK#/M/S */}
              <div className="board-overlay-player">
                <Tooltip
                  title={isTakePlaying ? 'Stop playback' : 'Play take with Master'}
                  description={`Preview Take #${currentTake.take_number} with Master (ORG/TK#${currentTake.take_number})`}
                >
                  <button
                    type="button"
                    aria-label={
                      isTakePlaying
                        ? `Stop Take #${currentTake.take_number}`
                        : `Play Take #${currentTake.take_number}`
                    }
                    className={`board-btn-mini play ${isTakePlaying ? 'active playing' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isTakePlaying) {
                        dawEngine.pauseTransport();
                      } else {
                        void playExtractedTakeAtClick(currentTake);
                      }
                    }}
                  >
                    {isTakePlaying ? <Square size={10} /> : <Play size={10} />}
                  </button>
                </Tooltip>

                {showFullControllers && (
                  <div className="board-overlay-choices">
                    <Tooltip
                      title="Original Master"
                      description="Include or silence original Master recording in this section"
                    >
                      <button
                        type="button"
                        className={`board-sc-choice-btn org ${originalEnabled && !isTakeSolo ? 'active' : ''}`}
                        aria-label={`Original audio for Take #${currentTake.take_number}`}
                        aria-pressed={originalEnabled && !isTakeSolo}
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (isTakeSolo && takeOverlay) {
                            updateTrackMixer(takeOverlay.id, { solo: false });
                          }
                          toggleOriginal({ start: takeStart, end: takeEnd });
                        }}
                      >
                        ORG
                      </button>
                    </Tooltip>

                    <Tooltip
                      title={isCurrentActive ? `Unmount Take #${currentTake.take_number}` : `Mount Take #${currentTake.take_number}`}
                      description={`Mount or mute Take #${currentTake.take_number} on Master`}
                    >
                      <button
                        type="button"
                        className={`board-sc-choice-btn tk ${isCurrentActive ? 'active' : ''}`}
                        aria-label={`Take #${currentTake.take_number} audio`}
                        aria-pressed={isCurrentActive}
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (!takeOverlay) {
                            await toggleTake(currentTake.id);
                          } else {
                            const nextMuted = !takeOverlay.muted;
                            updateTrackMixer(takeOverlay.id, { muted: nextMuted });
                            if (nextMuted && !originalEnabled) {
                              toggleOriginal({ start: takeStart, end: takeEnd });
                            }
                          }
                        }}
                      >
                        TK#{currentTake.take_number}
                      </button>
                    </Tooltip>

                    <Tooltip
                      title={isCurrentActive ? 'Mute Extract on Master' : 'Unmute Extract on Master'}
                      description={`Toggle Take #${currentTake.take_number} on/off in Master playback`}
                    >
                      <button
                        type="button"
                        className={`board-btn-mini mute ${!isCurrentActive ? 'active' : ''}`}
                        aria-label={`Mute Take #${currentTake.take_number}`}
                        aria-pressed={!isCurrentActive}
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (!takeOverlay) {
                            await toggleTake(currentTake.id);
                          } else {
                            const nextMuted = !takeOverlay.muted;
                            updateTrackMixer(takeOverlay.id, { muted: nextMuted });
                            if (nextMuted && !originalEnabled) {
                              toggleOriginal({ start: takeStart, end: takeEnd });
                            }
                          }
                        }}
                      >
                        M
                      </button>
                    </Tooltip>

                    <Tooltip
                      title="Solo Extract"
                      description={`Play only Take #${currentTake.take_number} (or together with Master when off)`}
                    >
                      <button
                        type="button"
                        className={`board-btn-mini solo ${isTakeSolo ? 'active' : ''}`}
                        aria-label={`Solo Take #${currentTake.take_number}`}
                        aria-pressed={isTakeSolo}
                        onClick={async (e) => {
                          e.stopPropagation();
                          let overlay = takeOverlay;
                          if (!overlay) {
                            await toggleTake(currentTake.id);
                            overlay = useDawStore
                              .getState()
                              .tracks.find((t) => t.id === currentTake.id);
                          }
                          if (overlay) {
                            updateTrackMixer(overlay.id, { solo: !overlay.solo, muted: false });
                          }
                        }}
                      >
                        S
                      </button>
                    </Tooltip>
                  </div>
                )}
              </div>

              {/* 2. MERGE */}
              <Tooltip
                title="Merge Take"
                description={`Merge Take #${currentTake.take_number} into Master`}
              >
                <button
                  type="button"
                  className="board-btn-mini active"
                  aria-label={`Merge Take #${currentTake.take_number}`}
                  disabled={Boolean(pendingTake)}
                  onClick={async (e) => {
                    e.stopPropagation();
                    const takeRange = getExtractedTakeInterval(currentTake);
                    if (!takeRange.overlayTrack) {
                      await toggleTake(currentTake.id);
                    } else if (takeRange.overlayTrack.muted) {
                      updateTrackMixer(takeRange.overlayTrack.id, { muted: false });
                    }
                    await mergeTakes([currentTake.id], { start: takeRange.start, end: takeRange.end });
                  }}
                >
                  <Check size={10} />
                </button>
              </Tooltip>

              {/* 3. DELETE */}
              <Tooltip
                title="Delete Take"
                description={`Permanently remove Take #${currentTake.take_number}`}
              >
                <button
                  type="button"
                  className="board-btn-mini delete"
                  aria-label={`Delete Take #${currentTake.take_number}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    void deleteTake(currentTake.id);
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
              startLaneBackgroundRangeDrag(e, totalDuration);
            }
          }}
          onClick={(e) => {
            e.stopPropagation();
            void playExtractedTakeAtClick(currentTake, e);
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
                      '--start-pct': `${(takeRange.start / totalDuration) * 100}%`,
                      '--width-pct': `${((takeRange.end - takeRange.start) / totalDuration) * 100}%`,
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
                    onSeek={(sec) => void playExtractedTakeAtClick(currentTake, undefined, true, sec)}
                  />
                </div>
              );
            })()
            : null}

          {showFullControllers && !currentTake.url && renderUniversalSelectionHandles(totalDuration)}
          {showFullControllers && renderInLaneSegmentHud(totalDuration)}

          <BoardPlayheadLine totalDuration={totalDuration} />
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
    | {
      kind: 'category';
      id: string;
      category: string;
      catTakes: typeof takes;
      take: (typeof takes)[number];
    };

  const rawMatrixEntries: MatrixEntry[] = [
    ...laneTracks.map((track): MatrixEntry => ({ kind: 'lane', id: track.id, track })),
    ...Object.entries(takesByCategory).map(([category, catTakes]): MatrixEntry => {
      const activeTake = getCategoryActiveTake(category, catTakes);
      return {
        kind: 'category',
        id: `cat-${category}`,
        category,
        catTakes,
        take: activeTake,
      };
    }),
  ];

  // Order unselected lanes by decreasing "latest-opened" (MRU), excluding focused lane/category and Master
  const allMatrixEntries = [...rawMatrixEntries]
    .filter((entry) => {
      if (entry.kind === 'lane') return entry.id !== focusItem.id;
      if (focusItem.kind === 'extracted') return entry.category !== focusItem.category;
      return true;
    })
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
      const anySoloed = tracks.some((t) => t.solo);
      const isLaneMounted = trackItem.mounted !== false && !trackItem.muted;
      const isTrackPlaying =
        isPlaying &&
        (playingTakeId === trackItem.id ||
          (!playingTakeId && isLaneMounted && (!anySoloed || trackItem.solo)));
      const isSynthTrack =
        trackItem.type === 'pianoroll' ||
        trackItem.type === 'sequencer' ||
        trackItem.type === 'strudel';
      return (
        <div
          key={`${inVault ? 'vault' : 'matrix'}-lane-${trackItem.id}`}
          data-track-id={!isFocused ? trackItem.id : undefined}
          data-matrix-id={trackItem.id}
          className={`board-mini-square ${inVault ? 'in-vault' : ''} ${isFocused ? 'is-selected' : ''} ${!isLaneMounted ? 'is-muted' : ''} ${trackItem.solo ? 'is-solo' : ''} ${isTrackPlaying ? 'is-playing' : ''}`}
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
                  onSelectTrack(trackItem.id);
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

    const { category, catTakes, take } = entry;
    const isFocused = focusItem.kind === 'extracted' && focusItem.category === category;
    const categoryTitle = taskLabel(category);
    const categoryCode = taskBadgeLabel(category);
    const isTakeMounted = catTakes.some((t) => mounted(t, tracks, takes));
    const isTakePlaying =
      isPlaying &&
      (catTakes.some((t) => playingTakeId === t.id) || (!playingTakeId && isTakeMounted));
    const takeRange = interval(take, totalDuration || 60);
    return (
      <div
        key={`${inVault ? 'vault' : 'matrix'}-cat-${category}`} data-guide="board.take-display" data-guide-entity={take.id}
        data-track-id={!isFocused ? take.id : undefined}
        data-matrix-id={`cat-${category}`}
        className={`board-mini-square is-take ${inVault ? 'in-vault' : ''} ${isFocused ? 'is-selected' : ''} ${isTakeMounted ? 'is-mounted' : ''} ${isTakePlaying ? 'is-playing' : ''}`}
        style={{ '--track-color': isTakeMounted ? '#00ff41' : '#00ccff' } as React.CSSProperties}
        role="button"
        tabIndex={0}
        aria-label={`Focus ${categoryTitle} Take #${take.take_number}`}
        aria-pressed={isFocused}
        onClick={() => {
          setIsVaultOpen(false);
          setActiveCategoryTakeId((prev) => ({ ...prev, [category]: take.id }));
          void playExtractedTakeAtClick(take);
        }}
      >
        <div className="board-mini-square-top">
          <div className="board-mini-square-badges">
            <span
              className={`board-track-badge board-badge-track board-track-badge-category ${isTakeMounted ? 'active' : ''}`}
            >
              {categoryCode}
            </span>
            <div className="board-mini-category-takes">
              {catTakes.map((t) => {
                const isActiveTakeInCat = t.id === take.id;
                const isThisMounted = mounted(t, tracks, takes);
                return (
                  <button
                    key={t.id}
                    type="button"
                    aria-label={`Select ${categoryTitle} #${t.take_number}`}
                    aria-pressed={isActiveTakeInCat}
                    className={`board-take-badge-pill board-badge-sub ${isActiveTakeInCat ? 'selected' : ''} ${isThisMounted ? 'mix-active' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsVaultOpen(false);
                      void swapCategoryTake(category, t, catTakes, true);
                    }}
                  >
                    #{t.take_number}
                  </button>
                );
              })}
            </div>
          </div>
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
                dawEngine.pauseTransport();
              } else {
                void playExtractedTakeAtClick(take, undefined, false);
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
                  '--start-pct': `${(takeRange.start / totalDuration) * 100}%`,
                  '--width-pct': `${((takeRange.end - takeRange.start) / totalDuration) * 100}%`,
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
          <BoardPlayheadLine totalDuration={totalDuration} />
        </div>
      </div>
    );
  };

  const guideView = { masterExpanded, isCanvasOpen, isAddMenuOpen, isVaultOpen, guideDisplayId, guideTakeId };
  const guideViewRef = useRef(guideView); guideViewRef.current = guideView;
  const guideLanesRef = useRef({ tracks, takes }); guideLanesRef.current = { tracks, takes };
  useGuideOwner({
    id: 'board', scope: guideProjectId ?? 'loading', handles: step => step.owner === 'board' || ['E2', 'E3', 'E6', 'H1', 'I3'].includes(step.id),
    prepare: ({ step, bind }) => {
      const takeId = bind('take', activeExtractedTake?.id ?? allExtractedTakes[0]?.id);
      const isNativeStemLane = (t: (typeof tracks)[number]) =>
        t.type === 'stem' && t.hasOriginalStem !== false && !t.id.startsWith('layer-');
      const canLaneMerge = (t: (typeof tracks)[number]) =>
        !isNativeStemLane(t) || Boolean(t.activeVersionTakeId && t.activeVersionTakeId !== 'ORG');
      const preferredLane =
        step.id === 'T6'
          ? (selectedTrackId !== 'master'
            ? tracks.find((track) => track.id === selectedTrackId && canLaneMerge(track))
            : undefined) ??
          tracks.find((track) => track.id !== 'master' && canLaneMerge(track))
          : (selectedTrackId !== 'master' && tracks.some((track) => track.id === selectedTrackId)
            ? tracks.find((track) => track.id === selectedTrackId)
            : undefined) ??
          tracks.find((track) => track.id !== 'master' && track.clips.length);
      const laneId = bind('lane', preferredLane?.id);
      const lane = tracks.find(track => track.id === laneId);
      const patch: Partial<typeof guideView> = { isAddMenuOpen: step.id === 'E3', isVaultOpen: step.id === 'T1' && vaultMatrixEntries.length > 0 };
      if (['E2', 'T1', 'T2', 'T4', 'T7', 'T8', 'I9'].includes(step.id)) { patch.guideDisplayId = 'master'; patch.masterExpanded = true; }
      if (['T1', 'T2', 'T4'].includes(step.id) && takeId) patch.guideTakeId = takeId;
      if (['T5', 'T6'].includes(step.id) && lane) patch.guideDisplayId = lane.id;
      if (step.id === 'I10') patch.isCanvasOpen = true;
      const result = prepareViews(guideView, () => guideViewRef.current, { masterExpanded: setMasterExpanded, isCanvasOpen: setIsCanvasOpen, isAddMenuOpen: setIsAddMenuOpen, isVaultOpen: setIsVaultOpen, guideDisplayId: setGuideDisplayId, guideTakeId: setGuideTakeId }, patch);
      if (['T1', 'T2', 'T4'].includes(step.id) && !takeId) return { ...result, target: 'board.takes-status', description: 'AI edits appear here when they finish.' };
      if (step.id === 'R2' && selection || step.id === 'R3' && !selection || step.id === 'I3' && !selection) return { ...result, target: selection ? 'board.selection-actions' : 'board.section', description: selection ? 'A section is selected. Use its handles and actions here.' : 'Use SECTION to select a range, then open its actions.' };
      if (step.id === 'R5' && sculptMode !== 'curve') return { ...result, target: 'board.sculpt-mode', description: 'Choose Smooth to use the fade handles.' };
      if (step.id === 'I9' && hasExtractedStems) return { ...result, target: 'board.stems', focus: 'self', description: 'Your separated stems are here. Select one to work on it.' };
      if (step.id === 'T5' && lane) {
        const layers = takes.filter(take => isLayerTake(take) && !take.is_active && !take.provenance?.mergedInto && (layerTrackName(take) ?? 'other') === (lane.layerName || lane.name).toLowerCase().replace(/\s+/g, '_'));
        if (!layers.length) return { ...result, target: 'board.stems', focus: 'self', description: 'Generate a Layer take for this lane to reveal its layer controls.' };
        if (!layers.some(take => take.id === lane.activeVersionTakeId)) return {
          ...result, target: 'board.layer-versions', entity: lane.id,
          description: 'Choose a Layer version to reveal its Merge control.',
          retry: () => layers.some(take => take.id === guideLanesRef.current.tracks.find(track => track.id === lane.id)?.activeVersionTakeId)
        };
      }
      if (step.id === 'T6' && lane && takes.some(take => take.id === lane.activeVersionTakeId && isLayerTake(take) && !take.is_active && !take.provenance?.mergedInto)) return {
        ...result, target: 'board.layer-merge', entity: lane.id,
        description: 'Merge this Layer into its lane before merging the lane into Master.',
        retry: () => !guideLanesRef.current.tracks.find(track => track.id === lane.id)?.activeVersionTakeId,
      };
      if (step.id === 'T6' && (!lane || !canLaneMerge(lane))) return { ...result, target: 'board.stems', description: 'Select an added lane to use its Merge into Master control.' };
      if (['T5', 'T6'].includes(step.id) && !lane) return { ...result, target: 'board.stems', description: 'Select a populated lane to use its Merge control.' };
      if (step.id === 'T8' && (!masterTrack?.activeVersionTakeId || masterTrack.activeVersionTakeId === 'MST')) return { ...result, target: 'board.master-focus', description: 'Restyle controls appear when a Restyle version is active on Master.' };
      return {
        ...result, target: step.id === 'T1' ? 'board.take-display' : step.id === 'R5' ? 'board.waveform' : undefined, entity: ['T1', 'T2', 'T4'].includes(step.id) ? takeId : ['T5', 'T6'].includes(step.id) ? laneId : undefined,
        focus: step.id === 'H1' ? canUndo || canRedo ? 'button:not(:disabled)' : 'self' : step.id === 'T2' ? '[aria-label^="Original audio for Take"]' : undefined
      };
    },
  });

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
            <div data-guide="board.stems" className="board-stems-card" role="group" tabIndex={-1} aria-label="Stems Matrix">
              <div data-guide="board.takes-status" tabIndex={-1} aria-label="Takes and lanes" className="board-stage-matrix">
                {visibleMatrixEntries.map((entry) => renderMatrixSquare(entry, false))}

                {!hasExtractedStems && visibleMatrixEntries.length < 3 && (
                  <button
                    type="button"
                    className="board-mini-square board-extract-cta"
                    disabled={isSeparating}
                    onClick={() => {
                      setMasterExpanded(true);
                      onIsolateStems();
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
                      data-guide="board.take-vault" className={`board-vault-popover ${isVaultOpen ? 'is-open' : ''}`}
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

                {operations.filter((operation) => operation.status !== 'error').map((operation) => (
                  <div
                    key={operation.id}
                    className="board-mini-square board-operation"
                    role="status"
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
            onLyricsChange={onLyricsChange}
            vocalLanguage={vocalLanguage}
            onVocalLanguageChange={onVocalLanguageChange}
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
