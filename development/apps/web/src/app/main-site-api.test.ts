import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTH_TOKEN_STORAGE_KEY } from '../core/api/client.js';
import { requestMainSite } from './main-site-api.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
});

describe('main-site request boundary', () => {
  it('bounds auth lookup and preserves credentials when transport hangs', async () => {
    vi.useFakeTimers();
    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, 'saved-token');
    let signal: AbortSignal | undefined;
    const fetchMock = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer saved-token');
      return new Promise<Response>(() => {});
    });
    vi.stubGlobal('fetch', fetchMock);
    const rejected = expect(requestMainSite('/auth/me')).rejects.toMatchObject({
      code: 'request_timeout',
      timeoutMs: 8000,
    });
    await vi.advanceTimersByTimeAsync(8000);
    await rejected;
    expect(signal?.aborted).toBe(true);
    expect(localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBe('saved-token');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds body consumption and honors caller abort', async () => {
    vi.useFakeTimers();
    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, 'saved-token');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: () => new Promise(() => {}) })),
    );
    const timedOut = expect(
      requestMainSite('/notifications', { timeoutMs: 30 }),
    ).rejects.toMatchObject({ code: 'request_timeout' });
    await vi.advanceTimersByTimeAsync(30);
    await timedOut;
    const controller = new AbortController();
    const reason = new DOMException('Closed', 'AbortError');
    const cancelled = expect(
      requestMainSite('/notifications', { signal: controller.signal }),
    ).rejects.toBe(reason);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort(reason);
    await cancelled;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves HTTP messages, invalid-body errors and success payloads', async () => {
    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, 'saved-token');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: '登录已失效' }), { status: 401 }),
      )
      .mockResolvedValueOnce(new Response('<html>proxy error</html>', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ unreadCount: 3 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(requestMainSite('/auth/me')).rejects.toThrow('登录已失效');
    await expect(requestMainSite('/notifications')).rejects.toThrow('主站返回的数据暂时不可用。');
    await expect(requestMainSite('/notifications')).resolves.toEqual({ unreadCount: 3 });
    expect(localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBe('saved-token');
  });
});
