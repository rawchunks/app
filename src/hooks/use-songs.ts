import { useQuery } from '@tanstack/react-query';
import { sdk } from '../lib/sdk';
import { readSongs, writeSongs } from '../lib/cache';
import type { Song, Folds, Page } from '../lib/schema';

export function useSongs() {
  return useQuery({
    queryKey: ['songs', 'public'],
    initialData: () => readSongs() ?? undefined,
    initialDataUpdatedAt: 0,
    queryFn: async ({ signal }): Promise<Song[]> => {
      const response = await sdk.fetch('/api/songs', { signal });
      if (!response.ok) throw new Error('Could not load public songs');
      const songs = await response.json();
      if (!Array.isArray(songs) || songs.some((song) => typeof song.id !== 'string' || song.public !== true)) {
        throw new Error('Invalid public catalogue');
      }
      writeSongs(songs);
      return songs;
    },
    retry: false,
  });
}

export function useMarketFolds(foldLimit = 20, refetchIntervalMs: number | false = 60 * 60 * 1000) {
  return useQuery({
    queryKey: ['market', 'folds', foldLimit],
    queryFn: async ({ signal }): Promise<Folds> => {
      const response = await sdk.fetch(`/api/market/folds?limit=${foldLimit}`, { signal });
      if (!response.ok) throw new Error('Could not load market folds');
      return await response.json();
    },
    refetchInterval: refetchIntervalMs,
    staleTime: 30_000,
    retry: false,
  });
}

export interface PaginatedSongsOptions {
  sort?: 'new' | 'popular';
  limit?: number;
  offset?: number;
  creator?: string;
  genre?: string;
  search?: string;
  sinceMinutes?: number;
  enabled?: boolean;
  refetchIntervalMs?: number | false;
}


