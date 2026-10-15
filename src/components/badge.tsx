import React from 'react';

export interface Props {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'accent' | 'warning' | 'muted' | 'outline' | 'default';
  clickable?: boolean;
  active?: boolean;
  onClick?: () => void;
  className?: string;
  style?: React.CSSProperties;
}

export const Badge: React.FC<Props> = ({
  children,
  variant = 'primary',
  clickable = false,
  active = false,
  onClick,
  className = '',
  style,
}) => {
  const resolvedVariant = variant === 'outline' ? 'muted' : variant === 'default' ? 'primary' : variant;

  const badgeClasses = [
    'cyber-badge',
    `cyber-badge-${resolvedVariant}`,
    active ? 'active' : '',
    clickable ? 'cyber-badge-clickable' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span
      onClick={clickable ? onClick : undefined}
      className={badgeClasses}
      style={style}
    >
      {children}
    </span>
  );
};
