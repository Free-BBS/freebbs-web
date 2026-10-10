import { act, render, screen } from '@testing-library/react';
import { RouterProvider } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { emptyCollectionSchema } from '../modules/collections/collection-utils.js';
const mocks = vi.hoisted(() => ({ request: vi.fn(), auth: vi.fn() }));
vi.mock('../core/api/client.js', async (original) => ({
  ...(await original<typeof import('../core/api/client.js')>()),
  createApiClient: () => ({ request: mocks.request }),
}));
vi.mock('../core/auth/AuthProvider.js', async (original) => ({
  ...(await original<typeof import('../core/auth/AuthProvider.js')>()),
  useAuth: mocks.auth,
}));
import { appRouter } from './router.js';
describe('workbench route lifecycle', () => {
  it('opens a fresh form when the route moves from an existing form to new under one identity', async () => {
    mocks.request.mockImplementation(async (path: string) => {
      if (path === '/collections/dashboard') return { canCreate: true };
      if (path === '/collections/forms/existing')
        return {
          id: 'existing',
          schema: { ...emptyCollectionSchema, title: 'Existing department draft' },
        };
      return [];
    });
    mocks.auth.mockReturnValue({
      status: 'authenticated',
      user: {
        uid: 'student',
        displayName: '同学',
        roles: [],
        tags: [],
        baseRole: 'student',
        avatarUrl: null,
      },
      authMode: 'main',
      demoUser: null,
      previewUser: null,
      client: { request: mocks.request },
      setDemoUser: vi.fn(),
      reload: vi.fn(),
    });
    await act(async () => {
      await appRouter.navigate('/collections/workbench/existing');
    });
    render(<RouterProvider router={appRouter} />);
    await screen.findByDisplayValue('Existing department draft');
    await act(async () => {
      await appRouter.navigate('/collections/workbench/new');
    });
    expect(await screen.findByDisplayValue('未命名收集')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Existing department draft')).not.toBeInTheDocument();
  });
});
