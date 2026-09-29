import React, { useState, useEffect } from 'react';

export interface Props {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'accent' | 'ghost' | 'default' | 'outline' | 'destructive' | 'warning';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
  href?: string;
  target?: string;
  title?: string;
}

export const Button: React.FC<Props> = ({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  className = '',
  style = {},
  disabled = false,
  href,
  target,
  title,
}) => {
  const [pressed, setPressed] = useState(false);
  const [pulse, setPulse] = useState(1);

  useEffect(() => {
    if (disabled) return;
    const interval = setInterval(() => {
      setPulse((p) => (p === 1 ? 1.015 : 1));
    }, 1800);
    return () => clearInterval(interval);
  }, [disabled]);

  const resolvedVariant =
    variant === 'default' ? 'primary' :
    variant === 'outline' ? 'ghost' :
    variant === 'destructive' || variant === 'warning' ? 'accent' :
    variant;

  const combinedClassName = [
    'btn-base',
    `btn-variant-${resolvedVariant}`,
    `btn-size-${size}`,
    pressed ? 'is-pressed' : '',
    className,
  ].filter(Boolean).join(' ');

  const dynamicStyle: React.CSSProperties = {
    transform: disabled ? undefined : `scale(${pulse})`,
    ...style,
  };

  if (href) {
    return (
      <a
        href={href}
        target={target}
        title={title}
        className={combinedClassName}
        style={dynamicStyle}
        onMouseDown={() => setPressed(true)}
        onMouseUp={() => setPressed(false)}
        onMouseLeave={() => setPressed(false)}
      >
        <div className="btn-glow-overlay" />
        <span className="btn-content-wrap">{children}</span>
      </a>
    );
  }

  return (
    <button
      type="button"
      title={title}
      className={combinedClassName}
      style={dynamicStyle}
      disabled={disabled}
      onClick={onClick}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
    >
      <div className="btn-glow-overlay" />
      <span className="btn-content-wrap">{children}</span>
    </button>
  );
};
