import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from './button';
import { Slider } from './slider';
import { Tooltip } from './daw/Tooltip';
import { store, State, RepeatMode } from '../lib/store';
import { audio } from '../lib/audio';
import { useDismiss } from '../hooks/use-dismiss';
import { useSelectedUserAddress } from '../hooks/use-address';
import { useProfile } from '../hooks/use-profile';
import { readCachedProfile } from '../lib/cache';
import { createPlaylistApi } from '../hooks/use-playlists';
import { useQueryClient } from '@tanstack/react-query';
import { openGate } from '../lib/gate';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ListMusic,
  Shuffle,
  Repeat,
  Repeat1,
  X,
  FolderPlus,
  Trash2,
  Check,
  GripVertical,
} from 'lucide-react';

export interface Props {
  className?: string;
}

const formatCreatorName = (creator?: string | null, resolvedNickname?: string | null): string => {
  if (resolvedNickname && resolvedNickname.trim() !== '') return resolvedNickname.trim();
  if (!creator || creator.trim() === '') return 'RAWCHUNKS';
  const addr = creator.trim();
  const cached = readCachedProfile(addr);
  if (cached?.nickname && cached.nickname.trim() !== '') return cached.nickname.trim();
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
};

const formatTime = (secs: number) => {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
};

const PlayerScrubber: React.FC = () => {
  const progressRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sync = (s: State) => {
      const ratio = s.duration > 0 ? Math.max(0, Math.min(1, s.playhead / s.duration)) : 0;
      if (progressRef.current) {
        progressRef.current.style.setProperty('--scrubber-scale', String(ratio));
      }
      if (selectionRef.current) {
        if (s.selection && s.duration > 0) {
          selectionRef.current.style.display = 'block';
          selectionRef.current.style.setProperty(
            '--selection-left',
            `${(s.selection.start / s.duration) * 100}%`
          );
          selectionRef.current.style.setProperty(
            '--selection-width',
            `${((s.selection.end - s.selection.start) / s.duration) * 100}%`
          );
        } else {
          selectionRef.current.style.display = 'none';
        }
      }
    };
    sync(store.getState());
    return store.subscribe(sync);
  }, []);

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const s = store.getState();
    if (s.duration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    store.setPlayhead(pct * s.duration);
  };

  return (
    <div className="player-scrubber" onClick={handleSeek}>
      <div ref={progressRef} className="player-scrubber-progress" />
      <div ref={selectionRef} className="player-scrubber-selection" style={{ display: 'none' }} />
    </div>
  );
};

const PlayerTimeReadout: React.FC = () => {
  const [times, setTimes] = useState(() => {
    const s = store.getState();
    return { playheadSec: Math.floor(s.playhead), durationSec: Math.floor(s.duration), hasDuration: s.duration > 0 };
  });

  useEffect(() => {
    return store.subscribe((s) => {
      const playheadSec = Math.floor(s.playhead);
      const durationSec = Math.floor(s.duration);
      const hasDuration = s.duration > 0;
      setTimes((prev) =>
        prev.playheadSec === playheadSec &&
        prev.durationSec === durationSec &&
        prev.hasDuration === hasDuration
          ? prev
          : { playheadSec, durationSec, hasDuration }
      );
    });
  }, []);

  return (
    <span className="player-time-readout">
      {formatTime(times.playheadSec)} / {times.hasDuration ? formatTime(times.durationSec) : '--:--'}
    </span>
  );
};

