import React, { useState, useEffect } from 'react';
import { useDawStore, DAWTrack } from '../../lib/daw/store';
import { dawEngine } from '../../lib/daw/engine';
import { Button } from '../button';
import { Play, Square, Repeat, Sliders, Activity } from 'lucide-react';
import { getStemColor } from '../../lib/daw/palette';

interface ChannelStripProps {
  track: DAWTrack;
  isMaster?: boolean;
}

const ChannelStrip: React.FC<ChannelStripProps> = ({ track, isMaster = false }) => {
  const {
    updateTrackMixer,
    updateTrackFx,
    selection,
    sectionGain,
    sectionLow,
    sectionMid,
    sectionHigh,
    setSectionGain,
    setSectionTone,
    extractCurrentSection,
    isPlaying,
    setPlaying,
    selectedTrackId,
    setSelectedTrackId,
  } = useDawStore();
  const [level, setLevel] = useState(-Infinity);
  const [peak, setPeak] = useState(-Infinity);
  useEffect(() => {
    let frame: number;
    const update = () => { const value = dawEngine.level(track.id); setLevel(value); setPeak(peak => Math.max(peak, value)); frame = requestAnimationFrame(update); };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [track.id]);
  const selectionStart = selection?.start ?? null;
  const selectionEnd = selection?.end ?? null;

  // Tone controls: BASS (120Hz), MID (1kHz), HIGH (6kHz) in dB (-12 to +12)
  const [eqLow, setEqLow] = useState<number>(track.fx?.eq?.low ?? 0);
  const [eqMid, setEqMid] = useState<number>(track.fx?.eq?.mid ?? 0);
  const [eqHigh, setEqHigh] = useState<number>(track.fx?.eq?.high ?? 0);

  // Smoothing filter cutoff (200Hz to 20,000Hz)
  const [cutoff, setCutoff] = useState<number>(track.fx?.filter?.cutoff ?? 20000);

  const vol = track.mixer?.volume ?? 1.0;
  const pan = track.mixer?.pan ?? 0.0;
  const isMuted = track.mixer?.muted ?? false;
  const isSoloed = track.mixer?.solo ?? false;

  const accentColor = isMaster ? '#00ffff' : getStemColor(track.name);

  const handleEqChange = (band: 'low' | 'mid' | 'high', val: number) => {
    if (band === 'low') setEqLow(val);
    if (band === 'mid') setEqMid(val);
    if (band === 'high') setEqHigh(val);

    const updated = {
      low: band === 'low' ? val : eqLow,
      mid: band === 'mid' ? val : eqMid,
      high: band === 'high' ? val : eqHigh,
    };
    dawEngine.updateTrackFx(track.id, 'eq', updated);
    updateTrackFx(track.id, 'eq', updated);
  };

  const handleCutoffChange = (val: number) => {
    setCutoff(val);
    const filterConfig = { cutoff: val, resonance: 1.0 };
    dawEngine.updateTrackFx(track.id, 'filter', filterConfig);
    updateTrackFx(track.id, 'filter', filterConfig);
  };

  const handleVolChange = (val: number) => {
    updateTrackMixer(track.id, { volume: val });
  };

  const handlePanChange = (val: number) => {
    updateTrackMixer(track.id, { pan: val });
  };

  const handleAudition = () => {
    const start = selectionStart ?? 0;
    const end = selectionEnd ?? undefined;
    dawEngine.auditionTrack(track.id, start, end);
  };

  // Convert volume (0.0 - 1.5) to approximate dB display
  const volDb = vol > 0.0001 ? (20 * Math.log10(vol)).toFixed(1) : '-inf';

  const isSelected = selectedTrackId === track.id || (isMaster && selectedTrackId === 'master');

  return (
    <div
      className={`mixer-strip ${isMaster ? 'mixer-strip-master' : ''} ${isSelected ? 'selected' : ''}`}
      style={{ '--accent-color': accentColor } as React.CSSProperties}
      onClick={() => setSelectedTrackId(track.id)}
    >
      {/* Strip Header */}
      <div className="mixer-strip-header">
        <div className="mixer-strip-badge" style={{ backgroundColor: accentColor }}>
          {isMaster ? 'MST' : (track.name.slice(0, 3).toUpperCase())}
        </div>
        <div className="mixer-strip-title" title={track.name}>
          {track.name}
        </div>
      </div>

      {/* Comprehensive Real-time Section Processor (Master Only when section is selected) */}
      {isMaster && selection && (
        <div className="mixer-section-group mixer-section-group-warning">
          <div className="mixer-group-label mixer-group-label-warning">
            SECTION [{selection.start.toFixed(1)}s – {selection.end.toFixed(1)}s]
          </div>

          <div className="mixer-tone-controls">
            <div className="mixer-knob-cell">
              <span className="mixer-knob-name mixer-knob-warning">TRIM</span>
              <input
                type="range"
                className="mixer-rotary-slider"
                min="-24"
                max="12"
                step="0.5"
                value={sectionGain}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setSectionGain(val);
                }}
              />
              <span className="mixer-knob-readout mixer-knob-warning">
                {sectionGain > 0 ? `+${sectionGain}` : sectionGain} dB
              </span>
            </div>

            <div className="mixer-knob-cell">
              <span className="mixer-knob-name">BASS</span>
              <input
                type="range"
                className="mixer-rotary-slider"
                min="-12"
                max="12"
                step="0.5"
                value={sectionLow}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setSectionTone(val, sectionMid, sectionHigh);
                }}
              />
              <span className="mixer-knob-readout">
                {sectionLow > 0 ? `+${sectionLow}` : sectionLow} dB
              </span>
            </div>

            <div className="mixer-knob-cell">
              <span className="mixer-knob-name">MID</span>
              <input
                type="range"
                className="mixer-rotary-slider"
                min="-12"
                max="12"
                step="0.5"
                value={sectionMid}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setSectionTone(sectionLow, val, sectionHigh);
                }}
              />
              <span className="mixer-knob-readout">
                {sectionMid > 0 ? `+${sectionMid}` : sectionMid} dB
              </span>
            </div>

            <div className="mixer-knob-cell">
              <span className="mixer-knob-name">HIGH</span>
              <input
                type="range"
                className="mixer-rotary-slider"
                min="-12"
                max="12"
                step="0.5"
                value={sectionHigh}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setSectionTone(sectionLow, sectionMid, val);
                }}
              />
              <span className="mixer-knob-readout">
                {sectionHigh > 0 ? `+${sectionHigh}` : sectionHigh} dB
              </span>
            </div>
          </div>

          <div className="mixer-section-actions">
            <button
              type="button"
              className={`mixer-audition-btn mixer-audition-btn-warning ${isPlaying ? 'playing' : ''}`}
              onClick={() => {
                if (isPlaying) {
                  dawEngine.pauseTransport();
                  setPlaying(false);
                } else {
                  dawEngine.auditionSection(selection.start, selection.end, false);
                  setPlaying(true);
                }
              }}
            >
              {isPlaying ? 'STOP' : 'AUDITION'}
            </button>

            <button
              type="button"
              className="mixer-audition-btn mixer-audition-btn-loop"
              onClick={() => {
                dawEngine.auditionSection(selection.start, selection.end, true);
                setPlaying(true);
              }}
            >
              LOOP
            </button>

            <button
              type="button"
              className="mixer-audition-btn mixer-audition-btn-extract"
              onClick={async () => {
                await extractCurrentSection();
              }}
            >
              ✂ EXTRACT SECTION
            </button>
          </div>
        </div>
      )}

      {/* Tone Controls (EQ3) - shown when not in section trim mode on master */}
      {!(isMaster && selection) && (
        <div className="mixer-section-group">
          <div className="mixer-group-label">TONE (EQ)</div>
          <div className="mixer-tone-controls">
            <div className="mixer-knob-cell">
              <span className="mixer-knob-name">HIGH</span>
              <input
                type="range"
                className="mixer-rotary-slider"
                min="-12"
                max="12"
                step="0.5"
                value={eqHigh}
                onChange={(e) => handleEqChange('high', parseFloat(e.target.value))}
              />
              <span className="mixer-knob-readout">{eqHigh > 0 ? `+${eqHigh}` : eqHigh} dB</span>
            </div>

            <div className="mixer-knob-cell">
              <span className="mixer-knob-name">MID</span>
              <input
                type="range"
                className="mixer-rotary-slider"
                min="-12"
                max="12"
                step="0.5"
                value={eqMid}
                onChange={(e) => handleEqChange('mid', parseFloat(e.target.value))}
              />
              <span className="mixer-knob-readout">{eqMid > 0 ? `+${eqMid}` : eqMid} dB</span>
            </div>

            <div className="mixer-knob-cell">
              <span className="mixer-knob-name">BASS</span>
              <input
                type="range"
                className="mixer-rotary-slider"
                min="-12"
                max="12"
                step="0.5"
                value={eqLow}
                onChange={(e) => handleEqChange('low', parseFloat(e.target.value))}
              />
              <span className="mixer-knob-readout">{eqLow > 0 ? `+${eqLow}` : eqLow} dB</span>
            </div>
          </div>
        </div>
      )}

      {/* Smoothing Filter & Stereo Pan */}
      <div className="mixer-dual-row">
        <div className="mixer-section-group mixer-half">
          <div className="mixer-group-label">FILTER</div>
          <div className="mixer-smoothing-cell">
            <input
              type="range"
              className="mixer-filter-slider"
              min="200"
              max="20000"
              step="100"
              value={cutoff}
              onChange={(e) => handleCutoffChange(parseFloat(e.target.value))}
            />
            <span className="mixer-filter-readout">
              {cutoff >= 1000 ? `${(cutoff / 1000).toFixed(1)}k` : `${Math.round(cutoff)}`}
            </span>
          </div>
        </div>

        <div className="mixer-section-group mixer-half">
          <div className="mixer-group-label">PAN</div>
          <div className="mixer-pan-cell">
            <input
              type="range"
              className="mixer-pan-slider"
              min="-1.0"
              max="1.0"
              step="0.05"
              value={pan}
              onChange={(e) => handlePanChange(parseFloat(e.target.value))}
            />
            <span className="mixer-pan-readout">
              {pan === 0 ? 'C' : pan < 0 ? `L${Math.round(Math.abs(pan) * 100)}` : `R${Math.round(pan * 100)}`}
            </span>
          </div>
        </div>
      </div>

      {/* Solo, Mute & Audition Buttons */}
      <div className="mixer-button-cluster">
        <button
          className={`mixer-action-btn mixer-btn-solo ${isSoloed ? 'active' : ''}`}
          onClick={() => updateTrackMixer(track.id, { solo: !isSoloed })}
        >
          S
        </button>
        <button
          className={`mixer-action-btn mixer-btn-mute ${isMuted ? 'active' : ''}`}
          onClick={() => updateTrackMixer(track.id, { muted: !isMuted })}
        >
          M
        </button>
        <button
          className="mixer-action-btn mixer-btn-audition"
          title="Audition in isolation"
          onClick={handleAudition}
        >
          <Play size={10} />
        </button>
      </div>

      {/* Vertical Fader & Meter Area */}
      <div className="mixer-fader-well">
        <div className="mixer-meter-lane">
          <div
            className="mixer-meter-fill"
            data-level={Number.isFinite(level) ? level.toFixed(1) : 'silent'}
            title={`Peak: ${Number.isFinite(peak) ? peak.toFixed(1) : '-∞'} dB`}
            style={{
              height: `${Math.min(100, Math.max(0, (level + 60) / 60 * 100))}%`,
              backgroundColor: accentColor,
            }}
          />
        </div>
        <input
          type="range"
          className="mixer-vertical-fader"
          min="0.0"
          max="1.3"
          step="0.01"
          value={vol}
          onChange={(e) => handleVolChange(parseFloat(e.target.value))}
        />
      </div>

      {/* Fader Readout */}
      <div className="mixer-fader-readout">
        {volDb} dB
      </div>
    </div>
  );
};

