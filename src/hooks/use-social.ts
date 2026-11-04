import { useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../lib/api';
import type { Comment, Social, Song } from '../lib/schema';

function readLocalList(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeLocalList(key: string, items: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch {
    // Ignore storage quota errors
  }
}

export function useLikes(userAddress?: string | null) {
  const addr = userAddress?.trim() || '';
  const cacheKey = addr ? `rawchunks:likes:${addr.toLowerCase()}` : '';
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['social', 'likes', addr.toLowerCase()],
    enabled: Boolean(addr),
    initialData: () => (cacheKey ? readLocalList(cacheKey) : []),
    initialDataUpdatedAt: 0,
    queryFn: async ({ signal }): Promise<string[]> => {
      if (!addr) return [];
      const res = await api.fetch(`/api/likes?user=${encodeURIComponent(addr)}`, {
        signal,
        userAddress: addr,
      });
      if (!res.ok) return cacheKey ? readLocalList(cacheKey) : [];
      const data = await res.json();
      const ids = Array.isArray(data?.songIds) ? data.songIds : [];
      if (cacheKey) writeLocalList(cacheKey, ids);
      return ids;
    },
    staleTime: 15_000,
  });

  const likedSongIds = query.data ?? [];
  const likedSet = useMemo(() => new Set(likedSongIds), [likedSongIds]);

  const isLiked = useCallback(
    (songId?: string | null) => Boolean(songId && likedSet.has(songId)),
    [likedSet]
  );

  const mutation = useMutation({
    mutationFn: async (songId: string) => {
      if (!addr) {
        toast.error('Connect account to save liked songs');
        throw new Error('Not authenticated');
      }
      const res = await api.fetch(`/api/songs/${encodeURIComponent(songId)}/like`, {
        method: 'POST',
        userAddress: addr,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Could not update like');
      }
      const raw = await res.json();
      return {
        liked: Boolean(raw.liked),
        likes: Number(raw.likesCount ?? raw.likes ?? 0),
        songId: String(raw.songId ?? songId),
      };
    },
    onMutate: async (songId: string) => {
      if (!addr) return;
      const qKey = ['social', 'likes', addr.toLowerCase()];
      await queryClient.cancelQueries({ queryKey: qKey });
      const previous = queryClient.getQueryData<string[]>(qKey) ?? [];
      const currentlyLiked = previous.includes(songId);
      const next = currentlyLiked ? previous.filter((id) => id !== songId) : [songId, ...previous];
      queryClient.setQueryData<string[]>(qKey, next);
      if (cacheKey) writeLocalList(cacheKey, next);

      // Optimistically bump song likes in public songs cache
      queryClient.setQueryData<Song[]>(['songs', 'public'], (old) => {
        if (!Array.isArray(old)) return old;
        return old.map((s) =>
          s.id === songId
            ? { ...s, likes: Math.max(0, (s.likes ?? 0) + (currentlyLiked ? -1 : 1)) }
            : s
        );
      });

      return { previous };
    },
    onError: (_err, _songId, context) => {
      if (addr && context?.previous) {
        const qKey = ['social', 'likes', addr.toLowerCase()];
        queryClient.setQueryData<string[]>(qKey, context.previous);
        if (cacheKey) writeLocalList(cacheKey, context.previous);
      }
    },
    onSuccess: (data) => {
      if (!addr) return;
      const qKey = ['social', 'likes', addr.toLowerCase()];
      queryClient.setQueryData<string[]>(qKey, (old = []) => {
        const filtered = old.filter((id) => id !== data.songId);
        const next = data.liked ? [data.songId, ...filtered] : filtered;
        if (cacheKey) writeLocalList(cacheKey, next);
        return next;
      });
      queryClient.setQueryData<Song[]>(['songs', 'public'], (old) => {
        if (!Array.isArray(old)) return old;
        return old.map((s) => (s.id === data.songId ? { ...s, likes: data.likes } : s));
      });
    },
  });

  const toggleLike = useCallback(
    (songId: string, e?: React.MouseEvent) => {
      if (e) e.stopPropagation();
      if (!addr) {
        toast.error('Connect account to like songs');
        return;
      }
      mutation.mutate(songId);
    },
    [addr, mutation]
  );

  return {
    likedSongIds,
    likedSet,
    isLiked,
    toggleLike,
    isPending: mutation.isPending,
  };
}

export function useFollows(userAddress?: string | null) {
  const addr = userAddress?.trim() || '';
  const cacheKey = addr ? `rawchunks:follows:${addr.toLowerCase()}` : '';
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['social', 'follows', addr.toLowerCase()],
    enabled: Boolean(addr),
    initialData: () => (cacheKey ? readLocalList(cacheKey) : []),
    initialDataUpdatedAt: 0,
    queryFn: async ({ signal }): Promise<string[]> => {
      if (!addr) return [];
      const res = await api.fetch(`/api/follows?user=${encodeURIComponent(addr)}`, {
        signal,
        userAddress: addr,
      });
      if (!res.ok) return cacheKey ? readLocalList(cacheKey) : [];
      const data = await res.json();
      const creators: string[] = Array.isArray(data?.creators)
        ? data.creators.map((c: string) => c.toLowerCase())
        : [];
      if (cacheKey) writeLocalList(cacheKey, creators);
      return creators;
    },
    staleTime: 15_000,
  });

  const followedCreators = query.data ?? [];
  const followedSet = useMemo(
    () => new Set(followedCreators.map((c) => c.toLowerCase())),
    [followedCreators]
  );

  const isFollowing = useCallback(
    (creator?: string | null) => Boolean(creator && followedSet.has(creator.trim().toLowerCase())),
    [followedSet]
  );

  const mutation = useMutation({
    mutationFn: async (creatorAddress: string) => {
      if (!addr) {
        toast.error('Connect account to follow creators');
        throw new Error('Not authenticated');
      }
      const res = await api.fetch(`/api/creators/${encodeURIComponent(creatorAddress)}/follow`, {
        method: 'POST',
        userAddress: addr,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Could not update follow status');
      }
      const raw = await res.json();
      return {
        followed: Boolean(raw.following ?? raw.followed),
        followers: Number(raw.followersCount ?? raw.followers ?? 0),
        following: Number(raw.followingCount ?? 0),
        creator: String(raw.creator ?? creatorAddress),
      };
    },
    onMutate: async (creatorAddress: string) => {
      if (!addr) return;
      const targetLower = creatorAddress.trim().toLowerCase();
      const qKey = ['social', 'follows', addr.toLowerCase()];
      await queryClient.cancelQueries({ queryKey: qKey });
      const previous = queryClient.getQueryData<string[]>(qKey) ?? [];
      const currentlyFollowed = previous.some((c) => c.toLowerCase() === targetLower);
      const next = currentlyFollowed
        ? previous.filter((c) => c.toLowerCase() !== targetLower)
        : [targetLower, ...previous];
      queryClient.setQueryData<string[]>(qKey, next);
      if (cacheKey) writeLocalList(cacheKey, next);

      // Also update creator social query cache if present
      const socialKey = ['social', 'creator', targetLower];
      const prevSocial = queryClient.getQueryData<Social>(socialKey);
      if (prevSocial) {
        queryClient.setQueryData<Social>(socialKey, {
          ...prevSocial,
          isFollowed: !currentlyFollowed,
          followers: Math.max(0, prevSocial.followers + (currentlyFollowed ? -1 : 1)),
        });
      }

      return { previous, prevSocial, targetLower };
    },
    onError: (err: any, _creator, context) => {
      if (addr && context?.previous) {
        const qKey = ['social', 'follows', addr.toLowerCase()];
        queryClient.setQueryData<string[]>(qKey, context.previous);
        if (cacheKey) writeLocalList(cacheKey, context.previous);
      }
      if (context?.prevSocial && context?.targetLower) {
        queryClient.setQueryData(['social', 'creator', context.targetLower], context.prevSocial);
      }
      if (err?.message && err.message !== 'Not authenticated') {
        toast.error(err.message);
      }
    },
    onSuccess: (data, creatorAddress) => {
      if (!addr) return;
      const targetLower = creatorAddress.trim().toLowerCase();
      const qKey = ['social', 'follows', addr.toLowerCase()];
      queryClient.setQueryData<string[]>(qKey, (old = []) => {
        const filtered = old.filter((c) => c.toLowerCase() !== targetLower);
        const next = data.followed ? [targetLower, ...filtered] : filtered;
        if (cacheKey) writeLocalList(cacheKey, next);
        return next;
      });
      queryClient.setQueryData<Social>(['social', 'creator', targetLower], (old) =>
        old
          ? {
              ...old,
              followers: data.followers,
              following: data.following,
              isFollowed: data.followed,
            }
          : {
              creator: creatorAddress,
              followers: data.followers,
              following: data.following,
              isFollowed: data.followed,
            }
      );
    },
  });

  const toggleFollow = useCallback(
    (creatorAddress: string, e?: React.MouseEvent) => {
      if (e) e.stopPropagation();
      if (!addr) {
        toast.error('Connect account to follow creators');
        return;
      }
      if (creatorAddress.trim().toLowerCase() === addr.toLowerCase()) {
        toast.error('Cannot follow your own account');
        return;
      }
      mutation.mutate(creatorAddress);
    },
    [addr, mutation]
  );

  return {
    followedCreators,
    followedSet,
    isFollowing,
    toggleFollow,
    isPending: mutation.isPending,
  };
}

