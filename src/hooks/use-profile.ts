import { useState, useEffect, useCallback } from 'react';
import { readCachedProfile, writeCachedProfile, SocialLinkRecord, SocialPlatform } from '@/lib/cache';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export type { SocialLinkRecord, SocialPlatform };

export interface UserProfile {
  nickname: string | null;
  avatar: string | null;
  bio: string | null;
  banner: string | null;
  socials: SocialLinkRecord[];
}

export interface WalletPairProfile {
  evmAddress: string;
  svmAddress: string;
  nickname?: string | null;
  avatar?: string | null;
  bio?: string | null;
  banner?: string | null;
  socials?: SocialLinkRecord[];
}

const inFlightUsers = new Map<string, Promise<WalletPairProfile | null>>();

export function fetchUserProfile(addressOrHandle: string): Promise<WalletPairProfile | null> {
  const normalized = addressOrHandle.trim().toLowerCase();
  const existing = inFlightUsers.get(normalized);
  if (existing) return existing;

  const promise = api.fetch(`/api/user/${encodeURIComponent(addressOrHandle.trim())}`)
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
    const res = await api.fetch(`/api/users?addresses=${encodeURIComponent(unique.join(','))}`);
    if (!res.ok) return [];
    const data = await res.json();
    const users: WalletPairProfile[] = Array.isArray(data)
      ? data
      : Array.isArray(data?.users)
        ? data.users
        : [];
    for (const u of users) {
      const profile = {
        nickname: u.nickname ?? null,
        avatar: u.avatar ?? null,
        bio: u.bio ?? null,
        banner: u.banner ?? null,
        socials: Array.isArray(u.socials) ? u.socials : [],
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
      return { nickname: null, avatar: null, bio: null, banner: null, socials: [] };
    }
    const cached = readCachedProfile(address);
    if (cached) {
      return {
        nickname: cached.nickname ?? null,
        avatar: cached.avatar ?? null,
        bio: cached.bio ?? null,
        banner: cached.banner ?? null,
        socials: Array.isArray(cached.socials) ? cached.socials : [],
      };
    }
    return { nickname: null, avatar: null, bio: null, banner: null, socials: [] };
  });

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!address) {
      setProfile({ nickname: null, avatar: null, bio: null, banner: null, socials: [] });
      setLoading(false);
      return;
    }

    // Sync immediately from cache if available for this address
    const cached = readCachedProfile(address);
    setProfile({
      nickname: cached?.nickname ?? null,
      avatar: cached?.avatar ?? null,
      bio: cached?.bio ?? null,
      banner: cached?.banner ?? null,
      socials: Array.isArray(cached?.socials) ? cached!.socials : [],
    });

    const handler = (e: Event) => {
      const custom = e as CustomEvent<{
        address: string;
        nickname?: string | null;
        avatar?: string | null;
        bio?: string | null;
        banner?: string | null;
        socials?: SocialLinkRecord[];
      }>;
      if (custom.detail?.address?.toLowerCase() === address.toLowerCase()) {
        setProfile((prev) => ({
          nickname: custom.detail.nickname !== undefined ? (custom.detail.nickname ?? null) : prev.nickname,
          avatar: custom.detail.avatar !== undefined ? (custom.detail.avatar ?? null) : prev.avatar,
          bio: custom.detail.bio !== undefined ? (custom.detail.bio ?? null) : prev.bio,
          banner: custom.detail.banner !== undefined ? (custom.detail.banner ?? null) : prev.banner,
          socials: Array.isArray(custom.detail.socials) ? custom.detail.socials : prev.socials,
        }));
      }
    };
    window.addEventListener('rawchunks:profile', handler);

    let active = true;
    setLoading(true);

    fetchUserProfile(address)
      .then((data) => {
        if (!active || !data) return;
        const nextProfile: UserProfile = {
          nickname: data.nickname ?? null,
          avatar: data.avatar ?? null,
          bio: data.bio ?? null,
          banner: data.banner ?? null,
          socials: Array.isArray(data.socials) ? data.socials : [],
        };
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
    async (next: {
      nickname?: string | null;
      avatar?: string | null;
      bio?: string | null;
      banner?: string | null;
      socials?: SocialLinkRecord[];
    }) => {
      if (!address) throw new Error('No active address to update profile');

      const prev = { ...profile };
      const nextNick = next.nickname !== undefined ? next.nickname : prev.nickname;
      const nextAv = next.avatar !== undefined ? next.avatar : prev.avatar;
      const nextBio = next.bio !== undefined ? next.bio : prev.bio;
      const nextBanner = next.banner !== undefined ? next.banner : prev.banner;
      const nextSocials = next.socials !== undefined ? next.socials : prev.socials;

      const optimistic: UserProfile = {
        nickname: nextNick,
        avatar: nextAv,
        bio: nextBio,
        banner: nextBanner,
        socials: nextSocials,
      };

      // Optimistic update
      setProfile(optimistic);
      writeCachedProfile(address, optimistic);
      window.dispatchEvent(
        new CustomEvent('rawchunks:profile', {
          detail: { address, ...optimistic },
        })
      );

      try {
        const res = await api.fetch('/api/user/profile', {
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
            banner: nextBanner,
            socials: nextSocials,
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Failed to save profile');
        }

        const data = await res.json();
        const confirmed: UserProfile = {
          nickname: data.nickname ?? nextNick,
          avatar: data.avatar ?? nextAv,
          bio: data.bio ?? nextBio,
          banner: data.banner !== undefined ? data.banner : nextBanner,
          socials: Array.isArray(data.socials) ? data.socials : nextSocials,
        };
        setProfile(confirmed);
        writeCachedProfile(address, confirmed);
        window.dispatchEvent(
          new CustomEvent('rawchunks:profile', {
            detail: { address, ...confirmed },
          })
        );
        toast.success('Profile updated');
        return data;
      } catch (err: any) {
        // Rollback on failure
        setProfile(prev);
        writeCachedProfile(address, prev);
        window.dispatchEvent(
          new CustomEvent('rawchunks:profile', {
            detail: { address, ...prev },
          })
        );
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
    banner: profile.banner,
    socials: profile.socials,
    loading,
    updateProfile,
  };
}
