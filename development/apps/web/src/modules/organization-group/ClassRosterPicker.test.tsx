import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { OrganizationGroupClassRoster } from '@freebbs-development/contracts';
import { ApiError, type ApiClient } from '../../core/api/client.js';
import { ClassRosterPicker } from './ClassRosterPicker.js';

const roster: OrganizationGroupClassRoster = {
  classId: 'wu61',
  revision: 3,
  members: [
    { id: 'first', displayName: '张三', studentId: '2026000001' },
    { id: 'second', displayName: '张三', studentId: '2026000002' },
    { id: 'third', displayName: '王五' },
  ],
  updatedAt: null,
  canEdit: true,
  canImport: false,
};
function setup(request = vi.fn().mockResolvedValue(roster), participantNames = '王五、手写同学') {
  const onApply = vi.fn();
  const api = { request: request as ApiClient['request'] };
  const props = { api, classId: 'wu61', classLabel: '无61', participantNames, onApply };
  const view = render(<ClassRosterPicker {...props} />);
  return { request, onApply, view, props };
}
async function open() {
  fireEvent.click(screen.getByRole('button', { name: '从班级名单选择' }));
  await screen.findByRole('checkbox', { name: '王五' });
}

describe('class roster selection and maintenance', () => {
  it('loads only on demand and never applies names by opening or cancelling', async () => {
    const { request, onApply } = setup();
    expect(request).not.toHaveBeenCalled();
    await open();
    expect(request.mock.calls[0]![0]).toBe('/organization-group/rosters/wu61');
    expect(screen.getByRole('checkbox', { name: '王五' })).toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: '张三 2026000001' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: '无61班级名单' })).not.toBeInTheDocument();
  });

  it('keeps namesakes independent by stable ID and applies only explicitly selected people', async () => {
    const { onApply } = setup(undefined, '张三');
    await open();
    expect(screen.getByRole('checkbox', { name: '张三 2026000001' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: '张三 2026000002' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: '张三 2026000002' }));
    expect(screen.getByText('已选 1 / 3 人')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '填写已选姓名与人数' }));
    expect(onApply).toHaveBeenCalledExactlyOnceWith(['张三']);
  });

  it('supports selecting all and none without deduplicating equal display names', async () => {
    const { onApply } = setup();
    await open();
    fireEvent.click(screen.getByRole('button', { name: '全不选' }));
    expect(screen.getByRole('button', { name: '填写已选姓名与人数' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '全选' }));
    fireEvent.click(screen.getByRole('button', { name: '填写已选姓名与人数' }));
    expect(onApply).toHaveBeenCalledExactlyOnceWith(['张三', '张三', '王五']);
  });

  it('ignores an old class response after switching classes without altering the activity', async () => {
    let finish!: (value: OrganizationGroupClassRoster) => void;
    const request = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce({
        ...roster,
        classId: 'wu62',
        members: [{ id: 'new', displayName: '新班同学' }],
      });
    const { view, props, onApply } = setup(request);
    fireEvent.click(screen.getByRole('button', { name: '从班级名单选择' }));
    const oldSignal = request.mock.calls[0]![1].signal as AbortSignal;
    view.rerender(<ClassRosterPicker {...props} classId="wu62" classLabel="无62" />);
    expect(oldSignal.aborted).toBe(true);
    expect(request).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '从班级名单选择' }));
    await screen.findByRole('checkbox', { name: '新班同学' });
    await act(async () => finish(roster));
    expect(screen.queryByRole('checkbox', { name: '王五' })).not.toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('retains existing member IDs while editing and saves new members without manufactured IDs', async () => {
    const next = {
      ...roster,
      revision: 4,
      members: [
        { id: 'first', displayName: '张三改名', studentId: '2026000001' },
        { id: 'third', displayName: '王五' },
        { id: 'created', displayName: '新同学' },
      ],
    };
    const request = vi.fn().mockResolvedValueOnce(roster).mockResolvedValueOnce(next);
    const { onApply } = setup(request);
    await open();
    fireEvent.click(screen.getByRole('button', { name: '维护本班名单' }));
    fireEvent.change(screen.getByLabelText('第1位姓名'), { target: { value: '张三改名' } });
    fireEvent.click(screen.getByRole('button', { name: '移除第2位' }));
    fireEvent.click(screen.getByRole('button', { name: '添加同学' }));
    fireEvent.change(screen.getByLabelText('第3位姓名'), { target: { value: '新同学' } });
    fireEvent.click(screen.getByRole('button', { name: '保存班级名单' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '保存班级名单' })).not.toBeInTheDocument(),
    );
    expect(JSON.parse(request.mock.calls[1]![1].body)).toEqual({
      revision: 3,
      members: [
        { id: 'first', displayName: '张三改名', studentId: '2026000001' },
        { id: 'third', displayName: '王五' },
        { displayName: '新同学' },
      ],
    });
    expect(onApply).not.toHaveBeenCalled();
  });

  it('keeps local edits on revision conflict and requires confirmation before reloading', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(roster)
      .mockRejectedValueOnce(new ApiError(409, 'revision_conflict', 'conflict', null))
      .mockResolvedValueOnce({ ...roster, revision: 4 });
    const { onApply } = setup(request);
    await open();
    fireEvent.click(screen.getByRole('button', { name: '维护本班名单' }));
    fireEvent.change(screen.getByLabelText('第1位姓名'), { target: { value: '保留本地修改' } });
    fireEvent.click(screen.getByRole('button', { name: '保存班级名单' }));
    await screen.findByText(/本次修改已保留/);
    expect(screen.getByLabelText('第1位姓名')).toHaveValue('保留本地修改');
    expect(screen.getByRole('button', { name: '保存班级名单' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '从班级名单选择' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '读取最新名单' }));
    expect(request).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: '继续保留修改' }));
    expect(screen.getByLabelText('第1位姓名')).toHaveValue('保留本地修改');
    fireEvent.click(screen.getByRole('button', { name: '读取最新名单' }));
    fireEvent.click(screen.getByRole('button', { name: '确认放弃修改并读取' }));
    await screen.findByRole('checkbox', { name: '王五' });
    expect(request).toHaveBeenCalledTimes(3);
    expect(onApply).not.toHaveBeenCalled();
  });
});
