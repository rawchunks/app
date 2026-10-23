import React, { useState, useEffect } from 'react';
import {
  useDawStore,
  DAWTrack,
} from '../../lib/daw/store';
import { dawEngine } from '../../lib/daw/engine';
import { Tooltip } from './Tooltip';
import { Volume2 } from 'lucide-react';
import { getStemColor, formatTrackBadgeFull } from '../../lib/daw/palette';

interface HorizontalChannelDeckProps {
  track: DAWTrack;
  isMaster?: boolean;
  onCycleChannel?: () => void;
}

const HorizontalChannelDeck: React.FC<HorizontalChannelDeckProps> = ({
  track,
  isMaster = false,
  onCycleChannel,
}) => {
  const updateTrackMixer = useDawStore((s) => s.updateTrackMixer);
  const updateTrackFx = useDawStore((s) => s.updateTrackFx);
  const selection = useDawStore((s) => s.selection);
  const sectionGain = useDawStore((s) => s.sectionGain);
  const sectionLow = useDawStore((s) => s.sectionLow);
  const sectionMid = useDawStore((s) => s.sectionMid);
  const sectionHigh = useDawStore((s) => s.sectionHigh);
  const setSectionGain = useDawStore((s) => s.setSectionGain);
  const setSectionTone = useDawStore((s) => s.setSectionTone);
  const isPlaying = useDawStore((s) => s.isPlaying);
  const auditionId = useDawStore((s) => s.auditionId);

  const [level, setLevel] = useState(-Infinity);
  const [peak, setPeak] = useState(-Infinity);

  useEffect(() => {
    setPeak(-Infinity);
    if (!isPlaying && !auditionId) {
      setLevel(-Infinity);
      return;
    }
    let frame: number;
    const update = () => {
      const value = dawEngine.level(track.id);
      setLevel(value);
      setPeak((prev) => Math.max(prev, value));
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [track.id, isPlaying, auditionId]);

  // Sync local EQ & filter state when track changes
  const [eqLow, setEqLow] = useState<number>(track.fx?.eq?.low ?? 0);
  const [eqMid, setEqMid] = useState<number>(track.fx?.eq?.mid ?? 0);
  const [eqHigh, setEqHigh] = useState<number>(track.fx?.eq?.high ?? 0);
  const [cutoff, setCutoff] = useState<number>(track.fx?.filter?.cutoff ?? 20000);

  useEffect(() => {
    setEqLow(track.fx?.eq?.low ?? 0);
    setEqMid(track.fx?.eq?.mid ?? 0);
    setEqHigh(track.fx?.eq?.high ?? 0);
    setCutoff(track.fx?.filter?.cutoff ?? 20000);
  }, [track.id, track.fx?.eq?.low, track.fx?.eq?.mid, track.fx?.eq?.high, track.fx?.filter?.cutoff]);

  const vol = track.mixer?.volume ?? 1.0;
  const pan = track.mixer?.pan ?? 0.0;

  const accentColor = isMaster ? '#00ffff' : getStemColor(track.name);

  const handleEqChange = (band: 'low' | 'mid' | 'high', val: number) => {
    if (band === 'low') setEqLow(val);
    if (band === 'mid') setEqMid(val);
    if (band === 'high') setEqHigh(val);

    const low = band === 'low' ? val : eqLow;
    const mid = band === 'mid' ? val : eqMid;
    const high = band === 'high' ? val : eqHigh;
    const updated = {
      enabled: low !== 0 || mid !== 0 || high !== 0,
      low,
      mid,
      high,
    };
    updateTrackFx(track.id, 'eq', updated);
  };

  const handleCutoffChange = (val: number) => {
    setCutoff(val);
    const filterConfig = {
      enabled: val < 19900,
      cutoff: val,
      resonance: track.fx?.filter?.resonance ?? 1.0,
      type: track.fx?.filter?.type ?? ('lowpass' as const),
    };
    updateTrackFx(track.id, 'filter', filterConfig);
  };

  const handleVolChange = (val: number) => {
    updateTrackMixer(track.id, { volume: val });
  };

  const handlePanChange = (val: number) => {
    updateTrackMixer(track.id, { pan: val });
  };

  const volDb = vol > 0.0001 ? (20 * Math.log10(vol)).toFixed(1) : '-inf';
  const meterPct = Math.min(100, Math.max(0, ((level + 60) / 60) * 100));
  const isSectionMode = Boolean(isMaster && selection);

  const activeLow = isSectionMode ? sectionLow : eqLow;
  const activeMid = isSectionMode ? sectionMid : eqMid;
  const activeHigh = isSectionMode ? sectionHigh : eqHigh;

  return (
    <div
      className={`mixer-horizontal-deck ${isMaster ? 'mixer-deck-master' : ''}`}
      style={{ '--accent-color': accentColor } as React.CSSProperties}
    >
      {/* Row 1: Channel Identity + Horizontal Fader & Live Meter */}
      <div className="mixer-horiz-fader-row">
        <div className="mixer-horiz-identity">
          <Tooltip
            title={`Mixer Target: ${track.name}`}
            description="Click to cycle channel or pick any stem on the left"
          >
            <button
              type="button"
              onClick={onCycleChannel}
              className="mixer-strip-badge daw-badge"
            >
              {isMaster ? (selection ? 'MASTER•SEC' : 'MASTER') : formatTrackBadgeFull(track)}
            </button>
          </Tooltip>
          {isMaster && selection && (
            <span className="mixer-strip-title" title={track.name}>
              {`${selection.start.toFixed(1)}s–${selection.end.toFixed(1)}s`}
            </span>
          )}
        </div>

        <div className="mixer-horiz-fader-well" title="Double-click fader to reset to 0.0 dB">
          <Volume2 size={13} className="mixer-fader-icon" />
          <div className="mixer-horiz-fader-track-wrap">
            <div className="mixer-horiz-meter-lane">
              <div
                className="mixer-horiz-meter-fill"
                data-level={Number.isFinite(level) ? level.toFixed(1) : 'silent'}
                style={{ '--meter-w': `${meterPct}%` } as React.CSSProperties}
              />
            </div>
            <input
              type="range"
              className="mixer-horiz-fader"
              min="0.0"
              max="1.3"
              step="0.01"
              value={vol}
              onChange={(e) => handleVolChange(parseFloat(e.target.value))}
              onDoubleClick={() => handleVolChange(1.0)}
              aria-label={`${track.name} Volume`}
            />
          </div>
          <span
            className="mixer-fader-readout"
            title={`Peak: ${Number.isFinite(peak) ? peak.toFixed(1) : '-∞'} dB (Double-click to reset)`}
            onDoubleClick={() => handleVolChange(1.0)}
          >
            {volDb} dB
          </span>
        </div>
      </div>

      {/* Row 2: Proportional Horizontal Parameter Matrix (EQ / Filter / Pan / Optional Section Trim) */}
      <div className="mixer-horiz-matrix">
        {isSectionMode && (
          <div className="mixer-param-cell mixer-param-cell-warning" title="Double-click to reset Section Trim">
            <div className="mixer-param-header">
              <span className="mixer-knob-name mixer-knob-warning">TRIM</span>
              <span className="mixer-knob-readout mixer-knob-warning">
                {sectionGain > 0 ? `+${sectionGain}` : sectionGain} dB
              </span>
            </div>
            <input
              type="range"
              className="mixer-rotary-slider"
              min="-24"
              max="12"
              step="0.5"
              value={sectionGain}
              onChange={(e) => setSectionGain(parseFloat(e.target.value))}
              onDoubleClick={() => setSectionGain(0)}
            />
          </div>
        )}

        <div className="mixer-param-cell" title="Low Shelf 120Hz (Double-click to reset)">
          <div className="mixer-param-header">
            <span className="mixer-knob-name">BASS</span>
            <span className="mixer-knob-readout">{activeLow > 0 ? `+${activeLow}` : activeLow} dB</span>
          </div>
          <input
            type="range"
            className="mixer-rotary-slider"
            min="-12"
            max="12"
            step="0.5"
            value={activeLow}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              if (isSectionMode) setSectionTone(val, sectionMid, sectionHigh);
              else handleEqChange('low', val);
            }}
            onDoubleClick={() => {
              if (isSectionMode) setSectionTone(0, sectionMid, sectionHigh);
              else handleEqChange('low', 0);
            }}
          />
        </div>

        <div className="mixer-param-cell" title="Mid Peaking 1kHz (Double-click to reset)">
          <div className="mixer-param-header">
            <span className="mixer-knob-name">MID</span>
            <span className="mixer-knob-readout">{activeMid > 0 ? `+${activeMid}` : activeMid} dB</span>
          </div>
          <input
            type="range"
            className="mixer-rotary-slider"
            min="-12"
            max="12"
            step="0.5"
            value={activeMid}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              if (isSectionMode) setSectionTone(sectionLow, val, sectionHigh);
              else handleEqChange('mid', val);
            }}
            onDoubleClick={() => {
              if (isSectionMode) setSectionTone(sectionLow, 0, sectionHigh);
              else handleEqChange('mid', 0);
            }}
          />
        </div>

        <div className="mixer-param-cell" title="High Shelf 6kHz (Double-click to reset)">
          <div className="mixer-param-header">
            <span className="mixer-knob-name">HIGH</span>
            <span className="mixer-knob-readout">{activeHigh > 0 ? `+${activeHigh}` : activeHigh} dB</span>
          </div>
          <input
            type="range"
            className="mixer-rotary-slider"
            min="-12"
            max="12"
            step="0.5"
            value={activeHigh}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              if (isSectionMode) setSectionTone(sectionLow, sectionMid, val);
              else handleEqChange('high', val);
            }}
            onDoubleClick={() => {
              if (isSectionMode) setSectionTone(sectionLow, sectionMid, 0);
              else handleEqChange('high', 0);
            }}
          />
        </div>

        <div className="mixer-param-cell" title="Low-Pass Filter Cutoff (Double-click to reset)">
          <div className="mixer-param-header">
            <span className="mixer-knob-name">FILTER</span>
            <span className="mixer-filter-readout">
              {cutoff >= 1000 ? `${(cutoff / 1000).toFixed(1)}kHz` : `${Math.round(cutoff)}Hz`}
            </span>
          </div>
          <input
            type="range"
            className="mixer-filter-slider"
            min="200"
            max="20000"
            step="100"
            value={cutoff}
            onChange={(e) => handleCutoffChange(parseFloat(e.target.value))}
            onDoubleClick={() => handleCutoffChange(20000)}
          />
        </div>

        <div className="mixer-param-cell" title="Stereo Panning (Double-click to center)">
          <div className="mixer-param-header">
            <span className="mixer-knob-name">PAN</span>
            <span className="mixer-pan-readout">
              {pan === 0 ? 'C' : pan < 0 ? `L${Math.round(Math.abs(pan) * 100)}` : `R${Math.round(pan * 100)}`}
            </span>
          </div>
          <input
            type="range"
            className="mixer-pan-slider"
            min="-1.0"
            max="1.0"
            step="0.05"
            value={pan}
            onChange={(e) => handlePanChange(parseFloat(e.target.value))}
            onDoubleClick={() => handlePanChange(0)}
          />
        </div>
      </div>
    </div>
  );
};

export const Mixer: React.FC = () => {
  const tracks = useDawStore((s) => s.tracks);
  const selectedTrackId = useDawStore((s) => s.selectedTrackId);
  const setSelectedTrackId = useDawStore((s) => s.setSelectedTrackId);

  const masterTrack = tracks.find((t) => t.id === 'master') ?? tracks[0];
  if (!masterTrack) return null;

  const stemTracks = tracks.filter((t) => t.id !== 'master');
  const allChannels: DAWTrack[] = [masterTrack, ...stemTracks];

  const activeTrack =
    allChannels.find((t) => t.id === selectedTrackId) || masterTrack;
  const isActiveMaster = activeTrack.id === 'master';

  const cycleChannel = () => {
    if (allChannels.length <= 1) return;
    const idx = allChannels.findIndex((t) => t.id === activeTrack.id);
    const next = allChannels[(idx + 1) % allChannels.length];
    if (next) setSelectedTrackId(next.id);
  };

  return (
    <div className="mixer-console-container">
      <HorizontalChannelDeck
        track={activeTrack}
        isMaster={isActiveMaster}
        onCycleChannel={cycleChannel}
      />
    </div>
  );
};
