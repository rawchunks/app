import React, { useRef, useEffect, useState } from 'react';
import { DAWClip } from '../../lib/daw/store';
import { extractBipolarPeaksFromUrl, readPeaks, BipolarPeaks } from '../../lib/daw/peaks';
import { getStemColor } from '../../lib/daw/palette';

interface ClipWaveformProps {
  clip: DAWClip;
  color?: string;
  className?: string;
}

export const ClipWaveform: React.FC<ClipWaveformProps> = ({ clip, color, className = '' }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [bipolarPeaks, setBipolarPeaks] = useState<BipolarPeaks | null>(() => readPeaks(clip.url, 512, clip.offset, clip.duration));

  // Asynchronously extract and cache high-density bipolar peaks (512 bins)
  useEffect(() => {
    let isMounted = true;
    setBipolarPeaks(readPeaks(clip.url, 512, clip.offset, clip.duration));
    if (!clip.url) {
      setBipolarPeaks(null);
      return;
    }

    extractBipolarPeaksFromUrl(clip.url, 512, clip.offset, clip.duration)
      .then((peaks) => {
        if (isMounted) {
          setBipolarPeaks(peaks);
        }
      })
      .catch((err) => {
        console.warn(`[ClipWaveform] Peak extraction error for ${clip.name}:`, err);
      });

    return () => {
      isMounted = false;
    };
  }, [clip.url, clip.name, clip.offset, clip.duration]);

  // Draw sample-accurate bipolar waveform on canvas with DPR scaling
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const render = () => {
      const rect = container.getBoundingClientRect();
      const w = Math.floor(rect.width);
      const h = Math.floor(rect.height);

      if (w <= 0 || h <= 0) return;

      const dpr = window.devicePixelRatio || 1;
      const targetW = Math.round(w * dpr);
      const targetH = Math.round(h * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);

      const midY = h / 2;

      // Center zero-crossing baseline
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, midY);
      ctx.lineTo(w, midY);
      ctx.stroke();

      // Resolve color from token or stem name
      let hexColor = color || getStemColor(clip.name);
      if (hexColor.startsWith('var(')) {
        if (typeof window !== 'undefined') {
          const varName = hexColor.replace(/^var\((--[^)]+)\)$/, '$1');
          const resolved = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
          if (resolved) hexColor = resolved;
        }
      }
      if (!hexColor.startsWith('#')) {
        hexColor = getStemColor(clip.name);
      }

      if (!bipolarPeaks || bipolarPeaks.bins === 0) {
        // While PCM data loads, display clean zero-crossing baseline
        ctx.restore();
        return;
      }

      const { mins, maxs, bins } = bipolarPeaks;
      const barWidth = w / bins;
      const ampHeight = midY * 0.92;

      // Filled continuous bipolar PCM silhouette
      ctx.beginPath();
      ctx.moveTo(0, midY);
      for (let i = 0; i < bins; i++) {
        const x = i * barWidth;
        const val = Math.max(0, maxs[i]);
        ctx.lineTo(x, midY - val * ampHeight);
      }
      for (let i = bins - 1; i >= 0; i--) {
        const x = i * barWidth;
        const val = Math.min(0, mins[i]);
        ctx.lineTo(x, midY - val * ampHeight);
      }
      ctx.closePath();

      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, `${hexColor}25`);
      grad.addColorStop(0.5, `${hexColor}70`);
      grad.addColorStop(1, `${hexColor}25`);
      ctx.fillStyle = grad;
      ctx.fill();

      // Sharp bipolar contour line
      ctx.strokeStyle = hexColor;
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      for (let i = 0; i < bins; i++) {
        const x = i * barWidth;
        const topY = midY - Math.max(0, maxs[i]) * ampHeight;
        if (i === 0) ctx.moveTo(x, topY);
        else ctx.lineTo(x, topY);
      }
      for (let i = bins - 1; i >= 0; i--) {
        const x = i * barWidth;
        const btmY = midY - Math.min(0, mins[i]) * ampHeight;
        ctx.lineTo(x, btmY);
      }
      ctx.closePath();
      ctx.stroke();

      // Precision transient stroke lines when resolution permits
      if (barWidth >= 2) {
        ctx.strokeStyle = `${hexColor}88`;
        ctx.lineWidth = Math.max(1, barWidth * 0.6);
        ctx.beginPath();
        for (let i = 0; i < bins; i++) {
          const x = i * barWidth + barWidth / 2;
          const top = midY - Math.max(0, maxs[i]) * ampHeight;
          const btm = midY - Math.min(0, mins[i]) * ampHeight;
          ctx.moveTo(x, top);
          ctx.lineTo(x, btm);
        }
        ctx.stroke();
      }

      ctx.restore();
    };

    render();

    const resizeObserver = new ResizeObserver(() => {
      render();
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [bipolarPeaks, color]);

  return (
    <div ref={containerRef} className={`stem-clip-waveform-container ${className}`.trim()}>
      <canvas ref={canvasRef} className="stem-clip-waveform-canvas" data-peaks={bipolarPeaks?.bins ?? 0} />
    </div>
  );
};
