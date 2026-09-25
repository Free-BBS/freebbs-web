import { render as renderView, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

function render(ui: ReactNode) {
  return renderView(<MemoryRouter>{ui}</MemoryRouter>);
}
import { describe, expect, it, vi } from 'vitest';

import type { UserContext } from '@freebbs-development/contracts';
import type { ApiClient } from '../../core/api/client.js';
import { KnowledgePage } from './KnowledgePage.js';

const ordinary: UserContext = {
  uid: 'ordinary',
  displayName: '普通同学',
  avatarUrl: null,
  baseRole: 'student',
  roles: [],
  tags: [],
};

const artsMember: UserContext = {
  ...ordinary,
  uid: 'arts-member',
  displayName: '文艺中心部员',
  roles: ['department.arts_member'],
  tags: [
    { key: 'social_org.arts_center', scope: { type: 'social_organization', id: 'arts_center' } },
  ],
};

const admin: UserContext = {
  ...ordinary,
  uid: 'admin',
  roles: ['platform.super_admin'],
};

const generalEntry = {
  id: 'general-1',
  type: 'faq' as const,
  title: 'General 常见问题',
  body: '所有同学都可以查看。',
  audience: 'general' as const,
  organizationId: null,
  status: 'published' as const,
  ownerUid: 'demo-admin',
  scope: { type: 'public', id: '*' },
  createdAt: '2026-07-29T00:00:00.000Z',
  updatedAt: '2026-07-29T00:00:00.000Z',
};

const organizationEntry = {
  ...generalEntry,
  id: 'organization-1',
  title: '文艺中心交接清单',
  audience: 'social_org' as const,
  organizationId: 'arts_center',
  scope: { type: 'social_organization', id: 'arts_center' },
};

describe('KnowledgePage audience entry points', () => {
  it('limits creation and published-entry controls to matching knowledge policy scopes', async () => {
    const publishedGeneral = { ...generalEntry, status: 'published' as const };
    const scopedDraft = { ...organizationEntry, status: 'draft' as const };
    const scopedCreator: UserContext & {
      policies: Array<{
        action: string;
        resource: string;
        effect: 'allow';
        scope: typeof organizationEntry.scope;
      }>;
    } = {
      ...artsMember,
      policies: [
        {
          action: 'knowledge.create',
          resource: 'knowledge_entry',
          effect: 'allow',
          scope: organizationEntry.scope,
        },
      ],
    };
    const request = vi.fn(async (path: string) =>
      path.endsWith('audience=social_org') ? [scopedDraft] : [publishedGeneral],
    );
    const user = userEvent.setup();
    render(<KnowledgePage client={{ request } as unknown as ApiClient} user={scopedCreator} />);

    await screen.findByText('General 常见问题');
    expect(screen.queryByRole('button', { name: '新建经验' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '编辑 General 常见问题' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '撤回 General 常见问题' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '社工组织' }));
    expect(await screen.findByText('文艺中心交接清单')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新建经验' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '编辑 文艺中心交接清单' })).toBeInTheDocument();
  });

  it('requires matching publish permission before exposing published-entry editing and transitions', async () => {
    const publishedGeneral = { ...generalEntry, status: 'published' as const };
    const creatorOnly: UserContext & {
      policies: Array<{
        action: string;
        resource: string;
        effect: 'allow';
        scope: typeof generalEntry.scope;
      }>;
    } = {
      ...ordinary,
      policies: [
        {
          action: 'knowledge.create',
          resource: 'knowledge_entry',
          effect: 'allow',
          scope: generalEntry.scope,
        },
      ],
    };
    const request = vi.fn().mockResolvedValue([publishedGeneral]);
    render(<KnowledgePage client={{ request } as unknown as ApiClient} user={creatorOnly} />);

    await screen.findByText('General 常见问题');
    expect(screen.getByRole('button', { name: '新建经验' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '编辑 General 常见问题' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '撤回 General 常见问题' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '归档 General 常见问题' })).not.toBeInTheDocument();
  });

  it('creates social-organization drafts in the selected authorized organization scope', async () => {
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/knowledge/entries?audience=social_org') return [];
      if (path === '/knowledge/entries?audience=general') return [generalEntry];
      if (path === '/knowledge/entries' && init?.method === 'POST') return generalEntry;
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${path}`);
    });
    const user = userEvent.setup();
    render(<KnowledgePage client={{ request } as unknown as ApiClient} user={admin} />);

    await screen.findByText('General 常见问题');
    await user.click(screen.getByRole('button', { name: '社工组织' }));
    await user.click(screen.getByRole('button', { name: '新建经验' }));
    await user.type(screen.getByLabelText('经验标题'), '社工交接');
    await user.type(screen.getByLabelText('经验正文'), '仅授权组织可读。');
    await user.click(screen.getByRole('button', { name: '保存草稿' }));

    expect(request).toHaveBeenCalledWith(
      '/knowledge/entries',
      expect.objectContaining({
        body: expect.stringContaining('"scope":{"type":"social_organization"'),
      }),
    );
  });

  it('keeps the social-organization entry point unmounted for ordinary students', async () => {
    const request = vi.fn().mockResolvedValue([generalEntry]);

    render(<KnowledgePage client={{ request } as unknown as ApiClient} user={ordinary} />);

    expect(await screen.findByText('General 常见问题')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '社工组织' })).not.toBeInTheDocument();
    expect(request).toHaveBeenCalledWith('/knowledge/entries?audience=general');
  });

  it('lets organization members enter their protected knowledge area', async () => {
    const request = vi.fn(async (path: string) =>
      path.endsWith('audience=social_org') ? [organizationEntry] : [generalEntry],
    );
    const user = userEvent.setup();

    render(<KnowledgePage client={{ request } as unknown as ApiClient} user={artsMember} />);

    await screen.findByText('General 常见问题');
    await user.click(screen.getByRole('button', { name: '社工组织' }));

    expect(await screen.findByText('文艺中心交接清单')).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith('/knowledge/entries?audience=social_org');
  });
});
