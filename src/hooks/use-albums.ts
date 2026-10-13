import { useQuery } from '@tanstack/react-query';
import { sdk } from '../lib/sdk';
import type { Album } from '../lib/schema';

export function usePublicAlbums() {
  return useQuery({
    queryKey: ['albums', 'public'],
    queryFn: async ({ signal }): Promise<Album[]> => {
      try {
        const response = await sdk.fetch('/api/albums?public=true', { signal });
        if (!response.ok) return [];
        const albums = await response.json();
        return Array.isArray(albums) ? albums : [];
      } catch {
        return [];
      }
    },
    staleTime: 60_000,
  });
}
