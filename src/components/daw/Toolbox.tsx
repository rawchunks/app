import React, { useState, useRef, useEffect } from 'react';
import {
  useDawStore,
  isTrackMixerModified,
  isTrackFxModified,
  isTrackSynthModified,
  type LyricsAlignment,
} from '../../lib/daw/store';
import { dawEngine } from '../../lib/daw/engine';
import { mounted, taskLabel } from '../../lib/daw/takes';
import {
  Wand2,
  Sliders,
  Drum,
  Terminal,
  Activity,
  Plus,
  History,
  ArrowUp,
  X,
  Minimize2,
  Maximize2,
  Sparkles,
  Layers,
  ArrowRightCircle,
  Shuffle,
  Split,
  GripHorizontal,
  Trash2,
  Play,
  Pause,
  Square,
  RotateCcw,
  Repeat,
  Rows3,
  Columns3,
  FilePenLine,
} from 'lucide-react';
import type { Options } from '../../hooks/use-options';
import { Modal } from '../modal';
import { Task } from '../../lib/schema';
import { Rack } from './Rack';
import { Keys } from './Keys';
import { Drums } from './Drums';
import { Strudel } from './Strudel';
import { Sampler } from './Sampler';
import { Mixer } from './mixer';
import { Canvas } from './Canvas';
import { Tooltip } from './Tooltip';
import { Key } from './Keys';
import { toast } from 'sonner';

export type ActiveTool = 'studio' | 'mixer' | 'keys' | 'drums' | 'strudel' | 'dsp' | 'sample' | 'history' | null;

export interface ToolboxProps {
  options?: Options['editing'];
  languages?: Options['generation']['languages'];
  optionsError?: string;
  parameters: Record<string, string | number | string[]>;
  onParametersChange: (values: Record<string, string | number | string[]>) => void;
  activeTool: ActiveTool;
  onSelectTool: (tool: ActiveTool) => void;
  task: Task;
  onSelectTask: (task: Task) => void;
  prompt: string;
  onPromptChange: (prompt: string) => void;
  lyrics?: string;
  onLyricsChange?: (lyrics: string) => void;
  vocalLanguage?: string;
  onVocalLanguageChange?: (language: string) => void;
  hasExistingLyrics?: boolean;
  isTranscribingLyrics?: boolean;
  onExtractLyrics?: () => void;
  lyricsAlignment?: LyricsAlignment | null;
  isAligningLyrics?: boolean;
  onAlignLyrics?: (customLyrics?: string) => void;
  selectedQuality: string;
  onQualityChange: (quality: string) => void;
  repaintMode: 'conservative' | 'balanced' | 'aggressive';
  onRepaintModeChange: (mode: 'conservative' | 'balanced' | 'aggressive') => void;
  repaintStrength: number;
  onRepaintStrengthChange: (strength: number) => void;
  instrument: string;
  onInstrumentChange: (instrument: string) => void;
  coverStrength: number;
  onCoverStrengthChange: (strength: number) => void;
  targetDuration: number;
  onTargetDurationChange: (dur: number) => void;
  stemType: string;
  onStemTypeChange: (type: string) => void;
  onExecute: () => void;
  processing: boolean;
  progress?: number;
  reveal?: number;
  selectedTrackId: string;
  onSelectTrack?: (trackId: string) => void;
  onClearSelection: () => void;
  onOpenCommitModal: () => void;
}

const ACTION_ICONS = {
  repaint: Sparkles,
  lego: Layers,
  complete: Wand2,
  extend: ArrowRightCircle,
  cover: Shuffle,
  extract: Split,
};

// All AI tasks, instruments, stems, presets, and quick tags are dynamically driven by /api/options.

