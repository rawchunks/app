interface Version {
  id: string;
  stem_id?: string | null;
  url: string;
  is_active: boolean;
  model?: string;
  task?: string;
  repainting_start?: number | null;
  repainting_end?: number | null;
  provenance?: { target?: string; layerName?: string; audioOffset?: number; region?: { start: number; end: number } | null; regions?: { start: number; end: number }[]; outputDuration?: number | null; mergedInto?: string; parameters?: Record<string, any> } | null;
}

export interface MasterSegment {
  startTime: number;
  offset: number;
  duration: number;
}

const TASK_LABELS: Record<string, string> = {
  repaint: 'REWORK',
  inpaint: 'REWORK',
  lego: 'LAYER',
  extend: 'EXTEND',
  complete: 'ACCOMPANY',
  cover: 'RESTYLE',
  extract: 'EXTRACT',
  merge: 'MERGED',
  text2music: 'MASTER',
};

const TASK_BADGE_LABELS: Record<string, string> = {
  repaint: 'RWK',
  inpaint: 'RWK',
  lego: 'LYR',
  extend: 'EXT',
  complete: 'ACC',
  cover: 'RST',
  extract: 'EXR',
};

export function taskLabel(task?: string | null): string {
  if (!task) return 'EDIT';
  return TASK_LABELS[task.toLowerCase()] ?? task.toUpperCase();
}

export function taskBadgeLabel(task?: string | null): string {
  if (!task) return 'EDT';
  return TASK_BADGE_LABELS[task.toLowerCase()] ?? task.slice(0, 3).toUpperCase();
}

export function isLayerTake(take?: Version | null): boolean {
  return Boolean(take && (take.task === 'lego' || take.provenance?.target === 'layer'));
}

export function isMasterTargetTake(take?: Version | null): boolean {
  if (!take || isLayerTake(take)) return false;
  if (take.provenance?.target === 'stem') return false;
  if (take.provenance?.target === 'master' || take.task === 'text2music' || take.task === 'merge') return true;
  if (!take.stem_id) return true;
  return take.stem_id.startsWith('stem-master') || take.stem_id.startsWith('stm-master');
}

export function layerTrackName(take?: Version | null): string {
  const raw = take?.provenance?.layerName
    || take?.provenance?.parameters?.trackName
    || take?.provenance?.parameters?.submitted?.trackName
    || take?.provenance?.parameters?.resolved?.track_name
    || 'layer';
  return String(raw).trim().toLowerCase().replace(/\s+/g, '_');
}

export function isFullSongRestyleTake(take?: Version | null): boolean {
  return Boolean(
    take &&
    take.task === 'cover' &&
    (take.provenance?.target === 'master' || (take.stem_id && (take.stem_id.startsWith('stem-master') || take.stem_id.startsWith('stm-master')))) &&
    !take.provenance?.region &&
    take.repainting_start == null
  );
}

export function pending(take: Version): boolean {
  return (
    !take.provenance?.mergedInto &&
    take.task !== 'merge' &&
    take.task !== 'text2music' &&
    take.model !== 'demucs-htdemucs' &&
    !(take.is_active && (take.provenance?.region || take.repainting_start != null || isLayerTake(take) || isFullSongRestyleTake(take)))
  );
}

export function masterArrangement(
  duration: number,
  extendClips: { startTime: number; duration: number }[]
): { segments: MasterSegment[]; duration: number } {
  if (!(duration > 0)) return { segments: [], duration: 0 };
  const sorted = [...extendClips]
    .filter(clip => Number.isFinite(clip.startTime) && Number.isFinite(clip.duration) && clip.duration > 0)
    .sort((a, b) => a.startTime - b.startTime);
  let segments: MasterSegment[] = [{ startTime: 0, offset: 0, duration }];
  let total = duration;
  for (const ext of sorted) {
    const gapStart = Math.max(0, ext.startTime);
    const gapDur = ext.duration;
    const next: MasterSegment[] = [];
    let split = false;
    for (const seg of segments) {
      const segEnd = seg.startTime + seg.duration;
      if (segEnd <= gapStart) {
        next.push(seg);
      } else if (seg.startTime >= gapStart) {
        split = true;
        next.push({ ...seg, startTime: seg.startTime + gapDur });
      } else {
        split = true;
        const beforeDur = gapStart - seg.startTime;
        const afterDur = seg.duration - beforeDur;
        if (beforeDur > 1e-4) {
          next.push({ startTime: seg.startTime, offset: seg.offset, duration: beforeDur });
        }
        if (afterDur > 1e-4) {
          next.push({ startTime: gapStart + gapDur, offset: seg.offset + beforeDur, duration: afterDur });
        }
      }
    }
    segments = next;
    total = split
      ? Math.max(total + gapDur, gapStart + gapDur, ...segments.map(s => s.startTime + s.duration))
      : Math.max(total, gapStart + gapDur);
  }
  return { segments, duration: total };
}

