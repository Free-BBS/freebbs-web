/** A roster row has its own stable identity; equal display names are not merged. */
export interface OrganizationGroupRosterMember {
  id: string;
  displayName: string;
  studentId?: string;
}

export interface OrganizationGroupRosterMemberInput {
  /** Omit only for a new row. Retain IDs from GET when editing an existing roster. */
  id?: string;
  displayName: string;
  /** Optional; an empty string removes the previously supplied student ID. */
  studentId?: string;
}

export interface OrganizationGroupRosterSnapshot {
  revision: number;
  members: OrganizationGroupRosterMember[];
  updatedAt: string;
}

export interface OrganizationGroupClassRoster {
  classId: string;
  /** Zero means no roster has been saved for this configured class yet. */
  revision: number;
  members: OrganizationGroupRosterMember[];
  updatedAt: string | null;
  canEdit: boolean;
  canImport: boolean;
}

export interface OrganizationGroupRosterUpdate {
  revision: number;
  members: OrganizationGroupRosterMemberInput[];
}

export interface OrganizationGroupRosterImport {
  /** One atomic replacement per configured class; every revision must still match. */
  batches: Array<OrganizationGroupRosterUpdate & { classId: string }>;
}

export interface OrganizationGroupRosterImportResult {
  items: OrganizationGroupClassRoster[];
}

export interface OrganizationGroupRosterHistory {
  classId: string;
  /** All committed versions, including the current version, in revision order. */
  items: OrganizationGroupRosterSnapshot[];
}
