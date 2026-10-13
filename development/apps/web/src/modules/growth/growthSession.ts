import type { ApiClient } from '../../core/api/client.js';

export type GrowthClient = Pick<ApiClient, 'request'> & Partial<Pick<ApiClient, 'previewUser'>>;
const clientIds = new WeakMap<GrowthClient, number>();
let nextClientId = 0;

// The transport is part of the session: a replacement client must retire pending reads and writes.
export function growthSessionKey(client: GrowthClient, uid: string): string {
  if (!clientIds.has(client)) clientIds.set(client, ++nextClientId);
  return `${clientIds.get(client)}:${uid}`;
}
