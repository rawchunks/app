import type { Song } from './schema';

export function groupSongs(songs: Song[]): Song[][] {
  const groups = new Map<string, Song[]>();
  for (const song of songs) {
    const key = song.family ?? song.id;
    const group = groups.get(key);
    if (group) group.push(song);
    else groups.set(key, [song]);
  }
  return [...groups.values()].map(group =>
    group.sort((left, right) => {
      const vDiff = (left.version ?? 1) - (right.version ?? 1);
      if (vDiff !== 0) return vDiff;
      const tLeft = Date.parse(left.created_at || '') || 0;
      const tRight = Date.parse(right.created_at || '') || 0;
      if (tLeft !== tRight) return tLeft - tRight;
      return left.id.localeCompare(right.id);
    }),
  );
}

export function licenseSales(allocation: number, remaining: bigint): number {
  if (!Number.isSafeInteger(allocation) || allocation < 0 || remaining < 0n || remaining > BigInt(allocation)) throw new Error('The license allocation does not match the minted song');
  return allocation - Number(remaining);
}
