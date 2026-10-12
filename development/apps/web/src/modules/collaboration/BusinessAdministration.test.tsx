import {
  DEPARTMENT_DIRECTORY,
  type CollaborationSpace,
  type RoleKey,
} from '@freebbs-development/contracts';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { EntryEditor } from './EntryEditor.js';
import { SpaceEditor } from './SpaceEditor.js';

const { mockAuth } = vi.hoisted(() => ({ mockAuth: vi.fn() }));
vi.mock('../../core/auth/AuthProvider.js', () => ({ useAuth: mockAuth }));

const space: CollaborationSpace = {
  id: 'space',
  kind: 'shared_table',
  title: '协作统计',
  description: '',
  ownerUid: 'other-owner',
  departmentId: null,
  audience: 'department',
  status: 'published',
  revision: 1,
  createdAt: '2026-10-13T00:00:00Z',
  updatedAt: '2026-10-13T00:00:00Z',
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
      options: ['确认', '待定'],
    },
  ],
  slots: [],
  stages: [],
  entries: [],
  history: [],
  canManage: true,
};
function identity(roles: RoleKey[]) {
  mockAuth.mockReturnValue({ user: { uid: 'actor', roles } });
}

describe('collaboration business administrator boundary', () => {
  it('offers platform administrators every department in the space editor', () => {
    identity(['platform.admin']);
    render(
      <MemoryRouter>
        <SpaceEditor existing={space} busy={false} onSave={vi.fn()} onCancel={vi.fn()} />
      </MemoryRouter>,
    );
    expect(within(screen.getByLabelText('所属部门')).getAllByRole('option')).toHaveLength(
      DEPARTMENT_DIRECTORY.length + 1,
    );
  });
  it('does not give lead-only identities departments without an ordinary membership', () => {
    identity(['platform.super_admin']);
    render(
      <MemoryRouter>
        <SpaceEditor existing={space} busy={false} onSave={vi.fn()} onCancel={vi.fn()} />
      </MemoryRouter>,
    );
    expect(within(screen.getByLabelText('所属部门')).getAllByRole('option')).toHaveLength(1);
  });
  it('retains a lead’s ordinary department scope without widening it', () => {
    identity(['platform.super_admin', 'department.arts_member']);
    render(
      <MemoryRouter>
        <SpaceEditor existing={space} busy={false} onSave={vi.fn()} onCancel={vi.fn()} />
      </MemoryRouter>,
    );
    const options = within(screen.getByLabelText('所属部门')).getAllByRole('option');
    expect(options).toHaveLength(2);
    expect(options[1]).toHaveValue('student_union.arts_center');
  });
  it.each([{ kind: 'shared_table' as const }, { kind: 'materials' as const }])(
    'allows platform admin editing for both restricted column controls in $kind',
    ({ kind }) => {
      identity(['platform.admin']);
      render(<EntryEditor space={{ ...space, kind }} busy={false} onSubmit={vi.fn()} />);
      expect(screen.getByRole('textbox', { name: /^受限文字/ })).toBeEnabled();
      expect(screen.getByRole('combobox', { name: /^受限选择/ })).toBeEnabled();
    },
  );
  it.each([{ kind: 'shared_table' as const }, { kind: 'materials' as const }])(
    'prevents lead-only bypass of restricted column controls in $kind',
    ({ kind }) => {
      identity(['platform.super_admin']);
      render(<EntryEditor space={{ ...space, kind }} busy={false} onSubmit={vi.fn()} />);
      expect(screen.getByRole('textbox', { name: /^受限文字/ })).toBeDisabled();
      expect(screen.getByRole('combobox', { name: /^受限选择/ })).toBeDisabled();
    },
  );
  it('keeps ordinary column grants effective', () => {
    identity(['department.sports_member']);
    render(<EntryEditor space={space} busy={false} onSubmit={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: /^受限文字/ })).toBeEnabled();
    expect(screen.getByRole('combobox', { name: /^受限选择/ })).toBeEnabled();
  });
  it('keeps owner editing effective without a platform admin role', () => {
    identity(['platform.super_admin']);
    render(<EntryEditor space={{ ...space, ownerUid: 'actor' }} busy={false} onSubmit={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: /^受限文字/ })).toBeEnabled();
    expect(screen.getByRole('combobox', { name: /^受限选择/ })).toBeEnabled();
  });
});
