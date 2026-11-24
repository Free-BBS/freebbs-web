import ExcelJS from 'exceljs';
import type {
  OrganizationGroupClass,
  OrganizationGroupRosterExcelPreview,
  OrganizationGroupRosterImportMode,
  OrganizationGroupRosterMemberInput,
  UserContext,
} from '@freebbs-development/contracts';
import { HttpError } from '../../core/errors/http-error.js';
import { validateFinanceWorkbookArchive } from '../finance/import-parser.js';
import { fail, type OrganizationState } from './domain.js';
import { canImportRosters, classRoster } from './roster-service.js';

// Reuse the existing bounded OOXML archive inspection before ExcelJS allocates rows:
// 8 MiB compressed, 10 MiB per entry, 40 MiB total inflation, 5,000 rows per sheet.
export const ROSTER_EXCEL_MAX_BYTES = 8 * 1024 * 1024;
const MAX_DATA_ROWS = 4999;
interface ParsedRow {
  row: number;
  className: string;
  displayName: string;
  studentId?: string;
}
interface ParsedWorkbook {
  sheetName: string;
  rows: ParsedRow[];
}

function invalid(message: string): never {
  fail(400, 'roster_import_invalid_workbook', message);
}

function cellText(cell: ExcelJS.Cell, row: number): string {
  const { value } = cell;
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  // Formula results, hyperlinks, dates, booleans and rich objects are never evaluated/coerced.
  invalid(`第 ${row} 行含公式或非纯文字内容，请粘贴为文本后上传`);
}

export async function parseRosterWorkbook(buffer: Buffer): Promise<ParsedWorkbook> {
  try {
    validateFinanceWorkbookArchive(buffer);
  } catch (error) {
    if (error instanceof HttpError)
      throw new HttpError(
        error.status,
        error.status === 413 ? 'roster_import_too_large' : 'roster_import_invalid_workbook',
        error.message.replaceAll('预算', '名单'),
      );
    invalid('请上传有效的 .xlsx 班级名单');
  }
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  } catch {
    invalid('无法读取工作簿，请使用 .xlsx 格式重新保存');
  }
  const sheet =
    workbook.getWorksheet('班级名单') ??
    (workbook.worksheets.length === 1 ? workbook.worksheets[0] : undefined);
  if (!sheet) invalid('请将名单放在“班级名单”工作表；一个文件可填写多个班级');
  if (sheet.state !== 'visible') invalid('名单工作表必须可见');
  for (const other of workbook.worksheets) {
    if (other !== sheet && other.name !== '班级对照' && other.rowCount > 0)
      invalid('检测到其他数据工作表，请将要导入的人员合并到“班级名单”工作表');
  }
  if (sheet.rowCount > MAX_DATA_ROWS + 1 || sheet.columnCount > 20)
    invalid('名单最多 4999 条数据、20 列');
  const aliases = new Map<string, 'className' | 'displayName' | 'studentId'>([
    ['班级', 'className'],
    ['班级ID', 'className'],
    ['班级名称', 'className'],
    ['姓名', 'displayName'],
    ['学号', 'studentId'],
    ['学号（选填）', 'studentId'],
  ]);
  const columns = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, column) => {
    const name = aliases.get(cellText(cell, 1));
    if (name && columns.has(name)) invalid('同一种名单列不能重复出现');
    if (name) columns.set(name, column);
  });
  if (!columns.has('className') || !columns.has('displayName'))
    invalid('首行必须包含“班级”和“姓名”，可增加“学号”列');
  const rows: ParsedRow[] = [];
  for (let row = 2; row <= sheet.rowCount; row++) {
    const record = sheet.getRow(row);
    const className = cellText(record.getCell(columns.get('className')!), row);
    const displayName = cellText(record.getCell(columns.get('displayName')!), row);
    const studentId = columns.has('studentId')
      ? cellText(record.getCell(columns.get('studentId')!), row)
      : '';
    if (!className && !displayName && !studentId) continue;
    if (!className || !displayName) invalid(`第 ${row} 行缺少班级或姓名`);
    for (const [label, value, maximum] of [
      ['班级', className, 120],
      ['姓名', displayName, 120],
      ['学号', studentId, 100],
    ] as const) {
      if (
        value.length > maximum ||
        [...value].some(
          (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        )
      )
        invalid(`第 ${row} 行${label}过长或含控制字符`);
    }
    rows.push({ row, className, displayName, ...(studentId ? { studentId } : {}) });
  }
  if (!rows.length) invalid('名单中没有可导入的人员');
  return { sheetName: sheet.name, rows };
}

