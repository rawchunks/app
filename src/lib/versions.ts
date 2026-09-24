import type { Song } from './schema';

export function groupSongs(songs: Song[]): Song[][] {
  const groups = new Map<string, Song[]>();
  for (const song of songs) {
    const key = song.family ?? song.id;
    const group = groups.get(key);
    if (group) group.push(song);
    else groups.set(key, [song]);
  }
  return [...groups.values()].map(group => group.sort((left, right) => (left.version ?? 1) - (right.version ?? 1)));
}

export function licenseSales(allocation: number, remaining: bigint): number {
  if (!Number.isSafeInteger(allocation) || allocation < 0 || remaining < 0n || remaining > BigInt(allocation)) throw new Error('The license allocation does not match the minted song');
  return allocation - Number(remaining);
}
