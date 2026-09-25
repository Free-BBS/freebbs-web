import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type { UserContext } from '@freebbs-development/contracts';
import type { ApiClient } from '../../core/api/client.js';
import {
  ProposalDetailPage,
  formatProposalDueDate,
  localDateTimeInputToUtcInstant,
  utcInstantToLocalDateTimeInput,
} from './ProposalDetailPage.js';

const student: UserContext = {
  uid: 'proposal-student',
  displayName: '普通同学',
  avatarUrl: null,
  baseRole: 'student',
  roles: [],
  tags: [],
};
const maintainer: UserContext & { policies: Array<{ action: string; effect: 'allow' }> } = {
  ...student,
  uid: 'rights-member',
  policies: [{ action: 'information.proposal.manage', effect: 'allow' }],
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
  publicProgress: '已进入调研',
  status: 'researching',
  createdAt: '2026-07-29T00:00:00.000Z',
  updatedAt: '2026-07-30T00:00:00.000Z',
};

function renderDetail(user: UserContext, response: object, request = vi.fn(async () => response)) {
  render(
    <MemoryRouter>
      <ProposalDetailPage
        client={{ request } as unknown as ApiClient}
        proposalId="proposal-1"
        user={user}
      />
    </MemoryRouter>,
  );
  return request;
}

