import React, { useState, useRef, useEffect } from 'react';
import { useDawStore, type LyricsAlignment } from '../../lib/daw/store';
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
  X,
  Minimize2,
  Maximize2,
  GripHorizontal,
  Sparkles,
  Layers,
  ArrowRightCircle,
  Shuffle,
  Split,
  Trash2,
  Play,
  Pause,
  Square,
  RotateCcw,
  Repeat,
  Rows3,
  Columns3,
} from 'lucide-react';
import type { Options } from '../../hooks/use-options';
import { Task } from '../../lib/schema';
import { Parameters } from '../parameters';
import { DspRack } from './DspRack';
import { PianoRoll } from './PianoRoll';
import { StepSequencer } from './StepSequencer';
import { StrudelEditor } from './StrudelEditor';
import { SampleImporter } from './SampleImporter';
import { Mixer } from './mixer';
import { Tooltip } from './Tooltip';
import { Key } from './Key';
import { toast } from 'sonner';

export type ActiveTool = 'studio' | 'mixer' | 'keys' | 'drums' | 'strudel' | 'dsp' | 'sample' | 'history' | null;

export interface ToolboxProps {
  options?: Options['editing'];
  languages?: Options['generation']['languages'];
  optionsError?: string;
  parameters: Record<string, string | number>;
  onParametersChange: (values: Record<string, string | number>) => void;
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

const DEFAULT_AI_TASKS = [
  { id: 'repaint', label: 'Rework Section', description: 'Regenerate selected section with AI' },
  { id: 'lego', label: 'Add Layer', description: 'Add instrumental or vocal stem layer' },
  { id: 'extend', label: 'Extend Track', description: 'Extend track duration seamlessly' },
  { id: 'complete', label: 'Accompany', description: 'Generate full backing accompaniment' },
  { id: 'cover', label: 'Restyle / Cover', description: 'Transform musical style and timbre' },
  { id: 'extract', label: 'Extract Stem', description: 'Isolate stem into separate lane' },
];

export const Toolbox: React.FC<ToolboxProps> = ({
  options,
  optionsError,
  parameters,
  onParametersChange,
  activeTool,
  onSelectTool,
  task,
  onSelectTask,
  prompt,
  onPromptChange,
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
  const {
    tracks,
    selection,
    duration,
    loop,
    setLoop,
    setPlayhead,
    takes,
    commits,
    toggleTake,
    deleteTake,
    isPlaying,
    setPlaying,
  } = useDawStore();

  // Default to unified self-contained 'compact' mode across all tabs (Item #5)
  const [controllerMode, setControllerMode] = useState<'split' | 'compact'>('compact');
  const [isMinimized, setIsMinimized] = useState<boolean>(false);
  const [splitHeight, setSplitHeight] = useState<number | null>(null);
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

  const tabs = [
    { id: 'studio' as ActiveTool, label: 'AI STUDIO', desc: 'AI Generative Studio: rework, layer, extend & isolate', icon: Wand2, className: 'tab-studio' },
    { id: 'mixer' as ActiveTool, label: 'MIXER', desc: 'Multitrack faders, panning, mute & solo console', icon: Sliders, className: 'tab-mixer' },
    { id: 'keys' as ActiveTool, label: 'KEYS SYNTH', desc: 'Polyphonic piano roll MIDI composer & editor', icon: Key, className: 'tab-keys' },
    { id: 'drums' as ActiveTool, label: 'DRUM SEQ', desc: '16-step polyphonic drum pattern sequencer', icon: Drum, className: 'tab-drums' },
    { id: 'strudel' as ActiveTool, label: 'LIVE CODE', desc: 'Strudel REPL for algorithmic pattern generation', icon: Terminal, className: 'tab-strudel' },
    { id: 'dsp' as ActiveTool, label: 'FX RACK', desc: 'Parametric EQ, compression, reverb & delay rack', icon: Activity, className: 'tab-dsp' },
    { id: 'sample' as ActiveTool, label: 'SAMPLER', desc: 'Import and slice audio samples to tracks', icon: Plus, className: 'tab-sample' },
    { id: 'history' as ActiveTool, label: 'HISTORY', desc: `Session takes (${takes.length}) and commit milestones (${commits.length})`, icon: History, className: 'tab-history' },
  ];

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

      <select aria-label="Quality" value={selectedQuality} onChange={e => onQualityChange(e.target.value)}>{options?.modes.filter(mode => options.tasks.find(action => action.id === task)?.modes.includes(mode.id)).map(q => <option key={q.id} value={q.id}>{q.label}</option>)}</select>

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
              <Tooltip title={tabItem.label} description={tabItem.desc} key={tabItem.id}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`toolbox-tab-btn tab-${tabItem.id} ${isActive ? `active ${tabItem.className}` : ''}`}
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

      {activeTool === 'studio' && !isMinimized && (
        <div className="toolbox-ai-subnav toolbox-interactive-element">
          <div className="toolbox-tabs-bar toolbox-subnav-tabs" role="tablist" aria-label="AI Studio Operations">
            {(options?.tasks ?? DEFAULT_AI_TASKS).filter(action => action.id in ACTION_ICONS).map(action => {
              const ActionIcon = ACTION_ICONS[action.id as keyof typeof ACTION_ICONS];
              return <button type="button" role="tab" aria-selected={task === action.id} key={action.id}
                className={`toolbox-tab-btn toolbox-subnav-btn ${task === action.id ? 'active tab-studio' : ''}`}
                onClick={() => onSelectTask(action.id as Task)}><ActionIcon size={13} /><span>{taskLabel(action.id)}</span></button>;
            })}
          </div>
        </div>
      )}

      {/* TIER 2: Expanded Hardware Tool Deck Body */}
      {activeTool && !isMinimized && (
        <div className="toolbox-expanded-body toolbox-interactive-element">
          {activeTool === 'studio' && <div className="toolbox-studio-content">
                    {optionsError && <p role="alert">{optionsError}</p>}
                    {options && <Parameters parameters={Object.fromEntries(Object.entries(options.parameters).filter(([key, parameter]) => parameter.tasks?.includes(task) && !['trackName', 'coverStrength'].includes(key)))} values={parameters} onChange={onParametersChange} />}
                    {/* Action Parameter Sliders */}
                    <div className="toolbox-params-grid">
                      {task === 'repaint' && (
                        <div className="toolbox-param-box">
                          <div className="toolbox-param-title">REWORK INTENSITY & MODE</div>
                          <div className="toolbox-param-row">
                            <label>MODE:</label>
                            <div className="toolbox-radio-group">
                              {options?.repaintModes.map(({ id: m, label }) => (
                                <button
                                  key={m}
                                  type="button"
                                  className={`toolbox-mode-btn ${repaintMode === m ? 'active' : ''}`}
                                  onClick={() => onRepaintModeChange(m as 'conservative' | 'balanced' | 'aggressive')}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="toolbox-param-row">
                            <label>STRENGTH:</label>
                            <input
                              type="range"
                              min="0"
                              max="1.0"
                              step="0.05"
                              disabled={repaintMode !== 'balanced'}
                              value={repaintMode === 'conservative' ? 0 : repaintMode === 'aggressive' ? 1 : repaintStrength}
                              onChange={(e) => onRepaintStrengthChange(parseFloat(e.target.value))}
                            />
                            <span>{Math.round((repaintMode === 'conservative' ? 0 : repaintMode === 'aggressive' ? 1 : repaintStrength) * 100)}%</span>
                          </div>
                        </div>
                      )}

                      {task === 'lego' && (
                        <div className="toolbox-param-box">
                          <div className="toolbox-param-title">ADD AN INSTRUMENT</div>
                          <label className="toolbox-param-row">INSTRUMENT:
                            <select
                              className="toolbox-text-input"
                              value={instrument}
                              onChange={event => onInstrumentChange(event.target.value)}
                            >
                              {(options?.parameters.trackName?.options ?? [
                                { id: 'guitar', label: 'Guitar' },
                                { id: 'synth', label: 'Synth' },
                                { id: 'drums', label: 'Drums' },
                                { id: 'bass', label: 'Bass' },
                                { id: 'keyboard', label: 'Keyboard / Piano' },
                                { id: 'strings', label: 'Strings' },
                                { id: 'percussion', label: 'Percussion' },
                                { id: 'brass', label: 'Brass' },
                                { id: 'woodwinds', label: 'Woodwinds' },
                                { id: 'vocals', label: 'Lead Vocals' },
                                { id: 'backing_vocals', label: 'Backing Vocals' },
                                { id: 'fx', label: 'FX / Textures' },
                              ]).map(opt => (
                                <option key={opt.id} value={opt.id}>{opt.label}</option>
                              ))}
                            </select>
                          </label>
                          <p className="toolbox-param-hint">
                            Choose reference lanes with L. The new part follows their timing, mix and effects.
                          </p>
                        </div>
                      )}

                      {task === 'extend' && (
                        <div className="toolbox-param-box">
                          <div className="toolbox-param-title">EXTEND ARRANGEMENT</div>
                          <div className="toolbox-param-row">
                            <label>TARGET DURATION:</label>
                            <input
                              type="range"
                              min={Math.min(options?.duration.max ?? 300, Math.max(options?.duration.min ?? 5, Math.ceil(duration) + 1))}
                              max={options?.duration.max}
                              step={1}
                              value={targetDuration}
                              onChange={(e) => onTargetDurationChange(parseFloat(e.target.value))}
                            />
                            <span>{targetDuration}s</span>
                          </div>
                        </div>
                      )}

                      {task === 'cover' && (
                        <div className="toolbox-param-box">
                          <div className="toolbox-param-title">RESTYLE</div>
                          <div className="toolbox-param-row">
                            <label>SOURCE RESEMBLANCE:</label>
                            <input
                              type="range"
                              min={options?.parameters.coverStrength.min}
                              max={options?.parameters.coverStrength.max}
                              step="0.05"
                              value={coverStrength}
                              onChange={(e) => onCoverStrengthChange(parseFloat(e.target.value))}
                            />
                            <span>{Math.round(coverStrength * 100)}%</span>
                          </div>
                        </div>
                      )}

                      {task === 'extract' && (
                        <div className="toolbox-param-box">
                          <div className="toolbox-param-title">SEPARATE TRACKS</div>
                          <div className="toolbox-param-row">
                            <label>TARGET STEM:</label>
                            <div className="toolbox-radio-group">
                              {options?.stems.map(({ id: st, label }) => (
                                <button
                                  key={st}
                                  type="button"
                                  className={`toolbox-mode-btn ${stemType === st ? 'active' : ''}`}
                                  onClick={() => onStemTypeChange(st)}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Sound Description Prompt & Lyrics */}
                      <div className="toolbox-param-box">
                        <div className="toolbox-param-title">SOUND DESCRIPTION</div>
                        <textarea
                          className="toolbox-prompt-textarea"
                          rows={2}
                          placeholder={
                            task === 'repaint'
                              ? 'Describe the new section (e.g. analog synth bass, shimmering vocal hook)...'
                              : task === 'lego'
                                ? 'Describe the new part (e.g. groovy funk bassline, rhythm guitar)...'
                                : task === 'extend'
                                  ? 'Describe how the song should evolve and continue...'
                                  : task === 'cover'
                                    ? 'Describe the musical genre or style transformation...'
                                    : 'Describe the part you want to hear...'
                          }
                          value={prompt}
                          onChange={(e) => onPromptChange(e.target.value)}
                        />
                      </div>

                      {/* Progress bar during generation */}
                      {processing && (
                        <div className="toolbox-progress-box">
                          <div className="toolbox-progress-header">
                            <span>PROCESSING AUDIO...</span>
                            <span>{progress === undefined ? '' : `${progress}%`}</span>
                          </div>
                          {progress !== undefined && <div className="toolbox-progress-track">
                            <div className="toolbox-progress-bar" style={{ width: `${progress}%` }} />
                          </div>}
                        </div>
                      )}

                      {/* Prominent Action Execution Button */}
                      <button
                        type="button"
                        className="btn-base btn-variant-primary btn-size-md toolbox-execute-btn"
                        disabled={processing || !options}
                        onClick={onExecute}
                      >
                        {processing ? 'PROCESSING AUDIO...' : options?.tasks.find(action => action.id === task)?.label.toUpperCase()}
                      </button>
                    </div>
          </div>}

          {/* 2. MIXER */}
          {activeTool === 'mixer' && <Mixer />}

          {/* 3. KEYS SYNTH (Piano Roll) */}
          {activeTool === 'keys' && <PianoRoll track={selectedTrack} />}

          {/* 4. DRUM SEQ (Step Sequencer) */}
          {activeTool === 'drums' && <StepSequencer track={selectedTrack} />}

          {/* 5. LIVE CODE (Strudel) */}
          {activeTool === 'strudel' && <StrudelEditor track={selectedTrack} />}

          {/* 6. FX RACK (DSP Rack) */}
          {activeTool === 'dsp' && <DspRack track={selectedTrack} />}

          {/* 7. SAMPLER */}
          {activeTool === 'sample' && <SampleImporter onImportComplete={() => onSelectTool('studio')} />}

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

    </section>
  );
};

