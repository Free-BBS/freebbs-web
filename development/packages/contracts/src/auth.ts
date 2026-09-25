import type { RoleKey } from './modules.js';
import type { PermissionTag } from './permissions.js';

export type BaseRole = 'student';

export interface UserContext {
  uid: string;
  displayName: string;
  avatarUrl: string | null;
  username?: string | null;
  studentId?: string | null;
  baseRole: BaseRole;
  roles: RoleKey[];
  tags: PermissionTag[];
  readonly mainSiteAdmin?: boolean;
  developmentAccess?: 'member' | 'lead';
  viewer?: {
    uid: string;
    displayName: string;
    canManageDevelopment: boolean;
  };
  previewing?: boolean;
}

export interface ApiEnvelope<T> {
  data: T;
  requestId: string;
}
