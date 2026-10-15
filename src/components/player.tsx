import React, { useEffect, useState } from 'react';
import { Button } from './button';
import { Slider } from './slider';
import { Tooltip } from './daw/Tooltip';
import { store, State } from '../lib/store';
import { audio } from '../lib/audio';
import { Play, Pause, RotateCcw, RotateCw } from 'lucide-react';

export interface Props {
  className?: string;
}

export const Player: React.FC<Props> = ({ className = '' }) => {
  const [state, setState] = useState<State>(store.getState());
  const [volume, setVolume] = useState(0.85);

  useEffect(() => {
    return store.subscribe(setState);
  }, []);

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
            <img src="/branding/mark.svg" alt="Rawchunks" width={24} height={24} />
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

