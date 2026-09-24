import type { ReactNode } from 'react';

import { EmptyState } from './EmptyState.js';

export type AsyncStateKind = 'loading' | 'empty' | 'error';

export interface AsyncStateProps {
  state: AsyncStateKind;
  title?: string;
  description?: string;
  loadingLabel?: string;
  action?: ReactNode;
}

export function AsyncState({
  state,
  title,
  description,
  loadingLabel = '正在加载…',
  action,
}: AsyncStateProps) {
  if (state === 'loading') {
    return (
      <p className="async-state" role="status">
        {loadingLabel}
      </p>
    );
  }

  return (
    <EmptyState
      variant={state === 'error' ? 'error' : 'empty'}
      title={title ?? (state === 'error' ? '加载失败' : '暂无内容')}
      description={description}
      action={action}
    />
  );
}
