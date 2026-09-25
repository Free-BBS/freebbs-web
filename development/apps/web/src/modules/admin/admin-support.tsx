import type { ReactNode } from 'react';

import { AsyncState } from '../../components/AsyncState.js';
import type { ApiClient } from '../../core/api/client.js';

export type AdminClient = Pick<ApiClient, 'request'>;

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = String((error as { message: unknown }).message).trim();
    if (message) return message;
  }
  return '操作失败，请稍后重试。';
}

export function queryPath(
  base: string,
  values: Record<string, string | number | undefined>,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && String(value).trim()) query.set(key, String(value));
  }
  return `${base}?${query.toString()}`;
}

export function toIsoOrNull(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

export function SectionState({
  loading,
  error,
  empty,
  onRetry,
  children,
}: {
  loading: boolean;
  error: string;
  empty?: boolean;
  onRetry?: () => void;
  children: ReactNode;
}) {
  if (loading) return <AsyncState state="loading" loadingLabel="正在加载治理数据…" />;
  if (error)
    return (
      <AsyncState
        state="error"
        title="治理数据加载失败"
        description={error}
        action={
          onRetry ? (
            <button type="button" onClick={onRetry}>
              重试
            </button>
          ) : undefined
        }
      />
    );
  if (empty) return <AsyncState state="empty" title="暂无记录" />;
  return <>{children}</>;
}

export function Feedback({ error, success }: { error: string; success: string }) {
  return (
    <>
      {error ? <p role="alert">{error}</p> : null}
      {success ? <p role="status">{success}</p> : null}
    </>
  );
}
