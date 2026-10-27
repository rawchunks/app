import { useState, useEffect, useCallback } from 'react';
import { readCachedProfile, writeCachedProfile } from '@/lib/cache';
import { sdk } from '@/lib/sdk';
import { toast } from 'sonner';

export interface UserProfile {
  nickname: string | null;
  avatar: string | null;
  bio: string | null;
}

export interface WalletPairProfile {
  evmAddress: string;
  svmAddress: string;
  nickname?: string | null;
  avatar?: string | null;
  bio?: string | null;
}

const inFlightUsers = new Map<string, Promise<WalletPairProfile | null>>();

function fetchUserProfile(address: string): Promise<WalletPairProfile | null> {
  const normalized = address.toLowerCase();
  const existing = inFlightUsers.get(normalized);
  if (existing) return existing;

  const promise = sdk.fetch(`/api/user/${encodeURIComponent(address)}`)
    .then(async (res) => {
      if (!res.ok) return null;
      return res.json();
    })
    .catch(() => null)
    .finally(() => {
      inFlightUsers.delete(normalized);
    });

  inFlightUsers.set(normalized, promise);
  return promise;
}

export async function fetchUserProfilesBatch(addresses: string[]): Promise<WalletPairProfile[]> {
  const unique = Array.from(new Set(addresses.filter(Boolean).map(a => a.trim())));
  if (!unique.length) return [];
  try {
    const res = await sdk.fetch(`/api/users?addresses=${encodeURIComponent(unique.join(','))}`);
    if (!res.ok) return [];
    const data = await res.json();
    const users: WalletPairProfile[] = Array.isArray(data?.users) ? data.users : [];
    for (const u of users) {
      const profile = {
        nickname: u.nickname ?? null,
        avatar: u.avatar ?? null,
        bio: u.bio ?? null,
      };
      if (u.evmAddress) {
        writeCachedProfile(u.evmAddress, profile);
        window.dispatchEvent(new CustomEvent('rawchunks:profile', { detail: { address: u.evmAddress, ...profile } }));
      }
      if (u.svmAddress && !u.svmAddress.startsWith('svm_pending_')) {
        writeCachedProfile(u.svmAddress, profile);
        window.dispatchEvent(new CustomEvent('rawchunks:profile', { detail: { address: u.svmAddress, ...profile } }));
      }
    }
    return users;
  } catch {
    return [];
  }
}

export function useProfile(address?: string | null) {
  const [profile, setProfile] = useState<UserProfile>(() => {
    if (!address) {
      return { nickname: null, avatar: null, bio: null };
    }
    const cached = readCachedProfile(address);
    if (cached) {
      return {
        nickname: cached.nickname ?? null,
        avatar: cached.avatar ?? null,
        bio: cached.bio ?? null,
      };
    }
    return { nickname: null, avatar: null, bio: null };
  });

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!address) {
      setProfile({ nickname: null, avatar: null, bio: null });
      setLoading(false);
      return;
    }

    // Sync immediately from cache if available for this address
    const cached = readCachedProfile(address);
    setProfile({
      nickname: cached?.nickname ?? null,
      avatar: cached?.avatar ?? null,
      bio: cached?.bio ?? null,
    });

    const handler = (e: Event) => {
      const custom = e as CustomEvent<{ address: string; nickname?: string | null; avatar?: string | null; bio?: string | null }>;
      if (custom.detail?.address?.toLowerCase() === address.toLowerCase()) {
        setProfile({
          nickname: custom.detail.nickname ?? null,
          avatar: custom.detail.avatar ?? null,
          bio: custom.detail.bio ?? null,
        });
      }
    };
    window.addEventListener('rawchunks:profile', handler);

    let active = true;
    setLoading(true);

    fetchUserProfile(address)
      .then((data) => {
        if (!active || !data) return;
        const newNick = data.nickname ?? null;
        const newAv = data.avatar ?? null;
        const newBio = data.bio ?? null;
        const nextProfile = { nickname: newNick, avatar: newAv, bio: newBio };
        setProfile(nextProfile);
        writeCachedProfile(address, nextProfile);
        if (data.evmAddress) writeCachedProfile(data.evmAddress, nextProfile);
        if (data.svmAddress && !data.svmAddress.startsWith('svm_pending_')) writeCachedProfile(data.svmAddress, nextProfile);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      window.removeEventListener('rawchunks:profile', handler);
    };
  }, [address]);

  const updateProfile = useCallback(
    async (next: { nickname?: string | null; avatar?: string | null; bio?: string | null }) => {
      if (!address) throw new Error('No active address to update profile');

      const prev = { ...profile };
      const nextNick = next.nickname !== undefined ? next.nickname : prev.nickname;
      const nextAv = next.avatar !== undefined ? next.avatar : prev.avatar;
      const nextBio = next.bio !== undefined ? next.bio : prev.bio;

      // Optimistic update
      setProfile({ nickname: nextNick, avatar: nextAv, bio: nextBio });
      writeCachedProfile(address, { nickname: nextNick, avatar: nextAv, bio: nextBio });
      window.dispatchEvent(
        new CustomEvent('rawchunks:profile', {
          detail: { address, nickname: nextNick, avatar: nextAv, bio: nextBio },
        })
      );

      try {
        const res = await sdk.fetch('/api/user/profile', {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
            'x-session-user-address': address,
          },
          body: JSON.stringify({
            address,
            nickname: nextNick,
            avatar: nextAv,
            bio: nextBio,
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Failed to save profile');
        }

        const data = await res.json();
        const serverNick = data.nickname ?? nextNick;
        const serverAv = data.avatar ?? nextAv;
        const serverBio = data.bio ?? nextBio;
        setProfile({ nickname: serverNick, avatar: serverAv, bio: serverBio });
        writeCachedProfile(address, { nickname: serverNick, avatar: serverAv, bio: serverBio });
        toast.success('Profile updated');
        return data;
      } catch (err: any) {
        // Rollback on failure
        setProfile(prev);
        writeCachedProfile(address, prev);
        toast.error(err.message || 'Failed to update profile');
        throw err;
      }
    },
    [address, profile]
  );

  return {
    nickname: profile.nickname,
    avatar: profile.avatar,
    bio: profile.bio,
    loading,
    updateProfile,
  };
}
