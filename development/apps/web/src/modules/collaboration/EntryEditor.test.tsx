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

describe('restricted column supervision', () => {
  const restrictedSpace: CollaborationSpace = {
    ...space,
    kind: 'shared_table',
    canManage: true,
    columns: [
      {
        id: 'note',
        label: '受限文字',
        kind: 'text',
        required: false,
        editRoleKeys: ['department.sports_member'],
      },
      {
        id: 'choice',
        label: '受限选择',
        kind: 'choice',
        required: false,
        editRoleKeys: ['department.sports_member'],
        options: ['确认'],
      },
    ],
  };

  describe.each(['shared_table', 'materials'] as const)('%s', (kind) => {
    it.each(['counselor.youth_league_secretary', 'counselor.youth_league'] as const)(
      'allows global supervisor %s to submit restricted text and choice fields',
      async (role) => {
        mockAuth.mockReturnValue({ user: { uid: 'supervisor', roles: [role] } });
        const onSubmit = vi.fn().mockResolvedValue(true);
        render(
          <EntryEditor space={{ ...restrictedSpace, kind }} busy={false} onSubmit={onSubmit} />,
        );

        const note = screen.getByRole('textbox', { name: /^受限文字/ });
        const choice = screen.getByRole('combobox', { name: /^受限选择/ });
        expect(note).toBeEnabled();
        expect(choice).toBeEnabled();
        fireEvent.change(note, { target: { value: '督导补充' } });
        fireEvent.change(choice, { target: { value: '确认' } });
        if (kind === 'materials') {
          fireEvent.change(screen.getByLabelText('内容与说明'), { target: { value: '材料说明' } });
        }
        fireEvent.click(screen.getByRole('button', { name: '提交记录' }));

        await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
        expect(onSubmit.mock.calls[0]![0].values).toEqual({ note: '督导补充', choice: '确认' });
      },
    );

    it('keeps restricted fields locked for an ordinary manager without the column role', () => {
      render(<EntryEditor space={{ ...restrictedSpace, kind }} busy={false} onSubmit={vi.fn()} />);
      expect(screen.getByRole('textbox', { name: /^受限文字/ })).toBeDisabled();
      expect(screen.getByRole('combobox', { name: /^受限选择/ })).toBeDisabled();
    });

    it('requires effective space management for the global supervisor bypass', () => {
      mockAuth.mockReturnValue({
        user: { uid: 'supervisor', roles: ['counselor.youth_league'] },
      });
      render(
        <EntryEditor
          space={{ ...restrictedSpace, kind, canManage: false }}
          busy={false}
          onSubmit={vi.fn()}
        />,
      );
      expect(screen.getByRole('textbox', { name: /^受限文字/ })).toBeDisabled();
      expect(screen.getByRole('combobox', { name: /^受限选择/ })).toBeDisabled();
    });
  });
});

