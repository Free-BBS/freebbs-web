import type { DevelopmentStore } from '../database/types.js';

export interface AuditEvent {
  actorUid: string;
  action: string;
  resourceType: string;
  resourceId: string;
  details?: Record<string, unknown>;
}

export async function recordAuditEvent(store: DevelopmentStore, event: AuditEvent) {
  return store.auditLogs.create({
    actorUid: event.actorUid,
    action: event.action,
    resourceType: event.resourceType,
    resourceId: event.resourceId,
    details: event.details ?? {},
    status: 'recorded',
    ownerUid: event.actorUid,
    scope: { type: 'public', id: '*' },
  });
}
