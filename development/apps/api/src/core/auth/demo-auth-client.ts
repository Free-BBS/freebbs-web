import { DEMO_USERS, type UserContext } from '@freebbs-development/contracts';
import type { AuthClient } from './auth-client.js';

const demoUsers = new Map<string, { displayName: string }>(
  DEMO_USERS.map((user) => [user.uid, user]),
);

export class DemoAuthClient implements AuthClient {
  private readonly allowedUserIds: ReadonlySet<string>;

  constructor(allowedUserIds: readonly string[]) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Demo authentication is disabled in production');
    }
    this.allowedUserIds = new Set(allowedUserIds);
  }

  async introspect(uid: string): Promise<UserContext | null> {
    const profile = demoUsers.get(uid);
    if (!this.allowedUserIds.has(uid) || profile === undefined) return null;
    return {
      uid,
      displayName: profile.displayName,
      avatarUrl: null,
      baseRole: 'student',
      roles: [],
      tags: [],
    };
  }
}
