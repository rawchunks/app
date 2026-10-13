import React, { useState, useRef, useEffect } from 'react';
import { useDawStore } from '../../lib/daw/store';
import { dawEngine } from '../../lib/daw/engine';
import { mounted } from '../../lib/daw/takes';
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
} from 'lucide-react';
import type { Options } from '../../hooks/use-options';
import { Parameters } from '../parameters';
import { Task } from '../../lib/schema';
import { DspRack } from './DspRack';
import { PianoRoll } from './PianoRoll';
import { StepSequencer } from './StepSequencer';
import { StrudelEditor } from './StrudelEditor';
import { SampleImporter } from './SampleImporter';
import { Mixer } from './mixer';
import { Tooltip } from './Tooltip';
import { Key } from './Key';

export type ActiveTool = 'studio' | 'mixer' | 'keys' | 'drums' | 'strudel' | 'dsp' | 'sample' | 'history' | null;

export interface ToolboxProps {
  options?: Options['editing'];
  optionsError?: string;
  parameters: Record<string, string | number>;
  onParametersChange: (values: Record<string, string | number>) => void;
  activeTool: ActiveTool;
  onSelectTool: (tool: ActiveTool) => void;
  task: Task;
  onSelectTask: (task: Task) => void;
  prompt: string;
  onPromptChange: (prompt: string) => void;
  lyrics: string;
  onLyricsChange: (lyrics: string) => void;
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

const ACTION_ICONS = { repaint: Sparkles, lego: Layers, complete: Wand2, extend: ArrowRightCircle, cover: Shuffle, extract: Split };

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
  lyrics,
  onLyricsChange,
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
  const { tracks, selection, duration, takes, commits, toggleTake, deleteTake, isPlaying, setPlaying } = useDawStore();
  const [isMinimized, setIsMinimized] = useState<boolean>(() => typeof window !== 'undefined' && window.innerWidth <= 768);
  useEffect(() => { if (reveal) setIsMinimized(false); }, [reveal]);
  useEffect(() => {
    if (window.innerWidth <= 768 && takes.some(take => take.id === selectedTrackId)) setIsMinimized(true);
  }, [selectedTrackId]);
  const [isDragging, setIsDragging] = useState(false);

  // Position state with safe default boundaries
  const [position, setPosition] = useState<{ x: number; y: number }>(() => {
    const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;
    const defaultX = typeof window !== 'undefined' ? Math.max(16, (window.innerWidth - (isMobile ? 360 : 640)) / 2) : 100;
    const defaultY = typeof window !== 'undefined' ? Math.max(70, window.innerHeight - (isMobile ? 140 : 500)) : 380;
    return { x: defaultX, y: defaultY };
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const fit = () => setPosition(position => ({
      x: Math.max(6, Math.min(position.x, window.innerWidth - container.offsetWidth - 6)),
      y: Math.max(48, Math.min(position.y, window.innerHeight - container.offsetHeight - 6)),
    }));
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    window.addEventListener('resize', fit);
    fit();
    return () => { observer.disconnect(); window.removeEventListener('resize', fit); };
  }, [isMinimized]);

