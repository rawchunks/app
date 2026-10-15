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
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const hideTimerRef = useRef<NodeJS.Timeout | null>(null);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);

  const calculatePosition = () => {
    if (!wrapperRef.current || !bubbleRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    const tooltipWidth = bubbleRef.current.offsetWidth || 220;
    const tooltipHeight = bubbleRef.current.offsetHeight || 44;
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

    bubbleRef.current.style.setProperty('--tooltip-top', `${top}px`);
    bubbleRef.current.style.setProperty('--tooltip-left', `${left}px`);
  };

  const showTooltip = () => {
    if (typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches) {
      return;
    }
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    setIsVisible(true);
  };

  const hideTooltip = () => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      setIsVisible(false);
    }, 80);
  };

  const handleTouchStart = () => {
    if (typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches) {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = setTimeout(() => {
        setIsVisible(true);
      }, 450);
    }
  };

  const handleTouchEnd = () => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    if (isVisible) {
      hideTimerRef.current = setTimeout(() => {
        setIsVisible(false);
      }, 1200);
    }
  };

  const handleClick = () => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    setIsVisible(false);
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
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    };
  }, [isVisible]);

  return (
    <div
      ref={wrapperRef}
      className={`daw-tooltip-wrapper ${className}`}
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      onClick={handleClick}
    >
      {children}
      {isVisible &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={bubbleRef}
            className="daw-tooltip-bubble daw-tooltip-portal"
            role="tooltip"
          >
            <div className="daw-tooltip-title">{title}</div>
            {description && <div className="daw-tooltip-desc">{description}</div>}
          </div>,
          document.body
        )}
    </div>
  );
};
