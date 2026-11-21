import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Check,
  ExternalLink,
  Film,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Save,
  Send,
  SkipBack,
  Sparkles,
  Square,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/button';
import { Slider } from '../components/slider';
import { Tooltip } from '../components/daw/Tooltip';
import { Waveform } from '../components/waveform';
import { formatDuration } from '../components/songs/card';
import { useSelectedUserAddress } from '../hooks/use-address';
import { useProfile } from '../hooks/use-profile';
import { audio } from '../lib/audio';
import {
  GenieDirector,
  deleteSongVideo,
  discardVideoWip,
  fetchVideoWip,
  mintGenieSession,
  saveVideoWip,
  sendEndBeacon,
  streamDirectorPlan,
  translateLiveSteer,
  type Board,
  type DeckVisibility,
  type Key,
  type Phase,
  type Plan,
  type SessionToken,
  type StudioAnalysis,
  type Telemetry,
  type VideoWip,
} from '../lib/genie';
import { navigateToSong } from '../lib/routes';
import type { Song } from '../lib/schema';
import { store } from '../lib/store';

export interface Props {
  song: Song;
  onBack: () => void;
  onSongUpdated: (song: Song) => void;
}

type PanelTab = 'story' | 'timeline' | 'lyrics';

const INITIAL_TELEMETRY: Telemetry = {
  phase: 'idle',
  status: '',
  actIndex: 0,
  totalActs: 1,
  rttMs: 0,
  frameWidth: 0,
  frameHeight: 0,
  fps: 0,
  activeCue: null,
  nextCue: null,
  firedCount: 0,
  recordedSec: 0,
  chunksBuffered: 0,
};

const CAMERA_LABELS: Record<Key, string> = {
  key_w: 'Track Forward',
  key_s: 'Pull Back',
  key_a: 'Drift Left',
  key_d: 'Drift Right',
  arrow_up: 'Tilt Up',
  arrow_down: 'Tilt Down',
  arrow_left: 'Pan Left',
  arrow_right: 'Pan Right',
};

