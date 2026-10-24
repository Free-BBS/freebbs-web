import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  createFinanceImportTemplate,
  parseFinanceBudgetWorkbook,
  validateFinanceWorkbookArchive,
} from './import-parser.js';
import type { FinanceDepartment } from '@freebbs-development/contracts';

describe('finance workbook archive bounds', () => {
  it('accepts a normal ExcelJS workbook without writing its contents to disk', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('预算');
    sheet.addRow(['部门', '项目编号', '项目名称', '报销', '代发']);
    sheet.addRow(['实践组', '2-1-1', '实践活动', 100, 50]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    expect(() => validateFinanceWorkbookArchive(buffer)).not.toThrow();
  });

  it('rejects invalid archives and input larger than eight megabytes', () => {
    expect(() => validateFinanceWorkbookArchive(Buffer.from('not xlsx'))).toThrow();
    expect(() => validateFinanceWorkbookArchive(Buffer.alloc(8 * 1024 * 1024 + 1))).toThrow();
  });

  it('bounds actual inflation even if a ZIP central directory lies about its size', async () => {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types/>');
    zip.file('xl/workbook.xml', '<workbook/>');
    zip.file('xl/worksheets/sheet1.xml', 'x'.repeat(11 * 1024 * 1024));
    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    let offset = 0;
    while ((offset = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), offset)) !== -1) {
      buffer.writeUInt32LE(1, offset + 24);
      offset += 4;
    }
    expect(() => validateFinanceWorkbookArchive(buffer)).toThrow();
  });

  it('rejects worksheets with excessive rows and macro content', async () => {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types/>');
    zip.file('xl/workbook.xml', '<workbook/>');
    zip.file('xl/worksheets/sheet1.xml', `<worksheet>${'<row/>'.repeat(5001)}</worksheet>`);
    const excessiveRows = await zip.generateAsync({ type: 'nodebuffer' });
    expect(() => validateFinanceWorkbookArchive(excessiveRows)).toThrow();
    zip.remove('xl/worksheets/sheet1.xml');
    zip.file('xl/vbaProject.bin', 'macro');
    const macro = await zip.generateAsync({ type: 'nodebuffer' });
    expect(() => validateFinanceWorkbookArchive(macro)).toThrow();
  });
});

const departments: FinanceDepartment[] = [
  { id: 'practice', name: '实践组', portId: 'youth_league' },
  { id: 'sports', name: '体育中心', portId: 'sports' },
];
const standard = [
  '年度',
  '组织',
  '部门',
  '项目编号',
  '项目名称',
  '报销额度（元）',
  '代发额度（元）',
  '备注',
];
const legacy = [
  '工作口',
  '部门名称',
  '预算编号',
  '预算名称',
  '开展时间',
  '花销总计',
  '预算内容',
  '报销（学生活动经费）',
  '工作餐（学生活动经费）',
  '代发（学生活动经费）',
  '报销（其他经费）',
  '工作餐（其他经费）',
  '代发（其他经费）',
  '其他经费名称',
  '有待讨论',
  '测算方式',
  '备注',
];
async function bytes(rows: ExcelJS.CellValue[][], configure?: (sheet: ExcelJS.Worksheet) => void) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('预算明细');
  rows.forEach((row) => sheet.addRow(row));
  configure?.(sheet);
  return Buffer.from(await book.xlsx.writeBuffer());
}
const parse = (buffer: Buffer) =>
  parseFinanceBudgetWorkbook(buffer, { year: '2026-2027', departments });

