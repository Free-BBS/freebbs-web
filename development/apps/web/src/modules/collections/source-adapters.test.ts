import { describe, expect, it, vi } from 'vitest';
import { loadRegistrationCatalog, normalizeLearningSurveys } from './source-adapters.js';
import type { ApiClient } from '../../core/api/client.js';

describe('learning registration catalog', () => {
  it('uses canonical dates, drawn status and login requirement', () => {
    const items = normalizeLearningSurveys({
      surveys: [
        {
          id: 'open',
          title: 'Open',
          opensAt: '2020-01-01',
          closesAt: '2099-01-01',
          requiresLogin: false,
        },
        {
          id: 'soon',
          title: 'Soon',
          opensAt: '2098-01-01',
          closesAt: '2099-01-01',
          requiresLogin: true,
        },
        { id: 'drawn', title: 'Drawn', status: 'drawn', closesAt: '2099-01-01' },
      ],
    });
    expect(items[0]).toMatchObject({
      opensAt: '2020-01-01',
      closesAt: '2099-01-01',
      status: 'open',
      requiresLogin: false,
    });
    expect(items[1]).toMatchObject({ status: 'upcoming', requiresLogin: true });
    expect(items[2]?.status).toBe('closed');
  });

  it('follows nextPage and keeps native entries when a later learning page fails', async () => {
    const native = [{ id: 'native', source: 'native_collection' }];
    const client = { request: vi.fn(async () => native) as ApiClient['request'] };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ surveys: [{ id: 'first', title: 'First' }], nextPage: 4 })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ surveys: [{ id: 'last', title: 'Last' }], nextPage: null })),
      );
    const result = await loadRegistrationCatalog(client, fetcher);
    expect(result.items.map((item) => item.id)).toEqual(['native', 'first', 'last']);
    expect(fetcher.mock.calls[1]?.[0]).toBe('/api/surveys?page=4');
    fetcher
      .mockReset()
      .mockResolvedValueOnce(new Response(JSON.stringify({ surveys: [], nextPage: 1 })))
      .mockRejectedValueOnce(new Error('offline'));
    expect(await loadRegistrationCatalog(client, fetcher)).toEqual({
      items: native.map((item) => ({ ...item, startsAt: null, endsAt: null })),
      unavailable: ['learning_survey'],
    });
  });
});
