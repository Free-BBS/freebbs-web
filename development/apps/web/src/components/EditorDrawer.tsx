import { useEffect, useId, useRef, type ReactNode } from 'react';

import { focusableElements, lockDocumentScroll, trapModalFocus } from './modal-interactions.js';

export interface EditorDrawerProps {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
}

export function EditorDrawer({ open, title, description, children, onClose }: EditorDrawerProps) {
  const dialogRef = useRef<HTMLElement>(null);
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
    const [firstFocusable] = focusableElements(dialogRef.current);
    (firstFocusable ?? dialogRef.current)?.focus();

    return () => {
      triggerRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="editor-drawer-backdrop">
      <aside
        ref={dialogRef}
        className="editor-drawer"
        role="dialog"
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
        <header className="editor-drawer-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <p id={descriptionId}>{description}</p> : null}
          </div>
          <button type="button" onClick={onClose} aria-label="关闭编辑器">
            关闭
          </button>
        </header>
        <div className="editor-drawer-body">{children}</div>
      </aside>
    </div>
  );
}
