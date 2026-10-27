import { useEffect, useRef, type RefObject } from 'react';

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
      if (anchor?.current?.contains(target)) return true;
      if (ignoreSelectors?.some((sel) => target.closest(sel))) return true;
      return false;
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!isInside(e.target as HTMLElement | null)) closeRef.current();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, anchor, ignoreSelectors]);
}
