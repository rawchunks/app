import { useGuideOwner } from '../guide/owners';
import React from 'react';
import {
  Play,
  Pause,
  Disc3,
  Pencil,
  Download,
  Trash2,
  Upload,
  Sliders,
  MoreHorizontal,
  Lock,
  GitBranch,
  ChevronRight,
  GitFork,
} from 'lucide-react';
import { Button } from '../button';
import { Badge } from '../badge';
import { Tooltip } from '../daw/Tooltip';
import { Versions } from './versions';
import { Licenses } from './licenses';
import {
  CoverArt,
  normalizeTags,
  formatDuration,
} from './card';
import type { Song } from '../../lib/schema';

export type FinderViewMode = 'grid' | 'list' | 'columns';

export interface DraftProps {
  song: Song;
  versions: Song[];
  albumTitle: string | null;
  albumCover: string | null;
  viewMode?: FinderViewMode;
  isSelected?: boolean;
  onSelectRow?: (song: Song) => void;
  isPlayingThis: boolean;
  onPlayToggle: () => void;
  onSelectVersion: (version: Song) => void;
  onAddToAlbum?: (song: Song) => void;
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

const formatRelativeDate = (iso?: string): string => {
  if (!iso) return '—';
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts) || ts <= 0) return '—';
  const diff = Date.now() - ts;
  const day = 86_400_000;
  if (diff < day) return 'Today';
  if (diff < 2 * day) return 'Yesterday';
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

/**
 * Private Workspace Song Component (/my-page -> WORKSPACE).
 * Purpose-built for unminted WIP drafts, multi-version studio sessions, and licensed remix stems.
 * Supports macOS Finder view modes: 'grid' (Icons), 'list' (Table), and 'columns' (Miller Columns).
 */
