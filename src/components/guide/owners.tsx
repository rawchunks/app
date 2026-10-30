import { createContext, useContext, useLayoutEffect, useRef } from 'react';
import { GuideRegistry, type GuideOwner, type Preparation } from './registry';
export const RegistryContext = createContext<GuideRegistry | null>(null);
export function useGuideOwner(owner: GuideOwner) {
  const registry = useContext(RegistryContext);
  const latest = useRef(owner);
  latest.current = owner;
  useLayoutEffect(() => {
    if (!registry) return;
    return registry.register({ ...owner, handles: step => latest.current.handles(step), prepare: entry => latest.current.prepare(entry) });
  }, [registry, owner.id, owner.scope]);
  useLayoutEffect(() => { registry?.notify(); });
}

export function prepareViews<T extends Record<string, unknown>>(
  current: T, latest: () => T, setters: { [K in keyof T]: (value: T[K]) => void }, patch: Partial<T>, restore: T = current,
): Preparation {
  const keys = Object.keys(patch) as (keyof T)[];
  for (const key of keys) if (current[key] !== patch[key]) setters[key](patch[key] as T[typeof key]);
  return { leave: () => { const now = latest(); for (const key of keys) if (now[key] === patch[key] && now[key] !== restore[key]) setters[key](restore[key]); } };
}
export function draftCanLeave(owner: string) {
  return !document.querySelector(`[data-guide-owner="${owner}"][data-guide-dirty="true"]`);
}
