import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';

export interface TooltipProps {
  title: string;
  description?: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
  children: React.ReactNode;
  className?: string;
}

export const Tooltip: React.FC<TooltipProps> = ({
  title,
  description,
  position = 'top',
  children,
  className = '',
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const hideTimerRef = useRef<NodeJS.Timeout | null>(null);

  const calculatePosition = () => {
    if (!wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    const tooltipWidth = bubbleRef.current?.offsetWidth || 220;
    const tooltipHeight = bubbleRef.current?.offsetHeight || 44;
    const padding = 12;

    let left = rect.left + rect.width / 2;
    let top = rect.top - tooltipHeight - 8;

    // Flip to bottom if clipping top of viewport
    if (top < padding || position === 'bottom') {
      top = rect.bottom + 8;
    }

    // Clamp horizontally so tooltip stays entirely within viewport
    const halfWidth = tooltipWidth / 2;
    if (left - halfWidth < padding) {
      left = padding + halfWidth;
    } else if (left + halfWidth > window.innerWidth - padding) {
      left = window.innerWidth - padding - halfWidth;
    }

    // Clamp vertically
    top = Math.max(padding, Math.min(top, window.innerHeight - tooltipHeight - padding));

    setCoords({ top, left });
  };

  const showTooltip = () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    setIsVisible(true);
  };

  const hideTooltip = () => {
    hideTimerRef.current = setTimeout(() => {
      setIsVisible(false);
    }, 100);
  };

  const handleTouchToggle = (e: React.MouseEvent) => {
    if (typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches) {
      if (!isVisible) {
        e.preventDefault();
        e.stopPropagation();
        setIsVisible(true);
      }
    }
  };

  useLayoutEffect(() => {
    if (isVisible) {
      calculatePosition();
    }
  }, [isVisible]);

  useEffect(() => {
    const handleScrollOrResize = () => {
      if (isVisible) {
        calculatePosition();
      }
    };
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    return () => {
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [isVisible]);

  return (
    <div
      ref={wrapperRef}
      className={`daw-tooltip-wrapper ${className}`}
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onClick={handleTouchToggle}
    >
      {children}
      {isVisible &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={bubbleRef}
            className="daw-tooltip-bubble daw-tooltip-portal"
            role="tooltip"
            style={{
              position: 'fixed',
              top: coords ? `${coords.top}px` : '-9999px',
              left: coords ? `${coords.left}px` : '-9999px',
              transform: 'translateX(-50%)',
              zIndex: 99999,
              pointerEvents: 'none',
            }}
          >
            <div className="daw-tooltip-title">{title}</div>
            {description && <div className="daw-tooltip-desc">{description}</div>}
          </div>,
          document.body
        )}
    </div>
  );
};
