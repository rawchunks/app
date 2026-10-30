import type { GuideStep } from './Steps';

export type GuideOwnerId = 'account' | 'funding' | 'funding-panel' | 'license' | 'network' | 'navigation' | 'studio' | 'workspace' | 'market' | 'card' | 'profile' | 'editor' | 'board' | 'waveform' | 'ai' | 'toolbox' | 'keys' | 'drums' | 'code' | 'sample' | 'fx' | 'mixer';
export interface Preparation {
  target?: string;
  focus?: string;
  entity?: string;
  title?: string;
  description?: string;
  unavailable?: string;
  rect?: () => DOMRect | null;
  retry?: () => boolean;
  leave?: (next?: GuideStep) => void;
  canLeave?: (next?: GuideStep) => boolean;
}
export interface GuideEntry {
  step: GuideStep;
  signal: AbortSignal;
  bind: (key: string, value: string | undefined) => string | undefined;
}
export interface GuideOwner {
  id: GuideOwnerId;
  scope: string;
  handles: (step: GuideStep) => boolean;
  prepare: (entry: GuideEntry) => Preparation | void;
}

export class GuideRegistry {
  owners = new Map<string, GuideOwner>();
  onBoundaryChange?: () => void;
  private listeners = new Set<() => void>();
  register(owner: GuideOwner) {
    const key = `${owner.id}:${owner.scope}`;
    this.owners.set(key, owner);
    this.notify();
    return () => { if (this.owners.get(key) === owner) { this.owners.delete(key); if (['studio', 'workspace', 'market'].includes(owner.id) || owner.id === 'editor' && owner.scope !== 'tempo') this.onBoundaryChange?.(); } this.notify(); };
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  notify() { this.listeners.forEach(listener => listener()); }
  enter(step: GuideStep, bindings: Map<string, string>, changed: (result: Preparation) => void) {
    const controller = new AbortController();
    const prepared = new Map<string, Preparation>();
    const cleanups: Preparation[] = [];
    let updating = false;
    const update = () => {
      if (controller.signal.aborted || updating) return;
      updating = true;
      const order: GuideOwnerId[] = ['navigation', 'account', 'funding', 'funding-panel', 'network', 'studio', 'workspace', 'market', 'editor', 'board', 'toolbox', 'ai', 'keys', 'drums', 'code', 'sample', 'fx', 'mixer', 'card', 'license', 'profile', 'waveform'];
      for (const [key, owner] of [...this.owners].sort(([, a], [, b]) => order.indexOf(a.id) - order.indexOf(b.id))) {
        if (prepared.has(key) && !prepared.get(key)?.retry?.() || !owner.handles(step)) continue;
        // Reserve before preparation: a state change can synchronously register a child owner.
        prepared.set(key, {});
        const result = owner.prepare({ step, signal: controller.signal, bind: (name, candidate) => {
          if (!bindings.has(name) && candidate) bindings.set(name, candidate);
          return bindings.get(name);
        } }) ?? {};
        prepared.set(key, result);
        cleanups.push(result);
      }
      updating = false;
      changed(Object.assign({}, ...prepared.values()));
    };
    const unsubscribe = this.subscribe(update);
    update();
    let left = false;
    return {
      signal: controller.signal,
      canLeave: (next?: GuideStep) => [...prepared.values()].every(result => !result.canLeave || result.canLeave(next)),
      leave: (next?: GuideStep) => {
        if (left) return;
        left = true;
        controller.abort();
        unsubscribe();
        cleanups.reverse().forEach(result => result.leave?.(next));
      },
    };
  }
}

export function anchor(name: string, entity?: string): HTMLElement | null {
  const nodes = document.querySelectorAll<HTMLElement>(`[data-guide="${name.replaceAll('\"', '\\\"')}"]`);
  const visible = [...nodes].filter(node => !entity || node.closest('[data-guide-entity]')?.getAttribute('data-guide-entity') === entity)
    .filter(node => {
      if (!node.isConnected || node.closest('[inert], [aria-hidden="true"]')) return false;
      for (let parent: HTMLElement | null = node; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity !== '' && Number(style.opacity) === 0) return false;
      }
      return node.getBoundingClientRect().width > 2;
    });
  return visible.find(node => node.closest('.modal-overlay')) ?? visible[0] ?? null;
}
export function visibleRect(node: HTMLElement): DOMRect | null {
  if (!node.isConnected || node.closest('[inert], [aria-hidden="true"]')) return null;
  let rect = node.getBoundingClientRect();
  let left = rect.left, top = rect.top, right = rect.right, bottom = rect.bottom;
  for (let parent: HTMLElement | null = node; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (style.display === 'none' || style.visibility === 'hidden' || (style.opacity !== '' && Number(style.opacity) === 0)) return null;
    if (parent !== node) {
      rect = parent.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { left = Math.max(left, rect.left); right = Math.min(right, rect.right); }
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { top = Math.max(top, rect.top); bottom = Math.min(bottom, rect.bottom); }
    }
  }
  const viewport = window.visualViewport;
  left = Math.max(viewport?.offsetLeft ?? 0, left); top = Math.max(viewport?.offsetTop ?? 0, top);
  right = Math.min((viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth), right);
  bottom = Math.min((viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight), bottom);
  return right - left > 2 && bottom - top > 2 ? new DOMRect(left, top, right - left, bottom - top) : null;
}
export function focusAnchor(node: HTMLElement, selector?: string) {
  const root = node.matches('[role="dialog"]') ? node.querySelector<HTMLElement>('.modal-body-wrap') ?? node : node;
  let focus = (selector === 'self' ? node : selector ? node.querySelector<HTMLElement>(selector) : null) ??
    (node.matches('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]') ? node :
      root.querySelector<HTMLElement>('[aria-selected="true"], [aria-pressed="true"]') ?? root.querySelector<HTMLElement>('textarea:not(:disabled), input:not(:disabled):not([type="file"]), select:not(:disabled), button:not(:disabled), [tabindex="0"]')) ?? node;
  if (focus.matches(':disabled')) {
    focus = focus.parentElement ?? node;
    if (!focus.hasAttribute('aria-label')) focus.setAttribute('aria-label', node.getAttribute('aria-label') ?? node.textContent?.trim() ?? 'Control status');
  }
  if (!focus.hasAttribute('tabindex') && !focus.matches('button, a, input, textarea, select')) focus.tabIndex = -1;
  focus.focus({ preventScroll: true });
  return focus;
}
