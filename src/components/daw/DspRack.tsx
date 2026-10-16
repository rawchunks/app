import React, { useState } from 'react';
import { useDawStore, DAWTrack, DSPFxConfig } from '../../lib/daw/store';
import { Power } from 'lucide-react';
import { Tooltip } from './Tooltip';

interface DspRackProps {
  track?: DAWTrack;
}

const DSP_MODULES: { key: keyof DSPFxConfig; short: string; label: string; desc: string }[] = [
  { key: 'eq', short: 'EQ', label: '3-Band Equalizer', desc: 'Shape Low, Mid, and High frequency balance (±12 dB)' },
  { key: 'filter', short: 'FLT', label: 'Resonant Filter', desc: 'Multi-mode Lowpass, Highpass, or Bandpass frequency filter' },
  { key: 'distortion', short: 'DRV', label: 'Harmonic Drive', desc: 'Warm tube overdrive and harmonic saturation' },
  { key: 'chorus', short: 'CHR', label: 'Stereo Chorus', desc: 'Modulated stereo widening and detuned ensemble' },
  { key: 'delay', short: 'DLY', label: 'Feedback Delay', desc: 'Tempo-synced stereo echo with feedback control' },
  { key: 'reverb', short: 'REV', label: 'Studio Reverb', desc: 'Algorithmic spatial room & hall decay' },
  { key: 'compressor', short: 'CMP', label: 'Bus Compressor', desc: 'Dynamic range compression (Threshold, Ratio, Attack, Release)' },
];

const DEFAULT_FX_FALLBACK: DSPFxConfig = {
  eq: { enabled: false, low: 0, mid: 0, high: 0 },
  filter: { enabled: false, type: 'lowpass', cutoff: 2000, resonance: 1 },
  distortion: { enabled: false, drive: 0.2, wet: 0.5 },
  chorus: { enabled: false, rate: 1.5, depth: 0.5, wet: 0.4 },
  delay: { enabled: false, delayTime: 0.25, feedback: 0.35, wet: 0.3 },
  reverb: { enabled: false, decay: 2.0, wet: 0.3 },
  compressor: { enabled: false, threshold: -18, ratio: 4, attack: 0.01, release: 0.15 },
};

