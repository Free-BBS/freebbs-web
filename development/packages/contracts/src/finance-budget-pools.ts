import type { FinanceBudgetProject } from './finance-tracking.js';

/** These four source sections share one allowance despite their numbered detail rows. */
const COMMON_BUDGET_SECTIONS = new Set(['2-8', '3-5', '4-6', '5-4']);

export function financeBudgetPoolCode(code: string): string {
  const trimmed = code.trim();
  const match = /^(\d+-\d+)(?:-\d+)*$/.exec(trimmed);
  return match && COMMON_BUDGET_SECTIONS.has(match[1]) ? match[1] : trimmed;
}

export function financeBudgetPoolKey(
  project: Pick<FinanceBudgetProject, 'year' | 'departmentId' | 'code'>,
): string {
  return JSON.stringify([project.year, project.departmentId, financeBudgetPoolCode(project.code)]);
}

export interface FinanceBudgetPool extends FinanceBudgetProject {
  /** Original IDs remain valid for old applications and import revisions. */
  memberProjectIds: string[];
}

const compareSource = (left: FinanceBudgetProject, right: FinanceBudgetProject) =>
  left.code.localeCompare(right.code, 'zh-CN', { numeric: true }) ||
  left.id.localeCompare(right.id);

function total(
  projects: FinanceBudgetProject[],
  field: 'reimbursementCents' | 'directPaymentCents',
) {
  const result = projects.reduce((sum, project) => sum + project[field], 0);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error('预算额度合计超出可处理范围');
  return result;
}

/** Aggregate for presentation and reservations without deleting source rows or claim references. */
export function financeBudgetPools(projects: readonly FinanceBudgetProject[]): FinanceBudgetPool[] {
  const groups = new Map<string, FinanceBudgetProject[]>();
  for (const project of projects) {
    const key = financeBudgetPoolKey(project);
    const group = groups.get(key) ?? [];
    group.push(project);
    groups.set(key, group);
  }
  return [...groups.values()].map((members) => {
    const ordered = [...members].sort(compareSource);
    const code = financeBudgetPoolCode(ordered[0].code);
    const representative = ordered.find((project) => project.code === code) ?? ordered[0];
    const isCommon = COMMON_BUDGET_SECTIONS.has(code);
    return {
      ...representative,
      code,
      name: isCommon ? '团建与部门建设' : representative.name,
      reimbursementCents: total(ordered, 'reimbursementCents'),
      directPaymentCents: total(ordered, 'directPaymentCents'),
      updatedAt: ordered.reduce(
        (latest, project) => (project.updatedAt > latest ? project.updatedAt : latest),
        representative.updatedAt,
      ),
      notes:
        ordered.length > 1
          ? ordered
              .map((project) => `【${project.code} ${project.name}】\n${project.notes}`)
              .join('\n\n')
          : representative.notes,
      memberProjectIds: ordered.map((project) => project.id),
    };
  });
}

/** Mixing a source parent total and its child allowances would count the same pool twice. */
export function financeBudgetPoolOverlaps(projects: readonly FinanceBudgetProject[]): string[] {
  const groups = new Map<string, string[]>();
  for (const project of projects) {
    const key = financeBudgetPoolKey(project);
    const codes = groups.get(key) ?? [];
    codes.push(project.code);
    groups.set(key, codes);
  }
  return [...groups.entries()]
    .filter(([, codes]) => codes.length > 1 && codes.includes(financeBudgetPoolCode(codes[0])))
    .map(([key]) => key);
}
