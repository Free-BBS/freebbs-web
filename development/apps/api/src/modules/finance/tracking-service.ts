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
  FinanceImportPreview,
  FinanceImportEntry,
  FinanceImportCommitResult,
  UserContext,
} from '@freebbs-development/contracts';
import { featureStorage } from '../../core/database/feature-storage.js';
import { HttpError } from '../../core/errors/http-error.js';
import { parseFinanceBudgetWorkbook, type FinanceImportParseOptions } from './import-parser.js';
import { financeDepartmentAccess, isFinanceFinalReviewer } from './shared-access.js';

export interface FinanceTrackingServiceOptions {
  directory?: string;
  authMode?: 'main' | 'demo';
  nodeEnvironment?: string;
  defaultDepartments?: FinanceDepartment[];
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
const RESERVED: readonly FinanceClaimStatus[] = ['department_review', 'school_review', 'received'];
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
  project: FinanceBudgetProject,
  claims: FinanceTrackingClaim[],
): FinanceBudgetSummary {
  const reimbursement = balance(project.reimbursementCents);
  const directPayment = balance(project.directPaymentCents);
  for (const claim of claims) {
    if (claim.projectId !== project.id || !RESERVED.includes(claim.status)) continue;
    const channel = claim.kind === 'reimbursement' ? reimbursement : directPayment;
    if (claim.status === 'department_review')
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

  constructor(private readonly options: FinanceTrackingServiceOptions) {
    this.storage = options.directory
      ? featureStorage<FinanceLedger>(options.directory, 'finance-tracking')
      : null;
    this.importStorage = options.directory
      ? featureStorage<StoredImport>(options.directory, 'finance-imports')
      : null;
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

  private hasRole(
    state: FinanceLedger,
    actor: UserContext,
    departmentId: string,
    roles: ('finance_officer' | 'counselor' | 'teacher')[],
  ): boolean {
    if (this.isChief(actor)) return true;
    const department = state.settings.departments.find(({ id }) => id === departmentId);
    return (
      department !== undefined &&
      roles.includes('finance_officer') &&
      financeDepartmentAccess(actor, department).officer
    );
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
      this.hasRole(state, actor, claim.departmentId, ['counselor'])
    )
      actions.push('approve');
    if (
      (claim.status === 'department_review' &&
        this.hasRole(state, actor, claim.departmentId, ['counselor'])) ||
      (claim.status === 'school_review' &&
        this.hasRole(state, actor, claim.departmentId, ['counselor', 'teacher']))
    )
      actions.push('return');
    if (
      claim.kind === 'reimbursement' &&
      !claim.schoolSubmittedAt &&
      (claim.status === 'department_review' || claim.status === 'school_review') &&
      this.hasRole(state, actor, claim.departmentId, ['finance_officer', 'counselor'])
    )
      actions.push('record_school_submission');
    if (
      claim.status === 'school_review' &&
      !claim.teacherApprovedAt &&
      this.hasRole(state, actor, claim.departmentId, ['teacher'])
    )
      actions.push('record_teacher_approval');
    return actions;
  }

  private view(state: FinanceLedger, actor: UserContext): FinanceTrackingPayload {
    if (this.storage === null) {
      return {
        configured: false,
        canManageBudget: false,
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
      ownerUid: null,
      departments,
      submittableDepartmentIds: actor.previewing
        ? []
        : departments.filter(({ id }) => this.canSubmit(state, actor, id)).map(({ id }) => id),
      projects: state.projects
        .filter(({ departmentId }) => this.readable(state, actor, departmentId))
        .map((project) => summarize(project, state.claims)),
      claims: state.claims
        .filter(
          (claim) =>
            this.readable(state, actor, claim.departmentId) &&
            (claim.status !== 'draft' || claim.submitterUid === actor.uid || this.isChief(actor)),
        )
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
    });
  }

  async read(actor: UserContext): Promise<FinanceTrackingPayload> {
    this.requireActualIdentity(actor);
    await this.synchronizeSharedTeams();
    return this.view((await this.storage?.get(LEDGER_ID)) ?? this.initial(), actor);
  }

  private requireActualIdentity(actor: UserContext): void {
    if (actor.previewing || (actor.viewer && actor.viewer.uid !== actor.uid)) forbidden();
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
      if (previous) {
        const proposed = summarize({ ...previous, ...budgetValue(entry) }, state.claims);
        if (proposed.reimbursement.overBudget || proposed.directPayment.overBudget)
          parsed.issues.push({
            severity: 'warning',
            sheet: entry.sourceRows[0].sheet,
            row: entry.sourceRows[0].row,
            message: `项目 ${entry.code} 导入后的额度低于已占用或到账金额，将显示超支预警`,
          });
      }
      return { ...entry, action, ...(previous ? { previous } : {}) };
    });
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
      const state = stored ?? this.initial();
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
    const sharedTeams = this.options.getSharedTeams ? await this.options.getSharedTeams() : [];
    return this.change(actor, (state) => {
      if (!this.isChief(actor)) forbidden();
      if (input.revision !== state.settings.revision) conflict();
      const nextDepartments = snapshot(input.departments);
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
      state.settings = {
        departments: nextDepartments,
        grants: [],
        revision: state.settings.revision + 1,
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
  ): FinanceBudgetProject {
    const project = state.projects.find(({ id }) => id === projectId);
    if (!project || !this.canSubmit(state, actor, project.departmentId)) forbidden();
    return project;
  }

  async createClaim(
    actor: UserContext,
    requestId: string,
    input: FinanceClaimInput,
  ): Promise<FinanceTrackingPayload> {
    return this.change(actor, (state) => {
      const project = this.claimProject(state, actor, input.projectId);
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
    if (
      !claim ||
      !this.readable(state, actor, claim.departmentId) ||
      (claim.status === 'draft' && claim.submitterUid !== actor.uid && !this.isChief(actor))
    )
      fail(404, 'finance_claim_missing', '报销记录不存在或不可见');
    return claim;
  }

  async updateClaim(
    actor: UserContext,
    id: string,
    revision: number,
    input: FinanceClaimInput,
  ): Promise<FinanceTrackingPayload> {
    return this.change(actor, (state) => {
      const claim = this.visibleClaim(state, actor, id);
      if (claim.submitterUid !== actor.uid || !this.canSubmit(state, actor, claim.departmentId))
        forbidden();
      if (claim.revision !== revision) conflict();
      if (claim.status !== 'draft' && claim.status !== 'returned')
        fail(409, 'finance_claim_not_editable', '只有草稿或退回的记录可以修改');
      const project = this.claimProject(state, actor, input.projectId);
      const before = snapshot(claim);
      const at = new Date().toISOString();
      Object.assign(claim, snapshot(input), {
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
        if (!claim.externalSubmittedAt || !claim.externalReference.trim())
          fail(
            400,
            'finance_external_submission_required',
            '请填写校财务提交编号或代发邮件主题，以及提交日期',
          );
        claim.status = 'department_review';
        claim.schoolSubmittedAt = null;
        claim.teacherApprovedAt = null;
      }
      if (action === 'approve') claim.status = 'school_review';
      if (action === 'return') claim.status = 'returned';
      if (action === 'withdraw') claim.status = 'withdrawn';
      if (action === 'record_school_submission') claim.schoolSubmittedAt = at;
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
