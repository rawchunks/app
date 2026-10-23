import React, { useState, useMemo } from 'react';
import {
  useDawStore,
  type LyricsAlignment,
} from '../../lib/daw/store';
import { taskLabel } from '../../lib/daw/takes';
import {
  Wand2,
  Sliders,
  ArrowUp,
  Maximize2,
  Sparkles,
  Layers,
  ArrowRightCircle,
  Shuffle,
  Split,
  FilePenLine,
  CheckCircle2,
  Loader2,
  X,
} from 'lucide-react';
import type { Options } from '../../hooks/use-options';
import { Modal } from '../modal';
import { Task } from '../../lib/schema';
import { Canvas } from './Canvas';
import { Tooltip } from './Tooltip';

export interface StudioProps {
  options?: Options['editing'];
  languages?: Options['generation']['languages'];
  optionsError?: string;
  parameters: Record<string, string | number | string[]>;
  onParametersChange: (values: Record<string, string | number | string[]>) => void;
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
  selectedTrackId: string;
  onClearSelection: () => void;
  isFocusedMobile?: boolean;
  onFocusMobile?: () => void;
}

const ACTION_ICONS = {
  repaint: Sparkles,
  lego: Layers,
  complete: Wand2,
  extend: ArrowRightCircle,
  cover: Shuffle,
  extract: Split,
};

/**
 * Live graphical micro-preview for AI Studio (used in folded mobile mission-control bar
 * and inside the active AI workspace header). Renders actual waveform peaks + selection/task geometry.
 */
const StudioMicroPreview: React.FC<{
  task: Task;
  peaks: number[];
  selectionRatio: { start: number; end: number } | null;
  intensity: number;
}> = ({ task, peaks, selectionRatio, intensity }) => {
  const sampleCount = 24;
  const bars = useMemo(() => {
    if (!peaks || peaks.length === 0) {
      return Array.from({ length: sampleCount }, (_, i) => {
        const t = i / sampleCount;
        return 0.25 + 0.55 * Math.abs(Math.sin(t * Math.PI * 3.2));
      });
    }
    const step = Math.max(1, Math.floor(peaks.length / sampleCount));
    return Array.from({ length: sampleCount }, (_, i) => {
      const idx = Math.min(peaks.length - 1, i * step);
      return Math.max(0.14, Math.min(1, Math.abs(peaks[idx] || 0.25)));
    });
  }, [peaks]);

  const selStart = selectionRatio ? selectionRatio.start : task === 'extend' ? 0.72 : 0.2;
  const selEnd = selectionRatio ? selectionRatio.end : task === 'extend' ? 1.0 : 0.8;

  return (
    <svg
      className="studio-live-micro-svg"
      viewBox="0 0 96 24"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {/* Target region highlight */}
      <rect
        x={selStart * 96}
        y={1}
        width={Math.max(8, (selEnd - selStart) * 96)}
        height={22}
        rx={2}
        fill={task === 'extend' ? 'rgba(0, 255, 65, 0.18)' : 'rgba(0, 240, 255, 0.18)'}
        stroke={task === 'extend' ? 'rgba(0, 255, 65, 0.75)' : 'rgba(0, 240, 255, 0.75)'}
        strokeWidth="1"
      />
      {/* Mini waveform bars */}
      {bars.map((amp, idx) => {
        const ratio = idx / sampleCount;
        const inZone = ratio >= selStart && ratio <= selEnd;
        const h = Math.max(3, amp * 18);
        const y = 12 - h / 2;
        return (
          <rect
            key={idx}
            x={idx * 4 + 1}
            y={y}
            width={2.4}
            height={h}
            rx={1}
            fill={
              inZone
                ? task === 'extend'
                  ? '#00ff41'
                  : '#00f0ff'
                : 'rgba(255, 255, 255, 0.32)'
            }
          />
        );
      })}
      {/* Intensity / synthesis modulation curve overlay */}
      <path
        d={`M 2 ${20 - intensity * 12} Q 48 ${4 + (1 - intensity) * 12} 94 ${18 - intensity * 10}`}
        fill="none"
        stroke="#00ff41"
        strokeWidth="1.4"
        strokeDasharray={task === 'extract' ? '2 2' : undefined}
        opacity="0.9"
      />
    </svg>
  );
};

