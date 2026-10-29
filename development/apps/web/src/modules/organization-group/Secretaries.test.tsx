import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ClassSecretaryUser } from '@freebbs-development/contracts';
import { ClassSecretaries } from './Secretaries.js';
import type { GroupClient } from './OrganizationGroupPage.js';

const classes = [{ id: 'wu55', label: '无55' }];
const initial: ClassSecretaryUser = {
  uid: 'student-a',
  username: 'alice',
  displayName: '同学甲',
  studentId: '2026000001',
  classIds: [],
  revision: 'a'.repeat(64),
};

describe('class secretary authorization editor', () => {
  it('searches a registered user, saves class grants and supports revocation', async () => {
    const call = vi.fn(async (path: string, options?: { method?: string; body?: unknown }) => {
      if (options?.method === 'PUT') {
        const body = JSON.parse(options.body as string);
        return { ...initial, classIds: body.classIds, revision: 'b'.repeat(64) };
      }
      return { items: [initial], classes, page: 1, pageSize: 12, total: 1 };
    });
    render(
      <ClassSecretaries api={{ request: call } as unknown as GroupClient} classes={classes} />,
    );
    fireEvent.click(await screen.findByRole('button', { name: /同学甲/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: '无55' }));
    fireEvent.click(screen.getByRole('button', { name: '保存授权' }));
    await screen.findByText('团支书授权已保存');
    const write = call.mock.calls.find(([, opts]) => opts?.method === 'PUT');
    expect(write?.[0]).toBe('/organization-group/secretaries/student-a');
    expect(JSON.parse(write?.[1]?.body as string)).toEqual({
      classIds: ['wu55'],
      revision: initial.revision,
    });
    fireEvent.click(screen.getByRole('button', { name: '撤销团支书' }));
    await screen.findByText('团支书授权已撤销');
    expect(screen.getByRole('checkbox', { name: '无55' })).not.toBeChecked();
    fireEvent.change(screen.getByLabelText('查找同学'), { target: { value: 'alice' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith(expect.stringContaining('query=alice')));
  });
});
