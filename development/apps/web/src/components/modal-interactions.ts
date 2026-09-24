import type { KeyboardEvent } from 'react';

export const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function focusableElements(container: HTMLElement | null) {
  return Array.from(container?.querySelectorAll<HTMLElement>(focusableSelector) ?? []);
}

export function trapModalFocus(event: KeyboardEvent<HTMLElement>, container: HTMLElement | null) {
  if (event.key !== 'Tab') return;

  const focusable = focusableElements(container);
  if (focusable.length === 0) {
    event.preventDefault();
    container?.focus();
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

export function lockDocumentScroll() {
  const previousOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  return () => {
    document.body.style.overflow = previousOverflow;
  };
}
