import { describe, expect, it } from 'vitest';

import { createAuthMiddleware } from './auth-middleware.js';

import type { UserContext } from '@freebbs-development/contracts';
import type { AuthClient } from './auth-client.js';

describe('second review: collision-free tag identity', () => {
  it('does not trust colliding identity-provider tag triples as authorization input', async () => {
    const client: AuthClient = {
      async introspect(): Promise<UserContext> {
        return {
          uid: 'collision-user',
          displayName: '测试同学',
          avatarUrl: null,
          baseRole: 'student',
          roles: [],
          tags: [
            { key: 'extension.a|b', scope: { type: 'c', id: 'd' } },
            { key: 'extension.a', scope: { type: 'b', id: 'c|d' } },
          ],
        };
      },
    };
    const authenticate = createAuthMiddleware({ authClient: client, mode: 'demo' });

    const authenticated = await authenticate({ 'x-demo-user': 'collision-user' });
    if (authenticated.status !== 200) throw new Error('expected authenticated user');
    expect(authenticated.user.tags).toEqual([]);
    expect(authenticated.user.policies).toEqual([]);
  });
});
