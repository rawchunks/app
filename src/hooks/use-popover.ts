export interface PopoverOptions {
  /** Which side of the anchor the popover prefers before flipping. */
  placement?: 'top' | 'bottom';
  /** Horizontal relationship to the anchor. */
  align?: 'center' | 'start' | 'end';
  /** Gap between anchor edge and popover. */
  gap?: number;
  /** Viewport edge padding the popover must respect. */
  padding?: number;
  fallbackWidth?: number;
  fallbackHeight?: number;
}

export interface PopoverPosition {
  top: number;
  left: number;
}

/**
 * Single source of truth for anchoring a floating layer to a trigger and
 * keeping it inside the viewport. Shared by the DAW Tooltip (top/center) and
 * the Select dropdown (bottom/start|end) so positioning is never rebuilt.
 *
 * `left` follows the `align` contract: for `center` it is the popover's centre
 * x (pair with `transform: translateX(-50%)`); for `start`/`end` it is the
 * popover's left edge.
 */
export function computePopoverPosition(
  anchor: HTMLElement | null,
  content: HTMLElement | null,
  opts: PopoverOptions = {},
): PopoverPosition | null {
  if (!anchor || !content) return null;
  const rect = anchor.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;

  const {
    placement = 'bottom',
    align = 'start',
    gap = 8,
    padding = 12,
    fallbackWidth = 220,
    fallbackHeight = 44,
  } = opts;

  const width = content.offsetWidth || fallbackWidth;
  const height = content.offsetHeight || fallbackHeight;

  let top = placement === 'top' ? rect.top - height - gap : rect.bottom + gap;
  if (placement === 'top' && top < padding) top = rect.bottom + gap;
  if (placement === 'bottom' && top + height > window.innerHeight - padding) {
    top = rect.top - height - gap;
  }

  let left: number;
  if (align === 'center') {
    left = rect.left + rect.width / 2;
    const half = width / 2;
    if (left - half < padding) left = padding + half;
    else if (left + half > window.innerWidth - padding) left = window.innerWidth - padding - half;
  } else if (align === 'end') {
    left = rect.right - width;
    if (left < padding) left = padding;
    else if (left + width > window.innerWidth - padding) left = window.innerWidth - padding - width;
  } else {
    left = rect.left;
    if (left < padding) left = padding;
    else if (left + width > window.innerWidth - padding) left = window.innerWidth - padding - width;
  }

  top = Math.max(padding, Math.min(top, window.innerHeight - height - padding));
  return { top, left };
}
