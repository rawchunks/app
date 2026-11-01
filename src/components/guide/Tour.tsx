import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { api } from '@/lib/api';
import { readCachedGuides, writeCachedGuides } from '@/lib/cache';
import { useSelectedUserAddress } from '@/hooks/use-address';
import { useDisclaimerConsent } from '@/hooks/use-disclaimer';
import { ownEscape } from '@/hooks/dismissal';
import { GUIDE_FLOWS, type GuideFlowId, type GuidePageId, type GuideStep } from './Steps';
import { GuideRegistry, anchor, visibleRect, focusAnchor, type Preparation } from './registry';
import { RegistryContext } from './owners';
import { guideSeen, normalizeGuides, setGuideStatus } from './status';
import '../../styles/guide.css';

interface StartOptions { entity?: string; initialStep?: number; guestOnly?: boolean }
interface GuideContextValue {
  activeFlow: GuideFlowId | null;
  stepIndex: number;
  activePage: GuidePageId;
  startFlow: (flow: GuideFlowId, options?: StartOptions) => void;
  closeGuide: () => void;
}
const GuideContext = createContext<GuideContextValue | null>(null);
const saveQueues = new Map<string, Promise<unknown>>();
const epochs = new Map<string, number>();
const pendingWrites = new Set<string>();
const CONNECT_KEY = 'rawchunks:has-connected';
const CONNECT_DISMISSED = 'rawchunks:connect-guide-dismissed';
function browserFlag(key: string) { try { return !!localStorage.getItem(key); } catch { return false; } }
function setBrowserFlag(key: string) { try { localStorage.setItem(key, '1'); } catch {} }
function samePreparation(a: Preparation, b: Preparation) {
  return ['target', 'focus', 'entity', 'title', 'description', 'unavailable', 'rect'].every(key => a[key as keyof Preparation] === b[key as keyof Preparation]);
}

