import { useEffect, useRef, type RefObject } from 'react';
import { ownEscape } from './dismissal';

export function useDismiss(
  open: boolean,
  onClose: () => void,
  anchor?: RefObject<HTMLElement | null>,
  ignoreSelectors?: string[],
) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const isInside = (target: HTMLElement | null) => {
      if (!target) return false;
      if (target.closest('[data-guide-navigation]')) return true;
      if (anchor?.current?.contains(target)) return true;
      if (ignoreSelectors?.some((sel) => target.closest(sel))) return true;
      return false;
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!isInside(e.target as HTMLElement | null)) closeRef.current();
    };
    const releaseEscape = ownEscape(() => closeRef.current(), 30);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      releaseEscape();
    };
  }, [open, anchor, ignoreSelectors]);
}
