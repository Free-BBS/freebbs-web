import { useEffect, useId, useRef, type ReactNode } from 'react';

import { focusableElements, lockDocumentScroll, trapModalFocus } from './modal-interactions.js';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  children?: ReactNode;
  onClose: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = '确认',
  cancelLabel = '取消',
  children,
  onClose,
  onConfirm,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;
    return lockDocumentScroll();
  }, [open]);

  useEffect(() => {
    if (!open) return;

    triggerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    focusableElements(dialogRef.current)[0]?.focus();
    return () => {
      triggerRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="confirm-dialog-backdrop">
      <div
        ref={dialogRef}
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
            return;
          }
          trapModalFocus(event, dialogRef.current);
        }}
      >
        <h2 id={titleId}>{title}</h2>
        {description ? <p id={descriptionId}>{description}</p> : null}
        {children ? <div className="confirm-dialog-body">{children}</div> : null}
        <footer className="confirm-dialog-actions">
          <button type="button" onClick={onClose}>
            {cancelLabel}
          </button>
          <button type="button" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}
