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
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    return store.subscribe(setState);
  }, []);

  useEffect(() => {
    setImgError(false);
  }, [state.activeSong?.id, state.activeSong?.image]);

  useEffect(() => {
    audio.setVolume(volume);
  }, [volume]);

  const handlePlayPause = () => {
    store.setPlaying(!state.isPlaying);
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    store.setPlayhead(pct * state.duration);
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const progressPct = state.duration > 0 ? (state.playhead / state.duration) * 100 : 0;
  const currentSong = state.activeSong;

  return (
    <div className={`app-player panel ${className}`.trim()}>
      {/* Top Scrubber Bar */}
      <div className="player-scrubber" onClick={handleSeek}>
        <div
          className="player-scrubber-progress"
          style={{ '--scrubber-progress': `${progressPct}%` } as React.CSSProperties}
        />
        {state.selection && state.duration > 0 && (
          <div
            className="player-scrubber-selection"
            style={{
              '--selection-left': `${(state.selection.start / state.duration) * 100}%`,
              '--selection-width': `${((state.selection.end - state.selection.start) / state.duration) * 100}%`,
            } as React.CSSProperties}
          />
        )}
      </div>

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
              width={24}
              height={24}
              decoding="async"
              onError={() => setImgError(true)}
            />
          </div>
          <div className="player-track-text">
            <div className="player-track-title">
              {currentSong?.title || 'STANDBY'}
            </div>
            <div className="player-track-meta">
              {currentSong ? currentSong.tags.join(' // ') : 'No audio loaded'}
            </div>
          </div>
        </div>

        {/* Transport Controls */}
        <div className="player-controls">
          <Tooltip title="Rewind 5s" position="top">
            <Button
              size="xs"
              variant="ghost"
              aria-label="Rewind 5 seconds"
              onClick={() => store.setPlayhead(Math.max(0, state.playhead - 5))}
            >
              <RotateCcw size={13} />
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

          <Tooltip title="Forward 5s" position="top">
            <Button
              size="xs"
              variant="ghost"
              aria-label="Forward 5 seconds"
              onClick={() => store.setPlayhead(Math.min(state.duration, state.playhead + 5))}
            >
              <RotateCw size={13} />
            </Button>
          </Tooltip>

          <span className="player-time-readout">
            {formatTime(state.playhead)} / {state.duration > 0 ? formatTime(state.duration) : '--:--'}
          </span>
        </div>

        {/* Right: Volume */}
        <div className="player-volume-wrap">
          <Slider
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={setVolume}
            label="VOL"
          />
        </div>
      </div>
    </div>
  );
};

