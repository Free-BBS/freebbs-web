/** Six financial work ports plus a separate department-wide public budget classification. */
export const FINANCE_PORTS = [
  { id: 'youth_league', name: '团委' },
  { id: 'student_union', name: '学生会' },
  { id: 'science_association', name: '科协' },
  { id: 'media_center', name: '媒体中心' },
  { id: 'sports', name: '体育+代表队' },
  { id: 'bbs', name: 'BBS' },
  { id: 'department_common', name: '系级公共' },
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
  /** Optional review restriction. Listed users still need current final-reviewer authority. */
  reviewPolicy?: { reviewerUids: string[] };
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
  workflowGuides?: FinanceWorkflowGuide[];
}
export interface FinanceProcessPerson {
  name: string;
  employeeNumber: string;
}
export interface FinanceWorkflowGuide {
  portId: FinancePortId;
  financeOfficer?: FinanceProcessPerson;
  workPortLead?: FinanceProcessPerson;
  counselors: FinanceProcessPerson[];
  teacher?: FinanceProcessPerson;
  reimbursementSteps: string[];
  directPaymentSteps: string[];
  instructionFileId?: string;
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
  | 'draft'
  | 'department_review'
  | 'initial_approved'
  | 'school_review'
  | 'received'
  | 'returned'
  | 'withdrawn';
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
  invoiceLines?: FinanceInvoiceLine[];
  checklist?: string[];
  directPayment?: FinanceDirectPaymentDetails;
}
export const FINANCE_INVOICE_CATEGORIES = [
  { id: 'activity_materials', name: '活动材料' },
  { id: 'distributed_goods', name: '下发物资' },
  { id: 'rental_service', name: '租赁/服务' },
  { id: 'department_asset', name: '系内资产' },
  { id: 'venue', name: '场地' },
  { id: 'other', name: '其他' },
] as const;
export interface FinanceInvoiceLine {
  category: (typeof FINANCE_INVOICE_CATEGORIES)[number]['id'];
  amountCents: number;
  repeatCount: number;
  description?: string;
}
export interface FinanceDirectPaymentDetails {
  hourlyRateCents: number;
  workContent: string;
  proofFileIds: string[];
}
export interface FinanceChecklistItem {
  key: string;
  label: string;
}
/** Completion means materials are ready and the upcoming route is understood, not future approvals. */
export function financeClaimChecklist(
  input: Pick<FinanceClaimInput, 'kind' | 'invoiceLines'>,
  guide?: FinanceWorkflowGuide,
): FinanceChecklistItem[] {
  const items: FinanceChecklistItem[] = [
    { key: 'payee_confirmed', label: '已核对收款人姓名及学号' },
    { key: 'approval_route_acknowledged', label: '已了解本笔款项的办理与审批路线' },
  ];
  if (input.kind === 'reimbursement') {
    items.push({ key: 'invoice_materials_ready', label: '已准备本次报销的发票及相关材料' });
    items.push({
      key: 'school_authorization_acknowledged',
      label: '已按指引核对学校系统录入及授权经费负责人的操作',
    });
    if (input.invoiceLines?.some((line) => line.amountCents > 100000))
      items.push({ key: 'payment_screenshot_ready', label: '超过1000元的发票已准备支付截图' });
    if (input.invoiceLines?.some((line) => line.category === 'distributed_goods'))
      items.push({ key: 'distribution_list_ready', label: '下发物资已准备领用清单' });
  } else items.push({ key: 'work_proof_ready', label: '已核对代发金额、时薪、工作内容及工作证明' });
  const steps =
    input.kind === 'reimbursement' ? guide?.reimbursementSteps : guide?.directPaymentSteps;
  steps?.forEach((label, index) => {
    let hash = 2166136261;
    for (const character of label) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    items.push({
      key: `guide_step_${index}_${(hash >>> 0).toString(36)}`,
      label: `已了解：${label}`,
    });
  });
  return items;
}
export function financeClaimWarnings(
  input: Pick<FinanceClaimInput, 'kind' | 'invoiceLines'>,
): string[] {
  return input.kind === 'reimbursement' &&
    input.invoiceLines?.some((line) => line.amountCents > 500000 && line.category !== 'venue')
    ? ['单张金额超过5,000元，请先与团委辅导员确认开票及办理要求']
    : [];
}
export function financeWorkflowPort(department: FinanceDepartment): FinancePortId {
  return department.id === 'student_union.sports_center' ? 'student_union' : department.portId;
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
  workflowVersion?: 2;
  initialApprovedAt?: string | null;
  counselorFinancialApprovedAt?: string | null;
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
  memberProjectIds?: string[];
}
export interface FinanceClaimView extends FinanceTrackingClaim {
  allowedActions: FinanceClaimAction[];
  canEdit: boolean;
}
export interface FinanceTrackingPayload {
  configured: boolean;
  canManageBudget: boolean;
  /** False when omitted by an older API. Review restrictions are configurable only by root admins. */
  canManageReviewPolicies?: boolean;
  ownerUid: string | null;
  departments: FinanceDepartment[];
  submittableDepartmentIds: string[];
  projects: FinanceBudgetSummary[];
  claims: FinanceClaimView[];
  settings: FinanceTrackingSettings | null;
  workflowGuides?: FinanceWorkflowGuide[];
}
