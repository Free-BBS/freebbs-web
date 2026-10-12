import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiClient, AUTH_TOKEN_STORAGE_KEY } from './client.js';
import { requestRuntime } from './request.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ApiClient browser transport', () => {
  it('downloads protected media with auth headers and an abort signal, never a token URL', async () => {
    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, 'test-private-token');
    const controller = new AbortController();
    const fetchMedia = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe('/api/development/v1/events/festival/submissions/id/media');
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-private-token');
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(init?.signal?.aborted).toBe(false);
      expect(init?.cache).toBe('no-store');
      return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'video/mp4' } });
    });
    const client = new ApiClient({ authMode: 'main', fetch: fetchMedia });
    const media = await client.download('/events/festival/submissions/id/media', {
      signal: controller.signal,
    });
    expect(media.size).toBe(3);
    localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  });
  it('keeps the shared main-site token storage contract', () => {
    expect(AUTH_TOKEN_STORAGE_KEY).toBe('free_bbs_auth_token');
  });
  it('binds the native global fetch receiver', async () => {
    globalThis.fetch = vi.fn(function (this: unknown) {
      expect(this).toBe(globalThis);
      return Promise.resolve(
        new Response(JSON.stringify({ data: { ok: true }, requestId: 'request-1' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }) as typeof fetch;

    const client = new ApiClient({ authMode: 'main' });
    await expect(client.request<{ ok: boolean }>('/health')).resolves.toEqual({ ok: true });
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });

  it('uses the same main-site runtime and bounds pending writes without retry or token deletion', async () => {
    vi.useFakeTimers();
    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, 'saved-token');
    let signal: AbortSignal | undefined;
    const fetchMock = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => {});
    });
    const pending = new ApiClient({ authMode: 'main', fetch: fetchMock }).request('/clubs', {
      method: 'POST',
    });
    const rejected = expect(pending).rejects.toMatchObject({
      name: 'TimeoutError',
      code: 'request_timeout',
      status: 0,
    });
    await vi.advanceTimersByTimeAsync(15000);
    await rejected;
    expect(requestRuntime).toBe(globalThis.freeBbsRequests);
    expect(signal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBe('saved-token');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the deadline during JSON consumption and preserves timeout errors', async () => {
    vi.useFakeTimers();
    const json = vi.fn(() => new Promise(() => {}));
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json }) as unknown as Response);
    const pending = new ApiClient({ authMode: 'main', fetch: fetchMock }).request('/health', {
      timeoutMs: 25,
    });
    const rejected = expect(pending).rejects.toMatchObject({
      code: 'request_timeout',
      timeoutMs: 25,
    });
    await vi.advanceTimersByTimeAsync(25);
    await rejected;
    expect(json).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('honors caller cancellation through the combined signal and does not dispatch an already aborted request', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    let signal: AbortSignal | undefined;
    const fetchMock = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => {});
    });
    const client = new ApiClient({ authMode: 'main', fetch: fetchMock });
    const pending = client.request('/health', { signal: controller.signal });
    const reason = new DOMException('Navigated away', 'AbortError');
    const rejected = expect(pending).rejects.toBe(reason);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort(reason);
    await rejected;
    expect(signal?.aborted).toBe(true);
    expect(signal?.reason).toBe(reason);
    expect(removeListener).toHaveBeenCalledOnce();
    await expect(client.request('/health', { signal: controller.signal })).rejects.toBe(reason);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('gives multipart uploads a longer deadline and accepts a longer explicit override', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    const client = new ApiClient({ authMode: 'main', fetch: fetchMock });
    const pending = client.request('/sports/media/images', {
      method: 'POST',
      body: new FormData(),
    });
    const rejected = expect(pending).rejects.toMatchObject({ timeoutMs: 120000 });
    await vi.advanceTimersByTimeAsync(15000);
    expect(fetchMock.mock.calls).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(105000);
    await rejected;
    const extended = client.request('/health', { timeoutMs: 240000 });
    const extendedRejected = expect(extended).rejects.toMatchObject({ timeoutMs: 240000 });
    await vi.advanceTimersByTimeAsync(240000);
    await extendedRejected;
  });

  it('bounds media body reads with the transfer deadline or caller override', async () => {
    vi.useFakeTimers();
    const blob = vi.fn(() => new Promise<Blob>(() => {}));
    const client = new ApiClient({
      authMode: 'main',
      fetch: vi.fn(async () => ({ ok: true, blob }) as unknown as Response),
    });
    const pending = client.download('/events/item/media');
    const rejected = expect(pending).rejects.toMatchObject({ timeoutMs: 120000 });
    await vi.advanceTimersByTimeAsync(120000);
    await rejected;
    expect(blob).toHaveBeenCalledOnce();
    const short = expect(
      client.download('/events/item/media', { timeoutMs: 50 }),
    ).rejects.toMatchObject({ timeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(50);
    await short;
    expect(vi.getTimerCount()).toBe(0);
  });
});
