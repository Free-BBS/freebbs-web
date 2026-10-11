import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import type { ApiClient } from '../../core/api/client.js';
import { CollectionResultsPage } from './CollectionResultsPage.js';
it('shows scoped results and imports a roster with row feedback', async () => {
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.includes('/recipients/import')) {
      expect(init?.body).toBeInstanceOf(FormData);
      return {
        imported: 1,
        duplicates: 1,
        errors: [{ row: 3, message: '学号无效' }],
        errorCount: 1,
      };
    }
    if (path.includes('/recipients'))
      return {
        items: [],
        total: 0,
        page: 1,
        pageSize: 25,
        stats: { total: 2, completed: 1, pending: 1 },
      };
    return {
      form: {
        id: 'form',
        title: '结果管理',
        status: 'published',
        canManage: true,
        schema: {
          fields: [{ id: 'text', kind: 'short_text', label: '意见' }],
          outputs: [],
          publicRegistration: true,
        },
      },
      items: [
        {
          id: 'one',
          respondentUid: '访客',
          guest: true,
          answers: { text: '完成' },
          submittedAt: '2026-10-10T00:00:00Z',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 25,
      stats: { submitted: 1, authenticated: 0, guests: 1, choices: {} },
    };
  });
  render(
    <MemoryRouter initialEntries={['/collections/results/form']}>
      <Routes>
        <Route
          path="/collections/results/:collectionId"
          element={<CollectionResultsPage client={{ request: request as ApiClient['request'] }} />}
        />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByText('结果管理');
  expect(screen.getByText('完成')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('导入姓名学号名单'), {
    target: { files: [new File(['姓名,学号\n张三,001'], '名单.csv', { type: 'text/csv' })] },
  });
  await waitFor(() => expect(screen.getByText(/导入 1 人/)).toBeTruthy());
  expect(screen.getByText(/第 3 行：学号无效/)).toBeTruthy();
});
