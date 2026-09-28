import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type { ApiClient } from '../../../core/api/client.js';
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
});
