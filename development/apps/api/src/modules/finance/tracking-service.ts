import { createHash, randomUUID } from 'node:crypto';
import type {
  FinanceBudgetInput,
  FinanceBudgetProject,
  FinanceBudgetSummary,
  FinanceChannelBalance,
  FinanceClaimAction,
  FinanceClaimInput,
  FinanceClaimStatus,
  FinanceClaimView,
  FinanceDepartment,
  FinanceTrackingClaim,
  FinanceTrackingPayload,
  FinanceTrackingSettings,
  FinanceWorkflowGuide,
  FinanceImportPreview,
  FinanceImportEntry,
  FinanceImportCommitResult,
  UserContext,
} from '@freebbs-development/contracts';
import {
  financeClaimChecklist,
  financeBudgetPools,
  financeBudgetPoolOverlaps,
  financeBudgetPoolCode,
  financeWorkflowPort,
  FINANCE_INVOICE_CATEGORIES,
  FINANCE_MATERIAL_SITUATIONS,
} from '@freebbs-development/contracts';
import { featureStorage } from '../../core/database/feature-storage.js';
import { normalizeFinancePilotUids } from '../../config/finance-pilot.js';
import { HttpError } from '../../core/errors/http-error.js';
import { parseFinanceBudgetWorkbook, type FinanceImportParseOptions } from './import-parser.js';
import { financeDepartmentAccess, isFinanceFinalReviewer } from './shared-access.js';
import {
  FinancePrivateFileStore,
  type FinanceFilePurpose,
  type FinancePrivateFileMetadata,
} from './private-files.js';

export interface FinanceTrackingServiceOptions {
  directory?: string;
  authMode?: 'main' | 'demo';
  nodeEnvironment?: string;
  defaultDepartments?: FinanceDepartment[];
  /** Optional deployment trial gate; membership narrows, but never grants, financial authority. */
  pilotUids?: readonly string[];
  getSharedTeams?: () => Promise<readonly { id: string; name: string; status: string }[]>;
}
interface FinanceAudit {
  id: string;
  at: string;
  actorUid: string;
  action: string;
  resourceId: string;
  before: unknown;
  after: unknown;
}
interface CreationReceipt {
  actorUid: string;
  requestId: string;
  kind: 'project' | 'claim';
  digest: string;
  resourceId: string;
}
interface FinanceLedger {
  id: string;
  settings: FinanceTrackingSettings;
  projects: FinanceBudgetProject[];
  claims: FinanceTrackingClaim[];
  audit: FinanceAudit[];
  receipts: CreationReceipt[];
  importReceipts?: {
    previewId: string;
    actorUid: string;
    summary: FinanceImportCommitResult['summary'];
  }[];
}
interface StoredImport {
  id: string;
  actorUid: string;
  settingsRevision: number;
  digest: string;
  preview: FinanceImportPreview;
}
const budgetValue = (project: FinanceBudgetInput): FinanceBudgetInput => ({
  year: project.year,
  departmentId: project.departmentId,
  code: project.code,
  name: project.name,
  reimbursementCents: project.reimbursementCents,
  directPaymentCents: project.directPaymentCents,
  notes: project.notes,
});
const LEDGER_ID = 'finance-tracking';
const RESERVED: readonly FinanceClaimStatus[] = [
  'department_review',
  'initial_approved',
  'school_review',
  'received',
];
function fail(status: number, code: string, message: string): never {
  throw new HttpError(status, code, message);
}
function conflict(): never {
  return fail(409, 'finance_revision_conflict', '资料已被更新，请刷新后重试');
}
function forbidden(): never {
  return fail(403, 'finance_forbidden', '没有该财务操作的权限');
}
function snapshot<T>(value: T): T {
  return structuredClone(value);
}
function sum(a: number, b: number): number {
  const result = a + b;
  if (!Number.isSafeInteger(result))
    fail(400, 'finance_amount_too_large', '金额合计超过可处理范围');
  return result;
}
function balance(allocatedCents: number): FinanceChannelBalance {
  return {
    allocatedCents,
    departmentReviewCents: 0,
    schoolReviewCents: 0,
    receivedCents: 0,
    remainingCents: allocatedCents,
    overBudget: false,
  };
}
function summarize(
  project: FinanceBudgetProject & { memberProjectIds?: string[] },
  claims: FinanceTrackingClaim[],
): FinanceBudgetSummary {
  const reimbursement = balance(project.reimbursementCents);
  const directPayment = balance(project.directPaymentCents);
  for (const claim of claims) {
    if (
      !(project.memberProjectIds ?? [project.id]).includes(claim.projectId) ||
      !RESERVED.includes(claim.status)
    )
      continue;
    const channel = claim.kind === 'reimbursement' ? reimbursement : directPayment;
    if (claim.status === 'department_review' || claim.status === 'initial_approved')
      channel.departmentReviewCents = sum(channel.departmentReviewCents, claim.amountCents);
    if (claim.status === 'school_review')
      channel.schoolReviewCents = sum(channel.schoolReviewCents, claim.amountCents);
    if (claim.status === 'received')
      channel.receivedCents = sum(channel.receivedCents, claim.amountCents);
    channel.remainingCents = sum(channel.remainingCents, -claim.amountCents);
    channel.overBudget = channel.remainingCents < 0;
  }
  return { ...project, reimbursement, directPayment };
}

/** A single atomic ledger makes permissions, reservations and each audit one transaction. */
export class FinanceTrackingService {
  private readonly storage;
  private readonly importStorage;
  private readonly pilotUids: ReadonlySet<string> | undefined;
  readonly privateFileStore: FinancePrivateFileStore | null;

