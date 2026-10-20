import React, { useState } from 'react';
import { useDawStore, DAWTrack, DSPFxConfig, DEFAULT_FX, isTrackFxModified } from '../../lib/daw/store';
import { DEFAULT_WAVE_SCULPT, isIdentityWaveSculpt } from '../../lib/daw/peaks';
import { getStemColor, formatTrackBadgeCode } from '../../lib/daw/palette';
import { Power, RotateCcw } from 'lucide-react';
import { Tooltip } from './Tooltip';
import { Slider } from '../slider';

interface RackProps {
  track?: DAWTrack;
}

type RackModuleKey = keyof DSPFxConfig | 'sculpt';

const DSP_MODULES: { key: RackModuleKey; short: string; label: string; desc: string }[] = [
  { key: 'sculpt', short: 'WAV', label: 'Wave-Design & Peak-Sculpt', desc: 'Regional extremes (Crest, Drive) & monotone wave extension (Texture, Fades)' },
  { key: 'eq', short: 'EQ', label: '3-Band Equalizer', desc: 'Shape Low, Mid, and High frequency balance (±12 dB)' },
  { key: 'filter', short: 'FLT', label: 'Resonant Filter', desc: 'Multi-mode Lowpass, Highpass, or Bandpass frequency filter' },
  { key: 'distortion', short: 'DRV', label: 'Harmonic Drive', desc: 'Warm tube overdrive and harmonic saturation' },
  { key: 'chorus', short: 'CHR', label: 'Stereo Chorus', desc: 'Modulated stereo widening and detuned ensemble' },
  { key: 'delay', short: 'DLY', label: 'Feedback Delay', desc: 'Tempo-synced stereo echo with feedback control' },
  { key: 'reverb', short: 'REV', label: 'Studio Reverb', desc: 'Algorithmic spatial room & hall decay' },
  { key: 'compressor', short: 'CMP', label: 'Bus Compressor', desc: 'Dynamic range compression (Threshold, Ratio, Attack, Release)' },
  { key: 'spatial', short: '3D', label: '3D Binaural Spatial Panner', desc: 'HRTF 3D spatial placement (Azimuth, Elevation, Distance)' },
];

