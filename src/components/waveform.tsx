import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useDawStore, type DAWTrack } from '../lib/daw/store';
import { dawEngine } from '../lib/daw/engine';
import { extractPeaksFromUrl, extractBipolarPeaksFromUrl, readPeaks, contributions } from '../lib/daw/peaks';
import { getStemColor } from '../lib/daw/palette';

export interface Props {
  height?: number;
  interactive?: boolean;
  showSelection?: boolean;
  audioUrl?: string;
  timelineDuration?: number;
  segments?: { startTime: number; offset: number; duration: number }[];
  lanes?: DAWTrack[];
  selectedTrackId?: string;
  highlighted?: string[];
  peaks?: number[];
  progress?: number;
  selection?: { start: number; end: number } | null;
  onSeek?: (ratio: number) => void;
  onSelectionChange?: (selection: { start: number; end: number }) => void;
  onReworkSection?: () => void;
  onSelectTrack?: (trackId: string) => void;
  className?: string;
  style?: React.CSSProperties;
}

type DragMode = 'none' | 'pinch' | 'start' | 'end' | 'pan' | 'create';

function magnitudes(url?: string) {
  const peaks = url ? readPeaks(url, 256) : null;
  return peaks ? Array.from(peaks.maxs, (value, index) => Math.max(value, -peaks.mins[index])) : [];
}

function layerValues(clips: DAWTrack['clips'], duration: number, peaks: { bins: number; rms: Float32Array }[]) {
  const values = new Array<number>(256).fill(0);
  clips.forEach((clip, index) => {
    const data = peaks[index];
    for (let bin = 0; bin < values.length; bin++) {
      const time = bin / values.length * duration;
      if (time < clip.startTime || time >= clip.startTime + clip.duration) continue;
      const position = Math.min(data.bins - 1, Math.floor((time - clip.startTime) / clip.duration * data.bins));
      values[bin] += data.rms[position];
    }
  });
  return values;
}

