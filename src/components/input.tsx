import React from 'react';

export interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  multiline?: boolean;
  rows?: number;
  disabled?: boolean;
  type?: string;
  className?: string;
  style?: React.CSSProperties;
}

export const Input: React.FC<Props> = ({
  value,
  onChange,
  placeholder,
  label,
  multiline = false,
  rows = 4,
  disabled = false,
  type = 'text',
  className = '',
  style = {},
}) => {
  return (
    <div className={`cyber-input-wrap ${className}`}>
      {label && <span className="cyber-input-label">{label}</span>}
      {multiline ? (
        <textarea
          rows={rows}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="cyber-input-field"
          style={style}
        />
      ) : (
        <input
          type={type}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="cyber-input-field"
          style={style}
        />
      )}
    </div>
  );
};
