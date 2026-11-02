import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Album, AlbumReleaseConfig } from '../lib/schema';

export function usePublicAlbums() {
  return useQuery({
    queryKey: ['albums', 'public'],
    queryFn: async ({ signal }): Promise<Album[]> => {
      try {
        const response = await api.fetch('/api/albums?public=true', { signal });
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

export function useCreatorAlbums(creatorAddress?: string | null) {
  const addr = creatorAddress?.trim() || '';
  return useQuery({
    queryKey: ['albums', 'creator', addr],
    enabled: Boolean(addr),
    queryFn: async ({ signal }): Promise<Album[]> => {
      if (!addr) return [];
      const response = await api.fetch(`/api/albums?creator=${encodeURIComponent(addr)}`, {
        signal,
        headers: { 'x-user-address': addr },
      });
      if (!response.ok) return [];
      const albums = await response.json();
      return Array.isArray(albums) ? albums : [];
    },
    staleTime: 15_000,
  });
}

export async function createAlbumApi(
  data: {
    title: string;
    creator: string;
    description?: string | null;
    concept?: string | null;
    genre?: string | null;
    cover?: string | null;
    gallery?: string[];
    release_config?: AlbumReleaseConfig | null;
    public?: boolean;
  },
  userAddress?: string,
): Promise<Album> {
  const effectiveUser = userAddress || data.creator;
  const res = await api.fetch('/api/albums', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(effectiveUser ? { 'x-user-address': effectiveUser } : {}),
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to create album');
  }
  return await res.json();
}

export async function updateAlbumApi(
  id: string,
  updates: {
    title?: string;
    description?: string | null;
    concept?: string | null;
    genre?: string | null;
    cover?: string | null;
    gallery?: string[];
    release_config?: AlbumReleaseConfig | null;
    public?: boolean;
  },
  userAddress?: string,
): Promise<Album> {
  const res = await api.fetch(`/api/albums/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(userAddress ? { 'x-user-address': userAddress } : {}),
    },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to update album');
  }
  return await res.json();
}

export async function deleteAlbumApi(id: string, userAddress?: string): Promise<void> {
  const res = await api.fetch(`/api/albums/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: {
      ...(userAddress ? { 'x-user-address': userAddress } : {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to delete album');
  }
}

export async function addSongToAlbumApi(albumId: string, songId: string, userAddress?: string): Promise<void> {
  const res = await api.fetch(`/api/albums/${encodeURIComponent(albumId)}/songs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(userAddress ? { 'x-user-address': userAddress } : {}),
    },
    body: JSON.stringify({ songId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to add song to album');
  }
}

export async function removeSongFromAlbumApi(albumId: string, songId: string, userAddress?: string): Promise<void> {
  const res = await api.fetch(`/api/albums/${encodeURIComponent(albumId)}/songs/${encodeURIComponent(songId)}`, {
    method: 'DELETE',
    headers: {
      ...(userAddress ? { 'x-user-address': userAddress } : {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to remove song from album');
  }
}
