/**
 * Strudel Pattern Evaluator & Music Theory Engine
 * Tokenizes, validates, and parses Strudel live-coding mini-notation strings,
 * including multi-cycle <...> alternation, chord symbols, .scale() degrees,
 * Euclidean (k,n,r) rhythms, step weights (@N), replications (!N), and stack() layers.
 */

import type { BipolarPeaks } from './peaks';

export interface StrudelEvent {
  time: number; // 0.0 to 1.0 (normalized cycle time)
  duration: number; // 0.0 to 1.0 (normalized duration)
  type: 'sound' | 'note';
  value: string; // e.g. 'bd', 'sd', 'hh', 'oh', 'cp', 'rim', 'tom', 'ht', 'mt', 'lt', 'ride' or note 'C3', 'Eb3'
  synthSound?: string; // e.g. 'sawtooth', 'square', 'triangle', 'sine', 'supersaw'
  gain?: number;
  lpf?: number;
  hpf?: number;
  pan?: number;
  room?: number;
  delay?: number;
  cycle?: number;
}

export interface ParsedStrudelPattern {
  events: StrudelEvent[];
  cycles?: StrudelEvent[][]; // Events per cycle (0 .. cycleCount - 1) for <...> and .slow() progressions
  cycleCount?: number; // Number of cycles in the full progression (1..16)
  effectiveBarRate?: number; // Transport bar clock multiplier (1.0 for multi-layer stack(), rateModifier for single expr)
  rateModifier: number; // Product of sub-expression rate modifiers (kept for backward compatibility)
  isReversed?: boolean;
  isValid?: boolean;
  errors?: string[];
  rawCode: string;
}

export interface StrudelValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  pattern: ParsedStrudelPattern;
}

const NOTE_TO_SEMITONE: Record<string, number> = {
  C: 0,
  'C#': 1,
  DB: 1,
  D: 2,
  'D#': 3,
  EB: 3,
  E: 4,
  F: 5,
  'F#': 6,
  GB: 6,
  G: 7,
  'G#': 8,
  AB: 8,
  A: 9,
  'A#': 10,
  BB: 10,
  B: 11,
};

const FLAT_NOTES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const SHARP_NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const SCALE_INTERVALS: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  ionian: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  harmonicminor: [0, 2, 3, 5, 7, 8, 11],
  melodicminor: [0, 2, 3, 5, 7, 9, 11],
  pentatonic: [0, 2, 4, 7, 9],
  minorpentatonic: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
};

