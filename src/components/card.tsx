import React, { useEffect, useState } from 'react';
import {
  Play,
  Pause,
  ExternalLink,
  Disc3,
  User,
  Pencil,
  Download,
  Trash2,
  Upload,
  Sliders,
  Tag,
  MoreHorizontal,
} from 'lucide-react';
import { Button } from './button';
import { Badge } from './badge';
import { Tooltip } from './daw/Tooltip';
import { Versions } from './versions';
import { Licenses } from './licenses';
import { store } from '../lib/store';
import { useProfile } from '../hooks/use-profile';
import { useLicense } from '../hooks/use-license';
import { NETWORK_LOGOS, networkLogo } from '../contexts/Network';
import { getExplorerUrl, getExplorerTxUrl } from '../lib/chains';
import type { Song } from '../lib/schema';

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
      const trimmed = part.trim();
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
 * Compact Creator Slot with avatar, nickname (or short address) and explorer link icon with tooltip.
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
      <Tooltip title={displayName} className="market-creator-info-wrap">
        <div className="market-creator-info">
          {avatar ? (
            <img src={avatar} alt={displayName} className="market-creator-avatar" />
          ) : (
            <div className="market-creator-avatar-placeholder">
              <User size={10} />
            </div>
          )}
          <span className="market-creator-name">{displayName}</span>
        </div>
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
          <ExternalLink size={11} />
        </a>
      </Tooltip>
    </div>
  );
};

/**
 * Responsive Cover Art with brand mark fallback, centered play overlay,
 * top-left version switcher, top-right network link + custom actions, and bottom-right duration badge.
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
              className={`market-overlay-play-btn ${isPlayingThis ? 'active' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                onPlayToggle();
              }}
              aria-label={isPlayingThis ? 'Pause' : 'Stream'}
            >
              {isPlayingThis ? <Pause size={16} /> : <Play size={16} className="market-play-icon-offset" />}
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
          <div className="market-card-duration-badge">{formatDuration(displayDuration)}</div>
        )}
      </div>
    );
  };

/**
 * On-chain live pricing and remaining/sold license statistics for published songs on My-Page.
 */
const PublicSongPricingBox: React.FC<{ song: Song }> = ({ song }) => {
  const { data, sold } = useLicense(song);
  const remaining = data?.remaining !== undefined ? Number(data.remaining) : song.licenses;
  const soldCount = sold !== undefined ? sold : 0;

  return (
    <div className="market-pricing-box">
      <div className="market-price-item">
        <span className="market-price-label">STREAM</span>
        <span className="market-price-val market-price-val-stream">
          ${song.stream_price.toFixed(2)}
          <span className="market-price-unit">/m</span>
        </span>
      </div>
      <div className="market-price-item">
        <span className="market-price-label">LICENSES</span>
        <div className="mypage-license-stats-row">
          <Tooltip title="Licenses Sold" description={`${soldCount} licenses sold`}>
            <span className="mypage-stat-badge sold">
              <Tag size={9} /> {soldCount}
            </span>
          </Tooltip>
          <Tooltip title="Licenses Remaining" description={`${remaining} licenses remaining`}>
            <span className="mypage-stat-badge left">
              <Tag size={9} /> {remaining}
            </span>
          </Tooltip>
        </div>
      </div>
    </div>
  );
};

export interface CardProps {
  variant: 'market' | 'mypage';
  song: Song;
  versions: Song[];
  albumTitle: string | null;
  albumCover: string | null;
  isPlayingThis: boolean;
  onPlayToggle: () => void;
  onSelectVersion: (version: Song) => void;
  selectedGenres?: string[];
  onSelectGenre?: (genre: string) => void;
  isMenuOpen?: boolean;
  onToggleMenu?: () => void;
  onEditDetails?: (song: Song) => void;
  onEditInStudio?: (song: Song) => void;
  onDownload?: (song: Song) => void;
  onDelete?: (id: string) => void;
  onPublishClick?: (song: Song) => void;
  publicPending?: boolean;
  isRemixLicensed?: boolean;
}

/**
 * Unified, container-query responsive Song Card for /market and /my-page.
 */
