import { useEffect, useRef, useState, type ReactNode } from 'react';

interface Props {
  label: string;
  value: string;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

export function Selector({ label, value, children, open: controlled, onOpenChange, className = 'studio-language-popover' }: Props) {
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const open = controlled ?? expanded;
  const change = onOpenChange ?? setExpanded;

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) change(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') change(false);
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [open, change]);

  return <div className="studio-duration-wrap" ref={ref}>
    <button type="button" aria-label={label} aria-expanded={open} onClick={() => change(!open)} className="studio-dropdown-trigger">
      <span>{value}</span>
      <span className="studio-duration-caret">▼</span>
    </button>
    {open && <div className={`studio-dropdown-popover ${className}`}>{children}</div>}
  </div>;
}
