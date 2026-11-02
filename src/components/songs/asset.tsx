import React from 'react';
import {
  Play,
  Pause,
  ExternalLink,
  Disc3,
  Download,
  Headphones,
  Share2,
  MoreHorizontal,
} from 'lucide-react';
import { Tooltip } from '../daw/Tooltip';
import { useLicense } from '../../hooks/use-license';
import {
  classifySongNetwork,
  formatUsd,
  getNetworkLogo,
  type NetworkFilter,
} from '../../hooks/use-earnings';
import {
  resolveNetworkName,
  resolveTxUrl,
} from './card';
import type { Song, SongEarningsItem } from '../../lib/schema';

export interface AssetProps {
  song: Song;
  versionNumber?: number | null;
  earning?: SongEarningsItem;
  networkFilter?: NetworkFilter;
  albumTitle: string | null;
  albumCover: string | null;
  isPlayingThis: boolean;
  onPlayToggle: () => void;
  isMenuOpen?: boolean;
  onToggleMenu?: () => void;
  onDownload?: (song: Song) => void;
  onShare?: (song: Song) => void;
}

/**
 * Published & Monetized Catalog Asset Row (/my-page -> EARN).
 * Immutable on-chain catalog entry displaying per-song profit (licenses + x402 streams),
 * license inventory (sold vs remaining), verified public plays, and on-chain settlement link.
 */
