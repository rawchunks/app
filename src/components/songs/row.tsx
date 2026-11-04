import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Play,
  Pause,
  Heart,
  Plus,
  Check,
  Headphones,
  ListPlus,
  Share2,
  User,
} from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Tooltip } from '../daw/Tooltip';
import { Licenses } from './licenses';
import { formatDuration, normalizeTags } from './card';
import { store } from '../../lib/store';
import { useSelectedUserAddress } from '../../hooks/use-address';
import { useProfile } from '../../hooks/use-profile';
import { useLikes } from '../../hooks/use-social';
import {
  useCreatorPlaylists,
  createPlaylistApi,
  addSongToPlaylistApi,
  removeSongFromPlaylistApi,
} from '../../hooks/use-playlists';
import { navigateToCreator } from '../../lib/routes';
import type { Song } from '../../lib/schema';

export interface LikeButtonProps {
  songId: string;
  likesCount?: number;
  showCount?: boolean;
  className?: string;
}

export const LikeButton: React.FC<LikeButtonProps> = ({
  songId,
  likesCount = 0,
  showCount = false,
  className = '',
}) => {
  const { readAddress } = useSelectedUserAddress();
  const { isLiked, toggleLike } = useLikes(readAddress);
  const liked = isLiked(songId);
  const displayCount = Math.max(liked ? 1 : 0, likesCount);

  return (
    <Tooltip title={liked ? 'Liked' : 'Like'} description={liked ? 'Remove from Liked' : 'Save to Liked'}>
      <button
        type="button"
        className={`social-like-btn ${liked ? 'is-liked' : ''} ${className}`.trim()}
        onClick={(e) => toggleLike(songId, e)}
        aria-label={liked ? 'Unlike track' : 'Like track'}
        aria-pressed={liked}
      >
        <Heart size={13} fill={liked ? 'currentColor' : 'none'} />
        {showCount && displayCount > 0 && (
          <span className="social-like-count">{displayCount}</span>
        )}
      </button>
    </Tooltip>
  );
};

export interface PlaylistAdderProps {
  song: Song;
  className?: string;
  onShare?: (song: Song) => void;
}

