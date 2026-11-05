import { useGuideOwner, prepareViews } from '../components/guide/owners';
import { useDismiss } from '../hooks/use-dismiss';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import {
  User,
  Users,
  UserPlus,
  UserCheck,
  Search,
  X,
  Music,
  Headphones,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  RotateCcw,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Check,
  Sparkles,
  Flame,
  ListMusic,
  Disc3,
  Play,
  Pause,
  Plus,
  Heart,
  Share2,
  ArrowLeft,
  SlidersHorizontal,
  Trash2,
  Copy,
} from 'lucide-react';
import { Glitch } from '../components/glitch';
import { Button } from '../components/button';
import { Modal } from '../components/modal';
import { Tooltip } from '../components/daw/Tooltip';
import { Card, normalizeTags, getGenreCoverImage, normalizeGenreSlug } from '../components/songs/card';
import { Row } from '../components/songs/row';
import { Timeline } from '../components/songs/timeline';
import { store } from '../lib/store';
import { useSongs, useMarketFolds, usePaginatedSongs } from '../hooks/use-songs';
import { useGenreCovers } from '../hooks/use-genres';
import { usePublicAlbums } from '../hooks/use-albums';
import {
  usePublicPlaylists,
  useCreatorPlaylists,
  createPlaylistApi,
  removeSongFromPlaylistApi,
  deletePlaylistApi,
  recordPlaylistPlayApi,
} from '../hooks/use-playlists';
import { useLikes, useFollows, useCreatorSocial } from '../hooks/use-social';
import { useSelectedUserAddress } from '../hooks/use-address';
import {
  fetchUserProfile,
  fetchUserProfilesBatch,
  type WalletPairProfile,
  type SocialLinkRecord,
} from '../hooks/use-profile';
import {
  CreatorProfileCard,
  sanitizeCreatorNickname,
} from '../components/profile';
import { readCachedProfile } from '../lib/cache';
import { groupSongs } from '../lib/versions';
import { openGate } from '../lib/gate';
import { marketCreator, marketPath } from '../lib/routes';
import { songToShareData, type MintShareData } from '../lib/share';
import { ShareModal, ShareUrlModal } from '../components/share';
import { useQueryClient } from '@tanstack/react-query';
import type { Song, Album, Playlist } from '../lib/schema';

export interface Props {
  className?: string;
}

interface CreatorGroup {
  key: string;
  label: string;
  nicknameKey: string | null;
  avatar: string | null;
  bio: string | null;
  banner: string | null;
  socials: SocialLinkRecord[];
  addresses: Set<string>;
}

type SnapStageId = 'pulse' | 'discovery' | 'collections';

function findCreatorGroup(groups: CreatorGroup[], rawCreator: string | null): CreatorGroup | null {
  if (!rawCreator) return null;
  const lower = rawCreator.trim().replace(/^@+/, '').trim().toLowerCase();
  if (!lower) return null;
  return (
    groups.find(
      (g) =>
        g.key === lower ||
        g.addresses.has(lower) ||
        (g.nicknameKey !== null && g.nicknameKey === lower)
    ) ?? null
  );
}

const formatShortAddr = (addr?: string | null): string => {
  if (!addr) return '—';
  return addr.startsWith('0x')
    ? `${addr.slice(0, 6)}…${addr.slice(-4)}`
    : `${addr.slice(0, 4)}…${addr.slice(-4)}`;
};