  constructor(private readonly options: FinanceTrackingServiceOptions) {
    const pilotUids = normalizeFinancePilotUids(options.pilotUids);
    this.pilotUids = pilotUids === undefined ? undefined : new Set(pilotUids);
    this.storage = options.directory
      ? featureStorage<FinanceLedger>(options.directory, 'finance-tracking')
      : null;
    this.importStorage = options.directory
      ? featureStorage<StoredImport>(options.directory, 'finance-imports')
      : null;
    this.privateFileStore = options.directory
      ? new FinancePrivateFileStore(options.directory)
      : null;
  }

  private normalizeState(state: FinanceLedger, persisting = false): FinanceLedger {
    const legacy = state.claims
      .filter((claim) => claim.workflowVersion !== 2)
      .map(({ id, status }) => ({ id, status }));
    state.claims = state.claims.map((claim) =>
      claim.workflowVersion === 2
        ? claim
        : {
            ...claim,
            workflowVersion: 2 as const,
            // Legacy "school_review" meant BBS approval, not counselor approval in school finance.
            status: claim.status === 'school_review' ? 'initial_approved' : claim.status,
            initialApprovedAt:
              claim.status === 'school_review' || claim.status === 'received'
                ? claim.updatedAt
                : null,
            counselorFinancialApprovedAt: null,
          },
    );
    if (persisting && legacy.length)
      state.audit.push({
        id: randomUUID(),
        at: new Date().toISOString(),
        actorUid: 'system:finance-workflow-v2',
        action: 'workflow.compat_v2',
        resourceId: LEDGER_ID,
        before: legacy,
        after: state.claims
          .filter((claim) => legacy.some((previous) => previous.id === claim.id))
          .map(({ id, status }) => ({ id, status })),
      });
    return state;
  }

  assertActualAccess(actor: UserContext): void {
    this.requireActualIdentity(actor);
    if (!this.storage) fail(503, 'finance_not_configured', '尚未配置财务私有存储目录');
  }

  async assertCanUploadFile(actor: UserContext, purpose: FinanceFilePurpose): Promise<void> {
    this.assertActualAccess(actor);
    const state = (await this.storage!.get(LEDGER_ID)) ?? this.initial();
    if (purpose === 'instruction') {
      if (!this.isChief(actor)) forbidden();
      return;
    }
    if (
      !this.isChief(actor) &&
      !state.settings.departments.some(({ id }) => this.canSubmit(state, actor, id))
    )
      forbidden();
  }

  async authorizeFileRead(actor: UserContext, file: FinancePrivateFileMetadata): Promise<void> {
    this.assertActualAccess(actor);
    const state = this.normalizeState((await this.storage!.get(LEDGER_ID)) ?? this.initial());
    if (file.purpose === 'instruction') {
      if (file.ownerUid === actor.uid || this.isChief(actor)) return;
      const visiblePorts = new Set(
        state.settings.departments
          .filter(({ id }) => this.readable(state, actor, id))
          .map(financeWorkflowPort),
      );
      if (
        state.settings.workflowGuides?.some(
          (guide) => guide.instructionFileId === file.id && visiblePorts.has(guide.portId),
        )
      )
        return;
    } else {
      const boundClaims = state.claims.filter((claim) =>
        claim.directPayment?.proofFileIds.includes(file.id),
      );
      if (
        boundClaims.length
          ? boundClaims.some((claim) => this.claimReadable(state, actor, claim))
          : file.ownerUid === actor.uid
      )
        return;
    }
    fail(404, 'finance_file_missing', '文件不存在或不可查看');
  }

  private guideFor(state: FinanceLedger, departmentId: string): FinanceWorkflowGuide | undefined {
    const department = state.settings.departments.find(({ id }) => id === departmentId);
    return department
      ? state.settings.workflowGuides?.find(
          (guide) => guide.portId === financeWorkflowPort(department),
        )
      : undefined;
  }

  private normalizedClaimInput(input: FinanceClaimInput): FinanceClaimInput {
    const result = snapshot(input);
    if (
      input.materialSituations !== undefined &&
      (!Array.isArray(input.materialSituations) ||
        input.materialSituations.length > FINANCE_MATERIAL_SITUATIONS.length ||
        input.materialSituations.some(
          (situation) => !FINANCE_MATERIAL_SITUATIONS.some(({ id }) => id === situation),
        ))
    )
      fail(400, 'finance_material_situations_invalid', '请检查报销材料的适用情况');
    result.materialSituations =
      input.kind === 'reimbursement'
        ? FINANCE_MATERIAL_SITUATIONS.filter(({ id }) =>
            input.materialSituations?.includes(id),
          ).map(({ id }) => id)
        : undefined;
    if (input.kind === 'reimbursement') delete result.directPayment;
    if (input.kind === 'reimbursement' && input.invoiceLines !== undefined) {
      if (input.invoiceLines.length > 100)
        fail(400, 'finance_invoice_limit', '发票信息最多填写100行');
      let amount = 0;
      for (const line of input.invoiceLines) {
        if (
          !FINANCE_INVOICE_CATEGORIES.some(({ id }) => id === line.category) ||
          !Number.isSafeInteger(line.amountCents) ||
          line.amountCents < 0 ||
          !Number.isSafeInteger(line.repeatCount) ||
          line.repeatCount < 1 ||
          line.repeatCount > 1000
        )
          fail(400, 'finance_invoice_invalid', '请检查发票类别、整张金额和重复张数');
        amount = sum(amount, line.amountCents * line.repeatCount);
      }
      result.amountCents = amount;
      result.items = input.invoiceLines.map((line) => ({
        description:
          line.description?.trim() ||
          FINANCE_INVOICE_CATEGORIES.find(({ id }) => id === line.category)!.name,
        quantity: `${line.repeatCount} 张`,
      }));
      delete result.directPayment;
    } else if (input.kind === 'direct_payment') {
      if (
        input.directPayment &&
        (!Number.isSafeInteger(input.directPayment.hourlyRateCents) ||
          input.directPayment.hourlyRateCents < 0 ||
          input.directPayment.proofFileIds.length > 5)
      )
        fail(400, 'finance_direct_payment_invalid', '请检查时薪和工作证明数量');
      result.items = [
        { description: (input.directPayment?.workContent ?? '').slice(0, 500), quantity: '' },
      ];
      delete result.invoiceLines;
    }
    return result;
  }