export const PlaylistAdder: React.FC<PlaylistAdderProps> = ({
  song,
  className = '',
  onShare,
}) => {
  const { readAddress } = useSelectedUserAddress();
  const { data: myPlaylists = [] } = useCreatorPlaylists(readAddress);
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; openUp: boolean }>({
    top: 0,
    left: 0,
    openUp: false,
  });

  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = btnRef.current?.getBoundingClientRect();
      if (!rect) return;
      const menuWidth = 228;
      const menuEstHeight = 250;
      const openUp = window.innerHeight - rect.bottom < menuEstHeight && rect.top > menuEstHeight;
      const left = Math.max(8, Math.min(window.innerWidth - menuWidth - 8, rect.right - menuWidth));
      const top = openUp ? rect.top - 6 : rect.bottom + 6;
      setCoords({ top, left, openUp });
    };
    updatePosition();

    const handleOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        menuRef.current &&
        !menuRef.current.contains(target) &&
        btnRef.current &&
        !btnRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    window.addEventListener('keydown', handleEsc);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('keydown', handleEsc);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  const inAnyPlaylist = myPlaylists.some((pl) => pl.song_ids?.includes(song.id));

  const handleToggleSongInPlaylist = async (playlistId: string, currentlyIn: boolean) => {
    if (!readAddress) {
      toast.error('Connect account to manage playlists');
      return;
    }
    setBusyId(playlistId);
    try {
      if (currentlyIn) {
        await removeSongFromPlaylistApi(playlistId, song.id, readAddress);
        toast.success('Removed from playlist');
      } else {
        await addSongToPlaylistApi(playlistId, song.id, readAddress);
        toast.success('Added to playlist');
      }
      await queryClient.invalidateQueries({ queryKey: ['playlists'] });
    } catch (err: any) {
      toast.error(err?.message || 'Could not update playlist');
    } finally {
      setBusyId(null);
    }
  };

  const handleCreatePlaylist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!readAddress) {
      toast.error('Connect account to create playlists');
      return;
    }
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    setCreating(true);
    try {
      await createPlaylistApi(
        {
          title: trimmed,
          creator: readAddress,
          cover: song.image || null,
          song_ids: [song.id],
          public: true,
        },
        readAddress
      );
      await queryClient.invalidateQueries({ queryKey: ['playlists'] });
      setNewTitle('');
      toast.success(`Added to "${trimmed}"`);
    } catch (err: any) {
      toast.error(err?.message || 'Could not create playlist');
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <Tooltip
        title={inAnyPlaylist ? 'Saved in Playlist' : 'Add to Playlist / Queue'}
        description="Save to playlist or queue"
      >
        <button
          ref={btnRef}
          type="button"
          className={`social-add-btn ${inAnyPlaylist ? 'in-playlist' : ''} ${open ? 'active' : ''} ${className}`.trim()}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((prev) => !prev);
          }}
          aria-label="Add to playlist or queue"
          aria-expanded={open}
        >
          {inAnyPlaylist ? <Check size={13} /> : <Plus size={13} />}
        </button>
      </Tooltip>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            className={`social-playlist-popover ${coords.openUp ? 'open-up' : ''}`}
            style={{
              top: `${coords.top}px`,
              left: `${coords.left}px`,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="social-popover-quick-row">
              <button
                type="button"
                className="social-popover-quick-btn"
                onClick={() => {
                  store.addToQueue(song);
                  toast.success(`Queued "${song.title}"`);
                  setOpen(false);
                }}
              >
                <ListPlus size={12} />
                <span>QUEUE</span>
              </button>
              {onShare && (
                <button
                  type="button"
                  className="social-popover-quick-btn"
                  onClick={() => {
                    setOpen(false);
                    onShare(song);
                  }}
                >
                  <Share2 size={12} />
                  <span>SHARE</span>
                </button>
              )}
            </div>

            <div className="social-popover-divider" />
            <div className="social-popover-section-label">PLAYLISTS</div>

            {!readAddress ? (
              <div className="social-popover-empty">Connect account to save playlists</div>
            ) : (
              <>
                <div className="social-popover-list">
                  {myPlaylists.length === 0 ? (
                    <div className="social-popover-empty">No playlists yet</div>
                  ) : (
                    myPlaylists.map((pl) => {
                      const hasSong = Boolean(pl.song_ids?.includes(song.id));
                      const isBusy = busyId === pl.id;
                      return (
                        <button
                          key={pl.id}
                          type="button"
                          disabled={isBusy}
                          className={`social-popover-item ${hasSong ? 'checked' : ''}`}
                          onClick={() => void handleToggleSongInPlaylist(pl.id, hasSong)}
                        >
                          <span className="social-popover-check">
                            {hasSong ? <Check size={11} /> : <Plus size={11} />}
                          </span>
                          <span className="social-popover-title">{pl.title}</span>
                          <span className="social-popover-count">{pl.song_ids?.length ?? 0}</span>
                        </button>
                      );
                    })
                  )}
                </div>

                <form className="social-popover-create" onSubmit={handleCreatePlaylist}>
                  <input
                    type="text"
                    className="social-popover-input"
                    placeholder="+ New playlist..."
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    maxLength={60}
                  />
                  <button
                    type="submit"
                    className="social-popover-submit"
                    disabled={creating || !newTitle.trim()}
                    aria-label="Create playlist"
                  >
                    <Plus size={12} />
                  </button>
                </form>
              </>
            )}
          </div>,
          document.body
        )}
    </>
  );
};

export interface RowProps {
  song: Song;
  index?: number;
  isPlayingThis: boolean;
  onPlayToggle: () => void;
  onSelectCreator?: (creator: string) => void;
  onSelectGenre?: (genre: string) => void;
  onShare?: (song: Song) => void;
}

