import { useQuery } from '@tanstack/react-query';
import { sdk } from '../lib/sdk';
import type { Playlist } from '../lib/schema';

export function usePublicPlaylists(limit = 50) {
  return useQuery({
    queryKey: ['playlists', 'public', limit],
    queryFn: async ({ signal }): Promise<Playlist[]> => {
      try {
        const response = await sdk.fetch(`/api/playlists?limit=${limit}`, { signal });
        if (!response.ok) return [];
        const playlists = await response.json();
        return Array.isArray(playlists) ? playlists : [];
      } catch {
        return [];
      }
    },
    staleTime: 30_000,
  });
}

export function useCreatorPlaylists(creatorAddress?: string | null) {
  const addr = creatorAddress?.trim() || '';
  return useQuery({
    queryKey: ['playlists', 'creator', addr],
    enabled: Boolean(addr),
    queryFn: async ({ signal }): Promise<Playlist[]> => {
      if (!addr) return [];
      const response = await sdk.fetch(`/api/playlists?creator=${encodeURIComponent(addr)}`, {
        signal,
        headers: { 'x-user-address': addr },
      });
      if (!response.ok) return [];
      const playlists = await response.json();
      return Array.isArray(playlists) ? playlists : [];
    },
    staleTime: 15_000,
  });
}

export function usePlaylistDetail(playlistId?: string | null) {
  const id = playlistId?.trim() || '';
  return useQuery({
    queryKey: ['playlists', 'detail', id],
    enabled: Boolean(id),
    queryFn: async ({ signal }): Promise<Playlist | null> => {
      if (!id) return null;
      const response = await sdk.fetch(`/api/playlists/${encodeURIComponent(id)}`, { signal });
      if (!response.ok) return null;
      return await response.json();
    },
    staleTime: 15_000,
  });
}


