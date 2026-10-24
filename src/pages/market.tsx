import React, { useState, useEffect, useMemo } from 'react';
import {
  User,
  Search,
  X,
  Music,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  RotateCcw,
} from 'lucide-react';
import { Glitch } from '../components/glitch';
import { Button } from '../components/button';
import { Tooltip } from '../components/daw/Tooltip';
import { Card, normalizeTags } from '../components/card';
import { store } from '../lib/store';
import { useSongs } from '../hooks/use-songs';
import { usePublicAlbums } from '../hooks/use-albums';
import { groupSongs } from '../lib/versions';
import { useSession, promptSessionModal } from '../components/session';
import { useSelectedUserAddress } from '../hooks/use-address';
import { toast } from 'sonner';
import type { Song, Album } from '../lib/schema';

export interface Props {
  className?: string;
}

export const Market: React.FC<Props> = ({ className = '' }) => {
  const [playing, setPlaying] = useState(() => ({
    id: store.getState().activeSong?.id,
    active: store.getState().isPlaying,
  }));
  const [selectedCreator, setSelectedCreator] = useState<string | null>(null);
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null);
  const [order, setOrder] = useState<'latest' | 'oldest'>('latest');
  const [search, setSearch] = useState<string>('');
  const [selected, setSelected] = useState<Record<string, string>>({});

  const { data: publicSongs = [], isPending, error } = useSongs();
  const { data: publicAlbums = [] } = usePublicAlbums();
  const { session } = useSession();
  const { userAddress, evmAddress, svmAddress } = useSelectedUserAddress();

  useEffect(() => {
    return store.subscribe((state) => {
      setPlaying((current) =>
        current.id === state.activeSong?.id && current.active === state.isPlaying
          ? current
          : { id: state.activeSong?.id, active: state.isPlaying }
      );
    });
  }, []);

  // Map public albums by id for rapid lookup
  const albumsMap = useMemo(() => {
    const map = new Map<string, Album>();
    for (const album of publicAlbums) {
      map.set(album.id, album);
    }
    return map;
  }, [publicAlbums]);

  // Extract unique creators
  const uniqueCreators = useMemo(() => {
    const set = new Set<string>();
    for (const song of publicSongs) {
      if (song.creator) set.add(song.creator);
    }
    return Array.from(set);
  }, [publicSongs]);

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

  // Apply filters and ordering
  const displayedSongs = useMemo(() => {
    let list = [...publicSongs];

    // Filter by Creator
    if (selectedCreator) {
      list = list.filter((s) => s.creator?.toLowerCase() === selectedCreator.toLowerCase());
    }

    // Filter by Genre (= normalized tag)
    if (selectedGenre) {
      const target = selectedGenre.toLowerCase();
      list = list.filter((s) =>
        normalizeTags(s.tags).some((t) => t.toLowerCase() === target)
      );
    }

    // Filter by Search Query
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          normalizeTags(s.tags).some((t) => t.toLowerCase().includes(q)) ||
          s.creator.toLowerCase().includes(q)
      );
    }

    // Sort order: latest | oldest
    list.sort((a, b) => {
      const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
      return order === 'latest' ? timeB - timeA : timeA - timeB;
    });

    return list;
  }, [publicSongs, selectedCreator, selectedGenre, search, order]);

  const hasActiveFilters = Boolean(
    selectedCreator || selectedGenre || search.trim() || order === 'oldest'
  );

  const clearAllFilters = () => {
    setSelectedCreator(null);
    setSelectedGenre(null);
    setSearch('');
    setOrder('latest');
  };

  const handlePlaySong = (song: Song) => {
    const isPlayingThis = playing.active && playing.id === song.id;
    if (isPlayingThis) {
      store.setPlaying(false);
      return;
    }

    const isCreator = store.isCreatorOfSong(song, [userAddress, evmAddress, svmAddress]);
    if (!isCreator && !session.active) {
      toast.error('Active session required to stream music. Please create a session.');
      promptSessionModal();
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
          {/* Creator Filter */}
          <div className="market-select-wrap">
            <User size={12} className="market-select-icon" />
            <select
              value={selectedCreator || ''}
              onChange={(e) => setSelectedCreator(e.target.value || null)}
              className="market-select"
              aria-label="Filter by creator"
            >
              <option value="">CREATORS ({uniqueCreators.length})</option>
              {uniqueCreators.map((c) => (
                <option key={c} value={c}>
                  {c.startsWith('0x')
                    ? `${c.slice(0, 6)}…${c.slice(-4)}`
                    : `${c.slice(0, 4)}…${c.slice(-4)}`}
                </option>
              ))}
            </select>
          </div>

          {/* Genre Filter */}
          <div className="market-select-wrap">
            <Music size={12} className="market-select-icon" />
            <select
              value={selectedGenre || ''}
              onChange={(e) => setSelectedGenre(e.target.value || null)}
              className="market-select"
              aria-label="Filter by genre"
            >
              <option value="">GENRES ({uniqueGenres.length})</option>
              {uniqueGenres.map((g) => (
                <option key={g} value={g}>
                  {g.toUpperCase()}
                </option>
              ))}
            </select>
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
                selectedGenre={selectedGenre}
                onSelectGenre={(genre) =>
                  setSelectedGenre(
                    selectedGenre?.toLowerCase() === genre.toLowerCase() ? null : genre
                  )
                }
              />
            );
          })
        )}
      </div>
    </div>
  );
};
