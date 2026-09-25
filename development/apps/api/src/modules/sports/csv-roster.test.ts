import { describe, expect, it } from 'vitest';

import { parseRosterCsv, RosterCsvError } from './csv-roster.js';

const header = '\u59d3\u540d,\u5b66\u53f7';
const zhangSan = '\u5f20\u4e09';
const liSi = '\u674e\u56db';

describe('parseRosterCsv', () => {
  it('accepts BOM, CRLF, quoted commas, and escaped quotes', () => {
    expect(parseRosterCsv(`\uFEFF${header}\r\n${zhangSan},20260001`)).toEqual([
      { row: 2, name: zhangSan, studentNumber: '20260001', outcome: 'ready' },
    ]);
    expect(parseRosterCsv(`${header}\n"${zhangSan},",20260002\n"${liSi}""",20260003`)).toEqual([
      { row: 2, name: `${zhangSan},`, studentNumber: '20260002', outcome: 'ready' },
      { row: 3, name: `${liSi}"`, studentNumber: '20260003', outcome: 'ready' },
    ]);
  });

  it('rejects invalid headers and extra columns', () => {
    expect(() => parseRosterCsv(`\u5b66\u53f7,\u59d3\u540d\n20260001,${zhangSan}`)).toThrow(
      RosterCsvError,
    );
    expect(() => parseRosterCsv(`${header}\n${zhangSan},20260001,extra`)).toThrow(RosterCsvError);
  });

  it('marks repeated student numbers without dropping either row', () => {
    const rows = parseRosterCsv(`${header}\n${zhangSan},20260001\n${zhangSan},20260001`);
    expect(rows).toHaveLength(2);
    expect(rows[1]?.outcome).toBe('duplicate_in_file');
  });

  it('rejects oversized and malformed CSV', () => {
    expect(() => parseRosterCsv(`${header}\n${'a'.repeat(262_145)},20260001`)).toThrow(/256 KiB/);
    expect(() => parseRosterCsv(`${header}\n"${zhangSan},20260001`)).toThrow(/quote/);
  });
});