  private validateSubmission(state: FinanceLedger, claim: FinanceTrackingClaim): void {
    const project = state.projects.find(({ id }) => id === claim.projectId);
    const allocated =
      claim.kind === 'reimbursement' ? project?.reimbursementCents : project?.directPaymentCents;
    // The positive allowance is checked for the entire numbered pool, including historic members.
    const pool = financeBudgetPools(state.projects).find((p) =>
      p.memberProjectIds.includes(claim.projectId),
    );
    const poolAllowance =
      claim.kind === 'reimbursement' ? pool?.reimbursementCents : pool?.directPaymentCents;
    if ((poolAllowance ?? allocated ?? 0) <= 0)
      fail(400, 'finance_channel_unavailable', '本项目没有该类款项的批准额度');
    if (
      !Number.isSafeInteger(claim.amountCents) ||
      claim.amountCents <= 0 ||
      !claim.payeeName.trim() ||
      !claim.payeeStudentId.trim()
    )
      fail(400, 'finance_claim_incomplete', '请填写金额、收款人姓名和学号');
    if (claim.kind === 'reimbursement') {
      if (!claim.invoiceLines?.length || claim.invoiceLines.some((line) => line.amountCents <= 0))
        fail(400, 'finance_invoice_required', '请填写至少一张发票的类别、整张金额及重复张数');
    } else if (
      !claim.directPayment ||
      claim.directPayment.hourlyRateCents <= 0 ||
      !claim.directPayment.workContent.trim() ||
      !claim.directPayment.proofFileIds.length
    )
      fail(400, 'finance_direct_payment_incomplete', '请填写时薪、工作内容并上传工作证明');
    const completed = new Set(claim.checklist ?? []);
    if (
      financeClaimChecklist(claim, this.guideFor(state, claim.departmentId)).some(
        ({ key }) => !completed.has(key),
      )
    )
      fail(400, 'finance_checklist_incomplete', '请完成材料清单和办理流程确认后再提交');
  }

  private initial(): FinanceLedger {
    return {
      id: LEDGER_ID,
      settings: {
        revision: 1,
        departments: snapshot(this.options.defaultDepartments ?? []),
        grants: [],
      },
      projects: [],
      claims: [],
      audit: [],
      receipts: [],
    };
  }

  private async synchronizeSharedTeams(): Promise<void> {
    if (!this.storage || !this.options.getSharedTeams) return;
    const teams = (await this.options.getSharedTeams()).filter(({ status }) => status === 'active');
    const update = (departments: FinanceDepartment[]): FinanceDepartment[] => {
      const merged = snapshot(departments);
      for (const team of teams) {
        const existing = merged.find(({ teamId }) => teamId === team.id);
        if (existing) {
          existing.name = team.name;
          existing.portId = 'sports';
        } else {
          const id = `sports_team.${team.id}`;
          if (merged.some((department) => department.id === id))
            fail(
              409,
              'finance_team_binding_conflict',
              '共享代表队编号与已有财务部门冲突，请检查部门目录',
            );
          merged.push({ id, name: team.name, portId: 'sports', teamId: team.id });
        }
      }
      return merged;
    };
    const current = (await this.storage.get(LEDGER_ID)) ?? this.initial();
    if (
      JSON.stringify(update(current.settings.departments)) ===
      JSON.stringify(current.settings.departments)
    )
      return;
    await this.storage.change(LEDGER_ID, (stored) => {
      const state = stored ?? this.initial();
      const next = update(state.settings.departments);
      if (JSON.stringify(next) !== JSON.stringify(state.settings.departments)) {
        state.audit.push({
          id: randomUUID(),
          at: new Date().toISOString(),
          actorUid: 'system:shared-sports-directory',
          action: 'settings.sync_shared_teams',
          resourceId: LEDGER_ID,
          before: snapshot(state.settings.departments),
          after: snapshot(next),
        });
        state.settings = {
          ...state.settings,
          departments: next,
          grants: [],
          revision: state.settings.revision + 1,
        };
      }
      return { record: state, result: null };
    });
  }

  private isChief(actor: UserContext): boolean {
    return isFinanceFinalReviewer(actor);
  }

  private readable(state: FinanceLedger, actor: UserContext, departmentId: string): boolean {
    if (this.isChief(actor)) return true;
    const department = state.settings.departments.find(({ id }) => id === departmentId);
    if (!department) return false;
    return financeDepartmentAccess(actor, department).read;
  }

  private canSubmit(state: FinanceLedger, actor: UserContext, departmentId: string): boolean {
    const department = state.settings.departments.find(({ id }) => id === departmentId);
    return (
      this.isChief(actor) ||
      (department !== undefined && financeDepartmentAccess(actor, department).submit)
    );
  }

  private claimReadable(
    state: FinanceLedger,
    actor: UserContext,
    claim: FinanceTrackingClaim,
  ): boolean {
    if (!this.readable(state, actor, claim.departmentId)) return false;
    const neverSubmitted = !claim.history.some((event) => event.action === 'submit');
    const privateDraft =
      claim.status === 'draft' || (claim.status === 'withdrawn' && neverSubmitted);
    return !privateDraft || claim.submitterUid === actor.uid || this.isChief(actor);
  }

