import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { Readable } from 'node:stream';
import { HttpError } from '../../core/errors/http-error.js';
import type { Recipient } from './feature-storage.js';

export async function xlsxBuffer(rows: unknown[][]): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('收集结果');
  for (const row of rows)
    sheet.addRow(
      row.map((value) =>
        value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value),
      ),
    );
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.columns.forEach((column) => {
    column.width = 24;
  });
  return Buffer.from(await book.xlsx.writeBuffer());
}
export function downloadName(name: string, extension?: string) {
  const safe =
    [...name]
      .map((character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? '_' : character,
      )
      .join('')
      .replace(/[/\\<>:"|?*]/gu, '_')
      .slice(0, 150) || '收集结果';
  return extension ? `${safe.replace(/\.[^.]+$/u, '')}.${extension}` : safe;
}
function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index++;
      } else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += character;
    if (rows.length > 10001) throw new HttpError(400, 'roster_too_large', '名单最多包含 10000 行');
  }
  if (quoted) throw new HttpError(400, 'invalid_csv', 'CSV 引号未闭合');
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
function cellText(value: ExcelJS.CellValue): string {
  if (value && typeof value === 'object') {
    // Formulas and hyperlinks must never become identities.
    if ('formula' in value || 'sharedFormula' in value || 'hyperlink' in value) return '';
    if ('richText' in value) return value.richText.map((part) => part.text).join('');
    return '';
  }
  return value == null ? '' : String(value);
}
async function boundWorkbookExpansion(buffer: Buffer): Promise<void> {
  try {
    const archive = await JSZip.loadAsync(buffer);
    const entries = Object.values(archive.files).filter((entry) => !entry.dir);
    if (entries.length > 1000) throw new HttpError(400, 'roster_too_large', 'Excel 文件内容过大');
    let expandedBytes = 0;
    // Stream the actual expanded data before ExcelJS builds XML objects. Declared ZIP sizes
    // are insufficient because forged central-directory metadata can understate expansion.
    for (const entry of entries) {
      for await (const chunk of new Readable().wrap(entry.nodeStream())) {
        expandedBytes += (chunk as Buffer).length;
        if (expandedBytes > 20 * 1024 * 1024)
          throw new HttpError(400, 'roster_too_large', 'Excel 解压后内容不能超过 20 MiB');
      }
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'invalid_workbook', 'Excel 文件无法读取');
  }
}
export async function parseRoster(buffer: Buffer, filename: string) {
  let rows: string[][];
  if (/\.csv$/iu.test(filename)) {
    const text = buffer.toString('utf8').replace(/^\uFEFF/u, '');
    if (text.includes('\uFFFD'))
      throw new HttpError(400, 'invalid_encoding', '请将 CSV 保存为 UTF-8 编码');
    rows = csvRows(text);
  } else if (/\.xlsx$/iu.test(filename)) {
    await boundWorkbookExpansion(buffer);
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    } catch {
      throw new HttpError(400, 'invalid_workbook', 'Excel 文件无法读取');
    }
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new HttpError(400, 'invalid_workbook', 'Excel 文件没有工作表');
    if (sheet.rowCount > 10001 || sheet.columnCount > 100)
      throw new HttpError(400, 'roster_too_large', '名单最多包含 10000 行、100 列');
    rows = [];
    for (let index = 1; index <= sheet.rowCount; index++)
      rows.push(
        Array.from({ length: sheet.columnCount }, (_, column) =>
          cellText(sheet.getRow(index).getCell(column + 1).value),
        ),
      );
  } else throw new HttpError(400, 'invalid_roster_type', '请上传 .xlsx 或 .csv 名单');
  const headers = (rows[0] ?? []).map((value) => value.trim());
  const nameColumn = headers.indexOf('姓名'),
    studentColumn = headers.indexOf('学号');
  if (nameColumn < 0 || studentColumn < 0)
    throw new HttpError(400, 'missing_roster_columns', '名单第一行必须包含“姓名”和“学号”列');
  const recipients: Recipient[] = [];
  const seen = new Map<string, string>();
  const rowNumbers: Record<string, number> = {};
  const errors: Array<{ row: number; message: string }> = [];
  let duplicates = 0;
  rows.slice(1).forEach((row, index) => {
    if (row.every((value) => !value.trim())) return;
    const name = (row[nameColumn] ?? '').trim(),
      studentId = (row[studentColumn] ?? '').trim();
    if (!name || name.length > 100 || !/^[A-Za-z0-9_-]{1,64}$/u.test(studentId)) {
      errors.push({ row: index + 2, message: '姓名或学号无效（学号请使用文本格式保留前导零）' });
      return;
    }
    if (seen.has(studentId)) {
      if (seen.get(studentId) !== name)
        errors.push({ row: index + 2, message: '同一学号对应不同姓名' });
      else duplicates++;
      return;
    }
    seen.set(studentId, name);
    rowNumbers[studentId] = index + 2;
    recipients.push({ name, studentId });
  });
  return { recipients, duplicates, errors, rowNumbers };
}