describe('finance workbook semantics', () => {
  it('groups detailed lines by department/year/project and counts subtotal rows only once', async () => {
    const result = await parse(
      await bytes(
        [
          legacy,
          ['团委', '2-1\n实践组', '2-1-1', '实践活动', '', 160, '车费', 100, null, null, 20],
          [null, null, null, null, null, null, '补贴', null, null, 40],
          ['团委合计', null, null, null, null, 160, null, 120, null, 40],
        ],
        (sheet) =>
          ['A2:A3', 'B2:B3', 'C2:C3', 'D2:D3', 'F2:F3'].forEach((range) => sheet.mergeCells(range)),
      ),
    );
    expect(result.issues).toEqual([]);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      reimbursementCents: 12000,
      directPaymentCents: 4000,
      sourceRows: [{ row: 2 }, { row: 3 }],
    });
  });

  it('does not fill merged monetary cells down into duplicate amounts', async () => {
    const result = await parse(
      await bytes(
        [
          legacy,
          ['团委', '实践组', '2-1-1', '实践活动', '', 100, '物料', 100],
          [null, null, null, null, null, null, '明细说明'],
        ],
        (sheet) =>
          ['A2:A3', 'B2:B3', 'C2:C3', 'D2:D3', 'F2:F3', 'H2:H3'].forEach((range) =>
            sheet.mergeCells(range),
          ),
      ),
    );
    expect(result.entries[0].reimbursementCents).toBe(10000);
    expect(result.issues).toEqual([]);
  });

  it('rejects uncached formulas and unsafe or negative amounts instead of silently converting them to zero', async () => {
    for (const value of [
      { formula: 'SUM(1,2)' },
      -1,
      1.234,
      { error: '#VALUE!' },
      '待定',
    ] as ExcelJS.CellValue[]) {
      const result = await parse(
        await bytes([standard, ['', '团委', '实践组', '2-1-1', '实践活动', value, 0, '']]),
      );
      expect(result.issues.some(({ severity }) => severity === 'error')).toBe(true);
    }
    const cached = await parse(
      await bytes([
        standard,
        [
          '',
          '团委',
          'practice',
          '2-1-1',
          '实践活动',
          { formula: '10+2.34', result: 12.34 },
          '1,000.00',
          '',
        ],
      ]),
    );
    expect(cached.entries[0]).toMatchObject({
      reimbursementCents: 1234,
      directPaymentCents: 100000,
    });
    expect(cached.issues).toEqual([]);
  });

  it('blocks nonzero meal channels and mismatched F totals without silently recategorizing either', async () => {
    const meal = await parse(
      await bytes([legacy, ['团委', '实践组', '2-1-1', '实践活动', '', 120, '费用', 100, 20]]),
    );
    expect(meal.issues.some(({ message }) => message.includes('工作餐'))).toBe(true);
    const mismatch = await parse(
      await bytes([legacy, ['团委', '实践组', '2-1-1', '实践活动', '', 200, '费用', 100]]),
    );
    expect(mismatch.issues.some(({ message }) => message.includes('总计'))).toBe(true);
  });

  it('blocks unknown or ambiguous departments and supports explicit mapping without guessing', async () => {
    const buffer = await bytes([
      standard,
      ['', '团委', '自定义组', '2-1-1', '实践活动', 100, 0, ''],
    ]);
    const unknown = await parse(buffer);
    expect(unknown.unknownDepartments).toMatchObject([
      { organization: '团委', department: '自定义组', row: 2 },
    ]);
    const mapped = await parseFinanceBudgetWorkbook(buffer, {
      year: '2026-2027',
      departments,
      mappings: [{ organization: '团委', department: '自定义组', departmentId: 'practice' }],
    });
    expect(mapped.issues).toEqual([]);
    expect(mapped.entries[0].departmentId).toBe('practice');
    const ambiguous = await parseFinanceBudgetWorkbook(
      await bytes([standard, ['', '联合组织', '实践组', '2-1-1', '实践活动', 100, 0, '']]),
      {
        year: '2026-2027',
        departments: [...departments, { id: 'another-practice', name: '实践组', portId: 'bbs' }],
      },
    );
    expect(ambiguous.unknownDepartments).toHaveLength(1);
  });

  it('maps a uniquely named sports department to its current port and applies organization filters after resolving it', async () => {
    const buffer = await bytes([
      legacy,
      ['学生会', '体育中心', '3-2-1', '体育活动', '', 100, '器材', 100],
    ]);
    const sports = await parseFinanceBudgetWorkbook(buffer, {
      year: '2026-2027',
      departments,
      organizationId: 'sports',
    });
    expect(sports.entries[0].portId).toBe('sports');
    expect(
      sports.issues.some(
        ({ severity, message }) => severity === 'warning' && message.includes('原表组织'),
      ),
    ).toBe(true);
    const union = await parseFinanceBudgetWorkbook(buffer, {
      year: '2026-2027',
      departments,
      organizationId: 'student_union',
    });
    expect(union.entries).toEqual([]);
  });

  it('loads valid prefixed SpreadsheetML generated by third-party tools', async () => {
    const zip = await JSZip.loadAsync(
      await bytes([standard, ['', '团委', '实践组', '2-1-1', '实践活动', 100, 0, '']]),
    );
    for (const entry of Object.values(zip.files)) {
      if (entry.dir || !/\.xml$/.test(entry.name)) continue;
      let xml = await entry.async('string');
      if (!xml.includes('xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'))
        continue;
      xml = xml
        .replace(
          'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
          'xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
        )
        .replace(/<(\/?)([A-Za-z][\w]*)(?=[\s/>])/g, '<$1x:$2');
      zip.file(entry.name, xml);
    }
    const result = await parse(await zip.generateAsync({ type: 'nodebuffer' }));
    expect(result.entries[0].reimbursementCents).toBe(10000);
    expect(result.issues).toEqual([]);
  });

  it('returns a working template and detects inconsistent project names or years', async () => {
    const template = await parseFinanceBudgetWorkbook(await createFinanceImportTemplate(), {
      year: '2026-2027',
      departments: [{ id: 'youth_league.practice', name: '实践组', portId: 'youth_league' }],
    });
    expect(template.entries).toHaveLength(1);
    const duplicate = await parse(
      await bytes([
        standard,
        ['', '团委', '实践组', 'same', '项目甲', 10, 0, ''],
        ['', '团委', '实践组', 'same', '项目乙', 20, 0, ''],
      ]),
    );
    expect(duplicate.issues.some(({ message }) => message.includes('不同名称'))).toBe(true);
    const year = await parse(
      await bytes([standard, ['2025-2026', '团委', '实践组', 'same', '项目甲', 10, 0, '']]),
    );
    expect(year.issues.some(({ message }) => message.includes('年度'))).toBe(true);
  });

  it('rejects alternate ZIP entry names and oversized ranges before ExcelJS allocation', async () => {
    const archive = await bytes([standard]);
    const central = Buffer.from(archive);
    const name = Buffer.from('xl/worksheets/sheet1.xml');
    let index = central.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    while (index !== -1) {
      if (central.subarray(index + 46, index + 46 + name.length).equals(name)) {
        central[index + 46 + 11] = 'a'.charCodeAt(0);
        break;
      }
      index = central.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), index + 4);
    }
    expect(() => validateFinanceWorkbookArchive(central)).toThrow();
    const zip = await JSZip.loadAsync(archive);
    const sheet = zip.file('xl/worksheets/sheet1.xml')!;
    zip.file(
      sheet.name,
      (await sheet.async('string')).replace(
        '</worksheet>',
        '<mergeCells count="1"><mergeCell ref="A1:CV1001"/></mergeCells></worksheet>',
      ),
    );
    const oversized = await zip.generateAsync({ type: 'nodebuffer' });
    expect(() => validateFinanceWorkbookArchive(oversized)).toThrow();
  });
});