  /** Restrictions narrow existing authority; a listed UID does not gain a financial role. */
  private canReviewDepartment(
    state: FinanceLedger,
    actor: UserContext,
    departmentId: string,
  ): boolean {
    if (!this.isChief(actor)) return false;
    const department = state.settings.departments.find(({ id }) => id === departmentId);
    if (!department) return false;
    return !department.reviewPolicy || department.reviewPolicy.reviewerUids.includes(actor.uid);
  }

  private allowedActions(
    state: FinanceLedger,
    actor: UserContext,
    claim: FinanceTrackingClaim,
  ): FinanceClaimAction[] {
    if (actor.previewing || !this.readable(state, actor, claim.departmentId)) return [];
    const actions: FinanceClaimAction[] = [];
    const creator = actor.uid === claim.submitterUid;
    const editable = claim.status === 'draft' || claim.status === 'returned';
    if (creator && this.canSubmit(state, actor, claim.departmentId)) {
      if (editable) actions.push('submit');
      if (editable || claim.status === 'department_review') actions.push('withdraw');
      if (claim.status === 'school_review') actions.push('confirm_received');
    }
    if (
      claim.status === 'department_review' &&
      this.canReviewDepartment(state, actor, claim.departmentId)
    )
      actions.push('approve');
    if (
      (claim.status === 'department_review' &&
        this.canReviewDepartment(state, actor, claim.departmentId)) ||
      (claim.status === 'initial_approved' &&
        this.canReviewDepartment(state, actor, claim.departmentId))
    )
      actions.push('return');
    if (
      claim.status === 'initial_approved' &&
      this.canReviewDepartment(state, actor, claim.departmentId)
    )
      actions.push('record_school_submission');
    if (
      claim.status === 'school_review' &&
      !claim.teacherApprovedAt &&
      this.canReviewDepartment(state, actor, claim.departmentId)
    )
      actions.push('record_teacher_approval');
    return actions;
  }

  private view(state: FinanceLedger, actor: UserContext): FinanceTrackingPayload {
    if (this.storage === null) {
      return {
        configured: false,
        canManageBudget: false,
        canManageReviewPolicies: false,
        ownerUid: null,
        departments: [],
        submittableDepartmentIds: [],
        projects: [],
        claims: [],
        settings: null,
      };
    }
    const departments = state.settings.departments.filter(({ id }) =>
      this.readable(state, actor, id),
    );
    return snapshot({
      configured: true,
      canManageBudget: this.isChief(actor) && !actor.previewing,
      canManageReviewPolicies: actor.rootAdmin === true && !actor.previewing,
      ownerUid: null,
      departments,
      submittableDepartmentIds: actor.previewing
        ? []
        : departments.filter(({ id }) => this.canSubmit(state, actor, id)).map(({ id }) => id),
      projects: financeBudgetPools(
        state.projects.filter(({ departmentId }) => this.readable(state, actor, departmentId)),
      ).map((project) => summarize(project, state.claims)),
      claims: state.claims
        .filter((claim) => this.claimReadable(state, actor, claim))
        .map((claim): FinanceClaimView => ({
          ...claim,
          canEdit:
            !actor.previewing &&
            claim.submitterUid === actor.uid &&
            this.canSubmit(state, actor, claim.departmentId) &&
            (claim.status === 'draft' || claim.status === 'returned'),
          allowedActions: this.allowedActions(state, actor, claim),
        })),
      settings: this.isChief(actor) ? { ...state.settings, grants: [] } : null,
      workflowGuides: (state.settings.workflowGuides ?? []).filter((guide) =>
        departments.some((department) => financeWorkflowPort(department) === guide.portId),
      ),
    });
  }

  async read(actor: UserContext): Promise<FinanceTrackingPayload> {
    this.requireActualIdentity(actor);
    await this.synchronizeSharedTeams();
    return this.view(
      this.normalizeState((await this.storage?.get(LEDGER_ID)) ?? this.initial()),
      actor,
    );
  }

  private requireActualIdentity(actor: UserContext): void {
    if (actor.previewing || (actor.viewer && actor.viewer.uid !== actor.uid)) forbidden();
    if (!this.inPilot(actor)) forbidden();
  }

  private inPilot(actor: UserContext): boolean {
    return this.pilotUids === undefined || this.pilotUids.has(actor.uid);
  }

  /** Run before multipart parsing so unauthorized callers never allocate an upload buffer. */
  assertCanImport(actor: UserContext): void {
    this.requireActualIdentity(actor);
    if (this.storage === null) fail(503, 'finance_not_configured', '尚未配置财务私有存储目录');
    if (!this.isChief(actor)) forbidden();
  }

