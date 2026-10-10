import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoleKey } from '@freebbs-development/contracts';
import type { ApiClient } from '../../../core/api/client.js';
import { emptyCollectionSchema } from '../collection-utils.js';
import { CollectionWorkbench } from './CollectionWorkbench.js';
const actor = vi.hoisted(() => ({ roles: [] as RoleKey[] }));
vi.mock('../../../core/auth/AuthProvider.js', () => ({
  useOptionalAuth: () => ({ user: { roles: actor.roles } }),
}));
function show(old = false) {
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === '/collections/dashboard') return { canCreate: true };
    if (path === '/collections/module-definitions') return [];
    if (path === '/collections/forms/old' && !init)
      return {
        id: 'old',
        schema: { ...emptyCollectionSchema, title: '原有草稿' },
        organizationId: 'rights_development_center',
      };
    if (path === '/collections/forms/created' && !init)
      return {
        id: 'created',
        schema: { ...emptyCollectionSchema, publisherDepartmentId: 'student_union.sports_center' },
      };
    if (path === '/collections/forms' || path.endsWith('/draft')) return { id: 'created' };
    if (path.endsWith('/publish')) return {};
    throw new Error(path);
  });
  render(
    <MemoryRouter initialEntries={[old ? '/workbench/old' : '/workbench/new']}>
      <Routes>
        <Route
          path="/workbench/:collectionId"
          element={<CollectionWorkbench client={{ request: request as ApiClient['request'] }} />}
        />
      </Routes>
    </MemoryRouter>,
  );
  return request;
}
describe('publisher department metadata', () => {
  beforeEach(() => {
    actor.roles = [];
  });
  it('selects a sole canonical membership and includes it in save/publish', async () => {
    actor.roles = ['department.sports_member'];
    const request = show();
    expect(await screen.findByLabelText('发布部门')).toHaveValue('student_union.sports_center');
    expect(screen.getAllByRole('option').map((el) => el.getAttribute('value'))).toEqual([
      '',
      'student_union.sports_center',
    ]);
    fireEvent.click(screen.getByRole('button', { name: '检查并发布' }));
    await waitFor(() =>
      expect(
        request.mock.calls.some(([path]) => path === '/collections/forms/created/publish'),
      ).toBe(true),
    );
    const write = request.mock.calls.find(([, init]) => init?.method === 'POST' && init.body)!;
    expect(JSON.parse(write[1]!.body as string).schema.publisherDepartmentId).toBe(
      'student_union.sports_center',
    );
  });
  it('requires deliberate selection for a new multi-department form', async () => {
    actor.roles = ['department.sports_member', 'department.arts_member'];
    const request = show();
    expect(await screen.findByLabelText('发布部门')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    expect(request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    expect(screen.getAllByText('请选择发布部门。').length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText('发布部门'), {
      target: { value: 'student_union.arts_center' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() =>
      expect(request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true),
    );
  });
  it('preserves an old unbound draft and omits parent metadata during schema-only save', async () => {
    actor.roles = ['department.sports_member'];
    const request = show(true);
    await screen.findByDisplayValue('原有草稿');
    expect(screen.getByLabelText('发布部门')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() =>
      expect(request.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true),
    );
    const payload = JSON.parse(
      request.mock.calls.find(([, init]) => init?.method === 'PUT')![1]!.body as string,
    );
    expect(payload).not.toHaveProperty('organizationId');
    expect(payload.schema).not.toHaveProperty('publisherDepartmentId');
  });
  it('offers the entire canonical directory only to superadmin', async () => {
    actor.roles = ['platform.super_admin'];
    show();
    await screen.findByLabelText('发布部门');
    expect(screen.getAllByRole('option')).toHaveLength(21);
  });
  it('does not publish or rewrite navigation when an identity change unmounts an in-flight create', async () => {
    actor.roles = ['department.sports_member'];
    let resolveCreate!: (value: { id: string }) => void;
    const request = vi.fn(async (path: string) => {
      if (path === '/collections/dashboard') return { canCreate: true };
      if (path === '/collections/module-definitions') return [];
      if (path === '/collections/forms')
        return new Promise((resolve) => {
          resolveCreate = resolve;
        });
      return {};
    });
    const view = render(
      <MemoryRouter>
        <CollectionWorkbench client={{ request: request as ApiClient['request'] }} />
      </MemoryRouter>,
    );
    await screen.findByLabelText('发布部门');
    fireEvent.click(screen.getByRole('button', { name: '检查并发布' }));
    await waitFor(() => expect(resolveCreate).toBeDefined());
    const currentPath = window.location.pathname;
    view.unmount();
    await act(async () => {
      resolveCreate({ id: 'identity-stale' });
    });
    expect(request.mock.calls.some(([path]) => path.endsWith('/publish'))).toBe(false);
    expect(window.location.pathname).toBe(currentPath);
  });
});