export async function rosterWorkbookTemplate(classes: OrganizationGroupClass[]): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('班级名单', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.addRow(['班级', '姓名', '学号']);
  sheet.columns = [{ width: 20 }, { width: 24 }, { width: 28, style: { numFmt: '@' } }];
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3978A8' } };
  const reference = book.addWorksheet('班级对照');
  reference.addRow(['班级 ID', '班级名称']);
  for (const item of classes) reference.addRow([item.id, item.label]);
  reference.columns = [{ width: 28 }, { width: 28 }];
  reference.getRow(1).font = { bold: true };
  return Buffer.from(await book.xlsx.writeBuffer());
}

export function previewRosterWorkbook(
  state: OrganizationState,
  user: UserContext,
  parsed: ParsedWorkbook,
  mode: OrganizationGroupRosterImportMode,
): OrganizationGroupRosterExcelPreview {
  if (!canImportRosters(state, user))
    fail(403, 'roster_import_forbidden', '只有已授权管理者或组织组同学可以导入名单');
  const grouped = new Map<string, ParsedRow[]>();
  for (const row of parsed.rows) {
    const matched = state.classes.filter(
      (item) => item.id === row.className || item.label === row.className,
    );
    if (matched.length !== 1)
      invalid(`第 ${row.row} 行班级“${row.className}”未配置或有重名，请使用班级对照中的唯一 ID`);
    const id = matched[0]!.id;
    grouped.set(id, [...(grouped.get(id) ?? []), row]);
  }
  if (grouped.size > 100) invalid('一次最多导入 100 个班级');
  const result: OrganizationGroupRosterExcelPreview = {
    mode,
    sheetName: parsed.sheetName,
    rowCount: parsed.rows.length,
    warnings: [],
    classes: [],
    batches: [],
  };
  if (parsed.rows.some((row) => !row.studentId))
    result.warnings.push(
      '无学号人员按独立新成员导入，不按姓名合并；同名人员会分别保留。替换模式下，无学号旧成员将被移除并建立新 ID。',
    );
  for (const [classId, rows] of grouped) {
    const current = classRoster(state, user, classId);
    const currentByStudentId = new Map(
      current.members.filter((item) => item.studentId).map((item) => [item.studentId!, item]),
    );
    const studentIds = new Set<string>();
    const added: OrganizationGroupRosterMemberInput[] = [];
    const updated: OrganizationGroupRosterExcelPreview['classes'][number]['updated'] = [];
    const retained = new Set<string>();
    const imported: OrganizationGroupRosterMemberInput[] = [];
    for (const row of rows) {
      if (row.studentId && studentIds.has(row.studentId))
        invalid(`第 ${row.row} 行学号在同一班级重复，请先核对文件`);
      if (row.studentId) studentIds.add(row.studentId);
      const previous = row.studentId ? currentByStudentId.get(row.studentId) : undefined;
      const member = {
        ...(previous ? { id: previous.id } : {}),
        displayName: row.displayName,
        ...(row.studentId ? { studentId: row.studentId } : {}),
      };
      if (previous) {
        retained.add(previous.id);
        if (previous.displayName !== member.displayName) {
          if (mode === 'append')
            invalid(
              `第 ${row.row} 行学号对应的现有姓名不同；增量模式不修改旧成员，请核对或选择替换模式`,
            );
          updated.push({ before: previous, after: member });
        }
      } else added.push(member);
      imported.push(member);
    }
    const removed =
      mode === 'replace' ? current.members.filter((item) => !retained.has(item.id)) : [];
    const members = mode === 'append' ? [...current.members, ...added] : imported;
    if (members.length > 2000)
      invalid(
        `班级“${state.classes.find((item) => item.id === classId)!.label}”导入后超过 2000 人`,
      );
    result.classes.push({
      classId,
      classLabel: state.classes.find((item) => item.id === classId)!.label,
      revision: current.revision,
      beforeCount: current.members.length,
      afterCount: members.length,
      added,
      updated,
      removed,
      unchangedCount: mode === 'append' ? current.members.length : retained.size - updated.length,
    });
    if (added.length || updated.length || removed.length)
      result.batches.push({ classId, revision: current.revision, members });
    if (new Set(rows.map((row) => row.displayName)).size !== rows.length)
      result.warnings.push(
        `“${state.classes.find((item) => item.id === classId)!.label}”包含同名人员，已分别保留，请核对学号。`,
      );
  }
  if (
    result.batches.reduce((count, batch) => count + batch.members.length, 0) > 20000 ||
    Buffer.byteLength(JSON.stringify({ batches: result.batches })) > 1024 * 1024
  )
    invalid('确认名单数据过大，请按较少班级拆分工作簿后导入');
  return result;
}