function formatTagLabel(raw: string): string {
  return raw
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function releaseVideoEl(el: HTMLVideoElement | null): void {
  if (!el) return;
  try {
    el.pause();
    el.srcObject = null;
    el.removeAttribute('src');
    el.load();
  } catch {
    // ignore
  }
}

/**
 * Isolated Transport & Waveform bar: updates at 5 Hz without ever re-rendering
 * the live `<video>` decks or right Side-Panel.
 * Full controls active in BOTH preview/saved playback AND live Genie 4 streaming:
 * Restart (0:00), Seek Back (-10s), Play/Pause, Seek Forward (+10s),
 * Click/Drag Waveform scrubbing, and Song Audio Mute + Volume Slider.
 */
const TransportBar = React.memo<{
  song: Song;
  effectiveDuration: number;
  isStreaming: boolean;
  plan: Plan | null;
  activeActIndex: number;
  activeCueId: string | null;
  previewVideoRef: React.RefObject<HTMLVideoElement | null>;
  directorRef: React.RefObject<GenieDirector | null>;
  onSeekSec: (sec: number) => void;
}>(({ song, effectiveDuration, isStreaming, plan, activeActIndex, activeCueId, previewVideoRef, directorRef, onSeekSec }) => {
  const [isPlayingThis, setIsPlayingThis] = useState(false);
  const [ratio, setRatio] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(0.85);
  const waveWrapRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    const sync = () => {
      const s = store.getState();
      const active = s.activeSong?.id === song.id;
      setIsPlayingThis(active && s.isPlaying);
      if (active && !draggingRef.current) {
        const dur = s.duration > 0 ? s.duration : effectiveDuration;
        const pos = audio.position() ?? s.playhead;
        setRatio(dur > 0 ? Math.max(0, Math.min(1, pos / dur)) : 0);
      }
    };
    sync();
    return store.subscribe(sync);
  }, [song.id, effectiveDuration]);

  useEffect(() => {
    const pv = previewVideoRef.current;
    if (!isPlayingThis) {
      if (pv && !pv.paused) {
        try {
          pv.pause();
        } catch {
          // ignore
        }
      }
      return;
    }

    const tick = () => {
      if (draggingRef.current) return;
      const pos = audio.position();
      if (pos !== null && effectiveDuration > 0) {
        setRatio(Math.max(0, Math.min(1, pos / effectiveDuration)));
        const v = previewVideoRef.current;
        if (!isStreaming && v && v.readyState >= 1) {
          v.muted = true;
          v.volume = 0;
          const target = Number.isFinite(v.duration) && v.duration > 0 ? pos % v.duration : pos;
          if (Math.abs(v.currentTime - target) > 0.45) {
            try {
              v.currentTime = target;
            } catch {
              // ignore
            }
          }
          if (v.paused) void v.play().catch(() => {});
        }
      }
    };

    tick();
    const iv = setInterval(tick, 200);
    return () => clearInterval(iv);
  }, [isPlayingThis, isStreaming, effectiveDuration, previewVideoRef]);

  const handlePlayToggle = useCallback(() => {
    const s = store.getState();
    if (s.activeSong?.id === song.id && s.isPlaying) {
      directorRef.current?.setPaused(true);
      void store.setPlaying(false);
      return;
    }
    directorRef.current?.setPaused(false);
    if (s.activeSong?.id === song.id && audio.hasSource()) {
      void store.setPlaying(true);
      return;
    }
    void store.playSong(song, [song], null, `video:${song.id}`, true);
  }, [song, directorRef]);

  const applyVolume = useCallback((nextVol: number, nextMuted: boolean) => {
    const clamped = Math.max(0, Math.min(1, nextVol));
    setVolume(clamped);
    setMuted(nextMuted);
    audio.setVolume(nextMuted ? 0 : clamped);
  }, []);

  const handleToggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      audio.setVolume(next ? 0 : volume);
      return next;
    });
  }, [volume]);

  const commitSeekSec = useCallback(
    (rawSec: number) => {
      const clampedSec = Math.max(0, Math.min(effectiveDuration, rawSec));
      const nextRatio = effectiveDuration > 0 ? clampedSec / effectiveDuration : 0;
      setRatio(nextRatio);
      onSeekSec(Number(clampedSec.toFixed(1)));
    },
    [effectiveDuration, onSeekSec]
  );

  const handleSeekRatio = useCallback(
    (nextRatio: number) => {
      const clamped = Math.max(0, Math.min(1, nextRatio));
      setRatio(clamped);
      onSeekSec(Number((clamped * effectiveDuration).toFixed(1)));
    },
    [effectiveDuration, onSeekSec]
  );

  const ratioFromClientX = useCallback((clientX: number): number => {
    const el = waveWrapRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }, []);

  const handleScrubPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      draggingRef.current = true;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      handleSeekRatio(ratioFromClientX(e.clientX));
    },
    [handleSeekRatio, ratioFromClientX]
  );

  const handleScrubPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      setRatio(ratioFromClientX(e.clientX));
    },
    [ratioFromClientX]
  );

  const handleScrubPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch {
        // ignore
      }
      handleSeekRatio(ratioFromClientX(e.clientX));
    },
    [handleSeekRatio, ratioFromClientX]
  );

  const currentSec = Math.max(0, Math.min(effectiveDuration, ratio * effectiveDuration));

  // Studio keyboard shortcuts (Space: play/pause, M: mute song, Left/Right: -5s/+5s, 0: restart)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
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
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === 'Space') {
        e.preventDefault();
        handlePlayToggle();
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        handleToggleMute();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const cur = audio.position() ?? currentSec;
        commitSeekSec(cur - 5);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        const cur = audio.position() ?? currentSec;
        commitSeekSec(cur + 5);
      } else if (e.key === '0') {
        e.preventDefault();
        commitSeekSec(0);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlePlayToggle, handleToggleMute, commitSeekSec, currentSec]);

  return (
    <div className="video-transport">
      <div className="video-transport-controls">
        <Tooltip title="Restart (0:00)" position="top">
          <button
            type="button"
            className="video-ctrl-btn"
            onClick={() => commitSeekSec(0)}
            aria-label="Restart from beginning"
          >
            <SkipBack size={14} />
          </button>
        </Tooltip>

        <Tooltip title="Back 10s" position="top">
          <button
            type="button"
            className="video-ctrl-btn"
            onClick={() => commitSeekSec((audio.position() ?? currentSec) - 10)}
            aria-label="Seek back 10 seconds"
          >
            <RotateCcw size={14} />
          </button>
        </Tooltip>

        <Tooltip title={isPlayingThis ? 'Pause (Space)' : 'Play (Space)'} position="top">
          <button
            type="button"
            className={`video-play-btn ${isPlayingThis ? 'active' : ''}`}
            onClick={handlePlayToggle}
            aria-label={isPlayingThis ? 'Pause track' : 'Play track'}
          >
            {isPlayingThis ? <Pause size={15} /> : <Play size={15} className="market-play-icon-offset" />}
          </button>
        </Tooltip>

        <Tooltip title="Forward 10s" position="top">
          <button
            type="button"
            className="video-ctrl-btn"
            onClick={() => commitSeekSec((audio.position() ?? currentSec) + 10)}
            aria-label="Seek forward 10 seconds"
          >
            <RotateCw size={14} />
          </button>
        </Tooltip>
      </div>

      <span className="video-time-readout">
        {formatDuration(currentSec)} / {formatDuration(effectiveDuration)}
      </span>

      <div
        ref={waveWrapRef}
        className="video-waveform-wrap"
        onPointerDown={handleScrubPointerDown}
        onPointerMove={handleScrubPointerMove}
        onPointerUp={handleScrubPointerUp}
        onPointerCancel={handleScrubPointerUp}
        role="slider"
        aria-label="Song timeline"
        aria-valuemin={0}
        aria-valuemax={Math.round(effectiveDuration)}
        aria-valuenow={Math.round(currentSec)}
        tabIndex={0}
      >
        <Waveform
          audioUrl={song.url}
          timelineDuration={effectiveDuration}
          interactive={false}
          showSelection={false}
          height={54}
          progress={ratio}
        />

        {plan && effectiveDuration > 0 && (
          <div className="video-cue-rail" aria-hidden="true">
            {plan.acts.slice(1).map((act) => (
              <span
                key={`scene-${act.index}`}
                className={`video-rail-scene ${isStreaming && act.index === activeActIndex ? 'active' : ''}`}
                style={{ left: `${Math.max(1, Math.min(99, (act.startSec / effectiveDuration) * 100))}%` }}
              />
            ))}
            {plan.cues.map((c) => (
              <span
                key={c.id}
                className={`video-rail-cue ${c.id === activeCueId ? 'active' : ''}`}
                style={{ left: `${Math.max(1, Math.min(99, (c.targetSec / effectiveDuration) * 100))}%` }}
              />
            ))}
          </div>
        )}
      </div>

      <div className="video-volume-wrap">
        <Tooltip title={muted || volume === 0 ? 'Unmute song (M)' : 'Mute song (M)'} position="top">
          <button
            type="button"
            className={`video-ctrl-btn ${muted || volume === 0 ? 'is-muted' : ''}`}
            onClick={handleToggleMute}
            aria-label={muted || volume === 0 ? 'Unmute song audio' : 'Mute song audio'}
          >
            {muted || volume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
          </button>
        </Tooltip>
        <div className="video-volume-slider">
          <Slider
            value={muted ? 0 : volume}
            min={0}
            max={1}
            step={0.02}
            defaultValue={0.85}
            onChange={(val) => applyVolume(val, val === 0)}
            color="var(--primary)"
          />
        </div>
      </div>
    </div>
  );
});

