import type { CollaborationEntry, CollaborationSpace } from '@freebbs-development/contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EntryEditor } from './EntryEditor.js';

const { mockAuth } = vi.hoisted(() => ({ mockAuth: vi.fn() }));
vi.mock('../../core/auth/AuthProvider.js', () => ({ useAuth: mockAuth }));

const entry: CollaborationEntry = {
  id: 'returned',
  uid: 'student',
  displayName: '同学',
  createdAt: '2026-10-13T00:00:00Z',
  updatedAt: '2026-10-13T00:00:00Z',
  values: {},
  choices: [],
  resource: '',
  startsAt: '',
  endsAt: '',
  assignedSlot: null,
  text: '退回的初稿',
  files: [],
  decisions: [],
  stage: 0,
  reviewStatus: 'rejected',
};
const space: CollaborationSpace = {
  id: 'space',
  kind: 'review',
  title: '材料审核',
  description: '',
  ownerUid: 'organizer',
  departmentId: null,
  audience: 'all',
  status: 'published',
  revision: 1,
  createdAt: '2026-10-13T00:00:00Z',
  updatedAt: '2026-10-13T00:00:00Z',
  columns: [],
  slots: [],
  stages: [],
  entries: [entry],
  history: [],
};

beforeEach(() => mockAuth.mockReturnValue({ user: { uid: 'student', roles: [] } }));

describe('review resubmission', () => {
  it('returns to new submission after the last returned material saves successfully', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    const view = render(<EntryEditor space={space} busy={false} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('修订退回材料'), { target: { value: entry.id } });
    fireEvent.change(screen.getByLabelText('内容与说明'), { target: { value: '已补充的材料' } });
    fireEvent.click(screen.getByRole('button', { name: '提交记录' }));
    await screen.findByText('记录已保存，可在记录标签中查看。');
    view.rerender(
      <EntryEditor
        space={{ ...space, revision: 2, entries: [{ ...entry, reviewStatus: 'pending' }] }}
        busy={false}
        onSubmit={onSubmit}
      />,
    );
    expect(screen.getByLabelText('修订退回材料')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('内容与说明'), { target: { value: '下一份新材料' } });
    fireEvent.click(screen.getByRole('button', { name: '提交记录' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ entryId: 'returned', text: '已补充的材料' });
    expect(onSubmit.mock.calls[1]![0]).toMatchObject({ entryId: undefined, text: '下一份新材料' });
  });

  it('retains the returned entry and draft when resubmission fails', async () => {
    const onSubmit = vi.fn().mockResolvedValue(false);
    render(<EntryEditor space={space} busy={false} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('修订退回材料'), { target: { value: entry.id } });
    fireEvent.change(screen.getByLabelText('内容与说明'), { target: { value: '未保存的补充' } });
    fireEvent.click(screen.getByRole('button', { name: '提交记录' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(screen.getByLabelText('修订退回材料')).toHaveValue('returned');
    expect(screen.getByLabelText('内容与说明')).toHaveValue('未保存的补充');
    expect(screen.queryByText('记录已保存，可在记录标签中查看。')).not.toBeInTheDocument();
  });
});

it.each(['availability', 'practice'] as const)(
  'prunes removed %s slots while preserving valid draft selections in their original order',
  async (kind) => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    const slots = [
      { id: 'removed', title: '已删除时段', startsAt: '', endsAt: '', capacity: 5 },
      { id: 'kept', title: '保留时段', startsAt: '', endsAt: '', capacity: 5 },
      { id: 'draft', title: '草稿时段', startsAt: '', endsAt: '', capacity: 5 },
    ];
    const original = {
      ...space,
      kind,
      slots,
      entries: [{ ...entry, choices: ['removed', 'kept'], reviewStatus: 'pending' as const }],
    };
    const view = render(<EntryEditor space={original} busy={false} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: '草稿时段' }));
    view.rerender(
      <EntryEditor
        space={{ ...original, revision: 2, slots: slots.slice(1) }}
        busy={false}
        onSubmit={onSubmit}
      />,
    );
    expect(screen.getByRole('button', { name: /保留时段/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: /草稿时段/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: '提交记录' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0]![0].choices).toEqual(['kept', 'draft']);
    if (kind === 'practice') {
      expect(screen.getByRole('button', { name: '1. 保留时段' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '2. 草稿时段' })).toBeInTheDocument();
    }
  },
);
