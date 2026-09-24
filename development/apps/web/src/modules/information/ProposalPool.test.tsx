import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { UserContext } from '@freebbs-development/contracts';
import type { ApiClient } from '../../core/api/client.js';
import { MemoryRouter } from 'react-router-dom';
import { ProposalPool } from './ProposalPool.js';

const student: UserContext = {
  uid: 'proposal-student',
  displayName: '普通同学',
  avatarUrl: null,
  baseRole: 'student',
  roles: [],
  tags: [],
};

const publicProposal = {
  id: 'proposal-1',
  title: '增加夜间自习空间',
  problemDescription: '考试周座位不足',
  proposedSolution: '延长公共教室开放时间',
  category: 'campus_service',
  submitterUid: 'proposal-student',
  assigneeUid: 'rights-owner',
  dueAt: '2026-10-08T10:00:00.000Z',
  publicProgress: '已提交',
  status: 'submitted' as const,
  createdAt: '2026-07-29T00:00:00.000Z',
  updatedAt: '2026-07-29T00:00:00.000Z',
};

function proposalClient() {
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (path === '/information/proposals' && method === 'GET') return [publicProposal];
    if (path === '/information/proposals' && method === 'POST') return publicProposal;
    throw new Error(`Unexpected request: ${method} ${path}`);
  });
  return { request } as unknown as ApiClient;
}

describe('ProposalPool', () => {
  it('links each public proposal to its readable route while allowing student submissions', async () => {
    const client = proposalClient();
    const actor = userEvent.setup();
    render(
      <MemoryRouter>
        <ProposalPool client={client} user={student} />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('table', { name: '公开提案池' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '查看 增加夜间自习空间' })).toHaveAttribute(
      'href',
      '/information/proposals/proposal-1',
    );

    await actor.type(screen.getByLabelText('提案标题'), '增加夜间自习空间');
    await actor.type(screen.getByLabelText('问题描述'), '考试周座位不足');
    await actor.type(screen.getByLabelText('建议方案'), '延长公共教室开放时间');
    await actor.type(screen.getByLabelText('提案类别'), 'campus_service');
    await actor.click(screen.getByRole('button', { name: '提交提案' }));

    expect(client.request).toHaveBeenCalledWith(
      '/information/proposals',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
