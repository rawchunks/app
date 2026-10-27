import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft,
  ChevronRight,
  X,
  Sparkles,
} from 'lucide-react';
import { sdk } from '@/lib/sdk';
import { readCachedGuides, writeCachedGuides } from '@/lib/cache';
import { useSelectedUserAddress } from '@/hooks/use-address';
import { useDisclaimerConsent } from '@/hooks/use-disclaimer';
import { Tooltip } from '../daw/Tooltip';
import {
  GUIDE_FLOWS,
  type GuideFlowId,
  type GuideStep,
  type GuideStepAction,
} from './Steps';
import '../../styles/guide.css';

interface GuideContextValue {
  activeFlow: GuideFlowId | null;
  stepIndex: number;
  activePage: Exclude<GuideFlowId, 'welcome'>;
  startFlow: (flow: GuideFlowId) => void;
  closeGuide: () => void;
  resetAllGuides: () => void;
}

const GuideContext = createContext<GuideContextValue | null>(null);

function dispatchGuideAction(action?: GuideStepAction): void {
  if (!action || typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('rawchunks:guide-action', { detail: action }));
}

function resolveTargetElement(selectorList: string): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const selectors = selectorList
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  for (const sel of selectors) {
    try {
      const nodes = document.querySelectorAll<HTMLElement>(sel);
      for (const node of Array.from(nodes)) {
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        if (
          rect.width > 4 &&
          rect.height > 4 &&
          style.visibility !== 'hidden' &&
          style.display !== 'none' &&
          Number(style.opacity || '1') > 0.05
        ) {
          return node;
        }
      }
    } catch { }
  }
  return null;
}

