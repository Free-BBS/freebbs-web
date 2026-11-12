import { describe, expect, it } from 'vitest';

import { loadEnvironment } from './env.js';

describe('API listener environment', () => {
  it('preserves shared finance access by default and parses an explicit pilot restriction', () => {
    expect(loadEnvironment({}).financePilotUids).toBeUndefined();
    expect(
      loadEnvironment({ FINANCE_PILOT_UIDS: 'u_owner, u_peer,u_owner' }).financePilotUids,
    ).toEqual(['u_owner', 'u_peer']);
    for (const value of ['', ' ', ',', 'u_owner,', 'u owner', `u_owner\u0000`, 'x'.repeat(129)])
      expect(() => loadEnvironment({ FINANCE_PILOT_UIDS: value })).toThrow('FINANCE_PILOT_UIDS');
  });
  it('keeps legacy directory UID metadata optional without making it an entry requirement', () => {
    expect(
      loadEnvironment({ NODE_ENV: 'production', AUTH_MODE: 'main' }).previewAllowedUids,
    ).toEqual([]);
    expect(
      loadEnvironment({ DEVELOPMENT_PREVIEW_UIDS: 'u_first, u_second, u_first' })
        .previewAllowedUids,
    ).toEqual(['u_first', 'u_second']);
  });
  it('defaults the API to the production loopback listener', () => {
    expect(loadEnvironment({})).toMatchObject({ host: '127.0.0.1', port: 3100 });
  });

  it.each([
    [{ HOST: 'localhost' }, 'HOST'],
    [{ HOST: '0.0.0.0' }, 'HOST'],
    [{ HOST: 'not-an-ip' }, 'HOST'],
    [{ PORT: '0' }, 'PORT'],
    [{ PORT: '65536' }, 'PORT'],
    [{ PORT: '3100.5' }, 'PORT'],
  ])('rejects invalid listener configuration %#', (source, errorName) => {
    expect(() => loadEnvironment(source)).toThrow(errorName);
  });
});
