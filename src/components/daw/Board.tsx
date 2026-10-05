import React, { useState, useRef, useLayoutEffect } from 'react';
import { useDawStore } from '../../lib/daw/store';
import { dawEngine } from '../../lib/daw/engine';
import { Waveform } from '../waveform';
import { ClipWaveform } from './ClipWaveform';
import { Notes } from './Notes';
import { Tooltip } from './Tooltip';
import {
  Play,
  Pause,
  Square,
  RotateCcw,
  Repeat,
  Volume2,
  ChevronDown,
  ChevronUp,
  Plus,
  Split,
  Check,
  Sparkles,
  Download,
  Trash2,
  Minimize2,
  Drum,
  Layers,
} from 'lucide-react';
import { Song } from '../../lib/schema';
import { toast } from 'sonner';
import { TrackType } from '../../lib/daw/store';
import { getStemColor } from '../../lib/daw/palette';
import { isBase, mounted, preview, interval, pending } from '../../lib/daw/takes';
import { Key } from './Key';

export interface BoardProps {
  song: Song;
  selectedTrackId: string;
  onSelectTrack: (trackId: string) => void;
  onAddTrack: (type: TrackType) => void;
  onSeparateStems: () => void;
  isSeparating: boolean;
  onReworkSection?: () => void;
}

