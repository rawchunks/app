import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button } from './button';
import { Tooltip } from './daw/Tooltip';

export interface Props {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

export const Modal: React.FC<Props> = ({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
  className = '',
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

  if (!isOpen) return null;

  return createPortal(
    <div
      className="modal-overlay"
      onClick={onClose}
    >
      <div
        className={`modal-container modal-size-${size} ${className}`.trim()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-inner-card">
          <div className="modal-header-row">
            <h3 className="modal-title-text">{title}</h3>
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

