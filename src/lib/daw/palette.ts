export const STEM_PALETTE = {
  master: '#a855f7',
  vocals: '#00f0ff',
  backing_vocals: '#38bdf8',
  drums: '#ff5500',
  percussion: '#fb923c',
  bass: '#ffb700',
  synth: '#d946ef',
  keys: '#ec4899',
  guitar: '#10b981',
  strings: '#f43f5e',
  woodwinds: '#2dd4bf',
  brass: '#facc15',
  fx: '#818cf8',
  other: '#00e676',
  instrumental: '#3b82f6',
} as const;

export type StemType = keyof typeof STEM_PALETTE;

export function getStemColor(name: string): string {
  const lower = (name || '').toLowerCase();
  if (lower.includes('backing') && lower.includes('vocal')) return STEM_PALETTE.backing_vocals;
  if (lower.includes('vocal')) return STEM_PALETTE.vocals;
  if (lower.includes('percussion')) return STEM_PALETTE.percussion;
  if (lower.includes('drum') || lower.includes('sequencer')) return STEM_PALETTE.drums;
  if (lower.includes('bass')) return STEM_PALETTE.bass;
  if (lower.includes('synth') || lower.includes('strudel') || lower.includes('code')) return STEM_PALETTE.synth;
  if (lower.includes('key') || lower.includes('piano')) return STEM_PALETTE.keys;
  if (lower.includes('guitar')) return STEM_PALETTE.guitar;
  if (lower.includes('string')) return STEM_PALETTE.strings;
  if (lower.includes('woodwind') || lower.includes('flute') || lower.includes('sax')) return STEM_PALETTE.woodwinds;
  if (lower.includes('brass') || lower.includes('horn') || lower.includes('trumpet')) return STEM_PALETTE.brass;
  if (lower.includes('fx') || lower.includes('sfx')) return STEM_PALETTE.fx;
  if (lower.includes('master') || lower.includes('main')) return STEM_PALETTE.master;
  if (lower.includes('instrumental')) return STEM_PALETTE.instrumental;
  return STEM_PALETTE.other;
}

export function formatTrackBadgeCode(trackItem: { id?: string; name?: string; type?: string }): string {
  if (trackItem.id === 'master') return 'MST';
  const raw = (trackItem.name || trackItem.type || '').trim();
  const numMatch = raw.match(/\s+(\d+)$/);
  const base = raw.replace(/\s+\d+$/, '').toLowerCase();
  const codeMap: Record<string, string> = {
    vocals: 'VOC',
    'backing vocals': 'BGV',
    backing_vocals: 'BGV',
    drums: 'DRM',
    'drum seq': 'DRM',
    sequencer: 'DRM',
    bass: 'BAS',
    guitar: 'GTR',
    keyboard: 'KEY',
    keys: 'KEY',
    'keys synth': 'KEY',
    pianoroll: 'KEY',
    strings: 'STR',
    synth: 'SYN',
    woodwinds: 'WIN',
    brass: 'BRS',
    percussion: 'PER',
    fx: 'FX',
    sample: 'SMP',
    sampler: 'SMP',
    strudel: 'COD',
    code: 'COD',
    'live code': 'COD',
  };
  const code = codeMap[base] || (trackItem.type ? codeMap[trackItem.type] : undefined) || base.slice(0, 3).toUpperCase();
  return numMatch ? `${code} ${numMatch[1]}` : code;
}

