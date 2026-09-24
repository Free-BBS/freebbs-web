import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiClient, AUTH_TOKEN_STORAGE_KEY } from './client.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('ApiClient browser transport', () => {
  it('downloads protected media with auth headers and an abort signal, never a token URL', async () => {
    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, 'test-private-token');
    const controller = new AbortController();
    const fetchMedia = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe('/api/development/v1/events/festival/submissions/id/media');
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-private-token');
      expect(init?.signal).toBe(controller.signal);
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
});
