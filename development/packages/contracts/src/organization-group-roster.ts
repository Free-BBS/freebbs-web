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

export type OrganizationGroupRosterImportMode = 'append' | 'replace';

/** A read-only Excel preview. Confirmation uses the existing atomic JSON import endpoint. */
export interface OrganizationGroupRosterExcelPreview {
  mode: OrganizationGroupRosterImportMode;
  sheetName: string;
  rowCount: number;
  warnings: string[];
  classes: Array<{
    classId: string;
    classLabel: string;
    revision: number;
    beforeCount: number;
    afterCount: number;
    added: OrganizationGroupRosterMemberInput[];
    updated: Array<{
      before: OrganizationGroupRosterMember;
      after: OrganizationGroupRosterMemberInput;
    }>;
    removed: OrganizationGroupRosterMember[];
    unchangedCount: number;
  }>;
  /** Contains changed classes only. Empty means the workbook would make no changes. */
  batches: OrganizationGroupRosterImport['batches'];
}
