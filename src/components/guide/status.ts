import { GUIDE_FLOWS, type GuideFlowId } from './Steps';
const format = /^guide:([^:]+):(\d+):([cd])$/;
const known = (value: string): value is GuideFlowId => Object.hasOwn(GUIDE_FLOWS, value);
export function normalizeGuides(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const statuses = new Map<string, { version: number; state: string }>();
  const other = new Set<string>();
  for (const item of values) {
    if (typeof item !== 'string' || !item.trim()) continue;
    const match = item.match(format);
    const id = match?.[1] ?? item;
    if (!known(id)) { other.add(item); continue; }
    const version = match ? Number(match[2]) : 1;
    const state = match?.[3] ?? 'c';
    const prior = statuses.get(id);
    if (!prior || version > prior.version || (version === prior.version && state === 'c')) statuses.set(id, { version, state });
  }
  const canonical = [...statuses].sort(([a], [b]) => a.localeCompare(b)).map(([id, value]) => `guide:${id}:${value.version}:${value.state}`);
  return [...canonical, ...other].slice(0, 32);
}
export function guideSeen(values: string[], id: GuideFlowId) {
  return normalizeGuides(values).some(item => item.startsWith(`guide:${id}:`));
}
export function setGuideStatus(values: string[], id: GuideFlowId, state: 'completed' | 'dismissed') {
  const rest = normalizeGuides(values).filter(item => item !== id && !item.startsWith(`guide:${id}:`));
  return normalizeGuides([`guide:${id}:${GUIDE_FLOWS[id].version}:${state === 'completed' ? 'c' : 'd'}`, ...rest]);
}