/**
 * Isolated Full-Height Right Side-Panel: NEVER re-renders on audio playhead ticks.
 */
const SidePanel = React.memo<{
  panelTab: PanelTab;
  setPanelTab: (tab: PanelTab) => void;
  phase: Phase;
  isStreaming: boolean;
  board: Board | null;
  plan: Plan | null;
  analysis: StudioAnalysis | null;
  activeActIndex: number;
  activeCueId: string | null;
  firedCount: number;
  liveNotes: Array<{ sec: number; text: string }>;
  noteInput: string;
  setNoteInput: (val: string) => void;
  steeringBusy: boolean;
  onComposerSubmit: (e: React.FormEvent) => void;
  onSeekSec: (sec: number) => void;
}>(({
  panelTab,
  setPanelTab,
  phase,
  isStreaming,
  board,
  plan,
  analysis,
  activeActIndex,
  activeCueId,
  firedCount,
  liveNotes,
  noteInput,
  setNoteInput,
  steeringBusy,
  onComposerSubmit,
  onSeekSec,
}) => {
  const styleChoices = useMemo(() => {
    if (!board) return [];
    const items: Array<{ label: string; value: string }> = [];
    if (board.medium) items.push({ label: 'MEDIUM', value: formatTagLabel(board.medium) });
    if (board.camera) items.push({ label: 'CAMERA', value: formatTagLabel(board.camera) });
    if (board.subjects?.length) {
      items.push({ label: 'SUBJECTS', value: board.subjects.map(formatTagLabel).join(' · ') });
    }
    if (board.lighting?.length) {
      items.push({ label: 'LIGHTING', value: board.lighting.map(formatTagLabel).join(' · ') });
    }
    if (board.pacing?.length) {
      items.push({ label: 'PACING', value: board.pacing.map(formatTagLabel).join(' · ') });
    }
    return items;
  }, [board]);

  return (
    <aside className="video-sidepanel" aria-label="Visual direction">
      <div className="video-sidepanel-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={panelTab === 'story'}
          className={`video-tab-btn ${panelTab === 'story' ? 'active' : ''}`}
          onClick={() => setPanelTab('story')}
        >
          STORY
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={panelTab === 'timeline'}
          className={`video-tab-btn ${panelTab === 'timeline' ? 'active' : ''}`}
          onClick={() => setPanelTab('timeline')}
        >
          SCENES {plan ? `(${plan.acts.length})` : ''}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={panelTab === 'lyrics'}
          className={`video-tab-btn ${panelTab === 'lyrics' ? 'active' : ''}`}
          onClick={() => setPanelTab('lyrics')}
        >
          LYRICS
        </button>
      </div>

      <div className="video-sidepanel-body">
        {panelTab === 'story' && (
          <div className="video-panel-stack">
            {board ? (
              <>
                {styleChoices.length > 0 && (
                  <div className="video-card video-card-accent">
                    <span className="video-card-label">STYLE</span>
                    <div className="video-choice-list">
                      {styleChoices.map((c) => (
                        <div key={c.label} className="video-choice-row">
                          <span className="video-choice-key">{c.label}</span>
                          <span className="video-choice-val">{c.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="video-card">
                  <span className="video-card-label">CONCEPT</span>
                  <p className="video-card-text">{board.concept}</p>
                </div>

                {board.palette && (
                  <div className="video-card">
                    <span className="video-card-label">PALETTE</span>
                    <p className="video-card-text">{board.palette}</p>
                  </div>
                )}

                {board.motifs.length > 0 && (
                  <div className="video-card">
                    <span className="video-card-label">MOTIFS</span>
                    <div className="video-chip-row">
                      {board.motifs.map((m, i) => (
                        <span key={i} className="video-motif-chip">{m}</span>
                      ))}
                    </div>
                  </div>
                )}

                {board.beats.length > 0 && (
                  <div className="video-card">
                    <span className="video-card-label">STORYBOARD</span>
                    <div className="video-beat-list">
                      {board.beats.map((b, i) => {
                        const isLiveScene = isStreaming && i === activeActIndex;
                        return (
                          <button
                            key={i}
                            type="button"
                            className={`video-beat-item is-clickable ${isLiveScene ? 'is-active' : ''}`}
                            onClick={() => onSeekSec(b.startSec)}
                          >
                            <div className="video-beat-head">
                              <span className="video-beat-section">{b.section}</span>
                              <span className="video-beat-time">
                                {formatDuration(b.startSec)}–{formatDuration(b.endSec)}
                              </span>
                            </div>
                            {b.lyricAnchor && (
                              <p className="video-beat-lyric">“{b.lyricAnchor}”</p>
                            )}
                            <p className="video-beat-shift">{b.visualShift}</p>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="video-panel-empty">
                {phase === 'planning' ? (
                  <>
                    <Loader2 size={18} className="song-spin video-accent-icon" />
                    <span>Building visual story…</span>
                  </>
                ) : (
                  <span>Visual story and style direction appear here.</span>
                )}
              </div>
            )}
          </div>
        )}

        {panelTab === 'timeline' && (
          <div className="video-panel-stack">
            {liveNotes.length > 0 && (
              <div className="video-card video-card-accent">
                <span className="video-card-label">LIVE DIRECTION</span>
                <div className="video-cue-list">
                  {liveNotes.map((item, idx) => (
                    <div key={idx} className="video-cue-card is-live-steer">
                      <span className="video-cue-ts">@{formatDuration(item.sec)}</span>
                      <span className="video-cue-body">{item.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {plan ? (
              <>
                <div className="video-card">
                  <span className="video-card-label">SCENES ({plan.acts.length})</span>
                  <div className="video-beat-list">
                    {plan.acts.map((act) => {
                      const isLiveScene = isStreaming && act.index === activeActIndex;
                      return (
                        <button
                          key={act.index}
                          type="button"
                          className={`video-beat-item is-clickable ${isLiveScene ? 'is-active' : ''}`}
                          onClick={() => onSeekSec(act.startSec)}
                        >
                          <div className="video-beat-head">
                            <span className="video-beat-section">Scene {act.index + 1}</span>
                            <span className="video-beat-time">
                              {formatDuration(act.startSec)}–{formatDuration(act.endSec)}
                            </span>
                          </div>
                          <p className="video-beat-shift">{act.worldPrompt}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="video-card">
                  <span className="video-card-label">CAMERA ({plan.cues.length})</span>
                  <div className="video-cue-list">
                    {plan.cues.map((cue, idx) => {
                      const isNow = cue.id === activeCueId;
                      const isFired = isStreaming && idx < firedCount;
                      const badgeLabel =
                        cue.kind === 'input'
                          ? 'SCENE'
                          : cue.key
                            ? CAMERA_LABELS[cue.key] || 'CAMERA'
                            : 'CAMERA';
                      return (
                        <button
                          key={cue.id}
                          type="button"
                          className={`video-cue-card ${isNow ? 'is-active' : isFired ? 'is-fired' : ''}`}
                          onClick={() => onSeekSec(cue.targetSec)}
                        >
                          <div className="video-cue-top">
                            <span className="video-cue-ts">@{formatDuration(cue.targetSec)}</span>
                            <span className={`video-cue-kind ${cue.kind}`}>{badgeLabel}</span>
                            {isFired && <Check size={11} className="video-cue-check" />}
                          </div>
                          <span className="video-cue-reason">{cue.reason}</span>
                          {cue.prompt && <span className="video-cue-body">{cue.prompt}</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            ) : (
              <div className="video-panel-empty">
                <span>Timed scenes and visual transitions appear here.</span>
              </div>
            )}
          </div>
        )}

        {panelTab === 'lyrics' && (
          <div className="video-panel-stack">
            {analysis?.sections && analysis.sections.length > 0 ? (
              analysis.sections.map((sec, idx) => (
                <div key={idx} className="video-card">
                  <div className="video-beat-head">
                    <span className="video-beat-section">{sec.label}</span>
                    <span className="video-beat-time">
                      {formatDuration(sec.startSec)}–{formatDuration(sec.endSec)}
                    </span>
                  </div>
                  {sec.controlTags.length > 0 && (
                    <div className="video-chip-row">
                      {sec.controlTags.map((tag, ti) => (
                        <span key={ti} className="video-tag-chip">{tag}</span>
                      ))}
                    </div>
                  )}
                  {sec.lines.length > 0 ? (
                    <div className="video-stanza-lines">
                      {sec.lines.map((line, li) => (
                        <p key={li} className="video-stanza-line">
                          {line.startSec !== null && (
                            <span className="video-line-ts">{formatDuration(line.startSec)}</span>
                          )}
                          <span>{line.text}</span>
                        </p>
                      ))}
                    </div>
                  ) : (
                    <p className="video-beat-lyric">Instrumental</p>
                  )}
                </div>
              ))
            ) : (
              <div className="video-panel-empty">
                <span>Instrumental track</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Docked Bottom Live Direction Composer */}
      <form className="video-composer" onSubmit={onComposerSubmit}>
        <span className="video-composer-label">
          {isStreaming ? 'DIRECT LIVE' : 'VISUAL DIRECTION'}
        </span>
        <div className="video-composer-row">
          <input
            type="text"
            className="video-composer-input"
            value={noteInput}
            onChange={(e) => setNoteInput(e.target.value)}
            placeholder={
              isStreaming
                ? 'Describe a shift in mood, light, or motion…'
                : 'Optional style or visual direction…'
            }
            disabled={steeringBusy || phase === 'planning' || phase === 'stitching'}
            maxLength={400}
          />
          <button
            type="submit"
            className="video-composer-send"
            disabled={
              steeringBusy ||
              phase === 'planning' ||
              phase === 'stitching' ||
              (isStreaming && !noteInput.trim())
            }
            aria-label={isStreaming ? 'Send direction' : 'Generate video'}
          >
            {steeringBusy ? <Loader2 size={14} className="song-spin" /> : <Send size={14} />}
          </button>
        </div>
      </form>
    </aside>
  );
});

export const Video: React.FC<Props> = ({ song, onBack, onSongUpdated }) => {
  const { readAddress } = useSelectedUserAddress();
  const profile = useProfile(song.creator || readAddress);
  const queryClient = useQueryClient();

  const [hydrating, setHydrating] = useState(true);
  const [liveSong, setLiveSong] = useState<Song>(song);
  const [analysis, setAnalysis] = useState<StudioAnalysis | null>(null);
  const [wip, setWip] = useState<VideoWip | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [storeDuration, setStoreDuration] = useState(0);

  const [phase, setPhase] = useState<Phase>('idle');
  const [statusText, setStatusText] = useState('');
  const [telemetry, setTelemetry] = useState<Telemetry>(INITIAL_TELEMETRY);
  const [deckVis, setDeckVis] = useState<DeckVisibility>({ activeSlot: 0, fadingSlot: null });

  const [panelTab, setPanelTab] = useState<PanelTab>('story');
  const [noteInput, setNoteInput] = useState('');
  const [steeringBusy, setSteeringBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [liveNotes, setLiveNotes] = useState<Array<{ sec: number; text: string }>>([]);

  const deckARef = useRef<HTMLVideoElement | null>(null);
  const deckBRef = useRef<HTMLVideoElement | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const directorRef = useRef<GenieDirector | null>(null);
  const planAbortRef = useRef<AbortController | null>(null);
  const autoStartedForRef = useRef<string | null>(null);
  const isMountedRef = useRef(true);
  const stoppingRef = useRef(false);

  const effectiveSong = liveSong;
  const effectiveDuration = useMemo(() => {
    if (storeDuration > 0) return storeDuration;
    if (effectiveSong.duration && effectiveSong.duration > 0) return effectiveSong.duration;
    if (analysis?.durationSec && analysis.durationSec > 0) return analysis.durationSec;
    if (plan?.durationSec && plan.durationSec > 0) return plan.durationSec;
    return 120;
  }, [storeDuration, effectiveSong.duration, analysis?.durationSec, plan?.durationSec]);

  const isStreaming = phase === 'warming' || phase === 'live' || phase === 'rolling';
  const isBusy = phase === 'planning' || isStreaming || phase === 'stitching' || saving || removing;
  const previewSrc = wip?.previewUrl || effectiveSong.video || null;
  const hasUnsavedPreview = Boolean(wip?.previewUrl);
  const hasSavedVideo = Boolean(effectiveSong.video && effectiveSong.video.trim());

  useEffect(() => {
    setLiveSong(song);
  }, [song]);

  // Track audio duration changes without re-rendering on playhead ticks
  useEffect(() => {
    const syncDuration = () => {
      const s = store.getState();
      if (s.activeSong?.id === effectiveSong.id && s.duration > 0) {
        setStoreDuration((prev) => (Math.abs(prev - s.duration) > 0.1 ? s.duration : prev));
      }
    };
    syncDuration();
    return store.subscribe(syncDuration);
  }, [effectiveSong.id]);

  const handleStopStream = useCallback(
    async (shouldFinalize = true, autoSaveAfter = false) => {
      if (stoppingRef.current) return;
      stoppingRef.current = true;
      try {
        planAbortRef.current?.abort();
        planAbortRef.current = null;

        const dir = directorRef.current;
        directorRef.current = null;
        if (store.getState().activeSong?.id === effectiveSong.id && store.getState().isPlaying) {
          void store.setPlaying(false);
        }

        if (dir) {
          if (shouldFinalize) {
            setPhase(autoSaveAfter ? 'saving' : 'stitching');
            setStatusText(autoSaveAfter ? 'Saving video…' : 'Preparing preview…');
          }
          const result = await dir.stop(shouldFinalize);
          if (!isMountedRef.current) return;
          if (result?.previewUrl) {
            setWip(result.wip);
            if (autoSaveAfter && readAddress) {
              setSaving(true);
              setPhase('saving');
              setStatusText('Saving video…');
              try {
                const { song: updated } = await saveVideoWip(effectiveSong.id, readAddress);
                if (!isMountedRef.current) return;
                setLiveSong(updated);
                setWip((prev) => (prev ? { ...prev, previewUrl: null, previewKey: null } : null));
                setPhase('idle');
                setStatusText('');
                onSongUpdated(updated);
                void queryClient.invalidateQueries({ queryKey: ['songs'] });
                void queryClient.invalidateQueries({ queryKey: ['market'] });
                toast.success('Video saved');
              } finally {
                if (isMountedRef.current) setSaving(false);
              }
            } else {
              setPhase('ready');
              setStatusText('');
              toast.success('Preview ready to save');
            }
          } else {
            setPhase('idle');
            setStatusText('');
          }
        } else {
          setPhase('idle');
          setStatusText('');
        }
      } catch (err: any) {
        if (!isMountedRef.current) return;
        setPhase('error');
        setStatusText(err?.message || 'Could not prepare preview');
        toast.error(err?.message || 'Could not prepare preview');
      } finally {
        stoppingRef.current = false;
      }
    },
    [effectiveSong.id, readAddress, onSongUpdated, queryClient]
  );

  // Auto-finish live session cleanly when the song ends
  useEffect(() => {
    if (!isStreaming) return;
    const iv = setInterval(() => {
      const pos = audio.position();
      if (pos !== null && effectiveDuration > 10 && pos >= effectiveDuration - 0.35) {
        void handleStopStream(true);
      }
    }, 500);
    return () => clearInterval(iv);
  }, [isStreaming, effectiveDuration, handleStopStream]);

  // Zero-friction full pipeline: fast 2-turn Flash direction -> live Genie 4 locked to t = 0.00s
  const startFullDirection = useCallback(
    async (guidanceOverride?: string) => {
      if (!readAddress) {
        toast.error('Connect your wallet to create a video');
        return;
      }
      if (!deckARef.current || !deckBRef.current) return;

      if (directorRef.current) {
        await handleStopStream(false);
      }
      planAbortRef.current?.abort();

      const abort = new AbortController();
      planAbortRef.current = abort;
      setLiveNotes([]);
      setPhase('planning');
      setStatusText('Analyzing song…');

      let prefetchedAct0Token: Promise<SessionToken> | null = null;
      const cancelPrefetch = () => {
        if (!prefetchedAct0Token) return;
        const p = prefetchedAct0Token;
        prefetchedAct0Token = null;
        void p.then((tok) => sendEndBeacon(tok.interactionId, tok.stopToken)).catch(() => {});
      };

      try {
        const guidance = (guidanceOverride ?? noteInput).trim();
        const { runId, board: nextBoard, plan: nextPlan } = await streamDirectorPlan({
          songId: effectiveSong.id,
          guidance: guidance || undefined,
          userAddress: readAddress,
          signal: abort.signal,
          onEvent: (event) => {
            if (!isMountedRef.current) return;
            if (event.type === 'status') setStatusText(event.step);
            if (event.type === 'analysis') setAnalysis(event.analysis);
            if (event.type === 'sketchboard') setBoard(event.board);
            if (event.type === 'acts' && !prefetchedAct0Token && event.acts.length > 0) {
              prefetchedAct0Token = mintGenieSession(effectiveSong.id, readAddress);
            }
            if (event.type === 'plan') setPlan(event.plan);
          },
        });

        if (!isMountedRef.current || abort.signal.aborted) {
          cancelPrefetch();
          return;
        }
        if (nextBoard) setBoard(nextBoard);
        setPlan(nextPlan);
        setPhase('warming');
        setStatusText('Starting live video…');

        const tokenForDirector = prefetchedAct0Token;
        prefetchedAct0Token = null;

        const director = new GenieDirector({
          deckElements: [deckARef.current, deckBRef.current],
          plan: nextPlan,
          runId,
          userAddress: readAddress,
          prefetchedAct0Token: tokenForDirector,
          onDeckVisibility: (vis) => {
            if (isMountedRef.current) setDeckVis(vis);
          },
          onTelemetry: (t) => {
            if (!isMountedRef.current) return;
            setTelemetry(t);
            setPhase(t.phase);
            if (t.status) setStatusText(t.status);
          },
          onError: (msg) => {
            if (!isMountedRef.current) return;
            setStatusText(msg);
            toast.error(msg);
          },
        });
        directorRef.current = director;

        await director.start(async () => {
          // Pass restart=true (5th arg) so Regenerate/re-entry NEVER toggles playback to paused!
          const ok = await store.playSong(effectiveSong, [effectiveSong], null, `video:${effectiveSong.id}`, true);
          if (ok) {
            store.setPlayhead(0);
          }
        });
      } catch (err: any) {
        cancelPrefetch();
        if (abort.signal.aborted || !isMountedRef.current) return;
        setPhase('error');
        setStatusText(err?.message || 'Could not start video');
        toast.error(err?.message || 'Could not start video');
      }
    },
    [effectiveSong, noteInput, readAddress, handleStopStream]
  );

  // Hydrate studio state and auto-start immediately on songs with no video yet
  useEffect(() => {
    isMountedRef.current = true;
    if (!readAddress) {
      setHydrating(false);
      return;
    }

    let active = true;
    setHydrating(true);
    fetchVideoWip(song.id, readAddress)
      .then((bundle) => {
        if (!active) return;
        setLiveSong(bundle.song);
        setAnalysis(bundle.analysis);
        setWip(bundle.wip);
        if (bundle.wip?.board) setBoard(bundle.wip.board);
        if (bundle.wip?.plan) setPlan(bundle.wip.plan);
        setHydrating(false);

        const hasExistingVisual = Boolean(bundle.wip?.previewUrl || bundle.song.video);
        if (!hasExistingVisual && autoStartedForRef.current !== song.id) {
          autoStartedForRef.current = song.id;
          setTimeout(() => {
            if (isMountedRef.current) {
              void startFullDirection('');
            }
          }, 80);
        } else if (bundle.wip?.previewUrl) {
          setPhase('ready');
          setStatusText('');
        }
      })
      .catch((err: any) => {
        if (!active) return;
        setHydrating(false);
        setStatusText(err?.message || 'Could not open video studio');
      });

    return () => {
      active = false;
    };
  }, [song.id, readAddress]);

  // Guaranteed stream cleanup & hardware video decoder buffer release on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      planAbortRef.current?.abort();
      const dir = directorRef.current;
      directorRef.current = null;
      if (dir) {
        void dir.stop(false).catch(() => {});
      }
      releaseVideoEl(deckARef.current);
      releaseVideoEl(deckBRef.current);
      releaseVideoEl(previewVideoRef.current);
    };
  }, []);

  const handleSeekSec = useCallback(
    (targetSec: number) => {
      const clamped = Math.max(0, Math.min(effectiveDuration, targetSec));
      if (isStreaming && directorRef.current) {
        const s = store.getState();
        if (s.activeSong?.id !== effectiveSong.id) {
          void store.playSong(effectiveSong, [effectiveSong], null, `video:${effectiveSong.id}`, true).then((ok) => {
            if (ok) store.setPlayhead(clamped);
          });
        } else {
          store.setPlayhead(clamped);
          if (!s.isPlaying) void store.setPlaying(true);
        }
        directorRef.current.seekTo(clamped);
        return;
      }

      const pv = previewVideoRef.current;
      if (pv && pv.readyState >= 1) {
        pv.muted = true;
        pv.volume = 0;
        const t = Number.isFinite(pv.duration) && pv.duration > 0 ? clamped % pv.duration : clamped;
        try {
          pv.currentTime = t;
        } catch {
          // ignore
        }
      }

      const s = store.getState();
      if (s.activeSong?.id !== effectiveSong.id) {
        void store.playSong(effectiveSong, [effectiveSong], null, `video:${effectiveSong.id}`, true).then((ok) => {
          if (ok) store.setPlayhead(clamped);
        });
      } else {
        store.setPlayhead(clamped);
        if (!s.isPlaying) void store.setPlaying(true);
      }
    },
    [isStreaming, effectiveSong, effectiveDuration]
  );

  const handleComposerSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const note = noteInput.trim();
      if (isStreaming && directorRef.current) {
        if (!note || steeringBusy) return;
        setSteeringBusy(true);
        try {
          const pos = audio.position() ?? 0;
          const steer = await translateLiveSteer({
            songId: effectiveSong.id,
            note,
            currentSec: pos,
            concept: board?.concept,
            userAddress: readAddress,
          });
          const sent = directorRef.current?.steerNow(steer.prompt, steer.key, steer.durationSec);
          if (sent) {
            setLiveNotes((prev) => [{ sec: pos, text: steer.prompt }, ...prev].slice(0, 8));
            setNoteInput('');
            toast.success('Direction applied');
          }
        } catch (err: any) {
          toast.error(err?.message || 'Could not apply direction');
        } finally {
          setSteeringBusy(false);
        }
        return;
      }

      if (isBusy) return;
      setNoteInput('');
      await startFullDirection(note);
    },
    [noteInput, isStreaming, steeringBusy, effectiveSong.id, board?.concept, readAddress, isBusy, startFullDirection]
  );

  const handleSaveVideo = async () => {
    if (!readAddress || !hasUnsavedPreview || saving) return;
    setSaving(true);
    setPhase('saving');
    setStatusText('Saving video…');
    try {
      const { song: updated } = await saveVideoWip(effectiveSong.id, readAddress);
      if (!isMountedRef.current) return;
      setLiveSong(updated);
      setWip((prev) => (prev ? { ...prev, previewUrl: null, previewKey: null } : null));
      setPhase('idle');
      setStatusText('');
      onSongUpdated(updated);
      void queryClient.invalidateQueries({ queryKey: ['songs'] });
      void queryClient.invalidateQueries({ queryKey: ['market'] });
      toast.success('Video saved');
    } catch (err: any) {
      if (!isMountedRef.current) return;
      setPhase('ready');
      setStatusText(err?.message || 'Could not save video');
      toast.error(err?.message || 'Could not save video');
    } finally {
      if (isMountedRef.current) setSaving(false);
    }
  };

  const handleRemoveSavedVideo = async () => {
    if (!readAddress || !hasSavedVideo || removing) return;
    setRemoving(true);
    try {
      const updated = await deleteSongVideo(effectiveSong.id, readAddress);
      if (!isMountedRef.current) return;
      setLiveSong(updated);
      await discardVideoWip(effectiveSong.id, readAddress);
      setWip(null);
      onSongUpdated(updated);
      void queryClient.invalidateQueries({ queryKey: ['songs'] });
      void queryClient.invalidateQueries({ queryKey: ['market'] });
      toast.success('Video removed');
    } catch (err: any) {
      toast.error(err?.message || 'Could not remove video');
    } finally {
      if (isMountedRef.current) setRemoving(false);
    }
  };

  const handleExit = () => {
    if (directorRef.current) {
      void handleStopStream(false).finally(() => onBack());
    } else {
      onBack();
    }
  };

  const creatorHandle = profile.nickname?.trim() || effectiveSong.creator || readAddress || '';
  const deckAStyle: React.CSSProperties = {
    zIndex: deckVis.fadingSlot === 0 ? 3 : deckVis.activeSlot === 0 ? 2 : 1,
    opacity: !isStreaming ? 0 : deckVis.fadingSlot === 0 ? 0 : 1,
    pointerEvents: 'none',
  };
  const deckBStyle: React.CSSProperties = {
    zIndex: deckVis.fadingSlot === 1 ? 3 : deckVis.activeSlot === 1 ? 2 : 1,
    opacity: !isStreaming ? 0 : deckVis.fadingSlot === 1 ? 0 : 1,
    pointerEvents: 'none',
  };

  const activeCueId = telemetry.activeCue?.id ?? null;
  const showOverlay =
    (!isStreaming && !previewSrc) ||
    phase === 'planning' ||
    phase === 'warming' ||
    phase === 'stitching' ||
    phase === 'saving';

  return (
    <div className="video-studio">
      {/* Top Workstation Header */}
      <header className="video-header">
        <div className="video-header-left">
          <button
            type="button"
            className="video-back-btn"
            data-guide="editor.back"
            onClick={handleExit}
            aria-label="Back to Workspace"
          >
            <ArrowLeft size={14} />
            <span>WORKSPACE</span>
          </button>

          {effectiveSong.image ? (
            <img src={effectiveSong.image} alt="" className="video-header-thumb" />
          ) : null}

          <div className="video-header-title-wrap">
            <h1 className="video-header-title">{effectiveSong.title}</h1>
            <div className="video-header-dna">
              {analysis?.bpm ? <span>{analysis.bpm} BPM</span> : null}
              {analysis?.keyScale && analysis.keyScale !== 'Unknown' ? <span>{analysis.keyScale}</span> : null}
              <span>{formatDuration(effectiveDuration)}</span>
            </div>
          </div>
        </div>

        <div className="video-header-right">
          {isStreaming ? (
            <>
              <Button
                size="sm"
                variant="primary"
                disabled={phase === 'warming' || saving}
                onClick={() => void handleStopStream(true, true)}
              >
                <Save size={13} />
                <span>SAVE VIDEO</span>
              </Button>
              <Button size="sm" variant="destructive" onClick={() => void handleStopStream(true, false)}>
                <span className="video-live-dot" />
                <Square size={11} />
                <span>STOP</span>
              </Button>
            </>
          ) : (
            <>
              {hasUnsavedPreview && (
                <Button size="sm" variant="primary" disabled={saving || isBusy} onClick={() => void handleSaveVideo()}>
                  {saving ? <Loader2 size={13} className="song-spin" /> : <Save size={13} />}
                  <span>{saving ? 'SAVING…' : 'SAVE VIDEO'}</span>
                </Button>
              )}

              {hasSavedVideo && !hasUnsavedPreview && (
                <span className="video-saved-pill">
                  <Check size={12} />
                  <span>SAVED</span>
                </span>
              )}

              <Button
                size="sm"
                variant={hasUnsavedPreview || hasSavedVideo ? 'secondary' : 'primary'}
                disabled={isBusy}
                onClick={() => void startFullDirection()}
              >
                {phase === 'planning' || phase === 'stitching' ? (
                  <Loader2 size={13} className="song-spin" />
                ) : hasSavedVideo || hasUnsavedPreview ? (
                  <RefreshCw size={13} />
                ) : (
                  <Sparkles size={13} />
                )}
                <span>
                  {phase === 'planning'
                    ? 'DIRECTING…'
                    : phase === 'stitching'
                      ? 'PREPARING…'
                      : hasSavedVideo || hasUnsavedPreview
                        ? 'REGENERATE'
                        : 'GENERATE VIDEO'}
                </span>
              </Button>

              {hasSavedVideo && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={removing || isBusy}
                  onClick={() => void handleRemoveSavedVideo()}
                  title="Remove saved video"
                >
                  {removing ? <Loader2 size={13} className="song-spin" /> : <Trash2 size={13} />}
                </Button>
              )}

              {Boolean(effectiveSong.public || effectiveSong.chain_song_id) && creatorHandle && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    if (directorRef.current) void handleStopStream(false);
                    navigateToSong(creatorHandle, effectiveSong.title);
                  }}
                >
                  <ExternalLink size={12} />
                  <span>SONG PAGE</span>
                </Button>
              )}
            </>
          )}
        </div>
      </header>

      {/* Main Split Workstation */}
      <div className="video-workspace">
        <section className="video-stage-col" aria-label="Video stage">
          <div className="video-stage-frame">
            <div className="video-stage-viewport">
              {/* Hardware-decoded GPU-composited dual video decks — pure unobstructed cinema */}
              <video
                ref={deckARef}
                autoPlay
                playsInline
                muted
                className="video-deck-el"
                style={deckAStyle}
              />
              <video
                ref={deckBRef}
                autoPlay
                playsInline
                muted
                className="video-deck-el"
                style={deckBStyle}
              />

              {/* Saved or preview MP4 playback */}
              {!isStreaming && previewSrc && (
                <video
                  ref={previewVideoRef}
                  key={previewSrc}
                  src={previewSrc}
                  muted
                  playsInline
                  preload="auto"
                  className="video-preview-el"
                  onLoadedMetadata={() => {
                    if (previewVideoRef.current) {
                      previewVideoRef.current.muted = true;
                      previewVideoRef.current.volume = 0;
                    }
                  }}
                />
              )}

              {/* Clean minimal status overlay ONLY while loading / generating / saving */}
              {showOverlay && (
                <div className="video-stage-overlay">
                  {effectiveSong.image ? (
                    <img src={effectiveSong.image} alt="" className="video-stage-ambient" />
                  ) : null}
                  <div className="video-stage-status-card">
                    {hydrating || phase === 'planning' || phase === 'warming' || phase === 'stitching' || phase === 'saving' ? (
                      <Loader2 size={22} className="song-spin video-accent-icon" />
                    ) : (
                      <Film size={22} className="video-accent-icon" />
                    )}
                    <p className="video-stage-status-title">
                      {hydrating
                        ? 'Loading…'
                        : phase === 'planning'
                          ? statusText || 'Creating visual direction…'
                          : phase === 'warming'
                            ? 'Starting live video…'
                            : phase === 'stitching'
                              ? 'Preparing preview…'
                              : phase === 'saving'
                                ? 'Saving video…'
                                : phase === 'error'
                                  ? statusText || 'Could not generate video'
                                  : 'Ready'}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <TransportBar
            song={effectiveSong}
            effectiveDuration={effectiveDuration}
            isStreaming={isStreaming}
            plan={plan}
            activeActIndex={telemetry.actIndex}
            activeCueId={activeCueId}
            previewVideoRef={previewVideoRef}
            directorRef={directorRef}
            onSeekSec={handleSeekSec}
          />
        </section>

        <SidePanel
          panelTab={panelTab}
          setPanelTab={setPanelTab}
          phase={phase}
          isStreaming={isStreaming}
          board={board}
          plan={plan}
          analysis={analysis}
          activeActIndex={telemetry.actIndex}
          activeCueId={activeCueId}
          firedCount={telemetry.firedCount}
          liveNotes={liveNotes}
          noteInput={noteInput}
          setNoteInput={setNoteInput}
          steeringBusy={steeringBusy}
          onComposerSubmit={handleComposerSubmit}
          onSeekSec={handleSeekSec}
        />
      </div>
    </div>
  );
};
