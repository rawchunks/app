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