export const Player: React.FC<Props> = ({ className = '' }) => {
  const [state, setState] = useState<State>(store.getState());
  const [volume, setVolume] = useState(0.85);
  const [muted, setMuted] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [savingPlaylist, setSavingPlaylist] = useState(false);
  const [playlistTitle, setPlaylistTitle] = useState('');
  const [showSavePrompt, setShowSavePrompt] = useState(false);
  const [isTitleOverflowing, setIsTitleOverflowing] = useState(false);

  const queueRef = useRef<HTMLDivElement>(null);
  const titleViewportRef = useRef<HTMLDivElement>(null);
  const titleMeasureRef = useRef<HTMLSpanElement>(null);
  const emptyDragImgRef = useRef<HTMLCanvasElement | null>(null);
  const { readAddress } = useSelectedUserAddress();
  const activeCreatorProfile = useProfile(state.activeSong?.creator);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (typeof document !== 'undefined') {
      const c = document.createElement('canvas');
      c.width = 1;
      c.height = 1;
      emptyDragImgRef.current = c;
    }
  }, []);

  useDismiss(queueOpen, () => setQueueOpen(false), queueRef);

  useEffect(() => {
    return store.subscribe((next) => {
      setState((prev) => {
        if (
          prev.activeSong === next.activeSong &&
          prev.isPlaying === next.isPlaying &&
          prev.duration === next.duration &&
          prev.queue === next.queue &&
          prev.queueIndex === next.queueIndex &&
          prev.repeatMode === next.repeatMode &&
          prev.shuffle === next.shuffle &&
          prev.activePlaylistId === next.activePlaylistId &&
          prev.activeContextId === next.activeContextId
        ) {
          return prev;
        }
        return next;
      });
    });
  }, []);

  useEffect(() => {
    setImgError(false);
  }, [state.activeSong?.id, state.activeSong?.image]);

  // Measure whether the song title overflows its container for Spotify-style continuous marquee loop
  useEffect(() => {
    const checkOverflow = () => {
      const vp = titleViewportRef.current;
      const measure = titleMeasureRef.current;
      if (!vp || !measure) {
        setIsTitleOverflowing(false);
        return;
      }
      setIsTitleOverflowing(measure.scrollWidth > vp.clientWidth + 2);
    };

    checkOverflow();
    const vp = titleViewportRef.current;
    if (!vp || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(checkOverflow);
    ro.observe(vp);
    return () => ro.disconnect();
  }, [state.activeSong?.title]);

  useEffect(() => {
    audio.setVolume(muted ? 0 : volume);
  }, [volume, muted]);

  // MediaSession API for lock screen & OS media keys
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const song = state.activeSong;
    if (song && typeof MediaMetadata !== 'undefined') {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: song.title,
        artist: song.creator || 'Rawchunks',
        album: song.album_title || 'RAWCHUNKS',
        artwork: song.image ? [{ src: song.image, sizes: '512x512', type: 'image/png' }] : [],
      });
    }
    navigator.mediaSession.playbackState = state.isPlaying ? 'playing' : 'paused';

    const safeSetHandler = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Ignore unsupported actions
      }
    };

    safeSetHandler('play', () => store.setPlaying(true));
    safeSetHandler('pause', () => store.setPlaying(false));
    safeSetHandler('previoustrack', () => store.playPreviousTrack());
    safeSetHandler('nexttrack', () => store.playNextTrack());
    safeSetHandler('seekto', (details) => {
      if (typeof details.seekTime === 'number') {
        store.setPlayhead(details.seekTime);
      }
    });
  }, [state.activeSong, state.isPlaying]);

  // Global keyboard shortcuts when not typing in inputs
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.code === 'Space' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (store.getState().activeSong) {
          e.preventDefault();
          store.setPlaying(!store.getState().isPlaying);
        }
      } else if (e.shiftKey && e.key === 'ArrowRight') {
        e.preventDefault();
        store.playNextTrack();
      } else if (e.shiftKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        store.playPreviousTrack();
      } else if ((e.key === 'm' || e.key === 'M') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        setMuted((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handlePlayPause = () => {
    store.setPlaying(!state.isPlaying);
  };

  const cycleRepeatMode = () => {
    const next: RepeatMode =
      state.repeatMode === 'off' ? 'all' : state.repeatMode === 'all' ? 'one' : 'off';
    store.setRepeatMode(next);
  };

  const handleSaveQueueAsPlaylist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!readAddress) {
      openGate();
      return;
    }
    if (state.queue.length === 0) return;
    const title = playlistTitle.trim() || `QUEUE_${new Date().toISOString().slice(5, 10)}`;
    setSavingPlaylist(true);
    try {
      await createPlaylistApi(
        {
          title,
          creator: readAddress,
          song_ids: state.queue.map((s) => s.id),
          cover: state.queue[0]?.image || '',
          public: false,
        },
        readAddress
      );
      await queryClient.invalidateQueries({ queryKey: ['playlists'] });
      toast.success(`Saved "${title}"`);
      setPlaylistTitle('');
      setShowSavePrompt(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save playlist');
    } finally {
      setSavingPlaylist(false);
    }
  };

  const currentSong = state.activeSong;
  const titleText = currentSong?.title || 'STANDBY';
  const creatorText = currentSong
    ? formatCreatorName(currentSong.creator, activeCreatorProfile.nickname)
    : 'No audio loaded';

  return (
    <div className={`app-player panel ${className}`.trim()}>
      {/* Top Scrubber Bar (isolated from Player React state to eliminate layout/paint thrashing) */}
      <PlayerScrubber />

      {/* Main Transport Row */}
      <div className="player-transport-row">
        {/* Track Info */}
        <div className="player-track-info">
          <div className="player-track-avatar">
            <img
              src={
                !imgError && currentSong?.image && currentSong.image.trim() !== ''
                  ? currentSong.image
                  : '/branding/mark.svg'
              }
              alt={currentSong?.title || 'Rawchunks'}
              decoding="async"
              onError={() => setImgError(true)}
            />
          </div>
          <div className="player-track-text">
            <div className="player-track-title-viewport" ref={titleViewportRef}>
              <span className="player-track-title-measure" ref={titleMeasureRef} aria-hidden="true">
                {titleText}
              </span>
              {isTitleOverflowing ? (
                <div className="player-track-title is-marquee" aria-label={titleText}>
                  <div className="player-track-marquee-track">
                    <span className="player-track-marquee-item">{titleText}</span>
                    <span className="player-track-marquee-item" aria-hidden="true">
                      {titleText}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="player-track-title">{titleText}</div>
              )}
            </div>
            <div className="player-track-meta">{creatorText}</div>
          </div>
        </div>

        {/* Transport Controls */}
        <div className="player-controls">
          <Tooltip title="Previous" position="top">
            <Button
              size="xs"
              variant="ghost"
              className="player-skip-btn"
              aria-label="Previous"
              disabled={state.queue.length === 0 && !currentSong}
              onClick={() => store.playPreviousTrack()}
            >
              <SkipBack size={13} />
            </Button>
          </Tooltip>

          <Tooltip title={state.isPlaying ? 'Pause' : 'Play'} position="top">
            <Button
              size="sm"
              variant={state.isPlaying ? 'secondary' : 'primary'}
              onClick={handlePlayPause}
              className="player-play-btn"
              aria-label={state.isPlaying ? 'Pause' : 'Play'}
            >
              {state.isPlaying ? <Pause size={14} /> : <Play size={14} />}
            </Button>
          </Tooltip>

          <Tooltip title="Next" position="top">
            <Button
              size="xs"
              variant="ghost"
              className="player-skip-btn"
              aria-label="Next"
              disabled={state.queue.length <= 1}
              onClick={() => store.playNextTrack()}
            >
              <SkipForward size={13} />
            </Button>
          </Tooltip>

          <PlayerTimeReadout />
        </div>

        {/* Right: Queue Drawer + Volume */}
        <div className="player-right-cluster" ref={queueRef}>
          <div className="player-queue-trigger-wrap">
            <Tooltip title="Queue" position="top">
              <Button
                size="xs"
                variant={queueOpen ? 'primary' : 'ghost'}
                className={`player-queue-btn ${queueOpen ? 'active' : ''}`}
                onClick={() => setQueueOpen((prev) => !prev)}
                aria-label="Queue"
                aria-expanded={queueOpen}
              >
                <ListMusic size={13} />
              </Button>
            </Tooltip>

            {queueOpen && (
              <div className="player-queue-drawer" role="dialog" aria-label="Queue">
                <div className="player-queue-header">
                  <span className="player-queue-title">
                    QUEUE {state.queue.length > 0 ? `(${state.queue.length})` : ''}
                  </span>
                  <div className="player-queue-modes">
                    <Tooltip title={state.isPlaying ? 'Pause' : 'Play'} position="top">
                      <button
                        type="button"
                        className={`player-mode-btn player-queue-play-btn ${state.isPlaying ? 'active' : ''}`}
                        disabled={state.queue.length === 0 && !currentSong}
                        onClick={() => {
                          if (currentSong) {
                            void store.setPlaying(!state.isPlaying);
                          } else if (state.queue.length > 0) {
                            void store.playQueueIndex(0);
                          }
                        }}
                        aria-label={state.isPlaying ? 'Pause Queue' : 'Play Queue'}
                      >
                        {state.isPlaying ? <Pause size={12} /> : <Play size={12} />}
                      </button>
                    </Tooltip>

                    <Tooltip title="Shuffle" position="top">
                      <button
                        type="button"
                        className={`player-mode-btn ${state.shuffle ? 'active' : ''}`}
                        onClick={() => store.setShuffle(!state.shuffle)}
                        aria-label="Shuffle"
                      >
                        <Shuffle size={12} />
                      </button>
                    </Tooltip>

                    <Tooltip title="Repeat" position="top">
                      <button
                        type="button"
                        className={`player-mode-btn ${state.repeatMode !== 'off' ? 'active' : ''}`}
                        onClick={cycleRepeatMode}
                        aria-label="Repeat"
                      >
                        {state.repeatMode === 'one' ? <Repeat1 size={12} /> : <Repeat size={12} />}
                      </button>
                    </Tooltip>

                    {state.queue.length > 0 && (
                      <>
                        <Tooltip title="Save as Playlist" position="top">
                          <button
                            type="button"
                            className={`player-mode-btn ${showSavePrompt ? 'active' : ''}`}
                            onClick={() => setShowSavePrompt((prev) => !prev)}
                            aria-label="Save as Playlist"
                          >
                            <FolderPlus size={12} />
                          </button>
                        </Tooltip>
                        <Tooltip title="Clear" position="top">
                          <button
                            type="button"
                            className="player-mode-btn"
                            onClick={() => store.clearQueue()}
                            aria-label="Clear"
                          >
                            <Trash2 size={12} />
                          </button>
                        </Tooltip>
                      </>
                    )}
                  </div>
                </div>

                {/* Save Queue as Private Playlist Inline Form */}
                {showSavePrompt && (
                  <form className="player-save-playlist-form" onSubmit={handleSaveQueueAsPlaylist}>
                    <input
                      type="text"
                      className="player-save-playlist-input"
                      placeholder="Playlist name..."
                      value={playlistTitle}
                      onChange={(e) => setPlaylistTitle(e.target.value)}
                      maxLength={80}
                      autoFocus
                    />
                    <button
                      type="submit"
                      className="player-save-playlist-submit"
                      disabled={savingPlaylist}
                      aria-label="Save"
                    >
                      <Check size={12} />
                    </button>
                  </form>
                )}

                {/* Queue List */}
                <div className="player-queue-list scrollable">
                  {state.queue.length === 0 ? (
                    <div className="player-queue-empty">EMPTY</div>
                  ) : (
                    state.queue.map((song, idx) => {
                      const isCurrent =
                        (idx === state.queueIndex || idx === 0) &&
                        state.activeSong?.id === song.id;
                      const isDragging = dragIdx === idx;
                      return (
                        <div
                          key={song.id}
                          data-queue-idx={idx}
                          className={`player-queue-item ${isCurrent ? 'current' : ''} ${isDragging ? 'dragging' : ''}`}
                          draggable={!isCurrent}
                          onDragStart={(e) => {
                            if (isCurrent) {
                              e.preventDefault();
                              return;
                            }
                            if (emptyDragImgRef.current) {
                              e.dataTransfer.setDragImage(emptyDragImgRef.current, 0, 0);
                            }
                            e.dataTransfer.effectAllowed = 'move';
                            setDragIdx(idx);
                          }}
                          onDragOver={(e) => {
                            e.preventDefault();
                            if (dragIdx !== null && dragIdx !== idx) {
                              store.moveQueueItem(dragIdx, idx);
                              setDragIdx(idx);
                            }
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            setDragIdx(null);
                          }}
                          onDragEnd={() => setDragIdx(null)}
                        >
                          <div
                            className={`player-queue-grip ${isCurrent ? 'disabled' : ''}`}
                            onPointerDown={(e) => {
                              if (isCurrent) return;
                              e.stopPropagation();
                              e.currentTarget.setPointerCapture(e.pointerId);
                              setDragIdx(idx);
                            }}
                            onPointerMove={(e) => {
                              if (dragIdx === null) return;
                              const el = document
                                .elementFromPoint(e.clientX, e.clientY)
                                ?.closest('[data-queue-idx]') as HTMLElement | null;
                              if (!el) return;
                              const targetIdx = Number(el.dataset.queueIdx);
                              if (Number.isFinite(targetIdx) && targetIdx !== dragIdx) {
                                store.moveQueueItem(dragIdx, targetIdx);
                                setDragIdx(targetIdx);
                              }
                            }}
                            onPointerUp={(e) => {
                              if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                                e.currentTarget.releasePointerCapture(e.pointerId);
                              }
                              setDragIdx(null);
                            }}
                            onPointerCancel={() => setDragIdx(null)}
                          >
                            <GripVertical size={12} />
                          </div>
                          <button
                            type="button"
                            className="player-queue-item-main"
                            onClick={() => void store.playQueueIndex(idx)}
                          >
                            <div className="player-queue-thumb">
                              <img
                                src={song.image && song.image.trim() !== '' ? song.image : '/branding/mark.svg'}
                                alt=""
                                width={28}
                                height={28}
                                decoding="async"
                              />
                              <span className="player-queue-thumb-play" aria-hidden="true">
                                {isCurrent && state.isPlaying ? <Pause size={11} /> : <Play size={11} />}
                              </span>
                            </div>
                            <div className="player-queue-item-text">
                              <span className="player-queue-item-title">{song.title}</span>
                              <span className="player-queue-item-meta">
                                {formatCreatorName(song.creator)}
                              </span>
                            </div>
                          </button>
                          <div className="player-queue-item-actions">
                            <button
                              type="button"
                              className="player-queue-remove-btn"
                              onClick={() => store.removeFromQueue(idx)}
                              aria-label="Remove"
                            >
                              <X size={11} />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="player-volume-wrap">
            <Slider
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(v) => {
                setMuted(false);
                setVolume(v);
              }}
              label="VOL"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