export const DspRack: React.FC<DspRackProps> = ({ track }) => {
  const { tracks, selectedTrackId, updateTrackFx } = useDawStore();
  const [activeFxKey, setActiveFxKey] = useState<keyof DSPFxConfig>('eq');
  const currentTrack = track ?? tracks.find((t) => t.id === selectedTrackId);
  if (!currentTrack) return <div className="dsp-rack-wrap">Select a lane to edit its effects.</div>;

  const rawFx = currentTrack.fx || ({} as Partial<DSPFxConfig>);
  const fx: DSPFxConfig = {
    eq: { ...DEFAULT_FX_FALLBACK.eq, ...(rawFx.eq || {}) },
    filter: { ...DEFAULT_FX_FALLBACK.filter, ...(rawFx.filter || {}) },
    distortion: { ...DEFAULT_FX_FALLBACK.distortion, ...(rawFx.distortion || {}) },
    chorus: { ...DEFAULT_FX_FALLBACK.chorus, ...(rawFx.chorus || {}) },
    delay: { ...DEFAULT_FX_FALLBACK.delay, ...(rawFx.delay || {}) },
    reverb: { ...DEFAULT_FX_FALLBACK.reverb, ...(rawFx.reverb || {}) },
    compressor: { ...DEFAULT_FX_FALLBACK.compressor, ...(rawFx.compressor || {}) },
  };

  const handleFxChange = <K extends keyof DSPFxConfig>(fxKey: K, partial: Partial<DSPFxConfig[K]>) => {
    updateTrackFx(currentTrack.id, fxKey, partial);
  };

  return (
    <div className="dsp-rack-wrap">
      {/* Single-Row FX Chain Bar (allows instant 1-row module switching on mobile & quick bypass overview) */}
      <div className="dsp-chain-bar">
        {DSP_MODULES.map((mod) => {
          const isEnabled = fx[mod.key].enabled;
          const isFocused = activeFxKey === mod.key;
          return (
            <Tooltip key={mod.key} title={mod.label} description={mod.desc}>
              <button
                type="button"
                onClick={() => setActiveFxKey(mod.key)}
                className={`dsp-chain-pill ${isFocused ? 'focused' : ''} ${isEnabled ? 'enabled' : ''}`}
              >
                <span className={`dsp-chain-led ${isEnabled ? 'on' : ''}`} />
                <span>{mod.short}</span>
              </button>
            </Tooltip>
          );
        })}
      </div>

      {/* Grid of 7 DSP Modules */}
      <div className="dsp-modules-grid">
        {/* 1. EQ3 Module */}
        <div className={`dsp-module-card ${!fx.eq.enabled ? 'disabled' : ''} ${activeFxKey === 'eq' ? 'active-module' : ''}`}>
          <div className="dsp-module-header">
            <span className="dsp-module-title">EQ</span>
            <PowerToggle
              enabled={fx.eq.enabled}
              onToggle={(enabled) => handleFxChange('eq', { enabled })}
            />
          </div>
          <div className="dsp-control-group">
            <RangeSlider
              label="LOW"
              min={-12}
              max={12}
              step={0.5}
              value={fx.eq.low}
              onChange={(val) => handleFxChange('eq', { low: val })}
              unit="dB"
            />
            <RangeSlider
              label="MID"
              min={-12}
              max={12}
              step={0.5}
              value={fx.eq.mid}
              onChange={(val) => handleFxChange('eq', { mid: val })}
              unit="dB"
            />
            <RangeSlider
              label="HIGH"
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
        <div className={`dsp-module-card ${!fx.filter.enabled ? 'disabled' : ''} ${activeFxKey === 'filter' ? 'active-module' : ''}`}>
          <div className="dsp-module-header">
            <span className="dsp-module-title">FILTER</span>
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
              label="CUTOFF"
              min={60}
              max={18000}
              step={50}
              value={fx.filter.cutoff}
              onChange={(val) => handleFxChange('filter', { cutoff: val })}
              unit="Hz"
            />
            <RangeSlider
              label="RESONANCE"
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
        <div className={`dsp-module-card ${!fx.distortion.enabled ? 'disabled' : ''} ${activeFxKey === 'distortion' ? 'active-module' : ''}`}>
          <div className="dsp-module-header">
            <span className="dsp-module-title">DRIVE</span>
            <PowerToggle
              enabled={fx.distortion.enabled}
              onToggle={(enabled) => handleFxChange('distortion', { enabled })}
            />
          </div>
          <div className="dsp-control-group">
            <RangeSlider
              label="AMOUNT"
              min={0}
              max={1}
              step={0.05}
              value={fx.distortion.drive}
              onChange={(val) => handleFxChange('distortion', { drive: val })}
              unit=""
              isPercent
            />
            <RangeSlider
              label="MIX"
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
        <div className={`dsp-module-card ${!fx.chorus.enabled ? 'disabled' : ''} ${activeFxKey === 'chorus' ? 'active-module' : ''}`}>
          <div className="dsp-module-header">
            <span className="dsp-module-title">CHORUS</span>
            <PowerToggle
              enabled={fx.chorus.enabled}
              onToggle={(enabled) => handleFxChange('chorus', { enabled })}
            />
          </div>
          <div className="dsp-control-group">
            <RangeSlider
              label="RATE"
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
              label="MIX"
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
        <div className={`dsp-module-card ${!fx.delay.enabled ? 'disabled' : ''} ${activeFxKey === 'delay' ? 'active-module' : ''}`}>
          <div className="dsp-module-header">
            <span className="dsp-module-title">DELAY</span>
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
              label="TIME"
              min={0.05}
              max={1}
              step={0.05}
              value={fx.delay.delayTime}
              onChange={(val) => handleFxChange('delay', { delayTime: val })}
              unit="s"
            />
            <RangeSlider
              label="FEEDBACK"
              min={0.05}
              max={0.9}
              step={0.05}
              value={fx.delay.feedback}
              onChange={(val) => handleFxChange('delay', { feedback: val })}
              unit=""
              isPercent
            />
            <RangeSlider
              label="MIX"
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
        <div className={`dsp-module-card ${!fx.reverb.enabled ? 'disabled' : ''} ${activeFxKey === 'reverb' ? 'active-module' : ''}`}>
          <div className="dsp-module-header">
            <span className="dsp-module-title">REVERB</span>
            <PowerToggle
              enabled={fx.reverb.enabled}
              onToggle={(enabled) => handleFxChange('reverb', { enabled })}
            />
          </div>
          <div className="dsp-control-group">
            <RangeSlider
              label="DECAY"
              min={0.5}
              max={10}
              step={0.5}
              value={fx.reverb.decay}
              onChange={(val) => handleFxChange('reverb', { decay: val })}
              unit="s"
            />
            <RangeSlider
              label="MIX"
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
        <div className={`dsp-module-card ${!fx.compressor.enabled ? 'disabled' : ''} ${activeFxKey === 'compressor' ? 'active-module' : ''}`}>
          <div className="dsp-module-header">
            <span className="dsp-module-title">COMPRESSOR</span>
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
              label="RATIO"
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