interface Snapshot {
  id: string;
  parent_commit_id?: string | null;
  timeline_snapshot?: { action?: string; activeTakeId?: string; provenance?: { target?: string; region?: { start: number; end: number } | null } };
}

export function segments(commits: Snapshot[]) {
  let applied: { id: string; start: number; end: number }[] = [];
  const versions = new Map<string, typeof applied>();
  for (const commit of [...commits].reverse()) {
    const snapshot = commit.timeline_snapshot;
    if (snapshot?.provenance?.target && snapshot.provenance.target !== 'master') continue;
    const id = snapshot?.activeTakeId;
    if (!id) continue;
    if (snapshot.action === 'merge' && snapshot.provenance?.region) {
      const { start, end } = snapshot.provenance.region;
      applied = applied.flatMap(segment => {
        if (segment.end <= start || segment.start >= end) return [segment];
        return [
          ...(segment.start < start ? [{ ...segment, end: start }] : []),
          ...(segment.end > end ? [{ ...segment, start: end }] : []),
        ];
      });
      applied.push({ id, start, end });
    } else if (snapshot.action === 'base') {
      applied = [...(versions.get(id) ?? [])];
    }
    versions.set(id, [...applied]);
  }
  return applied;
}

interface Lane {
  id: string;
  stemId?: string;
  activeTakeId?: string;
  activeVersionTakeId?: string | null;
  muted?: boolean;
  clips: { url: string; startTime?: number; duration?: number; origin?: number }[];
}

export function retained<T extends Lane>(tracks: T[], takes: Version[]): T[] {
  const ids = new Set(takes.filter(t => pending(t) && !isLayerTake(t) && !isFullSongRestyleTake(t)).map(take => take.id));
  return tracks.filter(track => track.id !== track.activeTakeId || ids.has(track.id));
}

export function isBase(take: Version, tracks: Lane[], takes: Version[]): boolean {
  const isMaster = isMasterTargetTake(take);
  const lane = !isMaster && take.stem_id
    ? tracks.find(track => track.id === take.stem_id || (track as Lane & { stemId?: string }).stemId === take.stem_id)
    : tracks.find(track => track.id === 'master');
  if (!take.is_active || !lane) return false;
  const active = takes.filter(version => version.is_active && (isMaster ? isMasterTargetTake(version) : (version.stem_id ?? null) === (take.stem_id ?? null)));
  return active.length === 1 || lane.clips[0]?.url === take.url;
}

export function mounted(take: Version, tracks: Lane[], takes: Version[]): boolean {
  if (tracks.some(track => track.activeVersionTakeId === take.id)) return true;
  const track = tracks.find(track => track.id === take.id && track.activeTakeId === take.id);
  if (track) return true;
  const isMaster = isMasterTargetTake(take);
  const lane = !isMaster && take.stem_id
    ? tracks.find(track => track.id === take.stem_id || track.stemId === take.stem_id)
    : tracks.find(track => track.id === 'master');
  return Boolean(lane && !lane.muted && isBase(take, tracks, takes));
}

export function preview(take: Version) {
  const region = take.provenance?.region ?? (take.repainting_start != null && take.repainting_end != null ? { start: take.repainting_start, end: take.repainting_end } : null);
  const start = take.provenance?.audioOffset ?? region?.start ?? 0;
  const duration = region ? region.end - region.start : undefined;
  return { start, end: duration === undefined ? undefined : start + duration, timelineStart: region?.start ?? 0 };
}

export function interval(take: Version, duration: number) {
  const range = preview(take);
  return { start: range.timelineStart, end: range.timelineStart + (range.end === undefined ? take.provenance?.outputDuration ?? duration : range.end - range.start) };
}

export function source(take: Version, tracks: Array<Lane & { stemId?: string }>) {
  const id = isMasterTargetTake(take) || (take.provenance?.target === 'layer' && !take.stem_id) ? 'master' : take.stem_id;
  return tracks.find(track => track.id === id || track.stemId === id)?.id ?? null;
}

export function clips(take: Version, duration: number) {
  const range = preview(take);
  return (take.provenance?.regions ?? [interval(take, duration)]).map(region => ({
    id: `${take.id}:${region.start}:${region.end}`, name: `Take`, url: take.url,
    startTime: region.start, offset: range.start + region.start - range.timelineStart,
    duration: region.end - region.start,
  }));
}

export function sourceInterval(take: Version, tracks: Lane[], region: { start: number; end: number }) {
  const track = tracks.find(track => track.id === take.id && track.activeTakeId === take.id);
  const part = track?.clips.find(clip => clip.startTime !== undefined && clip.duration !== undefined && region.start >= clip.startTime && region.end <= clip.startTime + clip.duration) ?? track?.clips[0];
  const shift = part ? part.startTime! - (part.origin ?? part.startTime!) : 0;
  return { start: region.start - shift, end: region.end - shift };
}