export const Asset: React.FC<AssetProps> = ({
  song,
  versionNumber = null,
  earning,
  networkFilter = 'all',
  albumTitle,
  albumCover,
  isPlayingThis,
  onPlayToggle,
  isMenuOpen = false,
  onToggleMenu,
  onDownload,
  onShare,
}) => {
  const { data: liveLicense, sold: liveSold } = useLicense(song);

  const effectiveNetwork = song.network || earning?.network || null;
  const { family: songNetFamily } = classifySongNetwork(effectiveNetwork);
  const matchesSelectedNetwork =
    !networkFilter ||
    networkFilter === 'all' ||
    songNetFamily === networkFilter ||
    (effectiveNetwork || '').toLowerCase() === networkFilter;

  const licensesSold = matchesSelectedNetwork
    ? Math.max(earning?.licensesSold ?? 0, liveSold ?? 0)
    : (earning?.licensesSold ?? 0);
  const licensesRemaining =
    liveLicense?.remaining !== undefined
      ? Number(liveLicense.remaining)
      : earning?.licensesRemaining !== undefined
        ? earning.licensesRemaining
        : song.licenses;
  const licensesMinted = Math.max(
    earning?.licensesMinted ?? 0,
    song.licenses,
    licensesSold + licensesRemaining,
  );

  const licensePrice = earning?.licensePriceUsd ?? song.license_price ?? 0;
  const streamPrice = earning?.streamPriceUsd ?? song.stream_price ?? 0;
  const computedLicProfit = matchesSelectedNetwork
    ? Number((licensesSold * licensePrice * 0.8).toFixed(6))
    : 0;
  const licenseProfitUsd = matchesSelectedNetwork
    ? Math.max(earning?.licenseProfitUsd ?? 0, computedLicProfit)
    : (earning?.licenseProfitUsd ?? 0);
  const streamProfitUsd = earning?.streamProfitUsd ?? 0;
  const totalProfitUsd = Number((licenseProfitUsd + streamProfitUsd).toFixed(6));
  const plays = Math.max(earning?.plays ?? 0, song.plays ?? 0);

  const netLogo = getNetworkLogo(effectiveNetwork || earning?.networkFamily);
  const netName = resolveNetworkName(effectiveNetwork) || earning?.networkLabel || 'On-Chain';
  const txUrl =
    earning?.explorerUrl ||
    resolveTxUrl(effectiveNetwork || undefined, song.tx_hash || earning?.txHash || undefined, song.tx_url);

  const coverSrc =
    song.image && song.image.trim() !== ''
      ? song.image
      : albumCover && albumCover.trim() !== ''
        ? albumCover
        : '/branding/mark.svg';
  const isFallbackCover = coverSrc === '/branding/mark.svg';
  const soldRatio =
    licensesMinted > 0 ? Math.min(100, Math.round((licensesSold / licensesMinted) * 100)) : 0;

  return (
    <div
      data-guide-entity={song.id}
      className={`earn-list-row ${isPlayingThis ? 'playing' : ''}`}
    >
      {/* Track Identity (Single Play/Pause Trigger on Cover Thumbnail) */}
      <div className="earn-list-cell earn-cell-track">
        <button
          type="button"
          className={`finder-list-thumb-btn ${isPlayingThis ? 'active' : ''}`}
          onClick={onPlayToggle}
          aria-label={isPlayingThis ? `Pause ${song.title}` : `Play ${song.title}`}
        >
          <img
            src={coverSrc}
            alt={song.title}
            className={`finder-list-thumb ${isFallbackCover ? 'fallback' : ''}`}
            loading="lazy"
          />
          <span className="finder-list-thumb-overlay" aria-hidden="true">
            {isPlayingThis ? <Pause size={12} /> : <Play size={12} />}
          </span>
        </button>

        <div className="earn-track-meta">
          <div className="finder-list-title-wrap">
            <span className="finder-list-title" title={song.title}>
              {song.title}
            </span>
            {versionNumber !== null && versionNumber !== undefined && (
              <span
                className="board-take-badge-pill selected"
                aria-label={`Version ${versionNumber}`}
              >
                #{versionNumber}
              </span>
            )}
          </div>
          <span className="earn-album-sub">
            <Disc3 size={10} />
            <span>{albumTitle || 'SINGLE'}</span>
          </span>
        </div>
      </div>

      {/* Network */}
      <div className="earn-list-cell earn-cell-network">
        <div className="earn-network-pill">
          {netLogo && <img src={netLogo} alt={netName} className="earn-network-logo" />}
          <span className="earn-network-name">{netName}</span>
          {txUrl && (
            <Tooltip title="On-Chain Transaction" description={txUrl}>
              <a
                href={txUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="earn-tx-link"
                aria-label="View transaction on block explorer"
              >
                <ExternalLink size={11} />
              </a>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Profit (Licenses + x402 Streams) */}
      <div className="earn-list-cell earn-cell-profit">
        <Tooltip
          title="Creator Profit (80%)"
          description={`Licenses: ${formatUsd(licenseProfitUsd)} • Streams: ${formatUsd(streamProfitUsd)}`}
        >
          <div className="earn-profit-stack">
            <span className={`earn-profit-total ${totalProfitUsd > 0 ? 'positive' : ''}`}>
              {formatUsd(totalProfitUsd)}
            </span>
            <span className="earn-profit-sub">
              L {formatUsd(licenseProfitUsd)} · S {formatUsd(streamProfitUsd)}
            </span>
          </div>
        </Tooltip>
      </div>

      {/* Licenses Sold / Remaining */}
      <div className="earn-list-cell earn-cell-licenses">
        <div className="earn-license-meter-wrap">
          <div className="earn-license-counts">
            <span className="mypage-stat-badge sold">{licensesSold} sold</span>
            <span className="mypage-stat-badge left">{licensesRemaining} left</span>
          </div>
          <div className="earn-license-bar" aria-hidden="true">
            <div className="earn-license-bar-fill" style={{ width: `${soldRatio}%` }} />
          </div>
        </div>
      </div>

      {/* Verified Plays & Unit Rates */}
      <div className="earn-list-cell earn-cell-metrics">
        <div className="earn-metrics-stack">
          <span className="earn-plays-pill" title={`${plays} public plays`}>
            <Headphones size={11} />
            <span>{plays}</span>
          </span>
          <span className="earn-price-sub">
            ${streamPrice.toFixed(3).replace(/0$/, '')}/m · ${licensePrice.toFixed(0)}
          </span>
        </div>
      </div>

      {/* Read-Only Catalog Options Dropdown (Share / Download) */}
      <div
        className="earn-list-cell earn-cell-actions"
        onClick={(e) => e.stopPropagation()}
      >
        {onToggleMenu && (
          <div className="mypage-menu-wrap">
            <Tooltip title="Release Options" description="Share or download audio">
              <button
                type="button"
                className="mypage-card-more-btn"
                data-guide="mypage-card-menu"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleMenu();
                }}
                aria-label="Release options"
              >
                <MoreHorizontal size={13} />
              </button>
            </Tooltip>

            {isMenuOpen && (
              <div className="mypage-menu-dropdown" onClick={(e) => e.stopPropagation()}>
                {onShare && (
                  <button
                    type="button"
                    className="mypage-menu-item mypage-item-edit"
                    onClick={() => onShare(song)}
                  >
                    <Share2 size={12} />
                    <span>SHARE</span>
                  </button>
                )}
                {onDownload && (
                  <button
                    type="button"
                    className="mypage-menu-item mypage-item-download"
                    onClick={() => onDownload(song)}
                  >
                    <Download size={12} />
                    <span>DOWNLOAD</span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
