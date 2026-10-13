import { randomUUID } from 'node:crypto';
import type {
  AdminAuditLog,
  DevelopmentNotification,
  SystemSettingsNotificationHistory,
  SystemSettingsOrganizations,
  SystemSettingsRewardHistory,
  UserContext,
} from '@freebbs-development/contracts';
import { featureStorage } from '../../core/database/feature-storage.js';

export interface SavedNotification extends SystemSettingsNotificationHistory {
  fingerprint: string;
  reads: Record<string, string>;
}
export interface SavedReward extends SystemSettingsRewardHistory {
  fingerprint: string;
}
export interface SettingsState {
  id: string;
  organizations: SystemSettingsOrganizations | null;
  notifications: SavedNotification[];
  rewards: SavedReward[];
  audits: AdminAuditLog[];
}
export function systemSettingsStorage(root: string) {
  const storage = featureStorage<SettingsState>(root, 'system-settings');
  const empty = (): SettingsState => ({
    id: 'state',
    organizations: null,
    notifications: [],
    rewards: [],
    audits: [],
  });
  return {
    read: async () => (await storage.get('state')) ?? empty(),
    change: <T>(operation: (state: SettingsState) => T | Promise<T>) =>
      storage.change('state', async (saved) => {
        const record = saved ?? empty();
        const result = await operation(record);
        return { record, result };
      }),
  };
}
export function appendFeatureAudit(
  state: SettingsState,
  actor: UserContext,
  action: string,
  resourceType: string,
  resourceId: string,
  previous: unknown,
  next: unknown,
) {
  const now = new Date().toISOString();
  state.audits.unshift({
    id: randomUUID(),
    actorUid: actor.uid,
    action,
    resourceType,
    resourceId,
    details: { previous, next },
    status: 'active',
    ownerUid: actor.uid,
    scope: { type: 'public', id: '*' },
    createdAt: now,
    updatedAt: now,
  });
}
export function ownInbox(state: SettingsState, uid: string): DevelopmentNotification[] {
  return state.notifications
    .filter((notice) => notice.recipients.some((recipient) => recipient.uid === uid))
    .map((notice) => ({
      id: notice.id,
      kind: notice.kind,
      title: notice.title,
      body: notice.body,
      link: notice.link,
      authorUid: notice.authorUid,
      authorDisplayName: notice.authorDisplayName,
      createdAt: notice.createdAt,
      readAt: notice.reads[uid] ?? null,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}
