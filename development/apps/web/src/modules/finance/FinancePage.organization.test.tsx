import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { FinancePage } from './FinancePage.js';

describe('FinancePage organization governance', () => {
  const broadPolicy = { action: 'finance.*', resource: '*', effect: 'allow' as const };
  const row = (organizationId: string, status: string = 'draft') => ({
    id: `finance-${organizationId}`,
    title: `${organizationId} budget`,
    kind: 'budget',
    amountCents: 100,
    activityId: null,
    organizationId,
    status,
    ownerUid: 'another-user',
    scope: { type: 'social_organization', id: organizationId },
    createdAt: '',
    updatedAt: '',
  });
  const clientFor = (records: unknown[]) => ({
    request: vi.fn(async (path: string) =>
      path === '/notifications/organizations' ? { organizations: [] } : records,
    ) as unknown as <T>(path: string, init?: RequestInit) => Promise<T>,
  });

  it.each([
    'department.arts_member',
    'department.arts_director',
    'media_center.creative.member',
  ] as const)(
    'shows a clean read-only budget view for %s even with legacy broad grants',
    async (role) => {
      const org = role.startsWith('media_center') ? 'media_center' : 'arts_center';
      render(
        <FinancePage
          client={clientFor(
            [row(org), row(org, 'submitted')].map((record, index) => ({
              ...record,
              id: String(index),
            })),
          )}
          user={{
            uid: 'reader',
            displayName: 'Reader',
            avatarUrl: null,
            baseRole: 'student',
            roles: [role],
            tags: [],
            policies: [broadPolicy],
          }}
        />,
      );
      expect(
        await screen.findByRole('region', {
          name: `${org === 'arts_center' ? '文艺中心' : '学生媒体中心'}预算概览`,
        }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: '创建财务草稿' })).not.toBeInTheDocument();
      for (const name of ['批准', '驳回', '提交审批', '保存修改']) {
        expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
      }
      expect(screen.queryByRole('button', { name: /^编辑 / })).not.toBeInTheDocument();
    },
  );

  it.each([
    'affiliation.tuanwei_lead',
    'youth_league.organization.deputy_secretary',
    'counselor.practice',
    'counselor.student_development',
  ] as const)(
    'does not show foreign approval controls to %s from a legacy wildcard',
    async (role) => {
      render(
        <FinancePage
          client={clientFor([row('arts_center', 'submitted')])}
          user={{
            uid: 'scoped',
            displayName: 'Scoped',
            avatarUrl: null,
            baseRole: 'student',
            roles: [role],
            tags: [],
            policies: [broadPolicy],
          }}
        />,
      );
      await screen.findByText('arts_center budget');
      expect(screen.queryByRole('button', { name: '批准' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '驳回' })).not.toBeInTheDocument();
    },
  );

  it.each([
    {
      role: 'student_union.finance' as const,
      org: 'arts_center',
      options: ['文艺中心', '联络中心', '体育中心', '权益发展中心'],
    },
    { role: 'youth_league.finance' as const, org: 'tuanwei', options: ['团委'] },
    { role: 'media_center.finance' as const, org: 'media_center', options: ['学生媒体中心'] },
    { role: 'counselor.innovation' as const, org: 'sast', options: ['科协'] },
  ])('limits $role finance controls to its own organizations', async ({ role, org, options }) => {
    render(
      <FinancePage
        client={clientFor([row(org, 'submitted')])}
        user={{
          uid: 'finance',
          displayName: 'Finance',
          avatarUrl: null,
          baseRole: 'student',
          roles: [role],
          tags: [],
          policies: [broadPolicy],
        }}
      />,
    );
    expect(await screen.findByText(`${org} budget`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '批准' })).toBeInTheDocument();
    expect(
      within(screen.getByLabelText('组织'))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(options);
    expect(screen.queryByRole('option', { name: '历史未归属' })).not.toBeInTheDocument();
  });

  it('browses server pages while keeping the complete authorized budget summary', async () => {
    const record = {
      id: 'paged',
      title: 'Paged record',
      kind: 'budget',
      amountCents: 100,
      organizationId: 'arts_center',
      status: 'approved',
      ownerUid: 'admin',
      scope: { type: 'social_organization', id: 'arts_center' },
      createdAt: '',
      updatedAt: '',
    };
    const requestMock = vi.fn(async (path: string) => {
      if (path === '/notifications/organizations') return { organizations: [] };
      const page = Number(new URL(path, 'http://local').searchParams.get('page') || 1);
      return {
        items: [{ ...record, title: `Page ${page}` }],
        total: 21,
        page,
        pageSize: 20,
        summaries: [
          {
            organizationId: 'arts_center',
            approvedBudget: 2100,
            remaining: 2100,
            spent: 0,
            pending: 0,
            usagePercent: 0,
          },
        ],
      };
    });
    const request = requestMock as unknown as <T>(path: string, init?: RequestInit) => Promise<T>;
    render(
      <FinancePage
        client={{ request }}
        user={{
          uid: 'admin',
          displayName: 'Admin',
          avatarUrl: null,
          baseRole: 'student',
          roles: ['platform.admin'],
          businessAdmin: true,
          tags: [],
        }}
      />,
    );
    expect(await screen.findByText('Page 1')).toBeInTheDocument();
    expect(screen.getAllByText('\u00a521.00')).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: '\u4e0b\u4e00\u9875' }));
    expect(await screen.findByText('Page 2')).toBeInTheDocument();
    expect(requestMock.mock.calls.some(([path]) => path.includes('page=2'))).toBe(true);
  });

  it('clears an organization with explicit null and resets the unlinked scope', async () => {
    const record = {
      id: 'clear-org',
      title: 'Clear organization',
      kind: 'budget',
      amountCents: 10000,
      activityId: null,
      organizationId: 'arts_center',
      status: 'draft',
      ownerUid: 'admin',
      scope: { type: 'social_organization', id: 'arts_center' },
      createdAt: '',
      updatedAt: '',
    };
    const mock = vi.fn(async (path: string, init?: RequestInit) => {
      if (path.startsWith('/finance/records') && !init) return [record];
      if (path === '/finance/records' && init?.method === 'PATCH')
        return { ...record, ...JSON.parse(String(init.body)) };
      if (path === '/notifications/organizations')
        return { organizations: [{ id: 'arts_center', name: 'Renamed arts' }] };
      throw new Error(path);
    });
    const request = mock as unknown as <T>(path: string, init?: RequestInit) => Promise<T>;
    render(
      <FinancePage
        client={{ request }}
        user={{
          uid: 'admin',
          displayName: 'Admin',
          avatarUrl: null,
          baseRole: 'student',
          roles: ['platform.admin'],
          businessAdmin: true,
          tags: [],
        }}
      />,
    );
    expect(await screen.findByText('\u7ec4\u7ec7\uff1aRenamed arts')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '\u7f16\u8f91 Clear organization' }));
    await userEvent.selectOptions(screen.getByLabelText('\u7f16\u8f91\u7ec4\u7ec7'), '');
    await userEvent.click(screen.getByRole('button', { name: '\u4fdd\u5b58\u4fee\u6539' }));
    await waitFor(() =>
      expect(mock).toHaveBeenCalledWith(
        '/finance/records',
        expect.objectContaining({
          method: 'PATCH',
          body: expect.stringContaining('"organizationId":null'),
        }),
      ),
    );
    const payload = JSON.parse(
      String(mock.mock.calls.find(([, init]) => init?.method === 'PATCH')?.[1]?.body),
    );
    expect(payload.scope).toEqual({ type: 'public', id: '*' });
  });

  it('shows organization context and uses the dedicated review endpoint for global counselor oversight', async () => {
    const reviewer = {
      uid: 'tuanwei-lead',
      displayName: 'Tuanwei lead',
      avatarUrl: null,
      baseRole: 'student' as const,
      roles: ['counselor.youth_league' as const],
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
      if (path.startsWith('/finance/records') && init === undefined) return [record];
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