export function GuideProvider({ activePage, children }: { activePage: GuidePageId; children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const { accountId, isReconnecting } = useSelectedUserAddress();
  const { hasConsented, isLoading: consentLoading } = useDisclaimerConsent();
  const scope = accountId ?? 'guest';
  const registry = useMemo(() => new GuideRegistry(), []);
  const [activeFlow, setActiveFlow] = useState<GuideFlowId | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [runRevision, setRunRevision] = useState(0);
  const [guestOnly, setGuestOnly] = useState(false);
  const [prepared, setPrepared] = useState<Preparation>({});
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [host, setHost] = useState<Element | null>(null);
  const hostRef = useRef(host); hostRef.current = host;
  const [missing, setMissing] = useState(false);
  const [paused, setPaused] = useState(false);
  const [draftBlocked, setDraftBlocked] = useState(false);
  const [viewport, setViewport] = useState({ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight });
  const [cardHeight, setCardHeight] = useState(190);
  const cardRef = useRef<HTMLDivElement>(null);
  const bindings = useRef(new Map<string, string>());
  const entryRef = useRef<ReturnType<GuideRegistry['enter']> | null>(null);
  const dismissedPage = useRef<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  const guidesQuery = useQuery({
    queryKey: ['user-guides', scope], initialData: () => normalizeGuides(readCachedGuides(scope) ?? []), initialDataUpdatedAt: 0,
    queryFn: async () => {
      if (!accountId) return normalizeGuides(readCachedGuides(scope));
      const epoch = epochs.get(scope) ?? 0;
      try {
        const response = await api.fetch(`/api/user/guides/${encodeURIComponent(accountId)}`);
        if (!response.ok) return normalizeGuides(readCachedGuides(scope));
        const data = await response.json();
        const values = normalizeGuides(!pendingWrites.has(scope) && epoch === (epochs.get(scope) ?? 0) ? [...normalizeGuides(readCachedGuides(scope)), ...normalizeGuides(data.guides)] : readCachedGuides(scope));
        writeCachedGuides(scope, values);
        return values;
      } catch { return normalizeGuides(readCachedGuides(scope)); }
    }, enabled: !!accountId || !isReconnecting, staleTime: 300_000,
  });
  const persist = useCallback((values: string[]) => {
    const canonical = normalizeGuides(values);
    const mutationEpoch = (epochs.get(scope) ?? 0) + 1;
    epochs.set(scope, mutationEpoch);
    writeCachedGuides(scope, canonical);
    queryClient.setQueryData(['user-guides', scope], canonical);
    if (!accountId) return Promise.resolve();
    pendingWrites.add(scope);
    const save = (saveQueues.get(scope) ?? Promise.resolve()).catch(() => {}).then(async () => {
      const response = await api.fetch('/api/user/guides', { method: 'POST', userAddress: accountId,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: accountId, guides: canonical }) });
      if (!response.ok) throw new Error('Could not save guide status');
      if (mutationEpoch === epochs.get(scope)) pendingWrites.delete(scope);
    });
    saveQueues.set(scope, save);
    return save;
  }, [scope, accountId, queryClient]);
  useEffect(() => {
    const retry = () => { if (pendingWrites.has(scope)) void persist(readCachedGuides(scope) ?? []).catch(() => {}); };
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [scope, persist]);
  const leave = useCallback((force = false, next?: GuideStep) => {
    if (!force && entryRef.current && !entryRef.current.canLeave(next)) { setDraftBlocked(true); return false; }
    entryRef.current?.leave(next); entryRef.current = null;
    setDraftBlocked(false); return true;
  }, []);
  const stop = useCallback((force = false) => {
    if (!leave(force)) return false;
    setActiveFlow(null); setRect(null); setPrepared({}); setHost(null);
    if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
    return true;
  }, [leave]);
  const closeGuide = useCallback(() => {
    if (!activeFlow || !stop()) return;
    dismissedPage.current = activePage;
    if (guestOnly) setBrowserFlag(CONNECT_DISMISSED);
    else void persist(setGuideStatus(readCachedGuides(scope) ?? [], activeFlow, 'dismissed')).catch(() => {});
  }, [activeFlow, activePage, guestOnly, persist, scope, stop]);
  const startFlow = useCallback((flow: GuideFlowId, options: StartOptions = {}) => {
    if (!GUIDE_FLOWS[flow].pages.includes(activePage) || !leave()) return;
    opener.current = document.activeElement as HTMLElement | null;
    bindings.current = new Map([['page', activePage]]);
    if (options.entity) bindings.current.set('song', options.entity);
    setGuestOnly(!!options.guestOnly); setPrepared({}); setRect(null);
    setStepIndex(options.initialStep ?? 0); setActiveFlow(flow); setRunRevision(value => value + 1);
  }, [activePage, leave]);


  useEffect(() => { stop(true); dismissedPage.current = null; }, [activePage, scope]);
  useEffect(() => { registry.onBoundaryChange = () => { dismissedPage.current = activePage; stop(true); }; return () => { registry.onBoundaryChange = undefined; }; }, [registry, activePage, stop]);
  useEffect(() => {
    if (accountId) setBrowserFlag(CONNECT_KEY);
    if (activeFlow || guidesQuery.isFetching || isReconnecting || dismissedPage.current === activePage) return;
    if (accountId && (consentLoading || !hasConsented)) return;
    const timer = setTimeout(() => {
      if (document.querySelector('.modal-overlay:not([aria-hidden="true"]), [aria-busy="true"], [data-recording="true"]')) return;
      const automaticallyStart = (id: GuideFlowId) => { startFlow(id); void persist(setGuideStatus(readCachedGuides(scope) ?? [], id, 'dismissed')).catch(() => {}); };
      if (!accountId) {
        if (!browserFlag(CONNECT_KEY) && !browserFlag(CONNECT_DISMISSED) && !browserFlag('last_account')) {
          startFlow('welcome', { guestOnly: true }); setBrowserFlag(CONNECT_DISMISSED);
        }
      } else if (!guideSeen(guidesQuery.data ?? [], 'welcome')) automaticallyStart('welcome');
      else if (!guideSeen(guidesQuery.data ?? [], activePage)) automaticallyStart(activePage);
    }, 500);
    return () => clearTimeout(timer);
  }, [accountId, activePage, activeFlow, consentLoading, hasConsented, isReconnecting, guidesQuery.isFetching, guidesQuery.data, startFlow, persist, scope]);
  const flow = activeFlow ? GUIDE_FLOWS[activeFlow] : null;
  const steps = flow ? guestOnly ? flow.steps.slice(0, 1) : activeFlow === 'catalog' && activePage === 'market' ? flow.steps.filter(step => step.id === 'K5') : flow.steps : [];
  const step = steps[stepIndex];

  useEffect(() => {
    if (!step) return;
    let cancelled = false;
    // Strict Mode's discarded mount never performs preparation.
    queueMicrotask(() => {
      if (cancelled) return;
      const entry = registry.enter(step, bindings.current, result => {
        if (!cancelled) setPrepared(old => samePreparation(old, result) ? old : result);
      });
      entryRef.current = entry;
    });
    return () => { cancelled = true; entryRef.current?.leave(); entryRef.current = null; };
  }, [registry, step, activeFlow, runRevision]);

  useEffect(() => {
    if (!step) return;
    let frame = 0, focused: HTMLElement | null = null, scrolled: HTMLElement | null = null, scrolledLayout = '';
    setMissing(false); setPaused(false);
    const measure = () => {
      frame = 0;
      const visual = window.visualViewport;
      const nextViewport = { x: visual?.offsetLeft ?? 0, y: visual?.offsetTop ?? 0, w: visual?.width ?? window.innerWidth, h: visual?.height ?? window.innerHeight };
      setViewport(old => Object.keys(old).every(key => old[key as keyof typeof old] === nextViewport[key as keyof typeof old]) ? old : nextViewport);
      const target = anchor(prepared.target ?? step.target, prepared.entity);
      const previousOverlay = hostRef.current?.isConnected ? hostRef.current.closest('.modal-overlay') : null;
      const overlay = target?.closest('.modal-overlay') ?? (!target ? previousOverlay : null);
      const top = [...document.querySelectorAll('.modal-overlay:not([aria-hidden="true"])')].at(-1);
      const unrelated = !!top && top !== overlay;
      setPaused(unrelated);
      const nextHost = overlay?.querySelector('[data-guide-overlay-host]') ?? document.body;
      setHost(old => old === nextHost ? old : nextHost);
      if (unrelated || !target) { setRect(null); return; }
      const bounds = target.getBoundingClientRect();
      const layout = `${bounds.x}:${bounds.y}:${bounds.width}:${bounds.height}`;
      if (scrolled !== target || !visibleRect(target) && layout !== scrolledLayout) {
        scrolled = target;
        scrolledLayout = layout;
        target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
        schedule(); return;
      }
      const visible = prepared.rect ? prepared.rect() : visibleRect(target);
      setRect(old => old && visible && ['x', 'y', 'width', 'height'].every(key => Math.abs(old[key as keyof DOMRect] as number - (visible[key as keyof DOMRect] as number)) < 1) ? old : visible);
      if (visible && focused !== target) { focused = target; focusAnchor(target, prepared.focus); }
      const height = cardRef.current?.offsetHeight;
      if (height !== undefined) setCardHeight(old => old === height ? old : height);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const observer = new MutationObserver(records => {
      if (records.some(record => !(record.target as HTMLElement).closest?.('[data-guide-navigation], .guide-spotlight-ring, .guide-scrim'))) schedule();
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'inert', 'aria-hidden', 'data-guide-dirty'] });
    const resize = new ResizeObserver(schedule); resize.observe(document.body);
    window.addEventListener('scroll', schedule, true); window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule); window.visualViewport?.addEventListener('scroll', schedule);
    const release = registry.subscribe(schedule);
    const missingTimer = setTimeout(() => { setMissing(true); schedule(); }, 1500);
    schedule();
    return () => { clearTimeout(missingTimer); cancelAnimationFrame(frame); observer.disconnect(); resize.disconnect(); release();
      window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule); window.visualViewport?.removeEventListener('scroll', schedule); };
  }, [step, prepared.target, prepared.focus, prepared.entity, prepared.rect, registry, runRevision]);

  const navigate = (direction: number) => {
    if (!leave(false, steps[stepIndex + direction])) return;
    if (direction > 0 && stepIndex === steps.length - 1) {
      if (guestOnly) setBrowserFlag(CONNECT_DISMISSED);
      else if (activeFlow) void persist(setGuideStatus(readCachedGuides(scope) ?? [], activeFlow, 'completed')).catch(() => {});
      dismissedPage.current = activePage; stop(true);
    } else { setPrepared({}); setRect(null); setStepIndex(index => Math.max(0, index + direction)); }
  };
  useEffect(() => { if (activeFlow && !paused) return ownEscape(closeGuide, 10); }, [activeFlow, paused, closeGuide]);
  const width = Math.min(360, viewport.w - 24);
  const gap = 12;
  const targetRect = rect;
  const left = Math.max(viewport.x + 12, Math.min(viewport.x + viewport.w - width - 12, targetRect ? targetRect.left : viewport.x + (viewport.w - width) / 2));
  let top = targetRect && targetRect.bottom + cardHeight + gap < viewport.y + viewport.h ? targetRect.bottom + gap : targetRect ? targetRect.top - cardHeight - gap : viewport.y + viewport.h - cardHeight - 16;
  if (targetRect && top < viewport.y + 12 && targetRect.right + width + gap < viewport.x + viewport.w) top = targetRect.top;
  top = Math.max(viewport.y + 12, Math.min(viewport.y + viewport.h - cardHeight - 12, top));
  const cardLeft = targetRect && targetRect.right + width + gap < viewport.x + viewport.w && targetRect.height > viewport.h / 2 ? targetRect.right + gap : left;
  const context = useMemo(() => ({ activeFlow, stepIndex, activePage, startFlow, closeGuide }), [activeFlow, stepIndex, activePage, startFlow, closeGuide]);
  return <RegistryContext.Provider value={registry}><GuideContext.Provider value={context}>
    {children}
    {step && !paused && host && createPortal(<>
      {rect && <div className="guide-spotlight-ring" aria-hidden style={{ left: rect.x - 4, top: rect.y - 4, width: rect.width + 8, height: rect.height + 8 }} />}
      <div ref={cardRef} className="guide-card" data-guide-navigation data-guide-step={step.id}
        role="region" aria-label={`${flow!.label} guide`} style={{ left: cardLeft, top, width, maxHeight: viewport.h - 24 }}
        onKeyDown={event => {
          if (event.defaultPrevented || event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
          if (event.key === 'ArrowRight') { event.preventDefault(); navigate(1); }
          if (event.key === 'ArrowLeft' && stepIndex) { event.preventDefault(); navigate(-1); }
        }}>
        <div className="guide-card-header"><span className="guide-flow-label">{flow!.label}</span>
          <button className="guide-close-btn" aria-label="Close guide" onClick={closeGuide}><X size={14} /></button></div>
        <h3 className="guide-card-title">{prepared.title ?? step.title}</h3>
        <p className="guide-card-desc">{!rect && missing ? prepared.unavailable ?? 'This control is not available in the current view.' : prepared.description ?? step.description}</p>
        {draftBlocked && <p className="guide-card-desc" role="status">Use this dialog's Save, Done or Cancel action before leaving.</p>}
        <div className="guide-card-footer"><span className="guide-step-counter">{stepIndex + 1} / {steps.length}</span>
          <div className="guide-nav-btns"><button type="button" className="guide-skip-btn" onClick={closeGuide}>Skip</button>
            <button className="guide-arrow-btn" aria-label="Previous step" disabled={!stepIndex} onClick={() => navigate(-1)}><ChevronLeft size={14} /></button>
            <button className="guide-next-btn" onClick={() => navigate(1)}>{stepIndex === steps.length - 1 ? 'Done' : 'Next'}<ChevronRight size={14} /></button></div></div>
      </div>
    </>, host)}
  </GuideContext.Provider></RegistryContext.Provider>;
}
export function useGuide() {
  const context = useContext(GuideContext);
  if (!context) throw new Error('useGuide requires GuideProvider');
  return context;
}
