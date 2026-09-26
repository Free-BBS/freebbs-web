import { IdentityProviderUnavailableError } from './auth-client.js';

import type { UserContext } from '@freebbs-development/contracts';
import type { AuthClient } from './auth-client.js';

interface MainSiteAuthClientOptions {
  apiBaseUrl: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unwrapIdentity(payload: unknown): Record<string, unknown> | null {
  if (!isRecord(payload)) return null;
  let candidate = payload;
  if (isRecord(candidate.data)) candidate = candidate.data;
  if (isRecord(candidate.user)) candidate = candidate.user;
  return candidate;
}

function stringField(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

export class MainSiteAuthClient implements AuthClient {
  private readonly apiBaseUrl: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: MainSiteAuthClientOptions) {
    this.apiBaseUrl = options.apiBaseUrl.replace(/\/+$/, '');
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 3_000;
  }

  async introspect(token: string): Promise<UserContext | null> {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImplementation(`${this.apiBaseUrl}/api/auth/me`, {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
        signal: abortController.signal,
      });
      if (response.status === 401 || response.status === 403) return null;
      if (!response.ok) {
        throw new IdentityProviderUnavailableError(`Identity provider returned ${response.status}`);
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch (error) {
        throw new IdentityProviderUnavailableError('Identity provider returned invalid JSON', {
          cause: error,
        });
      }
      const identity = unwrapIdentity(payload);
      const uid = identity === null ? null : stringField(identity, 'uid');
      if (identity === null || uid === null) return null;

      // A coarse main-site role is intentionally normalized to the development
      // platform's non-elevated base role. It never grants platform permissions.
      return {
        uid,
        username: stringField(identity, 'username'),
        studentId: stringField(identity, 'studentId', 'student_id'),
        displayName:
          stringField(identity, 'fullName', 'displayName', 'nickname', 'name', 'username') ?? uid,
        avatarUrl: stringField(identity, 'avatarPath', 'avatarUrl', 'avatar'),
        baseRole: 'student',
        roles: [],
        tags: [],
        mainSiteAdmin: identity.isAdmin === true,
      };
    } catch (error) {
      if (error instanceof IdentityProviderUnavailableError) throw error;
      throw new IdentityProviderUnavailableError('Identity provider request failed', {
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