  async previewImport(
    actor: UserContext,
    buffer: Buffer,
    fileName: string,
    options: Omit<FinanceImportParseOptions, 'departments'>,
  ): Promise<FinanceImportPreview> {
    this.assertCanImport(actor);
    await this.synchronizeSharedTeams();
    const state = (await this.storage!.get(LEDGER_ID)) ?? this.initial();
    const parsed = await parseFinanceBudgetWorkbook(buffer, {
      ...options,
      departments: state.settings.departments,
    });
    const entries: FinanceImportEntry[] = parsed.entries.map((entry) => {
      const previous = state.projects.find(
        (project) =>
          project.year === entry.year &&
          project.departmentId === entry.departmentId &&
          project.code === entry.code,
      );
      const action = !previous
        ? 'create'
        : JSON.stringify(budgetValue(previous)) === JSON.stringify(budgetValue(entry))
          ? 'unchanged'
          : 'update';
      return { ...entry, action, ...(previous ? { previous } : {}) };
    });
    const proposedProjects = snapshot(state.projects);
    for (const entry of entries) {
      const existing = proposedProjects.find((project) => project.id === entry.previous?.id);
      if (existing) Object.assign(existing, budgetValue(entry));
      else
        proposedProjects.push({
          ...budgetValue(entry),
          id: `import-${entry.departmentId}-${entry.code}`,
          revision: 1,
          updatedAt: '',
        });
    }
    if (financeBudgetPoolOverlaps(proposedProjects).length)
      parsed.issues.push({
        severity: 'error',
        sheet: '',
        row: 0,
        message: '同一额度池同时出现父级总额和子项目额度，请保留一种口径后重新导入，避免重复计算',
      });
    const proposedPools = financeBudgetPools(proposedProjects);
    const warnedPools = new Set<string>();
    for (const entry of entries) {
      const pool = proposedPools.find(
        (project) =>
          project.year === entry.year &&
          project.departmentId === entry.departmentId &&
          project.code === financeBudgetPoolCode(entry.code),
      );
      if (!pool || warnedPools.has(pool.id)) continue;
      const proposed = summarize(pool, state.claims);
      if (proposed.reimbursement.overBudget || proposed.directPayment.overBudget) {
        warnedPools.add(pool.id);
        parsed.issues.push({
          severity: 'warning',
          sheet: entry.sourceRows[0].sheet,
          row: entry.sourceRows[0].row,
          message: `项目 ${pool.code} 导入后的额度低于已占用或到账金额，将显示超支预警`,
        });
      }
    }
    const preview: FinanceImportPreview = {
      previewId: randomUUID(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      fileName: fileName.replace(/^.*[\\/]/, '').slice(0, 200),
      year: options.year,
      canCommit: entries.length > 0 && !parsed.issues.some(({ severity }) => severity === 'error'),
      issues: parsed.issues,
      entries,
      unknownDepartments: parsed.unknownDepartments,
    };
    // Keep only this chief's latest preview, in private storage. The ledger is untouched.
    await this.importStorage!.change(actor.uid, () => ({
      record: {
        id: actor.uid,
        actorUid: actor.uid,
        settingsRevision: state.settings.revision,
        digest: createHash('sha256').update(buffer).digest('hex'),
        preview,
      },
      result: null,
    }));
    return snapshot(preview);
  }

  async commitImport(actor: UserContext, previewId: string): Promise<FinanceImportCommitResult> {
    this.assertCanImport(actor);
    const stored = await this.importStorage!.get(actor.uid);
    let summary: FinanceImportCommitResult['summary'] = { created: 0, updated: 0, unchanged: 0 };
    const workspace = await this.change(actor, (state) => {
      if (!this.isChief(actor)) forbidden();
      const committed = state.importReceipts?.find(
        (receipt) => receipt.actorUid === actor.uid && receipt.previewId === previewId,
      );
      if (committed) {
        summary = committed.summary;
        return;
      }
      if (!stored || stored.actorUid !== actor.uid || stored.preview.previewId !== previewId)
        fail(404, 'finance_import_preview_missing', '预览不存在或已被新的预览替换，请重新上传');
      if (Date.parse(stored.preview.expiresAt) <= Date.now())
        fail(410, 'finance_import_preview_expired', '预算导入预览已过期，请重新上传');
      if (!stored.preview.canCommit)
        fail(400, 'finance_import_has_errors', '请先解决预览中的错误再确认导入');
      if (state.settings.revision !== stored.settingsRevision) conflict();
      for (const entry of stored.preview.entries) {
        const current = state.projects.find(
          (project) =>
            project.year === entry.year &&
            project.departmentId === entry.departmentId &&
            project.code === entry.code,
        );
        if (
          entry.previous
            ? current?.id !== entry.previous.id || current.revision !== entry.previous.revision
            : current !== undefined
        )
          conflict();
      }
      for (const entry of stored.preview.entries) {
        this.validateProject(state, entry, entry.previous?.id);
        if (entry.action === 'unchanged') {
          summary.unchanged++;
          continue;
        }
        const input = budgetValue(entry);
        const at = new Date().toISOString();
        if (entry.previous) {
          const project = state.projects.find(({ id }) => id === entry.previous!.id)!;
          const before = snapshot(project);
          Object.assign(project, input, { revision: project.revision + 1, updatedAt: at });
          this.audit(state, actor, 'project.import_update', project.id, before, project);
          summary.updated++;
        } else {
          const project: FinanceBudgetProject = {
            ...input,
            id: randomUUID(),
            revision: 1,
            updatedAt: at,
          };
          state.projects.push(project);
          this.audit(state, actor, 'project.import_create', project.id, null, project);
          summary.created++;
        }
      }
      (state.importReceipts ??= []).push({
        previewId,
        actorUid: actor.uid,
        summary: snapshot(summary),
      });
      this.audit(state, actor, 'budget.import', previewId, null, {
        fileName: stored.preview.fileName,
        fileSha256: stored.digest,
        year: stored.preview.year,
        summary,
        sources: stored.preview.entries.map(({ departmentId, code, sourceRows }) => ({
          departmentId,
          code,
          sourceRows,
        })),
      });
    });
    return { workspace, summary };
  }

  async access(
    actor: UserContext,
  ): Promise<{ configured: boolean; canAccess: boolean; canManageBudget: boolean }> {
    if (!this.inPilot(actor))
      return { configured: false, canAccess: false, canManageBudget: false };
    this.requireActualIdentity(actor);
    await this.synchronizeSharedTeams();
    const state = (await this.storage?.get(LEDGER_ID)) ?? this.initial();
    const configured = this.storage !== null;
    return {
      configured,
      canAccess:
        configured &&
        (this.isChief(actor) ||
          state.settings.departments.some(({ id }) => this.readable(state, actor, id))),
      canManageBudget: configured && this.isChief(actor),
    };
  }

  private async change(
    actor: UserContext,
    operation: (state: FinanceLedger) => void,
  ): Promise<FinanceTrackingPayload> {
    this.requireActualIdentity(actor);
    if (this.storage === null) fail(503, 'finance_not_configured', '尚未配置财务私有存储目录');
    await this.synchronizeSharedTeams();
    return this.storage.change(LEDGER_ID, (stored) => {
      const state = this.normalizeState(stored ?? this.initial(), true);
      state.settings.grants = [];
      operation(state);
      // Verify every derived amount before committing, including claims hidden from this viewer.
      state.projects.forEach((project) => summarize(project, state.claims));
      return { record: state, result: this.view(state, actor) };
    });
  }

  private audit(
    state: FinanceLedger,
    actor: UserContext,
    action: string,
    id: string,
    before: unknown,
    after: unknown,
  ): void {
    state.audit.push({
      id: randomUUID(),
      at: new Date().toISOString(),
      actorUid: actor.uid,
      action,
      resourceId: id,
      before: snapshot(before),
      after: snapshot(after),
    });
  }

  private creation(
    state: FinanceLedger,
    actor: UserContext,
    kind: CreationReceipt['kind'],
    requestId: string,
    input: unknown,
  ): { duplicate: boolean; receipt: CreationReceipt } {
    const digest = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const existing = state.receipts.find(
      (receipt) =>
        receipt.actorUid === actor.uid && receipt.kind === kind && receipt.requestId === requestId,
    );
    if (existing) {
      if (existing.digest !== digest)
        fail(409, 'finance_request_conflict', '同一请求编号不能用于不同内容');
      return { duplicate: true, receipt: existing };
    }
    return {
      duplicate: false,
      receipt: { actorUid: actor.uid, requestId, kind, digest, resourceId: randomUUID() },
    };
  }

  async updateSettings(
    actor: UserContext,
    input: FinanceTrackingSettings,
  ): Promise<FinanceTrackingPayload> {
    this.requireActualIdentity(actor);
    this.assertActualAccess(actor);
    const previousSettings = ((await this.storage!.get(LEDGER_ID)) ?? this.initial()).settings;
    if (input.workflowGuides !== undefined) {
      if (!this.isChief(actor)) forbidden();
      const previousIds = new Set(
        previousSettings.workflowGuides?.map((guide) => guide.instructionFileId).filter(Boolean),
      );
      for (const guide of input.workflowGuides) {
        if (guide.instructionFileId && !previousIds.has(guide.instructionFileId))
          await this.privateFileStore!.assertOwnedFiles(
            actor.uid,
            [guide.instructionFileId],
            'instruction',
          );
      }
    }
    const sharedTeams = this.options.getSharedTeams ? await this.options.getSharedTeams() : [];
    return this.change(actor, (state) => {
      if (!this.isChief(actor)) forbidden();
      if (input.revision !== state.settings.revision) conflict();
      const nextDepartments = snapshot(input.departments);
      for (const department of nextDepartments) {
        if (!department.reviewPolicy) continue;
        const reviewerUids = department.reviewPolicy.reviewerUids;
        if (
          !Array.isArray(reviewerUids) ||
          reviewerUids.length < 1 ||
          reviewerUids.length > 20 ||
          reviewerUids.some((uid) => typeof uid !== 'string' || !uid.trim() || uid.length > 128) ||
          new Set(reviewerUids).size !== reviewerUids.length
        )
          fail(400, 'finance_invalid_review_policy', '专属审核人须为 1–20 位不重复的有效 UID');
        department.reviewPolicy.reviewerUids = reviewerUids.map((uid) => uid.trim()).sort();
        if (new Set(department.reviewPolicy.reviewerUids).size !== reviewerUids.length)
          fail(400, 'finance_invalid_review_policy', '专属审核人 UID 不能重复');
      }
      if (!actor.rootAdmin) {
        for (const department of nextDepartments) {
          const existing = state.settings.departments.find(({ id }) => id === department.id);
          if (
            JSON.stringify(existing?.reviewPolicy?.reviewerUids.slice().sort() ?? null) !==
            JSON.stringify(department.reviewPolicy?.reviewerUids ?? null)
          )
            forbidden();
        }
        for (const existing of state.settings.departments) {
          if (!existing.reviewPolicy) continue;
          const replacement = nextDepartments.find(({ id }) => id === existing.id);
          if (
            !replacement ||
            replacement.portId !== existing.portId ||
            replacement.teamId !== existing.teamId
          )
            forbidden();
        }
      }
      // Directory entries already bound to shared teams remain available for historical claims.
      for (const existing of state.settings.departments) {
        if (!existing.teamId) continue;
        const replacement = nextDepartments.find(({ id }) => id === existing.id);
        if (!replacement) nextDepartments.push(existing);
        else {
          if (replacement.teamId && replacement.teamId !== existing.teamId)
            fail(409, 'finance_team_binding_conflict', '已有共享代表队绑定不能改为另一支队伍');
          replacement.teamId = existing.teamId;
        }
      }
      const ids = new Set(nextDepartments.map(({ id }) => id));
      if (ids.size !== nextDepartments.length)
        fail(400, 'finance_duplicate_department', '部门编号不能重复');
      for (const department of state.settings.departments) {
        const replacement = nextDepartments.find(({ id }) => id === department.id);
        if (
          state.projects.some((project) => project.departmentId === department.id) &&
          (!replacement ||
            replacement.portId !== department.portId ||
            replacement.teamId !== department.teamId)
        )
          fail(409, 'finance_department_in_use', '已有预算的部门不能删除或更换工作口');
      }
      const teamIds = new Set<string>();
      for (const department of nextDepartments) {
        if (!department.teamId) continue;
        const shared = sharedTeams.find(({ id }) => id === department.teamId);
        if (department.portId !== 'sports' || !shared)
          fail(400, 'finance_invalid_team', '代表队绑定必须指向共享体育目录中的实际队伍');
        if (teamIds.has(department.teamId))
          fail(400, 'finance_duplicate_team', '同一代表队不能绑定多个财务部门');
        teamIds.add(department.teamId);
        department.name = shared.name;
      }
      const before = snapshot(state.settings);
      const workflowGuides = snapshot(input.workflowGuides ?? state.settings.workflowGuides ?? []);
      if (new Set(workflowGuides.map((guide) => guide.portId)).size !== workflowGuides.length)
        fail(400, 'finance_duplicate_workflow_guide', '同一工作口只能配置一套办理指引');
      for (const guide of workflowGuides)
        if (guide.portId === 'youth_league') delete guide.workPortLead;
      state.settings = {
        departments: nextDepartments,
        grants: [],
        revision: state.settings.revision + 1,
        workflowGuides,
      };
      this.audit(state, actor, 'settings.update', LEDGER_ID, before, state.settings);
    });
  }

  private validateProject(
    state: FinanceLedger,
    input: FinanceBudgetInput,
    exceptId?: string,
  ): void {
    if (!state.settings.departments.some(({ id }) => id === input.departmentId))
      fail(400, 'finance_department_missing', '请选择已配置的部门');
    if (
      state.projects.some(
        (project) =>
          project.id !== exceptId &&
          project.year === input.year &&
          project.departmentId === input.departmentId &&
          project.code === input.code,
      )
    )
      fail(409, 'finance_project_code_conflict', '同一年度、同一部门的项目编号不能重复');
    const proposed = state.projects
      .filter((project) => project.id !== exceptId)
      .concat({ ...input, id: exceptId ?? 'proposed', revision: 1, updatedAt: '' });
    if (financeBudgetPoolOverlaps(proposed).length)
      fail(
        409,
        'finance_budget_pool_overlap',
        '同一额度池不能同时录入父级总额和子项目额度，以免重复计算',
      );
    if (exceptId) {
      const pool = financeBudgetPools(state.projects).find((item) =>
        item.memberProjectIds.includes(exceptId),
      );
      if (pool && pool.memberProjectIds.length > 1 && input.code === pool.code)
        fail(
          409,
          'finance_budget_pool_aggregate_edit',
          '该额度由多个原始项目合并，请通过导入原始明细更新，不能将汇总额度覆盖单条明细',
        );
    }
  }

  async createProject(
    actor: UserContext,
    requestId: string,
    input: FinanceBudgetInput,
  ): Promise<FinanceTrackingPayload> {
    return this.change(actor, (state) => {
      if (!this.isChief(actor)) forbidden();
      const { duplicate, receipt } = this.creation(state, actor, 'project', requestId, input);
      if (duplicate) return;
      this.validateProject(state, input);
      const project: FinanceBudgetProject = {
        ...snapshot(input),
        id: receipt.resourceId,
        revision: 1,
        updatedAt: new Date().toISOString(),
      };
      state.projects.push(project);
      state.receipts.push(receipt);
      this.audit(state, actor, 'project.create', project.id, null, project);
    });
  }

  async updateProject(
    actor: UserContext,
    id: string,
    revision: number,
    input: FinanceBudgetInput,
  ): Promise<FinanceTrackingPayload> {
    return this.change(actor, (state) => {
      if (!this.isChief(actor)) forbidden();
      const project = state.projects.find((item) => item.id === id);
      if (!project) fail(404, 'finance_project_missing', '项目不存在');
      if (project.revision !== revision) conflict();
      this.validateProject(state, input, id);
      if (
        !actor.rootAdmin &&
        project.departmentId !== input.departmentId &&
        state.settings.departments.some(
          (department) =>
            (department.id === project.departmentId || department.id === input.departmentId) &&
            department.reviewPolicy !== undefined,
        )
      )
        forbidden();
      if (
        state.claims.some((claim) => claim.projectId === id) &&
        (project.departmentId !== input.departmentId || project.year !== input.year)
      )
        fail(409, 'finance_project_in_use', '已有报销记录的项目不能更换年度或部门');
      const before = snapshot(project);
      Object.assign(project, snapshot(input), {
        revision: project.revision + 1,
        updatedAt: new Date().toISOString(),
      });
      this.audit(state, actor, 'project.update', id, before, project);
    });
  }

  private claimProject(
    state: FinanceLedger,
    actor: UserContext,
    projectId: string,
    kind?: FinanceClaimInput['kind'],
  ): FinanceBudgetProject {
    const project = state.projects.find(({ id }) => id === projectId);
    if (!project || !this.canSubmit(state, actor, project.departmentId)) forbidden();
    if (kind) {
      const pool = financeBudgetPools(state.projects).find((item) =>
        item.memberProjectIds.includes(projectId),
      );
      const allowance =
        kind === 'reimbursement' ? pool?.reimbursementCents : pool?.directPaymentCents;
      if ((allowance ?? 0) <= 0)
        fail(400, 'finance_channel_unavailable', '本项目没有该类款项的批准额度');
    }
    return project;
  }

  async createClaim(
    actor: UserContext,
    requestId: string,
    input: FinanceClaimInput,
  ): Promise<FinanceTrackingPayload> {
    this.assertActualAccess(actor);
    input = this.normalizedClaimInput(input);
    if (input.directPayment?.proofFileIds.length)
      await this.privateFileStore!.assertOwnedFiles(
        actor.uid,
        input.directPayment.proofFileIds,
        'work_proof',
      );
    return this.change(actor, (state) => {
      const project = this.claimProject(state, actor, input.projectId, input.kind);
      const { duplicate, receipt } = this.creation(state, actor, 'claim', requestId, input);
      if (duplicate) return;
      const at = new Date().toISOString();
      const claim: FinanceTrackingClaim = {
        ...snapshot(input),
        id: receipt.resourceId,
        departmentId: project.departmentId,
        submitterUid: actor.uid,
        submitterDisplayName: actor.displayName,
        status: 'draft',
        revision: 1,
        createdAt: at,
        updatedAt: at,
        schoolSubmittedAt: null,
        teacherApprovedAt: null,
        workflowVersion: 2,
        initialApprovedAt: null,
        counselorFinancialApprovedAt: null,
        history: [
          {
            action: 'create',
            from: null,
            to: 'draft',
            at,
            actorUid: actor.uid,
            actorDisplayName: actor.displayName,
            note: '',
          },
        ],
      };
      state.claims.push(claim);
      state.receipts.push(receipt);
      this.audit(state, actor, 'claim.create', claim.id, null, claim);
    });
  }

  private visibleClaim(state: FinanceLedger, actor: UserContext, id: string): FinanceTrackingClaim {
    const claim = state.claims.find((item) => item.id === id);
    if (!claim || !this.claimReadable(state, actor, claim))
      fail(404, 'finance_claim_missing', '报销记录不存在或不可见');
    return claim;
  }

  async updateClaim(
    actor: UserContext,
    id: string,
    revision: number,
    input: FinanceClaimInput,
  ): Promise<FinanceTrackingPayload> {
    this.assertActualAccess(actor);
    input = this.normalizedClaimInput(input);
    if (input.directPayment?.proofFileIds.length)
      await this.privateFileStore!.assertOwnedFiles(
        actor.uid,
        input.directPayment.proofFileIds,
        'work_proof',
      );
    return this.change(actor, (state) => {
      const claim = this.visibleClaim(state, actor, id);
      if (claim.submitterUid !== actor.uid || !this.canSubmit(state, actor, claim.departmentId))
        forbidden();
      if (claim.revision !== revision) conflict();
      if (claim.status !== 'draft' && claim.status !== 'returned')
        fail(409, 'finance_claim_not_editable', '只有草稿或退回的记录可以修改');
      const project = this.claimProject(state, actor, input.projectId, input.kind);
      const before = snapshot(claim);
      const at = new Date().toISOString();
      const situationsChanged =
        JSON.stringify([...(claim.materialSituations ?? [])].sort()) !==
        JSON.stringify([...(input.materialSituations ?? [])].sort());
      Object.assign(claim, snapshot(input), {
        invoiceLines: input.kind === 'reimbursement' ? input.invoiceLines : undefined,
        directPayment: input.kind === 'direct_payment' ? input.directPayment : undefined,
        materialSituations: input.materialSituations,
        checklist: situationsChanged ? [] : input.checklist,
        departmentId: project.departmentId,
        revision: claim.revision + 1,
        updatedAt: at,
      });
      claim.history.push({
        action: 'edit',
        from: claim.status,
        to: claim.status,
        at,
        actorUid: actor.uid,
        actorDisplayName: actor.displayName,
        note: '',
      });
      this.audit(state, actor, 'claim.edit', id, before, claim);
    });
  }

  async act(
    actor: UserContext,
    id: string,
    revision: number,
    action: FinanceClaimAction,
    note = '',
  ): Promise<FinanceTrackingPayload> {
    this.assertActualAccess(actor);
    if (action === 'submit') {
      const state = this.normalizeState((await this.storage!.get(LEDGER_ID)) ?? this.initial());
      const claim = this.visibleClaim(state, actor, id);
      if (claim.directPayment?.proofFileIds.length)
        await this.privateFileStore!.assertOwnedFiles(
          actor.uid,
          claim.directPayment.proofFileIds,
          'work_proof',
        );
    }
    return this.change(actor, (state) => {
      const claim = this.visibleClaim(state, actor, id);
      if (claim.revision !== revision) conflict();
      if (!this.allowedActions(state, actor, claim).includes(action)) forbidden();
      if (action === 'return' && !note.trim())
        fail(400, 'finance_return_reason_required', '退回时请说明需要补充或修改的内容');
      const before = snapshot(claim);
      const from = claim.status;
      const at = new Date().toISOString();
      if (action === 'submit') {
        this.validateSubmission(state, claim);
        claim.status = 'department_review';
        claim.schoolSubmittedAt = null;
        claim.teacherApprovedAt = null;
        claim.initialApprovedAt = null;
        claim.counselorFinancialApprovedAt = null;
      }
      if (action === 'approve') {
        claim.status = 'initial_approved';
        claim.initialApprovedAt = at;
      }
      if (action === 'return') claim.status = 'returned';
      if (action === 'withdraw') claim.status = 'withdrawn';
      if (action === 'record_school_submission') {
        claim.status = 'school_review';
        claim.schoolSubmittedAt = at;
        claim.counselorFinancialApprovedAt = at;
      }
      if (action === 'record_teacher_approval') claim.teacherApprovedAt = at;
      if (action === 'confirm_received') claim.status = 'received';
      claim.revision += 1;
      claim.updatedAt = at;
      claim.history.push({
        action,
        from,
        to: claim.status,
        at,
        actorUid: actor.uid,
        actorDisplayName: actor.displayName,
        note: note.trim(),
      });
      this.audit(state, actor, `claim.${action}`, id, before, claim);
    });
  }
}
