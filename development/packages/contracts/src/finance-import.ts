import type {
  FinanceBudgetInput,
  FinanceBudgetProject,
  FinancePortId,
  FinanceTrackingPayload,
} from './finance-tracking.js';

export interface FinanceImportIssue {
  severity: 'error' | 'warning';
  sheet: string;
  row: number;
  message: string;
}
export interface FinanceImportSourceRow {
  sheet: string;
  row: number;
}
export interface FinanceImportEntry extends FinanceBudgetInput {
  departmentName: string;
  portId: FinancePortId;
  action: 'create' | 'update' | 'unchanged';
  previous?: FinanceBudgetProject;
  sourceRows: FinanceImportSourceRow[];
}
export interface FinanceImportUnknownDepartment {
  organization: string;
  department: string;
  sheet: string;
  row: number;
}
export interface FinanceImportMapping {
  organization: string;
  department: string;
  departmentId: string;
}
export interface FinanceImportPreview {
  previewId: string;
  expiresAt: string;
  fileName: string;
  year: string;
  canCommit: boolean;
  issues: FinanceImportIssue[];
  entries: FinanceImportEntry[];
  unknownDepartments: FinanceImportUnknownDepartment[];
}
export interface FinanceImportCommitResult {
  workspace: FinanceTrackingPayload;
  summary: { created: number; updated: number; unchanged: number };
}