export function useCreatorSocial(creatorAddress?: string | null, viewerAddress?: string | null) {
  const target = creatorAddress?.trim() || '';
  const targetLower = target.toLowerCase();
  const viewer = viewerAddress?.trim() || '';
  const { isFollowing, toggleFollow, isPending } = useFollows(viewer);

  const query = useQuery({
    queryKey: ['social', 'creator', targetLower],
    enabled: Boolean(target),
    queryFn: async ({ signal }): Promise<Social> => {
      const qs = viewer ? `?viewer=${encodeURIComponent(viewer)}` : '';
      const res = await api.fetch(`/api/creators/${encodeURIComponent(target)}/social${qs}`, {
        signal,
        ...(viewer ? { userAddress: viewer } : {}),
      });
      if (!res.ok) {
        return {
          creator: target,
          followers: 0,
          following: 0,
          isFollowed: false,
        };
      }
      const raw = await res.json();
      return {
        creator: String(raw.creator ?? target),
        followers: Number(raw.followersCount ?? raw.followers ?? 0),
        following: Number(raw.followingCount ?? 0),
        isFollowed: Boolean(raw.following ?? raw.isFollowed),
      };
    },
    staleTime: 15_000,
  });

  const stats: Social = useMemo(() => {
    const base = query.data ?? {
      creator: target,
      followers: 0,
      following: 0,
      isFollowed: false,
    };
    return {
      ...base,
      isFollowed: viewer ? isFollowing(target) || base.isFollowed : false,
    };
  }, [query.data, target, viewer, isFollowing]);

  return {
    stats,
    isLoading: query.isLoading,
    toggleFollow: (e?: React.MouseEvent) => toggleFollow(target, e),
    isFollowPending: isPending,
  };
}

