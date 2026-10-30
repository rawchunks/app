import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button } from './button';
import { Tooltip } from './daw/Tooltip';
import { ownEscape } from '../hooks/dismissal';

export interface Props {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  headerMeta?: React.ReactNode;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  keepMounted?: boolean;
  guideOwner?: string;
  guideAnchor?: string;
  guideEntity?: string;
  guideDraft?: boolean;
  guideDraftValue?: string;
}

export const Modal: React.FC<Props> = ({
  isOpen,
  onClose,
  title,
  headerMeta,
  children,
  size = 'md',
  className = '',
  keepMounted = false,
  guideOwner,
  guideAnchor,
  guideEntity,
  guideDraft = false,
  guideDraftValue,
}) => {
  const titleId = useId();
  const overlayRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [dirty, setDirty] = useState(false);
  const draftBaseline = useRef<string | undefined>(undefined);
  const draftOpen = useRef(false);
  if (isOpen && !draftOpen.current) draftBaseline.current = guideDraftValue;
  draftOpen.current = isOpen;
  const valueChanged = guideDraftValue !== undefined && draftBaseline.current !== guideDraftValue;
  useEffect(() => {
    if (!isOpen) { setDirty(false); return; }
    const opener = document.activeElement as HTMLElement | null;
    const release = ownEscape(() => closeRef.current(), 20);
    const frame = requestAnimationFrame(() => {
      if (!overlayRef.current?.contains(document.activeElement)) {
        overlayRef.current?.querySelector<HTMLElement>('textarea, input:not([type="file"]), button')?.focus();
      }
    });
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || event.defaultPrevented) return;
      const overlay = overlayRef.current;
      const top = [...document.querySelectorAll<HTMLElement>('.modal-overlay:not([aria-hidden="true"])')].at(-1);
      if (!overlay || overlay !== top) return;
      const controls = [...overlay.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled):not([type="file"]), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]')]
        .filter(node => !node.closest('[inert], [aria-hidden="true"]') && node.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && (document.activeElement === first || !overlay.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !overlay.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', trap);
    return () => {
      cancelAnimationFrame(frame); release(); window.removeEventListener('keydown', trap);
      if (opener?.isConnected && overlayRef.current?.contains(document.activeElement)) opener.focus({ preventScroll: true });
    };
  }, [isOpen]);

  if (!isOpen && !keepMounted) return null;

  return createPortal(
    <div
      className="modal-overlay"
      ref={overlayRef}
      data-guide-owner={guideOwner}
      data-guide-entity={guideEntity}
      data-guide-dirty={guideDraft && (dirty || valueChanged) ? 'true' : undefined}
      aria-hidden={!isOpen || undefined}
      inert={!isOpen}
      onClick={onClose}
    >
      <div
        className={`modal-container modal-size-${size} ${className}`.trim()}
        role="dialog"
        aria-modal={isOpen || undefined}
        aria-labelledby={titleId}
        data-guide={guideAnchor}
        onChangeCapture={() => { if (guideDraft) setDirty(true); }}
        onClickCapture={event => { if (guideDraft && (event.target as HTMLElement).closest('[data-guide-draft-action]')) setDirty(true); }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-inner-card">
          <div className={`modal-header-row ${headerMeta ? 'has-header-meta' : ''}`.trim()}>
            <h3 id={titleId} className="modal-title-text">{title}</h3>
            {headerMeta && <div className="modal-header-meta">{headerMeta}</div>}
            <Tooltip title="Close" description="ESC" position="bottom">
              <Button
                variant="ghost"
                size="xs"
                onClick={onClose}
                aria-label="Close modal"
              >
                <X size={14} />
              </Button>
            </Tooltip>
          </div>
          <div className="modal-body-wrap">{children}</div>
        </div>
      </div>
      <div data-guide-overlay-host onClick={event => event.stopPropagation()} />
    </div>,
    document.body
  );
};