/**
 * Per-tile mini graphical glyph for each of the 6 AI operations
 */
const OperationMiniGraphic: React.FC<{ actionId: string; isActive: boolean }> = ({
  actionId,
  isActive,
}) => {
  const stroke = isActive ? '#00ff41' : 'rgba(0, 240, 255, 0.75)';
  if (actionId === 'repaint') {
    return (
      <svg className="studio-op-mini-svg" viewBox="0 0 36 12" aria-hidden="true">
        <line x1="1" y1="6" x2="10" y2="6" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />
        <rect x="10" y="1" width="16" height="10" rx="1.5" fill="rgba(0,240,255,0.18)" stroke={stroke} strokeWidth="1" />
        <path d="M 12 8 L 15 3 L 18 9 L 21 4 L 24 7" fill="none" stroke={stroke} strokeWidth="1.3" />
        <line x1="26" y1="6" x2="35" y2="6" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />
      </svg>
    );
  }
  if (actionId === 'lego') {
    return (
      <svg className="studio-op-mini-svg" viewBox="0 0 36 12" aria-hidden="true">
        <line x1="2" y1="9" x2="34" y2="9" stroke="rgba(255,255,255,0.32)" strokeWidth="2" strokeLinecap="round" />
        <line x1="6" y1="4" x2="30" y2="4" stroke={stroke} strokeWidth="2.2" strokeLinecap="round" />
      </svg>
    );
  }
  if (actionId === 'extend') {
    return (
      <svg className="studio-op-mini-svg" viewBox="0 0 36 12" aria-hidden="true">
        <rect x="2" y="3" width="18" height="6" rx="1" fill="rgba(255,255,255,0.28)" />
        <rect x="21" y="2" width="13" height="8" rx="1" fill="rgba(0,255,65,0.22)" stroke={stroke} strokeWidth="1.2" strokeDasharray="2 1" />
      </svg>
    );
  }
  if (actionId === 'complete') {
    return (
      <svg className="studio-op-mini-svg" viewBox="0 0 36 12" aria-hidden="true">
        <line x1="3" y1="3" x2="33" y2="3" stroke={stroke} strokeWidth="1.6" />
        <line x1="3" y1="6" x2="29" y2="6" stroke="rgba(0,240,255,0.75)" strokeWidth="1.6" />
        <line x1="3" y1="9" x2="35" y2="9" stroke="rgba(168,85,247,0.85)" strokeWidth="1.6" />
      </svg>
    );
  }
  if (actionId === 'cover') {
    return (
      <svg className="studio-op-mini-svg" viewBox="0 0 36 12" aria-hidden="true">
        <path d="M 2 9 Q 10 2 18 6 T 34 3" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.4" />
        <path d="M 2 4 Q 12 10 20 5 T 34 8" fill="none" stroke={stroke} strokeWidth="1.5" />
      </svg>
    );
  }
  return (
    <svg className="studio-op-mini-svg" viewBox="0 0 36 12" aria-hidden="true">
      <path d="M 2 6 L 14 6 L 24 2 L 34 2" fill="none" stroke={stroke} strokeWidth="1.5" />
      <path d="M 14 6 L 24 10 L 34 10" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.4" />
    </svg>
  );
};

