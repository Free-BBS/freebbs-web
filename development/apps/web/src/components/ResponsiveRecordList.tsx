import type { ReactNode } from 'react';

import { AsyncState } from './AsyncState.js';

export interface ResponsiveRecordListProps<T> {
  ariaLabel: string;
  records: readonly T[];
  state: 'loading' | 'ready' | 'error';
  errorMessage?: string;
  emptyTitle: string;
  emptyDescription?: string;
  getKey: (record: T) => string;
  renderRecord: (record: T) => ReactNode;
  emptyAction?: ReactNode;
  className?: string;
}

export function ResponsiveRecordList<T>({
  ariaLabel,
  records,
  state,
  errorMessage,
  emptyTitle,
  emptyDescription,
  getKey,
  renderRecord,
  emptyAction,
  className,
}: ResponsiveRecordListProps<T>) {
  if (state === 'loading') {
    return <AsyncState state="loading" />;
  }

  if (state === 'error') {
    return <AsyncState state="error" title={errorMessage} />;
  }

  if (records.length === 0) {
    return (
      <AsyncState
        state="empty"
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
      />
    );
  }

  const classes = ['responsive-record-list', className].filter(Boolean).join(' ');
  return (
    <ul className={classes} aria-label={ariaLabel}>
      {records.map((record) => (
        <li key={getKey(record)}>{renderRecord(record)}</li>
      ))}
    </ul>
  );
}
