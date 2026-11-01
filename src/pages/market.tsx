import { useGuideOwner, prepareViews } from '../components/guide/owners';
import { useDismiss } from '../hooks/use-dismiss';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import {
  User,
  Search,
  X,
  Music,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  Check,
  Sparkles,
  Flame,
  ListMusic,
  Disc3,
  Play,
  Pause,
  Plus,
  Lock,
  Globe,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import { Glitch } from '../components/glitch';
import { Button } from '../components/button';
import { Modal } from '../components/modal';
import { Tooltip } from '../components/daw/Tooltip';
import { Card, normalizeTags, getGenreCoverImage, normalizeGenreSlug } from '../components/card';
import { store } from '../lib/store';
import { useSongs, useMarketFolds, usePaginatedSongs } from '../hooks/use-songs';
import { useGenreCovers } from '../hooks/use-genres';
import { usePublicAlbums } from '../hooks/use-albums';
import {
  usePublicPlaylists,
  useCreatorPlaylists,
  createPlaylistApi,
  addSongToPlaylistApi,
  recordPlaylistPlayApi,
} from '../hooks/use-playlists';
import { useSelectedUserAddress } from '../hooks/use-address';
import { fetchUserProfilesBatch, type WalletPairProfile } from '../hooks/use-profile';
import { readCachedProfile } from '../lib/cache';
import { groupSongs } from '../lib/versions';
import { openGate } from '../lib/gate';
import { marketCreator, marketPath } from '../lib/routes';
import { songToShareData, type MintShareData } from '../lib/share';
import { ShareModal } from '../components/share';
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
  addresses: Set<string>;
}

