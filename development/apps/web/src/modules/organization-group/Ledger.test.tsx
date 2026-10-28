import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  OrganizationGroupWorkspace,
  OrganizationGroupYear,
  OrganizationGroupEntry,
} from '@freebbs-development/contracts';
import type { ApiClient } from '../../core/api/client.js';
import { Ledger } from './Ledger.js';

const year: OrganizationGroupYear = {
  id: 'year',
  label: '2026—2027',
  revision: 1,
  startDate: null,
  endDate: null,
  archived: false,
  submissionOpen: true,
  editOpen: true,
  currentVersionId: null,
  draft: null,
};
const workspace: OrganizationGroupWorkspace = {
  revision: 1,
  departmentId: 'youth_league.organization',
  activeYearId: year.id,
  viewScope: { kind: 'own' },
  hideDifficulties: false,
  ordinaryExport: true,
  maxPhotos: 9,
  maxPhotoBytes: 10485760,
  maxResourceBytes: 52428800,
  classes: [],
  members: [],
  managerUids: [],
  years: [year],
  versions: [],
  canManage: false,
  canGrantManagers: false,
  canExport: true,
  allowedSubmitClassIds: [],
  setupRequired: false,
  canSubmit: false,
  submissionBlockedReason: null,
};
const rows = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 20,
  statistics: { activityCount: 0, participantTimes: 0, byClass: {}, byActivityType: {} },
};
afterEach(() => vi.restoreAllMocks());

describe('organization ledger export lifecycle', () => {
  it('renders multiple activity tags and participant names as readable table cells', async () => {
    const item: OrganizationGroupEntry = {
      id: 'entry',
      yearId: 'year',
      versionId: 'v2',
      authorUid: 'student',
      authorName: '团支书',
      classId: 'c1',
      classLabel: '无60',
      participantCount: 2,
      activityTypeId: 'theme',
      activityTypeLabel: '主题团日',
      activityTypeIds: ['theme', 'art'],
      activityTypeLabels: ['主题团日', '美育建设'],
      participantNames: '张三、李四',
      activityDate: '2026-10-28',
      summary: '观影交流',
      difficulties: '无',
      extraAnswers: {},
      photos: [],
      extraPhotos: [],
      locked: false,
      revision: 1,
      createdAt: '2026-10-28T01:00:00Z',
      updatedAt: '',
      canEdit: false,
      editBlockedReason: '只能修改本人记录',
    };
    const api = {
      request: vi
        .fn()
        .mockResolvedValue({ ...rows, items: [item], total: 1 }) as ApiClient['request'],
    };
    render(
      <Ledger api={api} workspace={{ ...workspace, canViewAll: true }} year={year} refresh={0} />,
    );
    expect(await screen.findByRole('table', { name: '全系活动记录' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '张三、李四' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '主题团日 美育建设' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: '无60' })).toBeInTheDocument();
  });
  it('discards a private thumbnail download after its table is unmounted', async () => {
    const create = vi.spyOn(URL, 'createObjectURL');
    let resolve!: (blob: Blob) => void;
    const item: OrganizationGroupEntry = {
      id: 'entry',
      yearId: 'year',
      versionId: 'v1',
      authorUid: 'student',
      authorName: '团支书',
      classId: 'c1',
      classLabel: '无60',
      participantCount: 1,
      activityTypeId: 'theme',
      activityTypeLabel: '主题团日',
      activityDate: null,
      summary: '活动',
      extraAnswers: {},
      photos: [
        {
          id: 'photo',
          originalName: '合影.png',
          mime: 'image/png',
          size: 20,
          previewable: true,
          purpose: 'activity_photo',
          yearId: 'year',
          createdAt: '',
        },
      ],
      extraPhotos: [],
      locked: false,
      revision: 1,
      createdAt: '',
      updatedAt: '',
      canEdit: true,
      editBlockedReason: null,
    };
    const api = {
      request: vi
        .fn()
        .mockResolvedValue({ ...rows, items: [item], total: 1 }) as ApiClient['request'],
      download: vi.fn(
        () =>
          new Promise<Blob>((accept) => {
            resolve = accept;
          }),
      ),
    };
    const view = render(<Ledger api={api} workspace={workspace} year={year} refresh={0} />);
    await screen.findByRole('button', { name: '查看无60活动的1张照片' });
    await waitFor(() => expect(api.download).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async () => resolve(new Blob(['private photo'])));
    expect(create).not.toHaveBeenCalled();
  });
  it('saves a completed export while the same view is current', async () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:export');
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const api = {
      request: vi.fn().mockResolvedValue(rows) as ApiClient['request'],
      download: vi.fn(async () => new Blob(['xlsx'])),
    };
    render(<Ledger api={api} workspace={workspace} year={year} refresh={0} />);
    fireEvent.click(screen.getByRole('button', { name: '导出 Excel' }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledTimes(1);
    expect(api.download).toHaveBeenCalledWith(
      expect.stringContaining('/organization-group/export.xlsx?yearId=year'),
    );
  });

  it.each(['unmount', 'client', 'year', 'filter', 'access'] as const)(
    'discards a late Excel export after %s changes the initiating context',
    async (change) => {
      let resolve!: (blob: Blob) => void;
      const create = vi.spyOn(URL, 'createObjectURL');
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      const api = {
        request: vi.fn().mockResolvedValue(rows) as ApiClient['request'],
        download: vi.fn(
          () =>
            new Promise<Blob>((accept) => {
              resolve = accept;
            }),
        ),
      };
      const view = render(<Ledger api={api} workspace={workspace} year={year} refresh={0} />);
      fireEvent.click(screen.getByRole('button', { name: '导出 Excel' }));
      if (change === 'unmount') view.unmount();
      else if (change === 'client')
        view.rerender(
          <Ledger
            api={{ ...api, download: vi.fn() }}
            workspace={workspace}
            year={year}
            refresh={0}
          />,
        );
      else if (change === 'year')
        view.rerender(
          <Ledger api={api} workspace={workspace} year={{ ...year, id: 'new-year' }} refresh={0} />,
        );
      else if (change === 'filter')
        fireEvent.change(screen.getByRole('textbox', { name: '搜索活动' }), {
          target: { value: 'new-filter' },
        });
      else
        view.rerender(
          <Ledger
            api={api}
            workspace={{ ...workspace, revision: 2, canExport: false }}
            year={year}
            refresh={0}
          />,
        );
      await act(async () => resolve(new Blob(['old private export'])));
      expect(click).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    },
  );

  it('ignores an export failure from a replaced client', async () => {
    let reject!: (error: Error) => void;
    const api = {
      request: vi.fn().mockResolvedValue(rows) as ApiClient['request'],
      download: vi.fn(
        () =>
          new Promise<Blob>((_resolve, decline) => {
            reject = decline;
          }),
      ),
    };
    const view = render(<Ledger api={api} workspace={workspace} year={year} refresh={0} />);
    fireEvent.click(screen.getByRole('button', { name: '导出 Excel' }));
    view.rerender(
      <Ledger api={{ ...api, download: vi.fn() }} workspace={workspace} year={year} refresh={0} />,
    );
    await act(async () => reject(new Error('旧账号的导出失败')));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
