import React from 'react';

export interface Props {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  label?: string;
  unit?: string;
  color?: string;
  className?: string;
}

export const Slider: React.FC<Props> = ({
  value,
  min,
  max,
  step = 1,
  onChange,
  label,
  unit = '',
  color = 'var(--primary)',
  className = '',
}) => {
  const percentage = ((value - min) / (max - min)) * 100;

  return (
    <div className={`cyber-slider-wrap ${className}`.trim()}>
      {(label || unit) && (
        <div className="cyber-slider-header">
          {label && <span className="cyber-slider-label">{label}</span>}
          <span className="cyber-slider-val">
            {value}
            {unit}
          </span>
        </div>
      )}
      <div className="cyber-slider-track">
        <input
          type="range"
          aria-label={label}
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="cyber-slider-input"
          style={{
            '--slider-color': color,
            '--slider-pct': `${percentage}%`,
          } as React.CSSProperties}
        />
      </div>
    </div>
  );
};

