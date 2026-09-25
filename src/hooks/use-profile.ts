import { useState, useEffect, useCallback } from 'react';
import { readCachedProfile, writeCachedProfile, readCachedAccount, writeCachedAccount } from '@/lib/cache';
import { sdk } from '@/lib/sdk';
import { toast } from 'sonner';

export interface UserProfile {
  nickname: string | null;
  avatar: string | null;
}

export function useProfile(address?: string | null) {
  const [profile, setProfile] = useState<UserProfile>(() => {
    if (!address) {
      const cachedAcc = readCachedAccount();
      return {
        nickname: cachedAcc?.nickname ?? null,
        avatar: cachedAcc?.avatar ?? null,
      };
    }
    const cached = readCachedProfile(address);
    if (cached) {
      return {
        nickname: cached.nickname ?? null,
        avatar: cached.avatar ?? null,
      };
    }
    const cachedAcc = readCachedAccount();
    if (cachedAcc?.address?.toLowerCase() === address.toLowerCase()) {
      return {
        nickname: cachedAcc.nickname ?? null,
        avatar: cachedAcc.avatar ?? null,
      };
    }
    return { nickname: null, avatar: null };
  });

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!address) return;

    // Sync immediately from cache if available for this address
    const cached = readCachedProfile(address);
    if (cached) {
      setProfile({
        nickname: cached.nickname ?? null,
        avatar: cached.avatar ?? null,
      });
    }

    const handler = (e: Event) => {
      const custom = e as CustomEvent<{ address: string; nickname?: string | null; avatar?: string | null }>;
      if (custom.detail?.address?.toLowerCase() === address.toLowerCase()) {
        setProfile({
          nickname: custom.detail.nickname ?? null,
          avatar: custom.detail.avatar ?? null,
        });
      }
    };
    window.addEventListener('rawchunks:profile', handler);

    let active = true;
    setLoading(true);

    sdk.fetch(`/api/user/${encodeURIComponent(address)}`)
      .then(async (res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data) => {
        if (!active || !data) return;
        const newNick = data.nickname ?? null;
        const newAv = data.avatar ?? null;
        setProfile({ nickname: newNick, avatar: newAv });
        writeCachedProfile(address, { nickname: newNick, avatar: newAv });
        const cachedAcc = readCachedAccount();
        if (cachedAcc && cachedAcc.address.toLowerCase() === address.toLowerCase()) {
          writeCachedAccount(cachedAcc.address, cachedAcc.network, cachedAcc.svmAddress, newNick, newAv);
        }
      })
      .catch(() => {
        // Soft fail on network/offline — cached data is preserved
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
    async (next: { nickname?: string | null; avatar?: string | null }) => {
      if (!address) throw new Error('No active address to update profile');

      const prev = { ...profile };
      const nextNick = next.nickname !== undefined ? next.nickname : prev.nickname;
      const nextAv = next.avatar !== undefined ? next.avatar : prev.avatar;

      // Optimistic update
      setProfile({ nickname: nextNick, avatar: nextAv });
      writeCachedProfile(address, { nickname: nextNick, avatar: nextAv });
      const cachedAcc = readCachedAccount();
      if (cachedAcc && cachedAcc.address.toLowerCase() === address.toLowerCase()) {
        writeCachedAccount(cachedAcc.address, cachedAcc.network, cachedAcc.svmAddress, nextNick, nextAv);
      }
      window.dispatchEvent(
        new CustomEvent('rawchunks:profile', {
          detail: { address, nickname: nextNick, avatar: nextAv },
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
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Failed to save profile');
        }

        const data = await res.json();
        const serverNick = data.nickname ?? nextNick;
        const serverAv = data.avatar ?? nextAv;
        setProfile({ nickname: serverNick, avatar: serverAv });
        writeCachedProfile(address, { nickname: serverNick, avatar: serverAv });
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
    loading,
    updateProfile,
  };
}
