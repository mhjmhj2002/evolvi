import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { BottomSheetProps } from './types.ts';

export const BottomSheet: React.FC<BottomSheetProps> = ({
  isOpen,
  onClose,
  title,
  children,
}) => {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="bottom-sheet-backdrop" onClick={onClose}>
      <div
        className="bottom-sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bottom-sheet-title"
      >
        <div className="bottom-sheet-handle" />
        <div className="bottom-sheet-header">
          <h2 id="bottom-sheet-title" className="bottom-sheet-title">
            {title}
          </h2>
          <button
            className="bottom-sheet-close"
            onClick={onClose}
            aria-label="Fechar"
            type="button"
          >
            <X size={20} />
          </button>
        </div>
        <div className="bottom-sheet-content">
          {children}
        </div>
      </div>
    </div>
  );
};
