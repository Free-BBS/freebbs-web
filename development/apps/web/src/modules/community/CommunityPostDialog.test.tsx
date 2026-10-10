import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CommunityPostDialog } from './CommunityPostDialog.js';

describe('CommunityPostDialog', () => {
  it.each([
    ['daily', 'named'],
    ['daily', 'anonymous'],
    ['wish', 'named'],
    ['wish', 'anonymous'],
  ] as const)('publishes a %s post with %s identity', async (kind, displayMode) => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<CommunityPostDialog initialKind={kind} onSubmit={onSubmit} onClose={onClose} />);
    await user.type(screen.getByLabelText('标题'), '  操场的新鲜事  ');
    await user.type(screen.getByLabelText('内容'), '  一起记录校园生活。  ');
    await user.click(
      screen.getByRole('radio', { name: displayMode === 'named' ? '实名展示' : '匿名展示' }),
    );
    await user.click(screen.getByRole('button', { name: '确认发布' }));
    expect(onSubmit).toHaveBeenCalledWith({
      kind,
      title: '操场的新鲜事',
      body: '一起记录校园生活。',
      tags: [],
      displayMode,
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps the draft and selected identity after failure so the user can retry', async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<CommunityPostDialog initialKind="wish" onSubmit={onSubmit} onClose={onClose} />);
    await user.type(screen.getByLabelText('标题'), '想开一个摄影工作坊');
    await user.type(screen.getByLabelText('内容'), '可以从手机摄影开始。');
    await user.click(screen.getByRole('radio', { name: '匿名展示' }));
    await user.click(screen.getByRole('button', { name: '确认发布' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('发布失败');
    expect(screen.getByLabelText('标题')).toHaveValue('想开一个摄影工作坊');
    expect(screen.getByLabelText('内容')).toHaveValue('可以从手机摄影开始。');
    expect(screen.getByRole('radio', { name: '匿名展示' })).toBeChecked();
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '确认发布' }));
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('rejects whitespace-only drafts without sending a request', async () => {
    const onSubmit = vi.fn();
    render(<CommunityPostDialog initialKind="daily" onSubmit={onSubmit} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '   ' } });
    fireEvent.change(screen.getByLabelText('内容'), { target: { value: '   ' } });
    fireEvent.submit(screen.getByRole('button', { name: '确认发布' }).closest('form')!);
    expect(screen.getByRole('alert')).toHaveTextContent('请填写标题和内容');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('locks the form while a publication is pending and submits only once', async () => {
    let finish!: () => void;
    const onSubmit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const onClose = vi.fn();
    render(<CommunityPostDialog initialKind="daily" onSubmit={onSubmit} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '今晚散步' } });
    fireEvent.change(screen.getByLabelText('内容'), { target: { value: '一起去操场。' } });
    const form = screen.getByRole('button', { name: '确认发布' }).closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: '正在发布…' })).toBeDisabled();
    expect(screen.getByLabelText('内容')).toBeDisabled();
    finish();
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });
});
