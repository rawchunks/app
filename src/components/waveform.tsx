import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useDawStore, type DAWTrack } from '../lib/daw/store';
import { dawEngine } from '../lib/daw/engine';
import {
  extractPeaksFromUrl,
  extractBipolarPeaksFromUrl,
  readPeaks,
  contributions,
  createDefaultWaveSculpt,
  isIdentityWaveSculpt,
  getTrackOwnSculpt,
  composeWaveSculpts,
  evaluateSculptField,
  type WaveSculptState,
  type GranularPeakAnchor,
  type GranularTool,
  type WaveSculptMode,
} from '../lib/daw/peaks';
import { synthesizeStrudelBipolarPeaks } from '../lib/daw/strudel';
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
}

type DragMode = 'none' | 'pinch' | 'start' | 'end' | 'pan' | 'create' | 'sculpt' | 'anchor' | 'fadeIn' | 'fadeOut';

function transformMagnitudeArray(values: number[], sculpt?: WaveSculptState): number[] {
  if (!sculpt || isIdentityWaveSculpt(sculpt) || values.length === 0) return values;
  const n = values.length;
  const out = new Array<number>(n);
  const driveAmount = Math.max(0, Math.min(1, sculpt.drive ?? 0));
  const crestAmount = Math.max(-1, Math.min(1, sculpt.crest ?? 0));
  const textureAmount = Math.max(-1, Math.min(1, sculpt.texture ?? 0));

  const sampleAt = (normT: number): number => {
    if (n <= 1) return values[0] ?? 0;
    const pos = Math.max(0, Math.min(1, normT)) * (n - 1);
    const i1 = Math.max(0, Math.min(n - 1, Math.floor(pos)));
    const i0 = Math.max(0, i1 - 1);
    const i2 = Math.min(n - 1, i1 + 1);
    const i3 = Math.min(n - 1, i1 + 2);
    const u = pos - i1;
    const u2 = u * u;
    const u3 = u2 * u;
    const p0 = values[i0] ?? 0;
    const p1 = values[i1] ?? 0;
    const p2 = values[i2] ?? 0;
    const p3 = values[i3] ?? 0;
    return Math.max(
      0,
      0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3)
    );
  };

  const span = n > 2 ? 1.5 / (n - 1) : 0;

  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) : 0;
    const {
      gainLinear,
      warpedTime,
      fadeMultiplier,
      bend,
      smash,
      smooth,
      sharpen,
    } = evaluateSculptField(sculpt, t);

    const rawVal = sampleAt(warpedTime);
    const prevVal = span > 0 ? sampleAt(warpedTime - span) : rawVal;
    const nextVal = span > 0 ? sampleAt(warpedTime + span) : rawVal;
    const avgVal = 0.25 * prevVal + 0.5 * rawVal + 0.25 * nextVal;
    const detail = rawVal - avgVal;

    const totalGain = gainLinear * fadeMultiplier * Math.max(0.4, 1 + (textureAmount + bend * 0.25) * 0.22);
    const detailGain = Math.max(
      0.12,
      (1 - smooth * 0.85) * (1 + sharpen * 1.55 + Math.max(0, crestAmount) * 0.65)
    );

    const effectiveGain = totalGain * (1 - smooth * 0.14);

    const body = avgVal * effectiveGain;
    let p = Math.max(0, body + detail * detailGain * Math.min(2.6, effectiveGain));

    if (smash > 0.001) {
      const foldFreq = 1 + smash * 3.8;
      const folded = Math.abs(Math.sin(p * foldFreq * (Math.PI * 0.5)));
      p = p * (1 - smash * 0.72) + folded * (smash * 0.72);
    }

    if (driveAmount > 0.001) {
      const k = 1 + driveAmount * 3.5;
      p = Math.tanh(p * k) / Math.tanh(k);
    }
    out[i] = Math.min(1.52, Math.max(0, p));
  }
  return out;
}

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

