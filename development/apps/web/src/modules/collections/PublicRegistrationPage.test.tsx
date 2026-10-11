import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { PublicRegistrationPage } from './PublicRegistrationPage.js';
it('submits publicly using an isolated session without auth headers and displays an opaque receipt', async () => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const data = url.endsWith('/session')
      ? { sessionToken: 'a'.repeat(64) }
      : url.endsWith('/responses')
        ? { receiptToken: 'b'.repeat(64), submittedAt: '2026-10-10T12:00:00Z' }
        : {
            id: 'form',
            title: '无需登录',
            description: '公开填写',
            status: 'open',
            schema: {
              title: '无需登录',
              description: '',
              fields: [
                {
                  id: 'answer',
                  kind: 'short_text',
                  label: '留言',
                  helpText: '',
                  options: [],
                  rules: [],
                },
              ],
              formRules: [],
              outputs: [],
            },
          };
    expect(init?.credentials).toBe('omit');
    expect(new Headers(init?.headers).has('Authorization')).toBe(false);
    expect(new Headers(init?.headers).has('X-Demo-User')).toBe(false);
    return new Response(JSON.stringify({ data }), { status: 200 });
  });
  render(
    <MemoryRouter initialEntries={['/collections/public/form']}>
      <Routes>
        <Route
          path="/collections/public/:collectionId"
          element={<PublicRegistrationPage fetcher={fetcher as typeof fetch} />}
        />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.change(await screen.findByLabelText('留言'), { target: { value: '访客回答' } });
  fireEvent.click(screen.getByRole('button', { name: '提交公开报名' }));
  await screen.findByText('提交成功');
  await waitFor(() =>
    expect(fetcher).toHaveBeenCalledWith(
      '/api/development/v1/collections/public/forms/form/responses',
      expect.objectContaining({
        body: JSON.stringify({ sessionToken: 'a'.repeat(64), answers: { answer: '访客回答' } }),
      }),
    ),
  );
  expect(screen.getByText(/未经学校身份认证/)).toBeTruthy();
});