export function useSongComments(songId?: string | null, userAddress?: string | null) {
  const id = songId?.trim() || '';
  const addr = userAddress?.trim() || '';
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['social', 'comments', id],
    enabled: Boolean(id),
    queryFn: async ({ signal }): Promise<Comment[]> => {
      if (!id) return [];
      const res = await api.fetch(`/api/songs/${encodeURIComponent(id)}/comments`, { signal });
      if (!res.ok) return [];
      const data = await res.json();
      const rows = Array.isArray(data) ? data : Array.isArray(data?.comments) ? data.comments : [];
      return rows.map((r: any) => ({
        id: String(r.id),
        song_id: String(r.song_id ?? id),
        author: String(r.author),
        author_nickname: r.author_nickname ?? r.authorNickname ?? null,
        author_avatar: r.author_avatar ?? r.authorAvatar ?? null,
        timestamp_sec: Number(r.timestamp_sec ?? r.timestampSec ?? 0),
        body: String(r.body ?? ''),
        created_at: String(r.created_at ?? new Date().toISOString()),
      }));
    },
    staleTime: 10_000,
  });

  const addMutation = useMutation({
    mutationFn: async (payload: { timestampSec: number; body: string }) => {
      if (!addr) {
        toast.error('Connect account to post a timed comment');
        throw new Error('Not authenticated');
      }
      const res = await api.fetch(`/api/songs/${encodeURIComponent(id)}/comments`, {
        method: 'POST',
        userAddress: addr,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timestampSec: payload.timestampSec,
          body: payload.body,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Could not post comment');
      }
      const r = await res.json();
      return {
        id: String(r.id),
        song_id: String(r.song_id ?? id),
        author: String(r.author ?? addr),
        author_nickname: r.author_nickname ?? r.authorNickname ?? null,
        author_avatar: r.author_avatar ?? r.authorAvatar ?? null,
        timestamp_sec: Number(r.timestamp_sec ?? r.timestampSec ?? payload.timestampSec),
        body: String(r.body ?? payload.body),
        created_at: String(r.created_at ?? new Date().toISOString()),
      } as Comment;
    },
    onSuccess: (created) => {
      queryClient.setQueryData<Comment[]>(['social', 'comments', id], (old = []) => {
        const next = [...old, created];
        next.sort((a, b) => a.timestamp_sec - b.timestamp_sec);
        return next;
      });
      queryClient.setQueryData<Song[]>(['songs', 'public'], (old) => {
        if (!Array.isArray(old)) return old;
        return old.map((s) =>
          s.id === id ? { ...s, comments_count: (s.comments_count ?? 0) + 1 } : s
        );
      });
    },
    onError: (err: any) => {
      if (err?.message && err.message !== 'Not authenticated') {
        toast.error(err.message);
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (commentId: string) => {
      if (!addr) throw new Error('Not authenticated');
      const res = await api.fetch(
        `/api/songs/${encodeURIComponent(id)}/comments/${encodeURIComponent(commentId)}`,
        {
          method: 'DELETE',
          userAddress: addr,
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Could not delete comment');
      }
      return commentId;
    },
    onSuccess: (deletedId) => {
      queryClient.setQueryData<Comment[]>(['social', 'comments', id], (old = []) =>
        old.filter((c) => c.id !== deletedId)
      );
      queryClient.setQueryData<Song[]>(['songs', 'public'], (old) => {
        if (!Array.isArray(old)) return old;
        return old.map((s) =>
          s.id === id ? { ...s, comments_count: Math.max(0, (s.comments_count ?? 1) - 1) } : s
        );
      });
    },
  });

  return {
    comments: query.data ?? [],
    isLoading: query.isLoading,
    addComment: addMutation.mutateAsync,
    isPosting: addMutation.isPending,
    deleteComment: deleteMutation.mutateAsync,
  };
}
