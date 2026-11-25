import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Play,
  Pause,
  GripVertical,
  Trash2,
  X,
  ListPlus,
  Radio,
  Lock,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { store, type State } from '../lib/store';
import { createPlaylistApi } from '../hooks/use-playlists';
import { useSelectedUserAddress } from '../hooks/use-address';
import { openGate } from '../lib/gate';
import { Tooltip } from './daw/Tooltip';
import { formatDuration } from './songs/card';
import type { Song } from '../lib/schema';

export interface QueueProps {
  state: State;
  variant?: 'popover' | 'panel';
  pageSize?: number;
  onClose?: () => void;
  onSelectSong?: (song: Song) => void;
}

export const Queue: React.FC<QueueProps> = ({
  state,
  variant = 'popover',
  pageSize = 6,
  onClose,
  onSelectSong,
}) => {
  const queryClient = useQueryClient();
  const { readAddress } = useSelectedUserAddress();

  const [savingPlaylist, setSavingPlaylist] = useState(false);
  const [playlistTitle, setPlaylistTitle] = useState('');
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);
  const [page, setPage] = useState(0);

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const dragIndexRef = useRef<number | null>(null);
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);
  const pointerCleanupRef = useRef<(() => void) | null>(null);

  const isPrivateContext = Boolean(
    state.playbackContext?.isPrivate || (state.activeSong && !state.activeSong.public),
  );
  const originLabel = state.playbackContext?.label || (isPrivateContext ? 'Private' : 'Market');
  const upcomingCount = state.userQueue.length + state.contextQueue.length;

  // Build flat upcoming list with metadata so drag-reorder maps directly to store queue indices
  const hasActiveAtTop = Boolean(state.activeSong && state.queue[0]?.id === state.activeSong.id);
  const indexOffset = hasActiveAtTop ? 1 : 0;

  const upcomingItems = useMemo(
    () => [
      ...state.userQueue.map((song, i) => ({
        song,
        queueIdx: indexOffset + i,
        section: 'user' as const,
      })),
      ...state.contextQueue.map((song, i) => ({
        song,
        queueIdx: indexOffset + state.userQueue.length + i,
        section: 'context' as const,
      })),
    ],
    [state.userQueue, state.contextQueue, indexOffset],
  );

  const totalPages = Math.max(1, Math.ceil(upcomingItems.length / pageSize));
  useEffect(() => {
    setPage((prev) => Math.min(prev, Math.max(0, totalPages - 1)));
  }, [totalPages]);

  useEffect(() => {
    return () => {
      pointerCleanupRef.current?.();
      pointerCleanupRef.current = null;
    };
  }, []);

  const visibleUpcoming = useMemo(() => {
    const start = page * pageSize;
    return upcomingItems.slice(start, start + pageSize);
  }, [upcomingItems, page, pageSize]);

  const handleGripPointerDown = (e: React.PointerEvent, startQueueIdx: number, visibleSlot: number) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    e.stopPropagation();

    dragIndexRef.current = startQueueIdx;
    setDragIndex(startQueueIdx);

    const slotStartOffset = page * pageSize;
    const handleMove = (moveEvent: PointerEvent) => {
      const currentQueueIdx = dragIndexRef.current;
      if (currentQueueIdx === null) return;
      const y = moveEvent.clientY;
      for (let i = 0; i < visibleUpcoming.length; i++) {
        const targetQueueIdx = visibleUpcoming[i].queueIdx;
        if (targetQueueIdx === currentQueueIdx) continue;
        const rowEl = rowRefs.current[i];
        if (!rowEl) continue;
        const rect = rowEl.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (
          (targetQueueIdx < currentQueueIdx && y < midY) ||
          (targetQueueIdx > currentQueueIdx && y > midY)
        ) {
          store.moveQueueItem(currentQueueIdx, targetQueueIdx);
          dragIndexRef.current = targetQueueIdx;
          setDragIndex(targetQueueIdx);
          break;
        }
      }
      void slotStartOffset;
      void visibleSlot;
    };

    const handleUp = () => {
      dragIndexRef.current = null;
      setDragIndex(null);
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
      pointerCleanupRef.current = null;
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    pointerCleanupRef.current = handleUp;
  };

  const handleSaveAsPlaylist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!readAddress) {
      openGate();
      return;
    }
    const cleanTitle = playlistTitle.trim();
    if (!cleanTitle || state.queue.length === 0) return;

    setCreatingPlaylist(true);
    try {
      const songIds = state.queue.map((s) => s.id);
      const cover = state.queue.find((s) => s.image && s.image.trim())?.image || '';
      await createPlaylistApi(
        {
          title: cleanTitle,
          creator: readAddress,
          song_ids: songIds,
          cover,
          public: !isPrivateContext,
        },
        readAddress,
      );
      await queryClient.invalidateQueries({ queryKey: ['playlists'] });
      toast.success(`Saved playlist "${cleanTitle}" (${songIds.length} tracks)`);
      setPlaylistTitle('');
      setSavingPlaylist(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save playlist');
    } finally {
      setCreatingPlaylist(false);
    }
  };

  const handlePlayItem = (queueIdx: number, song: Song) => {
    void store.playQueueIndex(queueIdx);
    onSelectSong?.(song);
  };

  let renderedUserHeader = false;
  let renderedContextHeader = false;

  return (
    <div className={`queue-view is-${variant}`} role="region" aria-label="Playback queue">
      <div className="queue-head">
        <div className="queue-origin">
          {isPrivateContext && (
            <Tooltip title="Private Context" description="Never auto-advances into paid public tracks">
              <span className="queue-privacy-badge">
                <Lock size={10} />
              </span>
            </Tooltip>
          )}
          <span className="queue-origin-label" title={originLabel}>
            {originLabel}
          </span>
          <span className="queue-count-pill">{upcomingCount}</span>
        </div>

        <div className="queue-head-actions">
          <Tooltip
            title={
              isPrivateContext
                ? 'Radio locked in private lists'
                : state.autoplay
                  ? 'Autoplay Radio: ON'
                  : 'Autoplay Radio: OFF'
            }
            description={
              isPrivateContext
                ? 'Private drafts & Studio variations never auto-play paid Market songs'
                : 'Continue with public Market tracks after this list ends'
            }
          >
            <button
              type="button"
              className={`queue-icon-btn ${!isPrivateContext && state.autoplay ? 'active' : ''}`}
              disabled={isPrivateContext}
              onClick={() => store.toggleAutoplay()}
              aria-label="Toggle autoplay radio"
              aria-pressed={!isPrivateContext && state.autoplay}
            >
              <Radio size={12} />
            </button>
          </Tooltip>

          {state.queue.length > 0 && (
            <Tooltip title="Save as Playlist" description="Save current queue as a playlist">
              <button
                type="button"
                className={`queue-icon-btn ${savingPlaylist ? 'active' : ''}`}
                onClick={() => setSavingPlaylist((p) => !p)}
                aria-label="Save queue as playlist"
              >
                <ListPlus size={12} />
              </button>
            </Tooltip>
          )}

          {upcomingCount > 0 && (
            <Tooltip title="Clear Upcoming" description="Remove all upcoming tracks">
              <button
                type="button"
                className="queue-icon-btn danger"
                onClick={() => store.clearQueue()}
                aria-label="Clear upcoming queue"
              >
                <Trash2 size={12} />
              </button>
            </Tooltip>
          )}

          {onClose && (
            <button
              type="button"
              className="queue-icon-btn"
              onClick={onClose}
              aria-label="Close queue"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {savingPlaylist && (
        <form className="player-save-playlist-form" onSubmit={handleSaveAsPlaylist}>
          <input
            type="text"
            className="player-save-playlist-input"
            placeholder="Playlist name..."
            value={playlistTitle}
            onChange={(e) => setPlaylistTitle(e.target.value)}
            maxLength={64}
            autoFocus
          />
          <button
            type="submit"
            className="player-save-playlist-submit"
            disabled={creatingPlaylist || !playlistTitle.trim()}
          >
            {creatingPlaylist ? '...' : 'SAVE'}
          </button>
        </form>
      )}

      {state.activeSong && (
        <div className="queue-now-strip">
          <div className="queue-section-row">
            <span className="queue-section-label">NOW PLAYING</span>
            {!state.activeSong.public && (
              <span className="queue-tag-private">PRIVATE</span>
            )}
          </div>
          <div className="player-queue-item current">
            <button
              type="button"
              className="player-queue-item-main"
              onClick={() => void store.setPlaying(!state.isPlaying)}
            >
              <div className="player-queue-thumb">
                {state.activeSong.image ? (
                  <img src={state.activeSong.image} alt="" />
                ) : (
                  <span>▶</span>
                )}
                <span className="player-queue-thumb-play">
                  {state.isPlaying ? <Pause size={10} /> : <Play size={10} />}
                </span>
              </div>
              <div className="player-queue-item-text">
                <span className="player-queue-item-title">{state.activeSong.title}</span>
                <span className="player-queue-item-meta">
                  {state.activeSong.duration ? formatDuration(state.activeSong.duration) : '—'}
                </span>
              </div>
            </button>
          </div>
        </div>
      )}

      <div className="queue-items-body">
        {upcomingItems.length === 0 ? (
          <div className="player-queue-empty">
            {state.activeSong
              ? isPrivateContext
                ? 'End of private list.'
                : 'No upcoming tracks. Queue songs from Market or enable Radio.'
              : 'No tracks queued yet.'}
          </div>
        ) : (
          visibleUpcoming.map((item, slotIdx) => {
            const showUserHead = item.section === 'user' && !renderedUserHeader;
            if (showUserHead) renderedUserHeader = true;
            const showContextHead = item.section === 'context' && !renderedContextHeader;
            if (showContextHead) renderedContextHeader = true;
            const isDragging = dragIndex === item.queueIdx;
            const isCreator = store.isCreatorOfSong(item.song);

            return (
              <React.Fragment key={`${item.song.id}-${item.queueIdx}`}>
                {showUserHead && (
                  <div className="queue-section-row">
                    <span className="queue-section-label is-accent">NEXT IN QUEUE</span>
                    <button
                      type="button"
                      className="queue-section-clear"
                      onClick={() => store.clearUserQueue()}
                    >
                      CLEAR
                    </button>
                  </div>
                )}
                {showContextHead && (
                  <div className="queue-section-row">
                    <span className="queue-section-label">FROM {originLabel.toUpperCase()}</span>
                  </div>
                )}
                <div
                  ref={(el) => {
                    rowRefs.current[slotIdx] = el;
                  }}
                  className={`player-queue-item ${isDragging ? 'dragging' : ''}`}
                >
                  <span
                    className="player-queue-grip"
                    onPointerDown={(e) => handleGripPointerDown(e, item.queueIdx, slotIdx)}
                    role="button"
                    tabIndex={0}
                    aria-label={`Reorder ${item.song.title}`}
                  >
                    <GripVertical size={12} />
                  </span>

                  <button
                    type="button"
                    className="player-queue-item-main"
                    onClick={() => handlePlayItem(item.queueIdx, item.song)}
                  >
                    <div className="player-queue-thumb">
                      {item.song.image ? (
                        <img src={item.song.image} alt="" loading="lazy" />
                      ) : (
                        <span>{item.queueIdx}</span>
                      )}
                      <span className="player-queue-thumb-play">
                        <Play size={10} />
                      </span>
                    </div>
                    <div className="player-queue-item-text">
                      <span className="player-queue-item-title">{item.song.title}</span>
                      <span className="player-queue-item-meta">
                        {item.song.duration ? formatDuration(item.song.duration) : '—'}
                        {!item.song.public
                          ? ' · Private'
                          : isCreator
                            ? ' · Yours'
                            : item.song.stream_price > 0
                              ? ` · $${item.song.stream_price.toFixed(2)}/m`
                              : ''}
                      </span>
                    </div>
                  </button>

                  <button
                    type="button"
                    className="player-queue-remove-btn"
                    onClick={() => store.removeFromQueue(item.queueIdx)}
                    aria-label={`Remove ${item.song.title}`}
                  >
                    <X size={11} />
                  </button>
                </div>
              </React.Fragment>
            );
          })
        )}
      </div>

      {totalPages > 1 && (
        <div className="queue-pager">
          <button
            type="button"
            className="queue-icon-btn"
            disabled={page <= 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            aria-label="Previous queue page"
          >
            <ChevronLeft size={13} />
          </button>
          <span className="queue-pager-info">
            {page + 1} / {totalPages}
          </span>
          <button
            type="button"
            className="queue-icon-btn"
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            aria-label="Next queue page"
          >
            <ChevronRight size={13} />
          </button>
        </div>
      )}
    </div>
  );
};