export const Board: React.FC<BoardProps> = ({
  song,
  selectedTrackId,
  onSelectTrack,
  onAddTrack,
  onSeparateStems,
  isSeparating,
  onReworkSection,
}) => {
  const {
    tracks,
    playhead,
    duration,
    isPlaying,
    loop,
    bpm,
    snapToGrid,
    gridSnap,
    selection,
    legoContextTrackIds,
    takes,
    setPlayhead,
    setPlaying,
    setLoop,
    setBpm,
    setSnapToGrid,
    setSelection,
    extractCurrentSection,
    toggleLegoContext,
    updateTrackMixer,
    toggleTake,
    pendingTake,
    deleteTake,
    revertToOriginalMaster,
    originals, operations, auditionId, toggleOriginal, mergeTakes, moveTake,
  } = useDawStore();

  const [masterExpanded, setMasterExpanded] = useState(true);
  const [lanesExpanded, setLanesExpanded] = useState<boolean>(true);
  const [extractedExpanded, setExtractedExpanded] = useState<boolean>(true);
  const playingTakeId = isPlaying ? auditionId : null;
  const overlays = tracks.filter(track => track.id === track.activeTakeId && takes.some(take => take.id === track.id && !take.provenance?.mergedInto && !isBase(take, tracks, takes)));
  const [drag, setDrag] = useState<{id:string;shift:number} | null>(null);
  const dragging = useRef<{id:string;x:number;shift:number;width:number;minimum:number;maximum:number;current:number} | null>(null);
  const didDrag = useRef(false);
  const selectedOverlay = overlays.find(track => track.id === selectedTrackId);
  const audibleOverlays = overlays.filter(track => !track.muted && (!tracks.some(lane => lane.solo) || track.solo));
  const selectedClip = selectedOverlay?.clips.find(clip => selection && clip.startTime <= selection.start && clip.startTime + clip.duration >= selection.end) ?? selectedOverlay?.clips[0];
  const originalEnabled = Boolean(selectedClip && !originals.some(region => region.start <= selectedClip.startTime && region.end >= selectedClip.startTime + selectedClip.duration));
  const selectedTake = takes.find(take => take.id === selectedOverlay?.id);

  // Group takes by task category & track active take per category
  const [activeCategoryTakeId, setActiveCategoryTakeId] = useState<Record<string, string>>({});
  const [expandedCategoryAccordion, setExpandedCategoryAccordion] = useState<Record<string, boolean>>({});

  const takesByCategory = React.useMemo(() => {
    const groups: Record<string, typeof takes> = {};
    takes.forEach((take) => {
      if (!pending(take)) return;
      const cat = (take.task || 'extract').toLowerCase();
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(take);
    });
    return groups;
  }, [takes]);
  const pendingCount = Object.values(takesByCategory).reduce((count, group) => count + group.length, 0);

  const totalDuration = Math.max(duration > 0 ? duration : 60, ...overlays.flatMap(track => track.clips.map(clip => clip.startTime + clip.duration)));
  const viewportRef = useRef<HTMLDivElement | null>(null);

  // Group tracks into: Master, Lanes (stems + custom tracks), and Extracted (Takes / isolates)
  const masterTrack = tracks.find((t) => t.id === 'master') || tracks[0];
  const laneTracks = tracks.filter((t) => t.id !== 'master' && t.id !== t.activeTakeId);
  const orderedLanes = [...laneTracks].sort((a, b) => Number(b.id === selectedTrackId) - Number(a.id === selectedTrackId));
  const positions = useRef(new Map<string, number>());
  const movements = useRef(new Map<string, Animation>());
  useLayoutEffect(() => () => {
    movements.current.forEach(animation => animation.cancel());
    movements.current.clear();
  }, []);
  useLayoutEffect(() => {
    const rows = viewportRef.current?.querySelectorAll<HTMLElement>('[data-track-id]');
    const next = new Map<string, number>();
    rows?.forEach(row => {
      const id = row.dataset.trackId!;
      const top = row.offsetTop;
      const previous = positions.current.get(id);
      next.set(id, top);
      if (previous === undefined || previous === top || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      movements.current.get(id)?.cancel();
      movements.current.set(id, row.animate([
        { transform: `translateY(${previous - top}px)` },
        { transform: 'translateY(0)' },
      ], { duration: 420, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }));
    });
    positions.current = next;
  }, [tracks, selectedTrackId]);
  const separated = laneTracks.filter(track => track.type === 'stem' && track.clips.length > 0);
  const completeSeparation = ['drums', 'bass', 'other'].every(name => separated.some(track => track.name.toLowerCase() === name));
  const masterLanes = separated.filter(track => !completeSeparation || track.name.toLowerCase() !== 'instrumental');
  const selectedLane = separated.find(track => track.id === selectedTrackId);
  const highlighted = completeSeparation && selectedLane?.name.toLowerCase() === 'instrumental'
    ? masterLanes.filter(track => track.name.toLowerCase() !== 'vocals').map(track => track.id)
    : [selectedTrackId];

  // Format seconds to mm:ss.ms
  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 10);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms}`;
  };

  // Coordinated Transport actions
  const handleTogglePlay = async () => {
    if (isPlaying) {
      dawEngine.pauseTransport();
      setPlaying(false);
    } else {
      try { await dawEngine.startTransport(); } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not play the arrangement'); }
    }
  };

  const handleStop = () => {
    dawEngine.stopTransport();
    setPlaying(false);
    setPlayhead(0);
  };

  const handleReturnToZero = () => {
    dawEngine.seek(0);
    setPlayhead(0);
  };

  const handleToggleLoop = () => {
    const nextLoop = !loop;
    setLoop(nextLoop);
    if (selection) {
      dawEngine.setLoop(nextLoop, selection.start, selection.end);
    } else {
      dawEngine.setLoop(nextLoop, 0, totalDuration);
    }
  };

  // Timeline seek on click
  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    const targetTime = ratio * totalDuration;
    dawEngine.seek(targetTime);
    setPlayhead(targetTime);
  };

  // Generate ticks for time ruler (every 15s or 30s)
  const tickIntervalSec = totalDuration > 120 ? 30 : 15;
  const tickCount = Math.floor(totalDuration / tickIntervalSec);
  const tickMarkers: number[] = [];
  for (let i = 0; i <= tickCount; i++) {
    tickMarkers.push(i * tickIntervalSec);
  }

  // Playhead percentage position
  const playheadPercent = Math.max(0, Math.min(100, (playhead / totalDuration) * 100));

  // Determine if master is currently playing
  const isMasterPlaying = isPlaying && !playingTakeId && (selectedTrackId === 'master' || !tracks.some((t) => t.solo));

  return (
    <div className="board-container">
      {/* Master Transport & Status Bar */}
      <div className="board-transport">
        <div className="board-transport-cluster">
          <Tooltip title={isPlaying ? 'Pause' : 'Play'} description="Toggle studio transport playback (Space)">
            <button
              type="button"
              className={`board-transport-btn ${isPlaying ? 'active' : ''}`}
              onClick={handleTogglePlay}
            >
              {isPlaying ? <Pause size={13} /> : <Play size={13} />}
              <span>{isPlaying ? 'PAUSE' : 'PLAY'}</span>
            </button>
          </Tooltip>

          <Tooltip title="Stop" description="Stop playback and return playhead to start (0)">
            <button
              type="button"
              className="board-transport-btn"
              onClick={handleStop}
            >
              <Square size={13} />
              <span>STOP</span>
            </button>
          </Tooltip>

          <Tooltip title="Return to Zero" description="Reset playhead to zero (Home)">
            <button
              type="button"
              className="board-transport-btn"
              onClick={handleReturnToZero}
            >
              <RotateCcw size={13} />
              <span>RTZ</span>
            </button>
          </Tooltip>

          <Tooltip title="Loop" description="Toggle region looping (L)">
            <button
              type="button"
              className={`board-transport-btn ${loop ? 'active' : ''}`}
              onClick={handleToggleLoop}
            >
              <Repeat size={13} />
              <span>LOOP</span>
            </button>
          </Tooltip>

          {selection && (
            <>
              <Tooltip title="Audition Section" description="Play only the selected time range once">
                <button
                  type="button"
                  className="board-transport-btn active"
                  onClick={() => dawEngine.auditionSection(selection.start, selection.end, false)}
                >
                  <Play size={12} />
                  <span>AUDITION</span>
                </button>
              </Tooltip>

              <Tooltip title="Loop Section" description="Continuously loop the selected time range">
                <button
                  type="button"
                  className="board-transport-btn"
                  onClick={() => dawEngine.auditionSection(selection.start, selection.end, true)}
                >
                  <Repeat size={12} />
                  <span>LOOP REGION</span>
                </button>
              </Tooltip>

              <Tooltip title="Extract Section" description="Export lossless 16-bit PCM WAV slice as a new take">
                <button
                  type="button"
                  className="board-transport-btn"
                  onClick={async () => {
                    const take = await extractCurrentSection();
                    if (take && take.url) {
                      const a = document.createElement('a');
                      a.href = take.url;
                      a.download = `slice_${selection.start.toFixed(1)}s_${selection.end.toFixed(1)}s.wav`;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                    }
                  }}
                >
                  <Download size={12} />
                  <span>EXTRACT</span>
                </button>
              </Tooltip>

              {onReworkSection && (
                <Tooltip title="Rework Section" description="Open studio generator pre-configured for this section">
                  <button
                    type="button"
                    className="board-transport-btn"
                    style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
                    onClick={onReworkSection}
                  >
                    <Sparkles size={12} />
                    <span>REWORK</span>
                  </button>
                </Tooltip>
              )}
            </>
          )}

          {takes.some((t) => t.is_active) && (
            <Tooltip title="Restore Original Mix" description="Revert master track audio back to original source">
              <button
                type="button"
                className="board-transport-btn"
                style={{ borderColor: 'var(--warning)', color: 'var(--warning)' }}
                onClick={() => revertToOriginalMaster()}
              >
                <RotateCcw size={12} />
                <span>RESTORE MIX</span>
              </button>
            </Tooltip>
          )}
        </div>

        {/* Time Elapsed & Region Readout */}
        <div className="board-transport-time">
          <div className="board-time-display">
            <span className="board-time-label">TIME:</span>
            <span className="board-time-value">
              {formatTime(playhead)} / {formatTime(totalDuration)}
            </span>
          </div>

          {selection && (
            <div className="board-time-display">
              <span className="board-time-label">RANGE:</span>
              <span className="board-section-value">
                [{formatTime(selection.start)} ➔ {formatTime(selection.end)}] (
                {(selection.end - selection.start).toFixed(1)}s)
              </span>
            </div>
          )}

          <div className="board-time-display">
            <span className="board-time-label">BPM:</span>
            <input
              type="number"
              min="40"
              max="240"
              value={bpm}
              onChange={(e) => setBpm(parseInt(e.target.value) || 120)}
              style={{
                width: '44px',
                background: 'transparent',
                border: 'none',
                color: 'var(--text)',
                fontFamily: 'var(--font-family)',
                fontSize: '11px',
                fontWeight: 'bold',
                outline: 'none',
              }}
            />
          </div>

          <Tooltip title="Grid Snap" description="Quantize section selections to musical grid">
            <button
              type="button"
              className={`board-transport-btn ${snapToGrid ? 'active' : ''}`}
              onClick={() => setSnapToGrid(!snapToGrid)}
            >
              <span>SNAP: {gridSnap}</span>
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Unified DAW Board Viewport */}
      <div ref={viewportRef} className="board-viewport">
        {/* Sticky Time Ruler Header Row */}
        <div className="board-ruler-row">
          <div className="board-ruler-corner">
            <span>TRACK / CHANNEL</span>
            <span>I/O</span>
          </div>

          <div className="board-ruler-timeline" onClick={handleTimelineClick}>
            <div className="board-ruler-ticks">
              {tickMarkers.map((sec) => (
                <div
                  key={sec}
                  className="board-ruler-marker"
                  style={{ left: `${(sec / totalDuration) * 100}%` }}
                >
                  <span>{formatTime(sec).slice(0, 5)}</span>
                </div>
              ))}
            </div>

            {/* Playhead indicator on ruler */}
            <div className="board-playhead-line" style={{ left: `${playheadPercent}%` }}>
              <div className="board-playhead-cap" />
            </div>
          </div>
        </div>

        {/* ==================================================================
            1. MASTER / MAIN MIX TRACK ROW (Exact same row size and left bar)
            ================================================================== */}
        <div
          className={`board-row master ${takes.some(take => take.provenance?.region) ? 'expanded' : ''}`}
          onClick={() => onSelectTrack('master')}
        >
          {/* Left Track Header */}
          <div className="board-track-header">
            <div className="board-track-header-top">
              <div className="board-track-meta">
                <Tooltip title="Master" description={song.title}>
                  <span className="board-track-badge">MST</span>
                </Tooltip>
              </div>

              <div className="board-track-controls">
                <Tooltip title={isMasterPlaying ? 'Stop Master' : 'Play Master'} description="Toggle Master track playback (Space)">
                  <button
                    type="button"
                    className={`board-btn-mini play ${isMasterPlaying ? 'active playing' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectTrack('master');
                      dawEngine.stopAuditionTake();
                      if (isMasterPlaying) {
                        dawEngine.pauseTransport();
                      } else {
                        void dawEngine.startTransport().catch(error => toast.error(error instanceof Error ? error.message : 'Could not play the arrangement'));
                      }
                    }}
                  >
                    {isMasterPlaying ? <Square size={10} /> : <Play size={10} />}
                  </button>
                </Tooltip>

                <Tooltip title="Mute" description="Silence the original recording. Enabled mounted layers keep playing.">
                  <button
                    type="button"
                    className={`board-btn-mini mute ${masterTrack?.muted ? 'active' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      updateTrackMixer('master', { muted: !masterTrack?.muted });
                    }}
                  >
                    M
                  </button>
                </Tooltip>

                <Tooltip title="Solo" description="Solo master output">
                  <button
                    type="button"
                    className={`board-btn-mini solo ${masterTrack?.solo ? 'active' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      updateTrackMixer('master', { solo: !masterTrack?.solo });
                    }}
                  >
                    S
                  </button>
                </Tooltip>
                <Tooltip title={!separated.length ? 'Extract stems' : masterExpanded ? 'Compact waveform' : 'Expand stems'} description={!separated.length ? 'Separate the recording into instruments and vocals.' : masterExpanded ? 'Show the master as one waveform. Keep the extracted lanes.' : 'Show instrument and vocal colors in the master waveform.'}>
                  <button type="button" className="board-btn-mini" aria-label={!separated.length ? 'Extract stems' : masterExpanded ? 'Compact waveform' : 'Expand stems'} disabled={isSeparating} onClick={event => {
                    event.stopPropagation();
                    if (!separated.length) { setMasterExpanded(true); onSeparateStems(); }
                    else { setMasterExpanded(!masterExpanded); if (masterExpanded) onSelectTrack('master'); }
                  }}>
                    {separated.length && masterExpanded ? <Minimize2 size={11} /> : <Split size={11} />}
                  </button>
                </Tooltip>
                <Tooltip title="Merge all" description="Commit all enabled mounted sections to the master.">
                  <button type="button" className="board-btn-mini" aria-label="Merge all mounted sections" disabled={Boolean(pendingTake) || !audibleOverlays.length} onClick={event => {event.stopPropagation(); void mergeTakes(audibleOverlays.map(track => track.id));}}><Layers size={11} /></button>
                </Tooltip>

              </div>
            </div>

            {separated.length > 0 && <div className="board-master-badges" aria-label="Instrument controls">
              {separated.map(track => <Tooltip key={track.id} title={track.name} description={`Select and listen to ${track.name.toLowerCase()} in the master.`}>
                <button type="button" className={`board-track-badge ${selectedTrackId === track.id ? 'selected' : ''}`} style={{ background: getStemColor(track.name), color: '#000' }} aria-label={`Select ${track.name} in master`} aria-pressed={selectedTrackId === track.id} onClick={event => { event.stopPropagation(); setMasterExpanded(true); onSelectTrack(track.id); }}>
                  {track.name.slice(0, 3).toUpperCase()}
                </button>
              </Tooltip>)}
            </div>}
            {overlays.length > 0 && <div className="board-master-badges" aria-label="Mounted layer controls">
              {overlays.map(track => { const take = takes.find(take => take.id === track.id)!; return <Tooltip key={track.id} title={`Take #${take.take_number}`} description="Enable or silence this mounted section. It stays mounted until removed in Extracted.">
                <button type="button" className={`board-track-badge ${selectedTrackId === track.id ? 'selected' : ''}`} style={{ background: track.color, color: '#000', opacity: track.muted ? .35 : 1 }} aria-label={`Toggle Take #${take.take_number} in master`} aria-pressed={!track.muted} onClick={event => { event.stopPropagation(); updateTrackMixer(track.id, { muted: !track.muted }); setSelection({ start: track.clips[0].startTime, end: track.clips[0].startTime + track.clips[0].duration }); onSelectTrack(track.id); }}>TK#{take.take_number}</button>
              </Tooltip>; })}
            </div>}

            <div className="board-track-header-bottom">
              <div className="board-fader-wrap">
                <Volume2 size={12} color="var(--accent)" />
                <input
                  type="range"
                  className="board-slider"
                  min="0"
                  max="1.2"
                  step="0.01"
                  value={masterTrack?.volume ?? 1}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) =>
                    updateTrackMixer('master', { volume: parseFloat(e.target.value) })
                  }
                />
              </div>
              <span className="board-fader-val">
                {Math.round((masterTrack?.volume ?? 1) * 100)}%
              </span>
            </div>
          </div>

          {/* Right Timeline Lane: Waveform & Selection Pincher */}
          <div
            className="board-track-lane"
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <div className="board-lane-grid" />

            <Waveform
              audioUrl={masterTrack?.clips[0]?.url}
              timelineDuration={totalDuration}
              interactive={true}
              showSelection={true}
              onReworkSection={onReworkSection}
              onSelectTrack={onSelectTrack}
              lanes={masterExpanded ? masterLanes : []}
              selectedTrackId={selectedTrackId}
              highlighted={highlighted}
              style={{ width: '100%', height: 'var(--board-master-row-h)', background: 'transparent' }}
            />

            <div className="board-overlays" aria-label="Mounted sections">
              {overlays.flatMap(track => track.clips.map(clip => {
                const take = takes.find(take => take.id === track.activeTakeId)!;
                const shift = drag?.id === track.id ? drag.shift - (clip.startTime - (clip.origin ?? clip.startTime)) : 0;
                const start = clip.startTime + shift, end = start + clip.duration;
                const selected = selectedTrackId === take.id;
                return <div key={`${track.id}:${clip.id ?? clip.startTime}`} className={`board-overlay ${selected ? 'selected' : ''} ${track.muted ? 'muted' : ''}`} style={{ left: `${start / totalDuration * 100}%`, width: `${(end - start) / totalDuration * 100}%`, color: track.color }}>
                  <button type="button" className="board-overlay-wave" aria-label={`Select Take #${take.take_number} section`} aria-pressed={selected}
                    onPointerDown={event => {
                      if (event.button !== 0 || pendingTake) return;
                      event.stopPropagation(); didDrag.current = false;
                      const width = event.currentTarget.closest('.board-track-lane')!.getBoundingClientRect().width;
                      const origins = track.clips.map(part => part.origin ?? part.startTime);
                      const shift = clip.startTime - (clip.origin ?? clip.startTime);
                      dragging.current = {id:track.id,x:event.clientX,shift,width,minimum:-Math.min(...origins),maximum:totalDuration-Math.max(...track.clips.map((part,index)=>origins[index]+part.duration)),current:shift};
                      event.currentTarget.setPointerCapture(event.pointerId);
                    }}
                    onPointerMove={event => {
                      const state = dragging.current;
                      if (!state || state.id !== track.id || Math.abs(event.clientX - state.x) < 3 && !didDrag.current) return;
                      didDrag.current = true;
                      state.current = Math.max(state.minimum,Math.min(state.maximum,state.shift + (event.clientX - state.x) / state.width * totalDuration));
                      setDrag({id:state.id,shift:state.current});
                    }}
                    onPointerUp={event => {
                      const state = dragging.current; dragging.current = null; setDrag(null);
                      if (didDrag.current && state) { event.stopPropagation(); void moveTake(track.id,state.current); onSelectTrack(track.id); }
                    }}
                    onPointerCancel={() => {dragging.current = null;setDrag(null);}}
                    onClick={event => { event.stopPropagation(); if (didDrag.current) {didDrag.current = false;return;} setSelection({ start, end }); onSelectTrack(take.id); }}
                  ><ClipWaveform clip={clip} color={track.color} /></button>
                </div>;
              }))}
              {selectedOverlay && selectedClip && <div className="board-overlay-actions" style={{ left: `clamp(0px, calc(${selectedClip.startTime / totalDuration * 100}%), max(0px, calc(100% - var(--board-overlay-actions-w))))` }} onClick={event => event.stopPropagation()}>
                <div className="board-overlay-player">
                  <Tooltip title="Play section" description="Play the selected original and take audio for this segment."><button type="button" aria-label={`Play selected audio for Take #${selectedTake!.take_number}`} disabled={!originalEnabled && selectedOverlay.muted} onClick={() => { void dawEngine.auditionLayer(['master',selectedOverlay.id],selectedClip.startTime,selectedClip.startTime + selectedClip.duration).catch(error => toast.error(error instanceof Error ? error.message : 'Could not play the section')); }}><Play size={10}/></button></Tooltip>
                  <div className="board-overlay-choices">
                    <Tooltip title="Original section" description="Enable or silence the original audio underneath this layer."><button type="button" aria-label="Toggle original section" aria-pressed={originalEnabled} onClick={() => toggleOriginal({start:selectedClip.startTime,end:selectedClip.startTime + selectedClip.duration})}>ORG</button></Tooltip>
                    <Tooltip title={`Take #${selectedTake!.take_number}`} description="Enable or silence this edited section."><button type="button" aria-label={`Toggle Take #${selectedTake!.take_number} section`} aria-pressed={!selectedOverlay.muted} onClick={() => updateTrackMixer(selectedOverlay.id,{muted:!selectedOverlay.muted})}>TK#</button></Tooltip>
                  </div>
                </div>
                <Tooltip title="Merge" description="Commit this enabled section at its current position."><button type="button" aria-label={`Merge Take #${takes.find(take => take.id === selectedOverlay.id)!.take_number}`} disabled={Boolean(pendingTake) || !audibleOverlays.includes(selectedOverlay)} onClick={() => void mergeTakes([selectedOverlay.id], selection && selection.start >= selectedClip.startTime && selection.end <= selectedClip.startTime + selectedClip.duration ? selection : {start:selectedClip.startTime,end:selectedClip.startTime + selectedClip.duration})}><Check size={13}/></button></Tooltip>
                <Tooltip title="Discard" description="Remove this pending take and its mounted sections."><button type="button" aria-label={`Discard Take #${takes.find(take => take.id === selectedOverlay.id)!.take_number}`} disabled={Boolean(pendingTake)} onClick={() => void deleteTake(selectedOverlay.id)}><Trash2 size={13}/></button></Tooltip>
                <Tooltip title="Reset" description="Return this layer to its original timeline position."><button type="button" aria-label={`Reset Take #${takes.find(take => take.id === selectedOverlay.id)!.take_number} position`} disabled={Boolean(pendingTake)} onClick={() => void moveTake(selectedOverlay.id,0)}><RotateCcw size={13}/></button></Tooltip>
              </div>}
            </div>

            <div className="board-playhead-line" style={{ left: `${playheadPercent}%` }} />
          </div>
        </div>

        {/* ==================================================================
            2. LANES SEPARATOR (Multitrack Instruments & Vocals)
            ================================================================== */}
        <div
          className={`board-section-separator ${!lanesExpanded ? 'collapsed' : ''}`}
          onClick={() => setLanesExpanded(!lanesExpanded)}
        >
          <div className="board-section-left">
            <span className="board-section-chevron">
              <ChevronDown size={14} />
            </span>
            <span>LANES</span>
            <span className="board-section-badge">{laneTracks.length} TRACKS</span>
          </div>


        </div>

        {/* Folded Overview Bar when collapsed */}
        {!lanesExpanded && (
          <div className="board-folded-preview">
            <span>
              {laneTracks.length > 0
                ? `${laneTracks.length} Track lanes active: ${laneTracks.map((t) => t.name).join(', ')}`
                : 'No track lanes added yet. Click Separate Tracks or + Add Track.'}
            </span>
          </div>
        )}

        {/* Track Rows (when unfolded) */}
        {lanesExpanded &&
          orderedLanes.map((trackItem) => {
            const isSelected = selectedTrackId === trackItem.id;
            const anySoloed = tracks.some((t) => t.solo);
            const isDimmed = (anySoloed && !trackItem.solo) || (laneTracks.some(track => track.id === selectedTrackId) && !isSelected && !anySoloed);
            const isLego = legoContextTrackIds.includes(trackItem.id);
            const clip = trackItem.clips[0];
            const isTrackPlaying = playingTakeId === trackItem.id;

            // Centralized stem color token
            const brandColor = getStemColor(trackItem.name);

            return (
              <div
                key={trackItem.id}
                data-track-id={trackItem.id}
                className={`board-row ${isSelected ? 'selected' : ''} ${isDimmed ? 'dimmed' : ''}`}
                onClick={() => onSelectTrack(isSelected ? 'master' : trackItem.id)}
              >
                {/* Left Track Header */}
                <div className="board-track-header">
                  <div className="board-track-header-top">
                    <div className="board-track-meta">
                      <span
                        className="board-track-badge"
                        style={{ background: brandColor, color: '#000' }}
                      >
                        {trackItem.name.slice(0, 3).toUpperCase()}
                      </span>
                      <Tooltip title={trackItem.name} description={`Stem channel: ${trackItem.name}`}>
                        <span className="board-track-name">
                          {trackItem.name}
                        </span>
                      </Tooltip>
                    </div>

                    <div className="board-track-controls">
                      <Tooltip title={isTrackPlaying ? 'Stop track' : 'Audition track'} description={`Solo audition of ${trackItem.name}`}>
                        <button
                          type="button"
                          className={`board-btn-mini play ${isTrackPlaying ? 'active playing' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isTrackPlaying) {
                              dawEngine.pauseTransport();
                            } else {
                              onSelectTrack(trackItem.id);
                              dawEngine.auditionTrack(trackItem.id);
                            }
                          }}
                        >
                          {isTrackPlaying ? <Square size={10} /> : <Play size={10} />}
                        </button>
                      </Tooltip>

                      <Tooltip title="Mute Track" description={`Mute ${trackItem.name}`}>
                        <button
                          type="button"
                          className={`board-btn-mini mute ${trackItem.muted ? 'active' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            updateTrackMixer(trackItem.id, { muted: !trackItem.muted });
                          }}
                        >
                          M
                        </button>
                      </Tooltip>

                      <Tooltip title="Solo Track" description={`Solo ${trackItem.name}`}>
                        <button
                          type="button"
                          className={`board-btn-mini solo ${trackItem.solo ? 'active' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            updateTrackMixer(trackItem.id, { solo: !trackItem.solo });
                          }}
                        >
                          S
                        </button>
                      </Tooltip>

                      <Tooltip title="Layer Guide Context" description="Use as harmonic reference guide when generating new stems">
                        <button
                          type="button"
                          className={`board-btn-mini arm ${isLego ? 'active' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleLegoContext(trackItem.id);
                          }}
                        >
                          L
                        </button>
                      </Tooltip>
                    </div>
                  </div>

                  <div className="board-track-header-bottom">
                    <div className="board-fader-wrap">
                      <Volume2 size={12} color={brandColor} />
                      <input
                        type="range"
                        className="board-slider"
                        min="0"
                        max="1.2"
                        step="0.01"
                        value={trackItem.volume}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) =>
                          updateTrackMixer(trackItem.id, { volume: parseFloat(e.target.value) })
                        }
                      />
                    </div>
                    <span className="board-fader-val">
                      {Math.round(trackItem.volume * 100)}%
                    </span>
                  </div>
                </div>

                {/* Right Timeline Lane */}
                <div
                  className="board-track-lane"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectTrack(isSelected ? 'master' : trackItem.id);
                    handleTimelineClick(e);
                  }}
                >
                  <div className="board-lane-grid" />

                  {(trackItem.type === 'pianoroll' || trackItem.type === 'sequencer') && (
                    <Notes track={trackItem} bpm={bpm} duration={totalDuration} color={brandColor} />
                  )}

                  {clip && clip.url && (
                    <div
                      style={{
                        position: 'absolute',
                        left: `${(clip.startTime / totalDuration) * 100}%`,
                        width: `${(clip.duration / totalDuration) * 100}%`,
                        height: '100%',
                      }}
                    >
                      <ClipWaveform clip={clip} color={brandColor} />
                    </div>
                  )}

                  {/* Playhead needle */}
                  <div className="board-playhead-line" style={{ left: `${playheadPercent}%` }} />
                </div>
              </div>
            );
          })}

        {/* ==================================================================
            3. EXTRACTED SEPARATOR (Takes, AI Overdubs & Isolates)
            ================================================================== */}
        <div
          className={`board-section-separator ${!extractedExpanded ? 'collapsed' : ''}`}
          onClick={() => setExtractedExpanded(!extractedExpanded)}
        >
          <div className="board-section-left">
            <span className="board-section-chevron">
              <ChevronDown size={14} />
            </span>
            <span>EXTRACTED</span>
            <span className="board-section-badge">{pendingCount} TAKES</span>
          </div>
        </div>

        {!extractedExpanded && (
          <div className="board-folded-preview">
            <span>
              {pendingCount > 0
                ? `${pendingCount} Takes and extractions stored in session history.`
                : 'No takes or extractions generated yet.'}
            </span>
          </div>
        )}

        {operations.map(operation => <div key={operation.id} className="board-operation" role={operation.status === 'error' ? 'alert' : 'status'} aria-live="polite">
          <span>{operation.task === 'repaint' ? 'REWORK' : operation.task.toUpperCase()}</span>
          <span>{operation.status === 'submitting' ? 'SUBMITTING' : operation.status === 'pending' ? 'QUEUED' : operation.status.toUpperCase()}{operation.progress === undefined ? '' : ` ${operation.progress}%`}</span>
          {operation.error && <span>{operation.error}</span>}
        </div>)}
        {/* Extracted Take Rows (grouped by category with badge swapping & accordion) */}
        {extractedExpanded &&
          Object.entries(takesByCategory).map(([category, catTakes]) => {
            const currentTake =
              catTakes.find((t) => t.id === selectedTrackId) ||
              catTakes.find((t) => t.id === activeCategoryTakeId[category]) ||
              catTakes.find((t) => mounted(t, tracks, takes)) ||
              catTakes[0];

            const isCatExpanded = Boolean(expandedCategoryAccordion[category]);
            const isCurrentActive = mounted(currentTake, tracks, takes);
            const isTakePlaying = playingTakeId === currentTake.id;
            const isSelected = selectedTrackId === currentTake.id;
            const isDimmed = selectedTrackId && selectedTrackId !== 'master' && !isSelected;

            return (
              <React.Fragment key={category}>
                {/* Category Main Row (collapsed single lane with badge switcher) */}
                <div
                  className={`board-row ${isSelected ? 'selected' : ''} ${isCurrentActive ? 'active-take' : ''} ${isDimmed ? 'dimmed' : ''}`}
                  onClick={() => {
                    onSelectTrack(isSelected ? 'master' : currentTake.id);
                  }}
                >
                  {/* Left Track Header */}
                  <div className="board-track-header">
                    <div className="board-track-header-top">
                      <div className="board-track-meta">
                        <Tooltip
                          title={`Category: ${category.toUpperCase()}`}
                          description={`Take #${currentTake.take_number} • ${currentTake.prompt || 'Session take'}`}
                        ><span
                          className="board-track-badge"
                          aria-label={`Category: ${category.toUpperCase()}, Take #${currentTake.take_number}`}
                          style={{
                            background: isCurrentActive ? 'var(--primary)' : 'var(--accent)',
                            color: '#000',
                          }}
                        >
                          TK#{currentTake.take_number}
                        </span></Tooltip>
                      </div>

                      <div className="board-track-controls">
                        <Tooltip
                          title={isTakePlaying ? 'Stop playback' : 'Play take'}
                          description={`Preview Take #${currentTake.take_number}`}
                        >
                          <button
                            type="button"
                            className={`board-btn-mini play ${isTakePlaying ? 'active playing' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isTakePlaying) {
                                dawEngine.stopAuditionTake();
                              } else {
                                onSelectTrack(currentTake.id);
                                const range = preview(currentTake);
                                dawEngine.auditionTake(currentTake.url, range.start, range.end, range.timelineStart);
                                useDawStore.setState({ auditionId: currentTake.id });
                              }
                            }}
                          >
                            {isTakePlaying ? <Square size={10} /> : <Play size={10} />}
                          </button>
                        </Tooltip>

                        <Tooltip
                          title={
                            isCurrentActive
                              ? 'Unmount take'
                              : 'Set as Base'
                          }
                          description={
                            isCurrentActive
                              ? 'Remove this take from playback. Keep the other mounted takes.'
                              : 'Mount this take alongside the current arrangement.'
                          }
                        >
                          <button
                            type="button"
                            aria-label={isCurrentActive ? `Unmount Take #${currentTake.take_number}` : `Use Take #${currentTake.take_number} as base`}
                            aria-pressed={isCurrentActive}
                            disabled={Boolean(pendingTake)}
                            className={`board-btn-mini solo ${isCurrentActive ? 'active' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveCategoryTakeId(prev => ({ ...prev, [category]: currentTake.id }));
                              toggleTake(currentTake.id);
                            }}
                          >
                            {isCurrentActive ? <Check size={11} /> : 'BASE'}
                          </button>
                        </Tooltip>

                        <Tooltip title="Delete Take" description={`Permanently remove Take #${currentTake.take_number}`}>
                          <button
                            type="button"
                            className="board-btn-mini delete"
                            style={{ color: '#ef4444' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteTake(currentTake.id);
                            }}
                          >
                            <Trash2 size={10} />
                          </button>
                        </Tooltip>
                      </div>
                    </div>

                    {/* Bottom Row: Badges List for quick swapping + Accordion Toggle */}
                    <div className="board-category-badges-row">
                      <div className="board-category-badges-list">
                        {catTakes.map((take) => {
                          const isTakeSelected = selectedTrackId === take.id;
                          const isTakeMixActive = mounted(take, tracks, takes);
                          return (
                            <button
                              key={take.id}
                              type="button"
                              aria-pressed={isTakeSelected}
                              className={`board-take-badge-pill ${isTakeSelected ? 'selected' : ''} ${isTakeMixActive ? 'mix-active' : ''}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveCategoryTakeId((prev) => ({ ...prev, [category]: take.id }));
                                onSelectTrack(take.id);
                              }}
                              title={`Take #${take.take_number}${isTakeMixActive ? ' · Base' : ''}`}
                            >
                              #{take.take_number}
                            </button>
                          );
                        })}
                      </div>

                      {/* Down-Arrow to view all takes one below the other */}
                      <button
                        type="button"
                        className={`board-category-chevron-btn ${isCatExpanded ? 'expanded' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedCategoryAccordion((prev) => ({
                            ...prev,
                            [category]: !prev[category],
                          }));
                        }}
                        title={isCatExpanded ? 'Collapse to single lane' : 'Expand all takes in category'}
                      >
                        {isCatExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                      </button>
                    </div>
                  </div>

                  {/* Right Timeline Lane */}
                  <div
                    className="board-track-lane"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectTrack(isSelected ? 'master' : currentTake.id);
                      handleTimelineClick(e);
                    }}
                  >
                    <div className="board-lane-grid" />

                    {currentTake.url ? (
                      <div
                        style={{
                          position: 'absolute',
                          left: `${(interval(currentTake, duration).start / totalDuration) * 100}%`,
                          width: `${((interval(currentTake, duration).end - interval(currentTake, duration).start) / totalDuration) * 100}%`,
                          height: '100%',
                        }}
                      >
                        <ClipWaveform
                          clip={{
                            id: currentTake.id,
                            name: `Take #${currentTake.take_number}`,
                            url: currentTake.url,
                            startTime: interval(currentTake, duration).start,
                            duration: interval(currentTake, duration).end - interval(currentTake, duration).start,
                            offset: preview(currentTake).start,
                          }}
                          color={isCurrentActive ? '#00ff41' : '#00ccff'}
                        />
                      </div>
                    ) : null}

                    {/* Playhead needle */}
                    <div className="board-playhead-line" style={{ left: `${playheadPercent}%` }} />
                  </div>
                </div>

                {/* Expanded Takes Accordion (Rendered one below the other slightly in-lined) */}
                {isCatExpanded &&
                  catTakes.filter(take => take.id !== currentTake.id).map((take) => {
                    const isTakeCurrentActive = mounted(take, tracks, takes);
                    const isRowTakePlaying = playingTakeId === take.id;
                    const isRowSelected = selectedTrackId === take.id;
                    const isRowDimmed = selectedTrackId && selectedTrackId !== 'master' && !isRowSelected;

                    return (
                      <div
                        key={take.id}
                        className={`board-row board-take-indented-row ${isRowSelected ? 'selected' : ''} ${isTakeCurrentActive ? 'active-take' : ''} ${isRowDimmed ? 'dimmed' : ''}`}
                        onClick={() => {
                          onSelectTrack(isRowSelected ? 'master' : take.id);
                        }}
                      >
                        {/* Indented Left Header */}
                        <div className="board-track-header">
                          <div className="board-track-header-top">
                            <div className="board-track-meta">
                              <Tooltip title={`Category: ${category.toUpperCase()}`} description={`Take #${take.take_number} • ${take.prompt || 'Session take'}`}><span
                                className="board-track-badge"
                                aria-label={`Category: ${category.toUpperCase()}, Take #${take.take_number}`}
                                style={{
                                  background: isTakeCurrentActive ? 'var(--primary)' : 'rgba(255,255,255,0.15)',
                                  color: isTakeCurrentActive ? '#000' : '#fff',
                                }}
                              >
                                TK#{take.take_number}
                              </span></Tooltip>
                              <span className="board-track-name" style={{ fontSize: '10px' }}>
                                {take.repainting_start != null && take.repainting_end != null
                                  ? `[${formatTime(take.repainting_start)} ➔ ${formatTime(take.repainting_end)}]`
                                  : 'Full Mix'}
                              </span>
                            </div>

                            <div className="board-track-controls">
                              <button
                                type="button"
                                className={`board-btn-mini play ${isRowTakePlaying ? 'active playing' : ''}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (isRowTakePlaying) {
                                    dawEngine.stopAuditionTake();
                                  } else {
                                    onSelectTrack(take.id);
                                    const range = preview(take);
                                    dawEngine.auditionTake(take.url, range.start, range.end, range.timelineStart);
                                    useDawStore.setState({ auditionId: take.id });
                                  }
                                }}
                              >
                                {isRowTakePlaying ? <Square size={10} /> : <Play size={10} />}
                              </button>

                              <button
                                type="button"
                                aria-label={isTakeCurrentActive ? `Unmount Take #${take.take_number}` : `Use Take #${take.take_number} as base`}
                                aria-pressed={isTakeCurrentActive}
                                disabled={Boolean(pendingTake)}
                                className={`board-btn-mini solo ${isTakeCurrentActive ? 'active' : ''}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveCategoryTakeId(prev => ({ ...prev, [category]: take.id }));
                                  toggleTake(take.id);
                                }}
                              >
                                {isTakeCurrentActive ? <Check size={11} /> : 'BASE'}
                              </button>

                              <button
                                type="button"
                                className="board-btn-mini delete"
                                style={{ color: '#ef4444' }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deleteTake(take.id);
                                }}
                              >
                                <Trash2 size={10} />
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* Indented Right Lane */}
                        <div
                          className="board-track-lane"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectTrack(isRowSelected ? 'master' : take.id);
                            handleTimelineClick(e);
                          }}
                        >
                          <div className="board-lane-grid" />
                          {take.url ? (
                            <div
                              style={{
                                position: 'absolute',
                                left: `${(interval(take, duration).start / totalDuration) * 100}%`,
                                width: `${((interval(take, duration).end - interval(take, duration).start) / totalDuration) * 100}%`,
                                height: '100%',
                              }}
                            >
                              <ClipWaveform
                                clip={{
                                  id: take.id,
                                  name: `Take #${take.take_number}`,
                                  url: take.url,
                                  startTime: interval(take, duration).start,
                                  duration: interval(take, duration).end - interval(take, duration).start,
                                  offset: preview(take).start,
                                }}
                                color={isTakeCurrentActive ? '#00ff41' : '#00ccff'}
                              />
                            </div>
                          ) : null}
                          <div className="board-playhead-line" style={{ left: `${playheadPercent}%` }} />
                        </div>
                      </div>
                    );
                  })}
              </React.Fragment>
            );
          })}

        {/* Add Track Action Row */}
        <div className="board-add-track-row">
          <button
            type="button"
            className="board-add-btn"
            onClick={() => onAddTrack('sample')}
            title="Add audio track"
          >
            <Plus size={12} /> AUDIO
          </button>
          <button
            type="button"
            className="board-add-btn"
            onClick={() => onAddTrack('sequencer')}
            title="Add drum sequencer track"
          >
            <Drum size={12} /> DRUMS
          </button>
          <button
            type="button"
            className="board-add-btn"
            onClick={() => onAddTrack('pianoroll')}
            title="Add keyboard synth track"
          >
            <Key size={12} /> KEYS
          </button>
          <button
            type="button"
            className="board-add-btn"
            onClick={() => onAddTrack('strudel')}
            title="Add live code track"
          >
            <Plus size={12} /> CODE
          </button>
        </div>
      </div>
    </div>
  );
};
