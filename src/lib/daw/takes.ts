interface Version {
  id: string;
  stem_id?: string | null;
  url: string;
  is_active: boolean;
  task?: string;
  repainting_start?: number | null;
  repainting_end?: number | null;
  provenance?: { target?: string; audioOffset?: number; region?: { start: number; end: number } | null; regions?: { start: number; end: number }[]; outputDuration?: number | null; mergedInto?: string; parameters?: Record<string, any> } | null;
}

export function pending(take: Version): boolean {
  return !take.provenance?.mergedInto && take.task !== 'merge' && !(take.is_active && (take.provenance?.region || take.repainting_start != null));
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
  muted?: boolean;
  clips: { url:string;startTime?:number;duration?:number;origin?:number }[];
}

export function retained<T extends Lane>(tracks: T[], takes: Version[]): T[] {
  const ids = new Set(takes.filter(pending).map(take => take.id));
  return tracks.filter(track => track.id !== track.activeTakeId || ids.has(track.id));
}

export function isBase(take: Version, tracks: Lane[], takes: Version[]): boolean {
  const lane = take.stem_id
    ? tracks.find(track => track.id === take.stem_id || (track as Lane & { stemId?: string }).stemId === take.stem_id)
    : tracks.find(track => track.id === 'master');
  if (!take.is_active || !lane) return false;
  const active = takes.filter(version => version.is_active && (version.stem_id ?? null) === (take.stem_id ?? null));
  return active.length === 1 || lane.clips[0]?.url === take.url;
}

export function mounted(take: Version, tracks: Lane[], takes: Version[]): boolean {
  const track = tracks.find(track => track.id === take.id && track.activeTakeId === take.id);
  if (track) return true;
  const lane = take.stem_id
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
  const id = take.provenance?.target === 'master' ? 'master' : take.stem_id;
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

export function sourceInterval(take: Version, tracks: Lane[], region:{start:number;end:number}) {
  const track = tracks.find(track => track.id === take.id && track.activeTakeId === take.id);
  const part = track?.clips.find(clip => clip.startTime !== undefined && clip.duration !== undefined && region.start >= clip.startTime && region.end <= clip.startTime + clip.duration) ?? track?.clips[0];
  const shift = part ? part.startTime! - (part.origin ?? part.startTime!) : 0;
  return {start:region.start-shift,end:region.end-shift};
}