describe('ProposalDetailPage', () => {
  it('formats timeline due dates in the supplied local timezone rather than by slicing UTC', () => {
    expect(formatProposalDueDate('2026-10-07T16:30:00.000Z', 'Asia/Shanghai')).toBe('2026-10-08');
  });

  it('round-trips an unchanged UTC due date through the local datetime input', () => {
    const instant = '2026-10-08T10:07:00.000Z';

    expect(localDateTimeInputToUtcInstant(utcInstantToLocalDateTimeInput(instant))).toBe(instant);
  });

  it('renders a public progress timeline without exposing an unexpected internal note', async () => {
    renderDetail(student, { ...publicProposal, internalNote: '不得展示的内部事项' });

    expect(await screen.findByRole('heading', { name: '增加夜间自习空间' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: '提案进展时间线' })).toHaveTextContent('调研中');
    expect(screen.getByRole('list', { name: '提案进展时间线' })).toHaveTextContent('rights-owner');
    expect(screen.getByRole('list', { name: '提案进展时间线' })).toHaveTextContent('2026-10-08');
    expect(screen.queryByText('不得展示的内部事项')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '维护提案' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '维护提案' })).not.toBeInTheDocument();
  });

  it('does not let a stale detail response overwrite the current proposal route', async () => {
    let resolveFirst!: (value: object) => void;
    let resolveSecond!: (value: object) => void;
    const request = vi.fn(
      () =>
        new Promise<object>((resolve) => {
          if (request.mock.calls.length === 1) resolveFirst = resolve;
          else resolveSecond = resolve;
        }),
    );
    const view = render(
      <MemoryRouter>
        <ProposalDetailPage
          client={{ request } as unknown as ApiClient}
          proposalId="proposal-a"
          user={student}
        />
      </MemoryRouter>,
    );

    view.rerender(
      <MemoryRouter>
        <ProposalDetailPage
          client={{ request } as unknown as ApiClient}
          proposalId="proposal-b"
          user={student}
        />
      </MemoryRouter>,
    );
    resolveSecond({ ...publicProposal, id: 'proposal-b', title: '提案 B' });
    expect(await screen.findByRole('heading', { name: '提案 B' })).toBeInTheDocument();
    resolveFirst({ ...publicProposal, id: 'proposal-a', title: '提案 A' });
    expect(await screen.findByRole('heading', { name: '提案 B' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '提案 A' })).not.toBeInTheDocument();
  });

  it('ignores a prior route maintenance response after navigating to another proposal', async () => {
    let resolveSave!: (value: object) => void;
    const request = vi.fn((path: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'PATCH') {
        return new Promise<object>((resolve) => {
          resolveSave = resolve;
        });
      }
      return Promise.resolve(
        path.endsWith('proposal-b')
          ? { ...publicProposal, id: 'proposal-b', title: '提案 B', internalNote: 'B 备注' }
          : { ...publicProposal, internalNote: 'A 备注' },
      );
    });
    const view = render(
      <MemoryRouter>
        <ProposalDetailPage
          client={{ request } as unknown as ApiClient}
          proposalId="proposal-a"
          user={maintainer}
        />
      </MemoryRouter>,
    );
    const actor = userEvent.setup();

    await screen.findByRole('heading', { name: '增加夜间自习空间' });
    await actor.click(screen.getByRole('button', { name: '维护提案' }));
    await actor.click(screen.getByRole('button', { name: '保存提案维护信息' }));

    view.rerender(
      <MemoryRouter>
        <ProposalDetailPage
          client={{ request } as unknown as ApiClient}
          proposalId="proposal-b"
          user={maintainer}
        />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: '提案 B' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '维护提案' })).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await actor.click(screen.getByRole('button', { name: '维护提案' }));
    expect(screen.getByRole('button', { name: '保存提案维护信息' })).not.toBeDisabled();
    resolveSave({ ...publicProposal, title: '提案 A 已保存', internalNote: 'A 已保存备注' });
    expect(await screen.findByRole('dialog', { name: '维护提案' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '提案 B' })).toBeInTheDocument();
    expect(screen.queryByText('提案 A 已保存')).not.toBeInTheDocument();
    expect(screen.queryByText('A 已保存备注')).not.toBeInTheDocument();
  });

  it('ignores a prior route maintenance failure after navigating to another proposal', async () => {
    let rejectSave!: (error: Error) => void;
    const request = vi.fn((path: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'PATCH') {
        return new Promise<object>((_resolve, reject) => {
          rejectSave = reject;
        });
      }
      return Promise.resolve(
        path.endsWith('proposal-b')
          ? { ...publicProposal, id: 'proposal-b', title: '提案 B', internalNote: 'B 备注' }
          : { ...publicProposal, internalNote: 'A 备注' },
      );
    });
    const view = render(
      <MemoryRouter>
        <ProposalDetailPage
          client={{ request } as unknown as ApiClient}
          proposalId="proposal-a"
          user={maintainer}
        />
      </MemoryRouter>,
    );
    const actor = userEvent.setup();

    await screen.findByRole('heading', { name: '增加夜间自习空间' });
    await actor.click(screen.getByRole('button', { name: '维护提案' }));
    await actor.click(screen.getByRole('button', { name: '保存提案维护信息' }));
    view.rerender(
      <MemoryRouter>
        <ProposalDetailPage
          client={{ request } as unknown as ApiClient}
          proposalId="proposal-b"
          user={maintainer}
        />
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { name: '提案 B' });
    rejectSave(new Error('A 保存失败'));

    await actor.click(screen.getByRole('button', { name: '维护提案' }));
    expect(screen.getByRole('button', { name: '保存提案维护信息' })).not.toBeDisabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '提案 B' })).toBeInTheDocument();
  });

  it('keeps maintenance controls in a right-side drawer for authorized maintainers', async () => {
    const request = renderDetail(maintainer, { ...publicProposal, internalNote: '联系物业' });
    const actor = userEvent.setup();

    await screen.findByRole('heading', { name: '增加夜间自习空间' });
    expect(screen.queryByRole('dialog', { name: '维护提案' })).not.toBeInTheDocument();
    await actor.click(screen.getByRole('button', { name: '维护提案' }));
    expect(await screen.findByRole('dialog', { name: '维护提案' })).toHaveTextContent('联系物业');
    await actor.selectOptions(screen.getByLabelText('提案状态'), 'advancing');
    await actor.click(screen.getByRole('button', { name: '保存提案维护信息' }));

    expect(request).toHaveBeenCalledWith(
      '/information/proposals/proposal-1',
      expect.objectContaining({
        method: 'PATCH',
        body: expect.stringContaining('"status":"advancing"'),
      }),
    );
  });

  it('keeps mutation errors inside the drawer and reconciles normalized maintenance responses', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ ...publicProposal, internalNote: '联系物业' })
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({
        ...publicProposal,
        publicProgress: '服务端已规范化进展',
        internalNote: '服务端已规范化备注',
      });
    renderDetail(maintainer, publicProposal, request);
    const actor = userEvent.setup();

    await screen.findByRole('heading', { name: '增加夜间自习空间' });
    await actor.click(screen.getByRole('button', { name: '维护提案' }));
    const drawer = await screen.findByRole('dialog', { name: '维护提案' });
    await actor.click(within(drawer).getByRole('button', { name: '保存提案维护信息' }));
    expect(await within(drawer).findByRole('alert')).toHaveTextContent('提案维护信息保存失败');
    expect(screen.queryByRole('alert')).toBe(drawer.querySelector('[role="alert"]'));

    await actor.click(within(drawer).getByRole('button', { name: '保存提案维护信息' }));
    expect(await within(drawer).findByRole('status')).toHaveTextContent('提案维护信息已保存');
    expect(screen.getByRole('list', { name: '提案进展时间线' })).toHaveTextContent(
      '服务端已规范化进展',
    );
    expect(within(drawer).getByLabelText('内部备注')).toHaveValue('服务端已规范化备注');
  });
});
