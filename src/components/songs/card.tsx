import { useGuideOwner } from '../guide/owners';
import React, { useEffect, useRef, useState } from 'react';
import {
  Play,
  Pause,
  ExternalLink,
  Disc3,
  User,
  Tag,
  ListPlus,
  FolderPlus,
  Headphones,
  Share2,
} from 'lucide-react';
import { Button } from '../button';
import { Badge } from '../badge';
import { Tooltip } from '../daw/Tooltip';
import { Versions } from './versions';
import { Licenses } from './licenses';
import { LikeButton, PlaylistAdder } from './row';
import { store } from '../../lib/store';
import { useProfile } from '../../hooks/use-profile';
import { navigateToCreator } from '../../lib/routes';
import { NETWORK_LOGOS, networkLogo } from '../../contexts/Network';
import { getExplorerUrl, getExplorerTxUrl } from '../../lib/chains';
import type { Song } from '../../lib/schema';

/**
 * Split and normalize comma/semicolon/pipe-separated genre/style strings into clean individual tags.
 */
export const normalizeTags = (tags?: string[] | null): string[] => {
  if (!tags || !Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    if (typeof raw !== 'string') continue;
    for (const part of raw.split(/[,;|•]+/)) {
      const trimmed = part.trim().replace(/^genre:/i, '').trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        result.push(trimmed);
      }
    }
  }
  return result;
};

/**
 * Exact 1:1 static cover artwork shipped in /public/genres/*.jpeg.
 * Dynamic genres not in this map are generated on-demand by the backend cover-art agent.
 */
export const GENRE_COVER_IMAGES: Record<string, string> = {
  'acid-techno': '/genres/acid-techno.jpeg',
  'airy-lead-vocals': '/genres/airy-lead-vocals.jpeg',
  'airy-lead-vocals-alt': '/genres/airy-lead-vocals-alt.jpeg',
  'cinematic-strings': '/genres/cinematic-strings.jpeg',
  'crisp-acoustic-drums': '/genres/crisp-acoustic-drums.jpeg',
  electronic: '/genres/electronic.jpeg',
  'funky-electric-guitar': '/genres/funky-electric-guitar.jpeg',
  'lo-fi-tape-saturation': '/genres/lo-fi-tape-saturation.jpeg',
  'lush-backing-harmonies': '/genres/lush-backing-harmonies.jpeg',
  'neural-glitch': '/genres/neural-glitch.jpeg',
  'punchy-808-bass': '/genres/punchy-808-bass.jpeg',
  rock: '/genres/rock.jpeg',
  'warm-analog-synth': '/genres/warm-analog-synth.jpeg',
};

