import React, { useEffect, useRef, useState } from 'react';
import { Button } from './button';
import { Slider } from './slider';
import { Tooltip } from './daw/Tooltip';
import { Queue } from './queue';
import { store, State, RepeatMode, SleepTimerMode } from '../lib/store';
import { audio } from '../lib/audio';
import { useDismiss } from '../hooks/use-dismiss';
import { useProfile } from '../hooks/use-profile';
import { readCachedProfile } from '../lib/cache';
import { navigateToCreator, navigateToSong } from '../lib/routes';
import { LikeButton, PlaylistAdder } from './songs/row';
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
  Check,
  Timer,
  ArrowLeft,
  Volume2,
  VolumeX,
} from 'lucide-react';

export interface Props {
  className?: string;
  headless?: boolean;
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
  const safe = Math.max(0, Math.floor(secs || 0));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
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
            `${(s.selection.start / s.duration) * 100}%`,
          );
          selectionRef.current.style.setProperty(
            '--selection-width',
            `${((s.selection.end - s.selection.start) / s.duration) * 100}%`,
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
    return {
      playheadSec: Math.floor(s.playhead),
      durationSec: Math.floor(s.duration),
      hasDuration: s.duration > 0,
    };
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
          : { playheadSec, durationSec, hasDuration },
      );
    });
  }, []);

  return (
    <span className="player-time-readout">
      {formatTime(times.playheadSec)} / {times.hasDuration ? formatTime(times.durationSec) : '--:--'}
    </span>
  );
};

