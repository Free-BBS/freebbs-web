import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type {
  OrganizationGroupWorkspace,
  OrganizationGroupEntry,
} from '@freebbs-development/contracts';
import { ApiError, type ApiClient, type RequestOptions } from '../../core/api/client.js';
import { OrganizationGroupPage } from './OrganizationGroupPage.js';
import { OrganizationsPage } from '../organizations/OrganizationsPage.js';
import { parseRoster, shanghaiInput, shanghaiTimestamp, validateEntry } from './model.js';

const photo = {
  id: 'photo',
  originalName: '活动.png',
  mime: 'image/png',
  size: 20,
  previewable: true,
  purpose: 'activity_photo' as const,
  yearId: 'year',
  createdAt: '',
};
const version = {
  id: 'v1',
  yearId: 'year',
  number: 1,
  publishedAt: '',
  publishedBy: 'manager',
  activityTypes: [{ id: 'meeting', label: '组织生活' }],
  fields: [],
};
const workspace: OrganizationGroupWorkspace = {
  revision: 1,
  departmentId: 'youth_league.organization',
  activeYearId: 'year',
  viewScope: { kind: 'own' },
  hideDifficulties: false,
  ordinaryExport: false,
  maxPhotos: 9,
  maxPhotoBytes: 10485760,
  maxResourceBytes: 52428800,
  classes: [{ id: 'class', label: '电子班' }],
  members: [{ uid: 'student', studentId: '1001', classId: 'class', submitClassIds: ['class'] }],
  managerUids: [],
  years: [
    {
      id: 'year',
      label: '2026—2027',
      revision: 1,
      startDate: null,
      endDate: null,
      archived: false,
      submissionOpen: true,
      editOpen: true,
      currentVersionId: 'v1',
      draft: null,
    },
  ],
  versions: [version],
  canManage: false,
  canGrantManagers: false,
  canExport: false,
  allowedSubmitClassIds: ['class'],
  setupRequired: false,
  canSubmit: true,
  submissionBlockedReason: null,
};
const entry: OrganizationGroupEntry = {
  id: 'entry',
  yearId: 'year',
  versionId: 'v1',
  authorUid: 'student',
  authorName: '同学',
  classId: 'class',
  classLabel: '电子班',
  participantCount: 12,
  activityTypeId: 'meeting',
  activityTypeLabel: '组织生活',
  activityDate: null,
  summary: '原记录',
  difficulties: '原困难',
  extraAnswers: {},
  photos: [photo],
  extraPhotos: [],
  locked: false,
  revision: 1,
  createdAt: '2026-10-11T00:00:00Z',
  updatedAt: '',
  canEdit: true,
  editBlockedReason: null,
};
function setup(
  overrides: Partial<OrganizationGroupWorkspace> = {},
  save = vi.fn(async (options?: RequestOptions) => {
    expect(options?.method).toBe('POST');
    return entry;
  }),
) {
  const request = vi.fn(async (path: string, options?: RequestOptions) => {
    if (path === '/organization-group/workspace') return { ...workspace, ...overrides };
    if (path === '/organization-group/uploads') return photo;
    if (path.endsWith('/draft') && options?.method === 'PUT') {
      const body = JSON.parse(String(options.body));
      overrides.years = [{ ...workspace.years[0]!, revision: 2, draft: body }];
      return overrides.years[0];
    }
    if (path === '/organization-group/entries' && options?.method === 'POST') return save(options);
    if (path.endsWith('/edit-context'))
      return {
        entry,
        version: {
          ...version,
          fields: [{ id: 'old', label: '旧版本问题', kind: 'text', required: false }],
        },
      };
    if (path === '/organization-group/entries/entry' && options?.method === 'PATCH')
      return save(options);
    if (path === '/organization-group/entries/entry') return entry;
    if (path.startsWith('/organization-group/entries?'))
      return {
        items: [entry],
        total: 21,
        page: 1,
        pageSize: 20,
        statistics: {
          activityCount: 21,
          participantTimes: 252,
          byClass: { class: 21 },
          byActivityType: { meeting: 21 },
        },
      };
    return { items: [] };
  });
  const download = vi.fn(async () => new Blob(['image'], { type: 'image/png' }));
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <OrganizationGroupPage client={{ request: request as ApiClient['request'], download }} />
    </MemoryRouter>,
  );
  return { request, save, download };
}
async function fill() {
  await screen.findByLabelText('活动概要');
  fireEvent.change(screen.getByLabelText('参与人数'), { target: { value: '12' } });
  fireEvent.change(screen.getByLabelText('活动类型'), { target: { value: 'meeting' } });
  fireEvent.change(screen.getByLabelText('活动概要'), { target: { value: '新活动' } });
  fireEvent.change(screen.getByLabelText('活动照片'), {
    target: { files: [new File(['png'], '活动.png', { type: 'image/png' })] },
  });
  await screen.findByText('活动.png');
}
describe('organization group user flows', () => {
  it('uses only server management permissions and guides an empty directory', async () => {
    setup({
      setupRequired: true,
      canSubmit: false,
      classes: [],
      allowedSubmitClassIds: [],
      submissionBlockedReason: '请联系管理员配置班级和名册',
    });
    expect(await screen.findByText('请联系管理员配置班级和名册')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: '管理设置' })).not.toBeInTheDocument();
  });
  it('shows explicit manager grants only to grant administrators', async () => {
    setup({ canManage: true });
    fireEvent.click(await screen.findByRole('tab', { name: '管理设置' }));
    expect(await screen.findByLabelText('班级目录')).toBeInTheDocument();
    expect(screen.queryByLabelText('管理员 UID')).not.toBeInTheDocument();
  });
  it('keeps confirmation visible when saving a questionnaire updates the year revision', async () => {
    setup({ canManage: true });
    fireEvent.click(await screen.findByRole('tab', { name: '管理设置' }));
    fireEvent.click(screen.getByRole('button', { name: '保存问卷草稿' }));
    expect(await screen.findByText('问卷草稿已保存。')).toBeInTheDocument();
  });
  it('starts a fresh form and token after each successful submission', async () => {
    const { save } = setup();
    await fill();
    fireEvent.click(screen.getByRole('button', { name: '提交活动' }));
    await screen.findByText('活动已提交，可以继续填报下一次活动。');
    expect(screen.getByLabelText('活动概要')).toHaveValue('');
    expect(screen.queryByText('活动.png')).not.toBeInTheDocument();
    await fill();
    fireEvent.click(screen.getByRole('button', { name: '提交活动' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(new Headers(save.mock.calls[0]![0]!.headers).get('Idempotency-Key')).not.toBe(
      new Headers(save.mock.calls[1]![0]!.headers).get('Idempotency-Key'),
    );
  });
  it('retains the draft, uploaded files and token after a failed save', async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(409, 'version_conflict', '问卷版本已更新', null))
      .mockResolvedValue(entry);
    setup({}, save);
    await fill();
    fireEvent.click(screen.getByRole('button', { name: '提交活动' }));
    await screen.findByText('问卷版本已更新');
    expect(screen.getByLabelText('活动概要')).toHaveValue('新活动');
    expect(screen.getByText('活动.png')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '提交活动' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(new Headers(save.mock.calls[0]![0].headers).get('Idempotency-Key')).toBe(
      new Headers(save.mock.calls[1]![0].headers).get('Idempotency-Key'),
    );
  });
  it('rotates a retry token when the user changes the previously attempted payload', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('网络中断')).mockResolvedValue(entry);
    setup({}, save);
    await fill();
    fireEvent.click(screen.getByRole('button', { name: '提交活动' }));
    await screen.findByText('网络中断');
    fireEvent.change(screen.getByLabelText('活动概要'), { target: { value: '修正后的活动' } });
    fireEvent.click(screen.getByRole('button', { name: '提交活动' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(new Headers(save.mock.calls[0]![0].headers).get('Idempotency-Key')).not.toBe(
      new Headers(save.mock.calls[1]![0].headers).get('Idempotency-Key'),
    );
  });
  it('can adopt a newer questionnaire after conflict while retaining uploaded photos and summary', async () => {
    const overrides: Partial<OrganizationGroupWorkspace> = {};
    const save = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(409, 'version_conflict', '问卷版本已更新', null))
      .mockResolvedValue(entry);
    setup(overrides, save);
    await fill();
    fireEvent.click(screen.getByRole('button', { name: '提交活动' }));
    await screen.findByText('问卷版本已更新');
    overrides.versions = [
      version,
      {
        ...version,
        id: 'v2',
        number: 2,
        fields: [{ id: 'new', label: '新问题', kind: 'text', required: false }],
      },
    ];
    overrides.years = [{ ...workspace.years[0]!, currentVersionId: 'v2', revision: 2 }];
    fireEvent.click(screen.getByRole('button', { name: '读取最新问卷' }));
    fireEvent.click(await screen.findByRole('button', { name: '保留草稿并使用最新问卷' }));
    expect(screen.getByLabelText('活动概要')).toHaveValue('新活动');
    expect(screen.getByText('活动.png')).toBeInTheDocument();
    expect(screen.getByLabelText('新问题')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '提交活动' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(JSON.parse(save.mock.calls[1]![0].body).expectedVersionId).toBe('v2');
  });
  it('counts Unicode points including whitespace and blocks invalid integers', async () => {
    const { save } = setup();
    await fill();
    fireEvent.change(screen.getByLabelText('活动概要'), {
      target: { value: '😀'.repeat(199) + ' ' },
    });
    expect(screen.getByText('200 / 200')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('参与人数'), { target: { value: '1.2' } });
    fireEvent.click(screen.getByRole('button', { name: '提交活动' }));
    expect(await screen.findByText('参与人数必须为正整数。')).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });
  it('loads original immutable questionnaire for own edit and keeps draft on conflict', async () => {
    setup(
      {},
      vi
        .fn()
        .mockRejectedValue(
          new ApiError(409, 'revision_conflict', '记录已更新，请核对最新记录', null),
        ),
    );
    fireEvent.click(await screen.findByRole('tab', { name: '活动台账' }));
    expect(await screen.findByText('252')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '查看详情' }));
    fireEvent.click(await screen.findByRole('button', { name: '编辑我的活动' }));
    expect(await screen.findByLabelText('旧版本问题')).toBeInTheDocument();
    const panel = within(screen.getByRole('tabpanel', { name: '活动台账' }));
    fireEvent.change(panel.getByLabelText('活动概要'), { target: { value: '修改记录' } });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await screen.findByText('记录已更新，请核对最新记录');
    expect(panel.getByLabelText('活动概要')).toHaveValue('修改记录');
    expect(screen.getByText('活动.png')).toBeInTheDocument();
  });
  it('does not render materials authoring actions for ordinary members', async () => {
    setup();
    fireEvent.click(await screen.findByRole('tab', { name: '截止事项与资料' }));
    expect(await screen.findByText('当前学年暂无可查看的资料。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '添加截止事项' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '发布资料' })).not.toBeInTheDocument();
  });
  it('shows category totals for all filtered activities', async () => {
    setup();
    fireEvent.click(await screen.findByRole('tab', { name: '活动台账' }));
    expect(await screen.findByText('电子班：21 次')).toBeInTheDocument();
    expect(screen.getByText('组织生活：21 次')).toBeInTheDocument();
  });
  it('provides a prominent entry only on the organization group homepage', async () => {
    const request = vi.fn(async (path: string) =>
      path.endsWith('/activities')
        ? { active: [], past: [] }
        : { html: null, canEdit: false, revision: 1 },
    );
    const view = render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <OrganizationsPage
          organizationKey="youth_league"
          departmentKey="organization"
          client={{ request: request as ApiClient['request'] }}
        />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('link', { name: /班级活动台账/ })).toHaveAttribute(
      'href',
      '/organizations/youth_league/organization/ledger',
    );
    view.rerender(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <OrganizationsPage
          organizationKey="student_union"
          departmentKey="sports_center"
          client={{ request: request as ApiClient['request'] }}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('link', { name: /班级活动台账/ })).not.toBeInTheDocument();
  });
});
describe('input helpers', () => {
  it('matches roster UID and student number and rejects unknown class references', () => {
    expect(
      parseRoster('uid,studentId,classId,submitClassIds\nuser,2026001,c,c|d', [
        { id: 'c', label: 'C' },
        { id: 'd', label: 'D' },
      ]),
    ).toEqual([{ uid: 'user', studentId: '2026001', classId: 'c', submitClassIds: ['c', 'd'] }]);
    expect(() => parseRoster('user,2026001,unknown,c', [{ id: 'c', label: 'C' }])).toThrow(
      '第 1 行',
    );
  });
  it('converts deadlines as Shanghai wall time regardless of machine timezone', () => {
    expect(shanghaiInput('2026-10-11T04:05:00Z')).toBe('2026-10-11T12:05');
    expect(shanghaiTimestamp('2026-10-11T12:05')).toBe('2026-10-11T12:05:00+08:00');
  });
  it('includes whitespace in the summary limit', () => {
    expect(
      validateEntry(
        {
          classId: 'c',
          participantCount: '1',
          activityTypeId: 'meeting',
          summary: '😀'.repeat(200) + ' ',
          difficulties: '',
          activityDate: '',
          photos: [photo],
          extraAnswers: {},
        },
        version,
        workspace,
      ),
    ).toBe('活动概要最多 200 字（包含空白）。');
  });
});