export const Studio: React.FC<StudioProps> = ({
  options,
  languages,
  optionsError,
  parameters,
  onParametersChange,
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
  selectedTrackId,
  onClearSelection,
  isFocusedMobile = false,
  onFocusMobile,
}) => {
  const tracks = useDawStore((s) => s.tracks);
  const selection = useDawStore((s) => s.selection);
  const duration = useDawStore((s) => s.duration);
  const takes = useDawStore((s) => s.takes);

  const [isPromptModalOpen, setIsPromptModalOpen] = useState<boolean>(false);
  const [isParamModalOpen, setIsParamModalOpen] = useState<boolean>(false);
  const [isLyricsModalOpen, setIsLyricsModalOpen] = useState<boolean>(false);
  const [completePreset, setCompletePreset] = useState<string>('full_band');

  const formatTime = (sec: number) => {
    const safe = Math.max(0, Number.isFinite(sec) ? sec : 0);
    const m = Math.floor(safe / 60);
    const s = Math.floor(safe % 60);
    const ms = Math.floor((safe % 1) * 10);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms}`;
  };

  const selectedTake = takes.find((t) => t.id === selectedTrackId);
  const selectedTrack = tracks.find((t) => t.id === selectedTrackId) || tracks[0];

  const trackName = selectedTake
    ? `#${selectedTake.take_number} ${taskLabel(selectedTake.task)}`
    : selectedTrackId === 'master'
      ? 'MASTER'
      : selectedTrack?.name || 'MASTER';

  const rangeText = selection
    ? `${formatTime(selection.start)}–${formatTime(selection.end)}`
    : null;

  const contextChipText = rangeText ? `${trackName} · ${rangeText}` : trackName;

  const selectionRatio = useMemo(() => {
    if (!selection || !duration || duration <= 0) return null;
    return {
      start: Math.max(0, Math.min(1, selection.start / duration)),
      end: Math.max(0, Math.min(1, selection.end / duration)),
    };
  }, [selection, duration]);

  const activePeaks = useMemo(() => {
    const clip = selectedTrack?.clips?.[0];
    return clip?.peaks || [];
  }, [selectedTrack]);

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
  const stemList = useMemo(() => {
    const baseStems = options?.stems ?? [];
    const extraTracks = instrumentList.filter((t) => !baseStems.some((s) => s.id === t.id));
    return [...baseStems, ...extraTracks];
  }, [options?.stems, instrumentList]);

  const activeTaskDef = aiTasks.find((t) => t.id === task);
  const qualityOptions = useMemo(() => {
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

  const getParamSummary = (
    actionId: string,
  ): { tag: string; value: string; shortVal: string; title: string } => {
    if (actionId === 'repaint') {
      return {
        tag: 'INTENSITY',
        value: `${closestReworkPreset.shortLabel} · ${effectiveRepaintPct}%`,
        shortVal: `${effectiveRepaintPct}%`,
        title: 'Rework Intensity & Crossfade',
      };
    }
    if (actionId === 'lego') {
      const seamSec = Number(parameters.repaintWavCrossfadeSec ?? 0);
      const shortInst = instrument === 'backing_vocals' ? 'Backing' : activeInstrumentLabel.split(' ')[0];
      return {
        tag: 'STEM',
        value: seamSec > 0 ? `${activeInstrumentLabel} · ${seamSec.toFixed(2)}s` : activeInstrumentLabel,
        shortVal: shortInst,
        title: 'Layer Stem & Boundary Seam',
      };
    }
    if (actionId === 'extract') {
      const shortStem = stemType === 'backing_vocals' ? 'Backing' : activeStemLabel.split(' ')[0];
      return {
        tag: 'TARGET',
        value: activeStemLabel,
        shortVal: shortStem,
        title: 'Target Stem to Isolate',
      };
    }
    if (actionId === 'extend') {
      return {
        tag: 'LENGTH',
        value: `+${addedExtendSec}s (${Math.round(targetDuration)}s)`,
        shortVal: `+${addedExtendSec}s`,
        title: 'Extension Target Length & Seam',
      };
    }
    if (actionId === 'cover') {
      return {
        tag: 'BLEND',
        value: `${closestCoverPreset.shortLabel} · ${Math.round(coverStrength * 100)}%`,
        shortVal: `${Math.round(coverStrength * 100)}%`,
        title: 'Restyle Blend & Source Detail',
      };
    }
    if (actionId === 'complete') {
      return {
        tag: 'FOCUS',
        value: activeCompletePreset.label,
        shortVal: activeCompletePreset.label.split(' ')[0],
        title: 'Accompaniment Focus & Stems',
      };
    }
    return { tag: 'PARAM', value: 'Configure', shortVal: 'CFG', title: 'Configure Parameters' };
  };

  const getFilterDescription = (actionId: string): string => {
    if (actionId === 'repaint') return closestReworkPreset.desc;
    if (actionId === 'lego') {
      return instrument === 'vocals' || instrument === 'backing_vocals'
        ? `Adds ${activeInstrumentLabel} stem — opens Lyrics Canvas to write or sync lines`
        : `Layers new ${activeInstrumentLabel} stem locked to your arrangement`;
    }
    if (actionId === 'extract') return `Isolates ${activeStemLabel} into its own dedicated track lane`;
    if (actionId === 'extend') return `Seamlessly extends arrangement to ${Math.round(targetDuration)}s total duration`;
    if (actionId === 'cover') return closestCoverPreset.desc;
    if (actionId === 'complete') return activeCompletePreset.desc;
    return '';
  };

  const promptPlaceholder =
    task === 'repaint'
      ? 'Describe section rework (e.g. punchy bass fill, soaring vocal hook)...'
      : task === 'lego'
        ? 'Describe new stem layer (e.g. funk bassline, airy vocal harmony)...'
        : task === 'extend'
          ? 'Describe continuation (e.g. building outro, drum breakdown)...'
          : task === 'cover'
            ? 'Describe style transformation (e.g. analog synthwave, acoustic)...'
            : 'Describe accompaniment arrangement...';

  const activeSummary = getParamSummary(task);
  const visualIntensity =
    task === 'repaint'
      ? effectiveRepaintVal
      : task === 'cover'
        ? coverStrength
        : 0.65;

  return (
    <section
      aria-label="AI Studio"
      className={`studio-bento-row ${isFocusedMobile ? 'is-mobile-focused' : 'is-mobile-folded'}`}
      onClick={() => {
        if (!isFocusedMobile && onFocusMobile) {
          onFocusMobile();
        }
      }}
    >
      {/* MOBILE FOLDED LIVE GRAPHICAL TELEMETRY BAR (Visible only on <=960px when Manual Toolbox is focused) */}
      {/* UNIFIED IN-PLACE ACCORDION WORKSPACE: Open-Extend <> Close-Shrink in Fixed Order */}
      <div className="studio-unified-block" role="tablist" aria-label="AI Studio Operations">
        {aiTasks
          .filter((action) => action.id in ACTION_ICONS)
          .map((action) => {
            const ActionIcon = ACTION_ICONS[action.id as keyof typeof ACTION_ICONS];
            const isCurrent = task === action.id;
            const shortName = taskLabel(action.id).toUpperCase();
            const summary = getParamSummary(action.id);

            return (
              <div
                key={action.id}
                className={`studio-op-item ${isCurrent ? 'is-open' : 'is-closed'}`}
                data-op={action.id}
              >
                {isCurrent ? (
                  <div
                    className="studio-selected-pane"
                    role="tabpanel"
                    aria-label={`${action.label} workspace`}
                  >
                    {optionsError && (
                      <p role="alert" className="toolbox-error-alert">
                        {optionsError}
                      </p>
                    )}

                    {/* Row 1: Context, Parameter Trigger, Inline Presets & Engine Mode */}
                    <div className="studio-selected-header">
                      <div className="studio-context-cluster">
                        <Tooltip
                          title={action.label}
                          description={`${action.description} (${activeSummary.tag}: ${activeSummary.value})`}
                        >
                          <button
                            type="button"
                            className="studio-active-op-pill"
                            onClick={() => setIsParamModalOpen(true)}
                          >
                            <ActionIcon size={13} />
                            <span>{shortName}</span>
                          </button>
                        </Tooltip>

                        <span
                          className="studio-target-chip"
                          title="Active target track and timeline region"
                        >
                          <span className="studio-target-track">{trackName}</span>
                          {rangeText && (
                            <span className="studio-target-range">
                              {rangeText}
                              <button
                                type="button"
                                className="studio-clear-range-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onClearSelection();
                                }}
                                title="Clear timeline section selection"
                                aria-label="Clear section selection"
                              >
                                <X size={11} />
                              </button>
                            </span>
                          )}
                        </span>

                        <Tooltip
                          title={activeSummary.title}
                          description={`${getFilterDescription(task)} — Click to open granular parameter settings`}
                        >
                          <button
                            type="button"
                            className="studio-param-trigger-btn"
                            onClick={() => setIsParamModalOpen(true)}
                          >
                            <span className="studio-param-tag">{activeSummary.tag}</span>
                            <span className="studio-param-val">{activeSummary.value}</span>
                            <Sliders size={11} />
                          </button>
                        </Tooltip>
                      </div>

                      <div className="studio-header-right">
                        {qualityOptions.length > 1 && (
                          <div
                            className="studio-quality-pills"
                            role="group"
                            aria-label="Generation engine mode"
                          >
                            {qualityOptions.map((q) => (
                              <Tooltip key={q.id} title={q.label} description={`Generation engine mode: ${q.label}`}>
                                <button
                                  type="button"
                                  className={`studio-quality-pill ${selectedQuality === q.id ? 'active' : ''}`}
                                  onClick={() => onQualityChange(q.id)}
                                >
                                  {q.label.toUpperCase()}
                                </button>
                              </Tooltip>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Row 2: Harmonious Operation & Parameter Brief + Quick Presets + Live Signal Preview */}
                    <div className="studio-open-brief">
                      <div className="studio-open-copy">
                        <p className="studio-open-desc">{action.description}</p>
                        <span className="studio-open-param-desc">{getFilterDescription(task)}</span>
                      </div>
                      <div className="studio-inline-presets">
                        {task === 'repaint' &&
                          reworkPresets.slice(0, 4).map((preset) => (
                            <button
                              key={preset.id}
                              type="button"
                              className={`studio-inline-chip ${closestReworkPreset.id === preset.id ? 'active' : ''}`}
                              onClick={() => handleReworkIntensityChange(preset.strength)}
                            >
                              {preset.shortLabel}
                            </button>
                          ))}
                        {task === 'lego' &&
                          instrumentList.slice(0, 5).map((inst) => (
                            <button
                              key={inst.id}
                              type="button"
                              className={`studio-inline-chip ${instrument === inst.id ? 'active' : ''}`}
                              onClick={() => handleSelectLayerInstrument(inst.id)}
                            >
                              {inst.label}
                            </button>
                          ))}
                        {task === 'extend' &&
                          extendPresets.slice(0, 4).map((preset) => (
                            <button
                              key={preset.value}
                              type="button"
                              className={`studio-inline-chip ${Math.abs(Math.round(targetDuration) - preset.value) <= 2 ? 'active' : ''}`}
                              onClick={() => onTargetDurationChange(preset.value)}
                            >
                              {preset.shortLabel}
                            </button>
                          ))}
                        {task === 'cover' &&
                          coverPresets.slice(0, 4).map((preset) => (
                            <button
                              key={preset.value}
                              type="button"
                              className={`studio-inline-chip ${closestCoverPreset.value === preset.value ? 'active' : ''}`}
                              onClick={() => onCoverStrengthChange(preset.value)}
                            >
                              {preset.shortLabel}
                            </button>
                          ))}
                        {task === 'complete' &&
                          completePresets.slice(0, 3).map((preset) => (
                            <button
                              key={preset.id}
                              type="button"
                              className={`studio-inline-chip ${completePreset === preset.id ? 'active' : ''}`}
                              onClick={() => {
                                setCompletePreset(preset.id);
                                onParametersChange({ ...parameters, trackClasses: preset.classes });
                              }}
                            >
                              {preset.label}
                            </button>
                          ))}
                      </div>
                      <div
                        className="studio-open-visual"
                        onClick={() => setIsParamModalOpen(true)}
                        title="Click to adjust operation parameters"
                      >
                        <StudioMicroPreview
                          task={task}
                          peaks={activePeaks}
                          selectionRatio={selectionRatio}
                          intensity={visualIntensity}
                        />
                      </div>
                    </div>

                    {/* Row 3: Prompt / Isolation Bar + Action Controls */}
                    <div className="studio-selected-main">
                      {task !== 'extract' ? (
                        <div className="toolbox-prompt-box-wrapper studio-prompt-wrapper">
                          <input
                            type="text"
                            name="studio-prompt"
                            aria-label="AI Studio Prompt"
                            className="toolbox-prompt-input"
                            placeholder={promptPlaceholder}
                            value={prompt}
                            onChange={(e) => onPromptChange(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !processing) {
                                onExecute();
                              }
                            }}
                          />
                          <Tooltip
                            title="Expand Prompt Editor"
                            description="Open full-size prompt editor with style tags"
                          >
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
                        <div className="studio-extract-banner">
                          <span className="studio-extract-hint">ISOLATE:</span>
                          <div className="studio-extract-chips">
                            {stemList.slice(0, 6).map((stem) => (
                              <button
                                key={stem.id}
                                type="button"
                                className={`studio-extract-chip ${stemType === stem.id ? 'active' : ''}`}
                                onClick={() => onStemTypeChange(stem.id)}
                              >
                                {stem.label}
                              </button>
                            ))}
                            {stemList.length > 6 && (
                              <button
                                type="button"
                                className="studio-extract-chip more"
                                onClick={() => setIsParamModalOpen(true)}
                              >
                                MORE…
                              </button>
                            )}
                          </div>
                        </div>
                      )}

                      <div className="studio-selected-actions">
                        {task !== 'extract' && (
                          <Tooltip
                            title="Lyrics Canvas"
                            description="Write, edit, or sync lyrics for this AI operation"
                          >
                            <button
                              type="button"
                              aria-label="Edit Lyrics"
                              className={`daw-ui-btn toolbox-edit-lyrics-btn ${
                                (task === 'lego' &&
                                  (instrument === 'vocals' || instrument === 'backing_vocals')) ||
                                lyrics.trim().length > 0
                                  ? 'active'
                                  : ''
                              }`}
                              onClick={() => setIsLyricsModalOpen(true)}
                            >
                              <FilePenLine size={13} />
                              <span className="edit-lyrics-btn-label">LYRICS</span>
                            </button>
                          </Tooltip>
                        )}

                        <Tooltip
                          title={taskLabel(task)}
                          description="Execute AI audio operation (Enter)"
                        >
                          <button
                            type="button"
                            className="btn-base btn-variant-primary btn-size-sm toolbox-execute-btn"
                            disabled={processing || !options}
                            onClick={onExecute}
                          >
                            <ArrowUp size={13} />
                            <span>
                              {processing
                                ? progress !== undefined
                                  ? `${progress}%`
                                  : 'WAIT'
                                : taskLabel(task)}
                            </span>
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
                ) : (
                  <Tooltip
                    title={action.label}
                    description={`${action.description} (${summary.tag}: ${summary.value})`}
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={false}
                      className="studio-op-tile"
                      onClick={() => {
                        onSelectTask(action.id as Task);
                        onFocusMobile?.();
                      }}
                    >
                      <div className="studio-op-tile-top">
                        <ActionIcon size={14} className="studio-op-tile-icon" />
                      </div>
                      <OperationMiniGraphic actionId={action.id} isActive={false} />
                      <span className="studio-op-tile-label">{shortName}</span>
                    </button>
                  </Tooltip>
                )}
              </div>
            );
          })}
      </div>

      {/* Standardized AI Studio Parameter Modal */}
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
                {activeSummary.tag}: {activeSummary.value}
              </span>
            </div>
            <p className="toolbox-param-modal-desc">{getFilterDescription(task)}</p>
          </div>

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
            </>
          )}

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
                  <span className="daw-field-label">ACTIVE TRACK CLASSES</span>
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
              </div>
            </>
          )}

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
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {qualityOptions.length > 1 && (
            <div className="toolbox-param-section">
              <div className="toolbox-param-section-head">
                <span className="daw-field-label">SYNTHESIS QUALITY</span>
                <span className="toolbox-param-readout-tag">
                  {selectedQuality.toUpperCase()}
                </span>
              </div>
              <div className="toolbox-param-chip-list">
                {qualityOptions.map((q) => (
                  <button
                    key={q.id}
                    type="button"
                    className={`toolbox-param-chip ${selectedQuality === q.id ? 'active' : ''}`}
                    onClick={() => onQualityChange(q.id)}
                  >
                    {q.label}
                  </button>
                ))}
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

      {/* Expandable Prompt Modal */}
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
              >
                <Sliders size={11} />
                <span>
                  {activeSummary.tag}: {activeSummary.value}
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

          <p className="toolbox-prompt-modal-desc">{getFilterDescription(task)}</p>

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
                <span>EDIT LYRICS</span>
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

      {/* Lyrics Canvas Overlay Modal */}
      <Modal
        isOpen={isLyricsModalOpen}
        onClose={() => setIsLyricsModalOpen(false)}
        title={`LYRICS CANVAS // ${taskLabel(task).toUpperCase()}`}
        headerMeta={
          <>
            <span className="toolbox-lyrics-selection-badge lyrics-modal-region-badge">
              {selection
                ? `TARGET [${formatTime(selection.start)} – ${formatTime(selection.end)}]`
                : `FULL TRACK [00:00.0 – ${formatTime(duration || 0)}]`}
            </span>
            {isTranscribingLyrics || isAligningLyrics ? (
              <span className="lyrics-modal-sync-badge is-loading">
                <Loader2 size={12} className="toolbox-spin-icon" />
                <span>SYNCING</span>
              </span>
            ) : hasExistingLyrics || (lyricsAlignment?.lines?.length ?? 0) > 0 ? (
              <span className="lyrics-modal-sync-badge is-synced">
                <CheckCircle2 size={12} />
                <span>SYNCED</span>
              </span>
            ) : onExtractLyrics ? (
              <button
                type="button"
                className="lyrics-modal-sync-badge is-extract"
                disabled={processing}
                onClick={onExtractLyrics}
              >
                <span>EXTRACT</span>
              </button>
            ) : null}
          </>
        }
        size="lg"
      >
        <div className="toolbox-lyrics-overlay-modal">
          <Canvas
            mode="overlay"
            autoEdit={true}
            lyrics={lyrics}
            onLyricsChange={onLyricsChange || (() => {})}
            vocalLanguage={vocalLanguage}
            onVocalLanguageChange={onVocalLanguageChange || (() => {})}
            hasExistingLyrics={hasExistingLyrics}
            isTranscribingLyrics={isTranscribingLyrics}
            onExtractLyrics={onExtractLyrics || (() => {})}
            lyricsAlignment={lyricsAlignment}
            isAligningLyrics={isAligningLyrics}
            onAlignLyrics={onAlignLyrics || (() => {})}
            languages={languages}
            onClose={() => setIsLyricsModalOpen(false)}
          />
        </div>
      </Modal>
    </section>
  );
};
