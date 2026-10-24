import { inflateRawSync } from 'node:zlib';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import type {
  FinanceBudgetInput,
  FinanceDepartment,
  FinanceImportIssue,
  FinanceImportMapping,
  FinanceImportSourceRow,
  FinanceImportUnknownDepartment,
  FinancePortId,
} from '@freebbs-development/contracts';
import { FINANCE_PORTS } from '@freebbs-development/contracts';
import { HttpError } from '../../core/errors/http-error.js';

export const FINANCE_IMPORT_MAX_BYTES = 8 * 1024 * 1024;
const MAX_ENTRY_BYTES = 10 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 40 * 1024 * 1024;
const MAX_SHEET_ROWS = 5000;
const MAX_SHEET_CELLS = 100000;

function coordinate(value: string): { column: number; row: number } {
  const match = /^\$?([A-Z]{1,3})\$?([1-9]\d*)$/.exec(value);
  if (!match) invalidWorkbook('工作表包含无效的单元格范围');
  let column = 0;
  for (const letter of match[1]) column = column * 26 + letter.charCodeAt(0) - 64;
  const row = Number(match[2]);
  if (column > 200 || row > MAX_SHEET_ROWS) invalidWorkbook('预算表范围不能超过 5000 行、200 列');
  return { column, row };
}

function validateXmlBounds(xml: string): number {
  if (
    (xml.match(/<(?:[\w.-]+:)?row(?:\s|\/?>)/g)?.length ?? 0) > MAX_SHEET_ROWS ||
    (xml.match(/<(?:[\w.-]+:)?c(?:\s|\/?>)/g)?.length ?? 0) > MAX_SHEET_CELLS
  )
    invalidWorkbook('单张预算表不能超过 5000 行或 100000 个单元格');
  for (const match of xml.matchAll(/<(?:[\w.-]+:)?c\s[^>]*\br=["']([^"']+)["']/g))
    coordinate(match[1]);
  for (const match of xml.matchAll(/<(?:[\w.-]+:)?row\s[^>]*\br=["']([^"']+)["']/g))
    if (!/^[1-9]\d*$/.test(match[1]) || Number(match[1]) > MAX_SHEET_ROWS)
      invalidWorkbook('预算表行号无效或超过 5000');
  let mergedArea = 0;
  for (const match of xml.matchAll(/<(?:[\w.-]+:)?mergeCell\s[^>]*\bref=["']([^"']+)["']/g)) {
    const range = match[1].split(':');
    if (range.length > 2) invalidWorkbook();
    const start = coordinate(range[0]);
    const end = coordinate(range[1] ?? range[0]);
    if (end.column < start.column || end.row < start.row) invalidWorkbook();
    mergedArea += (end.column - start.column + 1) * (end.row - start.row + 1);
    if (mergedArea > MAX_SHEET_CELLS) invalidWorkbook('预算表合并区域过大');
  }
  for (const match of xml.matchAll(/<(?:[\w.-]+:)?col\s([^>]*)/g)) {
    for (const attribute of ['min', 'max']) {
      const value = new RegExp(`\\b${attribute}=["']([^"']+)["']`).exec(match[1]);
      if (value && (!/^[1-9]\d*$/.test(value[1]) || Number(value[1]) > 200))
        invalidWorkbook('预算表列范围无效或超过 200');
    }
  }
  if ((xml.match(/<(?:[\w.-]+:)?sheet(?:\s|\/?>)/g)?.length ?? 0) > 30)
    invalidWorkbook('工作簿不能超过 30 张工作表');
  return (xml.match(/<(?:[\w.-]+:)?c(?:\s|\/?>)/g)?.length ?? 0) + mergedArea;
}

function invalidWorkbook(message = '请上传有效的 .xlsx 预算工作簿'): never {
  throw new HttpError(400, 'finance_import_invalid_workbook', message);
}
function validateZipExtraFields(extra: Buffer): void {
  let offset = 0;
  while (offset < extra.length) {
    if (offset + 4 > extra.length) invalidWorkbook();
    const id = extra.readUInt16LE(offset);
    const length = extra.readUInt16LE(offset + 2);
    if (id === 0x7075 || id === 0x0001 || offset + 4 + length > extra.length)
      invalidWorkbook('工作簿包含不受支持的压缩路径格式');
    offset += 4 + length;
  }
}

