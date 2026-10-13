import React, { useState, useEffect, useMemo } from 'react';
import {
  Play,
  Pause,
  ExternalLink,
  Disc3,
  User,
  Radio,
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
import { useProfile } from '../hooks/use-profile';
import { Licenses } from '../components/licenses';
import { groupSongs } from '../lib/versions';
import { Versions } from '../components/versions';
import { useSession, promptSessionModal } from '../components/session';
import { useSelectedUserAddress } from '../hooks/use-address';
import { NETWORK_LOGOS, networkLogo } from '../contexts/Network';
import { getExplorerUrl, getExplorerTxUrl } from '../lib/chains';
import { toast } from 'sonner';
import type { Song, Album } from '../lib/schema';

export interface Props {
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Compact Creator Slot with avatar, nickname (fallback to formatted address)
 * and usable external-link icon with "Creator's Address" tooltip.
 */
export const CreatorSlot: React.FC<{ address?: string; network?: string }> = ({ address, network }) => {
  const { nickname, avatar } = useProfile(address);

  if (!address) {
    return (
      <div className="market-card-row-creator">
        <span className="market-creator-none">—</span>
      </div>
    );
  }

  const shortAddr = address.startsWith('0x')
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : `${address.slice(0, 4)}…${address.slice(-4)}`;

  const displayName = nickname?.trim() || shortAddr;

  let explorerUrl = '#';
  if (network) {
    try {
      explorerUrl = getExplorerUrl(network as any, 'address', address);
    } catch {
      explorerUrl = address.startsWith('0x')
        ? `https://basescan.org/address/${address}`
        : `https://explorer.solana.com/address/${address}?cluster=devnet`;
    }
  } else {
    explorerUrl = address.startsWith('0x')
      ? `https://basescan.org/address/${address}`
      : `https://explorer.solana.com/address/${address}?cluster=devnet`;
  }

  return (
    <div className="market-card-row-creator">
      <div className="market-creator-info" title={displayName}>
        {avatar ? (
          <img src={avatar} alt={displayName} className="market-creator-avatar" />
        ) : (
          <div className="market-creator-avatar-placeholder">
            <User size={10} />
          </div>
        )}
        <span className="market-creator-name">{displayName}</span>
      </div>

      <Tooltip title="Creator's Address" description={address}>
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="market-creator-link"
          onClick={(e) => e.stopPropagation()}
          aria-label="Creator's Address"
        >
          <ExternalLink size={11} />
        </a>
      </Tooltip>
    </div>
  );
};

/**
 * Format track duration in seconds to standard mm:ss
 */
export const formatDuration = (secs?: number): string => {
  if (!secs || secs <= 0 || !Number.isFinite(secs)) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
};

/**
 * Human-readable full network name
 */
export const resolveNetworkName = (network?: string | null): string => {
  if (!network) return '';
  if (network.includes('84532')) return 'Base Sepolia';
  if (network.includes('8453')) return 'Base';
  if (network.includes('421614')) return 'Arbitrum Sepolia';
  if (network.includes('42161')) return 'Arbitrum';
  if (network.includes('42431')) return 'Tempo Moderato';
  if (network.includes('4217')) return 'Tempo';
  if (network.includes('EtWTRABZaYq6iMfeYKouRu166VU2xqa1')) return 'Solana Devnet';
  if (network.startsWith('solana')) return 'Solana';
  return 'On-Chain';
};

/**
 * Resolve block explorer link for a transaction hash
 */
export const resolveTxUrl = (network?: string | null, txHash?: string | null, txUrl?: string | null): string | null => {
  if (txUrl && txUrl.trim() !== '' && txUrl !== '#') return txUrl;
  if (!txHash) return null;
  if (network) {
    try {
      return getExplorerTxUrl(network as any, txHash);
    } catch {
      // fallback
    }
  }
  return txHash.startsWith('0x')
    ? `https://basescan.org/tx/${txHash}`
    : `https://explorer.solana.com/tx/${txHash}?cluster=devnet`;
};

/**
 * Minted Network & Transaction provenance slot.
 * Retained for backwards compatibility if needed.
 */
export const NetworkTxSlot: React.FC<{ network?: string; txHash?: string; txUrl?: string }> = ({
  network,
  txHash,
  txUrl,
}) => {
  const logo = network ? (NETWORK_LOGOS[network] || networkLogo(network)) : null;
  const netName = resolveNetworkName(network) || 'On-Chain';
  const finalTxUrl = resolveTxUrl(network, txHash, txUrl) || '#';

  return (
    <div className="market-card-row-provenance">
      <div className="market-provenance-net" title={network ? `Minted on ${netName}` : 'Off-Chain Track'}>
        {logo ? (
          <img src={logo} alt={netName} className="market-network-logo" />
        ) : (
          <Radio size={10} className="market-network-icon-fallback" />
        )}
        <span className="market-network-name">{netName}</span>
      </div>

      {txHash ? (
        <Tooltip title="Transaction Hash" description={txHash}>
          <a
            href={finalTxUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="market-tx-link"
            onClick={(e) => e.stopPropagation()}
            aria-label="Mint Transaction"
          >
            <ExternalLink size={10} />
            <span>TX</span>
          </a>
        </Tooltip>
      ) : (
        <span className="market-tx-placeholder" aria-hidden="true">&nbsp;</span>
      )}
    </div>
  );
};

/**
 * Square Cover Art with single-R logo fallback, centered play overlay,
 * top-right network link (to mint tx) + custom actions, and bottom-right duration badge.
 */
export const CoverArt: React.FC<{
  image?: string;
  albumCover?: string | null;
  title: string;
  isPlayingThis: boolean;
  onPlayToggle: () => void;
  versions?: Song[];
  selectedId?: string;
  onSelectVersion?: (song: Song) => void;
  network?: string;
  txHash?: string;
  txUrl?: string;
  duration?: number;
  topRightActions?: React.ReactNode;
}> = ({
  image,
  albumCover,
  title,
  isPlayingThis,
  onPlayToggle,
  versions,
  selectedId,
  onSelectVersion,
  network,
  txHash,
  txUrl,
  duration,
  topRightActions,
}) => {
  const [imgError, setImgError] = useState(false);
  const coverSrc = (!imgError && image && image !== '/hero.png' && image.trim() !== '')
    ? image
    : (!imgError && albumCover && albumCover.trim() !== '')
      ? albumCover
      : null;

  const netLogo = network ? (NETWORK_LOGOS[network] || networkLogo(network)) : null;
  const netName = resolveNetworkName(network);
  const finalTxUrl = resolveTxUrl(network, txHash, txUrl);

  const displayDuration = duration && duration > 0 ? duration : (isPlayingThis && store.getState().duration > 0 ? store.getState().duration : undefined);

  return (
    <div className="market-card-media">
      {coverSrc ? (
        <img
          src={coverSrc}
          alt={title}
          className="market-card-cover-img"
          loading="lazy"
          onError={() => setImgError(true)}
        />
      ) : (
        <div className="market-card-fallback-art">
          <img src="/branding/mark.svg" alt="Rawchunks" className="market-card-fallback-logo" />
        </div>
      )}

      {/* Top Left: Version Switcher if multi-version */}
      {versions && versions.length > 1 && selectedId && onSelectVersion && (
        <div className="market-card-media-badge-left">
          <Versions songs={versions} selected={selectedId} onSelect={onSelectVersion} />
        </div>
      )}

      {/* Top Right: Network logo link (to mint tx) + custom actions */}
      {(netLogo || topRightActions) && (
        <div className="market-card-media-badge-right">
          {netLogo && (
            <Tooltip
              title={netName || 'On-Chain'}
              description={finalTxUrl ? 'See mint transaction' : 'Minted on-chain'}
            >
              {finalTxUrl ? (
                <a
                  href={finalTxUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="market-media-net-link"
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`View mint transaction on ${netName || 'Explorer'}`}
                >
                  <img src={netLogo} alt={netName || 'Network'} className="market-card-media-net-logo" />
                </a>
              ) : (
                <span className="market-media-net-badge">
                  <img src={netLogo} alt={netName || 'Network'} className="market-card-media-net-logo" />
                </span>
              )}
            </Tooltip>
          )}
          {topRightActions}
        </div>
      )}

      {/* Spotify-style play overlay button */}
      <div className={`market-card-play-overlay ${isPlayingThis ? 'is-playing' : ''}`}>
        <Tooltip
          title={isPlayingThis ? 'Pause' : 'Stream'}
          description={isPlayingThis ? 'Pause streaming audio' : 'Stream track'}
        >
          <button
            type="button"
            className={`market-overlay-play-btn ${isPlayingThis ? 'active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              onPlayToggle();
            }}
            aria-label={isPlayingThis ? 'Pause' : 'Stream'}
          >
            {isPlayingThis ? <Pause size={16} /> : <Play size={16} style={{ marginLeft: 2 }} />}
          </button>
        </Tooltip>
      </div>

      {/* Bottom Right: Duration Badge */}
      {displayDuration !== undefined && displayDuration > 0 && (
        <div className="market-card-duration-badge">
          {formatDuration(displayDuration)}
        </div>
      )}
    </div>
  );
};

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
              <Button variant="ghost" size="sm" onClick={clearAllFilters} style={{ marginTop: 12 }}>
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

                  {/* Row 4: Mint Network & Transaction link */}
                  <NetworkTxSlot
                    network={song.network}
                    txHash={song.tx_hash}
                    txUrl={song.tx_url}
                  />

                  {/* Row 5: Tags / Genre (clickable to filter) */}
                  <div className="market-card-row-tags">
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
                      <Badge variant="muted">RAWCHUNKS</Badge>
                    )}
                  </div>

                  {/* Row 6: Pricing Box (Stream rate & License price) */}
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

                  {/* Row 7: Actions Toolbar (Icons + Tooltips) */}
                  <div className="market-card-actions">
                    <Tooltip
                      title={isPlayingThis ? 'Pause' : 'Stream'}
                      description={
                        isPlayingThis
                          ? 'Pause streaming audio'
                          : `Stream track at $${song.stream_price.toFixed(2)} / min`
                      }
                    >
                      <Button
                        variant={isPlayingThis ? 'primary' : 'ghost'}
                        size="sm"
                        onClick={() => handlePlaySong(song)}
                        aria-label={isPlayingThis ? 'Pause' : 'Stream'}
                        className="market-action-btn"
                      >
                        {isPlayingThis ? <Pause size={13} /> : <Play size={13} />}
                      </Button>
                    </Tooltip>
                    <Licenses key={song.id} song={song} placement="market" compact />
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