export const Player: React.FC<Props> = ({ className = '', headless = false }) => {
  const [state, setState] = useState<State>(store.getState());
  const [volume, setVolume] = useState(0.85);
  const [muted, setMuted] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [sleepOpen, setSleepOpen] = useState(false);
  const [sleepNowMs, setSleepNowMs] = useState(() => Date.now());
  const [isTitleOverflowing, setIsTitleOverflowing] = useState(false);

  const queueRef = useRef<HTMLDivElement>(null);
  const titleViewportRef = useRef<HTMLDivElement>(null);
  const titleMeasureRef = useRef<HTMLSpanElement>(null);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const activeCreatorProfile = useProfile(state.activeSong?.creator);

  useDismiss(
    queueOpen && !headless,
    () => {
      setQueueOpen(false);
      setSleepOpen(false);
    },
    queueRef,
  );

  useEffect(() => {
    if (headless) {
      setQueueOpen(false);
      setSleepOpen(false);
    }
  }, [headless]);

  useEffect(() => {
    if (!sleepOpen || !state.sleepTimer) return;
    setSleepNowMs(Date.now());
    const id = window.setInterval(() => {
      setSleepNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(id);
  }, [sleepOpen, state.sleepTimer]);

  useEffect(() => {
    return store.subscribe((next) => {
      setState((prev) => {
        if (
          prev.activeSong === next.activeSong &&
          prev.isPlaying === next.isPlaying &&
          prev.duration === next.duration &&
          prev.queue === next.queue &&
          prev.userQueue === next.userQueue &&
          prev.contextQueue === next.contextQueue &&
          prev.queueIndex === next.queueIndex &&
          prev.repeatMode === next.repeatMode &&
          prev.shuffle === next.shuffle &&
          prev.autoplay === next.autoplay &&
          prev.activePlaylistId === next.activePlaylistId &&
          prev.activeContextId === next.activeContextId &&
          prev.playbackContext === next.playbackContext &&
          prev.sleepTimer === next.sleepTimer &&
          prev.sleepTimerPrompt === next.sleepTimerPrompt
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

  useEffect(() => {
    if (headless) return;
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
  }, [state.activeSong?.title, headless]);

  useEffect(() => {
    audio.setVolume(muted ? 0 : volume);
  }, [volume, muted]);

  // MediaSession API for lock screen & OS media keys (stays active even when headless on /song)
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const song = state.activeSong;
    if (song && typeof MediaMetadata !== 'undefined') {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: song.title,
        artist: activeCreatorProfile.nickname?.trim() || song.creator || 'Rawchunks',
        album: song.album_title || 'RAWCHUNKS',
        artwork: song.image ? [{ src: song.image, sizes: '512x512', type: 'image/png' }] : [],
      });
    }
    navigator.mediaSession.playbackState = state.isPlaying ? 'playing' : 'paused';

    const safeSetHandler = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch { }
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
  }, [state.activeSong, state.isPlaying, activeCreatorProfile.nickname]);

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
          void store.setPlaying(!store.getState().isPlaying);
        }
      } else if (e.shiftKey && e.key === 'ArrowRight') {
        e.preventDefault();
        void store.playNextTrack();
      } else if (e.shiftKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        void store.playPreviousTrack();
      } else if ((e.key === 'm' || e.key === 'M') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        setMuted((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (headless) return null;

  const handlePlayPause = () => {
    void store.setPlaying(!state.isPlaying);
  };

  const cycleRepeatMode = () => {
    const next: RepeatMode =
      state.repeatMode === 'off' ? 'all' : state.repeatMode === 'all' ? 'one' : 'off';
    store.setRepeatMode(next);
  };

  const currentSong = state.activeSong;
  const titleText = currentSong?.title || 'STANDBY';
  const creatorText = currentSong
    ? formatCreatorName(currentSong.creator, activeCreatorProfile.nickname)
    : 'Ready to play';

  const openStage = () => {
    if (!currentSong) return;
    navigateToSong(
      activeCreatorProfile.nickname?.trim() || currentSong.creator,
      currentSong.title || currentSong.id,
      currentSong.id,
    );
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    swipeStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start || !currentSong || e.changedTouches.length === 0) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) > 52 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      if (dx < 0) void store.playNextTrack();
      else void store.playPreviousTrack();
    }
  };

  const endOfQueueLabel = state.activePlaylistId ? 'End of playlist' : 'End of queue';
  const sleepPresets: Array<{ mode: SleepTimerMode; label: string }> = [
    { mode: '5', label: '5 minutes' },
    { mode: '15', label: '15 minutes' },
    { mode: '30', label: '30 minutes' },
    { mode: 'track', label: 'End of track' },
    { mode: 'queue', label: endOfQueueLabel },
  ];

  const sleepRemainingText = (() => {
    const activeTimer = state.sleepTimer;
    if (!activeTimer) return null;
    if (activeTimer.endsAtMs) {
      const remainingMs = Math.max(0, activeTimer.endsAtMs - sleepNowMs);
      const remainingMin = Math.max(1, Math.ceil(remainingMs / 60000));
      return `${remainingMin} ${remainingMin === 1 ? 'minute' : 'minutes'} left`;
    }
    if (activeTimer.mode === 'track') {
      const liveState = store.getState();
      if (liveState.duration > 0) {
        const remSec = Math.max(0, liveState.duration - liveState.playhead);
        const remMin = Math.max(1, Math.ceil(remSec / 60));
        return `${remMin} ${remMin === 1 ? 'minute' : 'minutes'} left (End of track)`;
      }
      return 'End of track left';
    }
    return `${endOfQueueLabel} left`;
  })();

  const upcomingCount = state.userQueue.length + state.contextQueue.length;

  return (
    <div
      className={`app-player panel ${className}`.trim()}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {state.sleepTimerPrompt && !state.sleepTimer && (
        <div
          className="player-sleep-reactivate-prompt"
          role="dialog"
          aria-label="Reactivate Sleep timer?"
        >
          <div className="player-sleep-reactivate-info">
            <Timer size={14} className="player-sleep-reactivate-icon" />
            <div className="player-sleep-reactivate-text">
              <span className="player-sleep-reactivate-title">Reactivate Sleep timer?</span>
              <span className="player-sleep-reactivate-sub">
                Resume {state.sleepTimerPrompt.label.toLowerCase()} timer
              </span>
            </div>
          </div>
          <div className="player-sleep-reactivate-actions">
            <button
              type="button"
              className="player-sleep-reactivate-btn primary"
              onClick={() => store.reactivateSleepTimer()}
            >
              REACTIVATE
            </button>
            <button
              type="button"
              className="player-sleep-reactivate-btn ghost"
              onClick={() => store.dismissSleepTimerPrompt()}
              aria-label="Dismiss sleep timer prompt"
            >
              <X size={12} />
            </button>
          </div>
        </div>
      )}

      <PlayerScrubber />

      <div className="player-transport-row">
        <div className="player-track-info">
          <button
            type="button"
            className="player-track-avatar player-track-stage-trigger"
            disabled={!currentSong}
            onClick={openStage}
            title={currentSong ? `Open ${currentSong.title}` : undefined}
            aria-label={currentSong ? `Open ${currentSong.title} stage` : 'No active track'}
          >
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
          </button>
          <div className="player-track-text">
            <div
              className={`player-track-title-viewport ${currentSong ? 'is-clickable' : ''}`}
              ref={titleViewportRef}
              role={currentSong ? 'button' : undefined}
              tabIndex={currentSong ? 0 : undefined}
              onClick={openStage}
              onKeyDown={(e) => {
                if (!currentSong) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openStage();
                }
              }}
              title={currentSong ? `Open ${currentSong.title}` : undefined}
            >
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
            {currentSong?.creator ? (
              <button
                type="button"
                className="player-track-meta player-track-meta-link"
                onClick={() => navigateToCreator(currentSong.creator)}
                title={`Open ${creatorText}`}
              >
                {creatorText}
              </button>
            ) : (
              <div className="player-track-meta">{creatorText}</div>
            )}
          </div>
          {currentSong && (
            <div className="player-track-social">
              <LikeButton songId={currentSong.id} likesCount={currentSong.likes} />
              <PlaylistAdder song={currentSong} />
            </div>
          )}
        </div>

        <div className="player-controls">
          <Tooltip title="Previous" description="Shift + ←" position="top">
            <Button
              size="xs"
              variant="ghost"
              className="player-skip-btn"
              aria-label="Previous"
              disabled={state.queue.length === 0 && !currentSong}
              onClick={() => void store.playPreviousTrack()}
            >
              <SkipBack size={13} />
            </Button>
          </Tooltip>

          <Tooltip title={state.isPlaying ? 'Pause' : 'Play'} description="Space" position="top">
            <Button
              size="sm"
              variant={state.isPlaying ? 'secondary' : 'primary'}
              onClick={handlePlayPause}
              className="player-play-btn"
              disabled={!currentSong}
              aria-label={state.isPlaying ? 'Pause' : 'Play'}
            >
              {state.isPlaying ? <Pause size={14} /> : <Play size={14} />}
            </Button>
          </Tooltip>

          <Tooltip title="Next" description="Shift + →" position="top">
            <Button
              size="xs"
              variant="ghost"
              className="player-skip-btn"
              aria-label="Next"
              disabled={state.queue.length === 0 && !currentSong}
              onClick={() => void store.playNextTrack()}
            >
              <SkipForward size={13} />
            </Button>
          </Tooltip>

          <PlayerTimeReadout />
        </div>

        <div className="player-right-cluster" ref={queueRef}>
          <div className="player-queue-trigger-wrap">
            <Tooltip title="Queue" description={upcomingCount > 0 ? `${upcomingCount} upcoming` : 'Manage queue & playback modes'} position="top">
              <Button
                size="xs"
                variant={queueOpen ? 'primary' : 'ghost'}
                className={`player-queue-btn ${queueOpen ? 'active' : ''}`}
                onClick={() => {
                  setQueueOpen((prev) => {
                    const next = !prev;
                    if (!next) setSleepOpen(false);
                    return next;
                  });
                }}
                aria-label="Queue"
                aria-expanded={queueOpen}
              >
                <ListMusic size={13} />
                {upcomingCount > 0 && <span className="player-queue-count">{upcomingCount}</span>}
              </Button>
            </Tooltip>

            {queueOpen && (
              <div
                className="player-queue-drawer"
                role="dialog"
                aria-label={sleepOpen ? 'Sleep Timer' : 'Queue'}
              >
                {sleepOpen ? (
                  <>
                    <div className="player-queue-header">
                      <button
                        type="button"
                        className="player-sleep-back-btn"
                        onClick={() => setSleepOpen(false)}
                        aria-label="Back to Queue"
                      >
                        <ArrowLeft size={12} />
                        <span className="player-queue-title">SLEEP TIMER</span>
                      </button>
                      {state.sleepTimer && sleepRemainingText && (
                        <div className="player-queue-sleep-status">
                          <span className="player-sleep-remaining-badge">{sleepRemainingText}</span>
                          <button
                            type="button"
                            className="player-queue-sleep-off-btn"
                            onClick={() => {
                              store.setSleepTimer(null);
                              setSleepOpen(false);
                            }}
                          >
                            OFF
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="player-sleep-step-body" role="region" aria-label="Sleep Timer Options">
                      {sleepPresets.map((opt) => {
                        const isSelected = state.sleepTimer?.mode === opt.mode;
                        return (
                          <button
                            key={opt.mode}
                            type="button"
                            className={`player-queue-sleep-pill player-sleep-step-option ${isSelected ? 'active' : ''}`}
                            onClick={() => {
                              store.setSleepTimer(opt.mode);
                              setSleepOpen(false);
                            }}
                          >
                            <span>{opt.label}</span>
                            {isSelected && <Check size={12} />}
                          </button>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="player-queue-modebar">
                      <Tooltip title={state.shuffle ? 'Shuffle: ON' : 'Shuffle: OFF'} position="top">
                        <button
                          type="button"
                          className={`player-mode-btn ${state.shuffle ? 'active' : ''}`}
                          onClick={() => store.setShuffle(!state.shuffle)}
                          aria-label="Shuffle"
                        >
                          <Shuffle size={12} />
                        </button>
                      </Tooltip>

                      <Tooltip
                        title={
                          state.repeatMode === 'one'
                            ? 'Repeat One'
                            : state.repeatMode === 'all'
                              ? 'Repeat Context'
                              : 'Repeat Off'
                        }
                        position="top"
                      >
                        <button
                          type="button"
                          className={`player-mode-btn ${state.repeatMode !== 'off' ? 'active' : ''}`}
                          onClick={cycleRepeatMode}
                          aria-label="Repeat"
                        >
                          {state.repeatMode === 'one' ? <Repeat1 size={12} /> : <Repeat size={12} />}
                        </button>
                      </Tooltip>

                      <Tooltip title={state.sleepTimer ? `Sleep: ${state.sleepTimer.label}` : 'Sleep Timer'} position="top">
                        <button
                          type="button"
                          className={`player-mode-btn ${state.sleepTimer ? 'active' : ''}`}
                          onClick={() => setSleepOpen(true)}
                          aria-label="Sleep Timer"
                        >
                          <Timer size={12} />
                        </button>
                      </Tooltip>
                    </div>

                    <Queue
                      state={state}
                      variant="popover"
                      pageSize={6}
                      onClose={() => setQueueOpen(false)}
                    />
                  </>
                )}
              </div>
            )}
          </div>

          <div className="player-volume-wrap">
            <Tooltip title={muted ? 'Unmute (M)' : 'Mute (M)'} position="top">
              <button
                type="button"
                className="player-mute-btn"
                onClick={() => setMuted((prev) => !prev)}
                aria-label={muted ? 'Unmute' : 'Mute'}
              >
                {muted || volume === 0 ? <VolumeX size={13} /> : <Volume2 size={13} />}
              </button>
            </Tooltip>
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
