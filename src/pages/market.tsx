import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  User,
  Search,
  X,
  Music,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  RotateCcw,
  ChevronDown,
  Check,
} from 'lucide-react';
import { Glitch } from '../components/glitch';
import { Button } from '../components/button';
import { Tooltip } from '../components/daw/Tooltip';
import { Card, normalizeTags } from '../components/card';
import { store } from '../lib/store';
import { useSongs } from '../hooks/use-songs';
import { usePublicAlbums } from '../hooks/use-albums';
import { fetchUserProfilesBatch, type WalletPairProfile } from '../hooks/use-profile';
import { readCachedProfile } from '../lib/cache';
import { groupSongs } from '../lib/versions';
import type { Song, Album } from '../lib/schema';

export interface Props {
  className?: string;
}

interface CreatorGroup {
  key: string;
  label: string;
  nicknameKey: string | null;
  addresses: Set<string>;
}

export const Market: React.FC<Props> = ({ className = '' }) => {
  const [playing, setPlaying] = useState(() => ({
    id: store.getState().activeSong?.id,
    active: store.getState().isPlaying,
  }));
  const [selectedCreator, setSelectedCreator] = useState<string | null>(null);
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [order, setOrder] = useState<'latest' | 'oldest'>('latest');
  const [search, setSearch] = useState<string>('');
  const [selected, setSelected] = useState<Record<string, string>>({});

  const [creatorOpen, setCreatorOpen] = useState(false);
  const [creatorQuery, setCreatorQuery] = useState('');
  const [genreOpen, setGenreOpen] = useState(false);
  const [genreQuery, setGenreQuery] = useState('');

  const creatorPopoverRef = useRef<HTMLDivElement>(null);
  const genrePopoverRef = useRef<HTMLDivElement>(null);

  const { data: publicSongs = [], isPending, error } = useSongs();
  const { data: publicAlbums = [] } = usePublicAlbums();

  useEffect(() => {
    return store.subscribe((state) => {
      setPlaying((current) =>
        current.id === state.activeSong?.id && current.active === state.isPlaying
          ? current
          : { id: state.activeSong?.id, active: state.isPlaying }
      );
    });
  }, []);

  useEffect(() => {
    if (!creatorOpen && !genreOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (creatorOpen && creatorPopoverRef.current && !creatorPopoverRef.current.contains(target)) {
        setCreatorOpen(false);
      }
      if (genreOpen && genrePopoverRef.current && !genrePopoverRef.current.contains(target)) {
        setGenreOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setCreatorOpen(false);
        setGenreOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [creatorOpen, genreOpen]);

  // Map public albums by id for rapid lookup
  const albumsMap = useMemo(() => {
    const map = new Map<string, Album>();
    for (const album of publicAlbums) {
      map.set(album.id, album);
    }
    return map;
  }, [publicAlbums]);

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
      } else {
        const canonicalKey =
          pair?.evmAddress?.toLowerCase() || pair?.svmAddress?.toLowerCase() || lower;
        groups.push({
          key: canonicalKey,
          label: rawNickname || shortAddr,
          nicknameKey,
          addresses: candidateAddresses,
        });
      }
    }

    return groups.sort((a, b) => a.label.localeCompare(b.label));
  }, [rawCreatorAddresses, creatorPairs]);

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

    // Filter by Creator (matches all linked addresses of the selected creator)
    if (selectedCreator) {
      const group = creatorGroups.find((g) => g.key === selectedCreator);
      const targetAddresses = group ? group.addresses : new Set([selectedCreator.toLowerCase()]);
      list = list.filter((s) => s.creator && targetAddresses.has(s.creator.toLowerCase()));
    }

    // Filter by Genres (multi-select)
    if (selectedGenres.length > 0) {
      const targetSet = new Set(selectedGenres.map((g) => g.toLowerCase()));
      list = list.filter((s) =>
        normalizeTags(s.tags).some((t) => targetSet.has(t.toLowerCase()))
      );
    }

    // Filter by Search Query
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

    // Sort order: latest | oldest
    list.sort((a, b) => {
      const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
      return order === 'latest' ? timeB - timeA : timeA - timeB;
    });

    return list;
  }, [publicSongs, selectedCreator, selectedGenres, search, order, creatorGroups]);

  const selectedCreatorGroup = useMemo(
    () => (selectedCreator ? creatorGroups.find((g) => g.key === selectedCreator) ?? null : null),
    [creatorGroups, selectedCreator]
  );

  const hasFilterPills = Boolean(
    selectedCreator || selectedGenres.length > 0 || search.trim()
  );

  const hasActiveFilters = Boolean(hasFilterPills || order === 'oldest');

  const clearAllFilters = () => {
    setSelectedCreator(null);
    setSelectedGenres([]);
    setSearch('');
    setOrder('latest');
  };

  const handlePlaySong = (song: Song) => {
    const isPlayingThis = playing.active && playing.id === song.id;
    if (isPlayingThis) {
      store.setPlaying(false);
      return;
    }

    store.setActiveSong(song);
    store.setPlaying(true);
  };

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
