import type { Key, ReactNode } from 'react';

import { EmptyState } from './EmptyState.js';

export interface RecordListProps<T> {
  ariaLabel: string;
  items: readonly T[];
  getKey: (item: T) => Key;
  renderItem: (item: T) => ReactNode;
  isLoading?: boolean;
  loadingLabel?: string;
  error?: string | null;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  className?: string;
}

export function RecordList<T>({
  ariaLabel,
  items,
  getKey,
  renderItem,
  isLoading = false,
  loadingLabel = '正在加载…',
  error,
  emptyTitle = '暂无内容',
  emptyDescription,
  emptyAction,
  className,
}: RecordListProps<T>) {
  if (isLoading) {
    return (
      <p className="record-list-state" role="status">
        {loadingLabel}
      </p>
    );
  }

  if (error) {
    return <EmptyState variant="error" title={error} />;
  }

  if (items.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />;
  }

  const classes = ['record-list', className].filter(Boolean).join(' ');

  return (
    <ul className={classes} aria-label={ariaLabel}>
      {items.map((item) => (
        <li key={getKey(item)}>{renderItem(item)}</li>
      ))}
    </ul>
  );
}
