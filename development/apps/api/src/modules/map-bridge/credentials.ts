import { createHash, timingSafeEqual } from 'node:crypto';

/** The verifier is server configuration, never a bearer credential. */
export function resolveMapTokenDigest(environment: NodeJS.ProcessEnv): Buffer | null {
  const token = environment.DEVELOPMENT_MAP_INGEST_TOKEN?.trim();
  if (token) return createHash('sha256').update(token).digest();
  const digest = environment.DEVELOPMENT_MAP_TOKEN_SHA256;
  return digest && /^[a-fA-F0-9]{64}$/.test(digest) ? Buffer.from(digest, 'hex') : null;
}

export function matchesMapBearer(
  authorization: string | undefined,
  digest: Buffer | null,
): boolean {
  const supplied = /^Bearer ([^\s]+)$/i.exec(authorization ?? '')?.[1];
  return Boolean(
    supplied && digest && timingSafeEqual(createHash('sha256').update(supplied).digest(), digest),
  );
}
