import { useQuery } from '@tanstack/react-query';
import { sdk } from '../lib/sdk';
import { readSongs, writeSongs } from '../lib/cache';
import type { Song } from '../lib/schema';

export function useSongs() {
  return useQuery({
    queryKey: ['songs', 'public'],
    initialData: () => readSongs() ?? undefined,
    initialDataUpdatedAt: 0,
    queryFn: async ({ signal }): Promise<Song[]> => {
      const response = await sdk.fetch('/api/songs', { signal });
      if (!response.ok) throw new Error('Could not load public songs');
      const songs = await response.json();
      if (!Array.isArray(songs) || songs.some(song => typeof song.id !== 'string' || song.public !== true)) {
        throw new Error('Invalid public catalogue');
      }
      writeSongs(songs);
      return songs;
    },
    retry: false,
  });
}