describe('editing target refresh', () => {
  it('retains the original edit version during unrelated refreshes', async () => {
    const onSubmit = vi.fn().mockResolvedValue(false);
    const original = { ...space, kind: 'materials' as const, entries: [{ ...entry, revision: 2 }] };
    const page = render(<EntryEditor space={original} busy={false} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('编辑现有记录'), { target: { value: entry.id } });
    fireEvent.change(screen.getByLabelText('内容与说明'), { target: { value: 'My draft' } });
    page.rerender(
      <EntryEditor
        space={{ ...original, revision: 9, entries: [{ ...entry, revision: 4 }] }}
        busy={false}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '提交记录' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ entryRevision: 2, text: 'My draft' });
  });
  it.each([false, true])(
    'creates a new row with the preserved draft after the selected row is deleted (other rows: %s)',
    async (hasOtherRows) => {
      const onSubmit = vi.fn().mockResolvedValue(true);
      const otherEntry = { ...entry, id: 'other', displayName: '其他同学' };
      const original: CollaborationSpace = {
        ...space,
        kind: 'shared_table',
        columns: [{ id: 'name', label: '名称', kind: 'text', required: true }],
        entries: hasOtherRows ? [entry, otherEntry] : [entry],
      };
      const view = render(<EntryEditor space={original} busy={false} onSubmit={onSubmit} />);
      fireEvent.change(screen.getByLabelText('编辑现有行'), { target: { value: entry.id } });
      fireEvent.change(screen.getByLabelText(/名称/), { target: { value: '未保存的行草稿' } });

      view.rerender(
        <EntryEditor
          space={{ ...original, revision: 2, entries: hasOtherRows ? [otherEntry] : [] }}
          busy={false}
          onSubmit={onSubmit}
        />,
      );

      expect(screen.getByLabelText('编辑现有行')).toHaveValue('');
      expect(screen.getByLabelText(/名称/)).toHaveValue('未保存的行草稿');
      // Do not dispatch change: the browser already displays the new-row option.
      fireEvent.click(screen.getByRole('button', { name: '提交记录' }));
      await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
      expect(onSubmit.mock.calls[0]![0]).toMatchObject({
        entryId: undefined,
        values: { name: '未保存的行草稿' },
      });
    },
  );

  it.each(['review', 'materials', 'booking', 'attendance'] as const)(
    'clears a deleted %s target while preserving the body draft',
    async (kind) => {
      const onSubmit = vi.fn().mockResolvedValue(true);
      const original = { ...space, kind };
      const view = render(<EntryEditor space={original} busy={false} onSubmit={onSubmit} />);
      fireEvent.change(screen.getByLabelText(kind === 'review' ? '修订退回材料' : '编辑现有记录'), {
        target: { value: entry.id },
      });
      fireEvent.change(screen.getByLabelText('内容与说明'), {
        target: { value: '保留的正文草稿' },
      });
      if (kind === 'booking') {
        fireEvent.change(screen.getByLabelText('预约资源'), { target: { value: '保留的资源' } });
        fireEvent.change(screen.getByLabelText('开始时间'), {
          target: { value: '2026-10-14T10:00' },
        });
        fireEvent.change(screen.getByLabelText('结束时间'), {
          target: { value: '2026-10-14T11:00' },
        });
      }
      view.rerender(
        <EntryEditor space={{ ...original, entries: [] }} busy={false} onSubmit={onSubmit} />,
      );
      expect(screen.getByLabelText('内容与说明')).toHaveValue('保留的正文草稿');
      fireEvent.click(screen.getByRole('button', { name: '提交记录' }));
      await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
      expect(onSubmit.mock.calls[0]![0]).toMatchObject({
        entryId: undefined,
        text: '保留的正文草稿',
        ...(kind === 'booking' ? { resource: '保留的资源' } : {}),
      });
    },
  );

  it.each(['review', 'attendance'] as const)(
    'clears the selected %s target when its status no longer permits editing',
    async (kind) => {
      const onSubmit = vi.fn().mockResolvedValue(true);
      const original = { ...space, kind };
      const view = render(<EntryEditor space={original} busy={false} onSubmit={onSubmit} />);
      fireEvent.change(screen.getByLabelText(kind === 'review' ? '修订退回材料' : '编辑现有记录'), {
        target: { value: entry.id },
      });
      fireEvent.change(screen.getByLabelText('内容与说明'), {
        target: { value: '保留的修订草稿' },
      });
      view.rerender(
        <EntryEditor
          space={{
            ...original,
            entries: [{ ...entry, reviewStatus: kind === 'review' ? 'pending' : 'approved' }],
          }}
          busy={false}
          onSubmit={onSubmit}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: '提交记录' }));
      await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
      expect(onSubmit.mock.calls[0]![0]).toMatchObject({
        entryId: undefined,
        text: '保留的修订草稿',
      });
    },
  );

  it('retains a valid selection and its draft when entries refresh', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    const view = render(<EntryEditor space={space} busy={false} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('修订退回材料'), { target: { value: entry.id } });
    fireEvent.change(screen.getByLabelText('内容与说明'), { target: { value: '尚未保存的修订' } });
    view.rerender(
      <EntryEditor
        space={{ ...space, revision: 2, entries: [{ ...entry, text: '服务器正文' }] }}
        busy={false}
        onSubmit={onSubmit}
      />,
    );
    expect(screen.getByLabelText('修订退回材料')).toHaveValue(entry.id);
    expect(screen.getByLabelText('内容与说明')).toHaveValue('尚未保存的修订');
    fireEvent.click(screen.getByRole('button', { name: '提交记录' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({
      entryId: entry.id,
      text: '尚未保存的修订',
    });
  });

  it('retains the selected row when only another row is deleted', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    const original: CollaborationSpace = {
      ...space,
      kind: 'shared_table',
      columns: [{ id: 'name', label: '名称', kind: 'text', required: true }],
      entries: [entry, { ...entry, id: 'other' }],
    };
    const view = render(<EntryEditor space={original} busy={false} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('编辑现有行'), { target: { value: entry.id } });
    fireEvent.change(screen.getByLabelText(/名称/), { target: { value: '保留的行草稿' } });
    view.rerender(
      <EntryEditor
        space={{ ...original, entries: [{ ...entry }] }}
        busy={false}
        onSubmit={onSubmit}
      />,
    );
    expect(screen.getByLabelText('编辑现有行')).toHaveValue(entry.id);
    fireEvent.click(screen.getByRole('button', { name: '提交记录' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({
      entryId: entry.id,
      values: { name: '保留的行草稿' },
    });
  });

  it.each(['availability', 'practice'] as const)(
    'preserves the existing %s submission target outside the record selector',
    async (kind) => {
      const onSubmit = vi.fn().mockResolvedValue(true);
      const original = {
        ...space,
        kind,
        slots: [{ id: 'slot', title: '时段', startsAt: '', endsAt: '', capacity: 5 }],
      };
      const view = render(<EntryEditor space={original} busy={false} onSubmit={onSubmit} />);
      fireEvent.click(screen.getByRole('button', { name: '时段' }));
      view.rerender(
        <EntryEditor space={{ ...original, entries: [] }} busy={false} onSubmit={onSubmit} />,
      );
      fireEvent.click(screen.getByRole('button', { name: '提交记录' }));
      await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
      expect(onSubmit.mock.calls[0]![0]).toMatchObject({ entryId: entry.id, choices: ['slot'] });
    },
  );
});

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