export const Row: React.FC<RowProps> = ({
  song,
  index,
  isPlayingThis,
  onPlayToggle,
  onSelectCreator,
  onSelectGenre,
  onShare,
}) => {
  const [imgError, setImgError] = useState(false);
  const { nickname, avatar } = useProfile(song.creator);

  useEffect(() => {
    setImgError(false);
  }, [song.image]);

  const shortAddr = song.creator
    ? song.creator.startsWith('0x')
      ? `${song.creator.slice(0, 6)}…${song.creator.slice(-4)}`
      : `${song.creator.slice(0, 4)}…${song.creator.slice(-4)}`
    : '—';
  const displayCreator = nickname?.trim() || shortAddr;
  const tags = normalizeTags(song.tags);
  const primaryGenre = tags[0] || song.genres?.[0] || null;

  const handleCreatorClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!song.creator) return;
    if (onSelectCreator) {
      onSelectCreator(song.creator);
    } else {
      navigateToCreator(song.creator);
    }
  };

  return (
    <div
      className={`market-song-row ${isPlayingThis ? 'is-playing' : ''}`}
      data-guide-entity={song.id}
      onClick={onPlayToggle}
    >
      {/* Index or Play indicator + Thumbnail */}
      <button
        type="button"
        className="market-row-media"
        data-guide="card.stream"
        onClick={(e) => {
          e.stopPropagation();
          onPlayToggle();
        }}
        aria-label={isPlayingThis ? `Pause ${song.title}` : `Play ${song.title}`}
      >
        {!imgError && song.image && song.image.trim() !== '' ? (
          <img
            src={song.image}
            alt={song.title}
            className="market-row-cover"
            loading="lazy"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="market-row-cover market-row-cover-fallback">
            <img src="/branding/mark.svg" alt="" className="market-row-fallback-mark" />
          </div>
        )}
        <span className="market-row-play-badge">
          {isPlayingThis ? <Pause size={13} /> : <Play size={13} className="market-play-icon-offset" />}
        </span>
        {typeof index === 'number' && !isPlayingThis && (
          <span className="market-row-index">{String(index + 1).padStart(2, '0')}</span>
        )}
      </button>

      {/* Track Title + Creator + Genre Pill */}
      <div className="market-row-info">
        <div className="market-row-title-line">
          <span className="market-row-title">{song.title}</span>
          {typeof song.plays === 'number' && song.plays > 0 && (
            <span className="market-row-plays" title={`${song.plays} streams`}>
              <Headphones size={10} />
              <span>{song.plays >= 1000 ? `${(song.plays / 1000).toFixed(1)}k` : song.plays}</span>
            </span>
          )}
        </div>
        <div className="market-row-subline">
          <button
            type="button"
            className="market-row-creator-btn"
            onClick={handleCreatorClick}
            title={`Open ${displayCreator}`}
          >
            {avatar ? (
              <img src={avatar} alt="" className="market-row-creator-avatar" />
            ) : (
              <User size={10} className="market-row-creator-icon" />
            )}
            <span>{displayCreator}</span>
          </button>

          {primaryGenre && (
            <button
              type="button"
              className="market-row-genre-pill"
              onClick={(e) => {
                e.stopPropagation();
                onSelectGenre?.(primaryGenre);
              }}
            >
              {primaryGenre}
            </button>
          )}
        </div>
      </div>

      {/* Right Action Cluster: Duration, Price/License, Like (♥), Add to Playlist (+) */}
      <div className="market-row-actions" onClick={(e) => e.stopPropagation()}>
        {song.duration && song.duration > 0 ? (
          <span className="market-row-duration">{formatDuration(song.duration)}</span>
        ) : null}

        <div className="market-row-license-slot">
          <Licenses key={song.id} song={song} placement="market" compact />
        </div>

        <LikeButton songId={song.id} likesCount={song.likes} showCount />
        <PlaylistAdder song={song} onShare={onShare} />
      </div>
    </div>
  );
};
