import { describe, expect, it } from 'vitest';
import type { FinanceBudgetProject } from './finance-tracking.js';
import {
  financeBudgetPoolCode,
  financeBudgetPoolOverlaps,
  financeBudgetPools,
} from './finance-budget-pools.js';

const project = (
  code: string,
  reimbursementCents: number,
  directPaymentCents = 0,
  departmentId = 'media_center.video',
  year = '2026-2027',
): FinanceBudgetProject => ({
  id: `${year}:${departmentId}:${code}`,
  year,
  departmentId,
  code,
  name: code,
  reimbursementCents,
  directPaymentCents,
  notes: `来源 ${code}`,
  revision: 1,
  updatedAt: '2026-11-04T00:00:00Z',
});

describe('finance budget allowance pools', () => {
  it('preserves the full code of ordinary projects and each team', () => {
    const pools = financeBudgetPools([
      project('5-3-1', 1068000),
      project('5-3-3', 600000, 200000),
      project('6-1', 100000, 300000),
      project('6-2', 80000),
    ]);
    expect(pools.map((p) => p.code)).toEqual(['5-3-1', '5-3-3', '6-1', '6-2']);
    expect(pools[1]).toMatchObject({ reimbursementCents: 600000, directPaymentCents: 200000 });
    expect(financeBudgetPoolCode('5-3-1-1')).toBe('5-3-1-1');
  });
  it.each(['2-8', '3-5', '4-6', '5-4'])(
    'combines %s without losing channel amounts or original IDs',
    (prefix) => {
      const source = [
        project(`${prefix}-3`, 165000, 10000),
        project(`${prefix}-1`, 231000),
        project(`${prefix}-2`, 99000),
      ];
      const [pool] = financeBudgetPools(source);
      expect(pool).toMatchObject({
        code: prefix,
        reimbursementCents: 495000,
        directPaymentCents: 10000,
        name: '团建与部门建设',
      });
      expect(pool.memberProjectIds).toEqual([source[1].id, source[2].id, source[0].id]);
      expect(pool.notes).toContain(`来源 ${prefix}-1`);
      expect(source[0].code).toBe(`${prefix}-3`);
      expect(financeBudgetPoolOverlaps(source)).toEqual([]);
    },
  );
  it('never combines years or departments and never folds department names by a loose prefix', () => {
    expect(
      financeBudgetPools([
        project('5-4-1', 100),
        project('5-4-2', 100, 0, 'other'),
        project('5-4-2', 100, 0, 'media_center.video', '2025-2026'),
        project('5-40-1', 100),
      ]),
    ).toHaveLength(4);
  });
  it('detects parent totals imported together with their source children', () => {
    expect(
      financeBudgetPoolOverlaps([project('5-4', 495000), project('5-4-1', 231000)]),
    ).toHaveLength(1);
    expect(financeBudgetPoolOverlaps([project('5-3', 100), project('5-3-1', 100)])).toEqual([]);
  });
  it('rejects numeric overflow instead of presenting a rounded allowance', () => {
    expect(() =>
      financeBudgetPools([project('5-4-1', Number.MAX_SAFE_INTEGER), project('5-4-2', 1)]),
    ).toThrow('预算额度合计');
  });
});