export const Card: React.FC<CardProps> = ({
  variant,
  song,
  versions,
  albumTitle,
  albumCover,
  isPlayingThis,
  onPlayToggle,
  onSelectVersion,
  selectedGenres,
  onSelectGenre,
  isMenuOpen = false,
  onToggleMenu,
  onEditDetails,
  onEditInStudio,
  onDownload,
  onDelete,
  onPublishClick,
  publicPending = false,
  isRemixLicensed = false,
}) => {
  const tags = normalizeTags(song.tags);
  const maxVisibleTags = isRemixLicensed ? 1 : 2;
  const visibleTags = tags.slice(0, maxVisibleTags);
  const overflowCount = Math.max(0, tags.length - maxVisibleTags);

  return (
    <div className={`market-card ${isPlayingThis ? 'playing' : ''}`}>
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
        topRightActions={
          variant === 'mypage' && !isRemixLicensed && onToggleMenu ? (
            <div className="mypage-menu-wrap">
              <Tooltip title="Track Options" description="Edit details, open in Studio, download, or delete">
                <button
                  type="button"
                  className="mypage-card-more-btn"
                  data-guide="mypage-card-menu"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleMenu();
                  }}
                  aria-label="Track options"
                >
                  <MoreHorizontal size={13} />
                </button>
              </Tooltip>
            </div>
          ) : null
        }
      />

      {/* Card-level Dropdown Menu (avoids overflow clipping on artwork) */}
      {variant === 'mypage' && !isRemixLicensed && isMenuOpen && (
        <div className="mypage-menu-dropdown" onClick={(e) => e.stopPropagation()}>
          {!song.public && !song.tx_hash && !song.metadata_cid && onEditDetails && (
            <button
              type="button"
              className="mypage-menu-item mypage-item-details"
              data-guide="mypage-card-details"
              onClick={() => onEditDetails(song)}
            >
              <Sliders size={11} />
              <span>SONG DETAILS</span>
            </button>
          )}
          {onEditInStudio && (
            <button
              type="button"
              className="mypage-menu-item mypage-item-edit"
              data-guide="mypage-card-editor"
              onClick={() => onEditInStudio(song)}
            >
              <Pencil size={11} />
              <span>AUDIO EDITOR</span>
            </button>
          )}
          {onDownload && (
            <button
              type="button"
              className="mypage-menu-item mypage-item-download"
              onClick={() => onDownload(song)}
            >
              <Download size={11} />
              <span>DOWNLOAD</span>
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              className="mypage-menu-item mypage-item-delete"
              onClick={() => onDelete(song.id)}
            >
              <Trash2 size={11} />
              <span>DELETE</span>
            </button>
          )}
        </div>
      )}

      {/* 2. Structured Information Body */}
      <div className="market-card-body">
        {/* Row 1: Title */}
        <Tooltip title={song.title} description="Track title" className="mypage-card-title-tooltip">
          <div className="market-card-row-title">{song.title}</div>
        </Tooltip>

        {/* Row 2: Album (uniform height reserved) */}
        {albumTitle ? (
          <Tooltip title={`Album: ${albumTitle}`}>
            <div className="market-card-row-album">
              <Disc3 size={10} className="market-album-icon" />
              <span className="market-album-text">{albumTitle}</span>
            </div>
          </Tooltip>
        ) : (
          <div className="market-card-row-album empty" aria-hidden="true">
            <span>&nbsp;</span>
          </div>
        )}

        {/* Row 3: Creator (shown on Market) */}
        {variant === 'market' && <CreatorSlot address={song.creator} network={song.network} />}

        {/* Row 4: Proportional Styles / Genres Tags */}
        <div
          className={`market-card-row-tags ${tags.length === 0 && !isRemixLicensed ? 'empty' : ''}`}
        >
          {isRemixLicensed && (
            <Badge variant="warning" className="mypage-remix-badge">
              REMIX
            </Badge>
          )}
          {visibleTags.length > 0 ? (
            <>
              {visibleTags.map((t) => (
                <Tooltip
                  key={t}
                  title={variant === 'market' ? 'Filter by Genre / Style' : 'Genre / Style'}
                  description={t}
                >
                  <Badge
                    variant={
                      variant === 'market'
                        ? selectedGenres?.some((g) => g.toLowerCase() === t.toLowerCase())
                          ? 'primary'
                          : 'muted'
                        : 'secondary'
                    }
                    onClick={
                      variant === 'market' && onSelectGenre
                        ? () => onSelectGenre(t)
                        : undefined
                    }
                    clickable={variant === 'market' && Boolean(onSelectGenre)}
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
          ) : !isRemixLicensed ? (
            <span aria-hidden="true">&nbsp;</span>
          ) : null}
        </div>

        {/* Row 5: Pricing Box */}
        {variant === 'mypage' && isRemixLicensed ? (
          <div className="market-pricing-box">
            <div className="market-price-item">
              <span className="market-price-label">STREAM</span>
              <span className="market-price-val market-price-val-stream">
                ${song.stream_price.toFixed(2)}
                <span className="market-price-unit">/m</span>
              </span>
            </div>
            <div className="market-price-item">
              <span className="market-price-label">STATUS</span>
              <span className="market-price-val market-price-val-license">LICENSED</span>
            </div>
          </div>
        ) : variant === 'mypage' && song.public ? (
          <PublicSongPricingBox song={song} />
        ) : (
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
        )}

        {/* Row 6: Actions Toolbar (Icon + Tooltip) */}
        <div className="market-card-actions" data-guide={variant === 'market' ? 'market-card-license' : undefined}>
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
              onClick={onPlayToggle}
              aria-label={isPlayingThis ? 'Pause' : 'Stream'}
              className="market-btn-icon"
            >
              {isPlayingThis ? <Pause size={13} /> : <Play size={13} />}
            </Button>
          </Tooltip>

          {variant === 'market' ? (
            <Licenses key={song.id} song={song} placement="market" compact />
          ) : isRemixLicensed ? (
            <Licenses
              key={song.id}
              song={song}
              placement="mypage"
              onEditSong={onEditInStudio}
              compact
            />
          ) : song.public ? (
            <div className="mypage-public-action-wrap">
              <Badge variant="secondary" className="mypage-status-badge">
                PUBLIC
              </Badge>
              <Licenses
                key={song.id}
                song={song}
                placement="mypage"
                onEditSong={onEditInStudio}
                compact
              />
            </div>
          ) : (
            <div className="mypage-private-action-wrap" data-guide="mypage-card-publish">
              <Badge variant="muted" className="mypage-status-badge">
                PRIVATE
              </Badge>
              <Tooltip title="Publish Track" description="Mint on-chain and publish to Market">
                <Button
                  variant="primary"
                  size="sm"
                  className="mypage-publish-icon-btn"
                  onClick={() => onPublishClick?.(song)}
                  disabled={Boolean(publicPending)}
                  aria-label="Publish track"
                >
                  <Upload size={12} />
                </Button>
              </Tooltip>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
