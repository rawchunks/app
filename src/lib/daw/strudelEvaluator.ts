/**
 * Strudel Pattern Evaluator
 * Tokenizes and parses Strudel live-coding mini-notation strings.
 */

export interface StrudelEvent {
  time: number; // 0.0 to 1.0 (normalized cycle time)
  duration: number; // 0.0 to 1.0 (normalized duration)
  type: 'sound' | 'note';
  value: string; // e.g. 'bd', 'sd', 'hh', 'cp', 'rim', 'synth' or note 'C3', 'E3', 'G3'
}

export interface ParsedStrudelPattern {
  events: StrudelEvent[];
  rateModifier: number; // Speed multiplier (1.0 = normal, 2.0 = fast, etc.)
  isReversed?: boolean;
  isValid?: boolean;
  rawCode: string;
}

export function parseStrudelPattern(code: string): ParsedStrudelPattern {
  if (!code || typeof code !== 'string') {
    return { events: [], rateModifier: 1.0, rawCode: code || '' };
  }

  const rawCode = code;
  const subExprs = splitSubExpressions(code);

  let overallRateModifier = 1.0;
  const allEvents: StrudelEvent[] = [];

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

    // Extract content inside s("...") or note("...")
    let patternType: 'sound' | 'note' = 'sound';
    let patternContent = trimmed;

    const sMatch = trimmed.match(/s\(\s*["']([^"']+)["']\s*\)/);
    const noteMatch = trimmed.match(/note\(\s*["']([^"']+)["']\s*\)/);

    if (sMatch) {
      patternType = 'sound';
      patternContent = sMatch[1];
    } else if (noteMatch) {
      patternType = 'note';
      patternContent = noteMatch[1];
    } else {
      // Strip trailing chained functions (.fast, .slow, .speed, .jux, .room, etc.)
      patternContent = patternContent.replace(/\.[a-zA-Z0-9_]+\([^)]*\)/g, '').trim();
      if (/[a-gA-G][#b]?\d/.test(patternContent)) {
        patternType = 'note';
      }
    }

    // Expand Euclidean notation sound(k,n) or note(k,n) e.g. bd(3,8) -> [bd ~ ~ bd ~ ~ bd ~]
    patternContent = expandEuclideanRhythms(patternContent);

    // Split polyphonic multi-lane layers separated by commas inside the sub-expression content
    const lanes = patternContent.split(',').map((l) => l.trim()).filter(Boolean);

    for (const lane of lanes) {
      const laneEvents = parseLane(lane, 0.0, 1.0, patternType);
      allEvents.push(...laneEvents);
    }
  }

  const isReversed = /\.rev\(\)/.test(rawCode);

  return {
    events: allEvents,
    rateModifier: overallRateModifier,
    isReversed,
    isValid: true,
    rawCode,
  };
}

export function evaluateStrudelPattern(code: string): ParsedStrudelPattern {
  return parseStrudelPattern(code);
}

/**
 * Splits top-level code into sub-expressions separated by comma `,`, newline `\n`, or semicolon `;`
 * while preserving commas inside brackets/parentheses and string quotes.
 */
function splitSubExpressions(code: string): string[] {
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

  return subExprs;
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

      // Group [...]
      if (content.startsWith('[') && content.endsWith(']')) {
        const inner = content.slice(1, -1);
        events.push(...parseLane(inner, repStart, repEnd, defaultType));
      } else if (content === '~' || content === '.' || content === 'rest' || content === '_') {
        // Rest (silence)
      } else {
        const isNote = /[a-gA-G][#b]?\d/.test(content);
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
