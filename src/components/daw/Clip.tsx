import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { DAWClip, useDawStore } from '../../lib/daw/store';
import {
  extractBipolarPeaksFromUrl,
  readPeaks,
  BipolarPeaks,
  createDefaultWaveSculpt,
  isIdentityWaveSculpt,
  composeWaveSculpts,
  sculptBipolarPeaks,
  evaluateSculptField,
  type GranularPeakAnchor,
  type GranularTool,
  type WaveSculptMode,
} from '../../lib/daw/peaks';
import { getStemColor } from '../../lib/daw/palette';

interface ClipProps {
  clip: DAWClip;
  trackId?: string;
  color?: string;
  className?: string;
}


export const Clip: React.FC<ClipProps> = ({ clip, trackId, color, className = '' }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const binCount = 512;
  const [bipolarPeaks, setBipolarPeaks] = useState<BipolarPeaks | null>(() =>
    readPeaks(clip.url, 512, clip.offset, clip.duration)
  );
  const [activeNodeIdx, setActiveNodeIdx] = useState<number | null>(null);
  const [activeAnchorId, setActiveAnchorId] = useState<string | null>(null);
  const [hoverPeak, setHoverPeak] = useState<{
    ratio: number;
    polarity: 'upper' | 'lower' | 'both';
    peakVal: number;
    anchorId?: string;
  } | null>(null);

  const trackSculpt = useDawStore((s) =>
    trackId ? s.tracks.find((t) => t.id === trackId)?.sculpt : undefined
  );
  const masterSculpt = useDawStore((s) =>
    trackId && trackId !== 'master' ? s.tracks.find((t) => t.id === 'master')?.sculpt : undefined
  );
  const globalSculptMode = useDawStore((s) => s.sculptMode);
  const updateClipSculpt = useDawStore((s) => s.updateClipSculpt);
  const resetTrackSculpt = useDawStore((s) => s.resetTrackSculpt);

  const ownSculpt = useMemo(
    () => clip.sculpt ?? trackSculpt ?? createDefaultWaveSculpt(),
    [clip.sculpt, trackSculpt]
  );
  const effectiveSculpt = useMemo(
    () => composeWaveSculpts(masterSculpt, ownSculpt),
    [masterSculpt, ownSculpt]
  );
  const sculptMode: WaveSculptMode = globalSculptMode ?? effectiveSculpt.mode ?? 'granular';
  const zoomFactor = Math.max(1, Math.min(8, effectiveSculpt.zoom ?? 1));
  const panOffset = Math.max(0, Math.min(Math.max(0, 1 - 1 / zoomFactor), effectiveSculpt.panOffset ?? 0));
  const isSculpted = useMemo(() => !isIdentityWaveSculpt(effectiveSculpt), [effectiveSculpt]);

  const displayPeaks = useMemo(() => {
    if (!bipolarPeaks) return null;
    return isSculpted ? sculptBipolarPeaks(bipolarPeaks, effectiveSculpt) : bipolarPeaks;
  }, [bipolarPeaks, isSculpted, effectiveSculpt]);

  const ratioToLocalX = useCallback(
    (ratio: number, w: number) => (ratio - panOffset) * zoomFactor * w,
    [panOffset, zoomFactor]
  );

  const localXToRatio = useCallback(
    (localX: number, w: number) =>
      Math.max(0, Math.min(1, panOffset + localX / Math.max(1, w * zoomFactor))),
    [panOffset, zoomFactor]
  );

  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressNextClickRef = useRef<boolean>(false);

  const dragStateRef = useRef<{
    pointerId: number;
    mode: 'node' | 'anchor' | 'fadeIn' | 'fadeOut';
    nodeIdx: number;
    anchorId?: string;
    anchorsSnapshot?: GranularPeakAnchor[];
    pendingAnchor?: GranularPeakAnchor;
    isNewAnchor?: boolean;
    tool: GranularTool;
    startX: number;
    startY: number;
    initialGainDb: number;
    initialWarpOffset: number;
    initialTimeShift: number;
    initialBend: number;
    initialSmash: number;
    initialSmooth: number;
    initialSharpen: number;
    initialRadius: number;
    moved: boolean;
    held?: boolean;
    downTime: number;
  } | null>(null);

  // Asynchronously extract and cache canonical 512-bin bipolar peaks
  useEffect(() => {
    let isMounted = true;
    setBipolarPeaks(readPeaks(clip.url, binCount, clip.offset, clip.duration));
    if (!clip.url) {
      setBipolarPeaks(null);
      return;
    }

    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const loadPeaks = () => {
      extractBipolarPeaksFromUrl(clip.url, binCount, clip.offset, clip.duration)
        .then((peaks) => {
          if (isMounted) {
            setBipolarPeaks(peaks);
          }
        })
        .catch((err) => {
          if (!isMounted) return;
          if (err && typeof err === 'object' && 'name' in err && err.name === 'AbortError') {
            retryTimer = setTimeout(loadPeaks, 80);
            return;
          }
          console.warn(`[Clip] Peak extraction error for ${clip.name}:`, err);
        });
    };
    loadPeaks();

    return () => {
      isMounted = false;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [clip.url, clip.name, clip.offset, clip.duration]);

  // Draw sample-accurate bipolar waveform + Granular Peak-Sculpt or Speed Curve overlay
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
        hexColor = '#00f0ff';
      }

      if (!displayPeaks || displayPeaks.bins === 0) {
        ctx.restore();
        return;
      }

      ctx.save();
      ctx.translate(-panOffset * zoomFactor * w, 0);
      const virtualW = w * zoomFactor;

      const { mins, maxs, bins, low, high } = displayPeaks;
      const barWidth = virtualW / bins;
      let maxPeak = 0;
      const refPeaks = bipolarPeaks ?? displayPeaks;
      for (let i = 0; i < refPeaks.bins; i++) {
        maxPeak = Math.max(maxPeak, Math.abs(refPeaks.maxs[i]), Math.abs(refPeaks.mins[i]));
      }
      const normScale = maxPeak > 0 && maxPeak < 0.25 ? Math.min(4, 0.35 / maxPeak) : 1;
      const ampHeight = midY * 0.64 * normScale;

      // Ghost reference contour when sculpted
      if (isSculpted && bipolarPeaks && bipolarPeaks.bins > 0) {
        const gBarW = virtualW / bipolarPeaks.bins;
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        for (let i = 0; i < bipolarPeaks.bins; i++) {
          const x = i * gBarW;
          const topY = midY - Math.max(0, bipolarPeaks.maxs[i]) * ampHeight;
          if (i === 0) ctx.moveTo(x, topY);
          else ctx.lineTo(x, topY);
        }
        for (let i = bipolarPeaks.bins - 1; i >= 0; i--) {
          const x = i * gBarW;
          const btmY = midY - Math.min(0, bipolarPeaks.mins[i]) * ampHeight;
          ctx.lineTo(x, btmY);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
      }

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

      // 3-Band Spectral Transient Stroke Lines (Low=Warm, Mid=Stem, High=Bright Cyan)
      if (barWidth >= 1.5) {
        ctx.lineWidth = Math.max(1, barWidth * 0.6);
        const hasSpectral = Boolean(low && high && low.length === bins && high.length === bins);
        if (!hasSpectral) {
          ctx.strokeStyle = `${hexColor}88`;
          ctx.beginPath();
          for (let i = 0; i < bins; i++) {
            const x = i * barWidth + barWidth / 2;
            const top = midY - Math.max(0, maxs[i]) * ampHeight;
            const btm = midY - Math.min(0, mins[i]) * ampHeight;
            ctx.moveTo(x, top);
            ctx.lineTo(x, btm);
          }
          ctx.stroke();
        } else {
          for (let i = 0; i < bins; i++) {
            const x = i * barWidth + barWidth / 2;
            const top = midY - Math.max(0, maxs[i]) * ampHeight;
            const btm = midY - Math.min(0, mins[i]) * ampHeight;
            const hiRatio = high![i];
            const loRatio = low![i];
            ctx.strokeStyle =
              hiRatio > 0.42
                ? 'rgba(180, 250, 255, 0.72)'
                : loRatio > 0.58
                ? `${hexColor}cc`
                : `${hexColor}88`;
            ctx.beginPath();
            ctx.moveTo(x, top);
            ctx.lineTo(x, btm);
            ctx.stroke();
          }
        }
      }

      if (trackId) {
        // Fade-In & Fade-Out corner curves and handles
        const fadeInX = Math.max(3, Math.min(virtualW * 0.45, effectiveSculpt.fadeIn * virtualW));
        const fadeOutX = Math.max(virtualW * 0.55, Math.min(virtualW - 3, (1 - effectiveSculpt.fadeOut) * virtualW));
        if (effectiveSculpt.fadeIn > 0.005) {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(fadeInX, 0);
          ctx.lineTo(0, h);
          ctx.closePath();
          ctx.fill();
        }
        if (effectiveSculpt.fadeOut > 0.005) {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
          ctx.beginPath();
          ctx.moveTo(virtualW, 0);
          ctx.lineTo(fadeOutX, 0);
          ctx.lineTo(virtualW, h);
          ctx.closePath();
          ctx.fill();
        }
        if (sculptMode === 'curve' || effectiveSculpt.fadeIn > 0.005) {
          ctx.fillStyle = effectiveSculpt.fadeIn > 0.005 ? '#00ff88' : 'rgba(255, 255, 255, 0.4)';
          ctx.fillRect(fadeInX - 2.5, 1, 5, 5);
        }
        if (sculptMode === 'curve' || effectiveSculpt.fadeOut > 0.005) {
          ctx.fillStyle = effectiveSculpt.fadeOut > 0.005 ? '#00ff88' : 'rgba(255, 255, 255, 0.4)';
          ctx.fillRect(fadeOutX - 2.5, 1, 5, 5);
        }

        if (sculptMode === 'curve' && effectiveSculpt.nodes.length > 0) {
          // SPEED / MEDIAN CURVE MODE: Smooth Catmull-Rom Spline + 4 Control Nodes
          const nodes = effectiveSculpt.nodes;
          ctx.save();
          ctx.strokeStyle = isSculpted || activeNodeIdx !== null ? '#00f0ff' : 'rgba(255, 255, 255, 0.28)';
          ctx.lineWidth = isSculpted || activeNodeIdx !== null ? 1.6 : 1.1;
          ctx.beginPath();
          const steps = 64;
          for (let s = 0; s <= steps; s++) {
            const t = s / steps;
            const field = evaluateSculptField(effectiveSculpt, t);
            const db = 20 * Math.log10(Math.max(0.06, field.gainLinear));
            const sx = t * virtualW;
            const sy = Math.max(4, Math.min(h - 4, midY - (db / 18) * (midY * 0.8)));
            if (s === 0) ctx.moveTo(sx, sy);
            else ctx.lineTo(sx, sy);
          }
          ctx.stroke();

          nodes.forEach((node, idx) => {
            const nx = Math.max(4, Math.min(virtualW - 4, (node.position + node.warpOffset * 0.45) * virtualW));
            const ny = Math.max(4, Math.min(h - 4, midY - (node.gainDb / 18) * (midY * 0.8)));
            const isActive = activeNodeIdx === idx;
            ctx.fillStyle = isActive ? '#00ff41' : isSculpted ? '#00f0ff' : 'rgba(255, 255, 255, 0.65)';
            ctx.beginPath();
            ctx.arc(nx, ny, isActive ? 4.5 : 3.2, 0, Math.PI * 2);
            ctx.fill();
          });
          ctx.restore();
        } else {
          // GRANULAR WAVE SHAPE DESIGN MODE: No artificial vertical lines or boxes — the wave contour itself deforms directly!
          if (hoverPeak && !activeAnchorId) {
            const hx = hoverPeak.ratio * virtualW;
            const hy = Math.max(4, Math.min(h - 4, midY - hoverPeak.peakVal * ampHeight));
            ctx.save();
            ctx.strokeStyle = 'rgba(0, 255, 136, 0.55)';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.arc(hx, hy, 4, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
          }
        }
      }

      ctx.restore();
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
  }, [
    displayPeaks,
    bipolarPeaks,
    color,
    clip.name,
    trackId,
    effectiveSculpt,
    sculptMode,
    zoomFactor,
    panOffset,
    isSculpted,
    activeNodeIdx,
    activeAnchorId,
    hoverPeak,
    binCount,
  ]);

  const findNearestAnchor = useCallback(
    (xRatio: number, maxRatioDist: number): GranularPeakAnchor | null => {
      const anchors = effectiveSculpt.anchors ?? [];
      let best: GranularPeakAnchor | null = null;
      let bestDist = Infinity;
      for (const a of anchors) {
        const effPos = Math.max(0, Math.min(1, a.position + (a.timeShift ?? 0) * 0.35));
        const d = Math.abs(effPos - xRatio);
        if (d < bestDist) {
          bestDist = d;
          best = a;
        }
      }
      return bestDist <= maxRatioDist ? best : null;
    },
    [effectiveSculpt.anchors]
  );

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!trackId) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0) return;

    const localX = e.clientX - rect.left;
    const cursorRatio = localXToRatio(localX, rect.width);

    if (e.altKey && sculptMode === 'granular') {
      const hitAnchor = findNearestAnchor(cursorRatio, 0.04 / zoomFactor);
      if (hitAnchor) {
        e.preventDefault();
        e.stopPropagation();
        const deltaR = e.deltaY < 0 ? 0.006 : -0.006;
        const nextRadius = Math.max(0.006, Math.min(0.22, Number(((hitAnchor.radius || 0.04) + deltaR).toFixed(3))));
        const ownAnchors = ownSculpt.anchors ?? [];
        const hasInOwn = ownAnchors.some((a) => a.id === hitAnchor.id);
        const nextAnchors = hasInOwn
          ? ownAnchors.map((a) => (a.id === hitAnchor.id ? { ...a, radius: nextRadius } : a))
          : [...ownAnchors, { ...hitAnchor, gainDb: 0, timeShift: 0, bend: 0, smash: 0, smooth: 0, sharpen: 0, radius: nextRadius }];
        updateClipSculpt(trackId, clip.id, { anchors: nextAnchors });
        return;
      }
    }

    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      const factor = e.deltaY < 0 ? 1.22 : 1 / 1.22;
      const nextZoom = Math.max(1, Math.min(8, Number((zoomFactor * factor).toFixed(2))));
      const nextSpan = 1 / nextZoom;
      const nextPan =
        nextZoom <= 1.01
          ? 0
          : Math.max(0, Math.min(1 - nextSpan, cursorRatio - (localX / rect.width) * nextSpan));
      updateClipSculpt(trackId, clip.id, { zoom: nextZoom, panOffset: nextPan });
    } else if (zoomFactor > 1.01 && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      e.preventDefault();
      e.stopPropagation();
      const maxPan = Math.max(0, 1 - 1 / zoomFactor);
      const nextPan = Math.max(0, Math.min(maxPan, panOffset + e.deltaX / (rect.width * zoomFactor)));
      updateClipSculpt(trackId, clip.id, { panOffset: nextPan });
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!trackId || e.button !== 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;
    const xRatio = localXToRatio(localX, rect.width);

    const now = performance.now();
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }

    // Check top-left fade-in / top-right fade-out handles first
    const fadeInPx = ratioToLocalX(effectiveSculpt.fadeIn, rect.width);
    const fadeOutPx = ratioToLocalX(1 - effectiveSculpt.fadeOut, rect.width);
    if (localY <= Math.min(14, rect.height * 0.38)) {
      if (Math.abs(localX - fadeInPx) <= 12) {
        dragStateRef.current = {
          pointerId: e.pointerId,
          mode: 'fadeIn',
          nodeIdx: -1,
          tool: 'grab',
          startX: e.clientX,
          startY: e.clientY,
          initialGainDb: 0,
          initialWarpOffset: 0,
          initialTimeShift: 0,
          initialBend: 0,
          initialSmash: 0,
          initialSmooth: 0,
          initialSharpen: 0,
          initialRadius: 0.04,
          moved: false,
          downTime: now,
        };
        try { canvas.setPointerCapture(e.pointerId); } catch {}
        return;
      }
      if (Math.abs(localX - fadeOutPx) <= 12) {
        dragStateRef.current = {
          pointerId: e.pointerId,
          mode: 'fadeOut',
          nodeIdx: -1,
          tool: 'grab',
          startX: e.clientX,
          startY: e.clientY,
          initialGainDb: 0,
          initialWarpOffset: 0,
          initialTimeShift: 0,
          initialBend: 0,
          initialSmash: 0,
          initialSmooth: 0,
          initialSharpen: 0,
          initialRadius: 0.04,
          moved: false,
          downTime: now,
        };
        try { canvas.setPointerCapture(e.pointerId); } catch {}
        return;
      }
    }

    if (sculptMode === 'curve') {
      // SPEED / MEDIAN CURVE MODE
      const nodes = effectiveSculpt.nodes;
      let closestIdx = 0;
      let closestDist = Infinity;
      nodes.forEach((node, idx) => {
        const effectivePos = Math.max(0, Math.min(1, node.position + node.warpOffset * 0.45));
        const dist = Math.abs(effectivePos - xRatio);
        if (dist < closestDist) {
          closestDist = dist;
          closestIdx = idx;
        }
      });

      const targetNode = nodes[closestIdx];
      dragStateRef.current = {
        pointerId: e.pointerId,
        mode: 'node',
        nodeIdx: closestIdx,
        tool: 'grab',
        startX: e.clientX,
        startY: e.clientY,
        initialGainDb: targetNode.gainDb,
        initialWarpOffset: targetNode.warpOffset,
        initialTimeShift: 0,
        initialBend: 0,
        initialSmash: 0,
        initialSmooth: 0,
        initialSharpen: 0,
        initialRadius: 0.04,
        moved: false,
        downTime: now,
      };
      setActiveNodeIdx(closestIdx);
      try { canvas.setPointerCapture(e.pointerId); } catch {}
      return;
    }

    // GRANULAR WAVE SHAPE DESIGN MODE: Direct finger/cursor peak manipulation
    const hitDistRatio = Math.max(0.014, 16 / Math.max(60, rect.width * zoomFactor));
    const existing = findNearestAnchor(xRatio, hitDistRatio);
    const ownAnchors = [...(ownSculpt.anchors ?? [])];
    const ownExisting = existing ? ownAnchors.find((a) => a.id === existing.id) : undefined;
    let targetAnchor: GranularPeakAnchor;
    const isNewAnchor = !ownExisting;

    if (ownExisting) {
      targetAnchor = ownExisting;
    } else if (existing) {
      targetAnchor = {
        id: existing.id,
        position: existing.position,
        radius: existing.radius,
        polarity: existing.polarity,
        gainDb: 0,
        timeShift: 0,
        bend: 0,
        smash: 0,
        smooth: 0,
        sharpen: 0,
      };
    } else {
      let snappedRatio = xRatio;
      if (displayPeaks && displayPeaks.bins > 0) {
        const centerBin = Math.min(displayPeaks.bins - 1, Math.max(0, Math.floor(xRatio * displayPeaks.bins)));
        let bestBin = centerBin;
        let bestMag = -1;
        for (let b = Math.max(0, centerBin - 2); b <= Math.min(displayPeaks.bins - 1, centerBin + 2); b++) {
          const mag = Math.max(Math.abs(displayPeaks.maxs[b]), Math.abs(displayPeaks.mins[b]));
          if (mag > bestMag) {
            bestMag = mag;
            bestBin = b;
          }
        }
        snappedRatio = (bestBin + 0.5) / displayPeaks.bins;
      }

      const midY = rect.height / 2;
      const distFromMid = localY - midY;
      const polarity: 'upper' | 'lower' | 'both' =
        e.shiftKey || Math.abs(distFromMid) <= rect.height * 0.14
          ? 'both'
          : distFromMid < 0
          ? 'upper'
          : 'lower';

      targetAnchor = {
        id: `pk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        position: Number(snappedRatio.toFixed(4)),
        radius: Number(Math.max(0.035, Math.min(0.12, 0.075 / Math.sqrt(zoomFactor))).toFixed(3)),
        polarity,
        gainDb: 0,
        timeShift: 0,
        bend: 0,
        smash: 0,
        smooth: 0,
        sharpen: 0,
      };
    }

    dragStateRef.current = {
      pointerId: e.pointerId,
      mode: 'anchor',
      nodeIdx: -1,
      anchorId: targetAnchor.id,
      anchorsSnapshot: ownAnchors,
      pendingAnchor: targetAnchor,
      isNewAnchor,
      tool: 'grab',
      startX: e.clientX,
      startY: e.clientY,
      initialGainDb: targetAnchor.gainDb,
      initialWarpOffset: 0,
      initialTimeShift: targetAnchor.timeShift,
      initialBend: targetAnchor.bend,
      initialSmash: targetAnchor.smash,
      initialSmooth: targetAnchor.smooth,
      initialSharpen: targetAnchor.sharpen,
      initialRadius: targetAnchor.radius,
      moved: false,
      held: false,
      downTime: now,
    };
    holdTimerRef.current = setTimeout(() => {
      if (dragStateRef.current?.mode === 'anchor' && dragStateRef.current.anchorId === targetAnchor.id) {
        dragStateRef.current.held = true;
        setActiveAnchorId(targetAnchor.id);
      }
    }, 150);
    try { canvas.setPointerCapture(e.pointerId); } catch {}
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !trackId) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;
    const xRatio = localXToRatio(localX, rect.width);

    const drag = dragStateRef.current;
    if (!drag) {
      if (sculptMode === 'granular' && displayPeaks && displayPeaks.bins > 0) {
        const bin = Math.min(displayPeaks.bins - 1, Math.max(0, Math.floor(xRatio * displayPeaks.bins)));
        const midY = rect.height / 2;
        const polarity: 'upper' | 'lower' | 'both' =
          localY < midY - rect.height * 0.12
            ? 'upper'
            : localY > midY + rect.height * 0.12
            ? 'lower'
            : 'both';
        const peakVal =
          polarity === 'lower'
            ? displayPeaks.mins[bin]
            : polarity === 'upper'
            ? displayPeaks.maxs[bin]
            : Math.abs(displayPeaks.maxs[bin]) >= Math.abs(displayPeaks.mins[bin])
            ? displayPeaks.maxs[bin]
            : displayPeaks.mins[bin];
        setHoverPeak({ ratio: (bin + 0.5) / displayPeaks.bins, polarity, peakVal });
      } else if (hoverPeak) {
        setHoverPeak(null);
      }
      return;
    }

    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    if (!drag.moved) {
      drag.moved = true;
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      if (drag.mode === 'anchor' && drag.anchorId) {
        setActiveAnchorId(drag.anchorId);
        if (drag.isNewAnchor && drag.pendingAnchor) {
          let snap = [...(drag.anchorsSnapshot ?? ownSculpt.anchors ?? [])];
          if (snap.length >= 24) {
            snap = snap.slice(snap.length - 23);
          }
          snap.push(drag.pendingAnchor);
          drag.anchorsSnapshot = snap;
          drag.isNewAnchor = false;
        }
      }
    }
    e.stopPropagation();

    if (drag.mode === 'fadeIn') {
      const nextFadeIn = Math.max(0, Math.min(0.45, Math.round(xRatio * 100) / 100));
      updateClipSculpt(trackId, clip.id, { fadeIn: nextFadeIn });
      return;
    }
    if (drag.mode === 'fadeOut') {
      const nextFadeOut = Math.max(0, Math.min(0.45, Math.round((1 - xRatio) * 100) / 100));
      updateClipSculpt(trackId, clip.id, { fadeOut: nextFadeOut });
      return;
    }

    if (drag.mode === 'node') {
      // SPEED / MEDIAN CURVE MODE: Modify node gainDb and warpOffset
      const nextGainDb = Math.max(
        -24,
        Math.min(12, Math.round((drag.initialGainDb - (dy / (rect.height * 0.45)) * 14) * 10) / 10)
      );
      const isInterior = drag.nodeIdx > 0 && drag.nodeIdx < effectiveSculpt.nodes.length - 1;
      const nextWarpOffset = isInterior
        ? Math.max(
            -0.35,
            Math.min(0.35, Math.round((drag.initialWarpOffset + (dx / (rect.width * zoomFactor)) * 0.85) * 100) / 100)
          )
        : 0;

      const masterNode = trackId !== 'master' ? masterSculpt?.nodes?.[drag.nodeIdx] : undefined;
      const ownGainDb = Math.max(
        -24,
        Math.min(12, Number((nextGainDb - (masterNode?.gainDb ?? 0)).toFixed(2)))
      );
      const ownWarpOffset = Math.max(
        -0.35,
        Math.min(0.35, Number((nextWarpOffset - (masterNode?.warpOffset ?? 0)).toFixed(3)))
      );

      const baseOwnNodes = ownSculpt.nodes?.length ? ownSculpt.nodes : effectiveSculpt.nodes;
      const nextNodes = baseOwnNodes.map((node, idx) =>
        idx === drag.nodeIdx ? { ...node, gainDb: ownGainDb, warpOffset: ownWarpOffset } : node
      );

      updateClipSculpt(trackId, clip.id, {
        mode: 'curve',
        nodes: nextNodes,
      });
      return;
    }

    if (drag.mode === 'anchor' && drag.anchorId) {
      const anchors = drag.anchorsSnapshot ?? ownSculpt.anchors ?? [];
      const normDy = -dy / Math.max(18, rect.height * 0.36);
      const normDx = dx / Math.max(36, rect.width * zoomFactor);

      const nextAnchors = anchors.map((anchor) => {
        if (anchor.id !== drag.anchorId) return anchor;
        const polaritySign = anchor.polarity === 'lower' ? -1 : 1;
        const signedVertical = normDy * polaritySign;

        const nextGainDb = Math.max(
          -24,
          Math.min(18, Number((drag.initialGainDb + signedVertical * 16).toFixed(1)))
        );
        const nextTimeShift = Math.max(
          -0.25,
          Math.min(0.25, Number((drag.initialTimeShift + normDx * 0.75).toFixed(3)))
        );
        const nextBend = Math.max(
          -1,
          Math.min(1, Number((drag.initialBend + normDx * 1.35).toFixed(2)))
        );
        const nextSharpen =
          signedVertical > 0
            ? Math.max(0, Math.min(1, Number((drag.initialSharpen + signedVertical * 0.55).toFixed(2))))
            : drag.initialSharpen;
        const nextSmooth =
          signedVertical < 0
            ? Math.max(0, Math.min(1, Number((drag.initialSmooth + Math.abs(signedVertical) * 0.55).toFixed(2))))
            : drag.initialSmooth;
        const nextSmash = e.altKey
          ? Math.max(0, Math.min(1, Number((drag.initialSmash + Math.abs(normDy) * 0.9).toFixed(2))))
          : drag.initialSmash;

        return {
          ...anchor,
          gainDb: nextGainDb,
          timeShift: nextTimeShift,
          bend: nextBend,
          sharpen: nextSharpen,
          smooth: nextSmooth,
          smash: nextSmash,
        };
      });
      drag.anchorsSnapshot = nextAnchors;

      updateClipSculpt(trackId, clip.id, { mode: 'granular', anchors: nextAnchors });
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    const drag = dragStateRef.current;
    if (drag) {
      const elapsed = performance.now() - drag.downTime;
      const didHoldOrDrag = Boolean(
        drag.moved ||
          drag.held ||
          elapsed >= 180 ||
          drag.mode === 'node' ||
          drag.mode === 'fadeIn' ||
          drag.mode === 'fadeOut'
      );
      if (didHoldOrDrag) {
        suppressNextClickRef.current = true;
        e.stopPropagation();
      }
      dragStateRef.current = null;
    }
    const canvas = canvasRef.current;
    if (canvas && canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
    setActiveNodeIdx(null);
    setActiveAnchorId(null);
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!trackId) return;
    e.stopPropagation();
    const canvas = canvasRef.current;
    if (canvas && sculptMode === 'granular') {
      const rect = canvas.getBoundingClientRect();
      const xRatio = localXToRatio(e.clientX - rect.left, rect.width);
      const hitAnchor = findNearestAnchor(xRatio, 0.035 / zoomFactor);
      if (hitAnchor) {
        const ownAnchors = ownSculpt.anchors ?? [];
        if (ownAnchors.some((a) => a.id === hitAnchor.id)) {
          const remaining = ownAnchors.filter((a) => a.id !== hitAnchor.id);
          updateClipSculpt(trackId, clip.id, { anchors: remaining });
          return;
        }
      }
    }
    if (!isIdentityWaveSculpt(ownSculpt)) {
      resetTrackSculpt(trackId, clip.id);
    } else if (trackId !== 'master' && !isIdentityWaveSculpt(masterSculpt)) {
      resetTrackSculpt('master');
    }
  };

  return (
    <div
      ref={containerRef}
      className={`stem-clip-waveform-container ${className}`.trim()}
      onPointerLeave={() => setHoverPeak(null)}
      onClickCapture={(e) => {
        if (suppressNextClickRef.current) {
          suppressNextClickRef.current = false;
          e.stopPropagation();
          e.preventDefault();
        }
      }}
    >
      <canvas
        ref={canvasRef}
        className="stem-clip-waveform-canvas"
        data-peaks={displayPeaks?.bins ?? 0}
        data-sculpted={isSculpted ? 'true' : 'false'}
        data-sculpt-mode={sculptMode}
        onWheel={trackId ? handleWheel : undefined}
        onPointerDown={trackId ? handlePointerDown : undefined}
        onPointerMove={trackId ? handlePointerMove : undefined}
        onPointerUp={trackId ? handlePointerUp : undefined}
        onPointerCancel={trackId ? handlePointerUp : undefined}
        onDoubleClick={trackId ? handleDoubleClick : undefined}
      />
    </div>
  );
};

