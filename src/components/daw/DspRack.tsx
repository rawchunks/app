import React from 'react';
import { useDawStore, DAWTrack, DSPFxConfig } from '../../lib/daw/store';
import { Badge } from '../badge';
import { Power, Activity } from 'lucide-react';

interface DspRackProps {
  track?: DAWTrack;
}

export const DspRack: React.FC<DspRackProps> = ({ track }) => {
  const { tracks, selectedTrackId, updateTrackFx } = useDawStore();
  const currentTrack = track ?? tracks.find((t) => t.id === selectedTrackId);
  if (!currentTrack) return <div className="dsp-rack-wrap">Select a lane to edit its effects.</div>;

  const fx = currentTrack.fx;

  const handleFxChange = <K extends keyof DSPFxConfig>(fxKey: K, partial: Partial<DSPFxConfig[K]>) => {
    updateTrackFx(currentTrack.id, fxKey, partial);
  };

  return (
    <div className="dsp-rack-wrap">
      {/* Rack Header */}
      <div className="stem-lane-header">
        <div className="stem-lane-info">
          <Activity size={18} color="#00ffff" />
          <h3 className="dsp-rack-title">7-EFFECT DSP CHANNEL STRIP</h3>
          <Badge
            variant="default"
            className="track-color-badge"
            style={{ '--track-color': currentTrack.color } as React.CSSProperties}
          >
            {currentTrack.name}
          </Badge>
        </div>
        <span className="dsp-rack-sub">
          SERIAL: EQ ➔ FILTER ➔ DISTORTION ➔ CHORUS ➔ DELAY ➔ REVERB ➔ COMP
        </span>
      </div>

      {/* Grid of 7 DSP Modules */}
      <div className="dsp-modules-grid">
        {/* 1. EQ3 Module */}
        <div className={`dsp-module-card ${!fx.eq.enabled ? 'disabled' : ''}`}>
          <div className="dsp-module-header">
            <span className="dsp-module-title">1. 3-BAND EQ</span>
            <PowerToggle
              enabled={fx.eq.enabled}
              onToggle={(enabled) => handleFxChange('eq', { enabled })}
            />
          </div>
          <div className="dsp-control-group">
            <RangeSlider
              label="LOW (-12 to +12 dB)"
              min={-12}
              max={12}
              step={0.5}
              value={fx.eq.low}
              onChange={(val) => handleFxChange('eq', { low: val })}
              unit="dB"
            />
            <RangeSlider
              label="MID (-12 to +12 dB)"
              min={-12}
              max={12}
              step={0.5}
              value={fx.eq.mid}
              onChange={(val) => handleFxChange('eq', { mid: val })}
              unit="dB"
            />
            <RangeSlider
              label="HIGH (-12 to +12 dB)"
              min={-12}
              max={12}
              step={0.5}
              value={fx.eq.high}
              onChange={(val) => handleFxChange('eq', { high: val })}
              unit="dB"
            />
          </div>
        </div>

        {/* 2. Filter Module */}
        <div className={`dsp-module-card ${!fx.filter.enabled ? 'disabled' : ''}`}>
          <div className="dsp-module-header">
            <span className="dsp-module-title">2. STATE-VARIABLE FILTER</span>
            <PowerToggle
              enabled={fx.filter.enabled}
              onToggle={(enabled) => handleFxChange('filter', { enabled })}
            />
          </div>
          <div className="dsp-control-group">
            <div className="dsp-filter-selector">
              {(['lowpass', 'highpass', 'bandpass'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => handleFxChange('filter', { type: mode })}
                  className={`transport-btn dsp-filter-btn ${fx.filter.type === mode ? 'transport-btn-active' : ''}`}
                >
                  {mode.slice(0, 4).toUpperCase()}
                </button>
              ))}
            </div>
            <RangeSlider
              label="CUTOFF FREQUENCY"
              min={60}
              max={18000}
              step={50}
              value={fx.filter.cutoff}
              onChange={(val) => handleFxChange('filter', { cutoff: val })}
              unit="Hz"
            />
            <RangeSlider
              label="RESONANCE (Q)"
              min={0.1}
              max={18}
              step={0.2}
              value={fx.filter.resonance}
              onChange={(val) => handleFxChange('filter', { resonance: val })}
              unit="Q"
            />
          </div>
        </div>

        {/* 3. Distortion Module */}
        <div className={`dsp-module-card ${!fx.distortion.enabled ? 'disabled' : ''}`}>
          <div className="dsp-module-header">
            <span className="dsp-module-title">3. SATURATION / DRIVE</span>
            <PowerToggle
              enabled={fx.distortion.enabled}
              onToggle={(enabled) => handleFxChange('distortion', { enabled })}
            />
          </div>
          <div className="dsp-control-group">
            <RangeSlider
              label="DRIVE AMOUNT"
              min={0}
              max={1}
              step={0.05}
              value={fx.distortion.drive}
              onChange={(val) => handleFxChange('distortion', { drive: val })}
              unit=""
              isPercent
            />
            <RangeSlider
              label="DRY / WET MIX"
              min={0}
              max={1}
              step={0.05}
              value={fx.distortion.wet}
              onChange={(val) => handleFxChange('distortion', { wet: val })}
              unit=""
              isPercent
            />
          </div>
        </div>

        {/* 4. Chorus Module */}
        <div className={`dsp-module-card ${!fx.chorus.enabled ? 'disabled' : ''}`}>
          <div className="dsp-module-header">
            <span className="dsp-module-title">4. STEREO CHORUS</span>
            <PowerToggle
              enabled={fx.chorus.enabled}
              onToggle={(enabled) => handleFxChange('chorus', { enabled })}
            />
          </div>
          <div className="dsp-control-group">
            <RangeSlider
              label="LFO RATE"
              min={0.1}
              max={10}
              step={0.1}
              value={fx.chorus.rate}
              onChange={(val) => handleFxChange('chorus', { rate: val })}
              unit="Hz"
            />
            <RangeSlider
              label="DEPTH"
              min={0}
              max={1}
              step={0.05}
              value={fx.chorus.depth}
              onChange={(val) => handleFxChange('chorus', { depth: val })}
              unit=""
              isPercent
            />
            <RangeSlider
              label="DRY / WET MIX"
              min={0}
              max={1}
              step={0.05}
              value={fx.chorus.wet}
              onChange={(val) => handleFxChange('chorus', { wet: val })}
              unit=""
              isPercent
            />
          </div>
        </div>

        {/* 5. Feedback Delay Module */}
        <div className={`dsp-module-card ${!fx.delay.enabled ? 'disabled' : ''}`}>
          <div className="dsp-module-header">
            <span className="dsp-module-title">5. TEMPO FEEDBACK DELAY</span>
            <PowerToggle
              enabled={fx.delay.enabled}
              onToggle={(enabled) => handleFxChange('delay', { enabled })}
            />
          </div>
          <div className="dsp-control-group">
            <div className="dsp-filter-selector">
              {[
                { label: '1/8', val: 0.25 },
                { label: '1/4', val: 0.5 },
                { label: '1/2', val: 1.0 },
              ].map((div) => (
                <button
                  key={div.label}
                  type="button"
                  onClick={() => handleFxChange('delay', { delayTime: div.val })}
                  className={`transport-btn dsp-filter-btn ${Math.abs(fx.delay.delayTime - div.val) < 0.05 ? 'transport-btn-active' : ''}`}
                >
                  {div.label}
                </button>
              ))}
            </div>
            <RangeSlider
              label="DELAY TIME"
              min={0.05}
              max={1}
              step={0.05}
              value={fx.delay.delayTime}
              onChange={(val) => handleFxChange('delay', { delayTime: val })}
              unit="s"
            />
            <RangeSlider
              label="FEEDBACK DECAY"
              min={0.05}
              max={0.9}
              step={0.05}
              value={fx.delay.feedback}
              onChange={(val) => handleFxChange('delay', { feedback: val })}
              unit=""
              isPercent
            />
            <RangeSlider
              label="DRY / WET MIX"
              min={0}
              max={1}
              step={0.05}
              value={fx.delay.wet}
              onChange={(val) => handleFxChange('delay', { wet: val })}
              unit=""
              isPercent
            />
          </div>
        </div>

        {/* 6. Algorithmic Reverb Module */}
        <div className={`dsp-module-card ${!fx.reverb.enabled ? 'disabled' : ''}`}>
          <div className="dsp-module-header">
            <span className="dsp-module-title">6. ALGORITHMIC REVERB</span>
            <PowerToggle
              enabled={fx.reverb.enabled}
              onToggle={(enabled) => handleFxChange('reverb', { enabled })}
            />
          </div>
          <div className="dsp-control-group">
            <RangeSlider
              label="DECAY TIME"
              min={0.5}
              max={10}
              step={0.5}
              value={fx.reverb.decay}
              onChange={(val) => handleFxChange('reverb', { decay: val })}
              unit="s"
            />
            <RangeSlider
              label="DRY / WET MIX"
              min={0}
              max={1}
              step={0.05}
              value={fx.reverb.wet}
              onChange={(val) => handleFxChange('reverb', { wet: val })}
              unit=""
              isPercent
            />
          </div>
        </div>

        {/* 7. Master Bus Compressor Module */}
        <div className={`dsp-module-card ${!fx.compressor.enabled ? 'disabled' : ''}`}>
          <div className="dsp-module-header">
            <span className="dsp-module-title">7. BUS COMPRESSOR</span>
            <PowerToggle
              enabled={fx.compressor.enabled}
              onToggle={(enabled) => handleFxChange('compressor', { enabled })}
            />
          </div>
          <div className="dsp-control-group">
            <RangeSlider
              label="THRESHOLD"
              min={-48}
              max={0}
              step={1}
              value={fx.compressor.threshold}
              onChange={(val) => handleFxChange('compressor', { threshold: val })}
              unit="dB"
            />
            <RangeSlider
              label="COMPRESSION RATIO"
              min={1}
              max={20}
              step={0.5}
              value={fx.compressor.ratio}
              onChange={(val) => handleFxChange('compressor', { ratio: val })}
              unit=":1"
            />
            <RangeSlider
              label="ATTACK"
              min={0.001}
              max={0.2}
              step={0.005}
              value={fx.compressor.attack}
              onChange={(val) => handleFxChange('compressor', { attack: val })}
              unit="s"
            />
            <RangeSlider
              label="RELEASE"
              min={0.01}
              max={1}
              step={0.05}
              value={fx.compressor.release}
              onChange={(val) => handleFxChange('compressor', { release: val })}
              unit="s"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

const PowerToggle: React.FC<{ enabled: boolean; onToggle: (enabled: boolean) => void }> = ({ enabled, onToggle }) => (
  <button
    type="button"
    onClick={() => onToggle(!enabled)}
    className={`dsp-power-btn ${enabled ? 'active' : ''}`}
    title={enabled ? 'Bypass Effect' : 'Enable Effect'}
  >
    <Power size={10} /> {enabled ? 'ON' : 'OFF'}
  </button>
);

const RangeSlider: React.FC<{
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (val: number) => void;
  unit: string;
  isPercent?: boolean;
}> = ({ label, min, max, step, value, onChange, unit, isPercent }) => (
  <div>
    <div className="dsp-slider-row">
      <span>{label}</span>
      <span className="dsp-slider-val">
        {isPercent ? `${Math.round(value * 100)}%` : `${value}${unit}`}
      </span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="dsp-knob-slider"
    />
  </div>
);
