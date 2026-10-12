export type CollaborationKind =
  'availability' | 'booking' | 'shared_table' | 'practice' | 'attendance' | 'review' | 'materials';
export interface CollaborationColumn {
  id: string;
  label: string;
  kind: 'text' | 'number' | 'date' | 'choice';
  required: boolean;
  editRoleKeys?: string[];
  options?: string[];
}
export interface CollaborationSlot {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
}
export interface CollaborationEntry {
  id: string;
  uid: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
  values: Record<string, string | number | boolean>;
  choices: string[];
  resource: string;
  startsAt: string;
  endsAt: string;
  text: string;
  assignedSlot: string | null;
  assignmentStatus?: 'pending' | 'accepted' | 'declined';
  canReview?: boolean;
  stage: number;
  reviewStatus: 'pending' | 'approved' | 'rejected';
  decisions: Array<{
    uid: string;
    stage: number;
    decision: 'approved' | 'rejected';
    note: string;
    at: string;
  }>;
  files: Array<{ id: string; name: string; bytes: number }>;
}
export interface CollaborationSpace {
  id: string;
  kind: CollaborationKind;
  title: string;
  description: string;
  ownerUid: string;
  departmentId: string | null;
  teamId?: string | null;
  audience: 'all' | 'department';
  status: 'draft' | 'published' | 'closed';
  revision: number;
  createdAt: string;
  updatedAt: string;
  columns: CollaborationColumn[];
  slots: CollaborationSlot[];
  stages: Array<{ title: string; roleKeys: string[] }>;
  entries: CollaborationEntry[];
  history: Array<{ uid: string; at: string; action: string; entryId?: string }>;
  expectedReporterUids?: string[];
  canManage?: boolean;
  aggregates?: Record<string, number>;
  /** Shared booking availability contains no participant identity or private entry data. */
  bookingOccupancy?: Array<{ resource: string; startsAt: string; endsAt: string }>;
}
