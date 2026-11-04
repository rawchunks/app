import React, { useEffect, useMemo, useState } from 'react';
import {
  Play,
  Pause,
  MessageSquare,
  Send,
  Headphones,
  Clock,
  Trash2,
  User,
} from 'lucide-react';
import { Waveform } from '../waveform';
import { Versions } from './versions';
import { Licenses } from './licenses';
import { LikeButton, PlaylistAdder } from './row';
import { formatDuration, normalizeTags } from './card';
import { Badge } from '../badge';
import { store } from '../../lib/store';
import { useSelectedUserAddress } from '../../hooks/use-address';
import { useSongComments } from '../../hooks/use-social';
import { navigateToCreator } from '../../lib/routes';
import type { Comment, Song } from '../../lib/schema';

export interface TimelineProps {
  song: Song;
  versions?: Song[];
  isPlayingThis: boolean;
  onPlayToggle: () => void;
  onSelectVersion?: (version: Song) => void;
  onSelectGenre?: (genre: string) => void;
  onShare?: (song: Song) => void;
}

const formatShortAddr = (addr?: string | null): string => {
  if (!addr) return 'ANON';
  return addr.startsWith('0x')
    ? `${addr.slice(0, 6)}…${addr.slice(-4)}`
    : `${addr.slice(0, 4)}…${addr.slice(-4)}`;
};

