import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Playlist } from '../lib/schema';

export function usePublicPlaylists(limit = 50) {
  return useQuery({
    queryKey: ['playlists', 'public', limit],
    queryFn: async ({ signal }): Promise<Playlist[]> => {
      try {
        const response = await api.fetch(`/api/playlists?limit=${limit}`, { signal });
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
      const response = await api.fetch(`/api/playlists?creator=${encodeURIComponent(addr)}`, {
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
      const response = await api.fetch(`/api/playlists/${encodeURIComponent(id)}`, { signal });
      if (!response.ok) return null;
      return await response.json();
    },
    staleTime: 15_000,
  });
}

export async function createPlaylistApi(
  data: {
    title: string;
    creator: string;
    description?: string | null;
    cover?: string | null;
    song_ids?: string[];
    songs?: string[];
    public?: boolean;
  },
  userAddress?: string,
): Promise<Playlist> {
  const effectiveUser = userAddress || data.creator;
  const songIds = data.song_ids ?? data.songs ?? [];
  const res = await api.fetch('/api/playlists', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(effectiveUser ? { 'x-user-address': effectiveUser } : {}),
    },
    body: JSON.stringify({
      title: data.title,
      creator: data.creator,
      description: data.description ?? null,
      cover: data.cover ?? null,
      song_ids: songIds,
      public: data.public ?? false,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to create playlist');
  }
  return await res.json();
}

export async function updatePlaylistApi(
  id: string,
  updates: {
    title?: string;
    description?: string | null;
    cover?: string | null;
    song_ids?: string[];
    public?: boolean;
  },
  userAddress?: string,
): Promise<Playlist> {
  const res = await api.fetch(`/api/playlists/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(userAddress ? { 'x-user-address': userAddress } : {}),
    },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to update playlist');
  }
  return await res.json();
}

export async function addSongToPlaylistApi(
  id: string,
  songId: string,
  userAddress?: string,
): Promise<Playlist> {
  const res = await api.fetch(`/api/playlists/${encodeURIComponent(id)}/songs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(userAddress ? { 'x-user-address': userAddress } : {}),
    },
    body: JSON.stringify({ songId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to add song to playlist');
  }
  return await res.json();
}

export async function removeSongFromPlaylistApi(
  id: string,
  songId: string,
  userAddress?: string,
): Promise<Playlist> {
  const res = await api.fetch(`/api/playlists/${encodeURIComponent(id)}/songs/${encodeURIComponent(songId)}`, {
    method: 'DELETE',
    headers: {
      ...(userAddress ? { 'x-user-address': userAddress } : {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to remove song from playlist');
  }
  return await res.json();
}

export async function deletePlaylistApi(id: string, userAddress?: string): Promise<void> {
  const res = await api.fetch(`/api/playlists/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: {
      ...(userAddress ? { 'x-user-address': userAddress } : {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to delete playlist');
  }
}

export async function recordPlaylistPlayApi(id: string): Promise<Playlist | null> {
  try {
    const res = await api.fetch(`/api/playlists/${encodeURIComponent(id)}/play`, {
      method: 'POST',
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