export const Waveform: React.FC<Props> = ({
  height,
  interactive = true,
  showSelection = true,
  audioUrl,
  timelineDuration,
  segments,
  lanes = [],
  selectedTrackId,
  highlighted,
  peaks: customPeaks,
  progress: customProgress,
  selection: customSelection,
  onSeek,
  onSelectionChange,
  onSelectTrack,
  onReworkSection,
  className = '',
  style = {},
}) => {
  const playhead = useDawStore(state => state.playhead);
  const savedDuration = useDawStore(state => state.duration);
  const duration = timelineDuration ?? savedDuration;
  const setPlayhead = useDawStore(state => state.setPlayhead);
  const setSelection = useDawStore(state => state.setSelection);
  const takes = useDawStore(state => state.takes);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [loadedPeaks, setLoadedPeaks] = useState<number[]>(() => customPeaks?.length ? customPeaks : magnitudes(audioUrl));

  useEffect(() => {
    setLoadedPeaks(magnitudes(audioUrl));
    if (customPeaks && customPeaks.length > 0) {
      setLoadedPeaks(customPeaks);
      return;
    }
    if (audioUrl) {
      let isMounted = true;
      let retryTimer: ReturnType<typeof setTimeout> | null = null;
      const loadPeaks = () => {
        extractPeaksFromUrl(audioUrl, 256, 'high')
          .then((p) => {
            if (isMounted && p.length > 0) {
              setLoadedPeaks(p);
            }
          })
          .catch((err) => {
            if (!isMounted) return;
            if (err && typeof err === 'object' && 'name' in err && err.name === 'AbortError') {
              retryTimer = setTimeout(loadPeaks, 80);
              return;
            }
            console.warn('Peak extraction error:', err);
          });
      };
      loadPeaks();
      return () => {
        isMounted = false;
        if (retryTimer) clearTimeout(retryTimer);
      };
    }
  }, [customPeaks, audioUrl]);

  const laneKey = JSON.stringify(lanes.map(lane => ({ id: lane.id, name: lane.name, clips: lane.clips.map(({ url, offset, duration, startTime }) => ({ url, offset, duration, startTime })) })));
  const sources = useMemo<DAWTrack[]>(() => JSON.parse(laneKey), [laneKey]);
  const storedLayers = useMemo(() => duration > 0 ? sources.flatMap(lane => {
    const peaks = lane.clips.map(clip => readPeaks(clip.url, Math.max(1, Math.ceil(clip.duration / duration * 256)), clip.offset, clip.duration));
    return peaks.every(peak => peak !== null) ? [{ id: lane.id, name: lane.name, values: layerValues(lane.clips, duration, peaks) }] : [];
  }) : [], [sources, duration]);
  const [loadedLayers, setLayers] = useState<{ key: string; duration: number; values: typeof storedLayers } | null>(null);
  const layers = loadedLayers?.key === laneKey && loadedLayers.duration === duration ? loadedLayers.values : storedLayers;
  useEffect(() => {
    let current = true;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    if (!sources.length || duration <= 0) return;
    const loadSeparatedLayers = () => {
      Promise.all(sources.map(async lane => {
        const peaks = await Promise.all(lane.clips.map(clip => extractBipolarPeaksFromUrl(clip.url, Math.max(1, Math.ceil(clip.duration / duration * 256)), clip.offset, clip.duration)));
        return { id: lane.id, name: lane.name, values: layerValues(lane.clips, duration, peaks) };
      })).then(result => {
        if (current) setLayers({ key: laneKey, duration, values: result });
      }).catch(error => {
        if (!current) return;
        if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') {
          retryTimer = setTimeout(loadSeparatedLayers, 80);
          return;
        }
        console.error('Could not load separated waveforms:', error);
      });
    };
    loadSeparatedLayers();
    return () => {
      current = false;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [sources, laneKey, duration]);

  const [dragMode, setDragMode] = useState<DragMode>('none');
  const [zoomFactor, setZoomFactor] = useState<number>(1.0);

  const activePointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStartDist = useRef<number>(0);
  const pinchStartZoom = useRef<number>(1.0);

  const dragRef = useRef<{
    mode: DragMode;
    startX: number;
    startRatio: number;
    initialSel: { start: number; end: number };
  }>({
    mode: 'none',
    startX: 0,
    startRatio: 0,
    initialSel: { start: 0, end: 1 },
  });

  const sourcePeaks = customPeaks && customPeaks.length > 0 ? customPeaks : loadedPeaks;
  const activePeaks = useMemo(() => {
    const baseDuration = savedDuration > 0 ? savedDuration : (duration > 0 ? duration : 60);
    if (segments && segments.length > 0 && baseDuration > 0 && duration > 0) {
      if (
        segments.length === 1 &&
        segments[0].startTime === 0 &&
        segments[0].offset === 0 &&
        segments[0].duration >= baseDuration &&
        (timelineDuration === undefined || duration <= baseDuration)
      ) {
        return sourcePeaks;
      }
      return sourcePeaks.map((_, index) => {
        const time = (index / sourcePeaks.length) * duration;
        const seg = segments.find(s => time >= s.startTime && time < s.startTime + s.duration);
        if (!seg) return 0;
        const sourceTime = seg.offset + (time - seg.startTime);
        return sourceTime < baseDuration
          ? sourcePeaks[Math.min(sourcePeaks.length - 1, Math.floor((sourceTime / baseDuration) * sourcePeaks.length))]
          : 0;
      });
    }
    if (timelineDuration === undefined || duration <= baseDuration) return sourcePeaks;
    return sourcePeaks.map((_, index) => {
      const time = index / sourcePeaks.length * duration;
      return time < baseDuration ? sourcePeaks[Math.min(sourcePeaks.length - 1, Math.floor(time / baseDuration * sourcePeaks.length))] : 0;
    });
  }, [sourcePeaks, segments, timelineDuration, duration, savedDuration]);
  const boundaries = useMemo(() => contributions(activePeaks, layers.map(layer => layer.values)), [activePeaks, layers]);

  // Active time selection normalized to [0, 1]
  const storeSel = useDawStore((s) => s.selection);
  const effectiveRatioSelection = customSelection !== undefined
    ? customSelection
    : storeSel && duration > 0
    ? { start: Math.max(0, storeSel.start / duration), end: Math.min(1, storeSel.end / duration) }
    : null;

  const currentRatio = customProgress !== undefined
    ? customProgress
    : duration > 0
    ? Math.max(0, Math.min(1, playhead / duration))
    : 0;

  // Look for any active reworked take on this song to highlight on the waveform
  const activeReworkedTake = takes.find(t => t.is_active && t.provenance?.target === 'master' && t.provenance.region && t.repainting_start != null && t.repainting_end != null);

  // =========================================================================
  // Canvas Rendering Pipeline
  // =========================================================================
  const renderWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const canvasRect = canvas.getBoundingClientRect();
    const parentRect = canvas.parentElement?.getBoundingClientRect();
    const w = canvasRect.width > 0 ? canvasRect.width : (parentRect?.width ?? 0);
    const h = canvasRect.height > 0 ? canvasRect.height : (parentRect?.height ?? 0);
    if (w <= 0 || h <= 0) return;

    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.scale(dpr, dpr);

    // Clear background
    ctx.fillStyle = '#08080a';
    ctx.fillRect(0, 0, w, h);

    // Measure / Beat grid divisions
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    const gridDivisions = 16;
    for (let i = 0; i <= gridDivisions; i++) {
      const x = (w / gridDivisions) * i;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    const hasSel = showSelection && Boolean(effectiveRatioSelection);
    const selStartX = hasSel && effectiveRatioSelection ? effectiveRatioSelection.start * w : 0;
    const selEndX = hasSel && effectiveRatioSelection ? effectiveRatioSelection.end * w : w;

    // Dimmed background outside selection
    if (hasSel) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.fillRect(0, 0, selStartX, h);
      ctx.fillRect(selEndX, 0, w - selEndX, h);
    }

    // AI Reworked Section indicator overlay if active take exists
    if (
      activeReworkedTake &&
      duration > 0 &&
      typeof activeReworkedTake.repainting_start === 'number' &&
      typeof activeReworkedTake.repainting_end === 'number'
    ) {
      const reworkStartX = (activeReworkedTake.repainting_start / duration) * w;
      const reworkEndX = (activeReworkedTake.repainting_end / duration) * w;
      const reworkW = Math.max(2, reworkEndX - reworkStartX);

      ctx.fillStyle = 'rgba(0, 255, 255, 0.12)';
      ctx.fillRect(reworkStartX, 0, reworkW, h);

      ctx.strokeStyle = '#00ffff';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(reworkStartX, 1, reworkW, h - 2);
      ctx.setLineDash([]);

      // Section tag
      ctx.fillStyle = '#00ffff';
      ctx.font = '700 9px monospace';
      ctx.fillText(`TAKE ${activeReworkedTake.take_number}: REWORKED`, reworkStartX + 4, 12);
    }

    // Waveform continuous bipolar silhouette rendering
    const barCount = activePeaks.length;
    const playheadX = currentRatio * w;
    const midY = h / 2;

    // Center zero baseline
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(w, midY);
    ctx.stroke();

    if (barCount === 0) {
      ctx.strokeStyle = 'rgba(0, 255, 255, 0.2)';
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(0, midY);
      ctx.lineTo(w, midY);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      const barWidth = w / barCount;
      const ampHeight = midY * 0.88;

      // 1. True Audio Peak Envelope (Real PCM samples from AudioBuffer)
      ctx.beginPath();
      ctx.moveTo(0, midY);
      for (let i = 0; i < barCount; i++) {
        const x = i * barWidth;
        const peak = Math.max(0, activePeaks[i]);
        ctx.lineTo(x, midY - peak * ampHeight);
      }
      for (let i = barCount - 1; i >= 0; i--) {
        const x = i * barWidth;
        const peak = Math.max(0, activePeaks[i]);
        ctx.lineTo(x, midY + peak * ampHeight);
      }
      ctx.closePath();

      if (layers.length) {
        const focused = highlighted ?? (selectedTrackId ? [selectedTrackId] : []);
        const hasFocus = layers.some(layer => focused.includes(layer.id));
        for (let layer = 0; layer < layers.length; layer++) {
          ctx.fillStyle = getStemColor(layers[layer].name);
          ctx.globalAlpha = hasFocus ? (focused.includes(layers[layer].id) ? 0.95 : 0.25) : 0.68;
          for (const side of [-1, 1]) {
            ctx.beginPath();
            for (let bin = 0; bin < barCount; bin++) {
              const x = bin * barWidth;
              const y = midY + side * boundaries[layer][bin].end * ampHeight;
              if (bin === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            for (let bin = barCount - 1; bin >= 0; bin--) {
              ctx.lineTo(bin * barWidth, midY + side * boundaries[layer][bin].start * ampHeight);
            }
            ctx.closePath();
            ctx.fill();
          }
        }
        ctx.globalAlpha = 1;
      } else {
        const baseGrad = ctx.createLinearGradient(0, 0, 0, h);
        baseGrad.addColorStop(0, 'rgba(0, 240, 255, 0.25)');
        baseGrad.addColorStop(0.5, 'rgba(0, 212, 255, 0.65)');
        baseGrad.addColorStop(1, 'rgba(0, 240, 255, 0.25)');
        ctx.fillStyle = baseGrad;
        ctx.fill();
      }

      // Sharp stroke contour
      ctx.strokeStyle = '#00f0ff';
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      for (let i = 0; i < barCount; i++) {
        const x = i * barWidth;
        const peak = Math.max(0, activePeaks[i]);
        const y = midY - peak * ampHeight;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      for (let i = barCount - 1; i >= 0; i--) {
        const x = i * barWidth;
        const peak = Math.max(0, activePeaks[i]);
        const y = midY + peak * ampHeight;
        ctx.lineTo(x, y);
      }
      ctx.stroke();

      // 2. Played Waveform Envelope
      if (!layers.length && playheadX > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, playheadX, h);
        ctx.clip();

        ctx.beginPath();
        ctx.moveTo(0, midY);
        for (let i = 0; i < barCount; i++) {
          const x = i * barWidth;
          const peak = Math.max(0, activePeaks[i]);
          ctx.lineTo(x, midY - peak * ampHeight);
        }
        for (let i = barCount - 1; i >= 0; i--) {
          const x = i * barWidth;
          const peak = Math.max(0, activePeaks[i]);
          ctx.lineTo(x, midY + peak * ampHeight);
        }
        ctx.closePath();

        const playedGrad = ctx.createLinearGradient(0, 0, 0, h);
        playedGrad.addColorStop(0, 'rgba(0, 255, 65, 0.5)');
        playedGrad.addColorStop(0.5, 'rgba(0, 255, 120, 0.9)');
        playedGrad.addColorStop(1, 'rgba(0, 255, 65, 0.5)');
        ctx.fillStyle = playedGrad;
        ctx.fill();
        ctx.restore();
      }

      // 3. Selection highlight
      if (hasSel) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(selStartX, 0, selEndX - selStartX, h);
        ctx.clip();

        ctx.beginPath();
        ctx.moveTo(0, midY);
        for (let i = 0; i < barCount; i++) {
          const x = i * barWidth;
          const peak = Math.max(0, activePeaks[i]);
          ctx.lineTo(x, midY - peak * (midY * 0.88));
        }
        for (let i = barCount - 1; i >= 0; i--) {
          const x = i * barWidth;
          const peak = Math.max(0, activePeaks[i]);
          ctx.lineTo(x, midY + peak * (midY * 0.88));
        }
        ctx.closePath();

        ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.fill();
        ctx.restore();
      }
    }

    // Selection Bounds, Glow & Handles
    if (hasSel) {
      const selW = selEndX - selStartX;

      // Glow fill
      ctx.fillStyle = 'rgba(0, 255, 255, 0.14)';
      ctx.fillRect(selStartX, 0, selW, h);

      // Boundary strokes
      ctx.strokeStyle = '#00ffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(selStartX, 0);
      ctx.lineTo(selStartX, h);
      ctx.moveTo(selEndX, 0);
      ctx.lineTo(selEndX, h);
      ctx.stroke();

      // Top & bottom glow lines
      ctx.strokeStyle = 'rgba(0, 255, 255, 0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(selStartX, 0);
      ctx.lineTo(selEndX, 0);
      ctx.moveTo(selStartX, h);
      ctx.lineTo(selEndX, h);
      ctx.stroke();

      // Left Draggable Handle Grip
      ctx.fillStyle = '#00ffff';
      ctx.fillRect(selStartX - 5, h / 2 - 18, 10, 36);
      ctx.fillStyle = '#09090b';
      ctx.fillRect(selStartX - 1, h / 2 - 10, 2, 20);

      // Right Draggable Handle Grip
      ctx.fillStyle = '#ff0055';
      ctx.fillRect(selEndX - 5, h / 2 - 18, 10, 36);
      ctx.fillStyle = '#09090b';
      ctx.fillRect(selEndX - 1, h / 2 - 10, 2, 20);
    }

    // Playhead line
    ctx.strokeStyle = '#00ccff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, h);
    ctx.stroke();

    // Playhead cap
    ctx.fillStyle = '#00ccff';
    ctx.beginPath();
    ctx.arc(playheadX, 6, 5, 0, Math.PI * 2);
    ctx.fill();
  }, [activePeaks, currentRatio, effectiveRatioSelection, showSelection, activeReworkedTake, duration, layers, selectedTrackId, highlighted, boundaries]);

  useEffect(() => {
    renderWaveform();
  }, [renderWaveform]);
  const draw = useRef(renderWaveform);
  draw.current = renderWaveform;

  // Window resize observer for canvas auto-fitting
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ro = new ResizeObserver(() => {
      requestAnimationFrame(() => draw.current());
    });
    ro.observe(canvas);
    if (canvas.parentElement) {
      ro.observe(canvas.parentElement);
    }

    return () => ro.disconnect();
  }, []);

  // =========================================================================
  // Pointer Events & Gesture Engine (Unified Touch, Mouse, Pinch)
  // =========================================================================
  const updateSelectionState = useCallback(
    (newStartRatio: number, newEndRatio: number) => {
      const clampedStart = Math.max(0, Math.min(newStartRatio, 0.99));
      const clampedEnd = Math.max(clampedStart + 0.01, Math.min(newEndRatio, 1));

      if (onSelectionChange) {
        onSelectionChange({ start: clampedStart, end: clampedEnd });
      }

      const totalDur = duration > 0 ? duration : 60;
      setSelection({
        start: clampedStart * totalDur,
        end: clampedEnd * totalDur,
      });
    },
    [duration, onSelectionChange, setSelection]
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!interactive) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    e.stopPropagation();

    canvas.setPointerCapture(e.pointerId);
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const w = rect.width;
    const ratio = Math.max(0, Math.min(1, x / w));

    // Two finger multi-touch pinch to zoom
    if (activePointers.current.size === 2) {
      const pts = Array.from(activePointers.current.values());
      pinchStartDist.current = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      pinchStartZoom.current = zoomFactor;
      setDragMode('pinch');
      dragRef.current.mode = 'pinch';
      return;
    }

    if (effectiveRatioSelection && showSelection) {
      const selStartX = effectiveRatioSelection.start * w;
      const selEndX = effectiveRatioSelection.end * w;

      if (Math.abs(x - selStartX) <= 14) {
        // Drag start handle
        dragRef.current = {
          mode: 'start',
          startX: x,
          startRatio: ratio,
          initialSel: { ...effectiveRatioSelection },
        };
        setDragMode('start');
        return;
      }

      if (Math.abs(x - selEndX) <= 14) {
        // Drag end handle
        dragRef.current = {
          mode: 'end',
          startX: x,
          startRatio: ratio,
          initialSel: { ...effectiveRatioSelection },
        };
        setDragMode('end');
        return;
      }

      if (x > selStartX && x < selEndX) {
        // Drag whole selection body (pan/slide across timeline)
        dragRef.current = {
          mode: 'pan',
          startX: x,
          startRatio: ratio,
          initialSel: { ...effectiveRatioSelection },
        };
        setDragMode('pan');
        return;
      }
    }

    // Clicked outside existing selection -> Marquee creation mode
    dragRef.current = {
      mode: 'create',
      startX: x,
      startRatio: ratio,
      initialSel: { start: ratio, end: ratio },
    };
    setDragMode('create');
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!interactive) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const w = rect.width;
    const ratio = Math.max(0, Math.min(1, x / w));

    // Dynamic cursor update when hovering without dragging
    if (dragMode === 'none') {
      if (effectiveRatioSelection && showSelection) {
        const selStartX = effectiveRatioSelection.start * w;
        const selEndX = effectiveRatioSelection.end * w;
        if (Math.abs(x - selStartX) <= 14 || Math.abs(x - selEndX) <= 14) {
          canvas.style.cursor = 'ew-resize';
        } else if (x > selStartX && x < selEndX) {
          canvas.style.cursor = 'grab';
        } else {
          canvas.style.cursor = 'crosshair';
        }
      } else {
        canvas.style.cursor = 'crosshair';
      }
      return;
    }

    // Multi-touch pinch-to-zoom calculation
    if (dragMode === 'pinch' && activePointers.current.size === 2) {
      const pts = Array.from(activePointers.current.values());
      const currentDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (pinchStartDist.current > 0) {
        const scale = currentDist / pinchStartDist.current;
        const newZoom = Math.max(1.0, Math.min(6.0, pinchStartZoom.current * scale));
        setZoomFactor(newZoom);
      }
      return;
    }

    const { mode, startRatio, startX, initialSel } = dragRef.current;

    if (mode === 'create') {
      const minR = Math.min(startRatio, ratio);
      const maxR = Math.max(startRatio, ratio);
      if (maxR - minR >= 0.01) {
        updateSelectionState(minR, maxR);
      }
    } else if (mode === 'start') {
      updateSelectionState(ratio, initialSel.end);
      canvas.style.cursor = 'ew-resize';
    } else if (mode === 'end') {
      updateSelectionState(initialSel.start, ratio);
      canvas.style.cursor = 'ew-resize';
    } else if (mode === 'pan') {
      const deltaRatio = (x - startX) / w;
      const span = initialSel.end - initialSel.start;
      const newStart = Math.max(0, Math.min(1 - span, initialSel.start + deltaRatio));
      updateSelectionState(newStart, newStart + span);
      canvas.style.cursor = 'grabbing';
    }
  };

  const triggerTapAtClientPos = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    const x = rect ? clientX - rect.left : 0;
    const w = rect ? rect.width : 1;
    const ratio = Math.max(0, Math.min(1, x / w));
    const bin = Math.min(activePeaks.length - 1, Math.floor(ratio * activePeaks.length));
    const magnitude = rect ? Math.abs(clientY - rect.top - rect.height / 2) / (rect.height / 2 * 0.88) : 0;
    const layer = layers.findIndex((_, index) => boundaries[index]?.[bin]?.start <= magnitude && boundaries[index][bin].end >= magnitude && boundaries[index][bin].end > boundaries[index][bin].start);
    const targetTrackId = layer < 0 ? 'master' : layers[layer].id;
    onSelectTrack?.(targetTrackId);
    if (onSeek) {
      onSeek(ratio);
    } else {
      const totalDur = duration > 0 ? duration : 60;
      const targetTime = ratio * totalDur;
      setPlayhead(targetTime);
      if (targetTrackId !== 'master') {
        dawEngine.auditionTrack(targetTrackId, targetTime);
      } else {
        dawEngine.stopAuditionTake();
        dawEngine.seek(targetTime);
        void dawEngine.startTransport();
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (canvas && canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }

    activePointers.current.delete(e.pointerId);

    const rect = canvas?.getBoundingClientRect();
    const x = rect ? e.clientX - rect.left : 0;

    // If tap without significant drag -> seek playhead and immediately play target stem or master
    if (dragRef.current.mode === 'create' || dragRef.current.mode === 'pan') {
      const dist = Math.abs(x - dragRef.current.startX);
      if (dist < 5) {
        triggerTapAtClientPos(e.clientX, e.clientY);
      }
    }

    setDragMode('none');
    dragRef.current.mode = 'none';
    if (canvas) canvas.style.cursor = 'default';
  };

  const rangeDrag = useRef<{ mode: 'start' | 'end' | 'pan'; x: number; selection: { start: number; end: number }; width: number } | null>(null);
  const handleRangeDown = (event: React.PointerEvent<HTMLButtonElement>, mode: 'start' | 'end' | 'pan') => {
    if (!effectiveRatioSelection || !canvasRef.current) return;
    event.stopPropagation(); event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    rangeDrag.current = { mode, x: event.clientX, selection: effectiveRatioSelection, width: canvasRef.current.getBoundingClientRect().width };
  };
  const handleRangeMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = rangeDrag.current;
    if (!drag) return;
    event.stopPropagation();
    const delta = (event.clientX - drag.x) / drag.width;
    if (drag.mode === 'start') updateSelectionState(Math.min(drag.selection.end - .01, drag.selection.start + delta), drag.selection.end);
    else if (drag.mode === 'end') updateSelectionState(drag.selection.start, Math.max(drag.selection.start + .01, drag.selection.end + delta));
    else {
      const span = drag.selection.end - drag.selection.start;
      const start = Math.max(0, Math.min(1 - span, drag.selection.start + delta));
      updateSelectionState(start, start + span);
    }
  };
  const handleRangeUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = rangeDrag.current;
    rangeDrag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (drag && Math.abs(event.clientX - drag.x) < 5) {
      triggerTapAtClientPos(event.clientX, event.clientY);
    }
  };

  return (
    <div
      className={`waveform-box ${className}`}
      style={{
        ...(height ? { height: `${height}px` } : {}),
        ...style,
      }}
    >
      <canvas
        ref={canvasRef}
        className="waveform-canvas"
        aria-label="Master waveform"
        data-lanes={layers.map(layer => layer.id).join(',')}
        data-selected-lane={selectedTrackId}
        data-highlighted-lanes={(highlighted ?? []).join(',')}
        data-peaks={activePeaks.length}
        onDoubleClick={onReworkSection}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
      {interactive && showSelection && effectiveRatioSelection && <div className="waveform-selection">
        {(['start', 'end', 'pan'] as const).map(mode => <button
          key={mode} type="button" className={`waveform-range ${mode}`}
          aria-label={mode === 'pan' ? 'Move selection' : `Selection ${mode}`}
          style={{ left: `${effectiveRatioSelection[mode === 'end' ? 'end' : 'start'] * 100}%`, ...(mode === 'pan' ? { width: `${(effectiveRatioSelection.end - effectiveRatioSelection.start) * 100}%` } : {}) }}
          onPointerDown={event => handleRangeDown(event, mode)} onPointerMove={handleRangeMove}
          onPointerUp={handleRangeUp} onPointerCancel={handleRangeUp} onClick={event => event.stopPropagation()}
        />)}
      </div>}
    </div>
  );
};
