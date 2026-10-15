import { createHash } from 'node:crypto';
import type { MapBindingRequest, MapConnectionStatus } from '@freebbs-development/contracts';
import { featureStorage } from '../../core/database/feature-storage.js';

export interface StoredBinding extends MapBindingRequest {
  uid: string;
  createdAt: string;
  subjectHash?: string;
}
export interface StoredConnection {
  subjectHash: string;
  /** Immutable original owner, including after unlink. */
  uid: string;
  linked: boolean;
  publicId: string;
  lastSyncedAt?: string;
}
export interface BindingState {
  id: string;
  requests: StoredBinding[];
  connections: StoredConnection[];
}
export const BINDING_STATE_ID = 'global';
export function bindingStorage(directory: string) {
  return featureStorage<BindingState>(directory, 'map-bindings');
}
export function emptyBindingState(): BindingState {
  return { id: BINDING_STATE_ID, requests: [], connections: [] };
}
export function subjectDigest(subject: string): string {
  return createHash('sha256').update(subject).digest('hex');
}
export function evidenceId(subjectHash: string, sourceId: string): string {
  return `map:${createHash('sha256')
    .update(JSON.stringify([subjectHash, sourceId]))
    .digest('hex')}`;
}
export function requestStatus(binding: StoredBinding, now: Date): MapBindingRequest['status'] {
  if (
    (binding.status === 'pending' || binding.status === 'claimed') &&
    Date.parse(binding.expiresAt) <= now.getTime()
  )
    return 'expired';
  return binding.status;
}
export function publicBinding(binding: StoredBinding, now: Date): MapBindingRequest {
  return {
    id: binding.id,
    code: binding.code,
    expiresAt: binding.expiresAt,
    status: requestStatus(binding, now),
    ...(binding.publicId ? { publicId: binding.publicId } : {}),
  };
}
export function connectionStatus(state: BindingState, uid: string, now: Date): MapConnectionStatus {
  const connection = state.connections.find((value) => value.uid === uid && value.linked);
  const pending = [...state.requests]
    .reverse()
    .find((value) => value.uid === uid && value.status !== 'confirmed');
  return {
    configured: true,
    linked: Boolean(connection),
    ...(connection
      ? {
          publicId: connection.publicId,
          ...(connection.lastSyncedAt ? { lastSyncedAt: connection.lastSyncedAt } : {}),
        }
      : {}),
    ...(!connection && pending ? { pending: publicBinding(pending, now) } : {}),
  };
}
export async function readMapConnection(
  directory: string,
  uid: string,
  configured: boolean,
): Promise<MapConnectionStatus> {
  if (!configured) return { configured: false, linked: false };
  return connectionStatus(
    (await bindingStorage(directory).get(BINDING_STATE_ID)) ?? emptyBindingState(),
    uid,
    new Date(),
  );
}
