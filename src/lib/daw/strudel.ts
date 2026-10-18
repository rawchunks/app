/**
 * Strudel Pattern Evaluator
 * Tokenizes and parses Strudel live-coding mini-notation strings.
 */

import type { BipolarPeaks } from './peaks';

export interface StrudelEvent {
  time: number; // 0.0 to 1.0 (normalized cycle time)
  duration: number; // 0.0 to 1.0 (normalized duration)
  type: 'sound' | 'note';
  value: string; // e.g. 'bd', 'sd', 'hh', 'cp', 'rim', 'synth' or note 'C3', 'E3', 'G3'
  synthSound?: string; // e.g. 'sawtooth', 'square', 'triangle', 'sine', 'supersaw'
  gain?: number;
  lpf?: number;
  hpf?: number;
  pan?: number;
  room?: number;
  delay?: number;
}

export interface ParsedStrudelPattern {
  events: StrudelEvent[];
  rateModifier: number; // Speed multiplier (1.0 = normal, 2.0 = fast, etc.)
  isReversed?: boolean;
  isValid?: boolean;
  rawCode: string;
}

function parseModifierNumber(expr: string, name: string): number | undefined {
  const regex = new RegExp(`\\.${name}\\(\\s*([-\\d.]+)\\s*\\)`);
  const m = expr.match(regex);
  if (!m) return undefined;
  const val = parseFloat(m[1]);
  return Number.isFinite(val) ? val : undefined;
}

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
 * Unwraps outer `stack(...)` calls and splits top-level code into sub-expressions
 * separated by comma `,`, newline `\n`, or semicolon `;` while preserving commas
 * inside brackets/parentheses and string quotes.
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
 * Expands Euclidean rhythm notations like `bd(3,8)` into `[bd ~ ~ bd ~ ~ bd ~]`
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

