import type { UserContext } from '@freebbs-development/contracts';

export interface AuthClient {
  introspect(token: string): Promise<UserContext | null>;
}

export class IdentityProviderUnavailableError extends Error {
  override readonly name = 'IdentityProviderUnavailableError';

  constructor(message = 'Identity provider unavailable', options?: ErrorOptions) {
    super(message, options);
  }
}
