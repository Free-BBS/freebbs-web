import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { expect, it } from 'vitest';
import { parseRoster } from './spreadsheets.js';
it('reads actual XLSX roster text, preserves leading zeros and refuses formula identity cells', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('名单');
  sheet.addRows([
    ['姓名', '学号'],
    ['张三', '00123'],
    ['李四', { formula: '1+1', result: '00456' }],
  ]);
  const parsed = await parseRoster(Buffer.from(await workbook.xlsx.writeBuffer()), '名单.xlsx');
  expect(parsed.recipients).toEqual([{ name: '张三', studentId: '00123' }]);
  expect(parsed.errors).toMatchObject([{ row: 3 }]);
});
it('rejects highly compressed oversized XLSX content before XML parsing', async () => {
  const zip = new JSZip();
  zip.file('xl/sharedStrings.xml', 'x'.repeat(21 * 1024 * 1024));
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  await expect(parseRoster(buffer, '名单.xlsx')).rejects.toMatchObject({
    code: 'roster_too_large',
  });
});