  const dragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const pointerDownRef = useRef<{ active: boolean; startX: number; startY: number; pointerId: number }>({
    active: false,
    startX: 0,
    startY: 0,
    pointerId: -1,
  });
  const didDragRef = useRef(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Resolve Context Chip Label
  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 10);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms}`;
  };

  const selectedTake = takes.find((t) => t.id === selectedTrackId);
  const selectedTrack = tracks.find((t) => t.id === selectedTrackId) || tracks[0];
  const trackName = selectedTake
    ? `Take #${selectedTake.take_number} (${selectedTake.task.toUpperCase()})`
    : selectedTrackId === 'master'
    ? 'Main Mix'
    : selectedTrack?.name || 'Selected Track';

  let contextChipText = trackName;
  if (selection) {
    contextChipText = `${trackName}: ${formatTime(selection.start)}–${formatTime(selection.end)}`;
  }

  // Pointer Drag Handlers (Boundary-clamped with drag threshold)
  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const targetEl = e.target as HTMLElement;
    if (
      targetEl.tagName === 'INPUT' ||
      targetEl.tagName === 'SELECT' ||
      targetEl.tagName === 'BUTTON' ||
      targetEl.tagName === 'TEXTAREA' ||
      targetEl.closest('button') ||
      targetEl.closest('input') ||
      targetEl.closest('select') ||
      targetEl.closest('textarea') ||
      targetEl.closest('a') ||
      targetEl.closest('label') ||
      targetEl.closest('[role="button"]') ||
      targetEl.closest('.toolbox-context-clear') ||
      targetEl.closest('.toolbox-expanded-body')
    ) {
      return;
    }
    didDragRef.current = false;
    pointerDownRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      pointerId: e.pointerId,
    };
    dragOffsetRef.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!pointerDownRef.current.active) return;

    if (!didDragRef.current) {
      const dx = e.clientX - pointerDownRef.current.startX;
      const dy = e.clientY - pointerDownRef.current.startY;
      if (Math.hypot(dx, dy) <= 4) return;
      didDragRef.current = true;
      setIsDragging(true);
      try {
        (containerRef.current || (e.target as HTMLElement)).setPointerCapture(e.pointerId);
      } catch (_) {}
    }

    const nextX = e.clientX - dragOffsetRef.current.x;
    const nextY = e.clientY - dragOffsetRef.current.y;

    const boxW = containerRef.current?.offsetWidth || (isMinimized ? 160 : 340);
    const boxH = containerRef.current?.offsetHeight || (isMinimized ? 38 : 300);

    const clampedX = Math.max(6, Math.min(window.innerWidth - boxW - 6, nextX));
    const clampedY = Math.max(48, Math.min(window.innerHeight - boxH - 6, nextY));

    setPosition({ x: clampedX, y: clampedY });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!pointerDownRef.current.active) return;
    pointerDownRef.current.active = false;
    setIsDragging(false);
    try {
      (containerRef.current || (e.target as HTMLElement)).releasePointerCapture(e.pointerId);
    } catch (_) {}
  };

  // Resize Corner Pointer Handlers
  const handleResizeDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = containerRef.current?.offsetWidth || 560;
    const startH = containerRef.current?.offsetHeight || 380;

    const onMove = (moveEv: PointerEvent) => {
      if (!containerRef.current) return;
      const newW = Math.max(340, Math.min(window.innerWidth - 20, startW + (moveEv.clientX - startX)));
      const newH = Math.max(280, Math.min(window.innerHeight - 100, startH + (moveEv.clientY - startY)));
      containerRef.current.style.width = `${newW}px`;
      containerRef.current.style.height = `${newH}px`;
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const tabs = [
    { id: 'studio' as ActiveTool, label: 'STUDIO', desc: 'AI Generative Studio: rework, overdub, extend & isolate', icon: Wand2, className: 'tab-studio' },
    { id: 'mixer' as ActiveTool, label: 'MIXER', desc: 'Multitrack faders, panning, mute & solo console', icon: Sliders, className: 'tab-mixer' },
    { id: 'keys' as ActiveTool, label: 'KEYS', desc: 'Polyphonic piano roll MIDI composer & editor', icon: Key, className: 'tab-keys' },
    { id: 'drums' as ActiveTool, label: 'DRUMS', desc: '16-step polyphonic drum pattern sequencer', icon: Drum, className: 'tab-drums' },
    { id: 'strudel' as ActiveTool, label: 'LIVE CODE', desc: 'Strudel REPL for algorithmic pattern generation', icon: Terminal, className: 'tab-strudel' },
    { id: 'dsp' as ActiveTool, label: 'FX RACK', desc: 'Parametric EQ, compression, reverb & delay rack', icon: Activity, className: 'tab-dsp' },
    { id: 'sample' as ActiveTool, label: 'SAMPLER', desc: 'Import and slice audio samples to tracks', icon: Plus, className: 'tab-sample' },
    { id: 'history' as ActiveTool, label: 'HISTORY', desc: `Session takes (${takes.length}) and commit milestones (${commits.length})`, icon: History, className: 'tab-history' },
  ];

  return (
    <div
      ref={containerRef}
      className={`floating-toolbox ${isDragging ? 'dragging' : ''} ${isMinimized ? 'minimized' : ''}`}
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onClickCapture={(e) => {
        if (didDragRef.current) {
          e.stopPropagation();
          e.preventDefault();
          didDragRef.current = false;
        }
      }}
    >
      {isMinimized ? (
        <div
          className="toolbox-folded-pill"
          onClick={() => {
            if (!didDragRef.current) setIsMinimized(false);
          }}
          title="Click or drag toolbox dock"
        >
          <div className="toolbox-drag-grip" title="Drag toolbox anywhere">
            <GripHorizontal size={13} />
          </div>
          <span className="toolbox-folded-icon">🛠</span>
          <span className="toolbox-folded-label">TOOLS</span>
          <span className="toolbox-folded-badge">{activeTool ? activeTool.toUpperCase() : 'STUDIO'}</span>
          <button
            type="button"
            className="toolbox-folded-expand"
            onClick={(e) => {
              e.stopPropagation();
              setIsMinimized(false);
            }}
            title="Open Toolbox"
          >
            <Maximize2 size={13} />
          </button>
        </div>
      ) : (
        <>
          {/* Toolbox Drag Header & Quick Prompt */}
          <div className="toolbox-header-row">
            <div className="toolbox-drag-grip" title="Drag toolbox anywhere">
              <GripHorizontal size={14} />
            </div>

        {/* Dynamic Context Chip */}
        <Tooltip title="Active Board Focus" description="The currently selected track or time region target">
          <div className="toolbox-context-chip toolbox-interactive-element">
            <span className="toolbox-context-wave">〰</span>
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
                title="Reset focus to Main Mix"
              >
                <X size={11} />
              </button>
            )}
          </div>
        </Tooltip>

        {/* Natural Language Prompt Input Bar */}
        <div className="toolbox-prompt-bar toolbox-interactive-element">
          <input
            type="text"
            className="toolbox-prompt-input"
            placeholder="Describe the music..."
            value={prompt}
            onChange={(e) => onPromptChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !processing) {
                onExecute();
              }
            }}
          />
          <Tooltip title="Run Generation" description="Process the selected audio (Enter)">
            <button
              type="button"
              className="toolbox-prompt-submit"
              onClick={onExecute}
              disabled={processing || !options}
            >
              <ArrowUp size={13} />
            </button>
          </Tooltip>
        </div>

        {activeTool === 'studio' && task !== 'extract' && <div className="toolbox-interactive-element">
          <select className="toolbox-quality-select" value={selectedQuality} onChange={event => onQualityChange(event.target.value)} aria-label="Processing mode" disabled={!options}>
            {options?.modes.filter(mode => options.tasks.find(action => action.id === task)?.modes.includes(mode.id)).map(mode => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
          </select>
        </div>}

        {/* Minimize / Expand Toggle */}
        <div className="toolbox-interactive-element">
          <Tooltip title={isMinimized ? 'Expand Toolbox' : 'Collapse to Dock'} description="Toggle between full toolbox drawer and compact dock pill">
            <button
              type="button"
              className="toolbox-minimize-btn"
              aria-label={isMinimized ? 'Expand Toolbox' : 'Collapse Toolbox'}
              onClick={() => setIsMinimized(!isMinimized)}
            >
              {isMinimized ? <Maximize2 size={13} /> : <Minimize2 size={13} />}
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Brand Tabs Bar */}
      <div className="toolbox-tabs-bar toolbox-interactive-element">
        {tabs.map((tabItem) => {
          const Icon = tabItem.icon;
          const isActive = activeTool === tabItem.id && !isMinimized;

          return (
            <Tooltip title={tabItem.label} description={tabItem.desc} key={tabItem.id}>
              <button
                type="button"
                className={`toolbox-tab-btn tab-${tabItem.id} ${isActive ? `active ${tabItem.className}` : ''}`}
                onClick={() => {
                  if (isActive) {
                    onSelectTool(null);
                  } else {
                    onSelectTool(tabItem.id);
                    setIsMinimized(false);
                  }
                }}
              >
                <Icon size={13} />
                <span>{tabItem.label}</span>
              </button>
            </Tooltip>
          );
        })}
      </div>

      {/* Expanded Tool Body */}
      {activeTool && !isMinimized && (
        <div className="toolbox-expanded-body toolbox-interactive-element">
          {/* 1. Studio */}
          {activeTool === 'studio' && (
            <div className="toolbox-studio-content">
              {/* Macro Actions Bar */}
              <div className="toolbox-macro-actions">
                {options?.tasks.filter(action => action.id in ACTION_ICONS).map((action) => {
                  const ActionIcon = ACTION_ICONS[action.id as keyof typeof ACTION_ICONS];
                  const isCurrent = task === action.id;

                  return (
                    <Tooltip title={action.label} description={action.description} key={action.id}>
                      <button
                        type="button"
                        className={`toolbox-action-pill ${isCurrent ? 'active' : ''}`}
                        onClick={() => onSelectTask(action.id as Task)}
                      >
                        <ActionIcon size={13} />
                        <span>{action.label}</span>
                      </button>
                    </Tooltip>
                  );
                })}
              </div>

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
                    <div className="toolbox-param-row">
                      <label>LYRICS:</label>
                      <input
                        type="text"
                        className="toolbox-text-input"
                        placeholder="Optional vocal lyrics or style prompt..."
                        value={lyrics}
                        onChange={(e) => onLyricsChange(e.target.value)}
                      />
                    </div>
                  </div>
                )}

                {task === 'lego' && (
                  <div className="toolbox-param-box">
                    <div className="toolbox-param-title">ADD AN INSTRUMENT</div>
                    <label className="toolbox-param-row">INSTRUMENT:
                      <input type="text" className="toolbox-text-input" value={instrument} onChange={event => onInstrumentChange(event.target.value)} placeholder="Instrument to add" />
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

                {/* Sound Description Prompt */}
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
            </div>
          )}

          {/* 2. MIXER */}
          {activeTool === 'mixer' && <Mixer />}

          {/* 3. KEYS (Piano Roll) */}
          {activeTool === 'keys' && <PianoRoll track={selectedTrack} />}

          {/* 4. DRUMS (Step Sequencer) */}
          {activeTool === 'drums' && <StepSequencer track={selectedTrack} />}

          {/* 5. LIVE CODE (Strudel) */}
          {activeTool === 'strudel' && <StrudelEditor track={selectedTrack} />}

          {/* 6. FX RACK (DSP) */}
          {activeTool === 'dsp' && <DspRack track={selectedTrack} />}

          {/* 7. SAMPLER */}
          {activeTool === 'sample' && <SampleImporter onImportComplete={() => onSelectTool('studio')} />}

          {/* 8. HISTORY (Takes & Commits) */}
          {activeTool === 'history' && (
            <div className="toolbox-history-panel">
              <div className="toolbox-history-header">
                <span className="toolbox-history-title">SESSION TAKES &amp; COMMITS</span>
                <button
                  type="button"
                  className="btn-base btn-variant-primary btn-size-xs"
                  onClick={onOpenCommitModal}
                >
                  COMMIT SNAPSHOT
                </button>
              </div>

              <div className="toolbox-takes-section">
                <span className="toolbox-takes-subtitle">ACTIVE TAKES ({takes.length})</span>
                {takes.length === 0 ? (
                  <p className="toolbox-history-empty">No extractions or takes in session yet.</p>
                ) : (
                  <div className="toolbox-takes-list">
                    {takes.map((take) => {
                      const isSelected = selectedTrackId === take.id;
                      const active = mounted(take, tracks, takes);
                      return (
                        <div
                          key={take.id}
                          className={`toolbox-take-item ${active ? 'active' : ''} ${isSelected ? 'selected' : ''}`}
                          onClick={() => {
                            if (onSelectTrack) onSelectTrack(take.id);
                            useDawStore.getState().setSelectedTrackId(take.id);
                          }}
                          style={{ cursor: 'pointer' }}
                        >
                          <div className="toolbox-take-meta">
                            <span className="toolbox-take-num">TK#{take.take_number}</span>
                            <span className="toolbox-take-task">{take.task.toUpperCase()}</span>
                            {take.repainting_start != null && take.repainting_end != null && (
                              <span className="toolbox-take-range">
                                [{formatTime(take.repainting_start)}➔{formatTime(take.repainting_end)}]
                              </span>
                            )}
                          </div>
                          <div style={{ display: 'flex', gap: '4px' }}>
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
                              {isSelected && isPlaying ? 'STOP' : 'AUDITION'}
                            </button>
                            <button
                              type="button"
                              title={active ? 'Unmount take' : 'Set as Base'}
                              aria-pressed={active}
                              className={`btn-base ${active ? 'btn-variant-primary' : 'btn-variant-ghost'} btn-size-xs`}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleTake(take.id);
                              }}
                            >
                              {active ? 'BASE' : 'SET AS BASE'}
                            </button>
                            <button
                              type="button"
                              className="btn-base btn-variant-ghost btn-size-xs"
                              style={{ color: '#ef4444', padding: '0 5px' }}
                              title="Delete take"
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteTake(take.id);
                              }}
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="toolbox-commits-section">
                <span className="toolbox-takes-subtitle">COMMITS ({commits.length})</span>
                {commits.length === 0 ? (
                  <p className="toolbox-history-empty">No milestones committed yet.</p>
                ) : (
                  <div className="toolbox-commits-list">
                    {commits.map((c) => (
                      <div key={c.id} className="toolbox-commit-item">
                        <span className="toolbox-commit-msg">{c.message}</span>
                        <span className="toolbox-commit-time">
                          {new Date(c.created_at).toLocaleTimeString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Resize Grip (Bottom-Right Corner) */}
      <div
        className="toolbox-resize-handle"
        onPointerDown={handleResizeDown}
        title="Drag to resize toolbox"
      />
    </>
  )}
</div>
  );
};