export const Market: React.FC<Props> = ({ className = '' }) => {
  const { readAddress } = useSelectedUserAddress();
  const queryClient = useQueryClient();

  const [playing, setPlaying] = useState(() => ({
    id: store.getState().activeSong?.id,
    active: store.getState().isPlaying,
    playlistId: store.getState().activePlaylistId,
    contextId: store.getState().activeContextId,
  }));
  const [selectedCreator, setSelectedCreator] = useState<string | null>(() =>
    marketCreator(window.location.pathname)
  );
  const [shareData, setShareData] = useState<MintShareData | null>(null);
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null);
  const [likedOnly, setLikedOnly] = useState(false);
  const [followingOnly, setFollowingOnly] = useState(false);
  const [order, setOrder] = useState<'latest' | 'oldest'>('latest');
  const [creatorShareOpen, setCreatorShareOpen] = useState(false);
  const [search, setSearch] = useState<string>('');
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [selected, setSelected] = useState<Record<string, string>>({});

  // Vertical Snap-Deck Stage & In-Stage Pagination
  const [activeStage, setActiveStage] = useState<SnapStageId>('pulse');
  const [pulseMobileTab, setPulseMobileTab] = useState<'new' | 'popular'>('new');
  const [pulseRightMode, setPulseRightMode] = useState<'popular' | 'liked'>('popular');
  const [pulseNewFollowingOnly, setPulseNewFollowingOnly] = useState(false);
  const [newPage, setNewPage] = useState(0);
  const [popularPage, setPopularPage] = useState(0);
  const [genrePage, setGenrePage] = useState(0);
  const [creatorPage, setCreatorPage] = useState(0);
  const [albumPage, setAlbumPage] = useState(0);
  const [playlistPage, setPlaylistPage] = useState(0);

  const [batchSize, setBatchSize] = useState<20 | 50 | 100>(20);
  const [pollIntervalMin, setPollIntervalMin] = useState<15 | 30 | 60>(60);
  const [feedConfigOpen, setFeedConfigOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState<number>(20);

  const [creatorOpen, setCreatorOpen] = useState(false);
  const [creatorQuery, setCreatorQuery] = useState('');
  const [genreOpen, setGenreOpen] = useState(false);
  const [genreQuery, setGenreQuery] = useState('');

  // Playlist creation & expanded playlist state
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);
  const [expandedPlaylistId, setExpandedPlaylistId] = useState<string | null>(null);
  const [showShelfPlaylistCreate, setShowShelfPlaylistCreate] = useState(false);
  const [shelfPlaylistTitle, setShelfPlaylistTitle] = useState('');

  const snapDeckRef = useRef<HTMLDivElement>(null);
  const stagePulseRef = useRef<HTMLElement>(null);
  const stageDiscoveryRef = useRef<HTMLElement>(null);
  const stageCollectionsRef = useRef<HTMLElement>(null);
  const creatorPopoverRef = useRef<HTMLDivElement>(null);
  const genrePopoverRef = useRef<HTMLDivElement>(null);
  const feedConfigRef = useRef<HTMLDivElement>(null);

  // Social Hooks (Likes, Follows)
  const { likedSongIds: likedIds, isLiked } = useLikes(readAddress);
  const { followedCreators: following, isFollowing, toggleFollow } = useFollows(readAddress);

  const { data: cachedPublicSongs = [], isPending: isSongsPending, error } = useSongs();
  const { data: foldsData, isPending: isFoldsPending } = useMarketFolds(
    batchSize,
    pollIntervalMin * 60 * 1000,
    pollIntervalMin
  );
  const { data: paginatedData } = usePaginatedSongs({
    sort: 'new',
    limit: Math.max(visibleCount * 2, 50),
    offset: 0,
    genre: selectedGenres.length === 1 ? selectedGenres[0] : undefined,
    creator:
      selectedCreator && (selectedCreator.startsWith('0x') || selectedCreator.length >= 32)
        ? selectedCreator
        : undefined,
    search: search.trim() || undefined,
    enabled: Boolean(
      selectedCreator || selectedGenres.length > 0 || selectedAlbumId || search.trim() || order === 'oldest'
    ),
  });
  const { data: publicAlbums = [] } = usePublicAlbums();
  const { data: publicPlaylists = [] } = usePublicPlaylists(50);
  useCreatorPlaylists(readAddress);

  const publicSongs = useMemo<Song[]>(() => {
    const map = new Map<string, Song>();
    for (const s of cachedPublicSongs) {
      if (s && s.id) map.set(s.id, s);
    }
    if (foldsData) {
      for (const s of foldsData.newReleases?.songs || []) {
        if (s && s.id) map.set(s.id, s);
      }
      for (const s of foldsData.popular?.songs || []) {
        if (s && s.id) map.set(s.id, s);
      }
      for (const g of foldsData.genres || []) {
        for (const s of g.songs || []) {
          if (s && s.id) map.set(s.id, s);
        }
      }
      for (const c of foldsData.creators || []) {
        for (const s of c.songs || []) {
          if (s && s.id) map.set(s.id, s);
        }
      }
    }
    if (paginatedData?.items) {
      for (const s of paginatedData.items) {
        if (s && s.id) map.set(s.id, s);
      }
    }
    return Array.from(map.values());
  }, [cachedPublicSongs, foldsData, paginatedData]);

  const isPending = isSongsPending && isFoldsPending && publicSongs.length === 0;
  const totalPublicCount = foldsData?.newReleases?.total ?? paginatedData?.total ?? publicSongs.length;

  useEffect(() => {
    setVisibleCount(batchSize);
  }, [batchSize, selectedCreator, selectedGenres, selectedAlbumId, search, likedOnly, followingOnly]);

  useEffect(() => {
    return store.subscribe((state) => {
      setPlaying((current) =>
        current.id === state.activeSong?.id &&
          current.active === state.isPlaying &&
          current.playlistId === state.activePlaylistId &&
          current.contextId === state.activeContextId
          ? current
          : {
            id: state.activeSong?.id,
            active: state.isPlaying,
            playlistId: state.activePlaylistId,
            contextId: state.activeContextId,
          }
      );
    });
  }, []);

  useDismiss(creatorOpen, () => setCreatorOpen(false), creatorPopoverRef);
  useDismiss(genreOpen, () => setGenreOpen(false), genrePopoverRef);
  useDismiss(feedConfigOpen, () => setFeedConfigOpen(false), feedConfigRef);

  const albumsMap = useMemo(() => {
    const map = new Map<string, Album>();
    for (const album of publicAlbums) {
      map.set(album.id, album);
    }
    return map;
  }, [publicAlbums]);

  const songsById = useMemo(() => {
    const map = new Map<string, Song>();
    for (const s of publicSongs) {
      map.set(s.id, s);
    }
    return map;
  }, [publicSongs]);

  // Extract unique creators & batch-resolve paired identities + nicknames + bios
  const rawCreatorAddresses = useMemo(() => {
    const set = new Set<string>();
    for (const song of publicSongs) {
      if (song.creator) set.add(song.creator);
    }
    return Array.from(set);
  }, [publicSongs]);

  const [creatorPairs, setCreatorPairs] = useState<WalletPairProfile[]>([]);

  useEffect(() => {
    if (!rawCreatorAddresses.length) return;
    let active = true;
    fetchUserProfilesBatch(rawCreatorAddresses).then((users) => {
      if (active) setCreatorPairs(users);
    });
    return () => {
      active = false;
    };
  }, [rawCreatorAddresses]);

  const creatorGroups = useMemo<CreatorGroup[]>(() => {
    const pairByAddr = new Map<string, WalletPairProfile>();
    for (const p of creatorPairs) {
      if (p.evmAddress) pairByAddr.set(p.evmAddress.toLowerCase(), p);
      if (p.svmAddress) pairByAddr.set(p.svmAddress.toLowerCase(), p);
    }

    const groups: CreatorGroup[] = [];

    for (const raw of rawCreatorAddresses) {
      const lower = raw.toLowerCase();
      const pair = pairByAddr.get(lower);
      const cached = readCachedProfile(raw);
      const rawNickname = sanitizeCreatorNickname(
        pair?.nickname?.trim() || cached?.nickname?.trim() || null,
        raw
      );
      const rawAvatar = pair?.avatar?.trim() || cached?.avatar?.trim() || null;
      const rawBio = pair?.bio?.trim() || cached?.bio?.trim() || null;
      const rawBanner = pair?.banner?.trim() || cached?.banner?.trim() || null;
      const rawSocials = Array.isArray(pair?.socials)
        ? pair!.socials
        : Array.isArray(cached?.socials)
          ? cached!.socials
          : [];
      const nicknameKey = rawNickname ? rawNickname.toLowerCase() : null;

      const candidateAddresses = new Set<string>([lower]);
      if (pair?.evmAddress) candidateAddresses.add(pair.evmAddress.toLowerCase());
      if (pair?.svmAddress) candidateAddresses.add(pair.svmAddress.toLowerCase());

      const shortAddr = formatShortAddr(raw);

      const existing = groups.find(
        (g) =>
          Array.from(candidateAddresses).some((addr) => g.addresses.has(addr)) ||
          (nicknameKey !== null && g.nicknameKey === nicknameKey)
      );

      if (existing) {
        for (const addr of candidateAddresses) {
          existing.addresses.add(addr);
        }
        if (rawNickname && !existing.nicknameKey) {
          existing.label = rawNickname;
          existing.nicknameKey = nicknameKey;
        }
        if (rawAvatar && !existing.avatar) {
          existing.avatar = rawAvatar;
        }
        if (rawBio && !existing.bio) {
          existing.bio = rawBio;
        }
        if (rawBanner && !existing.banner) {
          existing.banner = rawBanner;
        }
        if (rawSocials.length > 0 && existing.socials.length === 0) {
          existing.socials = rawSocials;
        }
      } else {
        const canonicalKey =
          pair?.evmAddress?.toLowerCase() || pair?.svmAddress?.toLowerCase() || lower;
        groups.push({
          key: canonicalKey,
          label: rawNickname || shortAddr,
          nicknameKey,
          avatar: rawAvatar,
          bio: rawBio,
          banner: rawBanner,
          socials: rawSocials,
          addresses: candidateAddresses,
        });
      }
    }

    return groups.sort((a, b) => a.label.localeCompare(b.label));
  }, [rawCreatorAddresses, creatorPairs]);

  const resolveCreatorLabel = (address: string) => {
    if (!address) return 'ANONYMOUS';
    const lower = address.toLowerCase();
    const found = creatorGroups.find((g) => g.addresses.has(lower));
    if (found) return found.label;
    return formatShortAddr(address);
  };

  const handleSelectCreatorAddress = (rawAddress: string) => {
    const group = findCreatorGroup(creatorGroups, rawAddress);
    const targetSlug = group ? (group.nicknameKey ? group.label : group.key) : rawAddress;
    setSelectedCreator((prev) => {
      if (!prev) return targetSlug;
      const prevGroup = findCreatorGroup(creatorGroups, prev);
      if (group && prevGroup && group.key === prevGroup.key) return null;
      return prev.toLowerCase() === targetSlug.toLowerCase() ? null : targetSlug;
    });
  };

  const uniqueGenres = useMemo(() => {
    const map = new Map<string, string>();
    for (const song of publicSongs) {
      for (const tag of normalizeTags(song.tags)) {
        const key = tag.toLowerCase();
        if (!map.has(key)) {
          map.set(key, tag);
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => a.localeCompare(b));
  }, [publicSongs]);

  const filteredCreatorGroups = useMemo(() => {
    const q = creatorQuery.trim().toLowerCase();
    if (!q) return creatorGroups;
    return creatorGroups.filter(
      (g) =>
        g.label.toLowerCase().includes(q) ||
        Array.from(g.addresses).some((addr) => addr.includes(q))
    );
  }, [creatorGroups, creatorQuery]);

  const filteredGenres = useMemo(() => {
    const q = genreQuery.trim().toLowerCase();
    if (!q) return uniqueGenres;
    return uniqueGenres.filter((g) => g.toLowerCase().includes(q));
  }, [uniqueGenres, genreQuery]);

  const toggleGenre = (genre: string) => {
    setSelectedGenres((prev) => {
      const lower = genre.toLowerCase();
      const exists = prev.some((g) => g.toLowerCase() === lower);
      if (exists) {
        return prev.filter((g) => g.toLowerCase() !== lower);
      }
      return [...prev, genre];
    });
  };

  // All followed creator addresses (expanded via creatorGroups wallet pairs)
  const followedAddressSet = useMemo(() => {
    const set = new Set<string>();
    for (const f of following) {
      const lower = f.toLowerCase();
      set.add(lower);
      const grp = findCreatorGroup(creatorGroups, lower);
      if (grp) {
        for (const addr of grp.addresses) set.add(addr);
      }
    }
    return set;
  }, [following, creatorGroups]);

  // Apply filters and ordering
  const displayedSongs = useMemo(() => {
    let list = [...publicSongs];

    if (selectedAlbumId) {
      list = list.filter((s) => s.album_id === selectedAlbumId);
    }

    if (selectedCreator) {
      const lower = selectedCreator.trim().replace(/^@+/, '').trim().toLowerCase();
      const group = findCreatorGroup(creatorGroups, selectedCreator);
      const targetAddresses = group ? group.addresses : new Set([lower]);
      list = list.filter(
        (s) =>
          Boolean(s.creator && targetAddresses.has(s.creator.toLowerCase())) ||
          Boolean(group && s.creator && group.addresses.has(s.creator.toLowerCase()))
      );
      list.sort((a, b) => {
        const tsA = a.published_at || a.created_at;
        const tsB = b.published_at || b.created_at;
        const timeA = tsA ? new Date(tsA).getTime() : 0;
        const timeB = tsB ? new Date(tsB).getTime() : 0;
        return timeB - timeA;
      });
      return list;
    }

    if (likedOnly) {
      list = list.filter((s) => isLiked(s.id));
    }

    if (followingOnly) {
      list = list.filter((s) => Boolean(s.creator && followedAddressSet.has(s.creator.toLowerCase())));
    }

    if (selectedGenres.length > 0) {
      const targetSet = new Set(selectedGenres.map((g) => g.toLowerCase()));
      list = list.filter((s) =>
        normalizeTags(s.tags).some((t) => targetSet.has(t.toLowerCase()))
      );
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((s) => {
        const group = creatorGroups.find((g) => s.creator && g.addresses.has(s.creator.toLowerCase()));
        return (
          s.title.toLowerCase().includes(q) ||
          normalizeTags(s.tags).some((t) => t.toLowerCase().includes(q)) ||
          s.creator.toLowerCase().includes(q) ||
          Boolean(group?.label.toLowerCase().includes(q))
        );
      });
    }

    list.sort((a, b) => {
      const tsA = a.published_at || a.created_at;
      const tsB = b.published_at || b.created_at;
      const timeA = tsA ? new Date(tsA).getTime() : 0;
      const timeB = tsB ? new Date(tsB).getTime() : 0;
      return order === 'latest' ? timeB - timeA : timeA - timeB;
    });

    return list;
  }, [
    publicSongs,
    selectedAlbumId,
    selectedCreator,
    likedOnly,
    followingOnly,
    followedAddressSet,
    isLiked,
    selectedGenres,
    search,
    order,
    creatorGroups,
  ]);

  const newReleasesAll = useMemo<Song[]>(() => {
    const foldSongs = foldsData?.newReleases?.songs || [];
    const seen = new Set(foldSongs.map((s) => s.id));
    const rest = publicSongs.filter((s) => !seen.has(s.id));
    return [...foldSongs, ...rest].sort((a, b) => {
      const tsA = a.published_at || a.created_at;
      const tsB = b.published_at || b.created_at;
      const tA = tsA ? new Date(tsA).getTime() : 0;
      const tB = tsB ? new Date(tsB).getTime() : 0;
      return tB - tA;
    });
  }, [foldsData, publicSongs]);

  const popularAll = useMemo<Song[]>(() => {
    const foldSongs = foldsData?.popular?.songs || [];
    const seen = new Set(foldSongs.map((s) => s.id));
    const rest = publicSongs.filter((s) => !seen.has(s.id));
    return [...foldSongs, ...rest].sort((a, b) => {
      const playsDiff = (b.plays ?? 0) - (a.plays ?? 0);
      if (playsDiff !== 0) return playsDiff;
      const tsA = a.published_at || a.created_at;
      const tsB = b.published_at || b.created_at;
      const tA = tsA ? new Date(tsA).getTime() : 0;
      const tB = tsB ? new Date(tsB).getTime() : 0;
      return tB - tA;
    });
  }, [foldsData, publicSongs]);

  const newReleaseGroups = useMemo(() => groupSongs(newReleasesAll), [newReleasesAll]);
  const popularGroups = useMemo(() => groupSongs(popularAll), [popularAll]);

  const newReleasePlayable = useMemo<Song[]>(() => {
    return newReleaseGroups.map(
      (versions) =>
        versions.find((item) => item.id === selected[versions[0].family ?? versions[0].id]) ??
        versions[0]
    );
  }, [newReleaseGroups, selected]);

  const popularPlayable = useMemo<Song[]>(() => {
    return popularGroups.map(
      (versions) =>
        versions.find((item) => item.id === selected[versions[0].family ?? versions[0].id]) ??
        versions[0]
    );
  }, [popularGroups, selected]);

  const likedPlayable = useMemo<Song[]>(() => {
    return popularPlayable.filter((s) => isLiked(s.id));
  }, [popularPlayable, isLiked]);

  const pulseNewList = useMemo<Song[]>(() => {
    if (!pulseNewFollowingOnly) return newReleasePlayable;
    return newReleasePlayable.filter(
      (s) => Boolean(s.creator && followedAddressSet.has(s.creator.toLowerCase()))
    );
  }, [newReleasePlayable, pulseNewFollowingOnly, followedAddressSet]);

  const pulseRightList = useMemo<Song[]>(() => {
    return pulseRightMode === 'liked' ? likedPlayable : popularPlayable;
  }, [pulseRightMode, likedPlayable, popularPlayable]);

  const creatorItems = useMemo(() => {
    return creatorGroups
      .map((group) => {
        const songs = popularPlayable.filter(
          (s) => s.creator && group.addresses.has(s.creator.toLowerCase())
        );
        const totalPlays = songs.reduce((sum, s) => sum + (s.plays ?? 0), 0);
        return { group, songs, totalPlays };
      })
      .filter((item) => item.songs.length > 0)
      .sort((a, b) => b.totalPlays - a.totalPlays || b.songs.length - a.songs.length);
  }, [creatorGroups, popularPlayable]);

  const genreItems = useMemo(() => {
    const map = new Map<string, { label: string; songs: Song[] }>();
    for (const song of popularPlayable) {
      for (const tag of normalizeTags(song.tags)) {
        const key = tag.toLowerCase();
        const existing = map.get(key);
        if (existing) {
          existing.songs.push(song);
        } else {
          map.set(key, { label: tag.toUpperCase(), songs: [song] });
        }
      }
    }
    return Array.from(map.entries())
      .map(([key, v]) => ({
        key,
        label: v.label,
        total: v.songs.length,
        songs: v.songs,
      }))
      .sort((a, b) => b.total - a.total);
  }, [popularPlayable]);

  const genreLabelsForCovers = useMemo(() => genreItems.map((g) => g.label), [genreItems]);
  const { data: genreCovers } = useGenreCovers(genreLabelsForCovers);

  const selectedCreatorGroup = useMemo(
    () => findCreatorGroup(creatorGroups, selectedCreator),
    [creatorGroups, selectedCreator]
  );

  const [directCreatorProfile, setDirectCreatorProfile] = useState<WalletPairProfile | null>(null);

  useEffect(() => {
    const slug = selectedCreator?.trim().replace(/^@+/, '').trim();
    if (!slug) {
      setDirectCreatorProfile(null);
      return;
    }
    let active = true;
    fetchUserProfile(slug).then((prof) => {
      if (active) setDirectCreatorProfile(prof);
    });
    return () => {
      active = false;
    };
  }, [selectedCreator]);

  const selectedCreatorCanonicalAddr = useMemo(() => {
    if (selectedCreatorGroup) return selectedCreatorGroup.key;
    if (directCreatorProfile?.evmAddress) return directCreatorProfile.evmAddress.toLowerCase();
    if (directCreatorProfile?.svmAddress) return directCreatorProfile.svmAddress.toLowerCase();
    return selectedCreator?.trim() || null;
  }, [selectedCreatorGroup, directCreatorProfile, selectedCreator]);

  const {
    stats: selectedCreatorSocial,
    toggleFollow: toggleFollowSelectedCreator,
  } = useCreatorSocial(selectedCreatorCanonicalAddr, readAddress);
  const isFollowingSelectedCreator = Boolean(selectedCreatorSocial?.isFollowed);

  const selectedCreatorLabel = useMemo(() => {
    if (!selectedCreator) return null;
    if (selectedCreatorGroup) return selectedCreatorGroup.label;
    const cleanDirect = sanitizeCreatorNickname(
      directCreatorProfile?.nickname,
      selectedCreatorCanonicalAddr || selectedCreator
    );
    if (cleanDirect) return cleanDirect;
    const raw = selectedCreator.trim();
    if ((raw.startsWith('0x') && raw.length > 14) || raw.length >= 32) {
      return formatShortAddr(raw);
    }
    return raw;
  }, [selectedCreator, selectedCreatorGroup, directCreatorProfile, selectedCreatorCanonicalAddr]);

  useEffect(() => {
    const handlePopState = () => {
      setSelectedCreator(marketCreator(window.location.pathname));
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    const slug = selectedCreatorGroup
      ? selectedCreatorGroup.nicknameKey
        ? selectedCreatorGroup.label
        : selectedCreatorGroup.key
      : selectedCreator;
    const nextPath = marketPath(slug);
    if (window.location.pathname !== nextPath) {
      window.history.replaceState(null, '', nextPath);
    }
  }, [selectedCreator, selectedCreatorGroup]);

  const selectedAlbum = useMemo(
    () => (selectedAlbumId ? albumsMap.get(selectedAlbumId) ?? null : null),
    [albumsMap, selectedAlbumId]
  );

  const hasFilterPills = Boolean(
    selectedGenres.length > 0 ||
      selectedAlbumId ||
      likedOnly ||
      followingOnly ||
      search.trim()
  );

  const hasActiveFilters = Boolean(selectedCreator || hasFilterPills || order === 'oldest');

  const clearAllFilters = () => {
    setSelectedCreator(null);
    setSelectedGenres([]);
    setSelectedAlbumId(null);
    setLikedOnly(false);
    setFollowingOnly(false);
    setSearch('');
    setOrder('latest');
  };

  const scrollToStage = (stage: SnapStageId) => {
    setActiveStage(stage);
    const map: Record<SnapStageId, HTMLElement | null> = {
      pulse: stagePulseRef.current,
      discovery: stageDiscoveryRef.current,
      collections: stageCollectionsRef.current,
    };
    map[stage]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleSnapScroll = () => {
    const container = snapDeckRef.current;
    if (!container) return;
    const scrollTop = container.scrollTop;
    const stageH = container.clientHeight || 1;
    const idx = Math.round(scrollTop / stageH);
    const nextStage: SnapStageId =
      idx <= 0 ? 'pulse' : idx === 1 ? 'discovery' : 'collections';
    if (nextStage !== activeStage) {
      setActiveStage(nextStage);
    }
  };

  const handlePlaySong = (song: Song, contextSongs?: Song[], contextId: string = 'default') => {
    const isPlayingThis =
      playing.active &&
      playing.id === song.id &&
      (playing.contextId ?? 'default') === contextId;
    if (isPlayingThis) {
      void store.setPlaying(false);
      return;
    }
    const queueList = contextSongs && contextSongs.length > 0 ? contextSongs : displayedSongs;
    void store.playSong(song, queueList, null, contextId);
  };

  const handlePlayCollection = (songs: Song[], contextId: string, playlistId?: string | null) => {
    if (!songs || songs.length === 0) return;
    void store.playCollection(songs, contextId, playlistId ?? null);
  };

  const handlePlayPlaylist = (playlist: Playlist) => {
    const resolved = (playlist.song_ids || [])
      .map((id) => songsById.get(id))
      .filter((s): s is Song => Boolean(s));
    if (resolved.length === 0) {
      toast.error('This playlist has no playable public tracks yet.');
      return;
    }
    const wasPlayingThis = playing.active && playing.playlistId === playlist.id;
    void store.playCollection(resolved, `playlist:${playlist.id}`, playlist.id);
    if (!wasPlayingThis) {
      recordPlaylistPlayApi(playlist.id);
    }
  };

  const handlePlayAlbum = (album: Album) => {
    const albumSongs = popularPlayable.filter((s) => s.album_id === album.id);
    if (albumSongs.length === 0) {
      toast.error('No public tracks in this album.');
      return;
    }
    void store.playCollection(albumSongs, `album:${album.id}`);
  };

  const handleRemoveSongFromExpandedPlaylist = async (
    playlist: Playlist,
    songId: string,
    songTitle: string
  ) => {
    if (!readAddress) return;
    try {
      await removeSongFromPlaylistApi(playlist.id, songId, readAddress);
      await queryClient.invalidateQueries({ queryKey: ['playlists'] });
      toast.success(`Removed "${songTitle}" from "${playlist.title}"`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove track');
    }
  };

  const handleDeletePlaylistInMarket = async (playlist: Playlist) => {
    if (!readAddress) return;
    try {
      await deletePlaylistApi(playlist.id, readAddress);
      await queryClient.invalidateQueries({ queryKey: ['playlists'] });
      if (expandedPlaylistId === playlist.id) setExpandedPlaylistId(null);
      toast.success(`Deleted playlist "${playlist.title}"`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete playlist');
    }
  };

  const handleCreateShelfPlaylist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!readAddress) {
      openGate();
      return;
    }
    const title = shelfPlaylistTitle.trim();
    if (!title) return;
    setCreatingPlaylist(true);
    try {
      await createPlaylistApi(
        {
          title,
          creator: readAddress,
          song_ids: [],
          cover: '',
          public: true,
        },
        readAddress
      );
      await queryClient.invalidateQueries({ queryKey: ['playlists'] });
      toast.success(`Created playlist "${title}"`);
      setShelfPlaylistTitle('');
      setShowShelfPlaylistCreate(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create playlist');
    } finally {
      setCreatingPlaylist(false);
    }
  };

  const handleShareSong = (s: Song) => {
    const group = findCreatorGroup(creatorGroups, s.creator);
    const creatorSlug = group?.nicknameKey ? group.label : s.creator;
    const album = s.album_id ? albumsMap.get(s.album_id) : null;
    setShareData(songToShareData(s, creatorSlug, false, album?.cover || null));
  };

  const renderSongCard = (versions: Song[], contextSongs: Song[], contextId: string) => {
    const family = versions[0].family ?? versions[0].id;
    const song = versions.find((item) => item.id === selected[family]) ?? versions[0];
    const isPlayingThis =
      playing.active &&
      playing.id === song.id &&
      (playing.contextId ?? 'default') === contextId;

    const album = song.album_id ? albumsMap.get(song.album_id) : null;
    const albumTitle = album?.title || song.album_title || null;
    const albumCover = album?.cover || null;

    return (
      <Card
        key={`${contextId}-${family}`}
        variant="market"
        song={song}
        versions={versions}
        albumTitle={albumTitle}
        albumCover={albumCover}
        isPlayingThis={isPlayingThis}
        onPlayToggle={() => handlePlaySong(song, contextSongs, contextId)}
        onSelectVersion={(version) => {
          setSelected((current) => ({ ...current, [family]: version.id }));
          if (
            versions.some((item) => item.id === playing.id) &&
            (playing.contextId ?? 'default') === contextId
          ) {
            store.setActiveSong(version, undefined, contextId);
          }
        }}
        selectedGenres={selectedGenres}
        onSelectGenre={toggleGenre}
        onSelectCreator={handleSelectCreatorAddress}
        onShare={handleShareSong}
      />
    );
  };

  const groupedDisplayed = useMemo(() => groupSongs(displayedSongs), [displayedSongs]);
  const visibleGroups = useMemo(
    () => groupedDisplayed.slice(0, visibleCount),
    [groupedDisplayed, visibleCount]
  );

  // Is Dedicated Creator Studio View (`/:creator`) active?
  const isCreatorStudioView = Boolean(selectedCreator);
  const isMatrixView = !isCreatorStudioView && !hasFilterPills && order === 'latest';

  const guideView = { creatorOpen, genreOpen };
  const guideViewRef = useRef(guideView);
  guideViewRef.current = guideView;
  useGuideOwner({
    id: 'market',
    scope: 'market',
    handles: (step) => step.owner === 'market' || step.id === 'K5',
    prepare: ({ step, bind }) => {
      const displayed = groupedDisplayed.map(
        (versions) =>
          versions.find((song) => song.id === selected[versions[0].family ?? versions[0].id]) ??
          versions[0]
      );
      const songId = ['M4', 'M5', 'K5'].includes(step.id) ? bind('song', displayed[0]?.id) : undefined;
      const view = prepareViews(
        guideView,
        () => guideViewRef.current,
        { creatorOpen: setCreatorOpen, genreOpen: setGenreOpen },
        { creatorOpen: step.id === 'M2', genreOpen: step.id === 'M3' }
      );
      if (['M4', 'M5', 'K5'].includes(step.id) && !displayed.some((song) => song.id === songId))
        return {
          ...view,
          target: 'market.empty',
          description: isPending ? 'Tracks are loading.' : 'Change or clear your filters to find a track.',
        };
      return { ...view, entity: songId, focus: ['M2', 'M3'].includes(step.id) ? 'input' : undefined };
    },
  });

  // ---------------------------------------------------------------------------
  // 1. DEDICATED CREATOR STUDIO VIEW (`/:creator`)
  // ---------------------------------------------------------------------------
  if (isCreatorStudioView) {
    const creatorPlayableSongs = groupedDisplayed.map(
      (versions) =>
        versions.find((item) => item.id === selected[versions[0].family ?? versions[0].id]) ??
        versions[0]
    );
    const totalCreatorStreams = creatorPlayableSongs.reduce((acc, s) => acc + (s.plays ?? 0), 0);
    const creatorCtx = `creator:${selectedCreatorCanonicalAddr || selectedCreator}`;
    const isPlayingCreatorAll = playing.active && playing.contextId === creatorCtx;
    const isSelfCreator = Boolean(
      readAddress &&
      ((selectedCreatorCanonicalAddr &&
        selectedCreatorCanonicalAddr.toLowerCase() === readAddress.toLowerCase()) ||
        selectedCreatorGroup?.addresses.has(readAddress.toLowerCase()))
    );
    const creatorAvatar =
      selectedCreatorGroup?.avatar || directCreatorProfile?.avatar?.trim() || null;
    const creatorBio =
      selectedCreatorGroup?.bio || directCreatorProfile?.bio?.trim() || null;
    const creatorBanner =
      selectedCreatorGroup?.banner || directCreatorProfile?.banner?.trim() || null;
    const creatorSocials =
      (selectedCreatorGroup?.socials && selectedCreatorGroup.socials.length > 0
        ? selectedCreatorGroup.socials
        : directCreatorProfile?.socials) || [];
    const creatorCustomNickname =
      sanitizeCreatorNickname(
        selectedCreatorGroup?.nicknameKey
          ? selectedCreatorGroup.label
          : directCreatorProfile?.nickname,
        selectedCreatorCanonicalAddr
      ) || sanitizeCreatorNickname(selectedCreator, selectedCreatorCanonicalAddr);

    return (
      <div className={`market-container creator-studio-container ${className}`}>
        {/* Creator Studio Header */}
        <header className="creator-studio-header">
          <div className="creator-studio-top-row">
            <button
              type="button"
              className="creator-back-btn"
              onClick={() => setSelectedCreator(null)}
            >
              <ArrowLeft size={13} />
              <span>MARKET</span>
            </button>

            <div className="creator-studio-actions">
              {!isSelfCreator && selectedCreatorCanonicalAddr && (
                <button
                  type="button"
                  className={`creator-follow-btn ${isFollowingSelectedCreator ? 'is-following' : ''}`}
                  onClick={(e) => toggleFollowSelectedCreator(e)}
                >
                  {isFollowingSelectedCreator ? (
                    <>
                      <UserCheck size={13} />
                      <span>FOLLOWING</span>
                    </>
                  ) : (
                    <>
                      <UserPlus size={13} />
                      <span>FOLLOW</span>
                    </>
                  )}
                </button>
              )}

              {creatorPlayableSongs.length > 0 && (
                <button
                  type="button"
                  className={`creator-playall-btn ${isPlayingCreatorAll ? 'active' : ''}`}
                  onClick={() => handlePlayCollection(creatorPlayableSongs, creatorCtx)}
                >
                  {isPlayingCreatorAll ? <Pause size={13} /> : <Play size={13} />}
                  <span>{isPlayingCreatorAll ? 'PAUSE' : 'PLAY ALL'}</span>
                </button>
              )}

              <Tooltip title="Share">
                <button
                  type="button"
                  className="creator-share-btn"
                  onClick={() => setCreatorShareOpen(true)}
                  aria-label="Share creator link"
                >
                  <Share2 size={13} />
                </button>
              </Tooltip>
            </div>
          </div>

          <CreatorProfileCard
            variant="creator"
            address={selectedCreatorCanonicalAddr}
            addresses={selectedCreatorGroup?.addresses}
            songs={creatorPlayableSongs}
            nickname={creatorCustomNickname}
            avatar={creatorAvatar}
            bio={creatorBio}
            banner={creatorBanner}
            socials={creatorSocials}
            statsSlot={
              <div className="creator-studio-stats">
                <div className="creator-stat-chip" title="Published tracks">
                  <Music size={10} className="creator-stat-icon" />
                  <span className="creator-stat-value">{creatorPlayableSongs.length}</span>
                  <span className="creator-stat-label">TRACKS</span>
                </div>
                <div className="creator-stat-chip" title="Total streams">
                  <Headphones size={10} className="creator-stat-icon" />
                  <span className="creator-stat-value">{totalCreatorStreams}</span>
                  <span className="creator-stat-label">STREAMS</span>
                </div>
                <div className="creator-stat-chip" title="Followers">
                  <Users size={10} className="creator-stat-icon" />
                  <span className="creator-stat-value">{selectedCreatorSocial?.followers ?? 0}</span>
                  <span className="creator-stat-label">FOLLOWERS</span>
                </div>
                <div className="creator-stat-chip" title="Following">
                  <UserCheck size={10} className="creator-stat-icon" />
                  <span className="creator-stat-value">{selectedCreatorSocial?.following ?? 0}</span>
                  <span className="creator-stat-label">FOLLOWING</span>
                </div>
              </div>
            }
          />
        </header>

        {/* Published Songs Timeline List (Base Waveform + Timed Comments) */}
        <div className="creator-studio-tracks panel scrollable">
          {groupedDisplayed.length === 0 ? (
            <div className="market-empty" data-guide="market.empty">
              <span className="market-empty-title">{isPending ? 'LOADING' : 'NO PUBLISHED TRACKS'}</span>
            </div>
          ) : (
            groupedDisplayed.map((versions) => {
              const family = versions[0].family ?? versions[0].id;
              const song = versions.find((item) => item.id === selected[family]) ?? versions[0];
              const isPlayingThis =
                playing.active &&
                playing.id === song.id &&
                (playing.contextId ?? 'default') === creatorCtx;

              return (
                <Timeline
                  key={family}
                  song={song}
                  versions={versions}
                  isPlayingThis={isPlayingThis}
                  onPlayToggle={() => handlePlaySong(song, creatorPlayableSongs, creatorCtx)}
                  onSelectVersion={(version) => {
                    setSelected((current) => ({ ...current, [family]: version.id }));
                    if (
                      versions.some((item) => item.id === playing.id) &&
                      (playing.contextId ?? 'default') === creatorCtx
                    ) {
                      store.setActiveSong(version, undefined, creatorCtx);
                    }
                  }}
                  onSelectGenre={(genre) => {
                    setSelectedCreator(null);
                    toggleGenre(genre);
                  }}
                  onShare={handleShareSong}
                />
              );
            })
          )}
        </div>

        <ShareModal
          isOpen={Boolean(shareData)}
          onClose={() => setShareData(null)}
          data={shareData}
        />

        <ShareUrlModal
          isOpen={creatorShareOpen}
          onClose={() => setCreatorShareOpen(false)}
          creator={creatorCustomNickname || selectedCreatorCanonicalAddr || selectedCreator || ''}
        />
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // 2. MAIN `/market` VIEW — OPTION A: "THE VERTICAL SNAP-DECK"
  // ---------------------------------------------------------------------------
  const PULSE_ROWS_PER_PAGE = 6;
  const GENRES_PER_PAGE = 6;
  const CREATORS_PER_PAGE = 6;
  const ALBUMS_PER_PAGE = 6;
  const PLAYLISTS_PER_PAGE = 5;

  const newTotalPages = Math.max(1, Math.ceil(pulseNewList.length / PULSE_ROWS_PER_PAGE));
  const clampedNewPage = Math.min(newPage, newTotalPages - 1);
  const visibleNewRows = pulseNewList.slice(
    clampedNewPage * PULSE_ROWS_PER_PAGE,
    (clampedNewPage + 1) * PULSE_ROWS_PER_PAGE
  );

  const popularTotalPages = Math.max(1, Math.ceil(pulseRightList.length / PULSE_ROWS_PER_PAGE));
  const clampedPopularPage = Math.min(popularPage, popularTotalPages - 1);
  const visiblePopularRows = pulseRightList.slice(
    clampedPopularPage * PULSE_ROWS_PER_PAGE,
    (clampedPopularPage + 1) * PULSE_ROWS_PER_PAGE
  );

  const genreTotalPages = Math.max(1, Math.ceil(genreItems.length / GENRES_PER_PAGE));
  const clampedGenrePage = Math.min(genrePage, genreTotalPages - 1);
  const visibleGenres = genreItems.slice(
    clampedGenrePage * GENRES_PER_PAGE,
    (clampedGenrePage + 1) * GENRES_PER_PAGE
  );

  const creatorTotalPages = Math.max(1, Math.ceil(creatorItems.length / CREATORS_PER_PAGE));
  const clampedCreatorPage = Math.min(creatorPage, creatorTotalPages - 1);
  const visibleCreators = creatorItems.slice(
    clampedCreatorPage * CREATORS_PER_PAGE,
    (clampedCreatorPage + 1) * CREATORS_PER_PAGE
  );

  const albumTotalPages = Math.max(1, Math.ceil(publicAlbums.length / ALBUMS_PER_PAGE));
  const clampedAlbumPage = Math.min(albumPage, albumTotalPages - 1);
  const visibleAlbums = publicAlbums.slice(
    clampedAlbumPage * ALBUMS_PER_PAGE,
    (clampedAlbumPage + 1) * ALBUMS_PER_PAGE
  );

  const playlistTotalPages = Math.max(1, Math.ceil(publicPlaylists.length / PLAYLISTS_PER_PAGE));
  const clampedPlaylistPage = Math.min(playlistPage, playlistTotalPages - 1);
  const visiblePlaylists = publicPlaylists.slice(
    clampedPlaylistPage * PLAYLISTS_PER_PAGE,
    (clampedPlaylistPage + 1) * PLAYLISTS_PER_PAGE
  );

  const recentWindowCount = foldsData?.newReleases?.lastHourCount ?? 0;

  return (
    <div className={`market-container ${className}`}>
      {/* Marketplace Header + Stage Indicator Pills */}
      <div className="market-header">
        <div className="market-header-left">
          <Glitch text="AUDIO_MARKET" className="market-title-text" />
          <div className="market-subtitle">
            {totalPublicCount} TRACKS
            {hasActiveFilters && (
              <span className="market-subtitle-filter">• {displayedSongs.length} SHOWN</span>
            )}
          </div>
        </div>

        {/* Snap-Deck Stage Quick-Jump Pills */}
        {isMatrixView && (
          <nav className="market-stage-nav" aria-label="Market stages">
            <button
              type="button"
              className={`market-stage-pill ${activeStage === 'pulse' ? 'active' : ''}`}
              onClick={() => scrollToStage('pulse')}
            >
              <span className="market-stage-num">01</span>
              <span>PULSE</span>
            </button>
            <button
              type="button"
              className={`market-stage-pill ${activeStage === 'discovery' ? 'active' : ''}`}
              onClick={() => scrollToStage('discovery')}
            >
              <span className="market-stage-num">02</span>
              <span>DISCOVERY</span>
            </button>
            <button
              type="button"
              className={`market-stage-pill ${activeStage === 'collections' ? 'active' : ''}`}
              onClick={() => scrollToStage('collections')}
            >
              <span className="market-stage-num">03</span>
              <span>COLLECTIONS</span>
            </button>
          </nav>
        )}
      </div>

      {/* Filter & Command Bar */}
      <div className="market-filter-bar" data-guide="market-toolbar">
        {/* Desktop Search input */}
        <div className="market-filter-search">
          <Search size={13} className="market-search-icon" />
          <input
            type="text"
            placeholder="SEARCH TRACKS, TAGS, CREATORS..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-guide="market.search"
            className="market-search-input"
          />
          {search && (
            <Tooltip title="Clear Search">
              <button
                type="button"
                className="market-filter-clear-btn"
                onClick={() => setSearch('')}
                aria-label="Clear search"
              >
                <X size={12} />
              </button>
            </Tooltip>
          )}
        </div>

        {/* Mobile Icon-Only Search Trigger */}
        <button
          type="button"
          className={`market-mobile-search-btn ${search.trim() ? 'has-selection' : ''}`}
          onClick={() => setSearchModalOpen(true)}
          aria-label="Search"
        >
          <Search size={13} />
        </button>

        {/* Filters cluster */}
        <div className="market-filter-selects">
          {/* 1-Tap LIKED Queue Filter Pill */}
          <Tooltip title="Filter by Liked Tracks">
            <button
              type="button"
              className={`market-quick-filter-btn liked ${likedOnly ? 'active' : ''}`}
              onClick={() => setLikedOnly((prev) => !prev)}
              aria-pressed={likedOnly}
            >
              <Heart size={12} fill={likedOnly ? 'currentColor' : 'none'} />
              <span>LIKED</span>
              {likedIds.length > 0 && <span className="market-quick-count">{likedIds.length}</span>}
            </button>
          </Tooltip>

          {/* 1-Tap FOLLOWING Feed Filter Pill */}
          <Tooltip title="Filter by Followed Creators">
            <button
              type="button"
              className={`market-quick-filter-btn following ${followingOnly ? 'active' : ''}`}
              onClick={() => setFollowingOnly((prev) => !prev)}
              aria-pressed={followingOnly}
            >
              <UserCheck size={12} />
              <span>FOLLOWING</span>
              {following.length > 0 && <span className="market-quick-count">{following.length}</span>}
            </button>
          </Tooltip>

          {/* Searchable Creator Combobox Popover */}
          <div className="market-select-wrap" ref={creatorPopoverRef}>
            <button
              type="button"
              className={`market-popover-trigger ${selectedCreator ? 'has-selection' : ''} ${creatorOpen ? 'is-open' : ''}`}
              onClick={() => {
                setCreatorOpen((prev) => !prev);
                setGenreOpen(false);
                setFeedConfigOpen(false);
              }}
              aria-label="Open Creator Studio"
              aria-expanded={creatorOpen}
            >
              <User size={13} className="market-select-icon" />
              <span className="market-popover-trigger-label">
                {selectedCreatorLabel
                  ? selectedCreatorLabel
                  : `CREATORS (${creatorGroups.length})`}
              </span>
              <ChevronDown size={12} className="market-popover-chevron" />
            </button>

            {creatorOpen && (
              <div
                data-guide="market.creator-menu"
                className="market-popover-menu"
                role="listbox"
                aria-label="Creators"
              >
                <div className="market-popover-search">
                  <Search size={11} className="market-search-icon" />
                  <input
                    type="text"
                    placeholder="FIND CREATOR STUDIO..."
                    value={creatorQuery}
                    onChange={(e) => setCreatorQuery(e.target.value)}
                    className="market-popover-search-input"
                    autoFocus
                  />
                  {creatorQuery && (
                    <button
                      type="button"
                      className="market-filter-clear-btn"
                      onClick={() => setCreatorQuery('')}
                      aria-label="Clear creator search"
                    >
                      <X size={11} />
                    </button>
                  )}
                </div>

                <div className="market-popover-list scrollable">
                  {filteredCreatorGroups.length === 0 ? (
                    <div className="market-popover-empty">NONE</div>
                  ) : (
                    filteredCreatorGroups.map((g) => {
                      const slug = g.nicknameKey ? g.label : g.key;
                      return (
                        <button
                          key={g.key}
                          type="button"
                          role="option"
                          aria-selected={false}
                          className="market-popover-option"
                          onClick={() => {
                            setSelectedCreator(slug);
                            setCreatorOpen(false);
                            setCreatorQuery('');
                          }}
                        >
                          <span className="market-popover-option-text">{g.label}</span>
                          <ChevronRight size={11} className="market-popover-check" />
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Multi-Select Genre Popover */}
          <div className="market-select-wrap" ref={genrePopoverRef}>
            <button
              type="button"
              className={`market-popover-trigger ${selectedGenres.length > 0 ? 'has-selection' : ''} ${genreOpen ? 'is-open' : ''}`}
              onClick={() => {
                setGenreOpen((prev) => !prev);
                setCreatorOpen(false);
                setFeedConfigOpen(false);
              }}
              aria-label="Filter by genre"
              aria-expanded={genreOpen}
            >
              <Music size={13} className="market-select-icon" />
              <span className="market-popover-trigger-label">
                {selectedGenres.length > 0
                  ? `GENRES (${selectedGenres.length})`
                  : `GENRES (${uniqueGenres.length})`}
              </span>
              <ChevronDown size={12} className="market-popover-chevron" />
            </button>

            {genreOpen && (
              <div
                data-guide="market.genre-menu"
                className="market-popover-menu"
                role="listbox"
                aria-label="Genres"
                aria-multiselectable="true"
              >
                <div className="market-popover-search">
                  <Search size={11} className="market-search-icon" />
                  <input
                    type="text"
                    placeholder="SEARCH GENRES..."
                    value={genreQuery}
                    onChange={(e) => setGenreQuery(e.target.value)}
                    className="market-popover-search-input"
                    autoFocus
                  />
                  {genreQuery && (
                    <button
                      type="button"
                      className="market-filter-clear-btn"
                      onClick={() => setGenreQuery('')}
                      aria-label="Clear genre search"
                    >
                      <X size={11} />
                    </button>
                  )}
                </div>

                <div className="market-popover-list scrollable">
                  {selectedGenres.length > 0 && !genreQuery.trim() && (
                    <button
                      type="button"
                      className="market-popover-option market-popover-clear-row"
                      onClick={() => setSelectedGenres([])}
                    >
                      <span className="market-popover-option-text">
                        CLEAR ({selectedGenres.length})
                      </span>
                      <X size={11} />
                    </button>
                  )}

                  {filteredGenres.length === 0 ? (
                    <div className="market-popover-empty">NONE</div>
                  ) : (
                    filteredGenres.map((g) => {
                      const isSelected = selectedGenres.some(
                        (s) => s.toLowerCase() === g.toLowerCase()
                      );
                      return (
                        <button
                          key={g}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          className={`market-popover-option ${isSelected ? 'selected' : ''}`}
                          onClick={() => toggleGenre(g)}
                        >
                          <span className="market-popover-option-text">{g.toUpperCase()}</span>
                          {isSelected && <Check size={11} className="market-popover-check" />}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Order Toggle (Latest | Oldest) */}
          <div className="market-order-toggle">
            <Tooltip title="Latest">
              <button
                type="button"
                className={`market-order-btn ${order === 'latest' ? 'active' : ''}`}
                onClick={() => setOrder('latest')}
                aria-label="Sort by Latest"
              >
                <ArrowDownWideNarrow size={13} />
              </button>
            </Tooltip>
            <Tooltip title="Oldest">
              <button
                type="button"
                className={`market-order-btn ${order === 'oldest' ? 'active' : ''}`}
                onClick={() => setOrder('oldest')}
                aria-label="Sort by Oldest"
              >
                <ArrowUpNarrowWide size={13} />
              </button>
            </Tooltip>
          </div>

          {/* Live Feed Batch & Polling Window Config Popover */}
          <div className="market-select-wrap" ref={feedConfigRef} style={{ flex: '0 0 auto' }}>
            <Tooltip title={`Feed: ${batchSize} / ${pollIntervalMin}m`}>
              <button
                type="button"
                className={`market-reset-filters-btn ${feedConfigOpen ? 'active' : ''}`}
                onClick={() => {
                  setFeedConfigOpen((prev) => !prev);
                  setCreatorOpen(false);
                  setGenreOpen(false);
                }}
                aria-label="Feed batch and polling settings"
                aria-expanded={feedConfigOpen}
              >
                <SlidersHorizontal size={12} />
              </button>
            </Tooltip>
            {feedConfigOpen && (
              <div
                className="market-popover-menu market-feed-config-menu"
                style={{ right: 0, left: 'auto' }}
                role="dialog"
                aria-label="Feed settings"
              >
                <div className="market-config-group">
                  <span className="market-config-label">BATCH SIZE</span>
                  <div className="market-config-pills">
                    {([20, 50, 100] as const).map((size) => (
                      <button
                        key={size}
                        type="button"
                        className={`market-config-pill ${batchSize === size ? 'active' : ''}`}
                        onClick={() => setBatchSize(size)}
                      >
                        {size}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="market-config-group">
                  <span className="market-config-label">POLL WINDOW</span>
                  <div className="market-config-pills">
                    {([15, 30, 60] as const).map((mins) => (
                      <button
                        key={mins}
                        type="button"
                        className={`market-config-pill ${pollIntervalMin === mins ? 'active' : ''}`}
                        onClick={() => setPollIntervalMin(mins)}
                      >
                        {mins}M
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {hasActiveFilters && (
            <Tooltip title="Reset">
              <button
                type="button"
                className="market-reset-filters-btn"
                onClick={clearAllFilters}
                aria-label="Reset filters"
              >
                <RotateCcw size={12} />
              </button>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Active Filter Pills Bar */}
      {hasFilterPills && (
        <div className="market-active-pills" role="region" aria-label="Active filters">
          {likedOnly && (
            <button
              type="button"
              className="market-filter-pill creator"
              onClick={() => setLikedOnly(false)}
            >
              <Heart size={10} fill="currentColor" />
              <span>LIKED</span>
              <X size={10} className="market-filter-pill-close" />
            </button>
          )}

          {followingOnly && (
            <button
              type="button"
              className="market-filter-pill creator"
              onClick={() => setFollowingOnly(false)}
            >
              <UserCheck size={10} />
              <span>FOLLOWING</span>
              <X size={10} className="market-filter-pill-close" />
            </button>
          )}

          {selectedAlbum && (
            <button
              type="button"
              className="market-filter-pill genre"
              onClick={() => setSelectedAlbumId(null)}
            >
              <Disc3 size={10} />
              <span>{selectedAlbum.title}</span>
              <X size={10} className="market-filter-pill-close" />
            </button>
          )}

          {selectedGenres.map((genre) => (
            <button
              key={genre}
              type="button"
              className="market-filter-pill genre"
              onClick={() => toggleGenre(genre)}
              aria-label={`Remove genre filter ${genre}`}
            >
              <Music size={10} />
              <span>{genre.toUpperCase()}</span>
              <X size={10} className="market-filter-pill-close" />
            </button>
          ))}

          {search.trim() && (
            <button
              type="button"
              className="market-filter-pill search"
              onClick={() => setSearch('')}
              aria-label="Clear search query"
            >
              <Search size={10} />
              <span>&ldquo;{search.trim()}&rdquo;</span>
              <X size={10} className="market-filter-pill-close" />
            </button>
          )}

          <button
            type="button"
            className="market-filter-pill-clear-all"
            onClick={clearAllFilters}
          >
            ALL
          </button>
        </div>
      )}

      {/* Main Content Area: 3-Stage Vertical Snap-Deck OR Filtered Track View */}
      {isMatrixView ? (
        <div
          className="market-snap-deck panel"
          ref={snapDeckRef}
          onScroll={handleSnapScroll}
        >
          {error && publicSongs.length === 0 ? (
            <div className="market-empty">
              <span className="market-empty-title">ERROR</span>
              <span className="market-empty-desc">{error.message}</span>
            </div>
          ) : publicSongs.length === 0 ? (
            <div className="market-empty">
              <span className="market-empty-title">{isPending ? 'LOADING' : 'EMPTY'}</span>
            </div>
          ) : (
            <>
              {/* =========================================================
                  STAGE 01: THE PULSE (NEW + POPULAR + LIKED + FOLLOWING)
                  Spotify / VKontakte Compact Track Rows
              ========================================================= */}
              <section
                ref={stagePulseRef}
                className="market-snap-stage stage-pulse"
                aria-label="Pulse: New and Popular Tracks"
              >
                {/* Mobile Column Switcher */}
                <div className="market-pulse-mobile-tabs">
                  <button
                    type="button"
                    className={`market-pulse-mobile-tab ${pulseMobileTab === 'new' ? 'active' : ''}`}
                    onClick={() => setPulseMobileTab('new')}
                  >
                    <Sparkles size={12} />
                    <span>NEW</span>
                  </button>
                  <button
                    type="button"
                    className={`market-pulse-mobile-tab ${pulseMobileTab === 'popular' ? 'active' : ''}`}
                    onClick={() => setPulseMobileTab('popular')}
                  >
                    <Flame size={12} />
                    <span>{pulseRightMode === 'liked' ? 'LIKED' : 'POPULAR'}</span>
                  </button>
                </div>

                <div className="market-pulse-grid">
                  {/* Left Deck: NEW DROPS (Compact Rows) */}
                  <div
                    className={`market-pulse-column ${pulseMobileTab === 'new' ? 'is-mobile-active' : ''}`}
                  >
                    <div className="market-pulse-col-header">
                      <div className="market-pulse-col-title-wrap">
                        <Sparkles size={14} className="market-shelf-icon accent" />
                        <h2 className="market-shelf-title">NEW</h2>
                        {recentWindowCount > 0 && (
                          <span className="market-live-badge">
                            +{recentWindowCount} / {pollIntervalMin}M
                          </span>
                        )}
                        <button
                          type="button"
                          className={`market-inline-filter-chip ${pulseNewFollowingOnly ? 'active' : ''}`}
                          onClick={() => {
                            setPulseNewFollowingOnly((prev) => !prev);
                            setNewPage(0);
                          }}
                          title="Show new tracks from creators you follow"
                        >
                          <UserCheck size={11} />
                          <span>FOLLOWING</span>
                        </button>
                      </div>

                      <div className="market-pulse-col-actions">
                        {newTotalPages > 1 && (
                          <div className="market-page-stepper">
                            <button
                              type="button"
                              className="market-stepper-btn"
                              disabled={clampedNewPage <= 0}
                              onClick={() => setNewPage((p) => Math.max(0, p - 1))}
                              aria-label="Previous new tracks page"
                            >
                              <ChevronLeft size={12} />
                            </button>
                            <span className="market-stepper-label">
                              {clampedNewPage + 1}/{newTotalPages}
                            </span>
                            <button
                              type="button"
                              className="market-stepper-btn"
                              disabled={clampedNewPage >= newTotalPages - 1}
                              onClick={() => setNewPage((p) => Math.min(newTotalPages - 1, p + 1))}
                              aria-label="Next new tracks page"
                            >
                              <ChevronRight size={12} />
                            </button>
                          </div>
                        )}
                        {pulseNewList.length > 0 && (
                          <button
                            type="button"
                            className={`market-shelf-playall-btn ${playing.active && playing.contextId === 'new' ? 'active' : ''}`}
                            onClick={() => handlePlayCollection(pulseNewList, 'new')}
                          >
                            {playing.active && playing.contextId === 'new' ? (
                              <Pause size={11} />
                            ) : (
                              <Play size={11} />
                            )}
                            <span>PLAY ALL</span>
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="market-pulse-rows-list">
                      {visibleNewRows.length === 0 ? (
                        <div className="market-col-empty">
                          {pulseNewFollowingOnly
                            ? 'Follow creators to see their latest drops here.'
                            : 'No new tracks yet.'}
                        </div>
                      ) : (
                        visibleNewRows.map((song, idx) => {
                          const globalIdx = clampedNewPage * PULSE_ROWS_PER_PAGE + idx;
                          const isPlayingThis =
                            playing.active &&
                            playing.id === song.id &&
                            (playing.contextId ?? 'default') === 'new';
                          return (
                            <Row
                              key={`new-${song.id}`}
                              song={song}
                              index={globalIdx}
                              isPlayingThis={isPlayingThis}
                              onPlayToggle={() => handlePlaySong(song, pulseNewList, 'new')}
                              onSelectCreator={handleSelectCreatorAddress}
                              onSelectGenre={toggleGenre}
                              onShare={handleShareSong}
                            />
                          );
                        })
                      )}
                    </div>
                  </div>

                  {/* Right Deck: POPULAR VELOCITY / LIKED QUEUE (Compact Rows) */}
                  <div
                    className={`market-pulse-column ${pulseMobileTab === 'popular' ? 'is-mobile-active' : ''}`}
                  >
                    <div className="market-pulse-col-header">
                      <div className="market-pulse-col-title-wrap">
                        <button
                          type="button"
                          className={`market-col-mode-btn ${pulseRightMode === 'popular' ? 'active' : ''}`}
                          onClick={() => {
                            setPulseRightMode('popular');
                            setPopularPage(0);
                          }}
                        >
                          <Flame size={14} className="market-shelf-icon hot" />
                          <h2 className="market-shelf-title">POPULAR</h2>
                        </button>
                        <button
                          type="button"
                          className={`market-col-mode-btn liked ${pulseRightMode === 'liked' ? 'active' : ''}`}
                          onClick={() => {
                            setPulseRightMode('liked');
                            setPopularPage(0);
                          }}
                        >
                          <Heart
                            size={12}
                            fill={pulseRightMode === 'liked' ? 'currentColor' : 'none'}
                          />
                          <span>LIKED ({likedPlayable.length})</span>
                        </button>
                      </div>

                      <div className="market-pulse-col-actions">
                        {popularTotalPages > 1 && (
                          <div className="market-page-stepper">
                            <button
                              type="button"
                              className="market-stepper-btn"
                              disabled={clampedPopularPage <= 0}
                              onClick={() => setPopularPage((p) => Math.max(0, p - 1))}
                              aria-label="Previous popular tracks page"
                            >
                              <ChevronLeft size={12} />
                            </button>
                            <span className="market-stepper-label">
                              {clampedPopularPage + 1}/{popularTotalPages}
                            </span>
                            <button
                              type="button"
                              className="market-stepper-btn"
                              disabled={clampedPopularPage >= popularTotalPages - 1}
                              onClick={() =>
                                setPopularPage((p) => Math.min(popularTotalPages - 1, p + 1))
                              }
                              aria-label="Next popular tracks page"
                            >
                              <ChevronRight size={12} />
                            </button>
                          </div>
                        )}
                        {pulseRightList.length > 0 && (
                          <button
                            type="button"
                            className={`market-shelf-playall-btn ${playing.active && playing.contextId === pulseRightMode ? 'active' : ''}`}
                            onClick={() => handlePlayCollection(pulseRightList, pulseRightMode)}
                          >
                            {playing.active && playing.contextId === pulseRightMode ? (
                              <Pause size={11} />
                            ) : (
                              <Play size={11} />
                            )}
                            <span>PLAY ALL</span>
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="market-pulse-rows-list">
                      {visiblePopularRows.length === 0 ? (
                        <div className="market-col-empty">
                          {pulseRightMode === 'liked'
                            ? 'Tap ♥ on any track to build your Liked queue.'
                            : 'No popular tracks yet.'}
                        </div>
                      ) : (
                        visiblePopularRows.map((song, idx) => {
                          const globalIdx = clampedPopularPage * PULSE_ROWS_PER_PAGE + idx;
                          const isPlayingThis =
                            playing.active &&
                            playing.id === song.id &&
                            (playing.contextId ?? 'default') === pulseRightMode;
                          return (
                            <Row
                              key={`${pulseRightMode}-${song.id}`}
                              song={song}
                              index={globalIdx}
                              isPlayingThis={isPlayingThis}
                              onPlayToggle={() =>
                                handlePlaySong(song, pulseRightList, pulseRightMode)
                              }
                              onSelectCreator={handleSelectCreatorAddress}
                              onSelectGenre={toggleGenre}
                              onShare={handleShareSong}
                            />
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>

                {/* Stage Peek Cue for Next Snap Stage */}
                <button
                  type="button"
                  className="market-stage-peek-cue"
                  onClick={() => scrollToStage('discovery')}
                >
                  <span>02 // DISCOVERY — GENRES &amp; CREATORS</span>
                  <ChevronDown size={13} />
                </button>
              </section>

              {/* =========================================================
                  STAGE 02: SONIC DISCOVERY (GENRES + CREATORS)
                  Wide Sonic Banners + Circular Creator Medallions
              ========================================================= */}
              <section
                ref={stageDiscoveryRef}
                className="market-snap-stage stage-discovery"
                aria-label="Discovery: Genres and Creators"
              >
                <div className="market-discovery-stack">
                  {/* Top Half: GENRES Wide Sonic Banners */}
                  <div className="market-discovery-block">
                    <div className="market-pulse-col-header">
                      <div className="market-pulse-col-title-wrap">
                        <Music size={14} className="market-shelf-icon" />
                        <h2 className="market-shelf-title">GENRES</h2>
                        <span className="market-block-count">{genreItems.length}</span>
                      </div>
                      <div className="market-pulse-col-actions">
                        {genreTotalPages > 1 && (
                          <div className="market-page-stepper">
                            <button
                              type="button"
                              className="market-stepper-btn"
                              disabled={clampedGenrePage <= 0}
                              onClick={() => setGenrePage((p) => Math.max(0, p - 1))}
                              aria-label="Previous genres page"
                            >
                              <ChevronLeft size={12} />
                            </button>
                            <span className="market-stepper-label">
                              {clampedGenrePage + 1}/{genreTotalPages}
                            </span>
                            <button
                              type="button"
                              className="market-stepper-btn"
                              disabled={clampedGenrePage >= genreTotalPages - 1}
                              onClick={() =>
                                setGenrePage((p) => Math.min(genreTotalPages - 1, p + 1))
                              }
                              aria-label="Next genres page"
                            >
                              <ChevronRight size={12} />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="market-genre-banners-grid">
                      {visibleGenres.map((genreFold) => {
                        const slug = normalizeGenreSlug(genreFold.label);
                        const dynamicCover = slug ? genreCovers?.[slug]?.imageUrl : null;
                        const pairedGenreCover =
                          getGenreCoverImage(genreFold.label) || dynamicCover;
                        const fallbackCover =
                          genreFold.songs[0]?.image || '/branding/mark.svg';
                        const cover = pairedGenreCover || fallbackCover;
                        const genreCtx = `genre:${genreFold.key}`;
                        const isPlayingGenre =
                          playing.active && playing.contextId === genreCtx;

                        return (
                          <div
                            key={genreFold.key}
                            className={`market-genre-banner ${isPlayingGenre ? 'is-playing' : ''}`}
                            onClick={() => toggleGenre(genreFold.label)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                toggleGenre(genreFold.label);
                              }
                            }}
                          >
                            <img
                              src={cover}
                              alt={genreFold.label}
                              className="market-genre-banner-bg"
                              loading="lazy"
                              onError={(e) => {
                                if (e.currentTarget.src !== fallbackCover) {
                                  e.currentTarget.src = fallbackCover;
                                }
                              }}
                            />
                            <div className="market-genre-banner-overlay" />
                            <div className="market-genre-banner-content">
                              <div className="market-genre-banner-info">
                                <span className="market-genre-banner-tag">#{genreFold.label}</span>
                                <span className="market-genre-banner-count">
                                  {genreFold.total} {genreFold.total === 1 ? 'TRACK' : 'TRACKS'}
                                </span>
                              </div>
                              <button
                                type="button"
                                className={`market-genre-banner-play ${isPlayingGenre ? 'playing' : ''}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handlePlayCollection(genreFold.songs, genreCtx);
                                }}
                                aria-label={`Play ${genreFold.label}`}
                              >
                                {isPlayingGenre ? <Pause size={13} /> : <Play size={13} />}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Bottom Half: CREATORS Circular Identity Medallions */}
                  <div className="market-discovery-block">
                    <div className="market-pulse-col-header">
                      <div className="market-pulse-col-title-wrap">
                        <User size={14} className="market-shelf-icon" />
                        <h2 className="market-shelf-title">CREATORS</h2>
                        <span className="market-block-count">{creatorItems.length}</span>
                      </div>
                      <div className="market-pulse-col-actions">
                        {creatorTotalPages > 1 && (
                          <div className="market-page-stepper">
                            <button
                              type="button"
                              className="market-stepper-btn"
                              disabled={clampedCreatorPage <= 0}
                              onClick={() => setCreatorPage((p) => Math.max(0, p - 1))}
                              aria-label="Previous creators page"
                            >
                              <ChevronLeft size={12} />
                            </button>
                            <span className="market-stepper-label">
                              {clampedCreatorPage + 1}/{creatorTotalPages}
                            </span>
                            <button
                              type="button"
                              className="market-stepper-btn"
                              disabled={clampedCreatorPage >= creatorTotalPages - 1}
                              onClick={() =>
                                setCreatorPage((p) => Math.min(creatorTotalPages - 1, p + 1))
                              }
                              aria-label="Next creators page"
                            >
                              <ChevronRight size={12} />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="market-creators-medallion-grid">
                      {visibleCreators.map(({ group, songs, totalPlays }) => {
                        const cover = group.avatar || '/branding/mark.svg';
                        const creatorCtx = `creator:${group.key}`;
                        const isPlayingCreator =
                          playing.active && playing.contextId === creatorCtx;
                        const creatorSlug = group.nicknameKey ? group.label : group.key;
                        const followed =
                          isFollowing(group.key) ||
                          Array.from(group.addresses).some((a) => isFollowing(a));
                        const isSelf = Boolean(
                          readAddress && group.addresses.has(readAddress.toLowerCase())
                        );

                        return (
                          <div
                            key={group.key}
                            className={`market-creator-medallion-card ${isPlayingCreator ? 'is-playing' : ''}`}
                            onClick={() => setSelectedCreator(creatorSlug)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setSelectedCreator(creatorSlug);
                              }
                            }}
                          >
                            <div
                              className={`market-creator-avatar-ring ${!group.avatar ? 'is-logo' : ''}`}
                            >
                              <img
                                src={cover}
                                alt={group.label}
                                loading="lazy"
                                onError={(e) => {
                                  e.currentTarget.src = '/branding/mark.svg';
                                  e.currentTarget.parentElement?.classList.add('is-logo');
                                }}
                              />
                              <button
                                type="button"
                                className={`market-creator-play-badge ${isPlayingCreator ? 'playing' : ''}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handlePlayCollection(songs, creatorCtx);
                                }}
                                aria-label={`Play ${group.label}`}
                              >
                                {isPlayingCreator ? <Pause size={12} /> : <Play size={12} />}
                              </button>
                            </div>

                            <div className="market-creator-card-info">
                              <span className="market-creator-card-name">{group.label}</span>
                              <span className="market-creator-card-stats">
                                {songs.length} {songs.length === 1 ? 'TRACK' : 'TRACKS'}
                                {totalPlays > 0 ? ` • ${totalPlays} PLAYS` : ''}
                              </span>
                            </div>

                            {!isSelf && (
                              <button
                                type="button"
                                className={`market-creator-follow-pill ${followed ? 'is-following' : ''}`}
                                onClick={(e) => toggleFollow(group.key, e)}
                                aria-label={followed ? `Unfollow ${group.label}` : `Follow ${group.label}`}
                              >
                                {followed ? <UserCheck size={11} /> : <UserPlus size={11} />}
                                <span>{followed ? 'FOLLOWING' : 'FOLLOW'}</span>
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  className="market-stage-peek-cue"
                  onClick={() => scrollToStage('collections')}
                >
                  <span>03 // COLLECTIONS — ALBUMS &amp; PLAYLISTS</span>
                  <ChevronDown size={13} />
                </button>
              </section>

              {/* =========================================================
                  STAGE 03: CURATED COLLECTIONS (ALBUMS + PLAYLISTS + LIKED)
                  Vinyl Record Sleeves & Community Crates
              ========================================================= */}
              <section
                ref={stageCollectionsRef}
                className="market-snap-stage stage-collections"
                aria-label="Collections: Albums and Playlists"
              >
                <div className="market-collections-grid">
                  {/* Left Block: ALBUMS (Vinyl Sleeve Cards) */}
                  <div className="market-collections-column">
                    <div className="market-pulse-col-header">
                      <div className="market-pulse-col-title-wrap">
                        <Disc3 size={14} className="market-shelf-icon" />
                        <h2 className="market-shelf-title">ALBUMS</h2>
                        <span className="market-block-count">{publicAlbums.length}</span>
                      </div>
                      <div className="market-pulse-col-actions">
                        {albumTotalPages > 1 && (
                          <div className="market-page-stepper">
                            <button
                              type="button"
                              className="market-stepper-btn"
                              disabled={clampedAlbumPage <= 0}
                              onClick={() => setAlbumPage((p) => Math.max(0, p - 1))}
                              aria-label="Previous albums page"
                            >
                              <ChevronLeft size={12} />
                            </button>
                            <span className="market-stepper-label">
                              {clampedAlbumPage + 1}/{albumTotalPages}
                            </span>
                            <button
                              type="button"
                              className="market-stepper-btn"
                              disabled={clampedAlbumPage >= albumTotalPages - 1}
                              onClick={() =>
                                setAlbumPage((p) => Math.min(albumTotalPages - 1, p + 1))
                              }
                              aria-label="Next albums page"
                            >
                              <ChevronRight size={12} />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {visibleAlbums.length === 0 ? (
                      <div className="market-col-empty">No public albums yet.</div>
                    ) : (
                      <div className="market-vinyl-grid">
                        {visibleAlbums.map((album) => {
                          const albumSongs = popularPlayable.filter(
                            (s) => s.album_id === album.id
                          );
                          const cover =
                            album.cover && album.cover.trim() !== ''
                              ? album.cover
                              : albumSongs[0]?.image || '/branding/mark.svg';
                          const isPlayingAlbum =
                            playing.active && playing.contextId === `album:${album.id}`;

                          return (
                            <div
                              key={album.id}
                              className={`market-vinyl-card ${isPlayingAlbum ? 'is-playing' : ''}`}
                              onClick={() => setSelectedAlbumId(album.id)}
                              role="button"
                              tabIndex={0}
                            >
                              <div className="market-vinyl-sleeve">
                                <img src={cover} alt={album.title} loading="lazy" />
                                <div className="market-vinyl-disc" />
                                <button
                                  type="button"
                                  className={`market-collection-play-btn ${isPlayingAlbum ? 'playing' : ''}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handlePlayAlbum(album);
                                  }}
                                  aria-label={`Play ${album.title}`}
                                >
                                  {isPlayingAlbum ? <Pause size={13} /> : <Play size={13} />}
                                </button>
                              </div>
                              <div className="market-vinyl-info">
                                <span className="market-vinyl-title">{album.title}</span>
                                <span className="market-vinyl-meta">
                                  {resolveCreatorLabel(album.creator)} • {albumSongs.length}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Right Block: LIKED CRATE + COMMUNITY PLAYLISTS */}
                  <div className="market-collections-column">
                    <div className="market-pulse-col-header">
                      <div className="market-pulse-col-title-wrap">
                        <ListMusic size={14} className="market-shelf-icon" />
                        <h2 className="market-shelf-title">PLAYLISTS</h2>
                        <span className="market-block-count">{publicPlaylists.length}</span>
                      </div>
                      <div className="market-pulse-col-actions">
                        <Tooltip title="New Playlist">
                          <button
                            type="button"
                            className="market-stepper-btn"
                            onClick={() => {
                              if (!readAddress) {
                                openGate();
                                return;
                              }
                              setShowShelfPlaylistCreate((prev) => !prev);
                            }}
                            aria-label="New Playlist"
                          >
                            <Plus size={12} />
                          </button>
                        </Tooltip>
                        {playlistTotalPages > 1 && (
                          <div className="market-page-stepper">
                            <button
                              type="button"
                              className="market-stepper-btn"
                              disabled={clampedPlaylistPage <= 0}
                              onClick={() => setPlaylistPage((p) => Math.max(0, p - 1))}
                              aria-label="Previous playlists page"
                            >
                              <ChevronLeft size={12} />
                            </button>
                            <span className="market-stepper-label">
                              {clampedPlaylistPage + 1}/{playlistTotalPages}
                            </span>
                            <button
                              type="button"
                              className="market-stepper-btn"
                              disabled={clampedPlaylistPage >= playlistTotalPages - 1}
                              onClick={() =>
                                setPlaylistPage((p) => Math.min(playlistTotalPages - 1, p + 1))
                              }
                              aria-label="Next playlists page"
                            >
                              <ChevronRight size={12} />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {showShelfPlaylistCreate && (
                      <form className="market-shelf-inline-form" onSubmit={handleCreateShelfPlaylist}>
                        <input
                          type="text"
                          className="market-playlist-modal-input"
                          placeholder="NEW PLAYLIST..."
                          value={shelfPlaylistTitle}
                          onChange={(e) => setShelfPlaylistTitle(e.target.value)}
                          maxLength={80}
                          autoFocus
                        />
                        <Button
                          type="submit"
                          size="xs"
                          variant="primary"
                          disabled={creatingPlaylist || !shelfPlaylistTitle.trim()}
                          aria-label="Create playlist"
                        >
                          <Check size={12} />
                        </Button>
                        <Button
                          type="button"
                          size="xs"
                          variant="ghost"
                          onClick={() => setShowShelfPlaylistCreate(false)}
                          aria-label="Cancel"
                        >
                          <X size={12} />
                        </Button>
                      </form>
                    )}

                    <div className="market-playlists-crate-grid">
                      {/* Pinned Personal LIKED Tracks Crate */}
                      <div
                        className={`market-liked-crate ${playing.active && playing.contextId === 'liked-crate' ? 'is-playing' : ''}`}
                        onClick={() => setLikedOnly(true)}
                        role="button"
                        tabIndex={0}
                      >
                        <div className="market-liked-crate-icon">
                          <Heart size={18} fill="currentColor" />
                        </div>
                        <div className="market-liked-crate-info">
                          <span className="market-liked-crate-title">LIKED TRACKS</span>
                          <span className="market-liked-crate-meta">
                            {likedPlayable.length} SAVED
                          </span>
                        </div>
                        {likedPlayable.length > 0 && (
                          <button
                            type="button"
                            className={`market-collection-play-btn ${playing.active && playing.contextId === 'liked-crate' ? 'playing' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              handlePlayCollection(likedPlayable, 'liked-crate');
                            }}
                            aria-label="Play Liked Tracks"
                          >
                            {playing.active && playing.contextId === 'liked-crate' ? (
                              <Pause size={13} />
                            ) : (
                              <Play size={13} />
                            )}
                          </button>
                        )}
                      </div>

                      {visiblePlaylists.map((pl) => {
                        const plSongs = (pl.song_ids || [])
                          .map((id) => songsById.get(id))
                          .filter((s): s is Song => Boolean(s));
                        const cover =
                          pl.cover && pl.cover.trim() !== ''
                            ? pl.cover
                            : plSongs[0]?.image || '/branding/mark.svg';
                        const isPlayingPl =
                          playing.active && playing.playlistId === pl.id;
                        const isExpanded = expandedPlaylistId === pl.id;
                        const isOwner = Boolean(
                          readAddress &&
                            pl.creator &&
                            pl.creator.toLowerCase() === readAddress.toLowerCase()
                        );

                        return (
                          <div
                            key={pl.id}
                            className={`market-crate-playlist-card ${isExpanded ? 'is-expanded' : ''}`}
                            onClick={() => setExpandedPlaylistId(isExpanded ? null : pl.id)}
                            role="button"
                            tabIndex={0}
                          >
                            <div className="market-crate-playlist-top">
                              <img
                                src={cover}
                                alt={pl.title}
                                className="market-crate-playlist-cover"
                                loading="lazy"
                              />
                              <div className="market-crate-playlist-info">
                                <span className="market-crate-playlist-title">{pl.title}</span>
                                <span className="market-crate-playlist-meta">
                                  {resolveCreatorLabel(pl.creator)} • {plSongs.length}
                                </span>
                              </div>
                              <div className="market-crate-playlist-actions">
                                {isOwner && (
                                  <button
                                    type="button"
                                    className="market-crate-delete-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void handleDeletePlaylistInMarket(pl);
                                    }}
                                    aria-label={`Delete ${pl.title}`}
                                  >
                                    <Trash2 size={11} />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className={`market-collection-play-btn ${isPlayingPl ? 'playing' : ''}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handlePlayPlaylist(pl);
                                  }}
                                  aria-label={`Play ${pl.title}`}
                                >
                                  {isPlayingPl ? <Pause size={13} /> : <Play size={13} />}
                                </button>
                              </div>
                            </div>

                            {isExpanded && plSongs.length > 0 && (
                              <div
                                className="market-playlist-tracklist"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {plSongs.map((s, i) => (
                                  <div
                                    key={`${s.id}-${i}`}
                                    className="market-playlist-track-row-wrap"
                                  >
                                    <button
                                      type="button"
                                      className={`market-playlist-track-row ${
                                        playing.id === s.id && playing.playlistId === pl.id
                                          ? 'active'
                                          : ''
                                      }`}
                                      onClick={() =>
                                        store.playSong(
                                          s,
                                          plSongs,
                                          pl.id,
                                          `playlist:${pl.id}`
                                        )
                                      }
                                    >
                                      <span className="market-playlist-track-idx">{i + 1}</span>
                                      <span className="market-playlist-track-name">{s.title}</span>
                                    </button>
                                    {isOwner && (
                                      <button
                                        type="button"
                                        className="market-playlist-track-remove-btn"
                                        onClick={() =>
                                          void handleRemoveSongFromExpandedPlaylist(
                                            pl,
                                            s.id,
                                            s.title
                                          )
                                        }
                                        aria-label={`Remove ${s.title}`}
                                      >
                                        <X size={10} />
                                      </button>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </section>
            </>
          )}
        </div>
      ) : (
        /* Filtered / Search View */
        <div className="market-grid panel scrollable">
          {error && publicSongs.length > 0 && <div role="alert">{error.message}</div>}

          {displayedSongs.length === 0 ? (
            <div className="market-empty" data-guide="market.empty">
              <span className="market-empty-title">
                {error ? 'ERROR' : isPending ? 'LOADING' : 'NONE'}
              </span>
              {hasActiveFilters && (
                <Tooltip title="Reset">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearAllFilters}
                    className="market-clear-btn"
                  >
                    <RotateCcw size={12} />
                  </Button>
                </Tooltip>
              )}
            </div>
          ) : (
            <>
              {visibleGroups.map((versions) =>
                renderSongCard(versions, displayedSongs, 'filtered')
              )}
              {visibleCount < groupedDisplayed.length && (
                <div className="market-load-more-row">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setVisibleCount((prev) => prev + batchSize)}
                  >
                    +{groupedDisplayed.length - visibleCount}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Mobile Search Modal Popup */}
      <Modal
        isOpen={searchModalOpen}
        onClose={() => setSearchModalOpen(false)}
        title="SEARCH"
        size="sm"
      >
        <form
          className="market-search-modal-form"
          onSubmit={(e) => {
            e.preventDefault();
            setSearchModalOpen(false);
          }}
        >
          <div className="market-search-modal-input-wrap">
            <Search size={13} className="market-search-icon" />
            <input
              type="text"
              placeholder="TRACKS, TAGS, CREATORS..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="market-search-input"
              autoFocus
            />
            {search && (
              <button
                type="button"
                className="market-filter-clear-btn"
                onClick={() => setSearch('')}
                aria-label="Clear search"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </form>
      </Modal>

      <ShareModal
        isOpen={Boolean(shareData)}
        onClose={() => setShareData(null)}
        data={shareData}
      />
    </div>
  );
};