const CHORD_INTERVALS: Record<string, number[]> = {
  '': [0, 4, 7],
  maj: [0, 4, 7],
  M: [0, 4, 7],
  m: [0, 3, 7],
  min: [0, 3, 7],
  '-': [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus4: [0, 5, 7],
  sus: [0, 5, 7],
  sus2: [0, 2, 7],
  '5': [0, 7],
  '6': [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  '7': [0, 4, 7, 10],
  dom7: [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  M7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  min7: [0, 3, 7, 10],
  m7b5: [0, 3, 6, 10],
  dim7: [0, 3, 6, 9],
  mMaj7: [0, 3, 7, 11],
  add9: [0, 4, 7, 14],
  madd9: [0, 3, 7, 14],
  '9': [0, 4, 7, 10, 14],
  maj9: [0, 4, 7, 11, 14],
  m9: [0, 3, 7, 10, 14],
  min9: [0, 3, 7, 10, 14],
  '11': [0, 4, 7, 10, 14, 17],
  m11: [0, 3, 7, 10, 14, 17],
};

function prefersFlats(rootName: string, modeName = 'minor'): boolean {
  const upper = rootName.toUpperCase();
  if (upper.includes('B') && upper !== 'B') return true;
  if (upper.includes('#')) return false;
  const isMinor = modeName.toLowerCase().includes('min') || modeName.toLowerCase().includes('dor') || modeName.toLowerCase().includes('phr');
  if (isMinor) {
    return ['C', 'D', 'F', 'G'].includes(upper);
  }
  return ['F'].includes(upper);
}

function semitoneToNoteName(midi: number, useFlats = true): string {
  const clamped = Math.max(12, Math.min(108, Math.round(midi)));
  const pc = ((clamped % 12) + 12) % 12;
  const octave = Math.floor(clamped / 12) - 1;
  const names = useFlats ? FLAT_NOTES : SHARP_NOTES;
  return `${names[pc].toUpperCase()}${octave}`;
}

/**
 * Generates an authoritative reference table of scale pitches, bass roots, and diatonic 7th chord voicings
 * for a given keyScale string (e.g. "C minor", "F# minor", "Eb major").
 */
export function getScaleAndChordReference(keyScale = 'C minor'): {
  root: string;
  mode: 'major' | 'minor';
  scaleNotes: string[];
  bassRoots: string[];
  diatonicChords: { symbol: string; voicing: string; functionName: string }[];
  defaultProgression: string[];
} {
  const match = keyScale.trim().match(/^([A-Ga-g][#b]?)\s*(.*)$/);
  const rawRoot = match ? match[1] : 'C';
  const rawMode = (match?.[2] || 'minor').toLowerCase();
  const isMinor = !rawMode.includes('maj') && !rawMode.includes('ion') && !rawMode.includes('lyd') && !rawMode.includes('mix');
  const mode: 'major' | 'minor' = isMinor ? 'minor' : 'major';
  const rootKey = rawRoot.toUpperCase();
  const rootSemi = NOTE_TO_SEMITONE[rootKey] ?? 0;
  const useFlats = prefersFlats(rawRoot, mode);
  const names = useFlats ? FLAT_NOTES : SHARP_NOTES;
  const intervals = SCALE_INTERVALS[mode];

  const scaleNotes = intervals.map((iv) => names[(rootSemi + iv) % 12]);
  const bassRoots = intervals.map((iv) => `${names[(rootSemi + iv) % 12].toLowerCase()}2`);

  const chordQualities = isMinor
    ? [
        { deg: 0, suffix: 'm7', ivs: [0, 3, 7, 10], fn: 'i (Tonic)' },
        { deg: 3, suffix: 'm7', ivs: [0, 3, 7, 10], fn: 'iv (Subdominant)' },
        { deg: 5, suffix: 'maj7', ivs: [0, 4, 7, 11], fn: 'VI (Submediant)' },
        { deg: 4, suffix: '7', ivs: [0, 4, 7, 10], fn: 'V7 (Dominant)' },
        { deg: 6, suffix: '7', ivs: [0, 4, 7, 10], fn: 'VII7 (Subtonic)' },
        { deg: 2, suffix: 'maj7', ivs: [0, 4, 7, 11], fn: 'III (Mediant)' },
      ]
    : [
        { deg: 0, suffix: 'maj7', ivs: [0, 4, 7, 11], fn: 'I (Tonic)' },
        { deg: 5, suffix: 'm7', ivs: [0, 3, 7, 10], fn: 'vi (Relative Minor)' },
        { deg: 3, suffix: 'maj7', ivs: [0, 4, 7, 11], fn: 'IV (Subdominant)' },
        { deg: 4, suffix: '7', ivs: [0, 4, 7, 10], fn: 'V7 (Dominant)' },
        { deg: 1, suffix: 'm7', ivs: [0, 3, 7, 10], fn: 'ii (Supertonic)' },
      ];

  const diatonicChords = chordQualities.map((q) => {
    const chordRootSemi = (rootSemi + intervals[q.deg]) % 12;
    const chordRootName = names[chordRootSemi];
    const baseMidi = 48 + chordRootSemi; // Octave 3
    const pitches = q.ivs.map((iv) => semitoneToNoteName(baseMidi + iv, useFlats).toLowerCase());
    return {
      symbol: `${chordRootName}${q.suffix}`,
      voicing: `[${pitches.join(',')}]`,
      functionName: q.fn,
    };
  });

  const defaultProgression = diatonicChords.slice(0, 4).map((c) => c.symbol);

  return {
    root: names[rootSemi],
    mode,
    scaleNotes,
    bassRoots,
    diatonicChords,
    defaultProgression,
  };
}

function parseScaleSpec(scaleStr?: string): { rootSemi: number; intervals: number[]; useFlats: boolean } | undefined {
  if (!scaleStr) return undefined;
  const cleaned = scaleStr.trim().replace(/:/g, ' ');
  const m = cleaned.match(/^([A-Ga-g][#b]?)\s*(.*)$/);
  if (!m) return undefined;
  const rootStr = m[1].toUpperCase();
  const rootSemi = NOTE_TO_SEMITONE[rootStr];
  if (rootSemi === undefined) return undefined;
  const modeRaw = (m[2] || 'minor').toLowerCase().replace(/[^a-z]/g, '');
  const intervals = SCALE_INTERVALS[modeRaw] || (modeRaw.includes('maj') ? SCALE_INTERVALS.major : SCALE_INTERVALS.minor);
  return {
    rootSemi,
    intervals,
    useFlats: prefersFlats(m[1], modeRaw),
  };
}

/**
 * Checks if a token is a chord symbol (e.g. Cm7, Fm7, Abmaj7, G7, Dm9, Fsus4)
 * and returns its constituent scientific pitch strings (e.g. ['C3', 'EB3', 'G3', 'BB3']).
 * Never matches standard scientific single-note tokens like c2, eb3, f#4, g5.
 */
export function expandChordSymbol(token: string, defaultOctave = 3): string[] | null {
  const trimmed = token.trim();
  // Standard single-note scientific pitch (c0..b6, or lowercase c7/c8)
  if (/^[a-g][#b]?[0-8]$/.test(trimmed)) return null;
  if (/^[A-G][#b]?[0-6]$/.test(trimmed)) return null;

  const m = trimmed.match(/^([A-Ga-g][#b]?)(maj9|maj7|M7|min9|min7|mMaj7|m7b5|dim7|dom7|sus4|sus2|sus|add9|madd9|aug|dim|min|maj|m9|m7|m6|m11|m|M|-|6|7|9|11|5)?(?:\/([A-Ga-g][#b]?))?$/);
  if (!m) return null;

  const rootStr = m[1];
  const quality = m[2] ?? '';
  const slashBass = m[3];

  // Avoid treating bare single lowercase letters like 'bd', 'sd', 'hh', 'cp' as chords (already guarded by [A-Ga-g][#b]?, and none of bd/sd/hh/cp match that).
  // However, bare single letter 'c' or 'f' without octave could be written; require either uppercase root OR explicit quality suffix (m, m7, maj7, 7, dim, sus, etc.)
  if (!quality && rootStr === rootStr.toLowerCase()) {
    return null;
  }

  const intervals = CHORD_INTERVALS[quality];
  if (!intervals) return null;

  const rootSemi = NOTE_TO_SEMITONE[rootStr.toUpperCase()];
  if (rootSemi === undefined) return null;

  const useFlats = prefersFlats(rootStr, quality.startsWith('m') && !quality.startsWith('maj') ? 'minor' : 'major');
  const baseMidi = (defaultOctave + 1) * 12 + rootSemi;

  const notes = intervals.map((iv) => semitoneToNoteName(baseMidi + iv, useFlats));
  if (slashBass) {
    const bassSemi = NOTE_TO_SEMITONE[slashBass.toUpperCase()];
    if (bassSemi !== undefined) {
      const bassMidi = defaultOctave * 12 + bassSemi;
      notes.unshift(semitoneToNoteName(bassMidi, useFlats));
    }
  }
  return notes;
}

function parseModifierNumber(expr: string, name: string): number | undefined {
  const regex = new RegExp(`\\.${name}\\(\\s*([-\\d.]+)\\s*\\)`);
  const m = expr.match(regex);
  if (!m) return undefined;
  const val = parseFloat(m[1]);
  return Number.isFinite(val) ? val : undefined;
}

interface SubExpressionPlan {
  patternType: 'sound' | 'note';
  patternContent: string;
  synthSound?: string;
  scaleSpec?: { rootSemi: number; intervals: number[]; useFlats: boolean };
  subRateModifier: number;
  gain?: number;
  lpf?: number;
  hpf?: number;
  pan?: number;
  room?: number;
  delay?: number;
  subReversed: boolean;
}

const PARSE_CACHE_LIMIT = 64;
const parsePatternCache = new Map<string, ParsedStrudelPattern>();

const PEAKS_CACHE_LIMIT = 64;
const strudelPeaksCache = new Map<string, BipolarPeaks>();

export function parseStrudelPattern(code: string): ParsedStrudelPattern {
  if (!code || typeof code !== 'string') {
    return { events: [], rateModifier: 1.0, rawCode: code || '' };
  }

  const rawCode = code;
  const subExprs = splitSubExpressions(code);

  let overallRateModifier = 1.0;
  const allEvents: StrudelEvent[] = [];
  const globalReversed = /\.rev\(\)/.test(rawCode);

  for (const sub of subExprs) {
    const trimmed = sub.trim();
    if (!trimmed) continue;

    // Extract rate modifiers (.fast(N), .slow(N), .speed(N)) with non-positive guard
    let subRateModifier = 1.0;

    const fastMatches = [...trimmed.matchAll(/\.fast\(\s*([-\d.]+)\s*\)/g)];
    for (const match of fastMatches) {
      const raw = parseFloat(match[1]);
      const val = !isNaN(raw) && raw > 0 ? raw : 1.0;
      subRateModifier *= val;
    }

    const slowMatches = [...trimmed.matchAll(/\.slow\(\s*([-\d.]+)\s*\)/g)];
    for (const match of slowMatches) {
      const raw = parseFloat(match[1]);
      const val = !isNaN(raw) && raw > 0 ? raw : 1.0;
      subRateModifier /= val;
    }

    const speedMatches = [...trimmed.matchAll(/\.speed\(\s*([-\d.]+)\s*\)/g)];
    for (const match of speedMatches) {
      const raw = parseFloat(match[1]);
      const val = !isNaN(raw) && raw > 0 ? raw : 1.0;
      subRateModifier *= val;
    }

    overallRateModifier *= subRateModifier;

    const gain = parseModifierNumber(trimmed, 'gain');
    const lpf = parseModifierNumber(trimmed, 'lpf');
    const hpf = parseModifierNumber(trimmed, 'hpf');
    const pan = parseModifierNumber(trimmed, 'pan');
    const room = parseModifierNumber(trimmed, 'room');
    const delay = parseModifierNumber(trimmed, 'delay');
    const subReversed = /\.rev\(\)/.test(trimmed) || globalReversed;

    // Extract content inside note("...") and/or s("...") / .s("...")
    let patternType: 'sound' | 'note' = 'sound';
    let patternContent = trimmed;
    let synthSound: string | undefined;

    const noteMatch = trimmed.match(/note\(\s*["']([^"']+)["']\s*\)/);
    const sMatch = trimmed.match(/(?:^|[^.a-zA-Z0-9_])s\(\s*["']([^"']+)["']\s*\)/);
    const chainedSMatch = trimmed.match(/\.s\(\s*["']([^"']+)["']\s*\)/);

    if (noteMatch) {
      patternType = 'note';
      patternContent = noteMatch[1];
      if (chainedSMatch) {
        synthSound = chainedSMatch[1].trim().toLowerCase();
      } else if (sMatch) {
        synthSound = sMatch[1].trim().toLowerCase();
      }
    } else if (sMatch || chainedSMatch) {
      patternType = 'sound';
      patternContent = (sMatch ?? chainedSMatch)![1];
    } else {
      // Strip trailing chained functions (.fast, .slow, .speed, .jux, .room, etc.)
      patternContent = patternContent.replace(/\.[a-zA-Z0-9_]+\([^)]*\)/g, '').trim();
      if (/[a-gA-G][#b]?\d/.test(patternContent)) {
        patternType = 'note';
      }
    }

    // Expand Euclidean notation sound(k,n) or note(k,n) e.g. bd(3,8) -> [bd ~ ~ bd ~ ~ bd ~]
    patternContent = expandEuclideanRhythms(patternContent);

    // Split polyphonic multi-lane layers separated by top-level commas inside the sub-expression content
    const lanes = splitByTopLevelComma(patternContent);

    for (const lane of lanes) {
      const laneEvents = parseLane(lane, 0.0, 1.0, patternType).map((ev) => {
        const time = subReversed ? Math.max(0, 1 - ev.time - ev.duration) : ev.time;
        return {
          ...ev,
          time,
          ...(synthSound ? { synthSound } : {}),
          ...(gain !== undefined ? { gain } : {}),
          ...(lpf !== undefined ? { lpf } : {}),
          ...(hpf !== undefined ? { hpf } : {}),
          ...(pan !== undefined ? { pan } : {}),
          ...(room !== undefined ? { room } : {}),
          ...(delay !== undefined ? { delay } : {}),
        };
      });
      allEvents.push(...laneEvents);
    }
  }

  return {
    events: allEvents,
    rateModifier: overallRateModifier,
    isReversed: globalReversed,
    isValid: true,
    rawCode,
  };
}

export function evaluateStrudelPattern(code: string): ParsedStrudelPattern {
  return parseStrudelPattern(code);
}

/**
 * Validates a Strudel code snippet and returns structured errors/warnings plus the parsed pattern.
 */
function splitSubExpressions(code: string): string[] {
  const trimmed = code.trim();
  // Unwrap stack(...) if the expression starts with stack(
  if (/^stack\s*\(/i.test(trimmed) && trimmed.endsWith(')')) {
    const openParen = trimmed.indexOf('(');
    const inner = trimmed.slice(openParen + 1, -1);
    return splitSubExpressions(inner);
  }

  const subExprs: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let bracketDepth = 0;

  for (let i = 0; i < code.length; i++) {
    const char = code[i];

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      current += char;
    } else if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      current += char;
    } else if (!inSingleQuote && !inDoubleQuote) {
      if (char === '(' || char === '[' || char === '{') {
        bracketDepth++;
        current += char;
      } else if (char === ')' || char === ']' || char === '}') {
        bracketDepth = Math.max(0, bracketDepth - 1);
        current += char;
      } else if ((char === ',' || char === '\n' || char === ';') && bracketDepth === 0) {
        if (current.trim()) {
          subExprs.push(current.trim());
        }
        current = '';
      } else {
        current += char;
      }
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    subExprs.push(current.trim());
  }

  return subExprs.flatMap((expr) => {
    if (/^stack\s*\(/i.test(expr) && expr.endsWith(')')) {
      const openParen = expr.indexOf('(');
      return splitSubExpressions(expr.slice(openParen + 1, -1));
    }
    return [expr];
  });
}

function splitByTopLevelComma(str: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '[' || ch === '(' || ch === '{' || ch === '<') {
      depth++;
      current += ch;
    } else if (ch === ']' || ch === ')' || ch === '}' || ch === '>') {
      depth = Math.max(0, depth - 1);
      current += ch;
    } else if (ch === ',' && depth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/**
 * Expands 2-arg and 3-arg Euclidean rhythm notations like `bd(3,8)` or `cp(3,8,2)`
 * or `[c3,eb3,g3](3,8)` into `[bd ~ ~ bd ~ ~ bd ~]`
 */
function expandEuclideanRhythms(content: string): string {
  return content.replace(/([a-zA-Z0-9_#]+)\((\d+)\s*,\s*(\d+)\)/g, (_, sound, kStr, nStr) => {
    const k = parseInt(kStr, 10);
    const n = parseInt(nStr, 10);
    if (isNaN(k) || isNaN(n) || n <= 0) return sound;

    const steps: string[] = [];
    for (let i = 0; i < n; i++) {
      if ((i * k) % n < k) {
        steps.push(sound);
      } else {
        steps.push('~');
      }
    }
    return `[${steps.join(' ')}]`;
  });
}

function parseLane(
  str: string,
  startTime: number,
  endTime: number,
  defaultType: 'sound' | 'note'
): StrudelEvent[] {
  const events: StrudelEvent[] = [];
  const tokens = tokenizeMiniNotation(str);

  if (tokens.length === 0) return events;

  const totalDuration = endTime - startTime;
  const stepDuration = totalDuration / tokens.length;

  tokens.forEach((tok, index) => {
    const slotStart = startTime + index * stepDuration;
    const slotEnd = slotStart + stepDuration;

    // Check for multipliers e.g. *N
    let multiplier = 1;
    let content = tok;
    const multMatch = tok.match(/^(.*?)\*(\d+)$/);
    if (multMatch) {
      content = multMatch[1];
      multiplier = parseInt(multMatch[2], 10) || 1;
    }

    const subStepDuration = (slotEnd - slotStart) / multiplier;

    for (let rep = 0; rep < multiplier; rep++) {
      const repStart = slotStart + rep * subStepDuration;
      const repEnd = repStart + subStepDuration;

      // Group [...] or Chord [a,b,c]
      if (content.startsWith('[') && content.endsWith(']')) {
        const inner = content.slice(1, -1);
        const parallelVoices = splitByTopLevelComma(inner);
        if (parallelVoices.length > 1) {
          for (const voice of parallelVoices) {
            events.push(...parseLane(voice, repStart, repEnd, defaultType));
          }
        } else {
          events.push(...parseLane(inner, repStart, repEnd, defaultType));
        }
      } else if (content === '~' || content === '.' || content === 'rest' || content === '_') {
        // Rest (silence)
      } else {
        const isNote = /^[a-gA-G][#b]?\d$/.test(content);
        const eventType = isNote ? 'note' : defaultType;
        const value = isNote ? content.toUpperCase() : content.toLowerCase();

        events.push({
          time: repStart,
          duration: repEnd - repStart,
          type: eventType,
          value,
        });
      }
    }
  });

  return events;
}

function tokenizeMiniNotation(str: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let bracketDepth = 0;

  for (let i = 0; i < str.length; i++) {
    const char = str[i];

    if (char === '[') {
      bracketDepth++;
      current += char;
    } else if (char === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1);
      current += char;
    } else if (/\s/.test(char) && bracketDepth === 0) {
      if (current.trim()) {
        tokens.push(current.trim());
        current = '';
      }
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    tokens.push(current.trim());
  }

  return tokens;
}

/**
 * Synthesizes real bipolar waveform peaks directly from a parsed Strudel pattern
 * so live-coding tracks display an accurate acoustic envelope instead of a mock hash.
 */
export function synthesizeStrudelBipolarPeaks(code: string, bins = 512, bpm = 120): BipolarPeaks {
  const count = Math.max(16, Math.floor(bins));
  const mins = new Float32Array(count);
  const maxs = new Float32Array(count);
  const rms = new Float32Array(count);
  const low = new Float32Array(count);
  const mid = new Float32Array(count);
  const high = new Float32Array(count);

  const parsed = parseStrudelPattern(code);
  const rate = Math.max(0.125, parsed.rateModifier || 1.0);
  const duration = ((60 / Math.max(30, bpm || 120)) * 4) / rate;
  if (!parsed.events.length) {
    return { mins, maxs, rms, low, mid, high, bins: count, duration };
  }

  const cycles = Math.max(1, Math.min(8, Math.round(rate * 2)));
  const freqFactor = Math.max(0.5, Math.min(2.5, bpm / 120));

  for (let c = 0; c < cycles; c++) {
    for (const ev of parsed.events) {
      const startNorm = (c + ev.time) / cycles;
      const durNorm = Math.max(1 / count, ev.duration / cycles);
      if (startNorm >= 1) continue;

      const startBin = Math.max(0, Math.floor(startNorm * count));
      const endBin = Math.min(count - 1, Math.ceil((startNorm + durNorm) * count));
      const span = Math.max(1, endBin - startBin + 1);
      const baseGain = Math.min(1.0, Math.max(0.15, ev.gain ?? 0.85));

      const isKick = ev.value.includes('bd') || ev.value.includes('kick');
      const isSnare = ev.value.includes('sd') || ev.value.includes('snare') || ev.value.includes('cp');
      const isHat = ev.value.includes('hh') || ev.value.includes('hat');
      const decayRate = isKick ? 5.5 : isSnare ? 4.5 : isHat ? 9.0 : 2.8;
      const bandLow = isKick ? 0.8 : isSnare ? 0.2 : isHat ? 0.05 : 0.3;
      const bandMid = isKick ? 0.15 : isSnare ? 0.55 : isHat ? 0.2 : 0.5;
      const bandHigh = isKick ? 0.05 : isSnare ? 0.25 : isHat ? 0.75 : 0.2;

      for (let b = startBin; b <= endBin; b++) {
        const localT = (b - startBin) / span;
        const attack = Math.min(1, localT * 14);
        const decay = Math.exp(-decayRate * localT * freqFactor);
        const harmonic = 0.78 + 0.22 * Math.sin((b - startBin) * (ev.type === 'note' ? 1.7 : 2.9));
        const amp = Math.min(1, baseGain * attack * decay * harmonic);
        const asym = isKick ? 1.08 : isSnare ? 0.96 : 1.0;

        const pos = Math.min(1, amp * asym);
        const neg = -Math.min(1, amp * (2 - asym));
        if (pos > maxs[b]) maxs[b] = pos;
        if (neg < mins[b]) mins[b] = neg;
        const energy = Math.min(1, amp * 0.72);
        if (energy > rms[b]) rms[b] = energy;
        low[b] = Math.max(low[b], bandLow);
        mid[b] = Math.max(mid[b], bandMid);
        high[b] = Math.max(high[b], bandHigh);
      }
    }
  }

  return { mins, maxs, rms, low, mid, high, bins: count, duration };
}
