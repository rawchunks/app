import React, { useState } from 'react';
import {
  Play,
  Pause,
  ExternalLink,
  User,
} from 'lucide-react';
import { Tooltip } from './daw/Tooltip';
import { Versions } from './versions';
import { store } from '../lib/store';
import { useProfile } from '../hooks/use-profile';
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
    const coverSrc =
      !imgError && image && image !== '/hero.png' && image.trim() !== ''
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

