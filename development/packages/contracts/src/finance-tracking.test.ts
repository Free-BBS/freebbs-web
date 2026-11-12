import { describe, expect, it } from 'vitest';
import { financeClaimChecklist, financeClaimWarnings } from './finance-tracking.js';

describe('financial material requirements', () => {
  it('merges every applicable material once and keeps the individual-invoice thresholds', () => {
    const input = {
      kind: 'reimbursement' as const,
      invoiceLines: [
        { category: 'distributed_goods' as const, amountCents: 100001, repeatCount: 2 },
        { category: 'distributed_goods' as const, amountCents: 500001, repeatCount: 1 },
      ],
      materialSituations: ['ride_hailing', 'unclear_invoice', 'printing', 'printing'] as const,
    };
    const checklist = financeClaimChecklist({
      ...input,
      materialSituations: [...input.materialSituations],
    });
    const keys = checklist.map(({ key }) => key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(
      expect.arrayContaining([
        'material_situations_confirmed',
        'payment_screenshot_ready',
        'distribution_list_ready',
        'ride_itinerary_ready',
        'invoice_order_ready',
        'printing_details_ready',
      ]),
    );
    expect(checklist.find(({ key }) => key === 'ride_itinerary_ready')!.label).toContain('起终点');
    expect(checklist.find(({ key }) => key === 'invoice_order_ready')!.label).toContain('完全一致');
    expect(checklist.find(({ key }) => key === 'printing_details_ready')!.label).toContain('盖章');
    expect(checklist.find(({ key }) => key === 'distribution_list_ready')!.label).toContain('签字');
    expect(financeClaimWarnings(input)).toHaveLength(1);
    expect(
      financeClaimChecklist({
        kind: 'reimbursement',
        invoiceLines: [{ category: 'other', amountCents: 100000, repeatCount: 99 }],
      }).map(({ key }) => key),
    ).not.toContain('payment_screenshot_ready');
    expect(
      financeClaimWarnings({
        kind: 'reimbursement',
        invoiceLines: [{ category: 'venue', amountCents: 500001, repeatCount: 1 }],
      }),
    ).toEqual([]);
  });

  it('does not ask unrelated reimbursement materials for ordinary claims or direct payments', () => {
    const ordinary = financeClaimChecklist({ kind: 'reimbursement' }).map(({ key }) => key);
    expect(ordinary).toContain('material_situations_confirmed');
    for (const key of [
      'payment_screenshot_ready',
      'distribution_list_ready',
      'ride_itinerary_ready',
      'invoice_order_ready',
      'printing_details_ready',
    ])
      expect(ordinary).not.toContain(key);
    const direct = financeClaimChecklist({
      kind: 'direct_payment',
      materialSituations: ['ride_hailing', 'unclear_invoice', 'printing'],
      invoiceLines: [{ category: 'distributed_goods', amountCents: 500001, repeatCount: 1 }],
    }).map(({ key }) => key);
    expect(direct).toEqual(['payee_confirmed', 'approval_route_acknowledged', 'work_proof_ready']);
  });
});
