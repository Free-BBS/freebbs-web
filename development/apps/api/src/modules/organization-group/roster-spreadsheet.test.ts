import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import type { UserContext } from '@freebbs-development/contracts';
import { initialState } from './domain.js';
import {
  parseRosterWorkbook,
  previewRosterWorkbook,
  rosterWorkbookTemplate,
} from './roster-spreadsheet.js';
import { replaceClassRosters } from './roster-service.js';

const manager: UserContext = {
  uid: 'manager',
  displayName: '管理员',
  avatarUrl: null,
  baseRole: 'student',
  roles: [],
  tags: [],
};
function state() {
  const data = initialState();
  data.managerUids = ['manager'];
  data.classes = [
    { id: 'a', label: '无55' },
    { id: 'b', label: '无54' },
  ];
  return data;
}
async function workbook(rows: ExcelJS.CellValue[][], name = '班级名单') {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet(name);
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await book.xlsx.writeBuffer());
}
const headers = ['班级', '姓名', '学号'];

describe('Excel class roster import', () => {
  it('produces a real template with text student IDs and current configured class references', async () => {
    const buffer = await rosterWorkbookTemplate(state().classes);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buffer as unknown as Parameters<typeof book.xlsx.load>[0]);
    expect(book.getWorksheet('班级名单')!.getRow(1).values).toEqual([undefined, ...headers]);
    expect(book.getWorksheet('班级名单')!.getColumn(3).numFmt).toBe('@');
    expect(book.getWorksheet('班级对照')!.getRow(2).values).toEqual([undefined, 'a', '无55']);
  });

  it('previews append by configured ID/label, keeps namesakes distinct and does not persist anything', async () => {
    const data = state();
    replaceClassRosters(data, manager, [
      {
        classId: 'a',
        revision: 0,
        members: [{ id: 'old', displayName: '同名同学', studentId: '001' }],
      },
    ]);
    const before = JSON.stringify(data);
    const parsed = await parseRosterWorkbook(
      await workbook([
        headers,
        ['无55', '同名同学', '001'],
        ['a', '同名同学'],
        ['b', '另一位同学', '0002'],
      ]),
    );
    const preview = previewRosterWorkbook(data, manager, parsed, 'append');
    expect(preview.classes[0]).toMatchObject({
      beforeCount: 1,
      afterCount: 2,
      unchangedCount: 1,
      removed: [],
      updated: [],
    });
    expect(preview.classes[0]!.added).toEqual([{ displayName: '同名同学' }]);
    expect(preview.batches[0]!.members).toEqual([
      { id: 'old', displayName: '同名同学', studentId: '001' },
      { displayName: '同名同学' },
    ]);
    expect(preview.classes[1]!.added[0]!.studentId).toBe('0002');
    expect(preview.warnings.join('')).toContain('不按姓名合并');
    expect(JSON.stringify(data)).toBe(before);
  });

  it('replacement explicitly reports removals and name changes, preserves ID by student ID and immutable history', async () => {
    const data = state();
    replaceClassRosters(data, manager, [
      {
        classId: 'a',
        revision: 0,
        members: [
          { id: 'renamed', displayName: '旧姓名', studentId: '001' },
          { id: 'removed', displayName: '离班同学' },
        ],
      },
      { classId: 'b', revision: 0, members: [{ id: 'other', displayName: '不涉及班级' }] },
    ]);
    const history = structuredClone(data.classRosters![0]!.history[0]);
    const other = structuredClone(data.classRosters![1]);
    const parsed = await parseRosterWorkbook(
      await workbook([headers, ['a', '新姓名', '001'], ['a', '新同学']]),
    );
    const preview = previewRosterWorkbook(data, manager, parsed, 'replace');
    expect(preview.classes[0]!.updated).toEqual([
      {
        before: { id: 'renamed', displayName: '旧姓名', studentId: '001' },
        after: { id: 'renamed', displayName: '新姓名', studentId: '001' },
      },
    ]);
    expect(preview.classes[0]!.removed.map((item) => item.id)).toEqual(['removed']);
    replaceClassRosters(data, manager, preview.batches, true);
    expect(data.classRosters![0]!.history[0]).toEqual(history);
    expect(data.classRosters![0]!.members[0]!.id).toBe('renamed');
    expect(data.classRosters![1]).toEqual(other);
  });

  it('append rejects an existing student ID under a different name; unchanged rows produce no write batches', async () => {
    const data = state();
    replaceClassRosters(data, manager, [
      { classId: 'a', revision: 0, members: [{ displayName: '原姓名', studentId: '001' }] },
    ]);
    const renamed = await parseRosterWorkbook(await workbook([headers, ['a', '别的姓名', '001']]));
    expect(() => previewRosterWorkbook(data, manager, renamed, 'append')).toThrow(
      '增量模式不修改旧成员',
    );
    const same = await parseRosterWorkbook(await workbook([headers, ['a', '原姓名', '001']]));
    expect(previewRosterWorkbook(data, manager, same, 'append').batches).toEqual([]);
  });

  it('rejects unknown or ambiguous classes and duplicate student IDs without changing state', async () => {
    const data = state();
    for (const rows of [
      [headers, ['未配置', '甲']],
      [headers, ['a', '甲', '001'], ['a', '乙', '001']],
    ]) {
      const parsed = await parseRosterWorkbook(await workbook(rows));
      expect(() => previewRosterWorkbook(data, manager, parsed, 'replace')).toThrow();
    }
    data.classes.push({ id: 'c', label: '无55' });
    const parsed = await parseRosterWorkbook(await workbook([headers, ['无55', '甲']]));
    expect(() => previewRosterWorkbook(data, manager, parsed, 'append')).toThrow('有重名');
    expect(data.classRosters).toBeUndefined();
  });

  it.each([
    { formula: 'WEBSERVICE("https://example.invalid")', result: '伪姓名' },
    { text: '点此', hyperlink: 'https://example.invalid' },
  ])(
    'rejects formula/hyperlink cells instead of using cached or external content',
    async (value) => {
      await expect(parseRosterWorkbook(await workbook([headers, ['a', value]]))).rejects.toThrow(
        '公式或非纯文字',
      );
    },
  );

  it('rejects incomplete rows, unsupported headers, extra data sheets and empty workbooks', async () => {
    for (const rows of [[['姓名'], ['甲']], [headers, ['a', '']], [headers]]) {
      await expect(parseRosterWorkbook(await workbook(rows))).rejects.toThrow();
    }
    const book = new ExcelJS.Workbook();
    book.addWorksheet('班级名单').addRow(headers);
    book.addWorksheet('遗漏的班级').addRow(['a', '甲']);
    await expect(parseRosterWorkbook(Buffer.from(await book.xlsx.writeBuffer()))).rejects.toThrow(
      '其他数据工作表',
    );
  });

  it('enforces per-class rows and rejects unsafe numeric student IDs', async () => {
    await expect(
      parseRosterWorkbook(await workbook([headers, ['a', '甲', Number.MAX_SAFE_INTEGER + 1]])),
    ).rejects.toThrow('非纯文字');
    const parsed = await parseRosterWorkbook(
      await workbook([
        headers,
        ...Array.from({ length: 2001 }, (_, index) => ['a', `同学${index}`]),
      ]),
    );
    expect(() => previewRosterWorkbook(state(), manager, parsed, 'append')).toThrow('超过 2000');
  });

  it('bounds compressed files, actual ZIP inflation, forged expansion sizes, XML row ranges and macro archives before ExcelJS', async () => {
    await expect(parseRosterWorkbook(Buffer.alloc(8 * 1024 * 1024 + 1))).rejects.toMatchObject({
      status: 413,
    });
    await expect(parseRosterWorkbook(Buffer.from('not an XLSX'))).rejects.toThrow();
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types/>');
    zip.file('xl/workbook.xml', '<workbook/>');
    zip.file('xl/worksheets/sheet1.xml', 'x'.repeat(11 * 1024 * 1024));
    const bomb = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    let offset = 0;
    while ((offset = bomb.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), offset)) !== -1) {
      bomb.writeUInt32LE(1, offset + 24);
      offset += 4;
    }
    await expect(parseRosterWorkbook(bomb)).rejects.toThrow();
    zip.file(
      'xl/worksheets/sheet1.xml',
      '<worksheet><row r="1000000"><c r="A1000000"/></row></worksheet>',
    );
    await expect(
      parseRosterWorkbook(await zip.generateAsync({ type: 'nodebuffer' })),
    ).rejects.toThrow();
    zip.remove('xl/worksheets/sheet1.xml');
    zip.file('xl/vbaProject.bin', 'macro');
    await expect(
      parseRosterWorkbook(await zip.generateAsync({ type: 'nodebuffer' })),
    ).rejects.toThrow();
  });
});