/** Bound ZIP expansion before ExcelJS builds the workbook object in memory. No entries reach disk. */
export function validateFinanceWorkbookArchive(buffer: Buffer): void {
  if (buffer.byteLength > FINANCE_IMPORT_MAX_BYTES)
    throw new HttpError(413, 'finance_import_too_large', '预算文件不能超过 8 MB');
  if (buffer.length < 22) invalidWorkbook();
  let end = -1;
  for (let at = buffer.length - 22; at >= Math.max(0, buffer.length - 65557); at--) {
    if (
      buffer.readUInt32LE(at) === 0x06054b50 &&
      at + 22 + buffer.readUInt16LE(at + 20) === buffer.length
    ) {
      end = at;
      break;
    }
  }
  if (end < 0 || buffer.readUInt16LE(end + 4) !== 0 || buffer.readUInt16LE(end + 6) !== 0)
    invalidWorkbook();
  const count = buffer.readUInt16LE(end + 10);
  const directoryBytes = buffer.readUInt32LE(end + 12);
  const directoryOffset = buffer.readUInt32LE(end + 16);
  if (
    count < 1 ||
    count > 1000 ||
    count !== buffer.readUInt16LE(end + 8) ||
    directoryOffset + directoryBytes !== end
  )
    invalidWorkbook('工作簿内容过多或压缩格式不受支持');
  const names = new Set<string>();
  let expandedBytes = 0;
  let expandedCells = 0;
  let at = directoryOffset;
  for (let index = 0; index < count; index++) {
    if (at + 46 > end || buffer.readUInt32LE(at) !== 0x02014b50) invalidWorkbook();
    const flags = buffer.readUInt16LE(at + 8);
    const compression = buffer.readUInt16LE(at + 10);
    const compressedBytes = buffer.readUInt32LE(at + 20);
    const expectedBytes = buffer.readUInt32LE(at + 24);
    const nameBytes = buffer.readUInt16LE(at + 28);
    const extraBytes = buffer.readUInt16LE(at + 30);
    const commentBytes = buffer.readUInt16LE(at + 32);
    const localOffset = buffer.readUInt32LE(at + 42);
    const next = at + 46 + nameBytes + extraBytes + commentBytes;
    if (
      next > end ||
      flags & 1 ||
      ![0, 8].includes(compression) ||
      expectedBytes > MAX_ENTRY_BYTES ||
      localOffset + 30 > directoryOffset
    )
      invalidWorkbook('工作簿包含加密内容或内容过大');
    const name = buffer.subarray(at + 46, at + 46 + nameBytes).toString('utf8');
    validateZipExtraFields(buffer.subarray(at + 46 + nameBytes, at + 46 + nameBytes + extraBytes));
    if (
      names.has(name) ||
      /vbaProject\.bin$/i.test(name) ||
      name.startsWith('/') ||
      name.includes('\\') ||
      name.split('/').some((part) => part === '.' || part === '..')
    )
      invalidWorkbook();
    names.add(name);
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) invalidWorkbook();
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    validateZipExtraFields(
      buffer.subarray(
        localOffset + 30 + localNameLength,
        localOffset + 30 + localNameLength + localExtraLength,
      ),
    );
    if (
      !buffer
        .subarray(localOffset + 30, localOffset + 30 + localNameLength)
        .equals(buffer.subarray(at + 46, at + 46 + nameBytes))
    )
      invalidWorkbook();
    const start =
      localOffset +
      30 +
      buffer.readUInt16LE(localOffset + 26) +
      buffer.readUInt16LE(localOffset + 28);
    if (start + compressedBytes > directoryOffset) invalidWorkbook();
    let content: Buffer;
    try {
      const compressed = buffer.subarray(start, start + compressedBytes);
      content =
        compression === 0
          ? compressed
          : inflateRawSync(compressed, { maxOutputLength: MAX_ENTRY_BYTES });
    } catch {
      invalidWorkbook('工作簿压缩内容无效或解压后过大');
    }
    expandedBytes += content.length;
    if (content.length !== expectedBytes || expandedBytes > MAX_EXPANDED_BYTES)
      invalidWorkbook('工作簿解压后内容过大');
    if (/\.xml$/i.test(name)) {
      expandedCells += validateXmlBounds(content.toString('utf8'));
      if (expandedCells > 200000) invalidWorkbook('工作簿整体单元格或合并区域过多');
    }
    at = next;
  }
  if (at !== end || !names.has('[Content_Types].xml') || !names.has('xl/workbook.xml'))
    invalidWorkbook();
}

