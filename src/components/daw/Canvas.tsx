import React, { useState, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import { useDawStore, type LyricsAlignment, type AlignedLine, type AlignedWord } from '../../lib/daw/store';
import { dawEngine } from '../../lib/daw/engine';
import {
  DEFAULT_WAVE_SCULPT,
  mapPlayheadTimeToSourceTime,
  mapSourceTimeToPlayheadTime,
} from '../../lib/daw/peaks';
import { CheckCircle2, Check, Pencil, Loader2, X } from 'lucide-react';
import { Tooltip } from './Tooltip';
import { Languages } from '../languages';

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
  const tracks = useDawStore((s) => s.tracks);
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

  const vocalTrack = useMemo(
    () =>
      tracks.find(
        (t) =>
          ['vocals', 'backing_vocals'].includes((t.stemType || t.name || '').toLowerCase()) &&
          t.clips.length > 0,
      ) ||
      tracks.find((t) => t.id === 'master') ||
      tracks[0],
    [tracks],
  );
  const activeSculpt = vocalTrack?.sculpt || DEFAULT_WAVE_SCULPT;
  const clipStart = vocalTrack?.clips[0]?.startTime ?? 0;
  const clipDuration = vocalTrack?.clips[0]?.duration || totalTimelineDuration || 60;
  const sourcePlayhead = useMemo(
    () => mapPlayheadTimeToSourceTime(playhead, clipStart, clipDuration, activeSculpt),
    [playhead, clipStart, clipDuration, activeSculpt],
  );

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
        sourcePlayhead >= l.start &&
        sourcePlayhead <= l.end + 0.15,
    );
  }, [alignment.lines, sourcePlayhead]);

  const selectedLineIndices = useMemo(() => {
    if (!selection) return new Set<number>();
    const selStart = mapPlayheadTimeToSourceTime(selection.start, clipStart, clipDuration, activeSculpt);
    const selEnd = mapPlayheadTimeToSourceTime(selection.end, clipStart, clipDuration, activeSculpt);
    const indices = new Set<number>();
    alignment.lines.forEach((line, idx) => {
      if (
        !line.isTag &&
        line.start !== null &&
        line.end !== null &&
        line.end >= selStart &&
        line.start <= selEnd
      ) {
        indices.add(idx);
        if (idx > 0 && alignment.lines[idx - 1]?.isTag) {
          indices.add(idx - 1);
        }
      }
    });
    return indices;
  }, [alignment.lines, selection, clipStart, clipDuration, activeSculpt]);

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

  useEffect(() => {
    if (activeLineIndex >= 0 && activeLineIndex !== lastScrolledPlayLineRef.current) {
      lastScrolledPlayLineRef.current = activeLineIndex;
      scrollLineIntoContainer(activeLineIndex);
    }
  }, [activeLineIndex]);

  useEffect(() => {
    if (!selection) {
      lastSelectionKeyRef.current = '';
      return;
    }
    const key = `${selection.start.toFixed(2)}-${selection.end.toFixed(2)}-${alignment.lines.length}`;
    if (key === lastSelectionKeyRef.current) return;
    lastSelectionKeyRef.current = key;
    if (isPlaying) return;
    const selStart = mapPlayheadTimeToSourceTime(selection.start, clipStart, clipDuration, activeSculpt);
    const selEnd = mapPlayheadTimeToSourceTime(selection.end, clipStart, clipDuration, activeSculpt);
    const firstSungIdx = alignment.lines.findIndex(
      (l) =>
        !l.isTag &&
        l.start !== null &&
        l.end !== null &&
        l.end >= selStart &&
        l.start <= selEnd,
    );
    if (firstSungIdx >= 0) {
      const timer = setTimeout(() => scrollLineIntoContainer(firstSungIdx), 40);
      return () => clearTimeout(timer);
    }
  }, [selection, alignment.lines, isPlaying, clipStart, clipDuration, activeSculpt]);

  const handleSeek = (sec: number | null | undefined) => {
    if (typeof sec !== 'number' || !Number.isFinite(sec)) return;
    const clamped = mapSourceTimeToPlayheadTime(
      Math.max(0, sec),
      clipStart,
      clipDuration,
      activeSculpt,
    );
    dawEngine.seek(clamped);
    useDawStore.getState().setPlayhead(clamped);
  };

  return (
    <div className="toolbox-lyrics-canvas-wrapper">
      {selection && (
        <div className="toolbox-lyrics-selection-banner">
          <span className="toolbox-lyrics-selection-badge">
            SEGMENT [{formatSyncTimestamp(selection.start)} – {formatSyncTimestamp(selection.end)}]
          </span>
          <span className="toolbox-lyrics-selection-count">
            {selectedLineIndices.size > 0 ? 'SELECTED' : 'INSTRUMENTAL'}
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
                    {formatSyncTimestamp(mapSourceTimeToPlayheadTime(line.start, clipStart, clipDuration, activeSculpt))}
                  </span>
                )}
                {isInSelection && <span className="toolbox-lyrics-sync-sel-pill">SELECTED</span>}
              </div>
            );
          }

          const isActiveLine = lineIdx === activeLineIndex;
          const isPastLine = line.end !== null && sourcePlayhead > line.end + 0.15;

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
                      sourcePlayhead >= word.start && sourcePlayhead <= word.end + 0.08;
                    const isPastWord = sourcePlayhead > word.end + 0.08;
                    const selStart = selection
                      ? mapPlayheadTimeToSourceTime(selection.start, clipStart, clipDuration, activeSculpt)
                      : 0;
                    const selEnd = selection
                      ? mapPlayheadTimeToSourceTime(selection.end, clipStart, clipDuration, activeSculpt)
                      : 0;
                    const isWordInSelection = Boolean(
                      selection && word.end >= selStart && word.start <= selEnd,
                    );
                    const warpedWordStart = mapSourceTimeToPlayheadTime(word.start, clipStart, clipDuration, activeSculpt);
                    const warpedWordEnd = mapSourceTimeToPlayheadTime(word.end, clipStart, clipDuration, activeSculpt);
                    return (
                      <span
                        key={`w-${lineIdx}-${wIdx}-${word.start}`}
                        className={`toolbox-lyrics-sync-word ${isActiveWord ? 'is-active-word' : ''} ${isPastWord ? 'is-past-word' : ''} ${isWordInSelection ? 'is-in-selection' : ''}`}
                        onClick={() => handleSeek(word.start)}
                        title={`${word.text} [${formatSyncTimestamp(warpedWordStart)} – ${formatSyncTimestamp(warpedWordEnd)}]`}
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
                title={`Seek playhead to ${formatSyncTimestamp(line.start !== null ? mapSourceTimeToPlayheadTime(line.start, clipStart, clipDuration, activeSculpt) : null)}`}
              >
                {formatSyncTimestamp(line.start !== null ? mapSourceTimeToPlayheadTime(line.start, clipStart, clipDuration, activeSculpt) : null)}
              </span>
            </div>
          );
        })}
      </div>

      <div className="toolbox-lyrics-sidepanel-footer">
        <Tooltip title="Double-click any lyric line to edit">
          <span>EDIT</span>
        </Tooltip>
        <span
          className={`toolbox-lyrics-footer-time ${isPlaying ? 'is-active' : selection ? 'is-segment' : ''
            }`}
        >
          {footerTimeLabel}
        </span>
      </div>
    </div>
  );
};

