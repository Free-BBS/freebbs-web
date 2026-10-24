/** Independent of legacy social-organization IDs: financial responsibility has six ports. */
export const FINANCE_PORTS = [
  { id: 'youth_league', name: '团委' },
  { id: 'student_union', name: '学生会' },
  { id: 'science_association', name: '科协' },
  { id: 'media_center', name: '媒体中心' },
  { id: 'sports', name: '体育+代表队' },
  { id: 'bbs', name: 'BBS' },
] as const;
export type FinancePortId = (typeof FINANCE_PORTS)[number]['id'];
export type FinanceTrackingRole =
  'department' | 'organization_viewer' | 'finance_officer' | 'counselor' | 'teacher';
export interface FinanceDepartment {
  id: string;
  name: string;
  portId: FinancePortId;
  /** Existing shared sports-team identifier; names never confer financial authority. */
  teamId?: string;
}
export interface FinanceGrant {
  uid: string;
  displayName: string;
  role: FinanceTrackingRole;
  departmentIds: string[];
  portIds: FinancePortId[];
}
export interface FinanceTrackingSettings {
  revision: number;
  departments: FinanceDepartment[];
  grants: FinanceGrant[];
}
export interface FinanceBudgetInput {
  year: string;
  departmentId: string;
  code: string;
  name: string;
  reimbursementCents: number;
  directPaymentCents: number;
  notes: string;
}
export interface FinanceBudgetProject extends FinanceBudgetInput {
  id: string;
  revision: number;
  updatedAt: string;
}
export type FinancePaymentKind = 'reimbursement' | 'direct_payment';
export type FinanceClaimStatus =
  'draft' | 'department_review' | 'school_review' | 'received' | 'returned' | 'withdrawn';
export type FinanceClaimAction =
  | 'submit'
  | 'approve'
  | 'return'
  | 'withdraw'
  | 'record_school_submission'
  | 'record_teacher_approval'
  | 'confirm_received';
export interface FinanceClaimInput {
  projectId: string;
  kind: FinancePaymentKind;
  items: { description: string; quantity: string }[];
  amountCents: number;
  payeeName: string;
  payeeStudentId: string;
  materials: string[];
  externalReference: string;
  externalSubmittedAt: string;
  notes: string;
}
export interface FinanceClaimEvent {
  action: FinanceClaimAction | 'create' | 'edit';
  from: FinanceClaimStatus | null;
  to: FinanceClaimStatus;
  at: string;
  actorUid: string;
  actorDisplayName: string;
  note: string;
}
export interface FinanceTrackingClaim extends FinanceClaimInput {
  id: string;
  departmentId: string;
  status: FinanceClaimStatus;
  submitterUid: string;
  submitterDisplayName: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  history: FinanceClaimEvent[];
  schoolSubmittedAt: string | null;
  teacherApprovedAt: string | null;
}
/** Each cent is counted in exactly one stage. Returned/withdrawn/draft do not reserve budget. */
export interface FinanceChannelBalance {
  allocatedCents: number;
  departmentReviewCents: number;
  schoolReviewCents: number;
  receivedCents: number;
  remainingCents: number;
  overBudget: boolean;
}
export interface FinanceBudgetSummary extends FinanceBudgetProject {
  reimbursement: FinanceChannelBalance;
  directPayment: FinanceChannelBalance;
}
export interface FinanceClaimView extends FinanceTrackingClaim {
  allowedActions: FinanceClaimAction[];
  canEdit: boolean;
}
export interface FinanceTrackingPayload {
  configured: boolean;
  canManageBudget: boolean;
  ownerUid: string | null;
  departments: FinanceDepartment[];
  submittableDepartmentIds: string[];
  projects: FinanceBudgetSummary[];
  claims: FinanceClaimView[];
  settings: FinanceTrackingSettings | null;
}
