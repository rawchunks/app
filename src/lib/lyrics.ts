export type LyricCategory = 'structure' | 'intensity' | 'solo' | 'vocal';

export interface StructuredTag {
  token: string;
  category: LyricCategory;
  description: string;
  alias?: string;
}

export interface LyricBlock {
  id: string;
  tags: string[];
  text: string;
}

export const CATEGORY_METADATA: Record<LyricCategory, { label: string; color: string; bg: string; border: string }> = {
  structure: {
    label: 'SONG STRUCTURE',
    color: '#00ccff',
    bg: 'rgba(0, 204, 255, 0.12)',
    border: 'rgba(0, 204, 255, 0.45)',
  },
  intensity: {
    label: 'INTENSITY',
    color: '#ff00a0',
    bg: 'rgba(255, 0, 160, 0.12)',
    border: 'rgba(255, 0, 160, 0.45)',
  },
  solo: {
    label: 'SOLO / INSTRUMENTAL',
    color: '#00ff41',
    bg: 'rgba(0, 255, 65, 0.12)',
    border: 'rgba(0, 255, 65, 0.45)',
  },
  vocal: {
    label: 'VOCAL STYLE',
    color: '#ffb700',
    bg: 'rgba(255, 183, 0, 0.12)',
    border: 'rgba(255, 183, 0, 0.45)',
  },
};

export const STRUCTURED_TAGS: StructuredTag[] = [
  // 1. Song Structure
  {
    token: '[Intro]',
    category: 'structure',
    description: 'Establishes the opening atmosphere, typically utilizing light instrumentation or minimal vocals.',
  },
  {
    token: '[Verse]',
    category: 'structure',
    description: 'Main storytelling sections featuring narrative progression and moderate energy levels.',
  },
  {
    token: '[Verse 1]',
    category: 'structure',
    description: 'First storytelling section featuring narrative progression.',
  },
  {
    token: '[Verse 2]',
    category: 'structure',
    description: 'Second storytelling section featuring narrative progression.',
  },
  {
    token: '[Pre-Chorus]',
    category: 'structure',
    description: 'Purposefully builds tension and musical momentum to transition toward the hook.',
  },
  {
    token: '[Chorus]',
    category: 'structure',
    description: 'The main hook and emotional core; triggers the peak energy and dense arrangements.',
  },
  {
    token: '[Bridge]',
    category: 'structure',
    description: 'A contrasting melodic or harmonic shift that breaks up repetition.',
  },
  {
    token: '[Outro]',
    category: 'structure',
    description: 'Winding-down section to conclude the theme or prepare for a fade.',
  },
  {
    token: '[End]',
    category: 'structure',
    description: 'Signals a hard, definitive stop or a dramatic final resolution.',
  },

  // 2. Intensity
  {
    token: '[Build]',
    category: 'intensity',
    description: 'Gradually elevates production energy, rising step-by-step.',
  },
  {
    token: '[Drop]',
    category: 'intensity',
    description: 'Forces an intense electronic or rhythmic release of built-up energy.',
  },
  {
    token: '[Breakdown]',
    category: 'intensity',
    description: 'Strips back the heavy instrumentation to create an open, quiet space.',
  },
  {
    token: '[Silence]',
    category: 'intensity',
    description: 'Temporarily drops out all audio signals.',
  },

  // 3. Solo (Instrumental)
  {
    token: '[Instrumental]',
    category: 'solo',
    description: 'General purely instrumental block with no vocal layers.',
  },
  {
    token: '[inst]',
    category: 'solo',
    description: 'Shortcode instrumental block with no vocal layers.',
  },
  {
    token: '[Guitar Solo]',
    category: 'solo',
    description: 'Generates a guitar lead performance.',
  },
  {
    token: '[Piano Interlude]',
    category: 'solo',
    description: 'Triggers a transitional melodic piano sequence.',
  },
  {
    token: '[Drum Break]',
    category: 'solo',
    description: 'Isolates the percussion or rhythmic sections.',
  },

  // 4. Vocal Style
  {
    token: '[whispered]',
    category: 'vocal',
    description: 'Commands a soft, breathy vocal delivery.',
  },
  {
    token: '[raspy vocal]',
    category: 'vocal',
    description: 'Adds gritty or gravelly textures to the vocal performance.',
  },
  {
    token: '[building energy]',
    category: 'vocal',
    description: 'Tells the vocalist to steadily intensify their delivery power.',
  },
];

