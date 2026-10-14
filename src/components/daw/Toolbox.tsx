import React, { useState, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import { useDawStore, type LyricsAlignment, type AlignedLine, type AlignedWord } from '../../lib/daw/store';
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
  CheckCircle2,
  Check,
  Pencil,
  Loader2,
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
import { Modal } from '../modal';
import { Button } from '../button';

export type ActiveTool = 'studio' | 'mixer' | 'keys' | 'drums' | 'strudel' | 'dsp' | 'sample' | 'history' | null;

const POPULAR_LANGUAGES = [
  { id: 'en', label: 'English' },
  { id: 'es', label: 'Spanish' },
  { id: 'ja', label: 'Japanese' },
  { id: 'fr', label: 'French' },
  { id: 'de', label: 'German' },
  { id: 'zh', label: 'Chinese' },
  { id: 'ko', label: 'Korean' },
  { id: 'it', label: 'Italian' },
  { id: 'pt', label: 'Portuguese' },
  { id: 'ru', label: 'Russian' },
  { id: 'ar', label: 'Arabic' },
  { id: 'hi', label: 'Hindi' },
];

const DEFAULT_LANGUAGES = [
  ...POPULAR_LANGUAGES,
  { id: 'nl', label: 'Dutch' },
  { id: 'pl', label: 'Polish' },
  { id: 'tr', label: 'Turkish' },
  { id: 'sv', label: 'Swedish' },
  { id: 'da', label: 'Danish' },
  { id: 'fi', label: 'Finnish' },
  { id: 'no', label: 'Norwegian' },
  { id: 'id', label: 'Indonesian' },
  { id: 'vi', label: 'Vietnamese' },
  { id: 'th', label: 'Thai' },
  { id: 'el', label: 'Greek' },
  { id: 'cs', label: 'Czech' },
  { id: 'ro', label: 'Romanian' },
  { id: 'hu', label: 'Hungarian' },
  { id: 'uk', label: 'Ukrainian' },
  { id: 'he', label: 'Hebrew' },
  { id: 'ca', label: 'Catalan' },
  { id: 'hr', label: 'Croatian' },
  { id: 'sk', label: 'Slovak' },
  { id: 'bg', label: 'Bulgarian' },
  { id: 'sr', label: 'Serbian' },
  { id: 'lt', label: 'Lithuanian' },
  { id: 'ms', label: 'Malay' },
  { id: 'tl', label: 'Filipino' },
  { id: 'fa', label: 'Persian' },
  { id: 'ur', label: 'Urdu' },
  { id: 'bn', label: 'Bangla' },
  { id: 'ta', label: 'Tamil' },
  { id: 'te', label: 'Telugu' },
  { id: 'pa', label: 'Punjabi' },
  { id: 'ne', label: 'Nepali' },
  { id: 'sw', label: 'Swahili' },
  { id: 'az', label: 'Azerbaijani' },
  { id: 'is', label: 'Icelandic' },
  { id: 'ht', label: 'Haitian Creole' },
  { id: 'la', label: 'Latin' },
  { id: 'sa', label: 'Sanskrit' },
  { id: 'yue', label: 'Cantonese' },
];

const SECTION_TAGS = ['[Intro]', '[Verse]', '[Pre-Chorus]', '[Chorus]', '[Bridge]', '[Hook]', '[Outro]'];

function formatSyncTimestamp(sec: number | null | undefined): string {
  const safe = Math.max(0, typeof sec === 'number' && Number.isFinite(sec) ? sec : 0);
  const m = Math.floor(safe / 60);
  const s = Math.floor(safe % 60);
  const ms = Math.floor((safe % 1) * 10);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms}`;
}

function sanitizeAlignedLineWords(rawWords: AlignedWord[]): AlignedWord[] {
  if (!Array.isArray(rawWords) || rawWords.length === 0) return [];
  const words: AlignedWord[] = rawWords.map((w) => ({ ...w }));

  if (words.length >= 2) {
    for (let k = Math.min(1, words.length - 2); k >= 0; k--) {
      const w = words[k];
      const next = words[k + 1];
      const prev = k > 0 ? words[k - 1] : null;
      const dur = w.end - w.start;
      const gapToNext = next.start - w.end;
      const gapFromPrev = prev ? w.start - prev.end : Infinity;
      const loss = w.loss ?? 0;

      const isPrematureBlip = gapToNext > 1.2;
      const isIsolatedPreSilenceStretch = gapFromPrev > 0.6 && dur > 1.6 && loss > 1.8;

      if (isPrematureBlip || isIsolatedPreSilenceStretch) {
        const cleanLen = Math.max(1, w.text.replace(/[^\p{L}\p{N}]+/gu, '').length);
        const estDur = Math.min(0.45, Math.max(0.18, cleanLen * 0.065));
        const newEnd = Number(Math.max(0, next.start - 0.04).toFixed(3));
        const newStart = Number(Math.max(0, newEnd - estDur).toFixed(3));
        w.start = newStart;
        w.end = Math.max(newStart, newEnd);
      }
    }
  }

  return words;
}

function splitWordsIntoAlignedPhrases(rawWords: AlignedWord[]): AlignedWord[][] {
  const words = sanitizeAlignedLineWords(rawWords);
  if (words.length === 0) return [];
  const chunks: AlignedWord[][] = [];
  let current: AlignedWord[] = [];

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const next = words[i + 1] ?? null;
    const next2 = words[i + 2] ?? null;
    current.push(w);

    if (!next) {
      chunks.push(sanitizeAlignedLineWords(current));
      current = [];
      break;
    }

    const pauseAfter = next.start - w.end;
    const wordDur = w.end - w.start;
    const endsSentence = /[.!?…。！？]['"’)\]]*$/.test(w.text);
    const endsClause = /[,;:—–،、-]$/.test(w.text);

    const pauseAfterNext = next2 ? next2.start - next.end : Infinity;
    const nextEndsPhrase =
      /[.!?…。！？]['"’)\]]*$/.test(next.text) || pauseAfterNext >= 0.55;
    const pauseAfterNext2 = words[i + 3] ? words[i + 3].start - (next2?.end ?? 0) : Infinity;
    const next2EndsPhrase =
      next2 !== null &&
      !nextEndsPhrase &&
      (/[.!?…。！？]['"’)\]]*$/.test(next2.text) || pauseAfterNext2 >= 0.55);

    const shouldFlush =
      (endsSentence && (current.length >= 2 || pauseAfter >= 0.35)) ||
      pauseAfter >= 0.55 ||
      (wordDur >= 1.8 && current.length >= 2 && !nextEndsPhrase) ||
      (endsClause && current.length >= 4 && !nextEndsPhrase && !next2EndsPhrase) ||
      (current.length >= 8 && !nextEndsPhrase && !next2EndsPhrase && (pauseAfter >= 0.14 || current.length >= 10));

    if (shouldFlush) {
      chunks.push(sanitizeAlignedLineWords(current));
      current = [];
    }
  }

  if (current.length > 0) {
    chunks.push(sanitizeAlignedLineWords(current));
  }

  return chunks;
}

function normalizeAlignmentLines(alignment: LyricsAlignment): LyricsAlignment {
  const normalizedLines: AlignedLine[] = [];

  for (const line of alignment.lines) {
    if (line.isTag || !line.words || line.words.length === 0) {
      normalizedLines.push({
        ...line,
        index: normalizedLines.length,
      });
      continue;
    }

    const phraseChunks = splitWordsIntoAlignedPhrases(line.words);
    if (phraseChunks.length === 1) {
      const chunk = phraseChunks[0];
      normalizedLines.push({
        index: normalizedLines.length,
        text: line.text,
        isTag: false,
        start: chunk[0].start,
        end: chunk[chunk.length - 1].end,
        words: chunk,
      });
    } else {
      for (const chunk of phraseChunks) {
        normalizedLines.push({
          index: normalizedLines.length,
          text: chunk.map((w) => w.text).join(' '),
          isTag: false,
          start: chunk[0].start,
          end: chunk[chunk.length - 1].end,
          words: chunk,
        });
      }
    }
  }

  return {
    ...alignment,
    lines: normalizedLines,
    words: normalizedLines.flatMap((l) => l.words),
  };
}

interface LyricsHighlightedCanvasProps {
  alignment: LyricsAlignment;
  selection: { start: number; end: number } | null;
  onStartEdit: (targetLineIdx?: number) => void;
}

const LyricsHighlightedCanvas: React.FC<LyricsHighlightedCanvasProps> = ({
  alignment,
  selection,
  onStartEdit,
}) => {
  const playhead = useDawStore((s) => s.playhead);
  const isPlaying = useDawStore((s) => s.isPlaying);
  const duration = useDawStore((s) => s.duration);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<Array<HTMLDivElement | null>>([]);
  const lastScrolledPlayLineRef = useRef<number>(-1);
  const lastSelectionKeyRef = useRef<string>('');

  const maxAlignedEnd = useMemo(() => {
    let maxEnd = 0;
    for (const l of alignment.lines) {
      if (typeof l.end === 'number' && l.end > maxEnd) maxEnd = l.end;
    }
    return maxEnd;
  }, [alignment.lines]);

  const totalTimelineDuration = duration > 0 ? duration : maxAlignedEnd;

  const footerTimeLabel = useMemo(() => {
    if (selection) {
      const inSelection =
        playhead >= selection.start - 0.1 && playhead <= selection.end + 0.25;
      if (inSelection && (isPlaying || playhead > 0.05)) {
        return `${formatSyncTimestamp(playhead)} / ${formatSyncTimestamp(selection.end)}`;
      }
      if (isPlaying && playhead > 0.05) {
        return `${formatSyncTimestamp(playhead)} • [${formatSyncTimestamp(selection.start)} – ${formatSyncTimestamp(selection.end)}]`;
      }
      return `${formatSyncTimestamp(selection.start)} – ${formatSyncTimestamp(selection.end)}`;
    }
    if (totalTimelineDuration > 0) {
      return `${formatSyncTimestamp(playhead)} / ${formatSyncTimestamp(totalTimelineDuration)}`;
    }
    return formatSyncTimestamp(playhead);
  }, [selection, playhead, isPlaying, totalTimelineDuration]);

  const activeLineIndex = useMemo(() => {
    return alignment.lines.findIndex(
      (l) =>
        !l.isTag &&
        l.start !== null &&
        l.end !== null &&
        playhead >= l.start &&
        playhead <= l.end + 0.15,
    );
  }, [alignment.lines, playhead]);

  const selectedLineIndices = useMemo(() => {
    if (!selection) return new Set<number>();
    const indices = new Set<number>();
    alignment.lines.forEach((line, idx) => {
      if (
        !line.isTag &&
        line.start !== null &&
        line.end !== null &&
        line.end >= selection.start &&
        line.start <= selection.end
      ) {
        indices.add(idx);
        if (idx > 0 && alignment.lines[idx - 1]?.isTag) {
          indices.add(idx - 1);
        }
      }
    });
    return indices;
  }, [alignment.lines, selection]);

  const scrollLineIntoContainer = (lineIdx: number) => {
    const container = scrollContainerRef.current;
    const lineEl = lineRefs.current[lineIdx];
    if (!container || !lineEl) return;
    const containerRect = container.getBoundingClientRect();
    const lineRect = lineEl.getBoundingClientRect();
    const relativeTop = lineRect.top - containerRect.top + container.scrollTop;
    const targetTop = Math.max(0, relativeTop - container.clientHeight / 2 + lineEl.offsetHeight / 2);
    container.scrollTo({ top: targetTop, behavior: 'smooth' });
  };

  // Auto-scroll following playback
  useEffect(() => {
    if (activeLineIndex >= 0 && activeLineIndex !== lastScrolledPlayLineRef.current) {
      lastScrolledPlayLineRef.current = activeLineIndex;
      scrollLineIntoContainer(activeLineIndex);
    }
  }, [activeLineIndex]);

  // Auto-scroll to selected segment when selection changes or canvas opens
  useEffect(() => {
    if (!selection) {
      lastSelectionKeyRef.current = '';
      return;
    }
    const key = `${selection.start.toFixed(2)}-${selection.end.toFixed(2)}-${alignment.lines.length}`;
    if (key === lastSelectionKeyRef.current) return;
    lastSelectionKeyRef.current = key;
    if (isPlaying) return;
    const firstSungIdx = alignment.lines.findIndex(
      (l) =>
        !l.isTag &&
        l.start !== null &&
        l.end !== null &&
        l.end >= selection.start &&
        l.start <= selection.end,
    );
    if (firstSungIdx >= 0) {
      const timer = setTimeout(() => scrollLineIntoContainer(firstSungIdx), 40);
      return () => clearTimeout(timer);
    }
  }, [selection, alignment.lines, isPlaying]);

  const handleSeek = (sec: number | null | undefined) => {
    if (typeof sec !== 'number' || !Number.isFinite(sec)) return;
    const clamped = Math.max(0, sec);
    dawEngine.seek(clamped);
    useDawStore.getState().setPlayhead(clamped);
  };

  return (
    <div className="toolbox-lyrics-canvas-wrapper">
      {selection && (
        <div className="toolbox-lyrics-selection-banner">
          <span className="toolbox-lyrics-selection-badge">
            SELECTED SEGMENT [{formatSyncTimestamp(selection.start)} – {formatSyncTimestamp(selection.end)}]
          </span>
          <span className="toolbox-lyrics-selection-count">
            {selectedLineIndices.size > 0 ? 'HIGHLIGHTED IN CANVAS BELOW' : 'INSTRUMENTAL / NO VOCALS IN RANGE'}
          </span>
        </div>
      )}

      <div
        ref={scrollContainerRef}
        className="toolbox-lyrics-canvas toolbox-lyrics-canvas-highlighted"
        onDoubleClick={() => onStartEdit()}
        title="Click any word to seek playhead • Double-click anywhere to edit lyrics text"
      >
        {alignment.lines.map((line, lineIdx) => {
          const isInSelection = selectedLineIndices.has(lineIdx);
          if (line.isTag) {
            return (
              <div
                key={`sec-${lineIdx}-${line.text}`}
                ref={(el) => {
                  lineRefs.current[lineIdx] = el;
                }}
                className={`toolbox-lyrics-canvas-line is-tag-line ${isInSelection ? 'is-in-selection' : ''}`}
                onClick={() => handleSeek(line.start)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  onStartEdit(lineIdx);
                }}
              >
                <span className="toolbox-lyrics-sync-section-tag">{line.text}</span>
                {line.start !== null && (
                  <span className="toolbox-lyrics-sync-timestamp">
                    {formatSyncTimestamp(line.start)}
                  </span>
                )}
                {isInSelection && <span className="toolbox-lyrics-sync-sel-pill">SELECTED</span>}
              </div>
            );
          }

          const isActiveLine = lineIdx === activeLineIndex;
          const isPastLine = line.end !== null && playhead > line.end + 0.15;

          return (
            <div
              key={`line-${lineIdx}-${line.start}`}
              ref={(el) => {
                lineRefs.current[lineIdx] = el;
              }}
              className={`toolbox-lyrics-canvas-line ${isActiveLine ? 'is-active-line' : ''} ${isPastLine ? 'is-past-line' : ''} ${isInSelection ? 'is-in-selection' : ''}`}
              onDoubleClick={(e) => {
                e.stopPropagation();
                onStartEdit(lineIdx);
              }}
            >
              <div className="toolbox-lyrics-sync-words">
                {line.words.length > 0 ? (
                  line.words.map((word, wIdx) => {
                    const isActiveWord =
                      playhead >= word.start && playhead <= word.end + 0.08;
                    const isPastWord = playhead > word.end + 0.08;
                    const isWordInSelection = Boolean(
                      selection && word.end >= selection.start && word.start <= selection.end,
                    );
                    return (
                      <span
                        key={`w-${lineIdx}-${wIdx}-${word.start}`}
                        className={`toolbox-lyrics-sync-word ${isActiveWord ? 'is-active-word' : ''} ${isPastWord ? 'is-past-word' : ''} ${isWordInSelection ? 'is-in-selection' : ''}`}
                        onClick={() => handleSeek(word.start)}
                        title={`${word.text} [${formatSyncTimestamp(word.start)} – ${formatSyncTimestamp(word.end)}]`}
                      >
                        {word.text}{wIdx < line.words.length - 1 ? ' ' : ''}
                      </span>
                    );
                  })
                ) : (
                  <span
                    className="toolbox-lyrics-sync-word"
                    onClick={() => handleSeek(line.start)}
                  >
                    {line.text}
                  </span>
                )}
              </div>
              <span
                className="toolbox-lyrics-sync-timestamp"
                onClick={() => handleSeek(line.start)}
                title={`Seek playhead to ${formatSyncTimestamp(line.start)}`}
              >
                {formatSyncTimestamp(line.start)}
              </span>
            </div>
          );
        })}
      </div>

      <div className="toolbox-lyrics-sidepanel-footer">
        <span>DOUBLE-CLICK TO EDIT</span>
        <span
          className={`toolbox-lyrics-footer-time ${
            isPlaying ? 'is-active' : selection ? 'is-segment' : ''
          }`}
        >
          {footerTimeLabel}
        </span>
      </div>
    </div>
  );
};

export interface ToolboxProps {
  options?: Options['editing'];
  languages?: Array<{ id: string; label: string }>;
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
  vocalLanguage: string;
  onVocalLanguageChange: (language: string) => void;
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

const ACTION_ICONS = { repaint: Sparkles, lego: Layers, complete: Wand2, extend: ArrowRightCircle, cover: Shuffle, extract: Split };

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
  lyrics,
  onLyricsChange,
  vocalLanguage,
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
  const { tracks, selection, duration, takes, commits, toggleTake, deleteTake, isPlaying, setPlaying } = useDawStore();
  const [isMinimized, setIsMinimized] = useState<boolean>(() => typeof window !== 'undefined' && window.innerWidth <= 768);
  const [isLyricsPanelOpen, setIsLyricsPanelOpen] = useState<boolean>(false);
  const [isEditingLyricsCanvas, setIsEditingLyricsCanvas] = useState<boolean>(false);
  const [isLanguageModalOpen, setIsLanguageModalOpen] = useState<boolean>(false);
  const [languageSearch, setLanguageSearch] = useState<string>('');
  const lyricsCanvasRef = useRef<HTMLTextAreaElement | null>(null);
  const hasAutoOpenedLyricsRef = useRef<boolean>(false);
  const availableLanguages = languages && languages.length > 0 ? languages : DEFAULT_LANGUAGES;
  const filteredLanguages = availableLanguages.filter(
    (l) =>
      l.id.toLowerCase().includes(languageSearch.toLowerCase()) ||
      l.label.toLowerCase().includes(languageSearch.toLowerCase())
  );

  const isLyricsDirty = useMemo(() => {
    if (!lyricsAlignment?.lines || lyricsAlignment.lines.length === 0) return false;
    const alignedText = lyricsAlignment.lines
      .filter((l) => !l.isTag)
      .map((l) => l.text.trim())
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    const currentNonTagText = lyrics
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => Boolean(l) && !/^\[[^\]]+\]$/.test(l))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    return currentNonTagText !== alignedText;
  }, [lyrics, lyricsAlignment?.lines]);

  const displayAlignment = useMemo<LyricsAlignment | null>(() => {
    const baseNorm =
      lyricsAlignment && Array.isArray(lyricsAlignment.lines) && lyricsAlignment.lines.length > 0
        ? normalizeAlignmentLines(lyricsAlignment)
        : null;

    const rawLines = lyrics
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    if (baseNorm && !isLyricsDirty) {
      const hasCustomTags = rawLines.some((l) => /^\[[^\]]+\]$/.test(l));
      const baseHasTags = baseNorm.lines.some((l) => l.isTag);
      if (!hasCustomTags || baseHasTags) {
        return baseNorm;
      }
    }

    if (rawLines.length === 0) {
      return baseNorm;
    }

    const baseSungLines = baseNorm ? baseNorm.lines.filter((l) => !l.isTag) : [];
    const totalRawSung = Math.max(1, rawLines.filter((l) => !/^\[[^\]]+\]$/.test(l)).length);
    let sungCounter = 0;

    const mergedLines: AlignedLine[] = rawLines.map((lineText, idx) => {
      if (/^\[[^\]]+\]$/.test(lineText)) {
        return {
          index: idx,
          text: lineText,
          isTag: true,
          start: null,
          end: null,
          words: [],
        };
      }
      const exactMatch = baseSungLines.find(
        (b) => b.text.trim().toLowerCase() === lineText.toLowerCase(),
      );
      const proportionalMatch =
        baseSungLines.length > 0
          ? baseSungLines[Math.min(baseSungLines.length - 1, Math.floor((sungCounter / totalRawSung) * baseSungLines.length))]
          : null;
      sungCounter++;
      const matched = exactMatch ?? proportionalMatch;
      return {
        index: idx,
        text: lineText,
        isTag: false,
        start: matched?.start ?? null,
        end: matched?.end ?? null,
        words: exactMatch ? exactMatch.words : [],
      };
    });

    return {
      source: baseNorm?.source ?? 'scribe_v2',
      updatedAt: baseNorm?.updatedAt ?? new Date().toISOString(),
      lines: mergedLines,
      words: mergedLines.flatMap((l) => l.words),
    };
  }, [lyricsAlignment, isLyricsDirty, lyrics]);

  const isLyricsExtracted = Boolean(
    lyrics.trim().length > 0 &&
      ((lyricsAlignment && Array.isArray(lyricsAlignment.lines) && lyricsAlignment.lines.length > 0) ||
        hasExistingLyrics),
  );

  const pendingEditTargetRef = useRef<{
    charStart: number;
    charEnd: number;
    textToEdit: string;
  } | null>(null);

  const applyEditFocusAndScroll = (
    el: HTMLTextAreaElement,
    target: { charStart: number; charEnd: number; textToEdit: string },
  ) => {
    const fullVal = el.value || target.textToEdit;
    const safeStart = Math.max(0, Math.min(fullVal.length, target.charStart));
    const safeEnd = Math.max(safeStart, Math.min(fullVal.length, target.charEnd));

    let caretPixelTop = 0;
    if (safeStart > 0 && typeof document !== 'undefined') {
      const mirror = document.createElement('div');
      mirror.className = 'toolbox-lyrics-measure-mirror';
      const style = window.getComputedStyle(el);
      mirror.style.width = `${el.clientWidth || 280}px`;
      mirror.style.font = style.font;
      mirror.style.fontFamily = style.fontFamily;
      mirror.style.fontSize = style.fontSize;
      mirror.style.fontWeight = style.fontWeight;
      mirror.style.lineHeight = style.lineHeight;
      mirror.style.letterSpacing = style.letterSpacing;
      mirror.style.padding = style.padding;

      const beforeNode = document.createTextNode(fullVal.slice(0, safeStart));
      const markerSpan = document.createElement('span');
      markerSpan.textContent = fullVal.slice(safeStart, Math.max(safeStart + 1, safeEnd)) || '\u200b';
      mirror.appendChild(beforeNode);
      mirror.appendChild(markerSpan);
      document.body.appendChild(mirror);
      caretPixelTop = markerSpan.offsetTop;
      document.body.removeChild(mirror);
    }

    el.focus({ preventScroll: true });
    el.setSelectionRange(safeStart, safeEnd);
    el.scrollTop =
      safeStart > 0 ? Math.max(0, caretPixelTop - Math.round((el.clientHeight || 180) * 0.22)) : 0;
  };

  useLayoutEffect(() => {
    if (!isEditingLyricsCanvas || !pendingEditTargetRef.current) return;
    const target = pendingEditTargetRef.current;
    const el = lyricsCanvasRef.current;
    if (el) {
      applyEditFocusAndScroll(el, target);
    }
    const rafId = requestAnimationFrame(() => {
      if (lyricsCanvasRef.current && pendingEditTargetRef.current) {
        applyEditFocusAndScroll(lyricsCanvasRef.current, pendingEditTargetRef.current);
      }
    });
    const timerId = setTimeout(() => {
      if (lyricsCanvasRef.current && pendingEditTargetRef.current) {
        applyEditFocusAndScroll(lyricsCanvasRef.current, pendingEditTargetRef.current);
        if (lyricsCanvasRef.current.value === pendingEditTargetRef.current.textToEdit) {
          pendingEditTargetRef.current = null;
        }
      }
    }, 45);
    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(timerId);
    };
  }, [isEditingLyricsCanvas, lyrics]);

  const startEditingLyrics = (preferredLineIdx?: number) => {
    const activeAlign = displayAlignment;
    let textToEdit = lyrics;
    if (activeAlign && activeAlign.lines.length > 0) {
      const canonical = activeAlign.lines.map((l) => l.text).join('\n');
      if (canonical && canonical !== lyrics) {
        textToEdit = canonical;
        onLyricsChange(canonical);
      }
    }

    let targetStartIdx = 0;
    let targetEndIdx = 0;
    const alignLines = activeAlign?.lines ?? [];

    if (typeof preferredLineIdx === 'number' && preferredLineIdx >= 0) {
      targetStartIdx = preferredLineIdx;
      targetEndIdx = preferredLineIdx;
    } else if (selection && alignLines.length > 0) {
      const overlapping: number[] = [];
      alignLines.forEach((l, idx) => {
        if (!l.isTag && l.start !== null && l.end !== null && l.end >= selection.start && l.start <= selection.end) {
          overlapping.push(idx);
        }
      });
      if (overlapping.length > 0) {
        targetStartIdx = overlapping[0];
        targetEndIdx = overlapping[overlapping.length - 1];
      } else {
        let bestIdx = 0;
        let bestDist = Infinity;
        alignLines.forEach((l, idx) => {
          if (l.start !== null) {
            const dist = Math.abs(l.start - selection.start);
            if (dist < bestDist) {
              bestDist = dist;
              bestIdx = idx;
            }
          }
        });
        targetStartIdx = bestIdx;
        targetEndIdx = bestIdx;
      }
    } else if (alignLines.length > 0) {
      const ph = useDawStore.getState().playhead;
      if (ph > 0) {
        const activeIdx = alignLines.findIndex(
          (l) => !l.isTag && l.start !== null && l.end !== null && ph >= l.start && ph <= l.end + 0.2,
        );
        if (activeIdx >= 0) {
          targetStartIdx = activeIdx;
          targetEndIdx = activeIdx;
        }
      }
    }

    const rawTextLines = textToEdit.split('\n');
    let charStart = 0;
    let charEnd = 0;

    if (rawTextLines.length > 0) {
      const clampedStart = Math.max(0, Math.min(rawTextLines.length - 1, targetStartIdx));
      const clampedEnd = Math.max(clampedStart, Math.min(rawTextLines.length - 1, targetEndIdx));
      for (let i = 0; i < clampedStart; i++) {
        charStart += rawTextLines[i].length + 1;
      }
      charEnd = charStart;
      for (let i = clampedStart; i <= clampedEnd; i++) {
        charEnd += rawTextLines[i].length + (i < clampedEnd ? 1 : 0);
      }
    }

    pendingEditTargetRef.current = { charStart, charEnd, textToEdit };
    setIsEditingLyricsCanvas(true);
  };

  const finishEditingLyrics = () => {
    pendingEditTargetRef.current = null;
    setIsEditingLyricsCanvas(false);
    if (isLyricsDirty && onAlignLyrics && lyrics.trim().length > 0) {
      onAlignLyrics(lyrics);
    }
  };

  const isShowingLyricsEditor = isEditingLyricsCanvas || !displayAlignment;

  const renderUnifiedLyricsSyncIcon = () => {
    if (isTranscribingLyrics || isAligningLyrics) {
      const label = isTranscribingLyrics ? 'Extracting lyrics...' : 'Syncing lyrics...';
      return (
        <Tooltip title={label}>
          <span
            className="toolbox-lyrics-unified-icon is-loading"
            aria-label={label}
            onClick={(e) => e.stopPropagation()}
          >
            <Loader2 size={13} className="toolbox-spin-icon" />
          </span>
        </Tooltip>
      );
    }

    if (isLyricsExtracted) {
      return (
        <Tooltip title="Synced">
          <span
            className="toolbox-lyrics-unified-icon is-synced"
            aria-label="Lyrics synced"
            onClick={(e) => e.stopPropagation()}
          >
            <CheckCircle2 size={13} />
          </span>
        </Tooltip>
      );
    }

    if (!onExtractLyrics) return null;

    return (
      <Tooltip title="Extract lyrics">
        <button
          type="button"
          className="toolbox-lyrics-unified-icon is-extract"
          disabled={processing}
          onClick={(e) => {
            e.stopPropagation();
            onExtractLyrics();
          }}
          aria-label="Extract lyrics"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.65"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 5v6M6 3v10M9 6v4" />
            <path d="M12 4h2M12 8h2M12 12h2" />
          </svg>
        </button>
      </Tooltip>
    );
  };

  // Automatically open Lyrics Canvas on desktop once lyrics/alignment are available
  useEffect(() => {
    if ((displayAlignment || lyrics.trim().length > 0) && !hasAutoOpenedLyricsRef.current) {
      hasAutoOpenedLyricsRef.current = true;
      if (displayAlignment) {
        setIsEditingLyricsCanvas(false);
      }
      if (typeof window !== 'undefined' && window.innerWidth > 768) {
        setIsLyricsPanelOpen(true);
      }
    }
  }, [displayAlignment, lyrics]);

  // Switch to highlighted canvas view when acoustic alignment arrives
  useEffect(() => {
    if (lyricsAlignment && Array.isArray(lyricsAlignment.lines) && lyricsAlignment.lines.length > 0) {
      setIsEditingLyricsCanvas(false);
    }
  }, [lyricsAlignment?.updatedAt, lyricsAlignment?.lines?.length]);

  // Switch to highlighted canvas view when playback transitions from stopped -> playing
  const prevIsPlayingRef = useRef(isPlaying);
  useEffect(() => {
    const startedPlaying = !prevIsPlayingRef.current && isPlaying;
    prevIsPlayingRef.current = isPlaying;
    if (startedPlaying && displayAlignment) {
      setIsEditingLyricsCanvas(false);
    }
  }, [isPlaying, displayAlignment]);

  const prevRevealRef = useRef(reveal);
  useEffect(() => {
    if (reveal && reveal !== prevRevealRef.current) {
      prevRevealRef.current = reveal;
      setIsMinimized(false);
      if (displayAlignment || lyrics.trim().length > 0) {
        setIsLyricsPanelOpen(true);
        if (displayAlignment) {
          setIsEditingLyricsCanvas(false);
        }
      }
    }
  }, [reveal, displayAlignment, lyrics]);

  // When a timeline segment selection is newly made or changed while Toolbox is open and lyrics exist, show highlighted canvas and open panel on desktop
  const prevSelectionRef = useRef<{ start: number; end: number } | null>(selection);
  useEffect(() => {
    const prev = prevSelectionRef.current;
    const selectionChanged =
      prev?.start !== selection?.start || prev?.end !== selection?.end;
    prevSelectionRef.current = selection;
    if (!selectionChanged) return;

    if (selection && (displayAlignment || lyrics.trim().length > 0)) {
      if (displayAlignment) {
        setIsEditingLyricsCanvas(false);
      }
      if (!prev && typeof window !== 'undefined' && window.innerWidth > 768 && !isMinimized && activeTool === 'studio') {
        setIsLyricsPanelOpen(true);
      }
    }
  }, [selection, displayAlignment, lyrics, isMinimized, activeTool]);

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
  const isNonVocalStemSelected = Boolean(
    selectedTrack?.stemType && selectedTrack.stemType !== 'vocals' && selectedTrack.stemType !== 'backing_vocals'
  );
  const showLyricsSection =
    task !== 'extract' &&
    (task === 'lego'
      ? instrument === 'vocals' || instrument === 'backing_vocals'
      : !isNonVocalStemSelected);
  const showLyricsSidePanel = activeTool === 'studio' && !isMinimized && showLyricsSection && isLyricsPanelOpen;

  const insertSectionTag = (tag: string) => {
    const el = lyricsCanvasRef.current;
    const isFocused = typeof document !== 'undefined' && document.activeElement === el;
    if (!isEditingLyricsCanvas) {
      setIsEditingLyricsCanvas(true);
    }
    if (el && isFocused) {
      const start = el.selectionStart ?? lyrics.length;
      const end = el.selectionEnd ?? lyrics.length;
      const before = lyrics.slice(0, start);
      const after = lyrics.slice(end);
      const prefix = before.length > 0 && !before.endsWith('\n') ? '\n' : '';
      const suffix = after.startsWith('\n') ? '' : '\n';
      const next = `${before}${prefix}${tag}${suffix}${after}`;
      const cursor = before.length + prefix.length + tag.length + suffix.length;
      onLyricsChange(next);
      setTimeout(() => {
        el.focus({ preventScroll: true });
        el.setSelectionRange(cursor, cursor);
      }, 0);
    } else {
      const activeAlign = displayAlignment;
      const baseText =
        activeAlign && activeAlign.lines.length > 0
          ? activeAlign.lines.map((l) => l.text).join('\n')
          : lyrics;
      const rawLines = baseText.split('\n');
      let insertLineIdx = rawLines.length;
      if (selection && activeAlign && activeAlign.lines.length > 0) {
        const matchIdx = activeAlign.lines.findIndex(
          (l) => !l.isTag && l.start !== null && l.end !== null && l.end >= selection.start && l.start <= selection.end,
        );
        if (matchIdx >= 0) {
          insertLineIdx = matchIdx;
        }
      }
      if (insertLineIdx < rawLines.length && baseText.trim().length > 0) {
        const beforeLines = rawLines.slice(0, insertLineIdx);
        const afterLines = rawLines.slice(insertLineIdx);
        const beforeStr = beforeLines.length > 0 ? `${beforeLines.join('\n')}\n` : '';
        const next = `${beforeStr}${tag}\n${afterLines.join('\n')}`;
        const cursor = beforeStr.length + tag.length + 1;
        pendingEditTargetRef.current = { charStart: cursor, charEnd: cursor, textToEdit: next };
        onLyricsChange(next);
      } else {
        const prefix = baseText.trim().length > 0 ? `${baseText.trimEnd()}\n` : '';
        const next = `${prefix}${tag}\n`;
        pendingEditTargetRef.current = { charStart: next.length, charEnd: next.length, textToEdit: next };
        onLyricsChange(next);
      }
    }
  };

  const trackName = selectedTake
    ? `Take #${selectedTake.take_number} (${taskLabel(selectedTake.task)})`
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
      } catch (_) { }
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
    } catch (_) { }
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
      className={`floating-toolbox ${isDragging ? 'dragging' : ''} ${isMinimized ? 'minimized' : ''} ${showLyricsSidePanel ? 'with-lyrics-panel' : ''}`}
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
                <div className={`toolbox-studio-split ${showLyricsSidePanel ? 'panel-open' : ''}`}>
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
                        {showLyricsSection && (
                          <div
                            className={`toolbox-param-row toolbox-lyrics-trigger-row ${isLyricsPanelOpen ? 'open' : ''}`}
                            onClick={() => setIsLyricsPanelOpen(true)}
                          >
                            <label>LYRICS:</label>
                            <input
                              type="text"
                              className="toolbox-text-input"
                              placeholder={
                                isTranscribingLyrics
                                  ? 'Transcribing isolated vocals...'
                                  : 'Click to open Lyrics Canvas...'
                              }
                              value={lyrics}
                              onFocus={() => setIsLyricsPanelOpen(true)}
                              onChange={(e) => {
                                setIsEditingLyricsCanvas(true);
                                onLyricsChange(e.target.value);
                              }}
                            />
                            {!isLyricsExtracted && !showLyricsSidePanel && renderUnifiedLyricsSyncIcon()}
                            <Tooltip title="Select vocal language">
                              <button
                                type="button"
                                className="toolbox-lyrics-lang-pill"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setIsLanguageModalOpen(true);
                                }}
                                aria-label="Select vocal language"
                              >
                                {(vocalLanguage || 'en').toUpperCase()}
                              </button>
                            </Tooltip>
                            <Tooltip title={isLyricsPanelOpen ? 'Hide Lyrics Canvas' : 'Open Lyrics Canvas'}>
                              <button
                                type="button"
                                className={`toolbox-lyrics-toggle-btn ${isLyricsPanelOpen ? 'active is-icon-only' : ''}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setIsLyricsPanelOpen((prev) => !prev);
                                }}
                                aria-label={isLyricsPanelOpen ? 'Hide Lyrics Canvas' : 'Open Lyrics Canvas'}
                              >
                                {isLyricsPanelOpen ? (
                                  <svg
                                    width="13"
                                    height="13"
                                    viewBox="0 0 16 16"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.75"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  >
                                    <path d="M11 3h2v10h-2" />
                                    <path d="M10 8H3" />
                                    <path d="M6 5L3 8l3 3" />
                                  </svg>
                                ) : (
                                  'CANVAS'
                                )}
                              </button>
                            </Tooltip>
                          </div>
                        )}
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

                  {/* Clean Responsive Lyrics Side-Panel */}
                  {showLyricsSidePanel && (
                    <div className="toolbox-lyrics-sidepanel">
                      <div className="toolbox-lyrics-sidepanel-header">
                        <div className="toolbox-lyrics-sidepanel-title-wrap">
                          <span className="toolbox-lyrics-sidepanel-title">LYRICS CANVAS</span>
                        </div>
                        <div className="toolbox-lyrics-sidepanel-actions">
                          {renderUnifiedLyricsSyncIcon()}
                          {displayAlignment && (
                            <Tooltip title={isShowingLyricsEditor ? 'Done editing' : 'Edit lyrics'}>
                              <button
                                type="button"
                                className={`toolbox-lyrics-mode-btn is-icon-btn ${isShowingLyricsEditor ? 'active' : ''}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (isShowingLyricsEditor) {
                                    finishEditingLyrics();
                                  } else {
                                    startEditingLyrics();
                                  }
                                }}
                                aria-label={isShowingLyricsEditor ? 'Done editing' : 'Edit lyrics'}
                              >
                                {isShowingLyricsEditor ? <Check size={13} /> : <Pencil size={12} />}
                              </button>
                            </Tooltip>
                          )}
                          <Tooltip title="Close Lyrics Canvas">
                            <button
                              type="button"
                              className="toolbox-lyrics-close-btn"
                              onClick={() => setIsLyricsPanelOpen(false)}
                              aria-label="Close Lyrics Canvas"
                            >
                              <X size={12} />
                            </button>
                          </Tooltip>
                        </div>
                      </div>

                      <div className="toolbox-lyrics-tags-bar">
                        {SECTION_TAGS.map((tag) => (
                          <button
                            key={tag}
                            type="button"
                            className="toolbox-lyrics-tag-btn"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => insertSectionTag(tag)}
                          >
                            +{tag}
                          </button>
                        ))}
                      </div>

                      {!isShowingLyricsEditor && displayAlignment ? (
                        <LyricsHighlightedCanvas
                          alignment={displayAlignment}
                          selection={selection}
                          onStartEdit={(lineIdx) => startEditingLyrics(lineIdx)}
                        />
                      ) : (
                        <textarea
                          ref={lyricsCanvasRef}
                          className="toolbox-lyrics-canvas"
                          placeholder={
                            isTranscribingLyrics
                              ? 'Transcribing vocal stem in background... You can also type or edit lyrics directly.'
                              : hasExistingLyrics
                                ? 'Edit vocal lyrics...'
                                : 'Write vocal lyrics or insert section tags above (leave empty to let AI compose lyrics matching the prompt)...'
                          }
                          value={lyrics}
                          onFocus={() => setIsEditingLyricsCanvas(true)}
                          onChange={(e) => {
                            setIsEditingLyricsCanvas(true);
                            onLyricsChange(e.target.value);
                          }}
                        />
                      )}
                    </div>
                  )}
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
                            >
                              <div className="toolbox-take-meta">
                                <span className="toolbox-take-num">TK#{take.take_number}</span>
                                <span className="toolbox-take-task">{taskLabel(take.task)}</span>
                                {take.repainting_start != null && take.repainting_end != null && (
                                  <span className="toolbox-take-range">
                                    [{formatTime(take.repainting_start)}➔{formatTime(take.repainting_end)}]
                                  </span>
                                )}
                              </div>
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

          {/* Studio Vocal Language Modal */}
          <Modal
            isOpen={isLanguageModalOpen}
            onClose={() => setIsLanguageModalOpen(false)}
            title="SELECT VOCAL LANGUAGE"
          >
            <div className="studio-param-modal-content studio-lang-modal-content">
              <div className="studio-lang-search-wrap">
                <span className="studio-lang-search-icon">🔍</span>
                <input
                  type="text"
                  placeholder="SEARCH 49 LANGUAGES (E.G. JAPANESE, ES, GERMAN)..."
                  value={languageSearch}
                  onChange={(e) => setLanguageSearch(e.target.value)}
                  className="cyber-input-field studio-lang-search-input"
                  autoFocus
                />
                {languageSearch && (
                  <button
                    type="button"
                    className="studio-lang-search-clear"
                    onClick={() => setLanguageSearch('')}
                  >
                    ✕
                  </button>
                )}
              </div>

              <div className="studio-lang-scroll-body">
                {!languageSearch && (
                  <>
                    <div className="studio-lang-section-title">POPULAR LANGUAGES</div>
                    <div className="studio-lang-chips-row">
                      {POPULAR_LANGUAGES.map((lang) => {
                        const isSelected = (vocalLanguage || 'en') === lang.id;
                        return (
                          <button
                            key={lang.id}
                            type="button"
                            className={`studio-lang-chip ${isSelected ? 'active' : ''}`}
                            onClick={() => onVocalLanguageChange(lang.id)}
                          >
                            <span className="studio-lang-chip-code">{lang.id.toUpperCase()}</span>
                            <span className="studio-lang-chip-label">{lang.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}

                <div className="studio-lang-section-title">
                  {languageSearch
                    ? `MATCHING LANGUAGES (${filteredLanguages.length})`
                    : `ALL LANGUAGES (${availableLanguages.length})`}
                </div>

                <div className="studio-lang-grid">
                  {filteredLanguages.map((lang) => {
                    const isSelected = (vocalLanguage || 'en') === lang.id;
                    return (
                      <button
                        key={lang.id}
                        type="button"
                        className={`studio-lang-card ${isSelected ? 'active' : ''}`}
                        onClick={() => onVocalLanguageChange(lang.id)}
                      >
                        <span className="studio-lang-badge">{lang.id.toUpperCase()}</span>
                        <span className="studio-lang-name">{lang.label}</span>
                        {isSelected && <span className="studio-lang-check">✓</span>}
                      </button>
                    );
                  })}
                </div>

                {filteredLanguages.length === 0 && (
                  <div className="studio-lang-empty">NO LANGUAGES FOUND MATCHING "{languageSearch.toUpperCase()}"</div>
                )}
              </div>

              <div className="studio-lang-selected-strip">
                <div className="studio-field-label">
                  <span>TARGET VOCAL LANGUAGE</span>
                  <span className="studio-highlight">
                    {`${(vocalLanguage || 'en').toUpperCase()} — ${(availableLanguages.find((l) => l.id === (vocalLanguage || 'en'))?.label || vocalLanguage || 'English').toUpperCase()}`}
                  </span>
                </div>
              </div>

              <div className="studio-param-actions-row studio-lang-modal-actions">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    onVocalLanguageChange('en');
                    setIsLanguageModalOpen(false);
                  }}
                >
                  RESET TO DEFAULT (EN)
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setIsLanguageModalOpen(false)}
                >
                  APPLY LANGUAGE
                </Button>
              </div>
            </div>
          </Modal>

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