export const Draft: React.FC<DraftProps> = ({
  song,
  versions,
  albumTitle,
  albumCover,
  viewMode = 'grid',
  isSelected = false,
  onSelectRow,
  isPlayingThis,
  onPlayToggle,
  onSelectVersion,
  onAddToAlbum,
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
  useGuideOwner({
    id: 'card',
    scope: viewMode === 'columns' ? `mypage:col:${song.id}` : `mypage:${song.id}`,
    handles: (step) => viewMode !== 'columns' && ['K5', 'K7', 'M4'].includes(step.id),
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
  const coverSrc =
    song.image && song.image.trim() !== ''
      ? song.image
      : albumCover && albumCover.trim() !== ''
        ? albumCover
        : '/branding/mark.svg';
  const isFallbackCover = coverSrc === '/branding/mark.svg';

  const renderMenuDropdown = () => {
    if (isRemixLicensed || !isMenuOpen) return null;
    return (
      <div className="mypage-menu-dropdown" onClick={(e) => e.stopPropagation()}>
        {onEditDetails && (
          <button
            type="button"
            className="mypage-menu-item mypage-item-details"
            data-guide="card.details-item"
            onClick={() => onEditDetails(song)}
          >
            <Sliders size={12} />
            <span>SONG DETAILS</span>
          </button>
        )}
        {onAddToAlbum && (
          <button
            type="button"
            className="mypage-menu-item"
            onClick={() => onAddToAlbum(song)}
          >
            <Disc3 size={12} />
            <span>ADD TO ALBUM</span>
          </button>
        )}
        {onEditInStudio && (
          <button
            type="button"
            className="mypage-menu-item mypage-item-edit"
            data-guide="card.editor-item"
            onClick={() => onEditInStudio(song)}
          >
            <Pencil size={12} />
            <span>AUDIO EDITOR</span>
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
        {onDelete && (
          <button
            type="button"
            className="mypage-menu-item mypage-item-delete"
            onClick={() => onDelete(song.id)}
          >
            <Trash2 size={12} />
            <span>DELETE</span>
          </button>
        )}
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // 1. FINDER COLUMNS VIEW ITEM (Compact Miller Column Row)
  // ---------------------------------------------------------------------------
  if (viewMode === 'columns') {
    return (
      <div
        className={`finder-col-item ${isSelected ? 'selected' : ''} ${isPlayingThis ? 'playing' : ''}`}
        onClick={() => onSelectRow?.(song)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelectRow?.(song);
          }
        }}
      >
        <img
          src={coverSrc}
          alt={song.title}
          className={`finder-col-thumb ${isFallbackCover ? 'fallback' : ''}`}
          loading="lazy"
        />

        <span className="finder-col-title" title={song.title}>
          {song.title}
        </span>

        {versions.length > 1 && (
          <span className="finder-col-versions-pill" title={`${versions.length} versions`}>
            v{versions.length}
          </span>
        )}

        <ChevronRight size={12} className="finder-col-chevron" />
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // 2. FINDER LIST VIEW ROW (Sortable Dense Studio Table Row)
  // ---------------------------------------------------------------------------
  if (viewMode === 'list') {
    return (
      <div
        data-guide-entity={song.id}
        className={`finder-list-row ${isPlayingThis ? 'playing' : ''} ${isSelected ? 'selected' : ''}`}
        onClick={() => onSelectRow?.(song)}
      >
        <div className="finder-list-cell finder-cell-main">
          <button
            type="button"
            data-guide="card.stream"
            className={`finder-list-thumb-btn ${isPlayingThis ? 'active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              onPlayToggle();
            }}
            aria-label={isPlayingThis ? 'Pause' : 'Play'}
          >
            <img
              src={coverSrc}
              alt={song.title}
              className={`finder-list-thumb ${isFallbackCover ? 'fallback' : ''}`}
              loading="lazy"
            />
            <span className="finder-list-thumb-overlay">
              {isPlayingThis ? <Pause size={12} /> : <Play size={12} />}
            </span>
          </button>

          <div className="finder-list-title-wrap">
            <span className="finder-list-title" title={song.title}>
              {song.title}
            </span>
            {versions.length > 1 && (
              <div className="finder-list-versions" onClick={(e) => e.stopPropagation()}>
                <Versions songs={versions} selected={song.id} onSelect={onSelectVersion} />
              </div>
            )}
            {(isRemixLicensed || song.is_remix || song.source) && (
              <Badge variant="secondary">
                <GitFork size={10} />
                <span>REMIX</span>
              </Badge>
            )}
          </div>
        </div>

        <div className="finder-list-cell finder-cell-album">
          <button
            type="button"
            className={`finder-album-pill ${onAddToAlbum && !isRemixLicensed ? 'clickable' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              if (onAddToAlbum && !isRemixLicensed) onAddToAlbum(song);
            }}
            disabled={!onAddToAlbum || isRemixLicensed}
            title={albumTitle ? `Album: ${albumTitle}` : 'Assign to Album'}
          >
            <Disc3 size={11} />
            <span>{albumTitle || 'SINGLE'}</span>
          </button>
        </div>

        <div className="finder-list-cell finder-cell-genre">
          {tags[0] ? <Badge variant="secondary">{tags[0]}</Badge> : <span className="finder-dim">—</span>}
        </div>

        <div
          className="finder-list-cell finder-cell-duration"
          data-guide="card.version-status"
        >
          {formatDuration(song.duration)}
        </div>

        <div className="finder-list-cell finder-cell-date">
          {formatRelativeDate(song.created_at)}
        </div>

        <div
          className="finder-list-cell finder-cell-actions"
          onClick={(e) => e.stopPropagation()}
        >
          {!isRemixLicensed && !song.public && onPublishClick && (
            <Tooltip title="Publish Track" description="Mint on-chain and publish to Market">
              <Button
                variant="primary"
                size="xs"
                data-guide="mypage-card-publish"
                onClick={() => onPublishClick(song)}
                disabled={Boolean(publicPending)}
                aria-label="Publish track"
              >
                <Upload size={12} />
              </Button>
            </Tooltip>
          )}
          {!isRemixLicensed && onToggleMenu && (
            <div className="mypage-menu-wrap">
              <Tooltip title="Draft Options" description="Details, album, editor, download, or delete">
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
              {renderMenuDropdown()}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // 3. FINDER GRID VIEW CARD (Default Icon Card)
  // ---------------------------------------------------------------------------
  const maxVisibleTags = albumTitle ? 1 : 2;
  const visibleTags = tags.slice(0, maxVisibleTags);
  const overflowCount = Math.max(0, tags.length - maxVisibleTags);

  return (
    <div
      data-guide-entity={song.id}
      className={`market-card draft-card ${isPlayingThis ? 'playing' : ''}`}
    >
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
          !isRemixLicensed && onToggleMenu ? (
            <div className="mypage-menu-wrap">
              <Tooltip title="Draft Options" description="Details, album, editor, download, or delete">
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

      {renderMenuDropdown()}

      <div className="market-card-body">
        {/* Zone 1: Title + Album / Version Branch */}
        <div className="market-card-identity">
          <Tooltip title={song.title} className="mypage-card-title-tooltip">
            <div className="market-card-row-title">{song.title}</div>
          </Tooltip>

          <div
            className={`market-card-row-album ${onAddToAlbum && !isRemixLicensed ? 'clickable' : ''}`}
            onClick={
              onAddToAlbum && !isRemixLicensed
                ? (e) => {
                    e.stopPropagation();
                    onAddToAlbum(song);
                  }
                : undefined
            }
          >
            <Tooltip title="Private Draft">
              <span className="mypage-meta-status-icon private">
                <Lock size={11} />
              </span>
            </Tooltip>
            <Tooltip title={albumTitle ? `Album: ${albumTitle}` : 'Assign to Album'}>
              <span className="market-album-text">{albumTitle || 'SINGLE'}</span>
            </Tooltip>
            {versions.length > 1 && (
              <Tooltip title={`${versions.length - 1} edit${versions.length - 1 === 1 ? '' : 's'}`}>
                <span className="mypage-edits-pill">
                  <GitBranch size={10} />
                  <span>{versions.length - 1}</span>
                </span>
              </Tooltip>
            )}
          </div>
        </div>

        {/* Zone 2: Genre Tags */}
        <div className={`market-card-row-tags ${tags.length === 0 ? 'empty' : ''}`}>
          {visibleTags.length > 0 ? (
            <>
              {visibleTags.map((t) => (
                <Tooltip key={t} title="Genre / Style" description={t}>
                  <Badge variant="secondary">{t}</Badge>
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
          ) : (
            <span aria-hidden="true">&nbsp;</span>
          )}
        </div>

        {/* Zone 3: Remix / Licensed Provenance (only when applicable) */}
        {(isRemixLicensed || song.source || song.is_remix) && (
          <div className="market-pricing-box">
            <div className="market-price-item">
              <span className="market-price-label" aria-label="Lineage">
                <GitFork size={12} />
              </span>
              <span className="market-price-val market-price-val-license">
                {isRemixLicensed ? 'LICENSED REMIX' : <span className="market-price-remix">REMIX</span>}
              </span>
            </div>
          </div>
        )}

        {/* Zone 4: Primary Action */}
        <div className="market-card-actions">
          {isRemixLicensed ? (
            <Licenses
              key={song.id}
              song={song}
              placement="mypage"
              onEditSong={onEditInStudio}
              compact
            />
          ) : (
            <div className="mypage-private-action-wrap" data-guide="mypage-card-publish">
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