export const Rack: React.FC<RackProps> = ({ track }) => {
  const tracks = useDawStore((s) => s.tracks);
  const selectedTrackId = useDawStore((s) => s.selectedTrackId);
  const setSelectedTrackId = useDawStore((s) => s.setSelectedTrackId);
  const updateTrackFx = useDawStore((s) => s.updateTrackFx);
  const updateTrackSculpt = useDawStore((s) => s.updateTrackSculpt);
  const resetTrackSculpt = useDawStore((s) => s.resetTrackSculpt);
  const [activeFxKey, setActiveFxKey] = useState<RackModuleKey>('sculpt');
  const currentTrack = track ?? tracks.find((t) => t.id === selectedTrackId) ?? tracks[0];
  if (!currentTrack) return <div className="dsp-rack-wrap">Select a lane to edit its effects.</div>;

  const rawFx = currentTrack.fx || ({} as Partial<DSPFxConfig>);
  const fx: DSPFxConfig = {
    eq: { ...DEFAULT_FX.eq, ...(rawFx.eq || {}) },
    filter: { ...DEFAULT_FX.filter, ...(rawFx.filter || {}) },
    distortion: { ...DEFAULT_FX.distortion, ...(rawFx.distortion || {}) },
    chorus: { ...DEFAULT_FX.chorus, ...(rawFx.chorus || {}) },
    delay: { ...DEFAULT_FX.delay, ...(rawFx.delay || {}) },
    reverb: { ...DEFAULT_FX.reverb, ...(rawFx.reverb || {}) },
    compressor: { ...DEFAULT_FX.compressor, ...(rawFx.compressor || {}) },
    spatial: { ...DEFAULT_FX.spatial, ...(rawFx.spatial || {}) },
  };
  const sculpt = currentTrack.sculpt || DEFAULT_WAVE_SCULPT;
  const isSculptActive = !isIdentityWaveSculpt(sculpt);
  const isAnyFxModified = isTrackFxModified(currentTrack);
  const trackColor = currentTrack.id === 'master' ? 'var(--accent)' : getStemColor(currentTrack.name);
  const trackShortCode = formatTrackBadgeCode(currentTrack);

  const cycleTargetTrack = () => {
    if (tracks.length <= 1) return;
    const idx = tracks.findIndex((t) => t.id === currentTrack.id);
    const nextTrack = tracks[(idx + 1) % tracks.length];
    if (nextTrack) setSelectedTrackId(nextTrack.id);
  };

  const handleFxChange = <K extends keyof DSPFxConfig>(fxKey: K, partial: Partial<DSPFxConfig[K]>) => {
    const nextPartial = 'enabled' in partial ? partial : ({ ...partial, enabled: true } as Partial<DSPFxConfig[K]>);
    updateTrackFx(currentTrack.id, fxKey, nextPartial);
  };

  return (
    <div className="dsp-rack-wrap">
      {/* Single-Row FX Chain Bar (allows instant 1-row module switching on mobile & quick bypass overview) */}
      <div className="dsp-chain-bar">
        <Tooltip
          title={`FX Target: ${currentTrack.name}`}
          description="Click to cycle FX target channel across Master & Lanes"
        >
          <button
            type="button"
            onClick={cycleTargetTrack}
            className={`dsp-track-target-pill ${isAnyFxModified ? 'is-modified' : ''}`}
            style={{ '--channel-color': trackColor } as React.CSSProperties}
          >
            <span className="dsp-track-target-dot" />
            <span>{trackShortCode}</span>
            {isAnyFxModified && <span className="dsp-track-target-dirty" />}
          </button>
        </Tooltip>
        {DSP_MODULES.map((mod) => {
          const isEnabled = mod.key === 'sculpt' ? isSculptActive : fx[mod.key].enabled;
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
        {isAnyFxModified && (
          <span className="dsp-modified-badge" title="Active uncommitted DSP / Wave Sculpt modifications">
            MOD
          </span>
        )}
      </div>

      {/* Grid of DSP Modules */}
      <div className="dsp-modules-grid">
        {/* 0. Wave-Design & Peak-Sculpting Module */}
        <div className={`dsp-module-card ${!isSculptActive ? 'disabled' : ''} ${activeFxKey === 'sculpt' ? 'active-module' : ''}`}>
          <div className="dsp-module-header">
            <span className="dsp-module-title">WAVE SCULPT</span>
            <button
              type="button"
              onClick={() => resetTrackSculpt(currentTrack.id)}
              className={`dsp-power-btn ${isSculptActive ? 'active' : ''}`}
              title="Reset Wave-Design & Peak-Sculpting"
              disabled={!isSculptActive}
            >
              <RotateCcw size={10} /> RESET
            </button>
          </div>
          <div className="dsp-control-group">
            <RangeSlider
              label="PEAK CREST"
              min={-1}
              max={1}
              step={0.05}
              value={sculpt.crest}
              defaultValue={0}
              onChange={(val) => updateTrackSculpt(currentTrack.id, { crest: val })}
              unit=""
              isPercent
            />
            <RangeSlider
              label="WAVE TEXTURE"
              min={-1}
              max={1}
              step={0.05}
              value={sculpt.texture}
              defaultValue={0}
              onChange={(val) => updateTrackSculpt(currentTrack.id, { texture: val })}
              unit=""
              isPercent
            />
            <RangeSlider
              label="PEAK DRIVE"
              min={0}
              max={1}
              step={0.05}
              value={sculpt.drive}
              defaultValue={0}
              onChange={(val) => updateTrackSculpt(currentTrack.id, { drive: val })}
              unit=""
              isPercent
            />
            <RangeSlider
              label="FADE IN"
              min={0}
              max={0.45}
              step={0.01}
              value={sculpt.fadeIn}
              defaultValue={0}
              onChange={(val) => updateTrackSculpt(currentTrack.id, { fadeIn: val })}
              unit=""
              isPercent
            />
            <RangeSlider
              label="FADE OUT"
              min={0}
              max={0.45}
              step={0.01}
              value={sculpt.fadeOut}
              defaultValue={0}
              onChange={(val) => updateTrackSculpt(currentTrack.id, { fadeOut: val })}
              unit=""
              isPercent
            />
          </div>
        </div>
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
              defaultValue={0}
              onChange={(val) => handleFxChange('eq', { low: val })}
              unit="dB"
            />
            <RangeSlider
              label="MID"
              min={-12}
              max={12}
              step={0.5}
              value={fx.eq.mid}
              defaultValue={0}
              onChange={(val) => handleFxChange('eq', { mid: val })}
              unit="dB"
            />
            <RangeSlider
              label="HIGH"
              min={-12}
              max={12}
              step={0.5}
              value={fx.eq.high}
              defaultValue={0}
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
              defaultValue={18000}
              onChange={(val) => handleFxChange('filter', { cutoff: val })}
              unit="Hz"
            />
            <RangeSlider
              label="RESONANCE"
              min={0.1}
              max={18}
              step={0.2}
              value={fx.filter.resonance}
              defaultValue={1}
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
              defaultValue={0.2}
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
              defaultValue={0.5}
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
              defaultValue={1.5}
              onChange={(val) => handleFxChange('chorus', { rate: val })}
              unit="Hz"
            />
            <RangeSlider
              label="DEPTH"
              min={0}
              max={1}
              step={0.05}
              value={fx.chorus.depth}
              defaultValue={0.5}
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
              defaultValue={0.4}
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
              defaultValue={0.25}
              onChange={(val) => handleFxChange('delay', { delayTime: val })}
              unit="s"
            />
            <RangeSlider
              label="FEEDBACK"
              min={0.05}
              max={0.9}
              step={0.05}
              value={fx.delay.feedback}
              defaultValue={0.35}
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
              defaultValue={0.3}
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
              defaultValue={2.5}
              onChange={(val) => handleFxChange('reverb', { decay: val })}
              unit="s"
            />
            <RangeSlider
              label="MIX"
              min={0}
              max={1}
              step={0.05}
              value={fx.reverb.wet}
              defaultValue={0.3}
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
              defaultValue={-18}
              onChange={(val) => handleFxChange('compressor', { threshold: val })}
              unit="dB"
            />
            <RangeSlider
              label="RATIO"
              min={1}
              max={20}
              step={0.5}
              value={fx.compressor.ratio}
              defaultValue={4}
              onChange={(val) => handleFxChange('compressor', { ratio: val })}
              unit=":1"
            />
            <RangeSlider
              label="ATTACK"
              min={0.001}
              max={0.2}
              step={0.005}
              value={fx.compressor.attack}
              defaultValue={0.01}
              onChange={(val) => handleFxChange('compressor', { attack: val })}
              unit="s"
            />
            <RangeSlider
              label="RELEASE"
              min={0.01}
              max={1}
              step={0.05}
              value={fx.compressor.release}
              defaultValue={0.2}
              onChange={(val) => handleFxChange('compressor', { release: val })}
              unit="s"
            />
          </div>
        </div>

        {/* 8. 3D BINAURAL SPATIAL PANNER (HRTF) */}
        <div
          className={`dsp-module-card ${fx.spatial.enabled ? 'enabled' : ''} ${activeFxKey === 'spatial' ? 'active-module' : ''}`}
          onClick={() => setActiveFxKey('spatial')}
        >
          <div className="dsp-module-header">
            <span className="dsp-module-title">3D BINAURAL (HRTF)</span>
            <PowerToggle
              enabled={fx.spatial.enabled}
              onToggle={(enabled) => handleFxChange('spatial', { enabled })}
            />
          </div>
          <div className="dsp-control-group">
            <RangeSlider
              label="AZIMUTH"
              min={-180}
              max={180}
              step={1}
              value={fx.spatial.azimuth}
              defaultValue={0}
              onChange={(val) => handleFxChange('spatial', { azimuth: val })}
              unit="°"
            />
            <RangeSlider
              label="ELEVATION"
              min={-90}
              max={90}
              step={1}
              value={fx.spatial.elevation}
              defaultValue={0}
              onChange={(val) => handleFxChange('spatial', { elevation: val })}
              unit="°"
            />
            <RangeSlider
              label="DISTANCE"
              min={0.1}
              max={10}
              step={0.1}
              value={fx.spatial.distance}
              defaultValue={1}
              onChange={(val) => handleFxChange('spatial', { distance: val })}
              unit="m"
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
  defaultValue: number;
  onChange: (val: number) => void;
  unit: string;
  isPercent?: boolean;
}> = ({ label, min, max, step, value, defaultValue, onChange, unit, isPercent }) => (
  <Slider
    label={label}
    min={min}
    max={max}
    step={step}
    value={value}
    defaultValue={defaultValue}
    onChange={onChange}
    unit={unit}
    formatValue={isPercent ? (val) => `${Math.round(val * 100)}%` : undefined}
  />
);
