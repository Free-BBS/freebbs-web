import type { ModuleId, ModuleManifest, RoleKey } from './modules.js';
import type { PermissionAction, ScopeRef } from './permissions.js';

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
export interface AdminRecord {
  id: string;
  status: string;
  ownerUid: string;
  scope: ScopeRef;
  createdAt: string;
  updatedAt: string;
}
export interface AdminSubject extends AdminRecord {
  uid: string;
  displayName: string;
  avatarUrl: string | null;
}
export interface AdminRole extends AdminRecord {
  key: RoleKey;
  name: string;
}
export interface AdminPermission extends AdminRecord {
  action: PermissionAction;
  resource: string;
}
export interface AdminPermissionBinding extends AdminRecord {
  roleKey?: RoleKey;
  tagKey?: string;
  action: PermissionAction;
  resource: string;
  effect: 'allow' | 'deny';
}
export interface AdminRoleAssignment extends AdminRecord {
  subjectUid: string;
  roleKey: RoleKey;
  expiresAt: string | null;
}
export interface AdminTagDefinition extends AdminRecord {
  key: string;
  name: string;
  description: string;
  requiredScopeType: string | null;
  metadata: Record<string, unknown>;
}
export interface AdminTagAssignment extends AdminRecord {
  subjectUid: string;
  tagKey: string;
  expiresAt: string | null;
}
export interface AdminModuleOwner extends AdminRecord {
  moduleId: ModuleId;
  ownerType: 'role' | 'subject' | 'team';
  ownerId: string;
}
export interface AdminAuditLog extends AdminRecord {
  actorUid: string;
  action: string;
  resourceType: string;
  resourceId: string;
  details: Record<string, unknown>;
}
export interface AdminSystemStatus {
  version: string;
  dataMode: 'memory' | 'mysql';
  appliedMigrationCount: number;
  moduleCounts: { total: number; enabled: number; disabled: number };
}
export interface AdminListQuery {
  query?: string;
  status?: string;
  scopeType?: string;
  scopeId?: string;
  page?: number;
  pageSize?: number;
}
export interface AdminAuditQuery {
  actorUid?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}
export interface CreateRoleAssignmentInput {
  subjectUid: string;
  roleKey: RoleKey;
  expiresAt?: string | null;
  scope?: ScopeRef;
}
export interface CreateTagAssignmentInput {
  subjectUid: string;
  tagKey: string;
  expiresAt?: string | null;
  scope?: ScopeRef;
}
export interface ArchiveAssignmentResponse {
  id: string;
  status: string;
  archived: true;
}
export interface RoleStatusPatch {
  status: 'active' | 'inactive';
}
export interface PermissionBindingInput {
  action: PermissionAction;
  resource: string;
  effect: 'allow' | 'deny';
  scope: ScopeRef;
}
export interface ReplacePermissionBindingsInput {
  bindings: PermissionBindingInput[];
}
export interface ReplaceRolePermissionsResponse {
  roleKey: RoleKey;
  bindings: AdminPermissionBinding[];
}
export interface CreateTagDefinitionInput {
  key: string;
  name: string;
  description: string;
  requiredScopeType: string | null;
  metadata: Record<string, unknown>;
}
export type PatchTagDefinitionInput = Partial<CreateTagDefinitionInput> & {
  status?: 'active' | 'inactive';
};
export interface ReplaceTagPermissionsResponse {
  tagKey: string;
  bindings: AdminPermissionBinding[];
}
export interface ModuleStatusPatch {
  moduleId: ModuleId;
  enabled: boolean;
}
export interface ModuleOwnerInput {
  ownerType: AdminModuleOwner['ownerType'];
  ownerId: string;
}
export interface ReplaceModuleOwnersInput {
  owners: ModuleOwnerInput[];
}
export interface ModuleOwnersResponse {
  moduleId: ModuleId;
  owners: AdminModuleOwner[];
}
export type AdminModule = ModuleManifest;