function synthLayerValues(lane: DAWTrack): number[] {
  const values = new Array<number>(256).fill(0.14);
  if (lane.type === 'pianoroll') {
    const notes = lane.pianoRollNotes ?? [];
    if (notes.length > 0) {
      for (let bin = 0; bin < 256; bin++) {
        const stepPos = ((bin / 256) * 64) % 16;
        let energy = 0.08;
        for (const n of notes) {
          if (stepPos >= n.startTime && stepPos < n.startTime + Math.max(0.25, n.duration)) {
            energy += (n.velocity ?? 0.8) * 0.28;
          }
        }
        values[bin] = Math.min(0.95, energy);
      }
    }
  } else if (lane.type === 'sequencer' || Boolean(lane.activeVersionId && lane.sequencerVoices?.length)) {
    const voices = lane.sequencerVoices ?? [];
    if (voices.length > 0) {
      for (let bin = 0; bin < 256; bin++) {
        const stepIdx = Math.floor(((bin / 256) * 64) % 16);
        let activeCount = 0;
        for (const v of voices) {
          if (!v.muted && v.steps?.[stepIdx]) activeCount++;
        }
        values[bin] = Math.min(0.95, 0.08 + activeCount * 0.22);
      }
    }
  } else if (lane.type === 'strudel') {
    const synth = synthesizeStrudelBipolarPeaks(lane.strudelCode ?? '', 256);
    for (let bin = 0; bin < 256; bin++) {
      values[bin] = Math.max(0.08, synth.maxs[bin]);
    }
  }
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
}) => {
  const playheadRef = useRef<number>(useDawStore.getState().playhead);
  const savedDuration = useDawStore(state => state.duration);
  const duration = timelineDuration ?? savedDuration;
  const setPlayhead = useDawStore(state => state.setPlayhead);
  const setSelection = useDawStore(state => state.setSelection);
  const takes = useDawStore(state => state.takes);
  const tracks = useDawStore(state => state.tracks);
  const updateTrackSculpt = useDawStore(state => state.updateTrackSculpt);
  const resetTrackSculpt = useDawStore(state => state.resetTrackSculpt);
  const globalSculptMode = useDawStore(state => state.sculptMode);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const staticCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const staticCacheRef = useRef<{
    w: number;
    h: number;
    dpr: number;
    zoomFactor: number;
    viewOffset: number;
    activePeaks: number[];
    rawActivePeaks: number[];
    hasSculpt: boolean;
    layers: { id: string; name: string; values: number[] }[];
    boundaries: { start: number; end: number }[][];
    selectedTrackId?: string;
    highlightedKey: string;
    reworkId?: string;
    duration: number;
  } | null>(null);

  const targetSculptTrackId = 'master';

  const masterSculpt = useMemo(
    () => tracks.find(t => t.id === 'master')?.sculpt,
    [tracks]
  );
  const effectiveSculpt = useMemo<WaveSculptState>(
    () => masterSculpt ?? createDefaultWaveSculpt(),
    [masterSculpt]
  );
  const composedMasterVisualSculpt = useMemo<WaveSculptState>(() => {
    let acc: WaveSculptState | undefined = effectiveSculpt;
    for (const t of tracks) {
      if (t.id === 'master' || t.mounted === false || t.muted) continue;
      const laneSculpt = getTrackOwnSculpt(t);
      if (laneSculpt) {
        acc = composeWaveSculpts(acc, laneSculpt);
      }
    }
    return acc ?? effectiveSculpt;
  }, [effectiveSculpt, tracks]);
  const hasAnyLaneSculpt = useMemo(
    () => tracks.some(t => t.id !== 'master' && t.mounted !== false && !t.muted && Boolean(getTrackOwnSculpt(t))),
    [tracks]
  );
  const sculptMode: WaveSculptMode = globalSculptMode ?? effectiveSculpt.mode ?? 'granular';
  const hasSculpt = useMemo(() => !isIdentityWaveSculpt(composedMasterVisualSculpt), [composedMasterVisualSculpt]);
  const [activeSculptNodeId, setActiveSculptNodeId] = useState<string | null>(null);
  const [activeAnchorId, setActiveAnchorId] = useState<string | null>(null);
  const [hoverPeak, setHoverPeak] = useState<{ ratio: number; peakY: number } | null>(null);

  const [loadedPeaks, setLoadedPeaks] = useState<number[]>(() => customPeaks?.length ? customPeaks : magnitudes(audioUrl));

  useEffect(() => {
    if (customPeaks && customPeaks.length > 0) {
      setLoadedPeaks(customPeaks);
      return;
    }
    const syncPeaks = magnitudes(audioUrl);
    setLoadedPeaks(syncPeaks);
    if (syncPeaks.length > 0) {
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

  const laneKey = JSON.stringify(
    lanes.map(lane => ({
      id: lane.id,
      name: lane.name,
      type: lane.type,
      activeVersionId: lane.activeVersionId,
      clips: lane.clips.map(({ url, offset, duration, startTime }) => ({ url, offset, duration, startTime })),
      pianoRollNotes: lane.pianoRollNotes,
      sequencerVoices: lane.sequencerVoices?.map(v => ({ muted: v.muted, steps: v.steps })),
      strudelCode: lane.strudelCode,
    }))
  );
  const sources = useMemo<DAWTrack[]>(() => JSON.parse(laneKey), [laneKey]);
  const storedLayers = useMemo(() => duration > 0 ? sources.flatMap(lane => {
    const isSynthActive = Boolean(lane.activeVersionId && lane.sequencerVoices?.length) || (lane.clips.length === 0 && (lane.type === 'pianoroll' || lane.type === 'sequencer' || lane.type === 'strudel' || lane.type === 'sample'));
    if (isSynthActive) {
      return [{ id: lane.id, name: lane.name, values: synthLayerValues(lane) }];
    }
    const peaks = lane.clips.map(clip => readPeaks(clip.url, Math.max(1, Math.ceil(clip.duration / duration * 256)), clip.offset, clip.duration));
    return peaks.every(peak => peak !== null) ? [{ id: lane.id, name: lane.name, values: layerValues(lane.clips, duration, peaks) }] : [];
  }) : [], [sources, duration]);
  const [loadedLayers, setLayers] = useState<{ key: string; duration: number; values: typeof storedLayers } | null>(null);
  const rawLayers = loadedLayers?.key === laneKey && loadedLayers.duration === duration ? loadedLayers.values : storedLayers;
  const layers = useMemo(() => {
    return rawLayers.map(layer => {
      const laneTrack = tracks.find(t => t.id === layer.id);
      const laneSculpt = getTrackOwnSculpt(laneTrack);
      const composedSculpt = composeWaveSculpts(masterSculpt, laneSculpt);
      return {
        ...layer,
        values: transformMagnitudeArray(layer.values, composedSculpt),
      };
    });
  }, [rawLayers, tracks, masterSculpt]);

  useEffect(() => {
    let current = true;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    if (!sources.length || duration <= 0 || storedLayers.length === sources.length) return;
    const loadSeparatedLayers = () => {
      Promise.all(sources.map(async lane => {
        const isSynthActive = Boolean(lane.activeVersionId && lane.sequencerVoices?.length) || (lane.clips.length === 0 && (lane.type === 'pianoroll' || lane.type === 'sequencer' || lane.type === 'strudel' || lane.type === 'sample'));
        if (isSynthActive) {
          return { id: lane.id, name: lane.name, values: synthLayerValues(lane) };
        }
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
  }, [sources, laneKey, duration, storedLayers.length]);

  const [, setDragMode] = useState<DragMode>('none');
  const [zoomFactor, setZoomFactor] = useState<number>(1.0);
  const [viewOffset, setViewOffset] = useState<number>(0);

  const activePointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStartDist = useRef<number>(0);
  const pinchStartZoom = useRef<number>(1.0);

  const ratioToLocalX = useCallback(
    (ratio: number, w: number) => ((ratio - viewOffset) * zoomFactor) * w,
    [viewOffset, zoomFactor]
  );

  const localXToRatio = useCallback(
    (localX: number, w: number) =>
      Math.max(0, Math.min(1, viewOffset + (localX / Math.max(1, w)) / zoomFactor)),
    [viewOffset, zoomFactor]
  );

  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressNextClickRef = useRef<boolean>(false);

  const dragRef = useRef<{
    mode: DragMode;
    startX: number;
    startY?: number;
    startRatio: number;
    initialSel: { start: number; end: number };
    sculptNodeId?: string;
    anchorId?: string;
    anchorsSnapshot?: GranularPeakAnchor[];
    pendingAnchor?: GranularPeakAnchor;
    isNewAnchor?: boolean;
    grabSide?: number;
    tool?: GranularTool;
    initialGainDb?: number;
    initialWarpOffset?: number;
    initialTimeShift?: number;
    initialBend?: number;
    initialSmash?: number;
    initialSmooth?: number;
    initialSharpen?: number;
    initialRadius?: number;
    moved?: boolean;
    held?: boolean;
    downTime?: number;
    alreadySeeked?: boolean;
  }>({
    mode: 'none',
    startX: 0,
    startRatio: 0,
    initialSel: { start: 0, end: 1 },
  });

  const sourcePeaks = customPeaks && customPeaks.length > 0 ? customPeaks : loadedPeaks;
  const rawActivePeaks = useMemo(() => {
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

  const activePeaks = useMemo(() => {
    if (!hasAnyLaneSculpt) {
      return transformMagnitudeArray(rawActivePeaks, effectiveSculpt);
    }
    if (rawLayers.length > 0 && rawActivePeaks.length > 0) {
      const masterOnlyPeaks = transformMagnitudeArray(rawActivePeaks, effectiveSculpt);
      const masterOnlyLayers = rawLayers.map(layer =>
        transformMagnitudeArray(layer.values, masterSculpt)
      );
      return masterOnlyPeaks.map((peak, i) => {
        let baseSum = 0;
        let sculptedSum = 0;
        for (let k = 0; k < rawLayers.length; k++) {
          baseSum += masterOnlyLayers[k]?.[i] ?? 0;
          sculptedSum += layers[k]?.values[i] ?? 0;
        }
        if (baseSum <= 1e-4) return peak;
        const ratio = Math.max(0, Math.min(2.5, sculptedSum / baseSum));
        return Math.min(1.52, Math.max(0, peak * ratio));
      });
    }
    return transformMagnitudeArray(rawActivePeaks, composedMasterVisualSculpt);
  }, [rawActivePeaks, effectiveSculpt, hasAnyLaneSculpt, rawLayers, masterSculpt, layers, composedMasterVisualSculpt]);

  const boundaries = useMemo(() => {
    if (!layers.length) return [];
    const hasAudioStems = sources.some(s => s.type === 'stem' && s.clips.length > 0);
    if (!hasAudioStems) {
      const baseMaster = activePeaks.map(p => Math.max(0.24, p * 0.65));
      return contributions(activePeaks, [baseMaster, ...layers.map(layer => layer.values)]).slice(1);
    }
    return contributions(activePeaks, layers.map(layer => layer.values));
  }, [activePeaks, layers, sources]);

  // Active time selection normalized to [0, 1]
  const storeSel = useDawStore((s) => s.selection);
  const effectiveRatioSelection = customSelection !== undefined
    ? customSelection
    : storeSel && duration > 0
    ? { start: Math.max(0, storeSel.start / duration), end: Math.min(1, storeSel.end / duration) }
    : null;

  // Look for any active reworked take on this song to highlight on the waveform
  const activeReworkedTake = takes.find(t => t.is_active && t.provenance?.target === 'master' && t.provenance.region && t.repainting_start != null && t.repainting_end != null);

  // =========================================================================
  // Canvas Rendering Pipeline (Offscreen Static Layer Cache + Fast Dynamic Blit)
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

    const targetW = Math.round(w * dpr);
    const targetH = Math.round(h * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    const virtualW = w * zoomFactor;
    const barCount = activePeaks.length;
    const midY = h / 2;
    const barWidth = barCount > 0 ? virtualW / barCount : 0;
    const ampHeight = midY * 0.88;
    const highlightedKey = (highlighted ?? []).join(',');
    const reworkId = activeReworkedTake ? `${activeReworkedTake.id}:${activeReworkedTake.repainting_start}:${activeReworkedTake.repainting_end}` : undefined;

    const prevStatic = staticCacheRef.current;
    const needsStaticRebuild =
      !prevStatic ||
      !staticCanvasRef.current ||
      prevStatic.w !== targetW ||
      prevStatic.h !== targetH ||
      prevStatic.dpr !== dpr ||
      prevStatic.zoomFactor !== zoomFactor ||
      prevStatic.viewOffset !== viewOffset ||
      prevStatic.activePeaks !== activePeaks ||
      prevStatic.rawActivePeaks !== rawActivePeaks ||
      prevStatic.hasSculpt !== hasSculpt ||
      prevStatic.layers !== layers ||
      prevStatic.boundaries !== boundaries ||
      prevStatic.selectedTrackId !== selectedTrackId ||
      prevStatic.highlightedKey !== highlightedKey ||
      prevStatic.reworkId !== reworkId ||
      prevStatic.duration !== duration;

    if (needsStaticRebuild && typeof document !== 'undefined') {
      if (!staticCanvasRef.current) {
        staticCanvasRef.current = document.createElement('canvas');
      }
      const sCanvas = staticCanvasRef.current;
      if (sCanvas.width !== targetW || sCanvas.height !== targetH) {
        sCanvas.width = targetW;
        sCanvas.height = targetH;
      }
      const sCtx = sCanvas.getContext('2d');
      if (sCtx) {
        sCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        sCtx.fillStyle = '#08080a';
        sCtx.fillRect(0, 0, w, h);

        sCtx.save();
        sCtx.translate(-viewOffset * zoomFactor * w, 0);

        // Measure / Beat grid divisions
        sCtx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        sCtx.lineWidth = 1;
        const gridDivisions = Math.round(16 * zoomFactor);
        for (let i = 0; i <= gridDivisions; i++) {
          const x = (virtualW / gridDivisions) * i;
          sCtx.beginPath();
          sCtx.moveTo(x, 0);
          sCtx.lineTo(x, h);
          sCtx.stroke();
        }

        // AI Reworked Section indicator overlay if active take exists
        if (
          activeReworkedTake &&
          duration > 0 &&
          typeof activeReworkedTake.repainting_start === 'number' &&
          typeof activeReworkedTake.repainting_end === 'number'
        ) {
          const reworkStartX = (activeReworkedTake.repainting_start / duration) * virtualW;
          const reworkEndX = (activeReworkedTake.repainting_end / duration) * virtualW;
          const reworkW = Math.max(2, reworkEndX - reworkStartX);

          sCtx.fillStyle = 'rgba(0, 255, 255, 0.12)';
          sCtx.fillRect(reworkStartX, 0, reworkW, h);

          sCtx.strokeStyle = '#00ffff';
          sCtx.lineWidth = 1.5;
          sCtx.setLineDash([4, 4]);
          sCtx.strokeRect(reworkStartX, 1, reworkW, h - 2);
          sCtx.setLineDash([]);

          sCtx.fillStyle = '#00ffff';
          sCtx.font = '700 9px monospace';
          sCtx.fillText(`TAKE ${activeReworkedTake.take_number}: REWORKED`, reworkStartX + 4, 12);
        }

        // Center zero baseline
        sCtx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        sCtx.lineWidth = 1;
        sCtx.beginPath();
        sCtx.moveTo(0, midY);
        sCtx.lineTo(virtualW, midY);
        sCtx.stroke();

        if (barCount === 0) {
          sCtx.strokeStyle = 'rgba(0, 255, 255, 0.2)';
          sCtx.setLineDash([4, 6]);
          sCtx.beginPath();
          sCtx.moveTo(0, midY);
          sCtx.lineTo(virtualW, midY);
          sCtx.stroke();
          sCtx.setLineDash([]);
        } else {
          // 0. Ghost Unsculpted Reference Envelope when Wave-Sculpt is active
          if (hasSculpt && rawActivePeaks.length === barCount) {
            sCtx.save();
            sCtx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
            sCtx.lineWidth = 1;
            sCtx.setLineDash([3, 3]);
            sCtx.beginPath();
            for (let i = 0; i < barCount; i++) {
              const x = i * barWidth;
              const peak = Math.max(0, rawActivePeaks[i]);
              const y = midY - peak * ampHeight;
              if (i === 0) sCtx.moveTo(x, y);
              else sCtx.lineTo(x, y);
            }
            for (let i = barCount - 1; i >= 0; i--) {
              const x = i * barWidth;
              const peak = Math.max(0, rawActivePeaks[i]);
              const y = midY + peak * ampHeight;
              sCtx.lineTo(x, y);
            }
            sCtx.closePath();
            sCtx.stroke();
            sCtx.restore();
          }

          // 1. True Audio Peak Envelope (Real PCM samples from AudioBuffer)
          sCtx.beginPath();
          sCtx.moveTo(0, midY);
          for (let i = 0; i < barCount; i++) {
            const x = i * barWidth;
            const peak = Math.max(0, activePeaks[i]);
            sCtx.lineTo(x, midY - peak * ampHeight);
          }
          for (let i = barCount - 1; i >= 0; i--) {
            const x = i * barWidth;
            const peak = Math.max(0, activePeaks[i]);
            sCtx.lineTo(x, midY + peak * ampHeight);
          }
          sCtx.closePath();

          const baseGrad = sCtx.createLinearGradient(0, 0, 0, h);
          baseGrad.addColorStop(0, layers.length ? 'rgba(0, 240, 255, 0.16)' : 'rgba(0, 240, 255, 0.28)');
          baseGrad.addColorStop(0.5, layers.length ? 'rgba(0, 212, 255, 0.42)' : 'rgba(0, 212, 255, 0.68)');
          baseGrad.addColorStop(1, layers.length ? 'rgba(0, 240, 255, 0.16)' : 'rgba(0, 240, 255, 0.28)');
          sCtx.fillStyle = baseGrad;
          sCtx.fill();

          if (layers.length) {
            for (let layer = 0; layer < layers.length; layer++) {
              sCtx.fillStyle = getStemColor(layers[layer].name);
              sCtx.globalAlpha = 0.72;
              for (const side of [-1, 1]) {
                sCtx.beginPath();
                for (let bin = 0; bin < barCount; bin++) {
                  const x = bin * barWidth;
                  const y = midY + side * boundaries[layer][bin].end * ampHeight;
                  if (bin === 0) sCtx.moveTo(x, y); else sCtx.lineTo(x, y);
                }
                for (let bin = barCount - 1; bin >= 0; bin--) {
                  sCtx.lineTo(bin * barWidth, midY + side * boundaries[layer][bin].start * ampHeight);
                }
                sCtx.closePath();
                sCtx.fill();
              }
            }
            sCtx.globalAlpha = 1;
          }

          // Sharp stroke contour
          sCtx.strokeStyle = '#00f0ff';
          sCtx.lineWidth = 1.0;
          sCtx.beginPath();
          for (let i = 0; i < barCount; i++) {
            const x = i * barWidth;
            const peak = Math.max(0, activePeaks[i]);
            const y = midY - peak * ampHeight;
            if (i === 0) sCtx.moveTo(x, y);
            else sCtx.lineTo(x, y);
          }
          for (let i = barCount - 1; i >= 0; i--) {
            const x = i * barWidth;
            const peak = Math.max(0, activePeaks[i]);
            const y = midY + peak * ampHeight;
            sCtx.lineTo(x, y);
          }
          sCtx.stroke();
        }

        sCtx.restore();
        staticCacheRef.current = {
          w: targetW,
          h: targetH,
          dpr,
          zoomFactor,
          viewOffset,
          activePeaks,
          rawActivePeaks,
          hasSculpt,
          layers,
          boundaries,
          selectedTrackId,
          highlightedKey,
          reworkId,
          duration,
        };
      }
    }

    if (staticCanvasRef.current && staticCanvasRef.current.width > 0 && staticCanvasRef.current.height > 0) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(staticCanvasRef.current, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    } else {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#08080a';
      ctx.fillRect(0, 0, w, h);
    }

    // Apply horizontal zoom/pan transform for dynamic timeline overlays
    ctx.save();
    ctx.translate(-viewOffset * zoomFactor * w, 0);

    const hasSel = showSelection && Boolean(effectiveRatioSelection);
    const selStartX = hasSel && effectiveRatioSelection ? effectiveRatioSelection.start * virtualW : 0;
    const selEndX = hasSel && effectiveRatioSelection ? effectiveRatioSelection.end * virtualW : virtualW;

    const currentRatio = customProgress !== undefined
      ? customProgress
      : duration > 0
      ? Math.max(0, Math.min(1, playheadRef.current / duration))
      : 0;
    const playheadX = currentRatio * virtualW;

    if (barCount > 0) {
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
          ctx.lineTo(x, midY - peak * ampHeight);
        }
        for (let i = barCount - 1; i >= 0; i--) {
          const x = i * barWidth;
          const peak = Math.max(0, activePeaks[i]);
          ctx.lineTo(x, midY + peak * ampHeight);
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

    // 4. Dual-Mode Wave-Sculpt Overlay: Granular Peak Anchors (default) vs Speed / Median Curve
    if (interactive) {
      const ampScale = midY * 0.78;
      ctx.save();

      // Fade-In & Fade-Out corner wedges and handles
      const fadeInX = Math.max(4, Math.min(virtualW * 0.45, effectiveSculpt.fadeIn * virtualW));
      const fadeOutX = Math.max(virtualW * 0.55, Math.min(virtualW - 4, (1 - effectiveSculpt.fadeOut) * virtualW));
      if (effectiveSculpt.fadeIn > 0.005) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.36)';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(fadeInX, 0);
        ctx.lineTo(0, h);
        ctx.closePath();
        ctx.fill();
      }
      if (effectiveSculpt.fadeOut > 0.005) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.36)';
        ctx.beginPath();
        ctx.moveTo(virtualW, 0);
        ctx.lineTo(fadeOutX, 0);
        ctx.lineTo(virtualW, h);
        ctx.closePath();
        ctx.fill();
      }
      if (sculptMode === 'curve' || effectiveSculpt.fadeIn > 0.005) {
        ctx.fillStyle = effectiveSculpt.fadeIn > 0.005 ? '#00ff88' : 'rgba(0, 240, 255, 0.55)';
        ctx.fillRect(fadeInX - 3.5, 2, 7, 7);
      }
      if (sculptMode === 'curve' || effectiveSculpt.fadeOut > 0.005) {
        ctx.fillStyle = effectiveSculpt.fadeOut > 0.005 ? '#00ff88' : 'rgba(0, 240, 255, 0.55)';
        ctx.fillRect(fadeOutX - 3.5, 2, 7, 7);
      }

      if (sculptMode === 'curve' && effectiveSculpt.nodes.length > 0) {
        const sortedNodes = [...effectiveSculpt.nodes].sort((a, b) => a.position - b.position);
        ctx.strokeStyle = hasSculpt ? '#00ff88' : 'rgba(0, 240, 255, 0.42)';
        ctx.lineWidth = hasSculpt ? 1.75 : 1.1;
        ctx.beginPath();
        const steps = 64;
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const field = evaluateSculptField(effectiveSculpt, t);
          const db = 20 * Math.log10(Math.max(0.06, field.gainLinear));
          const sx = t * virtualW;
          const sy = Math.max(5, Math.min(h - 5, midY - (db / 18) * ampScale));
          if (s === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        }
        ctx.stroke();

        sortedNodes.forEach((node) => {
          const effPos = Math.max(0.01, Math.min(0.99, node.position + (node.warpOffset || 0)));
          const nx = effPos * virtualW;
          const ny = Math.max(5, Math.min(h - 5, midY - (node.gainDb / 18) * ampScale));
          const isNodeActive = activeSculptNodeId === node.id;

          if (Math.abs(node.warpOffset) > 0.005) {
            const origX = node.position * virtualW;
            ctx.strokeStyle = 'rgba(0, 255, 136, 0.35)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(origX, ny);
            ctx.lineTo(nx, ny);
            ctx.stroke();
          }

          ctx.beginPath();
          ctx.arc(nx, ny, isNodeActive ? 5.5 : 4, 0, Math.PI * 2);
          ctx.fillStyle = isNodeActive ? '#ffffff' : (hasSculpt ? '#00ff88' : '#09090b');
          ctx.fill();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = '#00f0ff';
          ctx.stroke();
        });
      } else {
        // GRANULAR WAVE SHAPE DESIGN MODE: No artificial vertical lines or boxes — the wave contour itself deforms directly!
        if (hoverPeak && !activeAnchorId) {
          const hx = hoverPeak.ratio * virtualW;
          ctx.strokeStyle = 'rgba(0, 255, 136, 0.55)';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(hx, hoverPeak.peakY, 4, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      ctx.restore();
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

    ctx.restore();
  }, [
    activePeaks,
    rawActivePeaks,
    hasSculpt,
    effectiveSculpt,
    sculptMode,
    activeSculptNodeId,
    activeAnchorId,
    hoverPeak,
    interactive,
    customProgress,
    effectiveRatioSelection,
    showSelection,
    activeReworkedTake,
    duration,
    layers,
    selectedTrackId,
    highlighted,
    boundaries,
    zoomFactor,
    viewOffset,
  ]);

  useEffect(() => {
    renderWaveform();
  }, [renderWaveform]);
  const draw = useRef(renderWaveform);
  draw.current = renderWaveform;

  // Transient playhead subscription so 60fps playback redraws canvas without React re-renders
  useEffect(() => {
    if (customProgress !== undefined) return;
    playheadRef.current = useDawStore.getState().playhead;
    return useDawStore.subscribe((state, prev) => {
      if (state.playhead !== prev.playhead) {
        playheadRef.current = state.playhead;
        draw.current();
      }
    });
  }, [customProgress]);

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

  const findNearestSculptNode = useCallback(
    (localX: number, localY: number, width: number, heightPx: number, maxPixelDist: number) => {
      const midY = heightPx / 2;
      const ampScale = midY * 0.78;
      let bestNode = effectiveSculpt.nodes[0];
      let bestDist = Infinity;
      for (const node of effectiveSculpt.nodes) {
        const effPos = Math.max(0.01, Math.min(0.99, node.position + (node.warpOffset || 0)));
        const nx = ratioToLocalX(effPos, width);
        const ny = Math.max(5, Math.min(heightPx - 5, midY - (node.gainDb / 18) * ampScale));
        const dist = Math.hypot(localX - nx, localY - ny);
        if (dist < bestDist) {
          bestDist = dist;
          bestNode = node;
        }
      }
      return bestDist <= maxPixelDist ? bestNode : null;
    },
    [effectiveSculpt.nodes, ratioToLocalX]
  );

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
    if (!interactive) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cursorRatio = localXToRatio(e.clientX - rect.left, rect.width);

    if (e.altKey && sculptMode === 'granular') {
      const hitAnchor = findNearestAnchor(cursorRatio, 0.04 / zoomFactor);
      if (hitAnchor) {
        e.preventDefault();
        const deltaR = e.deltaY < 0 ? 0.006 : -0.006;
        const nextRadius = Math.max(0.006, Math.min(0.22, Number(((hitAnchor.radius || 0.04) + deltaR).toFixed(3))));
        const nextAnchors = (effectiveSculpt.anchors ?? []).map((a) =>
          a.id === hitAnchor.id ? { ...a, radius: nextRadius } : a
        );
        updateTrackSculpt(targetSculptTrackId, { anchors: nextAnchors });
        return;
      }
    }

    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
      const nextZoom = Math.max(1.0, Math.min(6.0, Number((zoomFactor * factor).toFixed(2))));
      const nextSpan = 1 / nextZoom;
      const nextOffset = Math.max(0, Math.min(1 - nextSpan, cursorRatio - ((e.clientX - rect.left) / Math.max(1, rect.width)) * nextSpan));
      setZoomFactor(nextZoom);
      setViewOffset(nextZoom <= 1.01 ? 0 : nextOffset);
    } else if (zoomFactor > 1.01 && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      e.preventDefault();
      const maxOffset = Math.max(0, 1 - 1 / zoomFactor);
      setViewOffset((prev) => Math.max(0, Math.min(maxOffset, prev + (e.deltaX / 600) / zoomFactor)));
    }
  };

  const isPointOutsideWaveform = useCallback(
    (ratio: number, localY: number, h: number): boolean => {
      const midY = h / 2;
      const distFromCenter = Math.abs(localY - midY);
      if (distFromCenter >= midY * 0.64) return true;
      if (activePeaks.length === 0) return true;
      const bin = Math.min(activePeaks.length - 1, Math.max(0, Math.floor(ratio * activePeaks.length)));
      const peak = Math.max(0.05, activePeaks[bin] ?? 0.15);
      const waveHalfHeight = Math.min(midY * 0.62, peak * (midY * 0.88));
      return distFromCenter > waveHalfHeight + 4;
    },
    [activePeaks]
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!interactive) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    e.stopPropagation();

    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {}
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const w = rect.width;
    const h = rect.height;
    const ratio = localXToRatio(x, w);

    // Two finger multi-touch pinch to zoom
    if (activePointers.current.size === 2) {
      const pts = Array.from(activePointers.current.values());
      pinchStartDist.current = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      pinchStartZoom.current = zoomFactor;
      setDragMode('pinch');
      dragRef.current.mode = 'pinch';
      return;
    }

    // Check top-left fadeIn and top-right fadeOut handles
    if (y <= Math.min(16, h * 0.32)) {
      const fadeInLocalX = ratioToLocalX(effectiveSculpt.fadeIn, w);
      const fadeOutLocalX = ratioToLocalX(1 - effectiveSculpt.fadeOut, w);
      if (Math.abs(x - fadeInLocalX) <= 13) {
        dragRef.current = {
          mode: 'fadeIn',
          startX: e.clientX,
          startY: e.clientY,
          startRatio: ratio,
          initialSel: effectiveRatioSelection ? { ...effectiveRatioSelection } : { start: 0, end: 1 },
        };
        setDragMode('fadeIn');
        return;
      }
      if (Math.abs(x - fadeOutLocalX) <= 13) {
        dragRef.current = {
          mode: 'fadeOut',
          startX: e.clientX,
          startY: e.clientY,
          startRatio: ratio,
          initialSel: effectiveRatioSelection ? { ...effectiveRatioSelection } : { start: 0, end: 1 },
        };
        setDragMode('fadeOut');
        return;
      }
    }

    const outsideWave = isPointOutsideWaveform(ratio, y, h);

    // Priority check for active selected-region edges (iv) and selected-region body pan/drag (iii)
    if (effectiveRatioSelection && showSelection) {
      const selStartX = ratioToLocalX(effectiveRatioSelection.start, w);
      const selEndX = ratioToLocalX(effectiveRatioSelection.end, w);

      if (Math.abs(x - selStartX) <= 12) {
        dragRef.current = {
          mode: 'start',
          startX: x,
          startRatio: ratio,
          initialSel: { ...effectiveRatioSelection },
          moved: false,
          downTime: performance.now(),
        };
        setDragMode('start');
        canvas.style.cursor = 'ew-resize';
        return;
      }

      if (Math.abs(x - selEndX) <= 12) {
        dragRef.current = {
          mode: 'end',
          startX: x,
          startRatio: ratio,
          initialSel: { ...effectiveRatioSelection },
          moved: false,
          downTime: performance.now(),
        };
        setDragMode('end');
        canvas.style.cursor = 'ew-resize';
        return;
      }

      if (x > selStartX + 12 && x < selEndX - 12) {
        if (holdTimerRef.current) {
          clearTimeout(holdTimerRef.current);
          holdTimerRef.current = null;
        }
        dragRef.current = {
          mode: 'pan',
          startX: x,
          startY: e.clientY,
          startRatio: ratio,
          initialSel: { ...effectiveRatioSelection },
          moved: false,
          downTime: performance.now(),
        };
        setDragMode('pan');
        canvas.style.cursor = 'grabbing';
        return;
      }
    }

    // (i) Single click OUTSIDE the waveform (above or below): instant seek & play;
    // (ii) Long-hold and drag: draw the selected-region
    if (outsideWave) {
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      triggerTapAtClientPos(e.clientX, e.clientY);
      dragRef.current = {
        mode: 'create',
        startX: x,
        startY: e.clientY,
        startRatio: ratio,
        initialSel: { start: ratio, end: ratio },
        moved: false,
        alreadySeeked: true,
        downTime: performance.now(),
      };
      setDragMode('create');
      return;
    }

    if (sculptMode === 'curve') {
      // Check Speed / Median Curve node handle hit
      const hitSculptNode = findNearestSculptNode(x, y, w, h, e.altKey || e.shiftKey ? w : 14);
      if (hitSculptNode) {
        setActiveSculptNodeId(hitSculptNode.id);
        dragRef.current = {
          mode: 'sculpt',
          startX: e.clientX,
          startY: e.clientY,
          startRatio: ratio,
          initialSel: effectiveRatioSelection ? { ...effectiveRatioSelection } : { start: 0, end: 1 },
          sculptNodeId: hitSculptNode.id,
          initialGainDb: hitSculptNode.gainDb,
          initialWarpOffset: hitSculptNode.warpOffset,
        };
        setDragMode('sculpt');
        return;
      }
    } else {
      // GRANULAR WAVE SHAPE DESIGN MODE: Direct finger/cursor peak manipulation on the waveform
      const hitDistRatio = Math.max(0.014, 16 / Math.max(60, w * zoomFactor));
      const existingAnchor = findNearestAnchor(ratio, hitDistRatio);
      const midY = h / 2;

      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      let targetAnchor: GranularPeakAnchor;
      const nextAnchors = [...(effectiveSculpt.anchors ?? [])];
      const isNewAnchor = !existingAnchor;
      if (existingAnchor) {
        targetAnchor = existingAnchor;
      } else {
        let snappedRatio = ratio;
        if (activePeaks.length > 0) {
          const centerBin = Math.min(activePeaks.length - 1, Math.max(0, Math.floor(ratio * activePeaks.length)));
          let bestBin = centerBin;
          let bestMag = -1;
          for (let b = Math.max(0, centerBin - 2); b <= Math.min(activePeaks.length - 1, centerBin + 2); b++) {
            const mag = activePeaks[b] ?? 0;
            if (mag > bestMag) {
              bestMag = mag;
              bestBin = b;
            }
          }
          snappedRatio = (bestBin + 0.5) / activePeaks.length;
        }
        targetAnchor = {
          id: `pk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          position: Number(snappedRatio.toFixed(4)),
          radius: Number(Math.max(0.035, Math.min(0.12, 0.075 / Math.sqrt(zoomFactor))).toFixed(3)),
          polarity: 'both',
          gainDb: 0,
          timeShift: 0,
          bend: 0,
          smash: 0,
          smooth: 0,
          sharpen: 0,
        };
      }

      const now = performance.now();
      dragRef.current = {
        mode: 'anchor',
        startX: e.clientX,
        startY: e.clientY,
        startRatio: ratio,
        initialSel: effectiveRatioSelection ? { ...effectiveRatioSelection } : { start: 0, end: 1 },
        anchorId: targetAnchor.id,
        anchorsSnapshot: nextAnchors,
        pendingAnchor: targetAnchor,
        isNewAnchor,
        grabSide: y >= midY ? -1 : 1,
        tool: 'grab',
        initialGainDb: targetAnchor.gainDb,
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
        if (dragRef.current.mode === 'anchor' && dragRef.current.anchorId === targetAnchor.id) {
          dragRef.current.held = true;
          setActiveAnchorId(targetAnchor.id);
        }
      }, 150);
      setDragMode('anchor');
      return;
    }

    // Clicked anywhere else on canvas -> Marquee region creation mode
    dragRef.current = {
      mode: 'create',
      startX: x,
      startRatio: ratio,
      initialSel: { start: ratio, end: ratio },
      moved: false,
      downTime: performance.now(),
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
    const y = e.clientY - rect.top;
    const w = rect.width;
    const h = rect.height;
    const ratio = localXToRatio(x, w);

    // Dynamic cursor update when hovering without dragging
    if (dragRef.current.mode === 'none') {
      if (y <= Math.min(16, h * 0.32)) {
        const fadeInLocalX = ratioToLocalX(effectiveSculpt.fadeIn, w);
        const fadeOutLocalX = ratioToLocalX(1 - effectiveSculpt.fadeOut, w);
        if (Math.abs(x - fadeInLocalX) <= 13 || Math.abs(x - fadeOutLocalX) <= 13) {
          canvas.style.cursor = 'ew-resize';
          return;
        }
      }
      if (effectiveRatioSelection && showSelection) {
        const selStartX = ratioToLocalX(effectiveRatioSelection.start, w);
        const selEndX = ratioToLocalX(effectiveRatioSelection.end, w);
        if (Math.abs(x - selStartX) <= 12 || Math.abs(x - selEndX) <= 12) {
          setHoverPeak(null);
          canvas.style.cursor = 'ew-resize';
          return;
        }
        if (x > selStartX + 12 && x < selEndX - 12) {
          setHoverPeak(null);
          canvas.style.cursor = 'grab';
          return;
        }
      }
      const outsideWave = isPointOutsideWaveform(ratio, y, h);
      if (outsideWave) {
        setHoverPeak(null);
        canvas.style.cursor = 'pointer';
        return;
      }
      if (sculptMode === 'curve') {
        const hoverNode = findNearestSculptNode(x, y, w, h, 13);
        if (hoverNode) {
          canvas.style.cursor = 'move';
          return;
        }
      } else if (activePeaks.length > 0) {
        const bin = Math.min(activePeaks.length - 1, Math.max(0, Math.floor(ratio * activePeaks.length)));
        const midY = h / 2;
        const sign = y >= midY ? 1 : -1;
        const peakY = Math.max(5, Math.min(h - 5, midY + sign * Math.max(0.06, activePeaks[bin] ?? 0.2) * (midY * 0.88)));
        setHoverPeak({ ratio: (bin + 0.5) / activePeaks.length, peakY });
        canvas.style.cursor = 'grab';
        return;
      }
      canvas.style.cursor = 'crosshair';
      return;
    }

    // Multi-touch pinch-to-zoom calculation
    if (dragRef.current.mode === 'pinch' && activePointers.current.size === 2) {
      const pts = Array.from(activePointers.current.values());
      const currentDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (pinchStartDist.current > 0) {
        const scale = currentDist / pinchStartDist.current;
        const newZoom = Math.max(1.0, Math.min(6.0, pinchStartZoom.current * scale));
        setZoomFactor(newZoom);
        if (newZoom <= 1.01) setViewOffset(0);
      }
      return;
    }

    const {
      mode,
      startRatio,
      startX,
      startY,
      initialSel,
      sculptNodeId,
      anchorId,
      initialGainDb,
      initialWarpOffset,
      initialTimeShift,
      initialBend,
      initialSmash,
      initialSmooth,
      initialSharpen,
    } = dragRef.current;

    if (mode === 'fadeIn') {
      const nextFadeIn = Math.max(0, Math.min(0.45, Number(ratio.toFixed(3))));
      updateTrackSculpt(targetSculptTrackId, { fadeIn: nextFadeIn });
      canvas.style.cursor = 'ew-resize';
      return;
    }

    if (mode === 'fadeOut') {
      const nextFadeOut = Math.max(0, Math.min(0.45, Number((1 - ratio).toFixed(3))));
      updateTrackSculpt(targetSculptTrackId, { fadeOut: nextFadeOut });
      canvas.style.cursor = 'ew-resize';
      return;
    }

    if (mode === 'sculpt' && sculptNodeId) {
      // SPEED / MEDIAN CURVE MODE: Modify node gainDb and warpOffset
      const deltaY = e.clientY - (startY ?? e.clientY);
      const deltaX = e.clientX - startX;
      const gainDeltaDb = (-deltaY / Math.max(24, h * 0.42)) * 15;
      const nextGainDb = Math.max(-24, Math.min(12, (initialGainDb ?? 0) + gainDeltaDb));
      const warpDelta = (deltaX / Math.max(80, w * zoomFactor)) * 0.6;
      const nextWarp = Math.max(-0.35, Math.min(0.35, (initialWarpOffset ?? 0) + warpDelta));

      const nextNodes = effectiveSculpt.nodes.map((node) =>
        node.id === sculptNodeId
          ? {
              ...node,
              gainDb: Number(nextGainDb.toFixed(2)),
              warpOffset: Number(nextWarp.toFixed(3)),
            }
          : node
      );

      updateTrackSculpt(targetSculptTrackId, {
        mode: 'curve',
        nodes: nextNodes,
      });
      canvas.style.cursor = 'move';
      return;
    }

    if (mode === 'anchor' && anchorId) {
      const deltaY = e.clientY - (startY ?? e.clientY);
      const deltaX = e.clientX - startX;
      if (!dragRef.current.moved && Math.hypot(deltaX, deltaY) < 5) return;
      if (!dragRef.current.moved) {
        dragRef.current.moved = true;
        if (holdTimerRef.current) {
          clearTimeout(holdTimerRef.current);
          holdTimerRef.current = null;
        }
        // Horizontal drag creates/updates a timeline region selection; vertical drag sculpts peak amplitude
        if (!dragRef.current.held && showSelection && Math.abs(deltaX) >= Math.abs(deltaY) * 0.85) {
          dragRef.current.mode = 'create';
          setDragMode('create');
          const minR = Math.min(startRatio, ratio);
          const maxR = Math.max(startRatio, ratio);
          if (maxR - minR >= 0.008) {
            updateSelectionState(minR, maxR);
          }
          canvas.style.cursor = 'crosshair';
          return;
        }
        setActiveAnchorId(anchorId);
        if (dragRef.current.isNewAnchor && dragRef.current.pendingAnchor) {
          let snap = [...(dragRef.current.anchorsSnapshot ?? effectiveSculpt.anchors ?? [])];
          if (snap.length >= 24) {
            snap = snap.slice(snap.length - 23);
          }
          snap.push(dragRef.current.pendingAnchor);
          dragRef.current.anchorsSnapshot = snap;
          dragRef.current.isNewAnchor = false;
        }
      }

      const normDy = -deltaY / Math.max(18, h * 0.36);
      const normDx = deltaX / Math.max(45, w * zoomFactor);

      const baseAnchors = dragRef.current.anchorsSnapshot ?? effectiveSculpt.anchors ?? [];
      const grabSide = dragRef.current.grabSide ?? 1;
      const nextAnchors = baseAnchors.map((anchor) => {
        if (anchor.id !== anchorId) return anchor;
        const signedVertical = normDy * grabSide;

        const nextGainDb = Math.max(
          -24,
          Math.min(18, Number(((initialGainDb ?? 0) + signedVertical * 16).toFixed(1)))
        );
        const nextTimeShift = Math.max(
          -0.25,
          Math.min(0.25, Number(((initialTimeShift ?? 0) + normDx * 0.75).toFixed(3)))
        );
        const nextBend = Math.max(
          -1,
          Math.min(1, Number(((initialBend ?? 0) + normDx * 1.35).toFixed(2)))
        );
        const nextSharpen =
          signedVertical > 0
            ? Math.max(0, Math.min(1, Number(((initialSharpen ?? 0) + signedVertical * 0.55).toFixed(2))))
            : (initialSharpen ?? 0);
        const nextSmooth =
          signedVertical < 0
            ? Math.max(0, Math.min(1, Number(((initialSmooth ?? 0) + Math.abs(signedVertical) * 0.55).toFixed(2))))
            : (initialSmooth ?? 0);
        const nextSmash = e.altKey
          ? Math.max(0, Math.min(1, Number(((initialSmash ?? 0) + Math.abs(normDy) * 0.9).toFixed(2))))
          : (initialSmash ?? 0);

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
      dragRef.current.anchorsSnapshot = nextAnchors;

      updateTrackSculpt(targetSculptTrackId, { mode: 'granular', anchors: nextAnchors });
      canvas.style.cursor = 'grabbing';
      return;
    }

    if (mode === 'create') {
      const minR = Math.min(startRatio, ratio);
      const maxR = Math.max(startRatio, ratio);
      if (maxR - minR >= 0.008) {
        dragRef.current.moved = true;
        updateSelectionState(minR, maxR);
      }
    } else if (mode === 'start') {
      updateSelectionState(ratio, initialSel.end);
      canvas.style.cursor = 'ew-resize';
    } else if (mode === 'end') {
      updateSelectionState(initialSel.start, ratio);
      canvas.style.cursor = 'ew-resize';
    } else if (mode === 'pan') {
      if (Math.abs(x - startX) >= 3) {
        dragRef.current.moved = true;
      }
      if (dragRef.current.moved) {
        const deltaRatio = ((x - startX) / w) / zoomFactor;
        const span = initialSel.end - initialSel.start;
        const newStart = Math.max(0, Math.min(1 - span, initialSel.start + deltaRatio));
        updateSelectionState(newStart, newStart + span);
      }
      canvas.style.cursor = 'grabbing';
    }
  };

  const triggerTapAtClientPos = (clientX: number, _clientY: number) => {
    const canvas = canvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    const x = rect ? clientX - rect.left : 0;
    const w = rect ? rect.width : 1;
    const ratio = localXToRatio(x, w);
    onSelectTrack?.('master');
    if (onSeek) {
      onSeek(ratio);
    } else {
      const totalDur = duration > 0 ? duration : 60;
      const targetTime = ratio * totalDur;
      setPlayhead(targetTime);
      const storeState = useDawStore.getState();
      storeState.tracks.forEach((t) => {
        if (t.id !== 'master' && t.solo) {
          storeState.updateTrackMixer(t.id, { solo: false });
        }
      });
      dawEngine.stopAuditionTake(true);
      dawEngine.seek(targetTime);
      void dawEngine.startTransport(false);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    const canvas = canvasRef.current;
    if (canvas && canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }

    activePointers.current.delete(e.pointerId);

    const rect = canvas?.getBoundingClientRect();
    const x = rect ? e.clientX - rect.left : 0;
    const elapsed = performance.now() - (dragRef.current.downTime ?? performance.now());
    const didHoldOrDrag = Boolean(dragRef.current.moved || dragRef.current.held || elapsed >= 180);

    // Click / Light-Touch (<180ms & <4px drag) -> Play/Seek ONLY (zero wave mutation)
    // Hold-Click / Dragging (>=150ms hold OR >=4px drag) -> Wave Manipulation ONLY (zero play/seek)
    if (dragRef.current.mode === 'anchor') {
      if (!didHoldOrDrag) {
        triggerTapAtClientPos(e.clientX, e.clientY);
      } else {
        suppressNextClickRef.current = true;
      }
    } else if (
      dragRef.current.mode === 'sculpt' ||
      dragRef.current.mode === 'fadeIn' ||
      dragRef.current.mode === 'fadeOut'
    ) {
      suppressNextClickRef.current = true;
    } else if (dragRef.current.mode === 'pan') {
      const dist = Math.abs(x - dragRef.current.startX);
      if (!dragRef.current.moved && dist < 5) {
        triggerTapAtClientPos(e.clientX, e.clientY);
      } else {
        suppressNextClickRef.current = true;
      }
    } else if (dragRef.current.mode === 'create') {
      const dist = Math.abs(x - dragRef.current.startX);
      if (!dragRef.current.moved && !dragRef.current.alreadySeeked && dist < 5 && elapsed < 240) {
        triggerTapAtClientPos(e.clientX, e.clientY);
      } else {
        suppressNextClickRef.current = true;
      }
    }

    dragRef.current.mode = 'none';
    setDragMode('none');
    setActiveSculptNodeId(null);
    setActiveAnchorId(null);
    if (canvas) canvas.style.cursor = 'default';
  };

  const handleCanvasDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (canvas && interactive) {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (sculptMode === 'granular') {
        const ratio = localXToRatio(x, rect.width);
        const hitAnchor = findNearestAnchor(ratio, 0.035 / zoomFactor);
        if (hitAnchor) {
          e.stopPropagation();
          const remaining = (effectiveSculpt.anchors ?? []).filter((a) => a.id !== hitAnchor.id);
          updateTrackSculpt(targetSculptTrackId, { anchors: remaining });
          return;
        }
      } else {
        const hitNode = findNearestSculptNode(x, y, rect.width, rect.height, 16);
        if (hitNode || e.altKey) {
          e.stopPropagation();
          resetTrackSculpt(targetSculptTrackId);
          return;
        }
      }
    }
    onReworkSection?.();
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
      style={height ? ({ '--waveform-h': `${height}px` } as React.CSSProperties) : undefined}
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
        className="waveform-canvas"
        aria-label="Master waveform"
        data-lanes={layers.map(layer => layer.id).join(',')}
        data-selected-lane={selectedTrackId}
        data-highlighted-lanes={(highlighted ?? []).join(',')}
        data-peaks={activePeaks.length}
        data-sculpted={hasSculpt ? 'true' : undefined}
        data-sculpt-mode={sculptMode}
        onDoubleClick={handleCanvasDoubleClick}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
      {interactive && showSelection && effectiveRatioSelection && <div className="waveform-selection">
        {(['start', 'end', 'pan'] as const).map(mode => <button
          key={mode} type="button" className={`waveform-range ${mode}`}
          aria-label={mode === 'pan' ? 'Move selection' : `Selection ${mode}`}
          style={
            {
              '--range-left': `${effectiveRatioSelection[mode === 'end' ? 'end' : 'start'] * 100}%`,
              ...(mode === 'pan' ? { '--range-width': `${(effectiveRatioSelection.end - effectiveRatioSelection.start) * 100}%` } : {}),
            } as React.CSSProperties
          }
          onPointerDown={event => handleRangeDown(event, mode)} onPointerMove={handleRangeMove}
          onPointerUp={handleRangeUp} onPointerCancel={handleRangeUp} onClick={event => event.stopPropagation()}
        />)}
      </div>}
    </div>
  );
};