interface CutoutRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const GuideProvider: React.FC<{
  activePage: Exclude<GuideFlowId, 'welcome'>;
  children: React.ReactNode;
}> = ({ activePage, children }) => {
  const queryClient = useQueryClient();
  const { accountId, isReconnecting } = useSelectedUserAddress();
  const { hasConsented, isLoading: consentLoading } = useDisclaimerConsent();
  const activeUser = accountId;
  const userScope = activeUser ?? 'guest';

  const [activeFlow, setActiveFlow] = useState<GuideFlowId | null>(null);
  const [stepIndex, setStepIndex] = useState<number>(0);
  const [cutout, setCutout] = useState<CutoutRect | null>(null);
  const [viewport, setViewport] = useState<{ w: number; h: number }>({
    w: typeof window !== 'undefined' ? window.innerWidth : 1280,
    h: typeof window !== 'undefined' ? window.innerHeight : 800,
  });

  const cardRef = useRef<HTMLDivElement | null>(null);
  const [cardHeight, setCardHeight] = useState<number>(230);
  const scrolledStepRef = useRef<string | null>(null);
  const prevScopeRef = useRef<string>(userScope);

  const guidesQuery = useQuery({
    queryKey: ['user-guides', userScope],
    initialData: () => readCachedGuides(userScope) ?? undefined,
    queryFn: async () => {
      if (!activeUser) {
        return readCachedGuides('guest') ?? [];
      }
      try {
        const response = await sdk.fetch(`/api/user/guides/${encodeURIComponent(activeUser)}`);
        if (!response.ok) return readCachedGuides(activeUser) ?? [];
        const data = await response.json();
        const remote = Array.isArray(data?.guides)
          ? data.guides.filter((id: unknown): id is string => typeof id === 'string')
          : [];
        const local = readCachedGuides(activeUser) ?? [];
        const merged = Array.from(new Set([...local, ...remote]));
        writeCachedGuides(activeUser, merged);
        return merged;
      } catch {
        return readCachedGuides(activeUser) ?? [];
      }
    },
    enabled: Boolean(activeUser) || !isReconnecting,
    staleTime: 5 * 60 * 1000,
  });

  const seenFlows = useMemo<string[]>(
    () => guidesQuery.data ?? readCachedGuides(userScope) ?? [],
    [guidesQuery.data, userScope]
  );

  const hasSeenFlow = useCallback(
    (flowId: GuideFlowId): boolean => seenFlows.includes(flowId),
    [seenFlows]
  );

  const markFlowSeen = useCallback(
    (flowId: GuideFlowId): void => {
      const current = readCachedGuides(userScope) ?? guidesQuery.data ?? [];
      const updated = Array.from(new Set([...current, flowId]));
      writeCachedGuides(userScope, updated);
      queryClient.setQueryData(['user-guides', userScope], updated);
      if (activeUser) {
        void sdk
          .fetch('/api/user/guides', {
            method: 'POST',
            userAddress: activeUser,
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ address: activeUser, guides: updated }),
          })
          .catch(() => {});
      }
    },
    [userScope, activeUser, guidesQuery.data, queryClient]
  );

  useEffect(() => {
    if (prevScopeRef.current !== userScope) {
      const previousScope = prevScopeRef.current;
      prevScopeRef.current = userScope;
      if (previousScope === 'guest' && activeUser) {
        const guestFlows = readCachedGuides('guest') ?? [];
        if (guestFlows.length > 0) {
          const localFlows = readCachedGuides(activeUser) ?? [];
          const merged = Array.from(new Set([...localFlows, ...guestFlows]));
          writeCachedGuides(activeUser, merged);
          queryClient.setQueryData(['user-guides', userScope], merged);
        }
      }
      setActiveFlow(null);
      setStepIndex(0);
      setCutout(null);
    }
  }, [userScope, activeUser, queryClient]);

  const startFlow = useCallback((flow: GuideFlowId) => {
    scrolledStepRef.current = null;
    const firstStep = GUIDE_FLOWS[flow]?.steps[0];
    if (firstStep?.action) {
      dispatchGuideAction(firstStep.action);
    }
    setStepIndex(0);
    setActiveFlow(flow);
  }, []);

  const closeGuide = useCallback(() => {
    if (activeFlow) {
      markFlowSeen(activeFlow);
    }
    setActiveFlow(null);
    setStepIndex(0);
    setCutout(null);
  }, [activeFlow, markFlowSeen]);

  const resetAllGuides = useCallback(() => {
    writeCachedGuides(userScope, []);
    queryClient.setQueryData(['user-guides', userScope], []);
  }, [userScope, queryClient]);

  // Automatic first-visit trigger per user per page (and global 'welcome' on first landing)
  useEffect(() => {
    if (activeFlow) return;
    if (!activeUser && isReconnecting) return;
    if (activeUser && (consentLoading || !hasConsented)) return;
    if (guidesQuery.isLoading) return;
    const timer = window.setTimeout(() => {
      if (typeof document !== 'undefined' && document.querySelector('.modal-overlay')) return;
      if (!hasSeenFlow('welcome')) {
        startFlow('welcome');
        return;
      }
      if (!hasSeenFlow(activePage)) {
        startFlow(activePage);
      }
    }, 480);
    return () => window.clearTimeout(timer);
  }, [
    activePage,
    activeFlow,
    activeUser,
    isReconnecting,
    consentLoading,
    hasConsented,
    guidesQuery.isLoading,
    hasSeenFlow,
    startFlow,
  ]);

  const flowObj = activeFlow ? GUIDE_FLOWS[activeFlow] : null;
  const currentStep: GuideStep | null =
    flowObj && flowObj.steps[stepIndex] ? flowObj.steps[stepIndex] : null;

  // Trigger step state actions before measuring DOM
  useEffect(() => {
    if (!currentStep) return;
    if (currentStep.action) {
      dispatchGuideAction(currentStep.action);
    }
  }, [currentStep]);

  // Track target bounding rect continuously while active
  useEffect(() => {
    if (!currentStep) {
      setCutout(null);
      return;
    }

    let rafId = 0;
    let active = true;

    const updateRect = () => {
      if (!active) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      setViewport((prev) => (prev.w === vw && prev.h === vh ? prev : { w: vw, h: vh }));

      if (cardRef.current) {
        const ch = cardRef.current.offsetHeight;
        if (ch > 40) setCardHeight((prev) => (Math.abs(prev - ch) > 2 ? ch : prev));
      }

      const target = resolveTargetElement(currentStep.selector);
      if (target) {
        const raw = target.getBoundingClientRect();
        if (scrolledStepRef.current !== currentStep.id) {
          scrolledStepRef.current = currentStep.id;
          const outOfView = raw.top < 12 || raw.bottom > vh - 12;
          if (outOfView) {
            try {
              target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
            } catch { }
          }
        }

        const pad = 6;
        const x = Math.max(4, raw.left - pad);
        const y = Math.max(4, raw.top - pad);
        const right = Math.min(vw - 4, raw.right + pad);
        const bottom = Math.min(vh - 4, raw.bottom + pad);
        const width = Math.max(24, right - x);
        const height = Math.max(24, bottom - y);

        setCutout((prev) => {
          if (
            prev &&
            Math.abs(prev.x - x) < 1 &&
            Math.abs(prev.y - y) < 1 &&
            Math.abs(prev.width - width) < 1 &&
            Math.abs(prev.height - height) < 1
          ) {
            return prev;
          }
          return { x, y, width, height };
        });
      } else {
        setCutout(null);
      }

      rafId = window.requestAnimationFrame(updateRect);
    };

    rafId = window.requestAnimationFrame(updateRect);
    return () => {
      active = false;
      window.cancelAnimationFrame(rafId);
    };
  }, [currentStep]);

  const handleNext = useCallback(() => {
    if (!flowObj || !activeFlow) return;
    if (stepIndex < flowObj.steps.length - 1) {
      const nextStep = flowObj.steps[stepIndex + 1];
      if (nextStep?.action) dispatchGuideAction(nextStep.action);
      setStepIndex((i) => i + 1);
    } else {
      markFlowSeen(activeFlow);
      // If user just finished 'welcome' and hasn't seen the current page guide yet, chain smoothly into it
      if (activeFlow === 'welcome' && !hasSeenFlow(activePage)) {
        startFlow(activePage);
      } else {
        setActiveFlow(null);
        setStepIndex(0);
        setCutout(null);
      }
    }
  }, [flowObj, activeFlow, stepIndex, activePage, startFlow, markFlowSeen, hasSeenFlow]);

  const handlePrev = useCallback(() => {
    if (!flowObj || stepIndex <= 0) return;
    const prevStep = flowObj.steps[stepIndex - 1];
    if (prevStep?.action) dispatchGuideAction(prevStep.action);
    setStepIndex((i) => Math.max(0, i - 1));
  }, [flowObj, stepIndex]);

  // Keyboard navigation (ArrowLeft, ArrowRight, Escape)
  useEffect(() => {
    if (!activeFlow) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeGuide();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleNext();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePrev();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeFlow, closeGuide, handleNext, handlePrev]);

  // Compute position-aware card coordinates
  const cardPositionStyle = useMemo<React.CSSProperties>(() => {
    const isMobile = viewport.w <= 900;
    if (isMobile) {
      if (!cutout) {
        return {
          left: '12px',
          right: '12px',
          bottom: '16px',
        };
      }
      const targetCenterY = cutout.y + cutout.height / 2;
      if (targetCenterY > viewport.h * 0.54) {
        return {
          left: '12px',
          right: '12px',
          top: '54px',
        };
      }
      return {
        left: '12px',
        right: '12px',
        bottom: '14px',
      };
    }

    const cardWidth = Math.min(380, viewport.w - 32);
    const gap = 14;
    if (!cutout) {
      return {
        width: `${cardWidth}px`,
        left: `${Math.round((viewport.w - cardWidth) / 2)}px`,
        top: `${Math.round(Math.max(24, (viewport.h - cardHeight) / 2))}px`,
      };
    }

    const spaceBottom = viewport.h - (cutout.y + cutout.height) - gap;
    const spaceTop = cutout.y - gap;
    const spaceRight = viewport.w - (cutout.x + cutout.width) - gap;
    const spaceLeft = cutout.x - gap;

    let placement = currentStep?.placement || 'bottom';

    const fits = (dir: string) => {
      if (dir === 'bottom') return spaceBottom >= cardHeight + 12;
      if (dir === 'top') return spaceTop >= cardHeight + 12;
      if (dir === 'right') return spaceRight >= cardWidth + 16;
      if (dir === 'left') return spaceLeft >= cardWidth + 16;
      return false;
    };

    if (!fits(placement)) {
      const candidates: Array<{ dir: 'bottom' | 'top' | 'right' | 'left'; space: number }> = [
        { dir: 'bottom', space: spaceBottom },
        { dir: 'top', space: spaceTop },
        { dir: 'right', space: spaceRight },
        { dir: 'left', space: spaceLeft },
      ];
      const fitting = candidates.find((c) => fits(c.dir));
      if (fitting) {
        placement = fitting.dir;
      } else {
        candidates.sort((a, b) => b.space - a.space);
        placement = candidates[0].dir;
      }
    }

    let top = 24;
    let left = 24;

    if (placement === 'bottom') {
      top = cutout.y + cutout.height + gap;
      left = cutout.x + cutout.width / 2 - cardWidth / 2;
    } else if (placement === 'top') {
      top = cutout.y - cardHeight - gap;
      left = cutout.x + cutout.width / 2 - cardWidth / 2;
    } else if (placement === 'right') {
      top = cutout.y + Math.min(24, cutout.height / 4);
      left = cutout.x + cutout.width + gap;
    } else if (placement === 'left') {
      top = cutout.y + Math.min(24, cutout.height / 4);
      left = cutout.x - cardWidth - gap;
    }

    const clampedLeft = Math.max(16, Math.min(viewport.w - cardWidth - 16, Math.round(left)));
    const clampedTop = Math.max(16, Math.min(viewport.h - cardHeight - 16, Math.round(top)));

    return {
      width: `${cardWidth}px`,
      left: `${clampedLeft}px`,
      top: `${clampedTop}px`,
    };
  }, [cutout, viewport, cardHeight, currentStep?.placement]);

  const contextVal = useMemo<GuideContextValue>(
    () => ({
      activeFlow,
      stepIndex,
      activePage,
      startFlow,
      closeGuide,
      resetAllGuides,
    }),
    [activeFlow, stepIndex, activePage, startFlow, closeGuide, resetAllGuides]
  );

  const maskId = 'rawchunks-guide-spotlight-mask';

  return (
    <GuideContext.Provider value={contextVal}>
      {children}
      {activeFlow &&
        flowObj &&
        currentStep &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="guide-portal-root" role="dialog" aria-modal="false" aria-label={flowObj.label}>
            {/* Dimmed SVG spotlight backdrop with rounded cutout */}
            <svg
              className="guide-spotlight-svg"
              width={viewport.w}
              height={viewport.h}
              viewBox={`0 0 ${viewport.w} ${viewport.h}`}
              aria-hidden="true"
            >
              <defs>
                <mask id={maskId}>
                  <rect x="0" y="0" width={viewport.w} height={viewport.h} fill="white" />
                  {cutout && (
                    <rect
                      x={cutout.x}
                      y={cutout.y}
                      width={cutout.width}
                      height={cutout.height}
                      rx="10"
                      ry="10"
                      fill="black"
                    />
                  )}
                </mask>
              </defs>
              <rect
                x="0"
                y="0"
                width={viewport.w}
                height={viewport.h}
                fill="rgba(5, 7, 12, 0.76)"
                mask={`url(#${maskId})`}
              />
            </svg>

            {/* Highlight ring around target (pointer-events: none so target stays clickable) */}
            {cutout && (
              <div
                className="guide-cutout-ring"
                style={{
                  left: `${cutout.x}px`,
                  top: `${cutout.y}px`,
                  width: `${cutout.width}px`,
                  height: `${cutout.height}px`,
                }}
              />
            )}

            {/* Floating Guide Tooltip Card */}
            <div ref={cardRef} className="guide-card" style={cardPositionStyle}>
              <div className="guide-card-top">
                <div className="guide-card-meta">
                  <span className="guide-flow-pill">
                    <Sparkles size={11} />
                    {flowObj.label}
                  </span>
                  {currentStep.badge && (
                    <span className="guide-step-badge">{currentStep.badge}</span>
                  )}
                </div>
                <Tooltip title="Close guide (Esc)">
                  <button
                    type="button"
                    className="guide-close-btn"
                    onClick={closeGuide}
                    aria-label="Close guide"
                  >
                    <X size={14} />
                  </button>
                </Tooltip>
              </div>

              <h3 className="guide-card-title">{currentStep.title}</h3>
              <p className="guide-card-desc">{currentStep.description}</p>

              {currentStep.bullets && currentStep.bullets.length > 0 && (
                <ul className="guide-card-bullets">
                  {currentStep.bullets.map((item, idx) => {
                    const colonIdx = item.indexOf(':');
                    if (colonIdx > 0 && colonIdx < 32) {
                      const lead = item.slice(0, colonIdx);
                      const rest = item.slice(colonIdx + 1);
                      return (
                        <li key={idx}>
                          <strong>{lead}:</strong>
                          {rest}
                        </li>
                      );
                    }
                    return <li key={idx}>{item}</li>;
                  })}
                </ul>
              )}

              <div className="guide-card-footer">
                <div className="guide-progress-wrap">
                  <span className="guide-step-counter">
                    {stepIndex + 1} / {flowObj.steps.length}
                  </span>
                  <div className="guide-dots">
                    {flowObj.steps.map((s, idx) => (
                      <button
                        key={s.id}
                        type="button"
                        className={`guide-dot ${idx === stepIndex ? 'active' : idx < stepIndex ? 'done' : ''}`}
                        onClick={() => {
                          const targetStep = flowObj.steps[idx];
                          if (targetStep?.action) dispatchGuideAction(targetStep.action);
                          setStepIndex(idx);
                        }}
                        aria-label={`Go to step ${idx + 1}`}
                      />
                    ))}
                  </div>
                </div>

                <div className="guide-nav-btns">
                  <button
                    type="button"
                    className="guide-skip-btn"
                    onClick={closeGuide}
                  >
                    Skip
                  </button>
                  <Tooltip title="Previous (←)">
                    <button
                      type="button"
                      className="guide-arrow-btn"
                      onClick={handlePrev}
                      disabled={stepIndex === 0}
                      aria-label="Previous step"
                    >
                      <ChevronLeft size={15} />
                    </button>
                  </Tooltip>
                  <Tooltip title="Next (→)">
                    <button
                      type="button"
                      className="guide-next-btn"
                      onClick={handleNext}
                      aria-label={stepIndex === flowObj.steps.length - 1 ? 'Finish guide' : 'Next step'}
                    >
                      <span>
                        {stepIndex === flowObj.steps.length - 1
                          ? activeFlow === 'welcome' && !hasSeenFlow(activePage)
                            ? `${GUIDE_FLOWS[activePage].label} `
                            : 'Done'
                          : 'Next'}
                      </span>
                      <ChevronRight size={14} />
                    </button>
                  </Tooltip>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </GuideContext.Provider>
  );
};

export function useGuide(): GuideContextValue {
  const ctx = useContext(GuideContext);
  if (!ctx) {
    throw new Error('useGuide must be used within a GuideProvider');
  }
  return ctx;
}