export const Toolbox: React.FC<ToolboxProps> = ({
  options,
  languages,
  optionsError,
  parameters,
  onParametersChange,
  activeTool,
  onSelectTool,
  task,
  onSelectTask,
  prompt,
  onPromptChange,
  lyrics = '',
  onLyricsChange,
  vocalLanguage = 'en',
  onVocalLanguageChange,
  hasExistingLyrics = false,
  isTranscribingLyrics = false,
  onExtractLyrics,
  lyricsAlignment = null,
  isAligningLyrics = false,
  onAlignLyrics,
  selectedQuality,
  onQualityChange,
  repaintMode,
  onRepaintModeChange,
  repaintStrength,
  onRepaintStrengthChange,
  instrument,
  onInstrumentChange,
  coverStrength,
  onCoverStrengthChange,
  targetDuration,
  onTargetDurationChange,
  stemType,
  onStemTypeChange,
  onExecute,
  processing,
  progress,
  reveal,
  selectedTrackId,
  onSelectTrack,
  onClearSelection,
  onOpenCommitModal,
}) => {
  const tracks = useDawStore((s) => s.tracks);
  const selection = useDawStore((s) => s.selection);
  const duration = useDawStore((s) => s.duration);
  const loop = useDawStore((s) => s.loop);
  const setLoop = useDawStore((s) => s.setLoop);
  const setPlayhead = useDawStore((s) => s.setPlayhead);
  const takes = useDawStore((s) => s.takes);
  const commits = useDawStore((s) => s.commits);
  const toggleTake = useDawStore((s) => s.toggleTake);
  const deleteTake = useDawStore((s) => s.deleteTake);
  const isPlaying = useDawStore((s) => s.isPlaying);
  const setPlaying = useDawStore((s) => s.setPlaying);

  // Default to unified self-contained 'compact' mode across all tabs (Item #5)
  const [controllerMode, setControllerMode] = useState<'split' | 'compact'>('compact');
  const [isMinimized, setIsMinimized] = useState<boolean>(false);
  const [splitHeight, setSplitHeight] = useState<number | null>(null);
  const [isPromptModalOpen, setIsPromptModalOpen] = useState<boolean>(false);
  const [isParamModalOpen, setIsParamModalOpen] = useState<boolean>(false);
  const [isLyricsModalOpen, setIsLyricsModalOpen] = useState<boolean>(false);
  const [completePreset, setCompletePreset] = useState<string>('full_band');
  const containerRef = useRef<HTMLDivElement | null>(null);

  const prevRevealRef = useRef(reveal);
  useEffect(() => {
    if (reveal && reveal !== prevRevealRef.current) {
      prevRevealRef.current = reveal;
      setIsMinimized(false);
    }
  }, [reveal]);

  const formatTime = (sec: number) => {
    const safe = Math.max(0, Number.isFinite(sec) ? sec : 0);
    const m = Math.floor(safe / 60);
    const s = Math.floor(safe % 60);
    const ms = Math.floor((safe % 1) * 10);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms}`;
  };

  const handleTogglePlay = async () => {
    if (isPlaying) {
      dawEngine.pauseTransport();
      setPlaying(false);
    } else {
      try {
        await dawEngine.startTransport();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Could not play the arrangement');
      }
    }
  };

  const handleStop = () => {
    dawEngine.stopTransport();
    setPlaying(false);
    setPlayhead(0);
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
      dawEngine.setLoop(nextLoop, 0, duration);
    }
  };

  const selectedTake = takes.find((t) => t.id === selectedTrackId);
  const selectedTrack = tracks.find((t) => t.id === selectedTrackId) || tracks[0];

  const trackName = selectedTake
    ? `#${selectedTake.take_number} ${taskLabel(selectedTake.task)}`
    : selectedTrackId === 'master'
      ? 'MASTER'
      : selectedTrack?.name || 'TRACK';

  let contextChipText = trackName;
  if (selection) {
    contextChipText = `${trackName} ${formatTime(selection.start)}–${formatTime(selection.end)}`;
  }

  // Pointer-captured vertical resize handler for 'split' mode
  const handleSplitResizeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (controllerMode !== 'split' || isMinimized) return;
    e.stopPropagation();
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const startH = containerRef.current?.getBoundingClientRect().height || 180;

    const onMove = (moveEv: PointerEvent) => {
      if (!containerRef.current) return;
      const deltaY = startY - moveEv.clientY;
      const minH = 128;
      const maxH = Math.round(window.innerHeight * 0.62);
      const nextH = Math.round(Math.max(minH, Math.min(maxH, startH + deltaY)));
      containerRef.current.style.setProperty('--controller-h', `${nextH}px`);
      setSplitHeight(nextH);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const [historyTab, setHistoryTab] = useState<'takes' | 'commits'>('takes');
  const [activeTakeCategory, setActiveTakeCategory] = useState<string | null>(null);
  const [activeCommitCategory, setActiveCommitCategory] = useState<string | null>(null);
  const [selectedCommitId, setSelectedCommitId] = useState<string | null>(null);

  const isMixerDirty = tracks.some((t) => isTrackMixerModified(t));
  const isDspDirty = tracks.some((t) => isTrackFxModified(t));
  const isKeysDirty = tracks.some((t) => t.type === 'pianoroll' && isTrackSynthModified(t));
  const isDrumsDirty = tracks.some((t) => t.type === 'sequencer' && isTrackSynthModified(t));
  const isStrudelDirty = tracks.some((t) => t.type === 'strudel' && isTrackSynthModified(t));

  const tabs = [
    { id: 'studio' as ActiveTool, label: 'AI STUDIO', desc: 'AI Generative Studio: rework, layer, extend & isolate', icon: Wand2, className: 'tab-studio', dirty: false },
    { id: 'mixer' as ActiveTool, label: 'MIXER', desc: 'Multitrack faders, panning, mute & solo console', icon: Sliders, className: 'tab-mixer', dirty: isMixerDirty },
    { id: 'keys' as ActiveTool, label: 'KEYS SYNTH', desc: 'Polyphonic piano roll MIDI composer & editor', icon: Key, className: 'tab-keys', dirty: isKeysDirty },
    { id: 'drums' as ActiveTool, label: 'DRUM SEQ', desc: '16-step polyphonic drum pattern sequencer', icon: Drum, className: 'tab-drums', dirty: isDrumsDirty },
    { id: 'strudel' as ActiveTool, label: 'LIVE CODE', desc: 'Strudel REPL for algorithmic pattern generation', icon: Terminal, className: 'tab-strudel', dirty: isStrudelDirty },
    { id: 'dsp' as ActiveTool, label: 'FX RACK', desc: 'Parametric EQ, compression, reverb & delay rack', icon: Activity, className: 'tab-dsp', dirty: isDspDirty },
    { id: 'sample' as ActiveTool, label: 'SAMPLER', desc: 'Import and slice audio samples to tracks', icon: Plus, className: 'tab-sample', dirty: false },
    { id: 'history' as ActiveTool, label: 'HISTORY', desc: `Session takes (${takes.length}) and commit milestones (${commits.length})`, icon: History, className: 'tab-history', dirty: false },
  ];

  // Selecting 'vocals' or 'backing_vocals' in 'lego' (Add Layer) opens the Lyrics Canvas overlay modal directly
  const handleSelectLayerInstrument = (nextInst: string) => {
    onInstrumentChange(nextInst);
    if (nextInst === 'vocals' || nextInst === 'backing_vocals') {
      setIsLyricsModalOpen(true);
    }
  };

  const baseDur = Math.max(5, Math.ceil(duration || 30));
  const minExtendDur = Math.min(
    options?.duration.max ?? 300,
    Math.max(options?.duration.min ?? 5, baseDur + 1),
  );
  const maxExtendDur = options?.duration.max ?? 300;
  const addedExtendSec = Math.max(1, Math.round(targetDuration - baseDur));
  const extendPresets = [
    { value: Math.min(maxExtendDur, baseDur + 15), shortLabel: '+15s', label: `+15s (${Math.min(maxExtendDur, baseDur + 15)}s)` },
    { value: Math.min(maxExtendDur, baseDur + 30), shortLabel: '+30s', label: `+30s (${Math.min(maxExtendDur, baseDur + 30)}s)` },
    { value: Math.min(maxExtendDur, baseDur + 45), shortLabel: '+45s', label: `+45s (${Math.min(maxExtendDur, baseDur + 45)}s)` },
    { value: Math.min(maxExtendDur, baseDur + 60), shortLabel: '+60s', label: `+60s (${Math.min(maxExtendDur, baseDur + 60)}s)` },
    { value: Math.min(maxExtendDur, baseDur + 120), shortLabel: '+120s', label: `+120s (${Math.min(maxExtendDur, baseDur + 120)}s)` },
    { value: maxExtendDur, shortLabel: 'Max', label: `Max (${maxExtendDur}s)` },
  ].filter((preset, idx, arr) => arr.findIndex((p) => p.value === preset.value) === idx);

  const aiTasks = options?.tasks ?? [];
  const reworkPresets = options?.reworkPresets ?? [];
  const coverPresets = options?.coverPresets ?? [];
  const completePresets = options?.completePresets ?? [];
  const promptQuickTags = options?.promptTags ?? [];
  const instrumentList = options?.parameters.trackName?.options ?? options?.tracks ?? [];
  const trackClassesOptions = options?.parameters.trackClasses?.options ?? instrumentList;
  const stemList = React.useMemo(() => {
    const baseStems = options?.stems ?? [];
    const extraTracks = instrumentList.filter((t) => !baseStems.some((s) => s.id === t.id));
    return [...baseStems, ...extraTracks];
  }, [options?.stems, instrumentList]);

  const activeTaskDef = aiTasks.find((t) => t.id === task);
  const qualityOptions = React.useMemo(() => {
    const allModes = options?.qualities ?? options?.modes ?? [];
    if (task === 'lego' || task === 'extract' || task === 'complete') {
      return allModes.filter((m) => m.id === 'base');
    }
    if (activeTaskDef?.modes?.length) {
      return allModes.filter((m) => activeTaskDef.modes.includes(m.id));
    }
    return allModes;
  }, [options?.qualities, options?.modes, task, activeTaskDef]);

  const effectiveRepaintVal =
    repaintMode === 'conservative' ? 0 : repaintMode === 'aggressive' ? 1 : repaintStrength;
  const effectiveRepaintPct = Math.round(effectiveRepaintVal * 100);
  const closestReworkPreset =
    reworkPresets.length > 0
      ? reworkPresets.reduce((prev, curr) =>
        Math.abs(curr.strength - effectiveRepaintVal) < Math.abs(prev.strength - effectiveRepaintVal)
          ? curr
          : prev,
      )
      : { id: repaintMode, mode: repaintMode, strength: effectiveRepaintVal, label: `${effectiveRepaintPct}%`, shortLabel: repaintMode, desc: '' };

  const handleReworkIntensityChange = (val0to1: number) => {
    const clamped = Math.max(0, Math.min(1, Number(val0to1.toFixed(2))));
    if (clamped <= 0.02) {
      onRepaintModeChange('conservative');
      onRepaintStrengthChange(0);
    } else if (clamped >= 0.98) {
      onRepaintModeChange('aggressive');
      onRepaintStrengthChange(1);
    } else {
      onRepaintModeChange('balanced');
      onRepaintStrengthChange(clamped);
    }
  };

  const closestCoverPreset =
    coverPresets.length > 0
      ? coverPresets.reduce((prev, curr) =>
        Math.abs(curr.value - coverStrength) < Math.abs(prev.value - coverStrength) ? curr : prev,
      )
      : { id: String(coverStrength), value: coverStrength, label: `${Math.round(coverStrength * 100)}%`, shortLabel: `${Math.round(coverStrength * 100)}%`, desc: '' };

  const activeInstrumentLabel = instrumentList.find((i) => i.id === instrument)?.label ?? instrument;
  const activeStemLabel = stemList.find((s) => s.id === stemType)?.label ?? stemType;
  const activeCompletePreset =
    completePresets.find((p) => p.id === completePreset) ??
    completePresets[0] ?? { id: completePreset, label: completePreset, classes: String(parameters.trackClasses || ''), desc: '' };

  const getActiveSubnavParamSummary = (
    actionId: string,
  ): { tag: string; value: string; title: string } => {
    if (actionId === 'repaint') {
      return {
        tag: 'INTENSITY',
        value: `${closestReworkPreset.shortLabel} · ${effectiveRepaintPct}%`,
        title: 'Rework Intensity & Crossfade',
      };
    }
    if (actionId === 'lego') {
      const seamSec = Number(parameters.repaintWavCrossfadeSec ?? 0);
      return {
        tag: 'STEM',
        value: seamSec > 0 ? `${activeInstrumentLabel} · ${seamSec.toFixed(2)}s` : activeInstrumentLabel,
        title: 'Layer Stem & Boundary Seam',
      };
    }
    if (actionId === 'extract') {
      return {
        tag: 'TARGET',
        value: activeStemLabel,
        title: 'Target Stem to Isolate',
      };
    }
    if (actionId === 'extend') {
      return {
        tag: 'LENGTH',
        value: `+${addedExtendSec}s (${Math.round(targetDuration)}s)`,
        title: 'Extension Target Length & Seam',
      };
    }
    if (actionId === 'cover') {
      return {
        tag: 'BLEND',
        value: `${closestCoverPreset.shortLabel} · ${Math.round(coverStrength * 100)}%`,
        title: 'Restyle Blend & Source Detail',
      };
    }
    if (actionId === 'complete') {
      return {
        tag: 'FOCUS',
        value: activeCompletePreset.label,
        title: 'Accompaniment Focus & Stems',
      };
    }
    return { tag: 'PARAM', value: 'Configure', title: 'Configure Parameters' };
  };

  const getActiveFilterDescription = (actionId: string): string => {
    if (actionId === 'repaint') {
      return closestReworkPreset.desc;
    }
    if (actionId === 'lego') {
      return instrument === 'vocals' || instrument === 'backing_vocals'
        ? `Adds ${activeInstrumentLabel} stem — opens Lyrics Canvas to write or sync lines`
        : `Layers new ${activeInstrumentLabel} stem locked to your arrangement`;
    }
    if (actionId === 'extract') {
      return `Isolates ${activeStemLabel} into its own dedicated track lane`;
    }
    if (actionId === 'extend') {
      return `Seamlessly extends arrangement to ${Math.round(targetDuration)}s total duration`;
    }
    if (actionId === 'cover') {
      return closestCoverPreset.desc;
    }
    if (actionId === 'complete') {
      return activeCompletePreset.desc;
    }
    return '';
  };

  const promptPlaceholder =
    task === 'repaint'
      ? 'Describe rework (e.g. synth bass, vocal hook)...'
      : task === 'lego'
        ? 'Describe new layer (e.g. funk bassline, airy vocal harmony)...'
        : task === 'extend'
          ? 'Describe continuation (e.g. building outro, drum breakdown)...'
          : task === 'cover'
            ? 'Describe style transformation (e.g. cyberpunk synthwave)...'
            : 'Describe accompaniment style and arrangement...';

  const controllerStyle: React.CSSProperties | undefined =
    controllerMode === 'split' && splitHeight !== null
      ? ({ '--controller-h': `${splitHeight}px` } as React.CSSProperties)
      : undefined;

  return (
    <section
      ref={containerRef}
      style={controllerStyle}
      aria-label="DAW Controller"
      className={`floating-toolbox toolbox-controller mode-${controllerMode} tool-${activeTool || 'none'} ${isMinimized ? 'minimized' : ''}`}
    >
      {/* Top Split Resizer Bar */}
      {controllerMode === 'split' && !isMinimized && (
        <div
          className="toolbox-split-resizer"
          onPointerDown={handleSplitResizeDown}
          title="Drag vertically to resize Controller and Board split"
        >
          <span className="toolbox-split-resizer-pill" />
          <GripHorizontal size={11} className="toolbox-split-resizer-grip" />
        </div>
      )}

      {/* TIER 1: Unified Master Transport + 8-Tool Switcher + Mode/Collapse */}
      <div className="toolbox-header-row">
        {/* Left: Master Transport + Focus Chip (No duplicate time counter) */}
        <div className="toolbox-transport-group toolbox-interactive-element">
          <Tooltip title={isPlaying ? 'Pause' : 'Play'} description="Start or pause arrangement playback (Space)">
            <button
              type="button"
              className={`toolbox-transport-btn ${isPlaying ? 'active' : ''}`}
              onClick={handleTogglePlay}
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause size={12} /> : <Play size={12} />}
            </button>
          </Tooltip>
          <Tooltip title="Stop" description="Stop transport and return playhead to zero">
            <button
              type="button"
              className="toolbox-transport-btn"
              onClick={handleStop}
              aria-label="Stop"
            >
              <Square size={11} />
            </button>
          </Tooltip>
          <Tooltip title="Return to Zero" description="Jump playhead to 00:00.0">
            <button
              type="button"
              className="toolbox-transport-btn toolbox-rtz-btn"
              onClick={handleReturnToZero}
              aria-label="Return to zero"
            >
              <RotateCcw size={11} />
            </button>
          </Tooltip>
          <Tooltip title="Loop" description="Loop selected time region or full arrangement">
            <button
              type="button"
              className={`toolbox-transport-btn ${loop ? 'active' : ''}`}
              onClick={handleToggleLoop}
              aria-label="Loop"
            >
              <Repeat size={12} />
            </button>
          </Tooltip>

          {/* Dynamic Context Chip (Single place for selected track / section) */}
          <Tooltip title="Focus" description="Currently selected track or time region target">
            <div className="toolbox-context-chip">
              <span className="toolbox-context-label">{contextChipText}</span>
              {(selection || selectedTrackId !== 'master') && (
                <button
                  type="button"
                  className="toolbox-context-clear"
                  onClick={() => {
                    if (selection) onClearSelection();
                    if (onSelectTrack) onSelectTrack('master');
                    useDawStore.getState().setSelectedTrackId('master');
                  }}
                  title="Reset focus to Master"
                >
                  <X size={11} />
                </button>
              )}
            </div>
          </Tooltip>
        </div>

        {/* Center: 8 Hardware Tool Tabs (Selected tab shows full label; unselected show icon only on mobile) */}
        <div className="toolbox-tabs-bar toolbox-interactive-element" role="tablist">
          {tabs.map((tabItem) => {
            const Icon = tabItem.icon;
            const isActive = activeTool === tabItem.id && !isMinimized;

            return (
              <Tooltip
                title={tabItem.dirty ? `${tabItem.label} (MODIFIED)` : tabItem.label}
                description={tabItem.dirty ? `${tabItem.desc} • Active uncommitted WIP edits` : tabItem.desc}
                key={tabItem.id}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`toolbox-tab-btn tab-${tabItem.id} ${isActive ? `active ${tabItem.className}` : ''} ${tabItem.dirty ? 'is-dirty' : ''}`}
                  onClick={() => {
                    if (isActive && controllerMode === 'split') {
                      setIsMinimized(true);
                    } else {
                      onSelectTool(tabItem.id);
                      setIsMinimized(false);
                    }
                  }}
                >
                  <Icon size={12} />
                  <span className="tab-label-full">{tabItem.label}</span>
                  {tabItem.dirty && <span className="toolbox-tab-dirty-dot" aria-label="Modified" />}
                </button>
              </Tooltip>
            );
          })}
        </div>

        {/* Right: Mode Switch (Split vs Compact) + Minimize Toggle */}
        <div className="toolbox-header-actions toolbox-interactive-element">
          <Tooltip
            title={controllerMode === 'split' ? 'Split Mode' : 'Compact Mode'}
            description="Switch between fixed self-contained Compact strip mode and resizable Split mode"
          >
            <button
              type="button"
              className={`toolbox-mode-switch-btn ${controllerMode === 'compact' ? 'active' : ''}`}
              onClick={() => {
                setControllerMode((prev) => (prev === 'split' ? 'compact' : 'split'));
                setIsMinimized(false);
              }}
              aria-label={controllerMode === 'split' ? 'Switch to Compact mode' : 'Switch to Split mode'}
            >
              {controllerMode === 'split' ? <Rows3 size={12} /> : <Columns3 size={12} />}
              <span className="mode-btn-label">{controllerMode === 'split' ? 'SPLIT' : 'COMPACT'}</span>
            </button>
          </Tooltip>

          <Tooltip
            title={isMinimized ? 'Expand' : 'Collapse'}
            description="Toggle Controller deck visibility"
          >
            <button
              type="button"
              className="toolbox-minimize-btn"
              aria-label={isMinimized ? 'Expand Controller' : 'Collapse Controller'}
              onClick={() => setIsMinimized(!isMinimized)}
            >
              {isMinimized ? <Maximize2 size={12} /> : <Minimize2 size={12} />}
            </button>
          </Tooltip>
        </div>
      </div>

      {/* TIER 1.5: AI Studio Operations Sub-Menu (Appears ONLY when AI Studio tab is active) */}
      {activeTool === 'studio' && !isMinimized && (
        <div className="toolbox-ai-subnav toolbox-interactive-element">
          <div className="toolbox-tabs-bar toolbox-subnav-tabs" role="tablist" aria-label="AI Studio Operations">
            {aiTasks
              .filter((action) => action.id in ACTION_ICONS)
              .map((action) => {
                const ActionIcon = ACTION_ICONS[action.id as keyof typeof ACTION_ICONS];
                const isCurrent = task === action.id;
                const shortName = taskLabel(action.id);
                const filterDesc = isCurrent ? getActiveFilterDescription(action.id) : '';
                const paramSummary = isCurrent
                  ? getActiveSubnavParamSummary(action.id)
                  : { tag: '', value: '', title: '' };

                return (
                  <div
                    key={action.id}
                    className={`toolbox-subnav-item-group ${isCurrent ? 'active' : ''}`}
                  >
                    <Tooltip
                      title={action.label}
                      description={action.description}
                      className="toolbox-subnav-btn-tooltip"
                    >
                      <button
                        type="button"
                        role="tab"
                        aria-selected={isCurrent}
                        className={`toolbox-tab-btn toolbox-subnav-btn ${isCurrent ? 'active tab-studio' : ''}`}
                        onClick={() => {
                          if (isCurrent) {
                            setIsParamModalOpen(true);
                          } else {
                            onSelectTask(action.id as Task);
                          }
                        }}
                      >
                        <ActionIcon size={13} className="toolbox-subnav-icon" />
                        <span className="tab-label-full toolbox-subnav-label">{shortName.toUpperCase()}</span>
                      </button>
                    </Tooltip>

                    {/* Standardized Expandable Modal Trigger Inside Active Sub-Menu Item (Neighbor-Aware, Full Fill) */}
                    {isCurrent && (
                      <Tooltip
                        title={paramSummary.title}
                        description={`${filterDesc} — Click to open ${shortName} parameters modal (Preselects + Granular Slider)`}
                        className="toolbox-subnav-param-tooltip"
                      >
                        <button
                          type="button"
                          className="toolbox-subnav-param-trigger"
                          aria-label={`${paramSummary.title}: ${paramSummary.value}`}
                          onClick={() => setIsParamModalOpen(true)}
                        >
                          <span className="toolbox-subnav-param-main">
                            <span className="toolbox-subnav-param-tag">{paramSummary.tag}</span>
                            <span className="toolbox-subnav-param-val">{paramSummary.value}</span>
                            {filterDesc && (
                              <span className="toolbox-subnav-filter-desc">{filterDesc}</span>
                            )}
                          </span>
                          <span className="toolbox-subnav-param-caret" aria-hidden="true">
                            <Sliders size={11} />
                          </span>
                        </button>
                      </Tooltip>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* TIER 2: Expanded Hardware Tool Deck Body */}
      {activeTool && !isMinimized && (
        <div className="toolbox-expanded-body toolbox-interactive-element">
          {/* 1. AI STUDIO — Zero-Duplication Command Deck (Parameters Live exclusively in Sub-Menu + Modal) */}
          {activeTool === 'studio' && (
            <div className="toolbox-studio-strip">
              {optionsError && <p role="alert" className="toolbox-error-alert">{optionsError}</p>}

              <div className="studio-deck-grid studio-deck-clean">
                {/* Row 1: Full-Width Responsive Prompt Box (or Isolate Banner) + Edit Lyrics on Same Row */}
                <div className="studio-row-top studio-row-main">
                  <div className="studio-row-prompt">
                    {task !== 'extract' ? (
                      <div className="toolbox-prompt-box-wrapper">
                        <input
                          type="text"
                          name="studio-prompt"
                          aria-label="AI Studio Prompt"
                          className="toolbox-prompt-input"
                          placeholder={promptPlaceholder}
                          value={prompt}
                          onClick={() => setIsPromptModalOpen(true)}
                          onChange={(e) => onPromptChange(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !processing) {
                              onExecute();
                            }
                          }}
                        />
                        <Tooltip title="Expand Prompt Editor" description="Open full-size modal prompt editor">
                          <button
                            type="button"
                            className="daw-ui-btn toolbox-prompt-expand-btn"
                            onClick={() => setIsPromptModalOpen(true)}
                            aria-label="Expand prompt editor"
                          >
                            <Maximize2 size={12} />
                            <span className="prompt-expand-label">EXPAND</span>
                          </button>
                        </Tooltip>
                      </div>
                    ) : (
                      <div
                        className="studio-extract-banner"
                        role="button"
                        tabIndex={0}
                        onClick={() => setIsParamModalOpen(true)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setIsParamModalOpen(true);
                          }
                        }}
                      >
                        <span className="studio-extract-hint">
                          Isolate <strong>{activeStemLabel}</strong> stem into its own dedicated track lane
                        </span>
                      </div>
                    )}
                  </div>

                  {task !== 'extract' && (
                    <Tooltip
                      title="Edit Lyrics"
                      description="Open the Lyrics Canvas modal to write, edit, or sync lyrics for this AI operation"
                      className="studio-edit-lyrics-tooltip"
                    >
                      <button
                        type="button"
                        aria-label="Edit Lyrics"
                        className={`daw-ui-btn toolbox-edit-lyrics-btn ${(task === 'lego' && (instrument === 'vocals' || instrument === 'backing_vocals')) ||
                          lyrics.trim().length > 0
                          ? 'active'
                          : ''
                          }`}
                        onClick={() => setIsLyricsModalOpen(true)}
                      >
                        <FilePenLine size={13} />
                        <span className="edit-lyrics-btn-label">EDIT LYRICS</span>
                      </button>
                    </Tooltip>
                  )}
                </div>

                {/* Row 2: Larger Full-Width Confirm AI Operation CTA Button */}
                <div className="studio-row-cta">
                  <Tooltip
                    title={taskLabel(task)}
                    description="Execute AI audio operation (Enter)"
                    className="studio-cta-tooltip"
                  >
                    <button
                      type="button"
                      className="btn-base btn-variant-primary btn-size-sm toolbox-execute-btn"
                      disabled={processing || !options}
                      onClick={onExecute}
                    >
                      <ArrowUp size={13} />
                      <span>{processing ? (progress !== undefined ? `${progress}%` : 'WAIT') : taskLabel(task)}</span>
                    </button>
                  </Tooltip>
                </div>
              </div>

              {processing && (
                <div className="toolbox-progress-box">
                  <div className="toolbox-progress-track">
                    <div
                      className="toolbox-progress-bar"
                      style={{ '--progress-pct': `${progress ?? 15}%` } as React.CSSProperties}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 2. MIXER */}
          {activeTool === 'mixer' && <Mixer />}

          {/* 3. KEYS SYNTH (Piano Roll) */}
          {activeTool === 'keys' && <Keys track={selectedTrack} />}

          {/* 4. DRUM SEQ (Step Sequencer) */}
          {activeTool === 'drums' && <Drums track={selectedTrack} />}

          {/* 5. LIVE CODE (Strudel) */}
          {activeTool === 'strudel' && <Strudel track={selectedTrack} />}

          {/* 6. FX RACK (DSP Rack) */}
          {activeTool === 'dsp' && <Rack track={selectedTrack} />}

          {/* 7. SAMPLER */}
          {activeTool === 'sample' && <Sampler onImportComplete={() => onSelectTool('studio')} />}

          {/* 8. HISTORY (Takes & Commits — Progressive Revealing: Folded Categories + Vertical Extension + Selected Horizontal Controllers) */}
          {activeTool === 'history' && (() => {
            const getTakeCat = (t: (typeof takes)[number]) => taskLabel(t.task).toUpperCase();
            const takeCategories = Array.from(new Set(takes.map(getTakeCat)));
            const resolvedTakeCat =
              activeTakeCategory && takeCategories.includes(activeTakeCategory)
                ? activeTakeCategory
                : takeCategories[0] || null;
            const visibleTakes = resolvedTakeCat
              ? takes.filter((t) => getTakeCat(t) === resolvedTakeCat)
              : takes;

            const getCommitCat = (c: (typeof commits)[number]) => {
              if (c.timeline_snapshot?.action) {
                return taskLabel(String(c.timeline_snapshot.action)).toUpperCase();
              }
              if (Array.isArray(c.timeline_snapshot?.tracks)) {
                return 'SNAPSHOT';
              }
              const msg = (c.message || '').toLowerCase();
              if (msg.includes('repaint') || msg.includes('rework')) return 'REWORK';
              if (msg.includes('extend')) return 'EXTEND';
              if (msg.includes('extract') || msg.includes('stem')) return 'ISOLATE';
              if (msg.includes('lego') || msg.includes('layer')) return 'LAYER';
              if (msg.includes('cover') || msg.includes('restyle')) return 'RESTYLE';
              return 'SESSION';
            };
            const commitCategories = Array.from(new Set(commits.map(getCommitCat)));
            const resolvedCommitCat =
              activeCommitCategory && commitCategories.includes(activeCommitCategory)
                ? activeCommitCategory
                : commitCategories[0] || null;
            const visibleCommits = resolvedCommitCat
              ? commits.filter((c) => getCommitCat(c) === resolvedCommitCat)
              : commits;
            const resolvedSelectedCommitId =
              selectedCommitId && visibleCommits.some((c) => c.id === selectedCommitId)
                ? selectedCommitId
                : visibleCommits[0]?.id || null;

            return (
              <div className="toolbox-history-panel">
                <div className="toolbox-history-toolbar">
                  <div className="toolbox-history-tabs">
                    <button
                      type="button"
                      className={`toolbox-mode-btn ${historyTab === 'takes' ? 'active' : ''}`}
                      onClick={() => setHistoryTab('takes')}
                    >
                      TAKES ({takes.length})
                    </button>
                    <button
                      type="button"
                      className={`toolbox-mode-btn ${historyTab === 'commits' ? 'active' : ''}`}
                      onClick={() => setHistoryTab('commits')}
                    >
                      COMMITS ({commits.length})
                    </button>
                  </div>

                  {/* Folded Category Switcher Pills */}
                  {historyTab === 'takes' && takeCategories.length > 1 && (
                    <div className="toolbox-history-categories" role="tablist" aria-label="Take categories">
                      {takeCategories.map((cat) => {
                        const count = takes.filter((t) => getTakeCat(t) === cat).length;
                        const isCatActive = resolvedTakeCat === cat;
                        return (
                          <button
                            key={cat}
                            type="button"
                            role="tab"
                            aria-selected={isCatActive}
                            className={`toolbox-history-cat-pill ${isCatActive ? 'active' : 'folded'}`}
                            onClick={() => setActiveTakeCategory(cat)}
                            title={`${cat} (${count})`}
                          >
                            <span className="toolbox-history-cat-name">{cat}</span>
                            <span className="toolbox-history-cat-count">{count}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {historyTab === 'commits' && commitCategories.length > 1 && (
                    <div className="toolbox-history-categories" role="tablist" aria-label="Commit categories">
                      {commitCategories.map((cat) => {
                        const count = commits.filter((c) => getCommitCat(c) === cat).length;
                        const isCatActive = resolvedCommitCat === cat;
                        return (
                          <button
                            key={cat}
                            type="button"
                            role="tab"
                            aria-selected={isCatActive}
                            className={`toolbox-history-cat-pill ${isCatActive ? 'active' : 'folded'}`}
                            onClick={() => setActiveCommitCategory(cat)}
                            title={`${cat} (${count})`}
                          >
                            <span className="toolbox-history-cat-name">{cat}</span>
                            <span className="toolbox-history-cat-count">{count}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <button
                    type="button"
                    className="btn-base btn-variant-primary btn-size-xs"
                    onClick={onOpenCommitModal}
                  >
                    COMMIT
                  </button>
                </div>

                {historyTab === 'takes' ? (
                  <div className="toolbox-takes-section">
                    {takes.length === 0 ? (
                      <p className="toolbox-history-empty">No takes in session yet.</p>
                    ) : (
                      <div className="toolbox-takes-list">
                        {visibleTakes.map((take) => {
                          const isSelected = selectedTrackId === take.id || (!takes.some((t) => t.id === selectedTrackId) && visibleTakes[0]?.id === take.id);
                          const active = mounted(take, tracks, takes);
                          return (
                            <div
                              key={take.id}
                              className={`toolbox-take-item ${active ? 'active' : ''} ${isSelected ? 'selected' : 'folded'}`}
                              onClick={() => {
                                if (onSelectTrack) onSelectTrack(take.id);
                                useDawStore.getState().setSelectedTrackId(take.id);
                              }}
                            >
                              <div className="toolbox-take-meta">
                                <span className="toolbox-take-num">#{take.take_number}</span>
                                <span className="toolbox-take-task">{taskLabel(take.task)}</span>
                                {take.repainting_start != null && take.repainting_end != null && (
                                  <span className="toolbox-take-range">
                                    [{formatTime(take.repainting_start)}➔{formatTime(take.repainting_end)}]
                                  </span>
                                )}
                              </div>
                              {isSelected && (
                                <div className="toolbox-take-actions">
                                  <button
                                    type="button"
                                    className="btn-base btn-variant-ghost btn-size-xs"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (isSelected && isPlaying) {
                                        dawEngine.stopAuditionTake();
                                        setPlaying(false);
                                      } else {
                                        if (onSelectTrack) onSelectTrack(take.id);
                                      }
                                    }}
                                  >
                                    {isSelected && isPlaying ? 'STOP' : 'PLAY'}
                                  </button>
                                  <button
                                    type="button"
                                    title={active ? 'Unmount take' : 'Mount take as base'}
                                    aria-pressed={active}
                                    className={`btn-base ${active ? 'btn-variant-primary' : 'btn-variant-ghost'} btn-size-xs`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggleTake(take.id);
                                    }}
                                  >
                                    {active ? 'BASE' : 'MOUNT'}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-base btn-variant-ghost btn-size-xs toolbox-take-delete-btn"
                                    title="Delete take"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      deleteTake(take.id);
                                    }}
                                  >
                                    <Trash2 size={11} />
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="toolbox-commits-section">
                    {commits.length === 0 ? (
                      <p className="toolbox-history-empty">No commits yet.</p>
                    ) : (
                      <div className="toolbox-commits-list">
                        {visibleCommits.map((c, idx) => {
                          const isSelected = resolvedSelectedCommitId === c.id;
                          const snapTakeId = c.timeline_snapshot?.activeTakeId
                            ? String(c.timeline_snapshot.activeTakeId)
                            : null;
                          return (
                            <div
                              key={c.id}
                              className={`toolbox-commit-item ${isSelected ? 'selected' : 'folded'}`}
                              onClick={() => setSelectedCommitId(c.id)}
                            >
                              <div className="toolbox-commit-meta">
                                <span className="toolbox-commit-badge">C{commits.length - idx}</span>
                                <span className="toolbox-commit-cat-tag">{getCommitCat(c)}</span>
                                <span className="toolbox-commit-msg">{c.message}</span>
                                <span className="toolbox-commit-time">
                                  {new Date(c.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                              {isSelected && (
                                <div className="toolbox-commit-actions">
                                  {snapTakeId && (
                                    <button
                                      type="button"
                                      className="btn-base btn-variant-ghost btn-size-xs"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (onSelectTrack) onSelectTrack(snapTakeId);
                                        useDawStore.getState().setSelectedTrackId(snapTakeId);
                                      }}
                                    >
                                      AUDITION
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    className="btn-base btn-variant-primary btn-size-xs"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (Array.isArray(c.timeline_snapshot?.tracks)) {
                                        useDawStore.getState().restoreSession([c]);
                                        toast.success(`Restored commit: ${c.message}`);
                                      } else if (snapTakeId) {
                                        void toggleTake(snapTakeId);
                                      } else {
                                        toast.success(`Selected commit: ${c.message}`);
                                      }
                                    }}
                                  >
                                    RESTORE
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* Standardized AI Studio Parameter Modal (Presets + Granular Dragging Bar) */}
      <Modal
        isOpen={isParamModalOpen}
        onClose={() => setIsParamModalOpen(false)}
        title={`AI STUDIO PARAMETERS // ${taskLabel(task).toUpperCase()}`}
        size="md"
      >
        <div className="toolbox-param-modal">
          <div className="toolbox-param-modal-header">
            <div className="toolbox-param-modal-badges">
              <span className="toolbox-prompt-modal-badge">{contextChipText}</span>
              <span className="toolbox-param-modal-current">
                {getActiveSubnavParamSummary(task).tag}: {getActiveSubnavParamSummary(task).value}
              </span>
            </div>
            <p className="toolbox-param-modal-desc">{getActiveFilterDescription(task)}</p>
          </div>

          {/* 1. REWORK (repaint): Unified Intensity Presets + Granular Strength Slider + Seam Crossfade */}
          {task === 'repaint' && (
            <>
              <div className="toolbox-param-section">
                <div className="toolbox-param-section-head">
                  <span className="daw-field-label">PRESELECT INTENSITY PROFILES</span>
                  <span className="toolbox-param-readout-tag">{closestReworkPreset.label.toUpperCase()}</span>
                </div>
                <div className="toolbox-param-presets-grid cols-5">
                  {reworkPresets.map((preset) => {
                    const isSelected = closestReworkPreset.id === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        className={`toolbox-param-preset-btn ${isSelected ? 'active' : ''}`}
                        onClick={() => handleReworkIntensityChange(preset.strength)}
                      >
                        <span className="preset-btn-title">{preset.shortLabel}</span>
                        <span className="preset-btn-val">{Math.round(preset.strength * 100)}%</span>
                        <span className="preset-btn-sub">{preset.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="toolbox-param-section">
                <div className="toolbox-param-section-head">
                  <span className="daw-field-label">GRANULAR REWORK INTENSITY</span>
                  <span className="toolbox-param-readout-val">{effectiveRepaintPct}%</span>
                </div>
                <div className="toolbox-param-slider-row">
                  <button
                    type="button"
                    className="toolbox-param-step-btn"
                    onClick={() => handleReworkIntensityChange(effectiveRepaintVal - 0.05)}
                  >
                    -5%
                  </button>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={effectiveRepaintVal}
                    onChange={(e) => handleReworkIntensityChange(Number(e.target.value))}
                    className="daw-ContextSlider toolbox-param-range"
                  />
                  <button
                    type="button"
                    className="toolbox-param-step-btn"
                    onClick={() => handleReworkIntensityChange(effectiveRepaintVal + 0.05)}
                  >
                    +5%
                  </button>
                </div>
                <div className="toolbox-param-scale-labels">
                  <span>0% (Preserve Source Audio)</span>
                  <span>50% (Balanced Re-synthesis)</span>
                  <span>100% (Fresh Generation)</span>
                </div>
              </div>

              <div className="toolbox-param-section">
                <div className="toolbox-param-section-head">
                  <span className="daw-field-label">BOUNDARY SEAM CROSSFADE</span>
                  <span className="toolbox-param-readout-val">
                    {Number(parameters.repaintWavCrossfadeSec ?? 0).toFixed(2)}s
                  </span>
                </div>
                <div className="toolbox-param-slider-row">
                  <button
                    type="button"
                    className="toolbox-param-step-btn"
                    onClick={() =>
                      onParametersChange({
                        ...parameters,
                        repaintWavCrossfadeSec: Math.max(0, Number((Number(parameters.repaintWavCrossfadeSec ?? 0) - 0.05).toFixed(2))),
                      })
                    }
                  >
                    -0.05s
                  </button>
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.05"
                    value={Number(parameters.repaintWavCrossfadeSec ?? 0)}
                    onChange={(e) =>
                      onParametersChange({
                        ...parameters,
                        repaintWavCrossfadeSec: Number(e.target.value),
                      })
                    }
                    className="daw-ContextSlider toolbox-param-range"
                  />
                  <button
                    type="button"
                    className="toolbox-param-step-btn"
                    onClick={() =>
                      onParametersChange({
                        ...parameters,
                        repaintWavCrossfadeSec: Math.min(2, Number((Number(parameters.repaintWavCrossfadeSec ?? 0) + 0.05).toFixed(2))),
                      })
                    }
                  >
                    +0.05s
                  </button>
                </div>
              </div>
            </>
          )}

          {/* 2. LAYER (lego): Preselect Instrument Stems + Custom Stem + Boundary Seam */}
          {task === 'lego' && (
            <>
              <div className="toolbox-param-section">
                <div className="toolbox-param-section-head">
                  <span className="daw-field-label">PRESELECT INSTRUMENT LAYER</span>
                  <span className="toolbox-param-readout-tag">{activeInstrumentLabel.toUpperCase()}</span>
                </div>
                <div className="toolbox-param-presets-grid cols-4">
                  {instrumentList.map((inst) => {
                    const isSelected = instrument === inst.id;
                    return (
                      <button
                        key={inst.id}
                        type="button"
                        className={`toolbox-param-preset-btn compact ${isSelected ? 'active' : ''}`}
                        onClick={() => handleSelectLayerInstrument(inst.id)}
                      >
                        <span className="preset-btn-title">{inst.label}</span>
                        <span className="preset-btn-sub">{inst.id}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="toolbox-param-custom-row">
                  <span className="daw-field-label">CUSTOM INSTRUMENT TARGET</span>
                  <input
                    type="text"
                    className="toolbox-param-text-input"
                    value={instrument}
                    onChange={(e) => onInstrumentChange(e.target.value)}
                    placeholder="e.g., cello, sax, 808 sub, choir..."
                  />
                </div>
              </div>

              <div className="toolbox-param-section">
                <div className="toolbox-param-section-head">
                  <span className="daw-field-label">BOUNDARY SEAM CROSSFADE</span>
                  <span className="toolbox-param-readout-val">
                    {Number(parameters.repaintWavCrossfadeSec ?? 0).toFixed(2)}s
                  </span>
                </div>
                <div className="toolbox-param-slider-row">
                  <button
                    type="button"
                    className="toolbox-param-step-btn"
                    onClick={() =>
                      onParametersChange({
                        ...parameters,
                        repaintWavCrossfadeSec: Math.max(0, Number((Number(parameters.repaintWavCrossfadeSec ?? 0) - 0.05).toFixed(2))),
                      })
                    }
                  >
                    -0.05s
                  </button>
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.05"
                    value={Number(parameters.repaintWavCrossfadeSec ?? 0)}
                    onChange={(e) =>
                      onParametersChange({
                        ...parameters,
                        repaintWavCrossfadeSec: Number(e.target.value),
                      })
                    }
                    className="daw-ContextSlider toolbox-param-range"
                  />
                  <button
                    type="button"
                    className="toolbox-param-step-btn"
                    onClick={() =>
                      onParametersChange({
                        ...parameters,
                        repaintWavCrossfadeSec: Math.min(2, Number((Number(parameters.repaintWavCrossfadeSec ?? 0) + 0.05).toFixed(2))),
                      })
                    }
                  >
                    +0.05s
                  </button>
                </div>
              </div>
            </>
          )}

          {/* 3. EXTEND (extend): Preselect Extension Increments + Granular Target Duration Slider + Seam Crossfade */}
          {task === 'extend' && (
            <>
              <div className="toolbox-param-section">
                <div className="toolbox-param-section-head">
                  <span className="daw-field-label">PRESELECT EXTENSION LENGTH</span>
                  <span className="toolbox-param-readout-tag">+{addedExtendSec}S (TOTAL {Math.round(targetDuration)}S)</span>
                </div>
                <div className="toolbox-param-presets-grid cols-3">
                  {extendPresets.map((preset) => {
                    const isSelected = Math.abs(Math.round(targetDuration) - preset.value) <= 2;
                    return (
                      <button
                        key={preset.value}
                        type="button"
                        className={`toolbox-param-preset-btn ${isSelected ? 'active' : ''}`}
                        onClick={() => onTargetDurationChange(preset.value)}
                      >
                        <span className="preset-btn-title">{preset.shortLabel}</span>
                        <span className="preset-btn-val">{preset.value}s</span>
                        <span className="preset-btn-sub">{preset.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="toolbox-param-section">
                <div className="toolbox-param-section-head">
                  <span className="daw-field-label">GRANULAR TARGET DURATION</span>
                  <span className="toolbox-param-readout-val">
                    {Math.round(targetDuration)}s (+{addedExtendSec}s)
                  </span>
                </div>
                <div className="toolbox-param-slider-row">
                  <button
                    type="button"
                    className="toolbox-param-step-btn"
                    onClick={() => onTargetDurationChange(Math.max(minExtendDur, Math.round(targetDuration) - 5))}
                  >
                    -5s
                  </button>
                  <input
                    type="range"
                    min={minExtendDur}
                    max={maxExtendDur}
                    step="1"
                    value={Math.max(minExtendDur, Math.round(targetDuration))}
                    onChange={(e) => onTargetDurationChange(Number(e.target.value))}
                    className="daw-ContextSlider toolbox-param-range"
                  />
                  <button
                    type="button"
                    className="toolbox-param-step-btn"
                    onClick={() => onTargetDurationChange(Math.min(maxExtendDur, Math.round(targetDuration) + 5))}
                  >
                    +5s
                  </button>
                </div>
                <div className="toolbox-param-scale-labels">
                  <span>Min: {minExtendDur}s</span>
                  <span>Source: {Math.round(duration || 30)}s</span>
                  <span>Max: {maxExtendDur}s</span>
                </div>
              </div>

              <div className="toolbox-param-section">
                <div className="toolbox-param-section-head">
                  <span className="daw-field-label">CONTINUATION SEAM CROSSFADE</span>
                  <span className="toolbox-param-readout-val">
                    {Number(parameters.repaintWavCrossfadeSec ?? 0).toFixed(2)}s
                  </span>
                </div>
                <div className="toolbox-param-slider-row">
                  <button
                    type="button"
                    className="toolbox-param-step-btn"
                    onClick={() =>
                      onParametersChange({
                        ...parameters,
                        repaintWavCrossfadeSec: Math.max(0, Number((Number(parameters.repaintWavCrossfadeSec ?? 0) - 0.05).toFixed(2))),
                      })
                    }
                  >
                    -0.05s
                  </button>
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.05"
                    value={Number(parameters.repaintWavCrossfadeSec ?? 0)}
                    onChange={(e) =>
                      onParametersChange({
                        ...parameters,
                        repaintWavCrossfadeSec: Number(e.target.value),
                      })
                    }
                    className="daw-ContextSlider toolbox-param-range"
                  />
                  <button
                    type="button"
                    className="toolbox-param-step-btn"
                    onClick={() =>
                      onParametersChange({
                        ...parameters,
                        repaintWavCrossfadeSec: Math.min(2, Number((Number(parameters.repaintWavCrossfadeSec ?? 0) + 0.05).toFixed(2))),
                      })
                    }
                  >
                    +0.05s
                  </button>
                </div>
              </div>
            </>
          )}

          {/* 4. ACCOMPANY (complete): Preselect Arrangement Focus + 12-Class Multi-Select Track Classes */}
          {task === 'complete' && (
            <>
              <div className="toolbox-param-section">
                <div className="toolbox-param-section-head">
                  <span className="daw-field-label">PRESELECT ARRANGEMENT FOCUS</span>
                  <span className="toolbox-param-readout-tag">
                    {activeCompletePreset.label.toUpperCase()}
                  </span>
                </div>
                <div className="toolbox-param-presets-grid cols-3">
                  {completePresets.map((preset) => {
                    const isSelected = completePreset === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        className={`toolbox-param-preset-btn ${isSelected ? 'active' : ''}`}
                        onClick={() => {
                          setCompletePreset(preset.id);
                          onParametersChange({ ...parameters, trackClasses: preset.classes });
                        }}
                      >
                        <span className="preset-btn-title">{preset.label}</span>
                        <span className="preset-btn-sub">{preset.classes}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="toolbox-param-section">
                <div className="toolbox-param-section-head">
                  <span className="daw-field-label">ACTIVE TRACK CLASSES (12 CANONICAL XL TARGETS)</span>
                  <span className="toolbox-param-readout-val">
                    {String(parameters.trackClasses || activeCompletePreset.classes)}
                  </span>
                </div>
                <div className="toolbox-param-chip-list">
                  {trackClassesOptions.map((inst) => {
                    const currentClasses = String(parameters.trackClasses || activeCompletePreset.classes)
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean);
                    const isIncluded = currentClasses.includes(inst.id);
                    return (
                      <button
                        key={inst.id}
                        type="button"
                        className={`toolbox-param-chip ${isIncluded ? 'active' : ''}`}
                        onClick={() => {
                          const next = isIncluded
                            ? currentClasses.filter((c) => c !== inst.id)
                            : [...currentClasses, inst.id];
                          if (next.length > 0) {
                            onParametersChange({ ...parameters, trackClasses: next.join(', ') });
                          }
                        }}
                      >
                        {isIncluded ? '✓ ' : '+ '}
                        {inst.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {/* 5. RESTYLE (cover): Unified Preselect Blend Profiles + Granular Blend Slider + Cover Noise Strength */}
          {task === 'cover' && (
            <>
              <div className="toolbox-param-section">
                <div className="toolbox-param-section-head">
                  <span className="daw-field-label">PRESELECT RESTYLE BLEND PROFILES</span>
                  <span className="toolbox-param-readout-tag">{closestCoverPreset.label.toUpperCase()}</span>
                </div>
                <div className="toolbox-param-presets-grid cols-4">
                  {coverPresets.map((preset) => {
                    const isSelected = closestCoverPreset.value === preset.value;
                    return (
                      <button
                        key={preset.value}
                        type="button"
                        className={`toolbox-param-preset-btn ${isSelected ? 'active' : ''}`}
                        onClick={() => onCoverStrengthChange(preset.value)}
                      >
                        <span className="preset-btn-title">{preset.shortLabel}</span>
                        <span className="preset-btn-val">{Math.round(preset.value * 100)}%</span>
                        <span className="preset-btn-sub">{preset.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="toolbox-param-section">
                <div className="toolbox-param-section-head">
                  <span className="daw-field-label">GRANULAR STYLE TRANSFER BLEND</span>
                  <span className="toolbox-param-readout-val">{Math.round(coverStrength * 100)}%</span>
                </div>
                <div className="toolbox-param-slider-row">
                  <button
                    type="button"
                    className="toolbox-param-step-btn"
                    onClick={() => onCoverStrengthChange(Math.max(0.05, Number((coverStrength - 0.05).toFixed(2))))}
                  >
                    -5%
                  </button>
                  <input
                    type="range"
                    min="0.05"
                    max="1"
                    step="0.01"
                    value={coverStrength}
                    onChange={(e) => onCoverStrengthChange(Number(e.target.value))}
                    className="daw-ContextSlider toolbox-param-range"
                  />
                  <button
                    type="button"
                    className="toolbox-param-step-btn"
                    onClick={() => onCoverStrengthChange(Math.min(1, Number((coverStrength + 0.05).toFixed(2))))}
                  >
                    +5%
                  </button>
                </div>
                <div className="toolbox-param-scale-labels">
                  <span>5% (Keep Original Timbre)</span>
                  <span>60% (Balanced Restyle)</span>
                  <span>100% (Full Genre Reimagination)</span>
                </div>
              </div>

              <div className="toolbox-param-section">
                <div className="toolbox-param-section-head">
                  <span className="daw-field-label">TIMBRE REIMAGINATION FREEDOM (NOISE STRENGTH)</span>
                  <span className="toolbox-param-readout-val">
                    {Math.round(Number(parameters.coverNoiseStrength ?? 0.25) * 100)}%
                  </span>
                </div>
                <div className="toolbox-param-slider-row">
                  <button
                    type="button"
                    className="toolbox-param-step-btn"
                    onClick={() =>
                      onParametersChange({
                        ...parameters,
                        coverNoiseStrength: Math.max(0, Number((Number(parameters.coverNoiseStrength ?? 0.25) - 0.05).toFixed(2))),
                      })
                    }
                  >
                    -5%
                  </button>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={Number(parameters.coverNoiseStrength ?? 0.25)}
                    onChange={(e) =>
                      onParametersChange({
                        ...parameters,
                        coverNoiseStrength: Number(e.target.value),
                      })
                    }
                    className="daw-ContextSlider toolbox-param-range"
                  />
                  <button
                    type="button"
                    className="toolbox-param-step-btn"
                    onClick={() =>
                      onParametersChange({
                        ...parameters,
                        coverNoiseStrength: Math.min(1, Number((Number(parameters.coverNoiseStrength ?? 0.25) + 0.05).toFixed(2))),
                      })
                    }
                  >
                    +5%
                  </button>
                </div>
              </div>
            </>
          )}

          {/* 6. ISOLATE (extract): Preselect Stem Targets */}
          {task === 'extract' && (
            <div className="toolbox-param-section">
              <div className="toolbox-param-section-head">
                <span className="daw-field-label">PRESELECT ISOLATION TARGET</span>
                <span className="toolbox-param-readout-tag">{activeStemLabel.toUpperCase()}</span>
              </div>
              <div className="toolbox-param-presets-grid cols-3">
                {stemList.map((stem) => {
                  const isSelected = stemType === stem.id;
                  return (
                    <button
                      key={stem.id}
                      type="button"
                      className={`toolbox-param-preset-btn compact ${isSelected ? 'active' : ''}`}
                      onClick={() => onStemTypeChange(stem.id)}
                    >
                      <span className="preset-btn-title">{stem.label}</span>
                      <span className="preset-btn-sub">Isolate {stem.label.toLowerCase()} lane</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {qualityOptions.length > 0 && (
            <div className="toolbox-param-section">
              <div className="toolbox-param-section-head">
                <span className="daw-field-label">SYNTHESIS QUALITY</span>
                <span className="toolbox-param-readout-tag">
                  {(task === 'lego' || task === 'extract' || task === 'complete' ? 'base' : selectedQuality).toUpperCase()}
                </span>
              </div>
              <div className="toolbox-param-chip-list">
                {qualityOptions.map((q) => {
                  const effectiveQuality =
                    task === 'lego' || task === 'extract' || task === 'complete' ? 'base' : selectedQuality;
                  return (
                    <button
                      key={q.id}
                      type="button"
                      className={`toolbox-param-chip ${effectiveQuality === q.id ? 'active' : ''}`}
                      onClick={() => onQualityChange(q.id)}
                    >
                      {q.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="toolbox-param-modal-footer">
            <button
              type="button"
              className="btn-base btn-variant-ghost btn-size-sm"
              onClick={() => setIsParamModalOpen(false)}
            >
              DONE
            </button>
            <button
              type="button"
              className="btn-base btn-variant-primary btn-size-sm"
              disabled={processing || !options}
              onClick={() => {
                setIsParamModalOpen(false);
                onExecute();
              }}
            >
              <ArrowUp size={12} />
              <span>{taskLabel(task).toUpperCase()}</span>
            </button>
          </div>
        </div>
      </Modal>

      {/* Expandable Brand-Aligned Prompt-Box Modal (Item #6) */}
      <Modal
        isOpen={isPromptModalOpen}
        onClose={() => setIsPromptModalOpen(false)}
        title={`AI STUDIO PROMPT // ${taskLabel(task).toUpperCase()}`}
        size="md"
      >
        <div className="toolbox-prompt-editor-modal">
          <div className="toolbox-prompt-modal-meta">
            <div className="toolbox-prompt-modal-badges">
              <span className="toolbox-prompt-modal-badge">{contextChipText}</span>
              <button
                type="button"
                className="toolbox-prompt-modal-tag is-interactive"
                onClick={() => {
                  setIsPromptModalOpen(false);
                  setIsParamModalOpen(true);
                }}
                title="Click to configure task parameters"
              >
                <Sliders size={10} />
                <span>
                  {getActiveSubnavParamSummary(task).tag}: {getActiveSubnavParamSummary(task).value}
                </span>
              </button>
            </div>
            {prompt.trim().length > 0 && (
              <button
                type="button"
                className="toolbox-prompt-clear-btn"
                onClick={() => onPromptChange('')}
              >
                CLEAR
              </button>
            )}
          </div>

          <p className="toolbox-prompt-modal-desc">{getActiveFilterDescription(task)}</p>

          <textarea
            className="toolbox-prompt-modal-textarea"
            placeholder={promptPlaceholder}
            value={prompt}
            onChange={(e) => onPromptChange(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !processing) {
                e.preventDefault();
                setIsPromptModalOpen(false);
                onExecute();
              }
            }}
            autoFocus
            rows={5}
          />

          <div className="toolbox-prompt-modal-tags-header">
            <span className="daw-field-label">QUICK PRODUCTION DESCRIPTORS</span>
            <span className="toolbox-prompt-char-count">{prompt.length} chars</span>
          </div>
          <div className="toolbox-prompt-modal-tags">
            {promptQuickTags.map((tag) => (
              <button
                key={tag}
                type="button"
                className="toolbox-prompt-quick-tag"
                onClick={() => {
                  const next = prompt.trim() ? `${prompt.trim()}, ${tag}` : tag;
                  onPromptChange(next);
                }}
              >
                + {tag}
              </button>
            ))}
          </div>

          <div className="toolbox-prompt-modal-footer">
            {task !== 'extract' && (
              <button
                type="button"
                className="btn-base btn-variant-secondary btn-size-sm"
                onClick={() => {
                  setIsPromptModalOpen(false);
                  setIsLyricsModalOpen(true);
                }}
              >
                <FilePenLine size={12} />
                <span>EDIT LYRICS OVERLAY</span>
              </button>
            )}
            <div className="toolbox-prompt-modal-actions">
              <button
                type="button"
                className="btn-base btn-variant-ghost btn-size-sm"
                onClick={() => setIsPromptModalOpen(false)}
              >
                DONE
              </button>
              <button
                type="button"
                className="btn-base btn-variant-primary btn-size-sm"
                disabled={processing || !options}
                onClick={() => {
                  setIsPromptModalOpen(false);
                  onExecute();
                }}
              >
                <ArrowUp size={12} />
                <span>{taskLabel(task).toUpperCase()}</span>
              </button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Lyrics Canvas Overlay Modal (Item #10) */}
      <Modal
        isOpen={isLyricsModalOpen}
        onClose={() => setIsLyricsModalOpen(false)}
        title={`LYRICS CANVAS // ${taskLabel(task).toUpperCase()}`}
        size="lg"
      >
        <div className="toolbox-lyrics-overlay-modal">
          <Canvas
            mode="overlay"
            autoEdit={true}
            lyrics={lyrics}
            onLyricsChange={onLyricsChange || (() => { })}
            vocalLanguage={vocalLanguage}
            onVocalLanguageChange={onVocalLanguageChange || (() => { })}
            hasExistingLyrics={hasExistingLyrics}
            isTranscribingLyrics={isTranscribingLyrics}
            onExtractLyrics={onExtractLyrics || (() => { })}
            lyricsAlignment={lyricsAlignment}
            isAligningLyrics={isAligningLyrics}
            onAlignLyrics={onAlignLyrics || (() => { })}
            languages={languages}
            onClose={() => setIsLyricsModalOpen(false)}
          />
        </div>
      </Modal>
    </section>
  );
};