export interface CanvasProps {
  lyrics: string;
  onLyricsChange: (lyrics: string) => void;
  vocalLanguage: string;
  onVocalLanguageChange: (language: string) => void;
  languages?: Array<{ id: string; label: string }>;
  hasExistingLyrics?: boolean;
  isTranscribingLyrics?: boolean;
  onExtractLyrics?: () => void;
  lyricsAlignment?: LyricsAlignment | null;
  isAligningLyrics?: boolean;
  onAlignLyrics?: (customLyrics?: string) => void;
  processing?: boolean;
  onClose?: () => void;
  mode?: 'dock' | 'overlay';
  autoEdit?: boolean;
}

export const Canvas: React.FC<CanvasProps> = ({
  lyrics,
  onLyricsChange,
  vocalLanguage,
  onVocalLanguageChange,
  languages,
  hasExistingLyrics = false,
  isTranscribingLyrics = false,
  onExtractLyrics,
  lyricsAlignment = null,
  isAligningLyrics = false,
  onAlignLyrics,
  processing = false,
  onClose,
  mode = 'dock',
  autoEdit = false,
}) => {
  const selection = useDawStore((s) => s.selection);
  const isPlaying = useDawStore((s) => s.isPlaying);
  const [isEditingLyricsCanvas, setIsEditingLyricsCanvas] = useState<boolean>(autoEdit || mode === 'overlay');
  const [isLanguageModalOpen, setIsLanguageModalOpen] = useState<boolean>(false);
  const lyricsCanvasRef = useRef<HTMLTextAreaElement | null>(null);

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

    const storeState = useDawStore.getState();
    const vocalOrMaster =
      storeState.tracks.find((t) => (t.stemType || t.name || '').toLowerCase() === 'vocals' && !t.muted) ||
      storeState.tracks.find((t) => t.id === 'master') ||
      storeState.tracks[0];
    const activeClip = vocalOrMaster?.clips?.[0];
    const activeSculpt = activeClip?.sculpt || vocalOrMaster?.sculpt;
    const clipStart = activeClip?.startTime || 0;
    const clipDuration = activeClip?.duration || storeState.duration || 0;

    if (typeof preferredLineIdx === 'number' && preferredLineIdx >= 0) {
      targetStartIdx = preferredLineIdx;
      targetEndIdx = preferredLineIdx;
    } else if (selection && alignLines.length > 0) {
      const selStart = mapPlayheadTimeToSourceTime(selection.start, clipStart, clipDuration, activeSculpt);
      const selEnd = mapPlayheadTimeToSourceTime(selection.end, clipStart, clipDuration, activeSculpt);
      const overlapping: number[] = [];
      alignLines.forEach((l, idx) => {
        if (!l.isTag && l.start !== null && l.end !== null && l.end >= selStart && l.start <= selEnd) {
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
            const dist = Math.abs(l.start - selStart);
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
      const rawPh = storeState.playhead;
      const ph = mapPlayheadTimeToSourceTime(rawPh, clipStart, clipDuration, activeSculpt);
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

  useEffect(() => {
    if (autoEdit || mode === 'overlay') {
      startEditingLyrics();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoEdit, mode]);

  const finishEditingLyrics = () => {
    pendingEditTargetRef.current = null;
    setIsEditingLyricsCanvas(false);
    if (isLyricsDirty && onAlignLyrics && lyrics.trim().length > 0) {
      onAlignLyrics(lyrics);
    }
  };

  const isShowingLyricsEditor = isEditingLyricsCanvas || !displayAlignment;

  useEffect(() => {
    if (
      mode !== 'overlay' &&
      lyricsAlignment &&
      Array.isArray(lyricsAlignment.lines) &&
      lyricsAlignment.lines.length > 0
    ) {
      setIsEditingLyricsCanvas(false);
    }
  }, [lyricsAlignment?.updatedAt, lyricsAlignment?.lines?.length, mode]);

  const prevIsPlayingRef = useRef(isPlaying);
  useEffect(() => {
    const startedPlaying = !prevIsPlayingRef.current && isPlaying;
    prevIsPlayingRef.current = isPlaying;
    if (startedPlaying && displayAlignment && mode !== 'overlay') {
      setIsEditingLyricsCanvas(false);
    }
  }, [isPlaying, displayAlignment, mode]);

  const prevSelectionRef = useRef<{ start: number; end: number } | null>(selection);
  useEffect(() => {
    const prev = prevSelectionRef.current;
    const selectionChanged =
      prev?.start !== selection?.start || prev?.end !== selection?.end;
    prevSelectionRef.current = selection;
    if (selectionChanged && selection && displayAlignment && mode !== 'overlay') {
      setIsEditingLyricsCanvas(false);
    }
  }, [selection, displayAlignment, mode]);

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

  const dockRef = useRef<HTMLElement | null>(null);

  const handleDockResizeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    const target = e.currentTarget;
    try {
      target.setPointerCapture(e.pointerId);
    } catch { }
    const startX = e.clientX;
    const startW = dockRef.current?.offsetWidth || 190;

    const onMove = (moveEv: PointerEvent) => {
      if (!dockRef.current) return;
      const deltaX = startX - moveEv.clientX;
      const nextW = Math.max(148, Math.min(280, startW + deltaX));
      dockRef.current.style.setProperty('--canvas-dock-w', `${nextW}px`);
    };

    const onUp = (upEv: PointerEvent) => {
      try {
        if (target.hasPointerCapture(upEv.pointerId)) {
          target.releasePointerCapture(upEv.pointerId);
        }
      } catch { }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  return (
    <aside
      ref={dockRef}
      className={`toolbox-lyrics-sidepanel ${mode === 'overlay' ? 'is-overlay-mode' : 'board-canvas-dock'}`}
      aria-label="Lyrics Canvas"
    >
      {mode === 'dock' && (
        <div
          className="canvas-dock-resizer"
          onPointerDown={handleDockResizeDown}
          title="Drag horizontally to resize Lyrics Canvas width"
        />
      )}
      <div className="toolbox-lyrics-sidepanel-header">
        <div className="toolbox-lyrics-sidepanel-title-wrap">
          <span className="toolbox-lyrics-sidepanel-title">
            {mode === 'overlay' ? 'LYRICS & STRUCTURE' : 'CANVAS'}
          </span>
        </div>
        <div className="toolbox-lyrics-sidepanel-actions">
          {mode === 'overlay' ? (
            <>
              <Tooltip title={isShowingLyricsEditor ? 'Switch to synced timeline view' : 'Edit lyrics text'}>
                <button
                  type="button"
                  className={`toolbox-lyrics-mode-btn is-overlay-toggle ${isShowingLyricsEditor ? 'active' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isShowingLyricsEditor && displayAlignment) {
                      finishEditingLyrics();
                    } else {
                      startEditingLyrics();
                    }
                  }}
                  aria-label="Edit lyrics"
                >
                  <Pencil size={12} />
                  <span>EDIT</span>
                </button>
              </Tooltip>
              <Tooltip title="Save & finish editing">
                <button
                  type="button"
                  className="toolbox-lyrics-mode-btn is-overlay-done"
                  onClick={(e) => {
                    e.stopPropagation();
                    finishEditingLyrics();
                    if (onClose) onClose();
                  }}
                  aria-label="Done editing"
                >
                  <Check size={12} />
                  <span>DONE</span>
                </button>
              </Tooltip>
            </>
          ) : (
            <>
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
              {renderUnifiedLyricsSyncIcon()}
              {displayAlignment && (
                <Tooltip title={isShowingLyricsEditor ? 'Switch to synced timeline view' : 'Edit lyrics text'}>
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
              {onClose && (
                <Tooltip title="Close Canvas">
                  <button
                    type="button"
                    className="toolbox-lyrics-close-btn"
                    onClick={onClose}
                    aria-label="Close Canvas"
                  >
                    <X size={12} />
                  </button>
                </Tooltip>
              )}
            </>
          )}
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

      <Languages
        isOpen={isLanguageModalOpen}
        onClose={() => setIsLanguageModalOpen(false)}
        value={vocalLanguage}
        onChange={(val) => onVocalLanguageChange(val || 'en')}
        languages={languages}
        allowAuto={false}
      />
    </aside>
  );
};
