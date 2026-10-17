import {
  DEVELOPMENT_IDENTITY_SECTIONS,
  type SystemSettingsBootstrap,
} from '@freebbs-development/contracts';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../../core/api/client.js';
import { SystemSettingsPage } from './SystemSettingsPage.js';

const { reload, mockAuth } = vi.hoisted(() => ({ reload: vi.fn(), mockAuth: vi.fn() }));
vi.mock('../../core/auth/AuthProvider.js', () => ({
  useOptionalAuth: mockAuth,
}));

const person = {
  uid: 'target',
  username: 'Target',
  displayName: '目标同学',
  studentId: '2023000002',
  avatarUrl: null,
  roles: [],
  captainTeamIds: [],
  revision: 'revision-1',
  canReceiveNotifications: true,
};
const bootstrap: SystemSettingsBootstrap = {
  users: [person],
  identitySections: DEVELOPMENT_IDENTITY_SECTIONS,
  organizations: {
    revision: 1,
    organizations: [{ id: 'arts_center', name: '文艺中心', description: '文艺活动' }],
    roles: [{ key: 'platform.admin', name: '平台管理员' }],
  },
  sportsTeams: [{ id: 'basketball', name: '男篮代表队' }],
  modules: [],
  notifications: [],
  rewards: [],
  audits: { items: [], page: 1, pageSize: 20, total: 0 },
  rewardMode: 'demo',
};
function setup(overrides?: (path: string, init?: RequestInit) => unknown) {
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    const custom = overrides?.(path, init);
    if (custom !== undefined) return custom;
    if (path === '/system-settings') return structuredClone(bootstrap);
    if (path.startsWith('/system-settings/users') && !init) return [person];
    if (path === '/system-settings/users/target')
      return { ...person, ...JSON.parse(String(init?.body)), revision: 'revision-2' };
    if (path === '/system-settings/organizations') return bootstrap.organizations;
    if (path === '/system-settings/notifications' || path === '/system-settings/rewards') return [];
    if (path.startsWith('/system-settings/audit-logs')) return bootstrap.audits;
    if (path === '/admin/development-users') return [{ ...person, accessLevel: 'member' }];
    if (path === '/sports/teams') return [];
    throw new Error(`Unexpected request ${path}`);
  });
  render(<SystemSettingsPage client={{ request: request as ApiClient['request'] }} />);
  return request;
}
async function tab(name: string) {
  await userEvent.click(await screen.findByRole('tab', { name }));
}