export function ensureTagBrackets(tag: string): string {
  const trimmed = tag.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed;
  }
  return `[${trimmed}]`;
}

export function getTagCategory(tag: string): LyricCategory | 'custom' {
  const bracketed = ensureTagBrackets(tag);
  const normalized = bracketed.toLowerCase();
  const found = STRUCTURED_TAGS.find((t) => t.token.toLowerCase() === normalized);
  return found ? found.category : 'custom';
}

export function getTagDescription(tag: string): string {
  const bracketed = ensureTagBrackets(tag);
  const normalized = bracketed.toLowerCase();
  const found = STRUCTURED_TAGS.find((t) => t.token.toLowerCase() === normalized);
  return found?.description || 'Custom structured tag for AceStep';
}

export function getTagColor(tag: string): string {
  const cat = getTagCategory(tag);
  if (cat === 'custom') return '#a0a0a0';
  return CATEGORY_METADATA[cat].color;
}

export function createBlock(tags: string[] = [], text: string = ''): LyricBlock {
  return {
    id: `block-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    tags: tags.map(ensureTagBrackets).filter(Boolean),
    text,
  };
}

/**
 * Parses raw text or structured string into ordered blocks with tags and lyrics.
 * Also parses JSON representations that future external lyric generation models might pass.
 */
export function parseLyricsToBlocks(input: string): LyricBlock[] {
  const trimmed = input.trim();
  if (!trimmed) {
    return [createBlock(['[Intro]'], '')];
  }

  // Attempt JSON parsing in case an external service passes structured JSON
  if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') {
        return parsed.map((item, idx) => ({
          id: `block-${Date.now()}-${idx}`,
          tags: Array.isArray(item.tags)
            ? item.tags.map((t: string) => ensureTagBrackets(String(t))).filter(Boolean)
            : item.tag
            ? [ensureTagBrackets(String(item.tag))]
            : [],
          text: typeof item.text === 'string' ? item.text : typeof item.lyrics === 'string' ? item.lyrics : '',
        }));
      }
    } catch {
      // Not JSON, continue with bracketed text parsing
    }
  }

  const lines = input.split(/\r?\n/);
  const blocks: LyricBlock[] = [];
  let currentTags: string[] = [];
  let currentTextLines: string[] = [];

  const tagLineRegex = /^(\s*\[[^\]]+\]\s*)+$/;
  const tagTokenRegex = /\[([^\]]+)\]/g;

  const flushBlock = () => {
    if (currentTags.length > 0 || currentTextLines.length > 0) {
      blocks.push(createBlock(currentTags, currentTextLines.join('\n').trim()));
      currentTags = [];
      currentTextLines = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isTagOnlyLine = tagLineRegex.test(line);

    if (isTagOnlyLine) {
      // If we already accumulated lyrics in the previous section, flush it to start a new block
      if (currentTextLines.length > 0) {
        flushBlock();
      }

      // Extract all tags on this line
      let match: RegExpExecArray | null;
      while ((match = tagTokenRegex.exec(line)) !== null) {
        const token = ensureTagBrackets(match[1]);
        if (token) {
          currentTags.push(token);
        }
      }
    } else {
      currentTextLines.push(line);
    }
  }

  flushBlock();

  if (blocks.length === 0) {
    return [createBlock(['[Intro]'], '')];
  }

  return blocks;
}

/**
 * Serializes lyric blocks back to canonical AceStep bracketed format.
 * AceStep recognizes squared-bracketed tags: [Intro], [Verse 1], [whispered], etc.
 */
export function serializeBlocksToLyrics(blocks: LyricBlock[], original?: string): string {
  if (original !== undefined) {
    const parsed = parseLyricsToBlocks(original);
    if (parsed.length === blocks.length && parsed.every((block, index) =>
      block.text === blocks[index].text && JSON.stringify(block.tags) === JSON.stringify(blocks[index].tags)
    )) return original;
  }
  return blocks
    .map((block) => {
      const tagsPart = block.tags
        .map((t) => ensureTagBrackets(t))
        .filter(Boolean)
        .join('\n');
      const textPart = block.text.trim();

      if (tagsPart && textPart) {
        return `${tagsPart}\n${textPart}`;
      }
      return tagsPart || textPart;
    })
    .filter(Boolean)
    .join('\n\n');
}
