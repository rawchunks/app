import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { GENRE_COVER_IMAGES, normalizeGenreSlug } from '../components/songs/card';

export interface GenreCoverEntry {
  slug: string;
  label: string;
  imageUrl: string | null;
  status: 'pending' | 'ready' | 'failed';
}

export function useGenreCovers(genres: string[]) {
  const { staticMap, dynamicGenres } = useMemo(() => {
    const sMap: Record<string, GenreCoverEntry> = {};
    const dList: string[] = [];
    const seen = new Set<string>();

    for (const raw of genres) {
      if (!raw || typeof raw !== 'string') continue;
      const slug = normalizeGenreSlug(raw);
      if (!slug || slug === 'uncategorized' || slug === 'all' || seen.has(slug)) continue;
      seen.add(slug);

      const staticUrl = GENRE_COVER_IMAGES[slug];
      if (staticUrl) {
        sMap[slug] = {
          slug,
          label: raw,
          imageUrl: staticUrl,
          status: 'ready',
        };
      } else {
        dList.push(raw.trim());
      }
    }
    dList.sort((a, b) => a.localeCompare(b));
    return { staticMap: sMap, dynamicGenres: dList };
  }, [genres]);

  const query = useQuery({
    queryKey: ['genres', 'covers', dynamicGenres.join('|')],
    enabled: dynamicGenres.length > 0,
    queryFn: async ({ signal }): Promise<Record<string, GenreCoverEntry>> => {
      const params = new URLSearchParams();
      params.set('genres', dynamicGenres.join(','));
      const res = await api.fetch(`/api/genres/covers?${params.toString()}`, { signal });
      if (!res.ok) throw new Error('Could not load genre covers');
      const data = await res.json();
      return (data?.covers ?? {}) as Record<string, GenreCoverEntry>;
    },
    refetchInterval: (q) => {
      const covers = q.state.data;
      if (!covers) return false;
      const hasPending = Object.values(covers).some((entry) => entry.status === 'pending');
      return hasPending ? 4000 : false;
    },
    staleTime: 30_000,
    retry: false,
  });

  const mergedCovers = useMemo(() => {
    return {
      ...staticMap,
      ...(query.data ?? {}),
    };
  }, [staticMap, query.data]);

  return {
    ...query,
    data: mergedCovers,
  };
}