export interface ParsedFinanceImportEntry extends FinanceBudgetInput {
  departmentName: string;
  portId: FinancePortId;
  sourceRows: FinanceImportSourceRow[];
}
export interface ParsedFinanceImport {
  entries: ParsedFinanceImportEntry[];
  issues: FinanceImportIssue[];
  unknownDepartments: FinanceImportUnknownDepartment[];
}
export interface FinanceImportParseOptions {
  year: string;
  departments: FinanceDepartment[];
  organizationId?: FinancePortId;
  mappings?: FinanceImportMapping[];
}
const normalizeName = (value: string) =>
  value
    .trim()
    .replace(/^\d+(?:-\d+)*[\s.、]*/, '')
    .replace(/^电子系/, '')
    .replace(/[\s·•/暨（）()]/g, '');
function departmentAlias(value: string): string {
  const name = normalizeName(value);
  const aliases: Record<string, string> = {
    新生组: '办公室新生组',
    办公室新生组: '办公室新生组',
    学培部: '学习培养部',
    新媒体部记者团: '新媒体记者团',
    新媒体部: '新媒体记者团',
    策划部: '智能策划部',
    新媒体与记者团部: '新媒体记者团',
    权发中心: '权益发展中心',
    学生权益发展中心: '权益发展中心',
    创设: '创意设计部',
    影策: '影音策划部',
  };
  return aliases[name] ?? name;
}
function sourcePort(value: string): FinancePortId | undefined {
  const name = normalizeName(value).toLowerCase();
  const aliases: Record<string, FinancePortId> = {
    团委: 'youth_league',
    团委口: 'youth_league',
    学生会: 'student_union',
    科协: 'science_association',
    学生科协: 'science_association',
    媒体中心: 'media_center',
    新媒体中心: 'media_center',
    学生新媒体中心: 'media_center',
    体育代表队: 'sports',
    代表队: 'sports',
    体育: 'sports',
    体育部: 'sports',
    '体育+代表队': 'sports',
    bbs: 'bbs',
    freebbs: 'bbs',
  };
  return FINANCE_PORTS.find(({ id }) => id === value)?.id ?? aliases[name];
}
function text(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if ('richText' in value)
      return value.richText
        .map(({ text: part }) => part)
        .join('')
        .trim();
    if ('formula' in value || 'sharedFormula' in value) return String(value.result ?? '').trim();
    if ('text' in value) return value.text.trim();
    return '';
  }
  return String(value).trim();
}
function money(cell: ExcelJS.Cell): number {
  // A merged amount belongs only to its master; identity cells may be read repeatedly.
  if (cell.isMerged && cell.master.address !== cell.address) return 0;
  let value = cell.value;
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'object') {
    if ('formula' in value || 'sharedFormula' in value) {
      if (value.result === undefined || value.result === null)
        throw new Error('公式没有缓存结果，请在 Excel 中重新计算并保存');
      value = value.result;
    } else if ('richText' in value) value = value.richText.map(({ text: part }) => part).join('');
    else throw new Error('金额包含错误值或无法识别的内容');
  }
  if (typeof value === 'string') {
    const raw = value.trim();
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(raw))
      throw new Error('金额须为非负数字，最多保留两位小数');
    value = Number(raw.replaceAll(',', ''));
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    throw new Error('金额须为非负数字');
  const cents = Math.round(value * 100);
  if (!Number.isSafeInteger(cents) || Math.abs(value * 100 - cents) > 0.00001)
    throw new Error('金额超出范围或小数超过两位');
  return cents;
}
function addMoney(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new Error('金额合计超过可处理范围');
  return result;
}
async function compatibleWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
  validateFinanceWorkbookArchive(buffer);
  const zip = await JSZip.loadAsync(buffer);
  // Some valid third-party workbooks prefix every SpreadsheetML element with x:.
  // ExcelJS matches local names; normalize only this known namespace, preserving text and r:id.
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || !/\.xml$/i.test(entry.name)) continue;
    let xml = await entry.async('string');
    const prefixes = [
      ...xml.matchAll(
        /xmlns:([A-Za-z_][\w.-]*)=["']http:\/\/schemas\.openxmlformats\.org\/spreadsheetml\/2006\/main["']/g,
      ),
    ].map((match) => match[1]);
    for (const prefix of new Set(prefixes)) {
      const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      xml = xml.replace(new RegExp(`(<\\/?)(?:${escaped}):`, 'g'), '$1');
      xml = xml.replace(
        new RegExp(
          `xmlns:${escaped}=(["'])http://schemas.openxmlformats.org/spreadsheetml/2006/main\\1`,
          'g',
        ),
        'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
      );
    }
    if (prefixes.length) zip.file(entry.name, xml);
  }
  const book = new ExcelJS.Workbook();
  try {
    await book.xlsx.load(await zip.generateAsync({ type: 'arraybuffer' }), {
      ignoreNodes: ['dataValidations', 'conditionalFormatting', 'extLst', 'drawing', 'picture'],
    });
  } catch {
    invalidWorkbook('工作簿无法读取，请另存为 .xlsx 后重试');
  }
  if (!book.worksheets.length || book.worksheets.length > 30)
    invalidWorkbook('工作簿没有可读取的工作表或工作表过多');
  return book;
}