export const Mixer: React.FC = () => {
  const { tracks, selection, duration, isPlaying, setPlaying } = useDawStore();
  const selectionStart = selection?.start ?? null;
  const selectionEnd = selection?.end ?? null;

  const masterTrack = tracks.find((t) => t.id === 'master') || {
    id: 'master',
    name: 'Master',
    volume: 1.0,
    pan: 0.0,
    muted: false,
    solo: false,
    clips: [],
  };

  const stemTracks = tracks.filter((t) => t.id !== 'master');

  const hasSelection = selectionStart !== null && selectionEnd !== null && selectionEnd > selectionStart;

  const handleAuditionSection = () => {
    if (hasSelection) {
      dawEngine.auditionSection(selectionStart!, selectionEnd!, true);
      setPlaying(true);
    } else {
      dawEngine.seek(0);
      dawEngine.startTransport();
      setPlaying(true);
    }
  };

  const handleStopAudition = () => {
    dawEngine.pauseTransport();
    setPlaying(false);
  };

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = (sec % 60).toFixed(2);
    return `${m}:${Number(s) < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="mixer-console-container">
      {/* Top Console Bar */}
      <div className="mixer-console-bar">
        <div className="mixer-console-title-group">
          <Sliders size={18} className="text-cyan-400" />
          <span className="mixer-console-title">Hardware Console Mixer</span>
          <span className="mixer-console-subtitle">Sample-Accurate Multi-Track Tone & Smoothing</span>
        </div>

        {/* Section Audition Controller */}
        <div className="mixer-section-audition-bar">
          <div className="mixer-selection-indicator">
            <span className="mixer-selection-label">ACTIVE SECTION:</span>
            <span className="mixer-selection-bounds">
              {hasSelection
                ? `${formatTime(selectionStart!)} ➔ ${formatTime(selectionEnd!)} (${(selectionEnd! - selectionStart!).toFixed(2)}s)`
                : `Full Song (0:00.00 ➔ ${formatTime(duration)})`}
            </span>
          </div>

          <div className="mixer-section-buttons">
            <Button
              size="sm"
              variant={isPlaying ? 'destructive' : 'default'}
              onClick={isPlaying ? handleStopAudition : handleAuditionSection}
            >
              {isPlaying ? <Square size={13} /> : <Repeat size={13} />}
              {isPlaying ? 'STOP' : 'AUDITION SECTION LOOP'}
            </Button>
          </div>
        </div>
      </div>

      {/* Channel Strips Bay */}
      <div className="mixer-strips-bay">
        {/* Master Strip */}
        <ChannelStrip track={masterTrack as DAWTrack} isMaster={true} />

        <div className="mixer-strips-divider" />

        {/* Stem Strips */}
        {stemTracks.length > 0 ? (
          stemTracks.map((track) => (
            <ChannelStrip key={track.id} track={track} isMaster={false} />
          ))
        ) : (
          <div className="mixer-no-stems-placeholder">
            <Activity size={24} className="text-zinc-600 mb-2" />
            <span>No isolated stems yet.</span>
            <span className="text-xs text-zinc-500">Run stem separation in the timeline to mix tracks individually.</span>
          </div>
        )}
      </div>
    </div>
  );
};