export const Timeline: React.FC<TimelineProps> = ({
  song,
  versions,
  isPlayingThis,
  onPlayToggle,
  onSelectVersion,
  onSelectGenre,
  onShare,
}) => {
  const { readAddress } = useSelectedUserAddress();
  const { comments, addComment, isPosting, deleteComment } = useSongComments(
    song.id,
    readAddress
  );

  const [imgError, setImgError] = useState(false);
  const [localRatio, setLocalRatio] = useState(0);
  const [lockedTimestampSec, setLockedTimestampSec] = useState<number | null>(null);
  const [commentBody, setCommentBody] = useState('');
  const [activeComment, setActiveComment] = useState<Comment | null>(null);
  const [threadOpen, setThreadOpen] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [song.id, song.image]);

  // Subscribe to global store playhead when this song is the active song
  useEffect(() => {
    const sync = () => {
      const s = store.getState();
      if (s.activeSong?.id === song.id) {
        const dur = s.duration > 0 ? s.duration : song.duration || 60;
        const ratio = dur > 0 ? Math.max(0, Math.min(1, s.playhead / dur)) : 0;
        setLocalRatio(ratio);
      }
    };
    sync();
    return store.subscribe(sync);
  }, [song.id, song.duration]);

  const effectiveDuration = useMemo(() => {
    const s = store.getState();
    if (s.activeSong?.id === song.id && s.duration > 0) return s.duration;
    return song.duration && song.duration > 0 ? song.duration : 120;
  }, [song.id, song.duration, localRatio]);

  const currentSec = useMemo(
    () => Math.max(0, Math.min(effectiveDuration, localRatio * effectiveDuration)),
    [localRatio, effectiveDuration]
  );

  // Auto-surface timed comment near current playhead during playback
  const liveTimedComment = useMemo(() => {
    if (activeComment) return activeComment;
    if (!isPlayingThis || comments.length === 0) return null;
    let best: Comment | null = null;
    let bestDist = 1.8;
    for (const c of comments) {
      const dist = Math.abs(c.timestamp_sec - currentSec);
      if (dist <= bestDist) {
        best = c;
        bestDist = dist;
      }
    }
    return best;
  }, [activeComment, isPlayingThis, comments, currentSec]);

  const targetCommentSec =
    lockedTimestampSec !== null ? lockedTimestampSec : Number(currentSec.toFixed(1));

  const handleWaveformSeek = (ratio: number) => {
    const clamped = Math.max(0, Math.min(1, ratio));
    setLocalRatio(clamped);
    const targetSec = Number((clamped * effectiveDuration).toFixed(1));
    setLockedTimestampSec(targetSec);

    const s = store.getState();
    if (s.activeSong?.id !== song.id) {
      onPlayToggle();
      setTimeout(() => {
        store.setPlayhead(targetSec);
      }, 60);
    } else {
      store.setPlayhead(targetSec);
      if (!s.isPlaying) {
        void store.setPlaying(true);
      }
    }
  };

  const handleJumpToTimestamp = (sec: number) => {
    const ratio = effectiveDuration > 0 ? Math.max(0, Math.min(1, sec / effectiveDuration)) : 0;
    handleWaveformSeek(ratio);
  };

  const handleSubmitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = commentBody.trim();
    if (!trimmed) return;
    try {
      const created = await addComment({
        timestampSec: targetCommentSec,
        body: trimmed,
      });
      setCommentBody('');
      setLockedTimestampSec(null);
      setActiveComment(created);
    } catch {
      // Handled by hook toast
    }
  };

  const tags = normalizeTags(song.tags).slice(0, 3);
  const totalComments = Math.max(comments.length, song.comments_count ?? 0);

  return (
    <article
      className={`creator-timeline-card ${isPlayingThis ? 'is-playing' : ''}`}
      data-guide-entity={song.id}
    >
      {/* Top Track Identity + Actions Bar */}
      <div className="timeline-header">
        <button
          type="button"
          className={`timeline-cover-btn ${isPlayingThis ? 'active' : ''}`}
          data-guide="card.stream"
          onClick={onPlayToggle}
          aria-label={isPlayingThis ? `Pause ${song.title}` : `Play ${song.title}`}
        >
          {!imgError && song.image && song.image.trim() !== '' ? (
            <img
              src={song.image}
              alt={song.title}
              className="timeline-cover-img"
              loading="lazy"
              onError={() => setImgError(true)}
            />
          ) : (
            <div className="timeline-cover-fallback">
              <img src="/branding/mark.svg" alt="" className="timeline-fallback-mark" />
            </div>
          )}
          <span className="timeline-play-circle">
            {isPlayingThis ? <Pause size={15} /> : <Play size={15} className="market-play-icon-offset" />}
          </span>
        </button>

        <div className="timeline-title-cluster">
          <div className="timeline-title-row">
            <h3 className="timeline-song-title">{song.title}</h3>
            {versions && versions.length > 1 && onSelectVersion && (
              <div className="timeline-versions-slot">
                <Versions songs={versions} selected={song.id} onSelect={onSelectVersion} />
              </div>
            )}
          </div>
          <div className="timeline-meta-row">
            <span className="timeline-time-readout">
              {formatDuration(currentSec)} / {formatDuration(effectiveDuration)}
            </span>
            {typeof song.plays === 'number' && song.plays > 0 && (
              <span className="timeline-stat-pill" title={`${song.plays} streams`}>
                <Headphones size={11} />
                <span>{song.plays}</span>
              </span>
            )}
            {tags.map((t) => (
              <Badge
                key={t}
                variant="muted"
                clickable={Boolean(onSelectGenre)}
                onClick={onSelectGenre ? () => onSelectGenre(t) : undefined}
              >
                {t}
              </Badge>
            ))}
          </div>
        </div>

        <div className="timeline-actions-cluster">
          <LikeButton songId={song.id} likesCount={song.likes} showCount />
          <PlaylistAdder song={song} onShare={onShare} />
          <button
            type="button"
            className={`timeline-thread-toggle ${threadOpen ? 'active' : ''}`}
            onClick={() => setThreadOpen((prev) => !prev)}
            title="Toggle timed comments list"
          >
            <MessageSquare size={12} />
            <span>{totalComments}</span>
          </button>
          <Licenses key={song.id} song={song} placement="market" compact />
        </div>
      </div>

      {/* Base Published Song Waveform + Timed Comment Marker Rail */}
      <div className="timeline-waveform-stage">
        <Waveform
          audioUrl={song.url}
          interactive={false}
          showSelection={false}
          height={54}
          progress={localRatio}
          onSeek={handleWaveformSeek}
          className="timeline-base-waveform"
        />

        {/* SoundCloud-style Timed Comment Pins along bottom edge of waveform */}
        <div className="timeline-pins-rail">
          {comments.map((c) => {
            const pct =
              effectiveDuration > 0
                ? Math.max(1, Math.min(99, (c.timestamp_sec / effectiveDuration) * 100))
                : 0;
            const isHighlighted = liveTimedComment?.id === c.id;
            const authorLabel = c.author_nickname?.trim() || formatShortAddr(c.author);
            return (
              <button
                key={c.id}
                type="button"
                className={`timeline-comment-pin ${isHighlighted ? 'active' : ''}`}
                style={{ left: `${pct}%` }}
                onMouseEnter={() => setActiveComment(c)}
                onMouseLeave={() => setActiveComment((prev) => (prev?.id === c.id ? null : prev))}
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveComment(c);
                  handleJumpToTimestamp(c.timestamp_sec);
                }}
                aria-label={`Comment at ${formatDuration(c.timestamp_sec)} by ${authorLabel}`}
              >
                {c.author_avatar ? (
                  <img src={c.author_avatar} alt="" className="timeline-pin-avatar" />
                ) : (
                  <span className="timeline-pin-dot" />
                )}
              </button>
            );
          })}
        </div>

        {/* Live / Hovered Timed Comment Callout Banner */}
        {liveTimedComment && (
          <div className="timeline-live-comment-banner">
            <button
              type="button"
              className="timeline-comment-time-badge"
              onClick={() => handleJumpToTimestamp(liveTimedComment.timestamp_sec)}
            >
              @{formatDuration(liveTimedComment.timestamp_sec)}
            </button>
            <button
              type="button"
              className="timeline-comment-author"
              onClick={() => navigateToCreator(liveTimedComment.author)}
            >
              {liveTimedComment.author_nickname?.trim() || formatShortAddr(liveTimedComment.author)}
            </button>
            <span className="timeline-comment-body">{liveTimedComment.body}</span>
          </div>
        )}
      </div>

      {/* Auto-Timestamped Comment Composer Bar */}
      <form className="timeline-composer" onSubmit={handleSubmitComment}>
        <button
          type="button"
          className={`timeline-timestamp-lock ${lockedTimestampSec !== null ? 'locked' : ''}`}
          onClick={() =>
            setLockedTimestampSec((prev) =>
              prev !== null ? null : Number(currentSec.toFixed(1))
            )
          }
          title="Lock or unlock comment timestamp"
        >
          <Clock size={11} />
          <span>@{formatDuration(targetCommentSec)}</span>
        </button>

        <input
          type="text"
          className="timeline-composer-input"
          placeholder={`Comment at @${formatDuration(targetCommentSec)}…`}
          value={commentBody}
          onFocus={() => {
            if (lockedTimestampSec === null) {
              setLockedTimestampSec(Number(currentSec.toFixed(1)));
            }
          }}
          onChange={(e) => setCommentBody(e.target.value)}
          maxLength={280}
        />

        <button
          type="submit"
          className="timeline-composer-send"
          disabled={isPosting || !commentBody.trim()}
          aria-label="Post timed comment"
        >
          <Send size={12} />
        </button>
      </form>

      {/* Expandable Chronological Comment Thread */}
      {threadOpen && (
        <div className="timeline-thread-drawer">
          {comments.length === 0 ? (
            <div className="timeline-thread-empty">
              Tap anywhere on the waveform to drop the first timed note.
            </div>
          ) : (
            comments.map((c) => {
              const authorLabel = c.author_nickname?.trim() || formatShortAddr(c.author);
              const isMine =
                Boolean(readAddress) &&
                c.author.trim().toLowerCase() === readAddress!.trim().toLowerCase();
              return (
                <div key={c.id} className="timeline-thread-item">
                  <button
                    type="button"
                    className="timeline-comment-time-badge"
                    onClick={() => handleJumpToTimestamp(c.timestamp_sec)}
                  >
                    @{formatDuration(c.timestamp_sec)}
                  </button>
                  <button
                    type="button"
                    className="timeline-thread-author"
                    onClick={() => navigateToCreator(c.author)}
                  >
                    {c.author_avatar ? (
                      <img src={c.author_avatar} alt="" className="timeline-thread-avatar" />
                    ) : (
                      <User size={10} />
                    )}
                    <span>{authorLabel}</span>
                  </button>
                  <span className="timeline-thread-text">{c.body}</span>
                  {isMine && (
                    <button
                      type="button"
                      className="timeline-thread-delete"
                      onClick={() => {
                        setActiveComment((prev) => (prev?.id === c.id ? null : prev));
                        void deleteComment(c.id);
                      }}
                      aria-label="Delete comment"
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </article>
  );
};
