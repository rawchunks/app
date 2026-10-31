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
} from 'lucide-react';
import { Glitch } from '../components/glitch';
import { Button } from '../components/button';
import { Modal } from '../components/modal';
import { Tooltip } from '../components/daw/Tooltip';
import { Card, normalizeTags } from '../components/card';
import { store } from '../lib/store';
import { useSongs } from '../hooks/use-songs';
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

export const Market: React.FC<Props> = ({ className = '' }) => {
  const { readAddress } = useSelectedUserAddress();
  const queryClient = useQueryClient();

  const [playing, setPlaying] = useState(() => ({
    id: store.getState().activeSong?.id,
    active: store.getState().isPlaying,
    playlistId: store.getState().activePlaylistId,
    contextId: store.getState().activeContextId,
  }));
  const [selectedCreator, setSelectedCreator] = useState<string | null>(null);
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

  const batchSize = 20;
  const [visibleCount, setVisibleCount] = useState<number>(batchSize);

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
  const creatorPopoverRef = useRef<HTMLDivElement>(null);
  const genrePopoverRef = useRef<HTMLDivElement>(null);
  const playlistModalRef = useRef<HTMLDivElement>(null);

  const { data: publicSongs = [], isPending, error } = useSongs();
  const { data: publicAlbums = [] } = usePublicAlbums();
  const { data: publicPlaylists = [] } = usePublicPlaylists(50);
  const { data: myPlaylists = [] } = useCreatorPlaylists(readAddress);

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

  useDismiss(creatorOpen, () => setCreatorOpen(false), creatorPopoverRef);
  useDismiss(genreOpen, () => setGenreOpen(false), genrePopoverRef);
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
    const lower = rawAddress.toLowerCase();
    const group = creatorGroups.find((g) => g.addresses.has(lower));
    const targetKey = group ? group.key : lower;
    setSelectedCreator((prev) => (prev === targetKey ? null : targetKey));
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
      const group = creatorGroups.find((g) => g.key === selectedCreator);
      const targetAddresses = group ? group.addresses : new Set([selectedCreator.toLowerCase()]);
      list = list.filter((s) => s.creator && targetAddresses.has(s.creator.toLowerCase()));
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
    return [...publicSongs].sort((a, b) => {
      const tA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tB = b.created_at ? new Date(b.created_at).getTime() : 0;
      return tB - tA;
    });
  }, [publicSongs]);

  const popularAll = useMemo<Song[]>(() => {
    return [...publicSongs].sort((a, b) => {
      const playsDiff = (b.plays ?? 0) - (a.plays ?? 0);
      if (playsDiff !== 0) return playsDiff;
      const tA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tB = b.created_at ? new Date(b.created_at).getTime() : 0;
      return tB - tA;
    });
  }, [publicSongs]);

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

  const selectedCreatorGroup = useMemo(
    () => (selectedCreator ? creatorGroups.find((g) => g.key === selectedCreator) ?? null : null),
    [creatorGroups, selectedCreator]
  );

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
            STREAM TRACKS • {publicSongs.length} PUBLIC TRACKS
            {hasActiveFilters && (
              <span className="market-subtitle-filter">({displayedSongs.length} SHOWN)</span>
            )}
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="market-filter-bar" data-guide="market-toolbar">
        {/* Search input */}
        <div className="market-filter-search">
          <Search size={13} className="market-search-icon" />
          <input
            type="text"
            placeholder="SEARCH TRACKS..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
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
              }}
              aria-label="Filter by creator"
              aria-expanded={creatorOpen}
            >
              <User size={12} className="market-select-icon" />
              <span className="market-popover-trigger-label">
                {selectedCreatorGroup
                  ? selectedCreatorGroup.label
                  : `CREATORS (${creatorGroups.length})`}
              </span>
              <ChevronDown size={12} className="market-popover-chevron" />
            </button>

            {creatorOpen && (
              <div className="market-popover-menu" role="listbox" aria-label="Creators">
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
                        ALL CREATORS ({creatorGroups.length})
                      </span>
                      {!selectedCreator && <Check size={11} className="market-popover-check" />}
                    </button>
                  )}

                  {filteredCreatorGroups.length === 0 ? (
                    <div className="market-popover-empty">NO MATCHING CREATORS</div>
                  ) : (
                    filteredCreatorGroups.map((g) => {
                      const isSelected = selectedCreator === g.key;
                      return (
                        <button
                          key={g.key}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          className={`market-popover-option ${isSelected ? 'selected' : ''}`}
                          onClick={() => {
                            setSelectedCreator(isSelected ? null : g.key);
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
              }}
              aria-label="Filter by genre"
              aria-expanded={genreOpen}
            >
              <Music size={12} className="market-select-icon" />
              <span className="market-popover-trigger-label">
                {selectedGenres.length > 0
                  ? `GENRES (${selectedGenres.length} SELECTED)`
                  : `GENRES (${uniqueGenres.length})`}
              </span>
              <ChevronDown size={12} className="market-popover-chevron" />
            </button>

            {genreOpen && (
              <div
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
                        CLEAR SELECTED ({selectedGenres.length})
                      </span>
                      <X size={11} />
                    </button>
                  )}

                  {filteredGenres.length === 0 ? (
                    <div className="market-popover-empty">NO MATCHING GENRES</div>
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
            <Tooltip title="Sort by Latest" description="Show newest tracks first">
              <button
                type="button"
                className={`market-order-btn ${order === 'latest' ? 'active' : ''}`}
                onClick={() => setOrder('latest')}
                aria-label="Sort by Latest"
              >
                <ArrowDownWideNarrow size={13} />
              </button>
            </Tooltip>
            <Tooltip title="Sort by Oldest" description="Show oldest tracks first">
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

          {/* Clear Filters Reset Button - Icon + Tooltip */}
          {hasActiveFilters && (
            <Tooltip title="Reset Filters" description="Clear active search and filter criteria">
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
          {selectedCreatorGroup && (
            <button
              type="button"
              className="market-filter-pill creator"
              onClick={() => setSelectedCreator(null)}
              aria-label={`Remove creator filter ${selectedCreatorGroup.label}`}
            >
              <User size={10} />
              <span>{selectedCreatorGroup.label}</span>
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
            CLEAR ALL
          </button>
        </div>
      )}

      {/* Catalog Grid */}
      <div className="market-grid panel scrollable">
        {error && publicSongs.length > 0 && <div role="alert">{error.message}</div>}

        {displayedSongs.length === 0 ? (
          <div className="market-empty">
            <span className="market-empty-title">
              {error
                ? 'COULD NOT LOAD MARKET'
                : isPending
                  ? 'LOADING PUBLIC TRACKS'
                  : hasActiveFilters
                    ? 'NO MATCHING TRACKS'
                    : 'NO PUBLIC TRACKS IN MARKET'}
            </span>
            <span className="market-empty-desc">
              {error?.message ??
                (isPending
                  ? 'Loading public songs…'
                  : hasActiveFilters
                    ? 'Clear active filters to view all public tracks.'
                    : 'Creators can make their generated tracks public from /my-page to list them here.')}
            </span>
            {hasActiveFilters && (
              <Tooltip title="Reset Filters" description="Clear all active filters">
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
          groupSongs(displayedSongs).map((versions) => {
            const family = versions[0].family ?? versions[0].id;
            const song = versions.find((item) => item.id === selected[family]) ?? versions[0];
            const isPlayingThis = playing.active && playing.id === song.id;

            const album = song.album_id ? albumsMap.get(song.album_id) : null;
            const albumTitle = album?.title || song.album_title || null;
            const albumCover = album?.cover || null;

            return (
              <Card
                key={family}
                variant="market"
                song={song}
                versions={versions}
                albumTitle={albumTitle}
                albumCover={albumCover}
                isPlayingThis={isPlayingThis}
                onPlayToggle={() => handlePlaySong(song)}
                onSelectVersion={(version) => {
                  setSelected((current) => ({ ...current, [family]: version.id }));
                  if (versions.some((item) => item.id === playing.id)) {
                    store.setActiveSong(version);
                  }
                }}
                selectedGenres={selectedGenres}
                onSelectGenre={toggleGenre}
              />
            );
          })
        )}
      </div>
    </div>
  );
};
