import React, { forwardRef, useState } from 'react';

type StyleProps = {
  variant?: 'primary' | 'secondary' | 'accent' | 'ghost' | 'default' | 'outline' | 'destructive' | 'warning';
  size?: 'xs' | 'sm' | 'md' | 'lg';
};
export type Props = StyleProps & React.ButtonHTMLAttributes<HTMLButtonElement> & { href?: string; target?: string; rel?: string };
type AnchorProps = StyleProps & React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; disabled?: boolean };

export const Button = forwardRef<HTMLButtonElement | HTMLAnchorElement, Props | AnchorProps>(function Button({
  children, variant = 'primary', size = 'md', className = '', disabled = false, href, ...native
}, ref) {
  const [pressed, setPressed] = useState(false);
  const resolvedVariant = variant === 'default' ? 'primary' : variant === 'outline' ? 'ghost' :
    variant === 'destructive' || variant === 'warning' ? 'accent' : variant;
  const classes = ['btn-base', `btn-variant-${resolvedVariant}`, `btn-size-${size}`, pressed ? 'is-pressed' : '', className].filter(Boolean).join(' ');
  const content = <><div className="btn-glow-overlay" /><span className="btn-content-wrap">{children}</span></>;
  if (href) {
    const props = native as React.AnchorHTMLAttributes<HTMLAnchorElement>;
    return <a {...props} ref={ref as React.Ref<HTMLAnchorElement>} href={href} className={classes}
      aria-disabled={disabled || undefined} tabIndex={disabled ? -1 : props.tabIndex}
      onClick={e => { if (disabled) e.preventDefault(); else props.onClick?.(e); }}
      onMouseDown={e => { setPressed(true); props.onMouseDown?.(e); }}
      onMouseUp={e => { setPressed(false); props.onMouseUp?.(e); }}
      onMouseLeave={e => { setPressed(false); props.onMouseLeave?.(e); }}>{content}</a>;
  }
  const props = native as React.ButtonHTMLAttributes<HTMLButtonElement>;
  return <button {...props} ref={ref as React.Ref<HTMLButtonElement>} type={props.type ?? 'button'} className={classes} disabled={disabled}
    onMouseDown={e => { setPressed(true); props.onMouseDown?.(e); }}
    onMouseUp={e => { setPressed(false); props.onMouseUp?.(e); }}
    onMouseLeave={e => { setPressed(false); props.onMouseLeave?.(e); }}>{content}</button>;
});