export async function parseFinanceBudgetWorkbook(
  buffer: Buffer,
  options: FinanceImportParseOptions,
): Promise<ParsedFinanceImport> {
  const book = await compatibleWorkbook(buffer);
  const issues: FinanceImportIssue[] = [];
  const unknownDepartments: FinanceImportUnknownDepartment[] = [];
  const grouped = new Map<
    string,
    ParsedFinanceImportEntry & { totalCents: number; hasTotal: boolean; noteParts: Set<string> }
  >();
  const issue = (
    severity: FinanceImportIssue['severity'],
    sheet: string,
    row: number,
    message: string,
  ) => issues.push({ severity, sheet, row, message });
  for (const sheet of book.worksheets) {
    const headerKey = (value: string) => value.replace(/[\s（）()]/g, '').toLowerCase();
    let headerRow = 0;
    let columns = new Map<string, number>();
    for (let row = 1; row <= Math.min(20, sheet.rowCount); row++) {
      const candidate = new Map<string, number>();
      sheet.getRow(row).eachCell((cell, col) => candidate.set(headerKey(text(cell)), col));
      if (
        (candidate.has('项目编号') || candidate.has('预算编号')) &&
        (candidate.has('项目名称') || candidate.has('预算名称'))
      ) {
        headerRow = row;
        columns = candidate;
        break;
      }
    }
    if (!headerRow) {
      if (sheet.actualRowCount)
        issue(
          /对照|汇总|说明|目录/.test(sheet.name) ? 'warning' : 'error',
          sheet.name,
          1,
          '未识别为预算明细表，已跳过此工作表',
        );
      continue;
    }
    const find = (...names: string[]) =>
      names.map((name) => columns.get(headerKey(name))).find((column) => column !== undefined);
    const legacy =
      find('预算编号') === 3 &&
      find('部门名称') === 2 &&
      text(sheet.getRow(headerRow).getCell(8)).startsWith('报销');
    const codeCol = find('项目编号', '预算编号')!;
    const nameCol = find('项目名称', '预算名称')!;
    const departmentCol = find('部门ID', 'departmentId', '部门', '部门名称');
    const organizationCol = find('组织', '工作口', '组织ID');
    const yearCol = find('年度', '学年', '预算年度');
    const reimbursementCol = find('报销额度（元）', '报销额度', '报销（元）', '报销');
    const directCol = find('代发额度（元）', '代发额度', '代发（元）', '代发');
    const notesCol = find('备注');
    if (!departmentCol || (!legacy && (!reimbursementCol || !directCol))) {
      issue('error', sheet.name, headerRow, '缺少部门、报销额度或代发额度列，请参考标准模板');
      continue;
    }
    let lastOrganization = '';
    let lastDepartment = '';
    let lastCode = '';
    let lastName = '';
    for (let row = headerRow + 1; row <= sheet.rowCount; row++) {
      const record = sheet.getRow(row);
      if (!record.hasValues) continue;
      const rawOrg = organizationCol ? text(record.getCell(organizationCol)) : '';
      const rawDept = text(record.getCell(departmentCol));
      const rawCode = text(record.getCell(codeCol));
      const rawName = text(record.getCell(nameCol));
      if (
        [rawOrg, rawDept, rawCode, rawName].some((value) =>
          /(?:合计|小计|总计|总预算)(?:[（(].*[）)])?$/.test(value),
        )
      )
        continue;
      if (legacy && rawDept && rawDept !== lastDepartment) {
        lastCode = '';
        lastName = '';
      }
      if (rawOrg) lastOrganization = rawOrg;
      if (rawDept) lastDepartment = rawDept;
      if (rawCode) lastCode = rawCode;
      if (rawName) lastName = rawName;
      const organization = rawOrg || (legacy ? lastOrganization : '') || sheet.name;
      let department = rawDept || (legacy ? lastDepartment : '');
      const code = rawCode || (legacy ? lastCode : '');
      const name = rawName || (legacy ? lastName : '');
      const rawPort = sourcePort(organization);
      if (legacy && rawPort === 'sports' && /体育代表队|^代表队$/.test(normalizeName(department)))
        department = name;
      const explicit = options.mappings?.filter(
        (mapping) => mapping.organization === organization && mapping.department === department,
      );
      let matches: FinanceDepartment[];
      if (explicit?.length)
        matches = options.departments.filter(({ id }) =>
          explicit.some((mapping) => mapping.departmentId === id),
        );
      else {
        matches = options.departments.filter(({ id }) => id === department);
        if (!matches.length) {
          const named = options.departments.filter(
            (item) => departmentAlias(item.name) === departmentAlias(department),
          );
          const scoped = named.filter(({ portId }) => portId === rawPort);
          matches = scoped.length ? scoped : named;
        }
      }
      if (
        options.organizationId &&
        (matches.length === 1
          ? matches[0].portId !== options.organizationId
          : rawPort !== options.organizationId)
      )
        continue;
      const hasAmounts = legacy
        ? [6, 8, 9, 10, 11, 12, 13].some(
            (col) =>
              record.getCell(col).value !== null &&
              record.getCell(col).value !== undefined &&
              record.getCell(col).value !== '',
          )
        : [reimbursementCol!, directCol!].some(
            (col) =>
              record.getCell(col).value !== null &&
              record.getCell(col).value !== undefined &&
              record.getCell(col).value !== '',
          );
      if (!rawCode && !rawName && !hasAmounts && (!legacy || !text(record.getCell(7)))) continue;
      if (!department || matches.length !== 1) {
        unknownDepartments.push({ organization, department, sheet: sheet.name, row });
        issue(
          'error',
          sheet.name,
          row,
          `部门“${department || '未填写'}”无法唯一匹配，请使用标准模板填写部门 ID 或提供映射`,
        );
        continue;
      }
      if (!code || !name || code.length > 80 || name.length > 200) {
        issue('error', sheet.name, row, '项目编号或名称缺失、过长，请检查合并单元格及分类');
        continue;
      }
      const departmentRecord = matches[0];
      const year = yearCol ? text(record.getCell(yearCol)) || options.year : options.year;
      if (year !== options.year) {
        issue('error', sheet.name, row, `表内年度“${year}”与选择的年度不一致`);
        continue;
      }
      try {
        const reimbursementCents = legacy
          ? addMoney(money(record.getCell(8)), money(record.getCell(11)))
          : money(record.getCell(reimbursementCol!));
        const directPaymentCents = legacy
          ? addMoney(money(record.getCell(10)), money(record.getCell(13)))
          : money(record.getCell(directCol!));
        const mealCents = legacy
          ? addMoney(money(record.getCell(9)), money(record.getCell(12)))
          : 0;
        if (mealCents)
          issue(
            'error',
            sheet.name,
            row,
            '存在工作餐额度，不能自动归入报销或代发，请先明确应归属的渠道',
          );
        const key = JSON.stringify([year, departmentRecord.id, code]);
        let entry = grouped.get(key);
        if (!entry) {
          entry = {
            year,
            departmentId: departmentRecord.id,
            departmentName: departmentRecord.name,
            portId: departmentRecord.portId,
            code,
            name,
            reimbursementCents: 0,
            directPaymentCents: 0,
            notes: '',
            sourceRows: [],
            totalCents: 0,
            hasTotal: false,
            noteParts: new Set(),
          };
          grouped.set(key, entry);
          if (rawPort && departmentRecord.portId !== rawPort)
            issue(
              'warning',
              sheet.name,
              row,
              `已按现有部门目录归入${FINANCE_PORTS.find(({ id }) => id === departmentRecord.portId)!.name}，原表组织为${organization}`,
            );
        }
        if (entry.name !== name) {
          issue('error', sheet.name, row, `同一项目编号“${code}”出现不同名称，请先合并确认`);
          continue;
        }
        entry.reimbursementCents = addMoney(entry.reimbursementCents, reimbursementCents);
        entry.directPaymentCents = addMoney(entry.directPaymentCents, directPaymentCents);
        entry.sourceRows.push({ sheet: sheet.name, row });
        if (notesCol && text(record.getCell(notesCol)))
          entry.noteParts.add(text(record.getCell(notesCol)));
        if (legacy) {
          if (text(record.getCell(6))) {
            entry.totalCents = addMoney(entry.totalCents, money(record.getCell(6)));
            entry.hasTotal = true;
          }
          const fund = text(record.getCell(14));
          if (fund) entry.noteParts.add(`其他经费来源：${fund}`);
          if (text(record.getCell(15)))
            issue('warning', sheet.name, row, `原表标记有待讨论：${text(record.getCell(15))}`);
        }
      } catch (error) {
        issue('error', sheet.name, row, error instanceof Error ? error.message : '金额格式无效');
      }
    }
  }
  const entries = [...grouped.values()].map(({ totalCents, hasTotal, noteParts, ...entry }) => {
    if (hasTotal && totalCents !== entry.reimbursementCents + entry.directPaymentCents)
      issue(
        'error',
        entry.sourceRows[0].sheet,
        entry.sourceRows[0].row,
        `项目 ${entry.code} 的花销总计与报销、代发合计不一致`,
      );
    const notes = [...noteParts].join('\n');
    if (notes.length > 4000)
      issue(
        'error',
        entry.sourceRows[0].sheet,
        entry.sourceRows[0].row,
        `项目 ${entry.code} 的合并备注超过 4000 字，请精简后重试`,
      );
    return { ...entry, notes };
  });
  if (!entries.length) issue('error', '', 0, '没有找到可导入的预算项目，请检查模板或组织筛选');
  return { entries, issues, unknownDepartments };
}

export async function createFinanceImportTemplate(): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('预算导入');
  sheet.addRow([
    '年度',
    '组织',
    '部门',
    '项目编号',
    '项目名称',
    '报销额度（元）',
    '代发额度（元）',
    '备注',
  ]);
  sheet.addRow([
    '2026-2027',
    '团委',
    'youth_league.practice',
    '2-1-1',
    '示例项目（请替换）',
    0,
    0,
    '部门可填写系统部门 ID；金额单位为元',
  ]);
  sheet.columns.forEach((column, index) => {
    column.width = index === 7 ? 50 : 24;
  });
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  return Buffer.from(await book.xlsx.writeBuffer());
}
