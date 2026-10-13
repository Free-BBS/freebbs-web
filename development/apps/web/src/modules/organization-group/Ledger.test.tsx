import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  OrganizationGroupWorkspace,
  OrganizationGroupYear,
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
