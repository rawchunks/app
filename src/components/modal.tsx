import React, { useEffect } from 'react';
import { Button } from './button';

export interface Props {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  maxWidth?: string;
  className?: string;
}

export const Modal: React.FC<Props> = ({
  isOpen,
  onClose,
  title,
  children,
  maxWidth,
  className,
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

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
    >
      <div
        className={`modal-container ${className || ''}`}
        style={maxWidth ? { maxWidth } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-inner-card">
          <div className="modal-header-row">
            <h3 className="modal-title-text">{title}</h3>
            <Button
              variant="ghost"
              size="xs"
              onClick={onClose}
            >
              [X]
            </Button>
          </div>
          <div className="modal-body-wrap">{children}</div>
        </div>
      </div>
    </div>
  );
};
