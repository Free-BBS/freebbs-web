import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { EventsPageProps } from '../events/EventsPage.js';
import type { ApiClient } from '../../core/api/client.js';
import { ActivityManagementPage } from './ActivityManagementPage.js';

const member: NonNullable<EventsPageProps['user']> = {
  uid: 'member',
  displayName: '社工同学',
  avatarUrl: null,
  baseRole: 'student',
  roles: ['department.sports_member'],
  tags: [],
  policies: [{ action: 'events.create', resource: 'activity', effect: 'allow' }],
};
function client(canCreate = true) {
  return {
    request: vi.fn(async (path: string) => {
      if (path === '/collections/dashboard') return { canCreate };
      if (path === '/collections/forms')
        return [
          {
            id: 'draft',
            title: '活动报名草稿',
            description: '自定义报名',
            status: 'draft',
            canManage: true,
            updatedAt: '2026-10-10',
          },
          { id: 'private', title: '他人的草稿', canManage: false },
        ];
      return [];
    }) as ApiClient['request'],
  };
}
function show(canCreate: boolean, user = member, initialCreate = false) {
  return render(
    <MemoryRouter>
      <Routes>
        <Route
          path="/"
          element={
            <ActivityManagementPage
              client={client(canCreate)}
              user={user}
              initialCreate={initialCreate}
            />
          }
        />
        <Route path="/collections/workbench/new" element={<p>报名表单工作台</p>} />
      </Routes>
    </MemoryRouter>,
  );
}
describe('activity management entries', () => {
  it('has one activity creation button and can reopen the drawer after closing it', async () => {
    show(true);
    const create = await screen.findByRole('button', { name: '创建活动' });
    expect(screen.getAllByRole('button', { name: '创建活动' })).toHaveLength(1);
    fireEvent.click(create);
    const drawer = await screen.findByRole('dialog', { name: '创建活动草稿' });
    fireEvent.click(within(drawer).getByRole('button', { name: '关闭编辑器' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(create);
    expect(await screen.findByRole('dialog', { name: '创建活动草稿' })).toBeInTheDocument();
  });
  it('opens the existing creation drawer and recovers manageable form drafts', async () => {
    show(true, member, true);
    expect(await screen.findByRole('dialog', { name: '创建活动草稿' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: '编辑报名表' })).toHaveAttribute(
      'href',
      '/collections/workbench/draft',
    );
    expect(screen.queryByText('他人的草稿')).not.toBeInTheDocument();
    expect(screen.queryByText('我要上电子系春晚')).not.toBeInTheDocument();
  });
  it('uses the existing custom form workflow for a social identity without legacy create grants', async () => {
    show(true, { ...member, roles: ['media_center.audiovisual.member'], policies: [] }, true);
    expect(await screen.findByText('报名表单工作台')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('does not expose drafts or creation controls when direct access is denied', async () => {
    show(false, { ...member, roles: [], policies: [] });
    expect(await screen.findByText(/当前身份可浏览和报名活动/)).toBeInTheDocument();
    expect(screen.queryByText('活动报名草稿')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /创建/ })).not.toBeInTheDocument();
  });
});
