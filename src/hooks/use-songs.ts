import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { readSongs, writeSongs } from '../lib/cache';
import type { Song, Folds, Page } from '../lib/schema';

export function useSongs() {
  return useQuery({
    queryKey: ['songs', 'public'],
    initialData: () => readSongs() ?? undefined,
    initialDataUpdatedAt: 0,
    queryFn: async ({ signal }): Promise<Song[]> => {
      const response = await api.fetch('/api/songs', { signal });
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

export function useMarketFolds(
  foldLimit = 50,
  refetchIntervalMs: number | false = 60 * 60 * 1000,
  windowMinutes = 60
) {
  return useQuery({
    queryKey: ['market', 'folds', foldLimit, windowMinutes],
    queryFn: async ({ signal }): Promise<Folds> => {
      const response = await api.fetch(
        `/api/market/folds?limit=${foldLimit}&windowMinutes=${windowMinutes}`,
        { signal }
      );
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

export function usePaginatedSongs(options: PaginatedSongsOptions = {}) {
  const {
    sort = 'new',
    limit = 20,
    offset = 0,
    creator,
    genre,
    search,
    sinceMinutes,
    enabled = true,
    refetchIntervalMs = false,
  } = options;

  return useQuery({
    queryKey: ['songs', 'paginated', { sort, limit, offset, creator, genre, search, sinceMinutes }],
    enabled,
    refetchInterval: refetchIntervalMs,
    queryFn: async ({ signal }): Promise<Page> => {
      const params = new URLSearchParams();
      params.set('paginated', 'true');
      params.set('sort', sort);
      params.set('limit', String(limit));
      params.set('offset', String(offset));
      if (creator && creator !== 'all') params.set('creator', creator);
      if (genre && genre !== 'all') params.set('genre', genre);
      if (search && search.trim()) params.set('search', search.trim());
      if (sinceMinutes && sinceMinutes > 0) params.set('sinceMinutes', String(sinceMinutes));

      const response = await api.fetch(`/api/songs?${params.toString()}`, { signal });
      if (!response.ok) throw new Error('Could not query public songs');
      return await response.json();
    },
    staleTime: 15_000,
    retry: false,
  });
}
