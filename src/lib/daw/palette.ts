export const STEM_PALETTE = {
  master: '#a855f7',
  vocals: '#00f0ff',
  drums: '#ff5500',
  bass: '#ffb700',
  synth: '#d946ef',
  keys: '#ec4899',
  guitar: '#10b981',
  other: '#00e676',
  instrumental: '#3b82f6',
} as const;

export type StemType = keyof typeof STEM_PALETTE;

export function getStemColor(name: string): string {
  const lower = (name || '').toLowerCase();
  if (lower.includes('vocal')) return STEM_PALETTE.vocals;
  if (lower.includes('drum') || lower.includes('sequencer')) return STEM_PALETTE.drums;
  if (lower.includes('bass')) return STEM_PALETTE.bass;
  if (lower.includes('synth') || lower.includes('strudel') || lower.includes('code')) return STEM_PALETTE.synth;
  if (lower.includes('key') || lower.includes('piano')) return STEM_PALETTE.keys;
  if (lower.includes('guitar')) return STEM_PALETTE.guitar;
  if (lower.includes('master') || lower.includes('main')) return STEM_PALETTE.master;
  if (lower.includes('instrumental')) return STEM_PALETTE.instrumental;
  return STEM_PALETTE.other;
}
