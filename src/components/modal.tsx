import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button } from './button';
import { Tooltip } from './daw/Tooltip';

export interface Props {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  headerMeta?: React.ReactNode;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  keepMounted?: boolean;
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
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen && !keepMounted) return null;

  return createPortal(
    <div
      className="modal-overlay"
      aria-hidden={!isOpen || undefined}
      inert={!isOpen}
      onClick={onClose}
    >
      <div
        className={`modal-container modal-size-${size} ${className}`.trim()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-inner-card">
          <div className={`modal-header-row ${headerMeta ? 'has-header-meta' : ''}`.trim()}>
            <h3 className="modal-title-text">{title}</h3>
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
    </div>,
    document.body
  );
};

