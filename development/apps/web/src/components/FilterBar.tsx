import type { FormEventHandler, ReactNode } from 'react';

export interface FilterBarProps {
  ariaLabel: string;
  children: ReactNode;
  className?: string;
  onSubmit?: FormEventHandler<HTMLFormElement>;
}

export function FilterBar({ ariaLabel, children, className, onSubmit }: FilterBarProps) {
  const classes = ['filter-bar', className].filter(Boolean).join(' ');

  return (
    <form className={classes} role="search" aria-label={ariaLabel} onSubmit={onSubmit}>
      {children}
    </form>
  );
}
