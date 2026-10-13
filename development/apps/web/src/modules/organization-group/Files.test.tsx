import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../core/api/client.js';
import { FileTile } from './Files.js';
const file = {
  id: 'private/photo',
  originalName: '照片.png',
  mime: 'image/png',
  size: 20,
  previewable: true,
  purpose: 'activity_photo' as const,
  yearId: 'year',
  createdAt: '',
};
afterEach(() => vi.restoreAllMocks());
describe('authenticated private previews', () => {
  it('requests through authenticated download and revokes object URLs on close and unmount', async () => {
    const create = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:one')
      .mockReturnValueOnce('blob:two');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const download = vi.fn(async () => new Blob(['png'], { type: 'image/png' }));
    const view = render(
      <FileTile file={file} api={{ request: vi.fn() as ApiClient['request'], download }} />,
    );
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '预览' }));
    expect(await screen.findByRole('img', { name: '照片.png' })).toHaveAttribute('src', 'blob:one');
    expect(download).toHaveBeenCalledWith('/organization-group/files/private%2Fphoto?preview=1');
    fireEvent.click(screen.getByRole('button', { name: '关闭预览' }));
    expect(revoke).toHaveBeenCalledWith('blob:one');
    fireEvent.click(screen.getByRole('button', { name: '预览' }));
    await screen.findByRole('img');
    view.unmount();
    expect(revoke).toHaveBeenCalledWith('blob:two');
    expect(create).toHaveBeenCalledTimes(2);
  });
  it('does not create a preview object URL when private asset access fails', async () => {
    const create = vi.spyOn(URL, 'createObjectURL');
    const download = vi.fn().mockRejectedValue(new Error('无权查看该文件'));
    render(<FileTile file={file} api={{ request: vi.fn() as ApiClient['request'], download }} />);
    fireEvent.click(screen.getByRole('button', { name: '预览' }));
    expect(await screen.findByText('无权查看该文件')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });
  it('offers no inline preview for Office or active document types', () => {
    render(
      <FileTile
        file={{
          ...file,
          mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          originalName: '资料.docx',
          previewable: false,
        }}
        api={{ request: vi.fn() as ApiClient['request'], download: vi.fn() }}
      />,
    );
    expect(screen.queryByRole('button', { name: '预览' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下载' })).toBeInTheDocument();
  });
  it('discards pending preview when a reused tile changes asset identity', async () => {
    let resolve!: (value: Blob) => void;
    const create = vi.spyOn(URL, 'createObjectURL');
    const api = {
      request: vi.fn() as ApiClient['request'],
      download: vi.fn(
        () =>
          new Promise<Blob>((accept) => {
            resolve = accept;
          }),
      ),
    };
    const view = render(<FileTile file={file} api={api} />);
    fireEvent.click(screen.getByRole('button', { name: '预览' }));
    view.rerender(
      <FileTile file={{ ...file, id: 'replacement', originalName: '新照片.png' }} api={api} />,
    );
    resolve(new Blob(['old'], { type: 'image/png' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '预览' })).not.toBeDisabled());
    expect(create).not.toHaveBeenCalled();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});

describe('private download lifecycle', () => {
  it('saves a completed download from the current tile', async () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:download');
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const api = {
      request: vi.fn() as ApiClient['request'],
      download: vi.fn(async () => new Blob(['private image'])),
    };
    render(<FileTile file={file} api={api} />);
    fireEvent.click(screen.getByRole('button', { name: '下载' }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledTimes(1);
    expect(api.download).toHaveBeenCalledWith('/organization-group/files/private%2Fphoto');
  });

  it.each(['unmount', 'file', 'client'] as const)(
    'discards a late private download after %s changes the initiating view',
    async (change) => {
      let resolve!: (blob: Blob) => void;
      const create = vi.spyOn(URL, 'createObjectURL');
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      const api = {
        request: vi.fn() as ApiClient['request'],
        download: vi.fn(
          () =>
            new Promise<Blob>((accept) => {
              resolve = accept;
            }),
        ),
      };
      const view = render(<FileTile file={file} api={api} />);
      fireEvent.click(screen.getByRole('button', { name: '下载' }));
      if (change === 'unmount') view.unmount();
      else if (change === 'file')
        view.rerender(<FileTile file={{ ...file, id: 'new-file' }} api={api} />);
      else view.rerender(<FileTile file={file} api={{ ...api, download: vi.fn() }} />);
      await act(async () => resolve(new Blob(['old private image'])));
      expect(click).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    },
  );

  it('ignores a failed download from a replaced client', async () => {
    let reject!: (error: Error) => void;
    const api = {
      request: vi.fn() as ApiClient['request'],
      download: vi.fn(
        () =>
          new Promise<Blob>((_resolve, decline) => {
            reject = decline;
          }),
      ),
    };
    const view = render(<FileTile file={file} api={api} />);
    fireEvent.click(screen.getByRole('button', { name: '下载' }));
    view.rerender(<FileTile file={file} api={{ ...api, download: vi.fn() }} />);
    await act(async () => reject(new Error('旧账号的下载失败')));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
