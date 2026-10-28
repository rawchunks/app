import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';

export interface TooltipProps {
  title: string;
  description?: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export const Tooltip: React.FC<TooltipProps> = ({
  title,
  description,
  position = 'top',
  children,
  className = '',
  style,
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const showTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hideTimerRef = useRef<NodeJS.Timeout | null>(null);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isTouchShowingRef = useRef(false);

  const clearAllTimers = () => {
    if (showTimerRef.current) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const calculatePosition = () => {
    if (!wrapperRef.current || !bubbleRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      setIsVisible(false);
      return;
    }
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

  const hasTitle = Boolean(title && title.trim());

  const showTooltip = () => {
    if (!hasTitle) return;
    if (typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches) {
      return;
    }
    clearAllTimers();
    showTimerRef.current = setTimeout(() => {
      const el = wrapperRef.current;
      if (el && el.matches(':hover') && !el.querySelector('.daw-tooltip-wrapper:hover')) {
        isTouchShowingRef.current = false;
        setIsVisible(true);
      }
    }, 100);
  };

  const hideTooltipImmediate = () => {
    clearAllTimers();
    isTouchShowingRef.current = false;
    setIsVisible(false);
  };

  const handleTouchStart = () => {
    if (!hasTitle) return;
    if (typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches) {
      clearAllTimers();
      longPressTimerRef.current = setTimeout(() => {
        isTouchShowingRef.current = true;
        setIsVisible(true);
      }, 450);
    }
  };

  const handleTouchEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    if (isVisible) {
      hideTimerRef.current = setTimeout(() => {
        isTouchShowingRef.current = false;
        setIsVisible(false);
      }, 900);
    }
  };

  const handlePointerDownCapture = (e: React.PointerEvent) => {
    if (e.pointerType !== 'touch') {
      hideTooltipImmediate();
    }
  };

  useLayoutEffect(() => {
    if (isVisible) {
      calculatePosition();
    }
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible) return;

    const handleGlobalDismiss = () => {
      hideTooltipImmediate();
    };

    const handleGlobalPointerMove = (e: PointerEvent) => {
      if (isTouchShowingRef.current) return;
      const el = wrapperRef.current;
      if (!el) {
        hideTooltipImmediate();
        return;
      }
      const rect = el.getBoundingClientRect();
      const inside =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;
      if (!inside || !el.matches(':hover') || el.querySelector('.daw-tooltip-wrapper:hover')) {
        hideTooltipImmediate();
      }
    };

    const handleGlobalPointerDown = (e: PointerEvent) => {
      if (isTouchShowingRef.current && wrapperRef.current?.contains(e.target as Node)) {
        return;
      }
      hideTooltipImmediate();
    };

    window.addEventListener('pointermove', handleGlobalPointerMove, { passive: true, capture: true });
    window.addEventListener('pointerdown', handleGlobalPointerDown, true);
    window.addEventListener('click', handleGlobalDismiss, true);
    window.addEventListener('keydown', handleGlobalDismiss, true);
    window.addEventListener('scroll', handleGlobalDismiss, true);
    window.addEventListener('wheel', handleGlobalDismiss, { passive: true, capture: true });
    window.addEventListener('resize', handleGlobalDismiss);
    window.addEventListener('blur', handleGlobalDismiss);

    return () => {
      window.removeEventListener('pointermove', handleGlobalPointerMove, true);
      window.removeEventListener('pointerdown', handleGlobalPointerDown, true);
      window.removeEventListener('click', handleGlobalDismiss, true);
      window.removeEventListener('keydown', handleGlobalDismiss, true);
      window.removeEventListener('scroll', handleGlobalDismiss, true);
      window.removeEventListener('wheel', handleGlobalDismiss, true);
      window.removeEventListener('resize', handleGlobalDismiss);
      window.removeEventListener('blur', handleGlobalDismiss);
    };
  }, [isVisible]);

  useEffect(() => {
    return () => {
      clearAllTimers();
    };
  }, []);

  return (
    <div
      ref={wrapperRef}
      className={`daw-tooltip-wrapper ${className}`}
      style={style}
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltipImmediate}
      onPointerLeave={hideTooltipImmediate}
      onPointerDownCapture={handlePointerDownCapture}
      onClickCapture={hideTooltipImmediate}
      onBlur={hideTooltipImmediate}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={ hideTooltipImmediate }
      onTouchMove={ hideTooltipImmediate }
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
