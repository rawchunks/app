import React, { useState, useEffect, useMemo } from 'react';
import { COLORS } from '../lib/theme';

export interface Line {
  x: number;
  height: number;
  opacity: number;
  color: string;
  top: number;
  width: number;
}

export interface Props {
  children?: React.ReactNode;
  text?: string;
  intensity?: 'low' | 'medium' | 'high';
  animated?: boolean;
  className?: string;
}

const CHARS = '!@#$%^&*()_+-=[]{}|;:,.<>?~/\\01';

export const Glitch: React.FC<Props> = ({
  children,
  text,
  intensity = 'medium',
  animated = true,
  className = '',
}) => {
  const [displayText, setDisplayText] = useState(text || '');
  const [active, setActive] = useState(false);
  const [dim, setDim] = useState({ w: 800, h: 600 });

  useEffect(() => {
    const handleResize = () => {
      setDim({ w: window.innerWidth, h: window.innerHeight });
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Text glitch effect
  useEffect(() => {
    if (!text || !animated) {
      if (text) setDisplayText(text);
      return;
    }

    const freq = intensity === 'low' ? 3500 : intensity === 'high' ? 1200 : 2200;
    const interval = setInterval(() => {
      if (Math.random() < 0.25) {
        const glitched = text
          .split('')
          .map((ch) => {
            if (ch === ' ') return ' ';
            return Math.random() < 0.25 ? CHARS[Math.floor(Math.random() * CHARS.length)] : ch;
          })
          .join('');

        setDisplayText(glitched);
        setTimeout(() => setDisplayText(text), 140);
      }
    }, freq);

    return () => clearInterval(interval);
  }, [text, intensity, animated]);

  // Container vertical glitch lines
  const lines = useMemo(() => {
    const count = intensity === 'low' ? 4 : intensity === 'high' ? 12 : 7;
    const arr: Line[] = [];
    for (let i = 0; i < count; i++) {
      const colIdx = Math.floor(Math.random() * 3);
      const color = colIdx === 0 ? COLORS.primary : colIdx === 1 ? COLORS.secondary : COLORS.accent;
      arr.push({
        x: Math.random() * dim.w,
        top: Math.random() * dim.h,
        height: Math.random() * 80 + 30,
        width: Math.random() < 0.8 ? 1 : 2.5,
        opacity: Math.random() * 0.4 + 0.1,
        color,
      });
    }
    return arr;
  }, [intensity, dim]);

  useEffect(() => {
    if (!animated) return;
    const interval = setInterval(() => {
      if (Math.random() < 0.03) {
        setActive(true);
        setTimeout(() => setActive(false), 180);
      }
    }, 2500);
    return () => clearInterval(interval);
  }, [animated]);

  if (text !== undefined && !children) {
    return (
      <span className={`glitch-text-only ${className}`}>
        {displayText}
      </span>
    );
  }

  return (
    <div className={`glitch-box-container ${className}`}>
      {/* Glitch vertical lines */}
      {lines.map((l, idx) => (
        <div
          key={idx}
          className="glitch-visual-line"
          style={
            {
              '--line-left': `${l.x + (active ? (Math.random() * 16 - 8) : 0)}px`,
              '--line-top': `${l.top}px`,
              '--line-w': `${l.width}px`,
              '--line-h': `${l.height}px`,
              '--line-bg': l.color,
              '--line-opacity': active ? l.opacity * 2 : l.opacity * 0.4,
            } as React.CSSProperties
          }
        />
      ))}

      {/* Content wrapper */}
      <div className="glitch-inner-content">
        {children}
      </div>
    </div>
  );
};
