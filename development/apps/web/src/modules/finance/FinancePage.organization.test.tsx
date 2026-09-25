import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { FinancePage } from './FinancePage.js';

describe('FinancePage organization governance', () => {
  it('shows organization context and uses the dedicated review endpoint for Tuanwei oversight', async () => {
    const reviewer = {
      uid: 'tuanwei-lead',
      displayName: 'Tuanwei lead',
      avatarUrl: null,
      baseRole: 'student' as const,
      roles: ['affiliation.tuanwei_lead' as const],
      tags: [],
      policies: [
        {
          id: 'finance-all',
          action: 'finance.*',
          resource: '*',
          effect: 'allow' as const,
        },
      ],
    };
    let record = {
      id: 'finance-arts',
      title: 'Arts annual budget',
      kind: 'budget' as const,
      amountCents: 8800,
      activityId: null,
      organizationId: 'arts_center' as const,
      status: 'submitted' as 'submitted' | 'approved',
      ownerUid: 'arts-lead',
      scope: { type: 'social_organization', id: 'arts_center' },
      reviewerUid: null as string | null,
      reviewedAt: null as string | null,
      reviewDecision: null as 'approved' | 'rejected' | null,
      createdAt: '2026-07-22T00:00:00.000Z',
      updatedAt: '2026-07-22T00:00:00.000Z',
    };
    const requestMock = vi.fn(async (path: string, init?: RequestInit): Promise<unknown> => {
      if (path === '/finance/records' && init === undefined) return [record];
      if (path === '/finance/records/finance-arts/reviews') {
        expect(JSON.parse(String(init?.body))).toEqual({ decision: 'approved' });
        record = {
          ...record,
          status: 'approved',
          reviewerUid: reviewer.uid,
          reviewedAt: '2026-07-29T08:00:00.000Z',
          reviewDecision: 'approved',
        };
        return record;
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const request = requestMock as unknown as <T>(path: string, init?: RequestInit) => Promise<T>;

    render(<FinancePage client={{ request }} user={reviewer} />);

    expect(
      await screen.findByText(`\u7ec4\u7ec7\uff1a\u6587\u827a\u4e2d\u5fc3`),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '\u6279\u51c6' }));

    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        '/finance/records/finance-arts/reviews',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ decision: 'approved' }),
        }),
      ),
    );
    expect(await screen.findByText(/tuanwei-lead/)).toBeInTheDocument();
  });
});