function findCreatorGroup(groups: CreatorGroup[], rawCreator: string | null): CreatorGroup | null {
  if (!rawCreator) return null;
  const lower = rawCreator.trim().toLowerCase();
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
  const [order, setOrder] = useState<'latest' | 'oldest'>('latest');
  const [search, setSearch] = useState<string>('');
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [selected, setSelected] = useState<Record<string, string>>({});

  // Foldable categories & progressive row expansion per category (10 bounded items per horizontal shelf row)
  const ITEMS_PER_SHELF_ROW = 10;
  const [foldedShelves, setFoldedShelves] = useState<Record<string, boolean>>({});
  const [shelfRows, setShelfRows] = useState<Record<string, number>>({});
  const [viewMode, setViewMode] = useState<
    'all' | 'new' | 'popular' | 'genres' | 'creators' | 'albums' | 'playlists'
  >('all');
  const [viewMenuOpen, setViewMenuOpen] = useState(false);

  const [batchSize, setBatchSize] = useState<20 | 50 | 100>(20);
  const [pollIntervalMin, setPollIntervalMin] = useState<15 | 30 | 60>(60);
  const [feedConfigOpen, setFeedConfigOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState<number>(20);

  const [creatorOpen, setCreatorOpen] = useState(false);
  const [creatorQuery, setCreatorQuery] = useState('');
  const [genreOpen, setGenreOpen] = useState(false);
  const [genreQuery, setGenreQuery] = useState('');

  // Playlist modal & expanded playlist state
  const [playlistTargetSong, setPlaylistTargetSong] = useState<Song | null>(null);
  const [newPlaylistTitle, setNewPlaylistTitle] = useState('');
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);
  const [expandedPlaylistId, setExpandedPlaylistId] = useState<string | null>(null);

  const shelvesViewportRef = useRef<HTMLDivElement>(null);
  const viewMenuRef = useRef<HTMLDivElement>(null);
  const creatorPopoverRef = useRef<HTMLDivElement>(null);
  const genrePopoverRef = useRef<HTMLDivElement>(null);
  const feedConfigRef = useRef<HTMLDivElement>(null);
  const playlistModalRef = useRef<HTMLDivElement>(null);

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
  const { data: myPlaylists = [] } = useCreatorPlaylists(readAddress);

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
  }, [batchSize, selectedCreator, selectedGenres, selectedAlbumId, search]);

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

  useDismiss(viewMenuOpen, () => setViewMenuOpen(false), viewMenuRef);
  useDismiss(creatorOpen, () => setCreatorOpen(false), creatorPopoverRef);
  useDismiss(genreOpen, () => setGenreOpen(false), genrePopoverRef);
  useDismiss(feedConfigOpen, () => setFeedConfigOpen(false), feedConfigRef);
  useDismiss(Boolean(playlistTargetSong), () => setPlaylistTargetSong(null), playlistModalRef);

  // Map public albums and songs by id for rapid lookup
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

  // Extract unique creators & batch-resolve paired identities + nicknames
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
      const rawNickname = pair?.nickname?.trim() || cached?.nickname?.trim() || null;
      const rawAvatar = pair?.avatar?.trim() || cached?.avatar?.trim() || null;
      const nicknameKey = rawNickname ? rawNickname.toLowerCase() : null;

      const candidateAddresses = new Set<string>([lower]);
      if (pair?.evmAddress) candidateAddresses.add(pair.evmAddress.toLowerCase());
      if (pair?.svmAddress) candidateAddresses.add(pair.svmAddress.toLowerCase());

      const shortAddr = raw.startsWith('0x')
        ? `${raw.slice(0, 6)}…${raw.slice(-4)}`
        : `${raw.slice(0, 4)}…${raw.slice(-4)}`;

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
      } else {
        const canonicalKey =
          pair?.evmAddress?.toLowerCase() || pair?.svmAddress?.toLowerCase() || lower;
        groups.push({
          key: canonicalKey,
          label: rawNickname || shortAddr,
          nicknameKey,
          avatar: rawAvatar,
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
    return address.startsWith('0x')
      ? `${address.slice(0, 6)}…${address.slice(-4)}`
      : `${address.slice(0, 4)}…${address.slice(-4)}`;
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

  // Extract unique normalized genres / tags
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

  // Apply filters and ordering
  const displayedSongs = useMemo(() => {
    let list = [...publicSongs];

    if (selectedAlbumId) {
      list = list.filter((s) => s.album_id === selectedAlbumId);
    }

    if (selectedCreator) {
      const lower = selectedCreator.trim().toLowerCase();
      const group = findCreatorGroup(creatorGroups, selectedCreator);
      const targetAddresses = group ? group.addresses : new Set([lower]);
      list = list.filter(
        (s) =>
          Boolean(s.creator && targetAddresses.has(s.creator.toLowerCase())) ||
          Boolean(group && s.creator && group.addresses.has(s.creator.toLowerCase()))
      );
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
      const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
      return order === 'latest' ? timeB - timeA : timeA - timeB;
    });

    return list;
  }, [publicSongs, selectedAlbumId, selectedCreator, selectedGenres, search, order, creatorGroups]);

  // Derived full shelves for progressive row addition in the Discovery Matrix
  const newReleasesAll = useMemo<Song[]>(() => {
    const foldSongs = foldsData?.newReleases?.songs || [];
    const seen = new Set(foldSongs.map((s) => s.id));
    const rest = publicSongs.filter((s) => !seen.has(s.id));
    return [...foldSongs, ...rest].sort((a, b) => {
      const tA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tB = b.created_at ? new Date(b.created_at).getTime() : 0;
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
      const tA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tB = b.created_at ? new Date(b.created_at).getTime() : 0;
      return tB - tA;
    });
  }, [foldsData, publicSongs]);

  const newReleaseGroups = useMemo(() => groupSongs(newReleasesAll), [newReleasesAll]);
  const popularGroups = useMemo(() => groupSongs(popularAll), [popularAll]);

  // Deduplicated playable tracklists (one selected version per song family)
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

  const selectedCreatorLabel = useMemo(() => {
    if (!selectedCreator) return null;
    if (selectedCreatorGroup) return selectedCreatorGroup.label;
    const raw = selectedCreator.trim();
    if (raw.startsWith('0x') && raw.length > 14) {
      return `${raw.slice(0, 6)}…${raw.slice(-4)}`;
    }
    if (raw.length >= 32) {
      return `${raw.slice(0, 4)}…${raw.slice(-4)}`;
    }
    return raw;
  }, [selectedCreator, selectedCreatorGroup]);

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
    selectedCreator || selectedGenres.length > 0 || selectedAlbumId || search.trim()
  );

  const hasActiveFilters = Boolean(hasFilterPills || order === 'oldest');

  const clearAllFilters = () => {
    setSelectedCreator(null);
    setSelectedGenres([]);
    setSelectedAlbumId(null);
    setSearch('');
    setOrder('latest');
  };

  const toggleShelfFold = (shelfId: string) => {
    setFoldedShelves((prev) => ({ ...prev, [shelfId]: !prev[shelfId] }));
  };

  const handleMoreRows = (shelfId: string, totalItems: number) => {
    const totalRows = Math.max(1, Math.ceil(totalItems / ITEMS_PER_SHELF_ROW));
    setShelfRows((prev) => {
      const current = prev[shelfId] ?? 1;
      if (current < totalRows) {
        return { ...prev, [shelfId]: current + 1 };
      }
      return { ...prev, [shelfId]: 1 };
    });
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

  const handleAddTrackToExistingPlaylist = async (playlist: Playlist) => {
    if (!playlistTargetSong || !readAddress) return;
    try {
      await addSongToPlaylistApi(playlist.id, playlistTargetSong.id, readAddress);
      await queryClient.invalidateQueries({ queryKey: ['playlists'] });
      toast.success(`Added "${playlistTargetSong.title}" to "${playlist.title}"`);
      setPlaylistTargetSong(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add track');
    }
  };

  const handleCreatePlaylistWithSong = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!playlistTargetSong) return;
    if (!readAddress) {
      openGate();
      return;
    }
    const title = newPlaylistTitle.trim();
    if (!title) return;
    setCreatingPlaylist(true);
    try {
      await createPlaylistApi(
        {
          title,
          creator: readAddress,
          song_ids: [playlistTargetSong.id],
          cover: playlistTargetSong.image || '',
          public: false,
        },
        readAddress
      );
      await queryClient.invalidateQueries({ queryKey: ['playlists'] });
      toast.success(`Created private playlist "${title}" — toggle Public anytime in /my-page`);
      setNewPlaylistTitle('');
      setPlaylistTargetSong(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create playlist');
    } finally {
      setCreatingPlaylist(false);
    }
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
        onAddToPlaylist={(s: Song) => {
          if (!readAddress) {
            openGate();
            return;
          }
          setPlaylistTargetSong(s);
        }}
      />
    );
  };

  const groupedDisplayed = useMemo(() => groupSongs(displayedSongs), [displayedSongs]);
  const visibleGroups = useMemo(
    () => groupedDisplayed.slice(0, visibleCount),
    [groupedDisplayed, visibleCount]
  );

  const isMatrixView = !hasFilterPills && order === 'latest';

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

  return (
    <div className={`market-container ${className}`}>
      {/* Marketplace Header */}
      <div className="market-header">
        <div className="market-header-left">
          <Glitch text="AUDIO_MARKET" className="market-title-text" />
          <div className="market-subtitle">
            STREAM TRACKS • {totalPublicCount} PUBLIC TRACKS
            {hasActiveFilters && (
              <span className="market-subtitle-filter">({displayedSongs.length} SHOWN)</span>
            )}
          </div>
        </div>
        {(() => {
          const viewOptions = [
            { id: 'all', label: 'ALL', Icon: Globe },
            { id: 'new', label: 'NEW', Icon: Sparkles },
            { id: 'popular', label: 'POPULAR', Icon: Flame },
            { id: 'genres', label: 'GENRES', Icon: Music },
            { id: 'creators', label: 'CREATORS', Icon: User },
            { id: 'albums', label: 'ALBUMS', Icon: Disc3 },
            { id: 'playlists', label: 'PLAYLISTS', Icon: ListMusic },
          ] as const;
          const activeOption =
            viewOptions.find((opt) => opt.id === viewMode) ?? viewOptions[0];
          const ActiveIcon = activeOption.Icon;

          return (
            <div className="market-view-select-wrap" ref={viewMenuRef}>
              <button
                type="button"
                className={`market-view-trigger ${viewMode !== 'all' ? 'has-selection' : ''} ${viewMenuOpen ? 'is-open' : ''}`}
                onClick={() => {
                  setViewMenuOpen((prev) => !prev);
                  setCreatorOpen(false);
                  setGenreOpen(false);
                  setFeedConfigOpen(false);
                }}
                aria-label="Market Shelves"
                aria-haspopup="listbox"
                aria-expanded={viewMenuOpen}
              >
                <ActiveIcon size={13} className="market-select-icon" />
                <span className="market-view-trigger-label">{activeOption.label}</span>
                <ChevronDown size={12} className="market-view-chevron" />
              </button>

              {viewMenuOpen && (
                <div
                  className="market-popover-menu market-view-menu"
                  role="listbox"
                  aria-label="Market Shelves"
                >
                  <div className="market-popover-list">
                    {viewOptions.map((option) => {
                      const OptionIcon = option.Icon;
                      const isSelected = viewMode === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          className={`market-popover-option ${isSelected ? 'selected' : ''}`}
                          onClick={() => {
                            setViewMode(option.id);
                            if (option.id !== 'all') {
                              setFoldedShelves((prev) => ({ ...prev, [option.id]: false }));
                            }
                            setViewMenuOpen(false);
                          }}
                        >
                          <span className="market-view-option-left">
                            <OptionIcon size={12} className="market-select-icon" />
                            <span className="market-popover-option-text">{option.label}</span>
                          </span>
                          {isSelected && <Check size={11} className="market-popover-check" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* Filter and Search Bar */}
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

        {/* Mobile Icon-Only Search Trigger (opens small Modal like /editor AI Ops) */}
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
          {/* Searchable Creator Combobox Popover */}
          <div className="market-select-wrap" ref={creatorPopoverRef}>
            <button
              type="button"
              className={`market-popover-trigger ${selectedCreator ? 'has-selection' : ''} ${creatorOpen ? 'is-open' : ''}`}
              onClick={() => {
                setCreatorOpen((prev) => !prev);
                setGenreOpen(false);
                setFeedConfigOpen(false);
                setViewMenuOpen(false);
              }}
              aria-label="Filter by creator"
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
                    placeholder="SEARCH CREATORS..."
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
                  {!creatorQuery.trim() && (
                    <button
                      type="button"
                      role="option"
                      aria-selected={!selectedCreator}
                      className={`market-popover-option ${!selectedCreator ? 'selected' : ''}`}
                      onClick={() => {
                        setSelectedCreator(null);
                        setCreatorOpen(false);
                        setCreatorQuery('');
                      }}
                    >
                      <span className="market-popover-option-text">
                        ALL ({creatorGroups.length})
                      </span>
                      {!selectedCreator && <Check size={11} className="market-popover-check" />}
                    </button>
                  )}

                  {filteredCreatorGroups.length === 0 ? (
                    <div className="market-popover-empty">NONE</div>
                  ) : (
                    filteredCreatorGroups.map((g) => {
                      const isSelected =
                        selectedCreatorGroup?.key === g.key ||
                        selectedCreator?.toLowerCase() === g.key;
                      const slug = g.nicknameKey ? g.label : g.key;
                      return (
                        <button
                          key={g.key}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          className={`market-popover-option ${isSelected ? 'selected' : ''}`}
                          onClick={() => {
                            setSelectedCreator(isSelected ? null : slug);
                            setCreatorOpen(false);
                            setCreatorQuery('');
                          }}
                        >
                          <span className="market-popover-option-text">{g.label}</span>
                          {isSelected && <Check size={11} className="market-popover-check" />}
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
                setViewMenuOpen(false);
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

          {/* Order Toggle (Latest | Oldest) - Icon + Tooltip */}
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
                  setViewMenuOpen(false);
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

          {/* Clear Filters Reset Button */}
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
          {selectedCreatorLabel && (
            <button
              type="button"
              className="market-filter-pill creator"
              onClick={() => setSelectedCreator(null)}
              aria-label={`Remove creator filter ${selectedCreatorLabel}`}
            >
              <User size={10} />
              <span>{selectedCreatorLabel}</span>
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

      {/* Main Content Area: Foldable Categories with Progressive Row Addition OR Filtered Grid */}
      {isMatrixView ? (
        <div className="market-shelves-viewport panel scrollable" ref={shelvesViewportRef}>
          {error && publicSongs.length === 0 ? (
            <div className="market-empty">
              <span className="market-empty-title">ERROR</span>
              <span className="market-empty-desc">{error.message}</span>
            </div>
          ) : publicSongs.length === 0 ? (
            <div className="market-empty">
              <span className="market-empty-title">
                {isPending ? 'LOADING' : 'EMPTY'}
              </span>
            </div>
          ) : (
            <>
              {/* 1. NEW CATEGORY */}
              {(viewMode === 'all' || viewMode === 'new') &&
                (() => {
                  const isFolded = Boolean(foldedShelves.new);
                  const totalRows = Math.max(1, Math.ceil(newReleaseGroups.length / ITEMS_PER_SHELF_ROW));
                  const rows =
                    viewMode === 'new'
                      ? Math.max(shelfRows.new ?? 2, Math.min(totalRows, 3))
                      : Math.min(shelfRows.new ?? 1, totalRows);
                  const allExpanded = rows >= totalRows;
                  const isPlayingNewShelf =
                    playing.active && playing.contextId === 'new';
                  const recentWindowCount = foldsData?.newReleases?.lastHourCount ?? 0;
                  return (
                    <section className={`market-shelf ${isFolded ? 'is-folded' : ''}`} aria-label="New">
                      <div className="market-shelf-header">
                        <button
                          type="button"
                          className="market-shelf-title-btn"
                          onClick={() => toggleShelfFold('new')}
                          aria-expanded={!isFolded}
                        >
                          {isFolded ? (
                            <ChevronRight size={14} className="market-shelf-fold-icon" />
                          ) : (
                            <ChevronDown size={14} className="market-shelf-fold-icon" />
                          )}
                          <Sparkles size={14} className="market-shelf-icon accent" />
                          <h2 className="market-shelf-title">NEW</h2>
                          {recentWindowCount > 0 && (
                            <span className="market-live-badge">
                              +{recentWindowCount} / {pollIntervalMin}M
                            </span>
                          )}
                        </button>
                        <div className="market-shelf-actions">
                          <button
                            type="button"
                            className={`market-shelf-playall-btn ${isPlayingNewShelf ? 'active' : ''}`}
                            onClick={() => handlePlayCollection(newReleasePlayable, 'new')}
                            aria-label={isPlayingNewShelf ? 'Pause New' : 'Play All New'}
                          >
                            {isPlayingNewShelf ? <Pause size={12} /> : <Play size={12} />}
                            <span>PLAY ALL</span>
                          </button>
                        </div>
                      </div>
                      {!isFolded && (
                        <>
                          <div className="market-shelf-rows">
                            {Array.from({ length: rows }, (_, rowIdx) => {
                              const rowSlice = newReleaseGroups.slice(
                                rowIdx * ITEMS_PER_SHELF_ROW,
                                (rowIdx + 1) * ITEMS_PER_SHELF_ROW
                              );
                              return (
                                <div key={rowIdx} className="market-shelf-row">
                                  {rowSlice.map((versions) =>
                                    renderSongCard(versions, newReleasePlayable, 'new')
                                  )}
                                </div>
                              );
                            })}
                          </div>
                          {newReleaseGroups.length > ITEMS_PER_SHELF_ROW && (
                            <div className="market-shelf-footer">
                              <button
                                type="button"
                                className={`market-shelf-more-row-btn ${allExpanded ? 'expanded' : ''}`}
                                onClick={() => handleMoreRows('new', newReleaseGroups.length)}
                              >
                                <span>MORE</span>
                                {allExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </section>
                  );
                })()}

              {/* 2. POPULAR CATEGORY */}
              {(viewMode === 'all' || viewMode === 'popular') &&
                (() => {
                  const isFolded = Boolean(foldedShelves.popular);
                  const totalRows = Math.max(1, Math.ceil(popularGroups.length / ITEMS_PER_SHELF_ROW));
                  const rows =
                    viewMode === 'popular'
                      ? Math.max(shelfRows.popular ?? 2, Math.min(totalRows, 3))
                      : Math.min(shelfRows.popular ?? 1, totalRows);
                  const allExpanded = rows >= totalRows;
                  const isPlayingPopularShelf =
                    playing.active && playing.contextId === 'popular';
                  return (
                    <section
                      className={`market-shelf ${isFolded ? 'is-folded' : ''}`}
                      aria-label="Popular"
                    >
                      <div className="market-shelf-header">
                        <button
                          type="button"
                          className="market-shelf-title-btn"
                          onClick={() => toggleShelfFold('popular')}
                          aria-expanded={!isFolded}
                        >
                          {isFolded ? (
                            <ChevronRight size={14} className="market-shelf-fold-icon" />
                          ) : (
                            <ChevronDown size={14} className="market-shelf-fold-icon" />
                          )}
                          <Flame size={14} className="market-shelf-icon hot" />
                          <h2 className="market-shelf-title">POPULAR</h2>
                        </button>
                        <div className="market-shelf-actions">
                          <button
                            type="button"
                            className={`market-shelf-playall-btn ${isPlayingPopularShelf ? 'active' : ''}`}
                            onClick={() => handlePlayCollection(popularPlayable, 'popular')}
                            aria-label={isPlayingPopularShelf ? 'Pause Popular' : 'Play All Popular'}
                          >
                            {isPlayingPopularShelf ? <Pause size={12} /> : <Play size={12} />}
                            <span>PLAY ALL</span>
                          </button>
                        </div>
                      </div>
                      {!isFolded && (
                        <>
                          <div className="market-shelf-rows">
                            {Array.from({ length: rows }, (_, rowIdx) => {
                              const rowSlice = popularGroups.slice(
                                rowIdx * ITEMS_PER_SHELF_ROW,
                                (rowIdx + 1) * ITEMS_PER_SHELF_ROW
                              );
                              return (
                                <div key={rowIdx} className="market-shelf-row">
                                  {rowSlice.map((versions) =>
                                    renderSongCard(versions, popularPlayable, 'popular')
                                  )}
                                </div>
                              );
                            })}
                          </div>
                          {popularGroups.length > ITEMS_PER_SHELF_ROW && (
                            <div className="market-shelf-footer">
                              <button
                                type="button"
                                className={`market-shelf-more-row-btn ${allExpanded ? 'expanded' : ''}`}
                                onClick={() => handleMoreRows('popular', popularGroups.length)}
                              >
                                <span>MORE</span>
                                {allExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </section>
                  );
                })()}

              {/* 3. GENRES CATEGORY */}
              {(viewMode === 'all' || viewMode === 'genres') &&
                genreItems.length > 0 &&
                (() => {
                  const isFolded = Boolean(foldedShelves.genres);
                  const totalRows = Math.max(1, Math.ceil(genreItems.length / ITEMS_PER_SHELF_ROW));
                  const rows = Math.min(shelfRows.genres ?? 1, totalRows);
                  const allExpanded = rows >= totalRows;
                  const genreAllSongs = genreItems.flatMap((g) => g.songs);
                  const isPlayingGenresShelf =
                    playing.active && playing.contextId === 'genres';
                  return (
                    <section
                      className={`market-shelf ${isFolded ? 'is-folded' : ''}`}
                      aria-label="Genres"
                    >
                      <div className="market-shelf-header">
                        <button
                          type="button"
                          className="market-shelf-title-btn"
                          onClick={() => toggleShelfFold('genres')}
                          aria-expanded={!isFolded}
                        >
                          {isFolded ? (
                            <ChevronRight size={14} className="market-shelf-fold-icon" />
                          ) : (
                            <ChevronDown size={14} className="market-shelf-fold-icon" />
                          )}
                          <Music size={14} className="market-shelf-icon" />
                          <h2 className="market-shelf-title">GENRES</h2>
                        </button>
                        <div className="market-shelf-actions">
                          <button
                            type="button"
                            className={`market-shelf-playall-btn ${isPlayingGenresShelf ? 'active' : ''}`}
                            onClick={() => handlePlayCollection(genreAllSongs, 'genres')}
                            aria-label={isPlayingGenresShelf ? 'Pause Genres' : 'Play All Genres'}
                          >
                            {isPlayingGenresShelf ? <Pause size={12} /> : <Play size={12} />}
                            <span>PLAY ALL</span>
                          </button>
                        </div>
                      </div>
                      {!isFolded && (
                        <>
                          <div className="market-shelf-rows">
                            {Array.from({ length: rows }, (_, rowIdx) => {
                              const rowSlice = genreItems.slice(
                                rowIdx * ITEMS_PER_SHELF_ROW,
                                (rowIdx + 1) * ITEMS_PER_SHELF_ROW
                              );
                              return (
                                <div key={rowIdx} className="market-shelf-row">
                                  {rowSlice.map((genreFold) => {
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
                                        className="market-collection-card"
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
                                        <div className="market-collection-media">
                                          <img
                                            src={cover}
                                            alt={genreFold.label}
                                            loading="lazy"
                                            decoding="async"
                                            onError={(e) => {
                                              if (e.currentTarget.src !== fallbackCover) {
                                                e.currentTarget.src = fallbackCover;
                                              }
                                            }}
                                          />
                                          <button
                                            type="button"
                                            className={`market-collection-play-btn ${isPlayingGenre ? 'playing' : ''}`}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handlePlayCollection(genreFold.songs, genreCtx);
                                            }}
                                            aria-label={`Play ${genreFold.label}`}
                                          >
                                            {isPlayingGenre ? <Pause size={14} /> : <Play size={14} />}
                                          </button>
                                        </div>
                                        <div className="market-collection-body">
                                          <div className="market-collection-title">
                                            #{genreFold.label}
                                          </div>
                                          <div className="market-collection-meta">
                                            <span>{genreFold.total}</span>
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            })}
                          </div>
                          {genreItems.length > ITEMS_PER_SHELF_ROW && (
                            <div className="market-shelf-footer">
                              <button
                                type="button"
                                className={`market-shelf-more-row-btn ${allExpanded ? 'expanded' : ''}`}
                                onClick={() => handleMoreRows('genres', genreItems.length)}
                              >
                                <span>MORE</span>
                                {allExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </section>
                  );
                })()}

              {/* 4. CREATORS CATEGORY (Preview = Creator Avatar or Brand Logo) */}
              {(viewMode === 'all' || viewMode === 'creators') &&
                creatorItems.length > 0 &&
                (() => {
                  const isFolded = Boolean(foldedShelves.creators);
                  const totalRows = Math.max(1, Math.ceil(creatorItems.length / ITEMS_PER_SHELF_ROW));
                  const rows = Math.min(shelfRows.creators ?? 1, totalRows);
                  const allExpanded = rows >= totalRows;
                  const creatorAllSongs = creatorItems.flatMap((c) => c.songs);
                  const isPlayingCreatorsShelf =
                    playing.active && playing.contextId === 'creators';
                  return (
                    <section
                      className={`market-shelf ${isFolded ? 'is-folded' : ''}`}
                      aria-label="Creators"
                    >
                      <div className="market-shelf-header">
                        <button
                          type="button"
                          className="market-shelf-title-btn"
                          onClick={() => toggleShelfFold('creators')}
                          aria-expanded={!isFolded}
                        >
                          {isFolded ? (
                            <ChevronRight size={14} className="market-shelf-fold-icon" />
                          ) : (
                            <ChevronDown size={14} className="market-shelf-fold-icon" />
                          )}
                          <User size={14} className="market-shelf-icon" />
                          <h2 className="market-shelf-title">CREATORS</h2>
                        </button>
                        <div className="market-shelf-actions">
                          <button
                            type="button"
                            className={`market-shelf-playall-btn ${isPlayingCreatorsShelf ? 'active' : ''}`}
                            onClick={() => handlePlayCollection(creatorAllSongs, 'creators')}
                            aria-label={isPlayingCreatorsShelf ? 'Pause Creators' : 'Play All Creators'}
                          >
                            {isPlayingCreatorsShelf ? <Pause size={12} /> : <Play size={12} />}
                            <span>PLAY ALL</span>
                          </button>
                        </div>
                      </div>
                      {!isFolded && (
                        <>
                          <div className="market-shelf-rows">
                            {Array.from({ length: rows }, (_, rowIdx) => {
                              const rowSlice = creatorItems.slice(
                                rowIdx * ITEMS_PER_SHELF_ROW,
                                (rowIdx + 1) * ITEMS_PER_SHELF_ROW
                              );
                              return (
                                <div key={rowIdx} className="market-shelf-row">
                                  {rowSlice.map(({ group, songs }) => {
                                    const cover = group.avatar || '/branding/mark.svg';
                                    const creatorCtx = `creator:${group.key}`;
                                    const isPlayingCreator =
                                      playing.active && playing.contextId === creatorCtx;
                                    const creatorSlug = group.nicknameKey ? group.label : group.key;
                                    return (
                                      <div
                                        key={group.key}
                                        className="market-collection-card"
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
                                          className={`market-collection-media ${!group.avatar ? 'is-logo' : ''}`}
                                        >
                                          <img
                                            src={cover}
                                            alt={group.label}
                                            loading="lazy"
                                            decoding="async"
                                            onError={(e) => {
                                              e.currentTarget.src = '/branding/mark.svg';
                                              e.currentTarget.parentElement?.classList.add('is-logo');
                                            }}
                                          />
                                          <button
                                            type="button"
                                            className={`market-collection-play-btn ${isPlayingCreator ? 'playing' : ''}`}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handlePlayCollection(songs, creatorCtx);
                                            }}
                                            aria-label={`Play ${group.label}`}
                                          >
                                            {isPlayingCreator ? <Pause size={14} /> : <Play size={14} />}
                                          </button>
                                        </div>
                                        <div className="market-collection-body">
                                          <div className="market-collection-title">{group.label}</div>
                                          <div className="market-collection-meta">
                                            <span>{songs.length}</span>
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            })}
                          </div>
                          {creatorItems.length > ITEMS_PER_SHELF_ROW && (
                            <div className="market-shelf-footer">
                              <button
                                type="button"
                                className={`market-shelf-more-row-btn ${allExpanded ? 'expanded' : ''}`}
                                onClick={() => handleMoreRows('creators', creatorItems.length)}
                              >
                                <span>MORE</span>
                                {allExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </section>
                  );
                })()}

              {/* 5. ALBUMS CATEGORY */}
              {(viewMode === 'all' || viewMode === 'albums') &&
                publicAlbums.length > 0 &&
                (() => {
                  const isFolded = Boolean(foldedShelves.albums);
                  const totalRows = Math.max(1, Math.ceil(publicAlbums.length / ITEMS_PER_SHELF_ROW));
                  const rows = Math.min(shelfRows.albums ?? 1, totalRows);
                  const allExpanded = rows >= totalRows;
                  const albumAllSongs = publicAlbums.flatMap((album) =>
                    popularPlayable.filter((s) => s.album_id === album.id)
                  );
                  const isPlayingAlbumsShelf =
                    playing.active && playing.contextId === 'albums';
                  return (
                    <section
                      className={`market-shelf ${isFolded ? 'is-folded' : ''}`}
                      aria-label="Albums"
                    >
                      <div className="market-shelf-header">
                        <button
                          type="button"
                          className="market-shelf-title-btn"
                          onClick={() => toggleShelfFold('albums')}
                          aria-expanded={!isFolded}
                        >
                          {isFolded ? (
                            <ChevronRight size={14} className="market-shelf-fold-icon" />
                          ) : (
                            <ChevronDown size={14} className="market-shelf-fold-icon" />
                          )}
                          <Disc3 size={14} className="market-shelf-icon" />
                          <h2 className="market-shelf-title">ALBUMS</h2>
                        </button>
                        {albumAllSongs.length > 0 && (
                          <div className="market-shelf-actions">
                            <button
                              type="button"
                              className={`market-shelf-playall-btn ${isPlayingAlbumsShelf ? 'active' : ''}`}
                              onClick={() => handlePlayCollection(albumAllSongs, 'albums')}
                              aria-label={isPlayingAlbumsShelf ? 'Pause Albums' : 'Play All Albums'}
                            >
                              {isPlayingAlbumsShelf ? <Pause size={12} /> : <Play size={12} />}
                              <span>PLAY ALL</span>
                            </button>
                          </div>
                        )}
                      </div>
                      {!isFolded && (
                        <>
                          <div className="market-shelf-rows">
                            {Array.from({ length: rows }, (_, rowIdx) => {
                              const rowSlice = publicAlbums.slice(
                                rowIdx * ITEMS_PER_SHELF_ROW,
                                (rowIdx + 1) * ITEMS_PER_SHELF_ROW
                              );
                              return (
                                <div key={rowIdx} className="market-shelf-row">
                                  {rowSlice.map((album) => {
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
                                        className="market-collection-card"
                                        onClick={() => setSelectedAlbumId(album.id)}
                                        role="button"
                                        tabIndex={0}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            setSelectedAlbumId(album.id);
                                          }
                                        }}
                                      >
                                        <div className="market-collection-media">
                                          <img
                                            src={cover}
                                            alt={album.title}
                                            loading="lazy"
                                            decoding="async"
                                          />
                                          <button
                                            type="button"
                                            className={`market-collection-play-btn ${isPlayingAlbum ? 'playing' : ''}`}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handlePlayAlbum(album);
                                            }}
                                            aria-label={`Play ${album.title}`}
                                          >
                                            {isPlayingAlbum ? <Pause size={14} /> : <Play size={14} />}
                                          </button>
                                        </div>
                                        <div className="market-collection-body">
                                          <div className="market-collection-title">{album.title}</div>
                                          <div className="market-collection-meta">
                                            <span>{resolveCreatorLabel(album.creator)}</span>
                                            <span>•</span>
                                            <span>{albumSongs.length}</span>
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            })}
                          </div>
                          {publicAlbums.length > ITEMS_PER_SHELF_ROW && (
                            <div className="market-shelf-footer">
                              <button
                                type="button"
                                className={`market-shelf-more-row-btn ${allExpanded ? 'expanded' : ''}`}
                                onClick={() => handleMoreRows('albums', publicAlbums.length)}
                              >
                                <span>MORE</span>
                                {allExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </section>
                  );
                })()}

              {/* 6. PLAYLISTS CATEGORY */}
              {(viewMode === 'all' || viewMode === 'playlists') &&
                (publicPlaylists.length > 0 || viewMode === 'playlists') &&
                (() => {
                  const isFolded = Boolean(foldedShelves.playlists);
                  const totalRows = Math.max(
                    1,
                    Math.ceil(publicPlaylists.length / ITEMS_PER_SHELF_ROW)
                  );
                  const rows = Math.min(shelfRows.playlists ?? 1, totalRows);
                  const allExpanded = rows >= totalRows;
                  const playlistAllSongs = publicPlaylists.flatMap((pl) =>
                    (pl.song_ids || [])
                      .map((id) => songsById.get(id))
                      .filter((s): s is Song => Boolean(s))
                  );
                  const isPlayingPlaylistsShelf =
                    playing.active && playing.contextId === 'playlists';
                  return (
                    <section
                      className={`market-shelf ${isFolded ? 'is-folded' : ''}`}
                      aria-label="Playlists"
                    >
                      <div className="market-shelf-header">
                        <button
                          type="button"
                          className="market-shelf-title-btn"
                          onClick={() => toggleShelfFold('playlists')}
                          aria-expanded={!isFolded}
                        >
                          {isFolded ? (
                            <ChevronRight size={14} className="market-shelf-fold-icon" />
                          ) : (
                            <ChevronDown size={14} className="market-shelf-fold-icon" />
                          )}
                          <ListMusic size={14} className="market-shelf-icon" />
                          <h2 className="market-shelf-title">PLAYLISTS</h2>
                        </button>
                        {playlistAllSongs.length > 0 && (
                          <div className="market-shelf-actions">
                            <button
                              type="button"
                              className={`market-shelf-playall-btn ${isPlayingPlaylistsShelf ? 'active' : ''}`}
                              onClick={() => handlePlayCollection(playlistAllSongs, 'playlists')}
                              aria-label={
                                isPlayingPlaylistsShelf ? 'Pause Playlists' : 'Play All Playlists'
                              }
                            >
                              {isPlayingPlaylistsShelf ? <Pause size={12} /> : <Play size={12} />}
                              <span>PLAY ALL</span>
                            </button>
                          </div>
                        )}
                      </div>
                      {!isFolded && (
                        <>
                          <div className="market-shelf-rows">
                            {Array.from({ length: rows }, (_, rowIdx) => {
                              const rowSlice = publicPlaylists.slice(
                                rowIdx * ITEMS_PER_SHELF_ROW,
                                (rowIdx + 1) * ITEMS_PER_SHELF_ROW
                              );
                              return (
                                <div key={rowIdx} className="market-shelf-row">
                                  {rowSlice.map((pl) => {
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
                                    return (
                                      <div
                                        key={pl.id}
                                        className="market-collection-card"
                                        onClick={() =>
                                          setExpandedPlaylistId(isExpanded ? null : pl.id)
                                        }
                                        role="button"
                                        tabIndex={0}
                                      >
                                        <div className="market-collection-media">
                                          <img
                                            src={cover}
                                            alt={pl.title}
                                            loading="lazy"
                                            decoding="async"
                                          />
                                          <button
                                            type="button"
                                            className={`market-collection-play-btn ${isPlayingPl ? 'playing' : ''}`}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handlePlayPlaylist(pl);
                                            }}
                                            aria-label={`Play ${pl.title}`}
                                          >
                                            {isPlayingPl ? <Pause size={14} /> : <Play size={14} />}
                                          </button>
                                        </div>
                                        <div className="market-collection-body">
                                          <div className="market-collection-title">{pl.title}</div>
                                          <div className="market-collection-meta">
                                            <span>{resolveCreatorLabel(pl.creator)}</span>
                                            <span>•</span>
                                            <span>{plSongs.length}</span>
                                          </div>
                                          {isExpanded && plSongs.length > 0 && (
                                            <div
                                              className="market-playlist-tracklist"
                                              onClick={(e) => e.stopPropagation()}
                                            >
                                              {plSongs.map((s, i) => (
                                                <button
                                                  key={`${s.id}-${i}`}
                                                  type="button"
                                                  className={`market-playlist-track-row ${
                                                    playing.id === s.id &&
                                                    playing.playlistId === pl.id
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
                                                  <span className="market-playlist-track-idx">
                                                    {i + 1}
                                                  </span>
                                                  <span className="market-playlist-track-name">
                                                    {s.title}
                                                  </span>
                                                </button>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            })}
                          </div>
                          {publicPlaylists.length > ITEMS_PER_SHELF_ROW && (
                            <div className="market-shelf-footer">
                              <button
                                type="button"
                                className={`market-shelf-more-row-btn ${allExpanded ? 'expanded' : ''}`}
                                onClick={() =>
                                  handleMoreRows('playlists', publicPlaylists.length)
                                }
                              >
                                <span>MORE</span>
                                {allExpanded ? (
                                  <ChevronDown size={12} />
                                ) : (
                                  <ChevronRight size={12} />
                                )}
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </section>
                  );
                })()}
            </>
          )}
        </div>
      ) : (
        /* Filtered / Search Grid View with Chunked Pagination */
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

      {/* Mobile Search Modal Popup (matches /editor AI Ops small modal pattern) */}
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

      {/* Add to Playlist Modal (Entry Point Strictly on /market) */}
      {playlistTargetSong && (
        <div className="market-modal-backdrop" role="dialog" aria-modal="true" aria-label="Playlist">
          <div className="market-playlist-modal panel" ref={playlistModalRef}>
            <div className="market-playlist-modal-header">
              <div className="market-playlist-modal-title-wrap">
                <ListMusic size={14} />
                <span>PLAYLIST</span>
              </div>
              <button
                type="button"
                className="market-filter-clear-btn"
                onClick={() => setPlaylistTargetSong(null)}
                aria-label="Close modal"
              >
                <X size={13} />
              </button>
            </div>

            <div className="market-playlist-modal-target">
              <strong>{playlistTargetSong.title}</strong>
            </div>

            <div className="market-playlist-modal-list scrollable">
              {myPlaylists.length === 0 ? (
                <div className="market-playlist-modal-empty">NONE</div>
              ) : (
                myPlaylists.map((pl) => {
                  const alreadyIn = (pl.song_ids || []).includes(playlistTargetSong.id);
                  return (
                    <button
                      key={pl.id}
                      type="button"
                      className="market-playlist-modal-option"
                      disabled={alreadyIn}
                      onClick={() => handleAddTrackToExistingPlaylist(pl)}
                    >
                      <div className="market-playlist-modal-option-left">
                        {pl.public ? <Globe size={11} /> : <Lock size={11} />}
                        <span className="market-playlist-modal-option-title">{pl.title}</span>
                      </div>
                      <span className="market-playlist-modal-option-meta">
                        {alreadyIn ? <Check size={11} /> : (pl.song_ids || []).length}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            <form className="market-playlist-modal-create" onSubmit={handleCreatePlaylistWithSong}>
              <input
                type="text"
                className="market-playlist-modal-input"
                placeholder="NEW PLAYLIST..."
                value={newPlaylistTitle}
                onChange={(e) => setNewPlaylistTitle(e.target.value)}
                maxLength={80}
              />
              <Button
                type="submit"
                size="xs"
                variant="primary"
                disabled={creatingPlaylist || !newPlaylistTitle.trim()}
                aria-label="Create playlist"
              >
                <Plus size={12} />
              </Button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
