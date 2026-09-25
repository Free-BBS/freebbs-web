import {
  useEffect,
  useId,
  useRef,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export interface DialogFormProps {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  submitLabel?: string;
  cancelLabel?: string;
  pending?: boolean;
  error?: string | null;
  feedback?: string | null;
  initialFocusRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  onSubmit: () => void | Promise<void>;
}

export function DialogForm({
  open,
  title,
  description,
  children,
  submitLabel = '提交',
  cancelLabel = '取消',
  pending = false,
  error,
  feedback,
  initialFocusRef,
  onClose,
  onSubmit,
}: DialogFormProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const firstFocusable = dialogRef.current?.querySelector<HTMLElement>(focusableSelector);
    (initialFocusRef?.current ?? firstFocusable ?? dialogRef.current)?.focus();

    return () => {
      trigger?.focus();
    };
  }, [initialFocusRef, open]);

  if (!open) {
    return null;
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }

    if (event.key !== 'Tab') {
      return;
    }

    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [],
    );

    if (focusable.length === 0) {
      event.preventDefault();
      dialogRef.current?.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pending) {
      void onSubmit();
    }
  }

  return (
    <div className="dialog-backdrop">
      <div
        ref={dialogRef}
        className="dialog-form"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        aria-busy={pending || undefined}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <form className="dialog-form-layout" onSubmit={handleSubmit}>
          <header className="dialog-form-header">
            <h2 id={titleId}>{title}</h2>
            {description ? <p id={descriptionId}>{description}</p> : null}
          </header>

          <div className="dialog-form-body">
            <div className="dialog-form-fields">{children}</div>

            {error ? <p role="alert">{error}</p> : null}
            {feedback ? <p role="status">{feedback}</p> : null}
          </div>

          <footer className="dialog-form-actions">
            <button type="button" onClick={onClose}>
              {cancelLabel}
            </button>
            <button type="submit" disabled={pending}>
              {pending ? '正在提交…' : submitLabel}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
