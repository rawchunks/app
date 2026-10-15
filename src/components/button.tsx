import React, { useState } from 'react';

export interface Props {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'accent' | 'ghost' | 'default' | 'outline' | 'destructive' | 'warning';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
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
  disabled = false,
  href,
  target,
  title,
}) => {
  const [pressed, setPressed] = useState(false);

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

  if (href) {
    return (
      <a
        href={href}
        target={target}
        title={title}
        className={combinedClassName}
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