export const normalizeGenreSlug = (genre?: string | null): string => {
  if (!genre || typeof genre !== 'string') return '';
  return genre
    .trim()
    .replace(/^#+/, '')
    .replace(/^genre:\s*/i, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

export const getGenreCoverImage = (genre?: string | null): string | null => {
  const slug = normalizeGenreSlug(genre);
  if (!slug) return null;
  return GENRE_COVER_IMAGES[slug] ?? null;
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
  if (network.includes('42431')) return 'Tempo Moderato';
  if (network.includes('4217')) return 'Tempo';
  if (network.includes('EtWTRABZaYq6iMfeYKouRu166VU2xqa1')) return 'Solana Devnet';
  if (network.startsWith('solana')) return 'Solana';
  return 'On-Chain';
};

/**
 * Resolve block explorer link for a transaction hash
 */
export const resolveTxUrl = (
  network?: string | null,
  txHash?: string | null,
  txUrl?: string | null
): string | null => {
  if (txUrl && txUrl.trim() !== '' && txUrl !== '#') return txUrl;
  if (!txHash) return null;
  if (network) {
    try {
      return getExplorerTxUrl(network as any, txHash);
    } catch {
      // fallback below
    }
  }
  return txHash.startsWith('0x')
    ? `https://basescan.org/tx/${txHash}`
    : `https://explorer.solana.com/tx/${txHash}?cluster=devnet`;
};

/**
 * Compact Creator Slot with avatar, nickname (or short address), optional click-to-filter, and explorer link.
 */
export const CreatorSlot: React.FC<{
  address?: string;
  network?: string;
  onSelectCreator?: (address: string) => void;
}> = ({ address, network, onSelectCreator }) => {
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
      <Tooltip
        title={displayName}
        description="Open creator studio"
        className="market-creator-info-wrap"
      >
        <button
          type="button"
          className="market-creator-info clickable"
          onClick={(e) => {
            e.stopPropagation();
            if (onSelectCreator) {
              onSelectCreator(address);
            } else {
              navigateToCreator(address);
            }
          }}
        >
          {avatar ? (
            <img src={avatar} alt={displayName} className="market-creator-avatar" />
          ) : (
            <div className="market-creator-avatar-placeholder">
              <User size={12} />
            </div>
          )}
          <span className="market-creator-name">{displayName}</span>
        </button>
      </Tooltip>

      <Tooltip title="Creator's Address" description={address}>
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="market-creator-link"
          onClick={(e) => e.stopPropagation()}
          aria-label="Creator's Address"
        >
          <ExternalLink size={12} />
        </a>
      </Tooltip>
    </div>
  );
};

/**
 * Responsive Cover Art with brand mark fallback, centered play overlay,
 * top-left play count badge, top-right network link + contextual actions,
 * bottom-left version switcher, and bottom-right duration badge.
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
  plays?: number;
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
  plays,
  topRightActions,
}) => {
  const [imgError, setImgError] = useState(false);
  useEffect(() => {
    setImgError(false);
  }, [image, albumCover]);
  const coverSrc =
    !imgError && image && image.trim() !== ''
      ? image
      : !imgError && albumCover && albumCover.trim() !== ''
        ? albumCover
        : null;

  const netLogo = network ? NETWORK_LOGOS[network] || networkLogo(network) : null;
  const netName = resolveNetworkName(network);
  const finalTxUrl = resolveTxUrl(network, txHash, txUrl);

  const displayDuration =
    duration && duration > 0
      ? duration
      : isPlayingThis && store.getState().duration > 0
        ? store.getState().duration
        : undefined;

  return (
    <div className="market-card-media" data-guide="market-card-play">
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

      {/* Top Left: Verified Plays Counter (when > 0) */}
      {typeof plays === 'number' && plays > 0 && (
        <div className="market-card-plays-badge" title={`${plays} stream${plays === 1 ? '' : 's'}`}>
          <Headphones size={12} />
          <span>{plays >= 1000 ? `${(plays / 1000).toFixed(1)}k` : plays}</span>
        </div>
      )}

      {/* Top Right: Network logo link (to mint tx) + custom actions */}
      {(netLogo || topRightActions) && (
        <div className="market-card-media-badge-right">
          {netLogo && (
            <Tooltip
              title={netName || 'On-Chain'}
              description={finalTxUrl ? 'View mint transaction' : 'Minted on-chain'}
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

      {/* Play/Pause Hover Overlay */}
      <div className={`market-card-play-overlay ${isPlayingThis ? 'is-playing' : ''}`}>
        <Tooltip
          title={isPlayingThis ? 'Pause' : 'Stream'}
          description={isPlayingThis ? 'Pause streaming audio' : 'Stream track'}
        >
          <button
            type="button"
            data-guide="card.stream"
            className={`market-overlay-play-btn ${isPlayingThis ? 'active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              onPlayToggle();
            }}
            aria-label={isPlayingThis ? 'Pause' : 'Stream'}
          >
            {isPlayingThis ? <Pause size={15} /> : <Play size={15} className="market-play-icon-offset" />}
          </button>
        </Tooltip>
      </div>

      {/* Bottom Left: Horizontal Version Switcher on the same row as duration */}
      {versions && versions.length > 1 && selectedId && onSelectVersion && (
        <div className="market-card-versions-badge" onClick={(e) => e.stopPropagation()}>
          <Versions songs={versions} selected={selectedId} onSelect={onSelectVersion} />
        </div>
      )}

      {/* Bottom Right: Duration Badge */}
      {displayDuration !== undefined && displayDuration > 0 && (
        <div
          data-guide="card.version-status"
          tabIndex={-1}
          aria-label="Song version"
          className="market-card-duration-badge"
        >
          {formatDuration(displayDuration)}
        </div>
      )}
    </div>
  );
};

export interface CardProps {
  variant?: 'market';
  song: Song;
  versions: Song[];
  albumTitle: string | null;
  albumCover: string | null;
  isPlayingThis: boolean;
  onPlayToggle: () => void;
  onSelectVersion: (version: Song) => void;
  selectedGenres?: string[];
  onSelectGenre?: (genre: string) => void;
  onSelectCreator?: (creator: string) => void;
  onAddToPlaylist?: (song: Song) => void;
  onShare?: (song: Song) => void;
}

/**
 * Public Market Song Card (/market).
 * Dedicated exclusively to public discovery, streaming, curation, and license purchasing.
 */
export const Card: React.FC<CardProps> = ({
  song,
  versions,
  albumTitle,
  albumCover,
  isPlayingThis,
  onPlayToggle,
  onSelectVersion,
  selectedGenres,
  onSelectGenre,
  onSelectCreator,
  onAddToPlaylist,
  onShare,
}) => {
  const [marketMenuOpen, setMarketMenuOpen] = useState(false);
  const marketMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!marketMenuOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (marketMenuRef.current && !marketMenuRef.current.contains(e.target as Node)) {
        setMarketMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [marketMenuOpen]);

  useGuideOwner({
    id: 'card',
    scope: `market:${song.id}`,
    handles: (step) => ['K5', 'K7', 'M4'].includes(step.id),
    prepare: ({ step, bind }) => {
      const id = bind('song', song.id);
      if (id !== song.id) return;
      if (step.id === 'K5' && (!versions || versions.length < 2))
        return {
          target: 'card.version-status',
          entity: song.id,
          description: 'This track has one version.',
        };
      return { entity: song.id, focus: step.id === 'K5' ? '[aria-pressed="true"]' : undefined };
    },
  });

  const tags = normalizeTags(song.tags);
  const maxVisibleTags = albumTitle ? 1 : 2;
  const visibleTags = tags.slice(0, maxVisibleTags);
  const overflowCount = Math.max(0, tags.length - maxVisibleTags);

  return (
    <div
      data-guide-entity={song.id}
      ref={marketMenuRef}
      className={`market-card ${isPlayingThis ? 'playing' : ''}`}
    >
      {/* 1. Artwork Media Container */}
      <CoverArt
        image={song.image}
        albumCover={albumCover}
        title={song.title}
        isPlayingThis={isPlayingThis}
        onPlayToggle={onPlayToggle}
        versions={versions}
        selectedId={song.id}
        onSelectVersion={onSelectVersion}
        network={song.network}
        txHash={song.tx_hash}
        txUrl={song.tx_url}
        duration={song.duration}
        plays={song.plays}
        topRightActions={
          <div className="market-card-social-actions" onClick={(e) => e.stopPropagation()}>
            <LikeButton songId={song.id} likesCount={song.likes} showCount />
            <PlaylistAdder song={song} onShare={onShare} />
          </div>
        }
      />

      {/* Market Streaming & Curation Menu */}
      {marketMenuOpen && (
        <div className="mypage-menu-dropdown market-discovery-dropdown" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="mypage-menu-item"
            onClick={() => {
              store.addToQueue(song);
              setMarketMenuOpen(false);
            }}
          >
            <ListPlus size={12} />
            <span>QUEUE</span>
          </button>
          {onAddToPlaylist && (
            <button
              type="button"
              className="mypage-menu-item"
              onClick={() => {
                setMarketMenuOpen(false);
                onAddToPlaylist(song);
              }}
            >
              <FolderPlus size={12} />
              <span>PLAYLIST</span>
            </button>
          )}
          {onShare && (
            <button
              type="button"
              className="mypage-menu-item"
              onClick={() => {
                setMarketMenuOpen(false);
                onShare(song);
              }}
            >
              <Share2 size={12} />
              <span>SHARE</span>
            </button>
          )}
        </div>
      )}

      {/* 2. Structured Proportional Information Body */}
      <div className="market-card-body">
        {/* Zone 1: Title + Creator Identity */}
        <div className="market-card-identity">
          <Tooltip title={song.title} className="mypage-card-title-tooltip">
            <div className="market-card-row-title">{song.title}</div>
          </Tooltip>

          <CreatorSlot
            address={song.creator}
            network={song.network}
            onSelectCreator={onSelectCreator}
          />
        </div>

        {/* Zone 2: Proportional Album & Genre Tags Row */}
        <div className={`market-card-row-tags ${tags.length === 0 && !albumTitle ? 'empty' : ''}`}>
          {albumTitle && (
            <Tooltip title={`Album: ${albumTitle}`}>
              <Badge variant="secondary" className="card-album-tag">
                <Disc3 size={11} />
                <span>{albumTitle}</span>
              </Badge>
            </Tooltip>
          )}
          {visibleTags.length > 0 ? (
            <>
              {visibleTags.map((t) => (
                <Tooltip key={t} title="Filter by Genre / Style" description={t}>
                  <Badge
                    variant={
                      selectedGenres?.some((g) => g.toLowerCase() === t.toLowerCase())
                        ? 'primary'
                        : 'muted'
                    }
                    onClick={onSelectGenre ? () => onSelectGenre(t) : undefined}
                    clickable={Boolean(onSelectGenre)}
                  >
                    {t}
                  </Badge>
                </Tooltip>
              ))}
              {overflowCount > 0 && (
                <Tooltip title="All Genres & Styles" description={tags.join(' • ')}>
                  <Badge variant="muted" className="card-tag-overflow">
                    +{overflowCount}
                  </Badge>
                </Tooltip>
              )}
            </>
          ) : !albumTitle ? (
            <span aria-hidden="true">&nbsp;</span>
          ) : null}
        </div>

        {/* Zone 3: Proportional Pricing Strip */}
        <div className="market-pricing-box">
          <div className="market-price-item">
            <Tooltip title="Stream">
              <span className="market-price-label" aria-label="Stream">
                <Headphones size={12} />
              </span>
            </Tooltip>
            <span className="market-price-val market-price-val-stream">
              ${song.stream_price.toFixed(2)}
              <span className="market-price-unit">/m</span>
            </span>
          </div>
          <div className="market-price-item">
            <Tooltip title="License">
              <span className="market-price-label" aria-label="License">
                <Tag size={12} />
              </span>
            </Tooltip>
            <span className="market-price-val market-price-val-license">
              {song.source || song.is_remix ? (
                <span className="market-price-remix">REMIX</span>
              ) : (
                `$${song.license_price.toFixed(2)}`
              )}
            </span>
          </div>
        </div>

        {/* Zone 4: Actions Toolbar */}
        <div className="market-card-actions" data-guide="market-card-license">
          <Tooltip
            title={isPlayingThis ? 'Pause' : 'Stream'}
            description={
              isPlayingThis
                ? 'Pause streaming playback'
                : `Stream track ($${song.stream_price.toFixed(2)}/min)`
            }
          >
            <Button
              variant={isPlayingThis ? 'primary' : 'ghost'}
              size="sm"
              data-guide="card.stream"
              onClick={onPlayToggle}
              aria-label={isPlayingThis ? 'Pause' : 'Stream'}
              className="market-btn-icon"
            >
              {isPlayingThis ? <Pause size={12} /> : <Play size={12} />}
            </Button>
          </Tooltip>

          <Licenses key={song.id} song={song} placement="market" compact />
        </div>
      </div>
    </div>
  );
};