describe('SystemSettingsPage', () => {
  beforeEach(() => mockAuth.mockReturnValue({ user: { uid: 'target' }, reload }));
  it('mounts only the active directory panel and follows server pages', async () => {
    const request = setup((path) => {
      if (path === '/system-settings')
        return { ...bootstrap, usersPage: { items: [person], page: 1, pageSize: 20, total: 21 } };
      if (path.includes('/system-settings/users?') && path.includes('page=2'))
        return {
          items: [{ ...person, uid: 'late', username: 'Late' }],
          page: 2,
          pageSize: 20,
          total: 21,
        };
    });
    await screen.findByRole('complementary', { name: '\u7528\u6237\u5217\u8868' });
    expect(document.querySelector('.settings-recipient-list')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '\u4e0b\u4e00\u9875' }));
    expect(await screen.findByText('Late')).toBeInTheDocument();
    expect(request.mock.calls.some(([path]) => path.includes('page=2'))).toBe(true);
  });
  it('shows all settings tabs while previewing without allowing changes or batch delivery', async () => {
    mockAuth.mockReturnValue({ user: { uid: 'target', previewing: true }, reload });
    const request = setup();
    await screen.findByRole('tab', { name: '用户身份' });
    expect(screen.getByRole('checkbox', { name: /^平台管理员/ })).toBeDisabled();
    await tab('组织配置');
    expect(screen.getByLabelText('文艺中心名称')).toBeDisabled();
    expect(screen.getByRole('button', { name: '保存组织配置' })).toBeDisabled();
    await tab('通知');
    expect(screen.getByRole('textbox', { name: '通知标题' })).toBeDisabled();
    await tab('奖励');
    expect(screen.getByRole('textbox', { name: '奖励标题' })).toBeDisabled();
    expect(request.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(
      true,
    );
  });
  it('allows browsing a second user and expanding their identity and team details during preview', async () => {
    mockAuth.mockReturnValue({ user: { uid: 'target', previewing: true }, reload });
    setup((path) =>
      path === '/system-settings'
        ? {
            ...bootstrap,
            users: [
              person,
              {
                ...person,
                uid: 'second',
                username: 'Second',
                displayName: '第二位同学',
                roles: ['department.sports_member'],
                captainTeamIds: ['basketball'],
              },
            ],
          }
        : undefined,
    );
    const directory = await screen.findByRole('complementary', { name: '用户列表' });
    await userEvent.click(within(directory).getByRole('button', { name: /Second/ }));
    expect(screen.getByRole('heading', { name: '第二位同学' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /电子系学生会/ }));
    const member = screen.getByRole('button', { name: '体育中心：部员' });
    expect(member).toHaveAttribute('aria-pressed', 'true');
    expect(member).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /代表队队长/ }));
    expect(screen.getByRole('checkbox', { name: '男篮代表队' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '男篮代表队' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '保存身份设置' })).toBeDisabled();
  });
  it('applies saved organization names to identity groups and captions without changing concise positions', async () => {
    const metadata = {
      revision: 1,
      organizations: [{ id: 'sports_center' as const, name: '体育中心', description: '' }],
      roles: [{ key: 'department.sports_member' as const, name: '体育中心部员' }],
    };
    setup((path, init) => {
      if (path === '/system-settings')
        return {
          ...bootstrap,
          users: [{ ...person, roles: ['department.sports_member'] }],
          organizations: metadata,
        };
      if (path === '/system-settings/organizations' && init?.method === 'PATCH')
        return { ...JSON.parse(String(init.body)), revision: 2 };
    });
    await tab('组织配置');
    await userEvent.clear(screen.getByLabelText('体育中心名称'));
    await userEvent.type(screen.getByLabelText('体育中心名称'), '赛场中心');
    await userEvent.click(screen.getByRole('button', { name: '保存组织配置' }));
    await screen.findByRole('status');
    await tab('用户身份');
    expect(
      within(screen.getByRole('complementary', { name: '用户列表' })).getByText('赛场中心部员'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /电子系学生会/ }));
    expect(screen.getByRole('heading', { name: '赛场中心' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '赛场中心：部员' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: '赛场中心：负责人' })).toBeInTheDocument();
  });
  it('propagates customized role names immediately and after a fresh bootstrap without duplicate prefixes', async () => {
    let metadata = {
      revision: 1,
      organizations: [{ id: 'sports_center' as const, name: '体育中心', description: '' }],
      roles: [
        { key: 'department.sports_member' as const, name: '体育中心部员' },
        { key: 'platform.admin' as const, name: '平台管理员' },
      ],
    };
    const overrides = (path: string, init?: RequestInit) => {
      if (path === '/system-settings')
        return {
          ...bootstrap,
          users: [{ ...person, roles: ['department.sports_member', 'platform.admin'] }],
          organizations: metadata,
        };
      if (path === '/system-settings/organizations' && init?.method === 'PATCH') {
        metadata = { ...JSON.parse(String(init.body)), revision: 2 };
        return metadata;
      }
    };
    setup(overrides);
    await tab('组织配置');
    await userEvent.clear(screen.getByLabelText('体育中心名称'));
    await userEvent.type(screen.getByLabelText('体育中心名称'), '赛场中心');
    await userEvent.click(screen.getByText('身份展示名称'));
    await userEvent.clear(screen.getByLabelText('体育中心部员'));
    await userEvent.type(screen.getByLabelText('体育中心部员'), '赛场中心活动成员');
    await userEvent.clear(screen.getByLabelText('平台管理员'));
    await userEvent.type(screen.getByLabelText('平台管理员'), '运营管理员');
    await userEvent.click(screen.getByRole('button', { name: '保存组织配置' }));
    await screen.findByRole('status');
    await tab('用户身份');
    const row = within(screen.getByRole('complementary', { name: '用户列表' })).getByRole(
      'button',
      { name: /Target/ },
    );
    expect(row).toHaveTextContent('运营管理员 · 赛场中心活动成员');
    expect(row).not.toHaveTextContent('赛场中心赛场中心');
    expect(screen.getByRole('checkbox', { name: /^运营管理员/ })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: /电子系学生会/ }));
    expect(screen.getByRole('button', { name: '赛场中心：赛场中心活动成员' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /电子系学生会/ })).toHaveTextContent(
      '已选 1 项 · 赛场中心活动成员',
    );
    cleanup();
    setup(overrides);
    await screen.findByRole('tab', { name: '用户身份' });
    const reloadedRow = within(screen.getByRole('complementary', { name: '用户列表' })).getByRole(
      'button',
      { name: /Target/ },
    );
    expect(reloadedRow).toHaveTextContent('运营管理员 · 赛场中心活动成员');
    await userEvent.click(screen.getByRole('button', { name: /电子系学生会/ }));
    expect(screen.getByRole('heading', { name: '赛场中心' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '赛场中心：赛场中心活动成员' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
  it('shows readable audit actions and pending outcomes while retaining complete technical details', async () => {
    const longId = 'resource-' + 'abcdef0123456789'.repeat(12);
    const longUid = 'uid-' + '0123456789'.repeat(20);
    const record = {
      id: 'audit-1',
      actorUid: person.uid,
      action: 'system_settings.reward.grant',
      resourceType: 'reward',
      resourceId: longId,
      details: { previous: null, next: { recipientUid: longUid, result: longId } },
      status: 'active',
      ownerUid: person.uid,
      scope: { type: 'public', id: '*' },
      createdAt: '2026-10-13T00:00:00Z',
      updatedAt: '2026-10-13T00:00:00Z',
    };
    setup((path) =>
      path.startsWith('/system-settings/audit-logs')
        ? {
            items: [
              record,
              { ...record, id: 'audit-2', action: 'business.admin_override', status: 'pending' },
            ],
            page: 1,
            pageSize: 20,
            total: 21,
          }
        : undefined,
    );
    await tab('操作记录');
    const panel = screen.getByRole('tabpanel');
    expect(await within(panel).findByText('发放奖励')).toBeInTheDocument();
    expect(within(panel).getAllByText('Target')).toHaveLength(2);
    expect(within(panel).getByText('待核实')).toBeInTheDocument();
    const details = panel.querySelector('details')!;
    await userEvent.click(within(details).getByText('查看变更摘要'));
    expect(details).toHaveAttribute('open');
    expect(details.querySelector('pre')?.textContent).toContain(longUid);
    expect(details.querySelector('pre')?.textContent).toContain(longId);
    await userEvent.click(within(panel).getByRole('button', { name: '下一页' }));
    expect(await within(panel).findByText('第 2 页 · 共 21 条')).toBeInTheDocument();
  });
  beforeEach(() => reload.mockReset());
  it('offers five separate settings tabs inside the development shell', async () => {
    setup();
    expect(await screen.findByRole('heading', { name: '系统设置' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((item) => item.textContent)).toEqual([
      '用户身份',
      '组织配置',
      '通知',
      '奖励',
      '操作记录',
    ]);
    expect(document.querySelector('iframe')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '以此身份预览' })).not.toBeInTheDocument();
    expect(screen.queryByText('发展端访问')).not.toBeInTheDocument();
  });
  it('saves only revision, exclusive organization identities and selected captain teams', async () => {
    const request = setup();
    await screen.findByRole('tab', { name: '用户身份' });
    await userEvent.click(screen.getByRole('button', { name: /电子系学生会/ }));
    await userEvent.click(screen.getByRole('button', { name: '文艺中心：负责人' }));
    await userEvent.click(screen.getByRole('button', { name: '文艺中心：部员' }));
    expect(screen.getByRole('button', { name: '文艺中心：负责人' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await userEvent.click(screen.getByRole('button', { name: '体育中心：部员' }));
    expect(screen.getByRole('button', { name: '文艺中心：部员' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await userEvent.click(screen.getByRole('checkbox', { name: /^平台管理员/ }));
    const media = screen.getByRole('button', { name: /电子系学生媒体中心/ });
    const captain = screen.getByRole('button', { name: /代表队队长/ });
    expect(media.compareDocumentPosition(captain)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    await userEvent.click(captain);
    await userEvent.click(screen.getByRole('checkbox', { name: /^担任代表队队长/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: '男篮代表队' }));
    await userEvent.click(screen.getByRole('button', { name: '保存身份设置' }));
    const save = request.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(JSON.parse(String(save?.[1]?.body))).toEqual({
      revision: 'revision-1',
      roles: ['department.sports_member', 'platform.admin'],
      captainTeamIds: ['basketball'],
    });
    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
  });
  it('preserves a failed draft and requires explicit refresh after revision conflict', async () => {
    const request = setup((path, init) => {
      if (init?.method === 'PUT')
        throw new ApiError(409, 'revision_conflict', '身份已被其他管理员修改', null);
    });
    await screen.findByRole('tab', { name: '用户身份' });
    await userEvent.click(screen.getByRole('checkbox', { name: /^平台管理员/ }));
    await userEvent.click(screen.getByRole('button', { name: '保存身份设置' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('身份已被其他管理员修改');
    expect(screen.getByRole('checkbox', { name: /^平台管理员/ })).toBeChecked();
    expect(screen.getByRole('button', { name: '保存身份设置' })).toBeDisabled();
    await userEvent.type(
      screen.getByRole('textbox', { name: '搜索用户名、学号或 UID' }),
      'missing',
    );
    await userEvent.click(screen.getByRole('button', { name: '搜索' }));
    expect(request.mock.calls.some(([path]) => String(path).includes('query=missing'))).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: '重新加载身份' }));
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: /^平台管理员/ })).not.toBeChecked(),
    );
  });
  it('previews scoped notification recipients and reports the returned count', async () => {
    const request = setup((path, init) =>
      path === '/system-settings/notifications' && init?.method === 'POST'
        ? { id: 'notice', recipientCount: 1, replayed: false }
        : undefined,
    );
    await tab('通知');
    await userEvent.type(screen.getByLabelText('通知标题'), '训练安排');
    await userEvent.type(screen.getByLabelText('通知正文'), '周五训练');
    await userEvent.click(screen.getByRole('checkbox', { name: /Target/ }));
    await userEvent.click(screen.getByRole('button', { name: '预览通知' }));
    const dialog = screen.getByRole('alertdialog', { name: '确认发送通知' });
    expect(dialog).toHaveTextContent('1 位同学');
    await userEvent.click(within(dialog).getByRole('button', { name: '确认发送' }));
    expect(await screen.findByRole('status')).toHaveTextContent('已发送给 1 位同学');
    const save = request.mock.calls.find(
      ([path, init]) => path === '/system-settings/notifications' && init?.method === 'POST',
    );
    expect(JSON.parse(String(save?.[1]?.body))).toMatchObject({
      recipientUids: ['target'],
      title: '训练安排',
      body: '周五训练',
    });
  });
  it('keeps users without development access editable but unavailable as recipients', async () => {
    setup((path) =>
      path === '/system-settings'
        ? { ...bootstrap, users: [{ ...person, canReceiveNotifications: false }] }
        : undefined,
    );
    await screen.findByRole('tab', { name: '用户身份' });
    expect(screen.getByRole('checkbox', { name: /^平台管理员/ })).toBeEnabled();
    await tab('通知');
    expect(screen.getByRole('checkbox', { name: /Target/ })).toBeDisabled();
    expect(within(screen.getByRole('tabpanel')).getByText('未开放发展端')).toBeInTheDocument();
    await tab('奖励');
    expect(screen.getByRole('checkbox', { name: /Target/ })).toBeDisabled();
  });
  it('retains reward retry identity and locked draft across tab changes after provider failure', async () => {
    let attempts = 0;
    const request = setup((path, init) => {
      if (path !== '/system-settings/rewards' || init?.method !== 'POST') return;
      if (++attempts === 1)
        throw new ApiError(503, 'reward_provider_unavailable', '奖励服务暂不可用', null);
      return {
        batchId: 'batch-7',
        recipientCount: 1,
        electric: 5,
        magnetic: 2,
        totalElectric: 5,
        totalMagnetic: 2,
        replayed: false,
      };
    });
    await tab('奖励');
    expect(screen.getByText(/演示奖励/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('奖励标题'), '训练奖励');
    await userEvent.type(screen.getByLabelText('奖励原因'), '参加训练');
    fireEvent.change(screen.getByLabelText('每人电元'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('每人磁元'), { target: { value: '2' } });
    await userEvent.click(screen.getByRole('checkbox', { name: /Target/ }));
    await userEvent.click(screen.getByRole('button', { name: '核对奖励' }));
    let dialog = screen.getByRole('alertdialog', { name: '确认发放奖励' });
    expect(dialog).toHaveTextContent('合计 5 电元 / 2 磁元');
    await userEvent.click(within(dialog).getByRole('button', { name: '确认发放' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('奖励服务暂不可用');
    await tab('组织配置');
    await tab('奖励');
    expect(screen.getByLabelText('奖励标题')).toHaveValue('训练奖励');
    expect(screen.getByLabelText('奖励标题')).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /Target/ })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: '核对奖励' }));
    dialog = screen.getByRole('alertdialog', { name: '确认发放奖励' });
    await userEvent.click(within(dialog).getByRole('button', { name: '确认发放' }));
    expect(await screen.findByRole('status')).toHaveTextContent('batch-7');
    const writes = request.mock.calls.filter(
      ([path, init]) => path === '/system-settings/rewards' && init?.method === 'POST',
    );
    expect(JSON.parse(String(writes[0][1]?.body)).requestId).toBe(
      JSON.parse(String(writes[1][1]?.body)).requestId,
    );
  });
  it('preserves unsaved identity and organization drafts while switching lazily mounted tabs', async () => {
    setup();
    await screen.findByRole('tab', { name: '用户身份' });
    await userEvent.click(screen.getByRole('checkbox', { name: /^平台管理员/ }));
    await tab('组织配置');
    await userEvent.clear(screen.getByLabelText('文艺中心名称'));
    await userEvent.type(screen.getByLabelText('文艺中心名称'), '未保存的文艺中心');
    await tab('用户身份');
    expect(screen.getByRole('checkbox', { name: /^平台管理员/ })).toBeChecked();
    await tab('组织配置');
    expect(screen.getByLabelText('文艺中心名称')).toHaveValue('未保存的文艺中心');
  });
  it('keeps organization metadata when stale and reloads only on request', async () => {
    setup((path, init) => {
      if (path === '/system-settings/organizations' && init?.method === 'PATCH')
        throw new ApiError(409, 'stale', '组织配置已更新', null);
    });
    await tab('组织配置');
    await userEvent.clear(screen.getByLabelText('文艺中心名称'));
    await userEvent.type(screen.getByLabelText('文艺中心名称'), '新名称');
    await userEvent.click(screen.getByRole('button', { name: '保存组织配置' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('组织配置已更新');
    expect(screen.getByLabelText('文艺中心名称')).toHaveValue('新名称');
    await userEvent.click(screen.getByRole('button', { name: '重新加载组织配置' }));
    await waitFor(() => expect(screen.getByLabelText('文艺中心名称')).toHaveValue('文艺中心'));
  });
});
