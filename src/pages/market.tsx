import React, { useState, useEffect, useMemo } from 'react';
import {
  Disc3,
  User,
  Search,
  X,
  Music,
  ArrowDownUp,
  RotateCcw,
} from 'lucide-react';
import { Glitch } from '../components/glitch';
import { Button } from '../components/button';
import { Badge } from '../components/badge';
import { Tooltip } from '../components/daw/Tooltip';
import { store } from '../lib/store';
import { useSongs } from '../hooks/use-songs';
import { usePublicAlbums } from '../hooks/use-albums';
import { Licenses } from '../components/licenses';
import { groupSongs } from '../lib/versions';
import { useSession, promptSessionModal } from '../components/session';
import { useSelectedUserAddress } from '../hooks/use-address';
import { toast } from 'sonner';
import type { Song, Album } from '../lib/schema';

export interface Props {
  className?: string;
  style?: React.CSSProperties;
}

import { CreatorSlot, CoverArt } from '../components/card';

export const Market: React.FC<Props> = ({ className = '', style = {} }) => {
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

  // Extract unique genres / tags
  const uniqueGenres = useMemo(() => {
    const set = new Set<string>();
    for (const song of publicSongs) {
      if (song.tags) {
        for (const tag of song.tags) {
          if (tag) set.add(tag);
        }
      }
    }
    return Array.from(set).sort();
  }, [publicSongs]);

  // Apply filters and ordering
  const displayedSongs = useMemo(() => {
    let list = [...publicSongs];

    // Filter by Creator
    if (selectedCreator) {
      list = list.filter((s) => s.creator?.toLowerCase() === selectedCreator.toLowerCase());
    }

    // Filter by Genre (= the tag)
    if (selectedGenre) {
      list = list.filter((s) =>
        s.tags?.some((t) => t.toLowerCase() === selectedGenre.toLowerCase())
      );
    }

    // Filter by Search Query
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          s.tags.some((t) => t.toLowerCase().includes(q)) ||
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

  const hasActiveFilters = Boolean(selectedCreator || selectedGenre || search.trim() || order === 'oldest');

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
    <div className={`market-container ${className}`} style={style}>
      {/* Marketplace Header */}
      <div className="market-header">
        <div className="market-header-left">
          <Glitch text="AUDIO_MARKET" className="market-title-text" />
          <div className="market-subtitle">
            STREAM TRACKS • {publicSongs.length} PUBLIC TRACKS
            {hasActiveFilters && (
              <span className="market-subtitle-filter">
                ({displayedSongs.length} SHOWN)
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="market-filter-bar">
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
                  {c.startsWith('0x') ? `${c.slice(0, 6)}…${c.slice(-4)}` : `${c.slice(0, 4)}…${c.slice(-4)}`}
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

          {/* Order Toggle (Latest | Oldest) */}
          <div className="market-order-toggle">
            <Tooltip title="Sort by Latest" description="Show newest tracks first">
              <button
                type="button"
                className={`market-order-btn ${order === 'latest' ? 'active' : ''}`}
                onClick={() => setOrder('latest')}
              >
                <ArrowDownUp size={11} />
                <span>LATEST</span>
              </button>
            </Tooltip>
            <Tooltip title="Sort by Oldest" description="Show oldest tracks first">
              <button
                type="button"
                className={`market-order-btn ${order === 'oldest' ? 'active' : ''}`}
                onClick={() => setOrder('oldest')}
              >
                <span>OLDEST</span>
              </button>
            </Tooltip>
          </div>

          {/* Clear Filters Reset Button */}
          {hasActiveFilters && (
            <button
              type="button"
              className="market-reset-filters-btn"
              onClick={clearAllFilters}
              title="Reset filters"
            >
              <RotateCcw size={11} />
              <span>RESET</span>
            </button>
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
              <Button variant="ghost" size="sm" onClick={clearAllFilters} className="market-clear-btn">
                CLEAR FILTERS
              </Button>
            )}
          </div>
        ) : (
          groupSongs(displayedSongs).map((versions) => {
            const family = versions[0].family ?? versions[0].id;
            const song = versions.find((item) => item.id === selected[family]) ?? versions[0];
            const isPlayingThis = playing.active && playing.id === song.id;

            // Resolve album if available
            const album = song.album_id ? albumsMap.get(song.album_id) : null;
            const albumTitle = album?.title || song.album_title || null;
            const albumCover = album?.cover || null;

            return (
              <div
                key={family}
                className={`market-card ${isPlayingThis ? 'playing' : ''}`}
              >
                {/* 1. Square Artwork Media Container */}
                <CoverArt
                  image={song.image}
                  albumCover={albumCover}
                  title={song.title}
                  isPlayingThis={isPlayingThis}
                  onPlayToggle={() => handlePlaySong(song)}
                  versions={versions}
                  selectedId={song.id}
                  onSelectVersion={(version) => {
                    setSelected((current) => ({ ...current, [family]: version.id }));
                    if (versions.some((item) => item.id === playing.id)) {
                      store.setActiveSong(version);
                    }
                  }}
                  network={song.network}
                  txHash={song.tx_hash}
                  txUrl={song.tx_url}
                  duration={song.duration}
                />

                {/* 2. Structured Information Body */}
                <div className="market-card-body">
                  {/* Row 1: Title */}
                  <div className="market-card-row-title" title={song.title}>
                    {song.title}
                  </div>

                  {/* Row 2: Album (uniform height reserved) */}
                  {albumTitle ? (
                    <div className="market-card-row-album" title={`Album: ${albumTitle}`}>
                      <Disc3 size={11} className="market-album-icon" />
                      <span className="market-album-text">{albumTitle}</span>
                    </div>
                  ) : (
                    <div className="market-card-row-album empty" aria-hidden="true">
                      <span>&nbsp;</span>
                    </div>
                  )}

                  {/* Row 3: Creator (avatar, nickname, external-link) */}
                  <CreatorSlot address={song.creator} network={song.network} />

                  {/* Row 4: Tags / Genre (clickable to filter) */}
                  <div className={`market-card-row-tags ${!song.tags || song.tags.length === 0 ? 'empty' : ''}`}>
                    {song.tags && song.tags.length > 0 ? (
                      song.tags.map((t) => (
                        <Badge
                          key={t}
                          variant={selectedGenre === t ? 'primary' : 'muted'}
                          onClick={() => setSelectedGenre(selectedGenre === t ? null : t)}
                          clickable
                        >
                          {t}
                        </Badge>
                      ))
                    ) : (
                      <span aria-hidden="true">&nbsp;</span>
                    )}
                  </div>

                  {/* Row 5: Pricing Box (Stream rate & License price) */}
                  <div className="market-pricing-box">
                    <div className="market-price-item">
                      <span className="market-price-label">STREAM</span>
                      <span className="market-price-val market-price-val-stream">
                        ${song.stream_price.toFixed(2)}
                        <span className="market-price-unit">/m</span>
                      </span>
                    </div>
                    <div className="market-price-item">
                      <span className="market-price-label">LICENSE</span>
                      <span className="market-price-val market-price-val-license">
                        {song.source ? (
                          <span className="market-price-remix">REMIX</span>
                        ) : (
                          `$${song.license_price.toFixed(2)}`
                        )}
                      </span>
                    </div>
                  </div>

                  {/* Row 6: Actions Toolbar */}
                  <div className="market-card-actions">
                    <Button
                      variant={isPlayingThis ? 'primary' : 'ghost'}
                      size="sm"
                      onClick={() => handlePlaySong(song)}
                    >
                      {isPlayingThis ? 'PAUSE' : 'STREAM'}
                    </Button>
                    <Licenses key={song.id} song={song} placement="market" />
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
