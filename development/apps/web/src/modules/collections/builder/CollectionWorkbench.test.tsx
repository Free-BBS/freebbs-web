import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type { ApiClient } from '../../../core/api/client.js';
import { emptyCollectionSchema } from '../collection-utils.js';
import { CollectionWorkbench } from './CollectionWorkbench.js';

describe('CollectionWorkbench', () => {
  it('opens and edits a rule attached to the form-level slot', async () => {
    const request = vi.fn(async (path: string) => {
      if (path === '/collections/dashboard') return { canCreate: true };
      if (path === '/collections/module-definitions') return [];
      throw new Error(`Unexpected request: ${path}`);
    });

    render(
      <MemoryRouter>
        <CollectionWorkbench client={{ request: request as ApiClient['request'] }} />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: '编辑附加规则：提交次数' }));
    const value = screen.getByRole('spinbutton', { name: '数值' });
    expect(value).toHaveValue(1);

    fireEvent.change(value, { target: { value: '3' } });

    expect(value).toHaveValue(3);
  });
  it.each([false, true])('preserves edits made during first save (publish=%s)', async (publish) => {
    let completeSave!: (value: unknown) => void;
    let stored = structuredClone(emptyCollectionSchema);
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/collections/dashboard') return { canCreate: true };
      if (path === '/collections/module-definitions' || path === '/collections/templates')
        return [];
      if (path === '/collections/forms') {
        stored = JSON.parse(String(init?.body)).schema;
        return new Promise((resolve) => {
          completeSave = resolve;
        });
      }
      if (path === '/collections/forms/created')
        return { id: 'created', canManage: true, schema: stored };
      return {};
    });
    render(
      <MemoryRouter>
        <CollectionWorkbench client={{ request: request as ApiClient['request'] }} />
      </MemoryRouter>,
    );
    const title = await screen.findByRole('textbox', { name: '表单名称' });
    fireEvent.change(title, { target: { value: '保存时的标题' } });
    fireEvent.click(screen.getByRole('button', { name: publish ? '检查并发布' : '保存草稿' }));
    await waitFor(() => expect(completeSave).toBeTypeOf('function'));
    fireEvent.change(title, { target: { value: '保存中继续编辑' } });
    await act(async () => completeSave({ id: 'created', schema: stored }));
    expect(title).toHaveValue('保存中继续编辑');
    expect(screen.getByRole('status')).toHaveTextContent(publish ? '表单已经发布' : '草稿已经保存');
  });

  it('lets mobile editors jump directly between the library, canvas and inspector', async () => {
    const request = vi.fn(async (path: string) =>
      path === '/collections/dashboard' ? { canCreate: true } : [],
    );
    render(
      <MemoryRouter>
        <CollectionWorkbench client={{ request: request as ApiClient['request'] }} />
      </MemoryRouter>,
    );
    const library = await screen.findByRole('complementary', { name: '模块库' });
    const inspector = screen.getByRole('complementary', { name: '属性编辑器' });
    screen.getByRole('navigation', { hidden: true }).style.display = 'flex';
    const jump = vi.fn();
    inspector.scrollIntoView = jump;
    fireEvent.click(screen.getByRole('link', { name: '属性编辑' }));
    expect(jump).toHaveBeenCalled();
    expect(inspector).toHaveFocus();
    expect(screen.getByRole('link', { name: '模块库' })).toHaveAttribute('href', `#${library.id}`);
    expect(screen.getByRole('link', { name: '表单画布' })).toHaveAttribute(
      'href',
      `#${screen.getByRole('region', { name: '表单仿真画布' }).id}`,
    );
  });
});
