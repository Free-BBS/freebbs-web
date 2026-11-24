import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  OrganizationGroupFile,
  OrganizationGroupWorkspace,
  OrganizationGroupVersion,
} from '@freebbs-development/contracts';
import { ApiClient } from '../../core/api/client.js';
import { EntryForm } from './EntryForm.js';
import type { GroupClient } from './OrganizationGroupPage.js';

const version = {
  id: 'v1',
  yearId: 'year',
  number: 1,
  publishedAt: '',
  publishedBy: 'manager',
  template: 'class_activity_v2' as const,
  activityTypes: [{ id: 'theme', label: '主题团日' }],
  fields: [],
};
const year = {
  id: 'year',
  label: '2026—2027',
  revision: 1,
  startDate: null,
  endDate: null,
  archived: false,
  submissionOpen: true,
  editOpen: true,
  currentVersionId: version.id,
  draft: null,
};
const workspace: OrganizationGroupWorkspace = {
  revision: 1,
  departmentId: 'youth_league.organization',
  activeYearId: year.id,
  viewScope: { kind: 'own' },
  hideDifficulties: false,
  ordinaryExport: false,
  maxPhotos: 5,
  maxPhotoBytes: 5 * 1048576,
  maxResourceBytes: 52428800,
  classes: [{ id: 'class', label: '无61' }],
  members: [],
  managerUids: [],
  years: [year],
  versions: [version],
  canManage: false,
  canGrantManagers: false,
  canExport: false,
  allowedSubmitClassIds: ['class'],
  setupRequired: false,
  canSubmit: true,
  submissionBlockedReason: null,
};
function photo(name: string): OrganizationGroupFile {
  return {
    id: name,
    originalName: name,
    mime: 'image/jpeg',
    size: 100,
    previewable: true,
    purpose: 'activity_photo',
    yearId: year.id,
    createdAt: '',
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}
function setup(api: GroupClient, selectedVersion: OrganizationGroupVersion = version) {
  return render(
    <EntryForm
      api={api}
      workspace={workspace}
      year={year}
      version={selectedVersion}
      onSaved={vi.fn()}
    />,
  );
}
function select(...names: string[]) {
  fireEvent.change(screen.getByLabelText('活动照片'), {
    target: { files: names.map((name) => new File(['jpeg'], name, { type: 'image/jpeg' })) },
  });
}
async function flush() {
  await act(async () => {});
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('activity photo upload recovery', () => {
  it('pastes an image through the same cancellable upload path without changing text', async () => {
    const pending = deferred<OrganizationGroupFile>();
    const request = vi.fn().mockReturnValue(pending.promise);
    setup({ request: request as ApiClient['request'] });
    const input = screen.getByLabelText('活动内容');
    fireEvent.change(input, { target: { value: '图片粘贴不替换这段文字' } });
    const image = new File(['jpeg'], '粘贴照片.jpeg', { type: 'image/jpeg' });
    const clipboardData = { files: [image], items: [], getData: () => '' };
    expect(fireEvent.paste(input, { clipboardData })).toBe(false);
    fireEvent.paste(input, { clipboardData });
    expect(request).toHaveBeenCalledOnce();
    expect((request.mock.calls[0]![1].body as FormData).get('file')).toBe(image);
    expect(screen.getByRole('status')).toHaveTextContent('粘贴照片.jpeg');
    expect(input).toHaveValue('图片粘贴不替换这段文字');
    fireEvent.click(screen.getByRole('button', { name: '取消上传' }));
    await act(async () => pending.resolve(photo('粘贴照片.jpeg')));
    expect(screen.queryByText('粘贴照片.jpeg')).not.toBeInTheDocument();
    expect(input).toHaveValue('图片粘贴不替换这段文字');
  });

  it('leaves ordinary and mixed text paste to the browser instead of intercepting it', () => {
    const request = vi.fn();
    setup({ request: request as ApiClient['request'] });
    const clipboardData = {
      getData: (type: string) => (type === 'text/plain' ? '正常文字' : ''),
      files: [new File(['png'], '图片.png', { type: 'image/png' })],
      items: [],
    };
    expect(fireEvent.paste(screen.getByLabelText('活动内容'), { clipboardData })).toBe(true);
    expect(request).not.toHaveBeenCalled();
  });

  it('accepts an image item when the clipboard file list is empty', async () => {
    const request = vi.fn().mockResolvedValue(photo('截图.png'));
    setup({ request: request as ApiClient['request'] });
    const image = new File(['png'], '截图.png', { type: 'image/png' });
    fireEvent.paste(screen.getByLabelText('活动内容'), {
      clipboardData: {
        files: [],
        getData: () => '',
        items: [{ kind: 'file', getAsFile: () => image }],
      },
    });
    await flush();
    expect(request).toHaveBeenCalledOnce();
    expect(screen.getByText('截图.png')).toBeInTheDocument();
  });

  it('accepts a 20-MiB image without resizing and rejects the next byte', async () => {
    const request = vi.fn().mockResolvedValue(photo('原图.png'));
    setup(
      { request: request as ApiClient['request'] },
      {
        ...version,
        corePresentation: {
          photos: { label: '活动照片', help: '选填，最多 5 张，每张不超过 5 MiB' },
        },
      },
    );
    expect(screen.getByText('选填，最多 5 张，每张不超过 20 MiB')).toBeInTheDocument();
    const bytes = new Uint8Array(20 * 1048576);
    fireEvent.change(screen.getByLabelText('活动照片'), {
      target: { files: [new File([bytes], '原图.png', { type: 'image/png' })] },
    });
    await flush();
    expect(request).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByLabelText('活动照片'), {
      target: { files: [new File([bytes, new Uint8Array(1)], '超限.png', { type: 'image/png' })] },
    });
    await flush();
    expect(request).toHaveBeenCalledOnce();
    expect(screen.getByText(/单张不超过 20 MiB/)).toBeInTheDocument();
  });

  it('enforces five total pasted photos including an additional image answer', async () => {
    const request = vi.fn().mockImplementation(async (_path, options) => {
      const file = (options.body as FormData).get('file') as File;
      return photo(file.name);
    });
    setup(
      { request: request as ApiClient['request'] },
      { ...version, fields: [{ id: 'extra', label: '附加图片', kind: 'image', required: false }] },
    );
    fireEvent.change(screen.getByLabelText('附加图片'), {
      target: { files: [new File(['jpeg'], '附加.jpeg', { type: 'image/jpeg' })] },
    });
    await flush();
    const files = Array.from(
      { length: 5 },
      (_, index) => new File(['jpeg'], `粘贴${index}.jpeg`, { type: 'image/jpeg' }),
    );
    fireEvent.paste(screen.getByLabelText('活动内容'), {
      clipboardData: { files, items: [], getData: () => '' },
    });
    await flush();
    expect(request).toHaveBeenCalledOnce();
    expect(screen.getByText(/每条活动最多 5 张/)).toBeInTheDocument();
  });

  it('names the active file and recovers a stalled transport at the existing upload deadline', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | null | undefined;
    const fetch = vi.fn((_path: RequestInfo | URL, options?: RequestInit) => {
      signal = options?.signal;
      expect(options?.body).toBeInstanceOf(FormData);
      expect(new Headers(options?.headers).has('Content-Type')).toBe(false);
      return new Promise<Response>(() => {});
    });
    setup(new ApiClient({ authMode: 'main', fetch }));
    fireEvent.change(screen.getByLabelText('活动内容'), { target: { value: '保留活动内容' } });
    select('主题团日1.jpeg');
    expect(screen.getByRole('status')).toHaveTextContent('正在上传 1 / 1：主题团日1.jpeg');
    expect(screen.getByRole('button', { name: '提交活动' })).toBeDisabled();
    await act(async () => vi.advanceTimersByTimeAsync(119999));
    expect(screen.getByRole('button', { name: '取消上传' })).toBeEnabled();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(screen.queryByRole('button', { name: '取消上传' })).not.toBeInTheDocument();
    expect(screen.getByText(/图片上传超时/)).toBeInTheDocument();
    expect(screen.getByLabelText('活动照片')).toBeEnabled();
    expect(screen.getByRole('button', { name: '提交活动' })).toBeEnabled();
    expect(screen.getByLabelText('活动内容')).toHaveValue('保留活动内容');
    expect(signal?.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels immediately, permits a fresh upload, and ignores the cancelled request’s late result', async () => {
    const old = deferred<OrganizationGroupFile>();
    const request = vi
      .fn()
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(photo('新照片.jpeg'));
    setup({ request: request as ApiClient['request'] });
    fireEvent.change(screen.getByLabelText('活动内容'), { target: { value: '取消不丢草稿' } });
    select('旧照片.jpeg');
    const signal = request.mock.calls[0]![1].signal as AbortSignal;
    fireEvent.click(screen.getByRole('button', { name: '取消上传' }));
    expect(signal.aborted).toBe(true);
    expect(screen.getByRole('button', { name: '提交活动' })).toBeEnabled();
    expect(screen.getByLabelText('活动内容')).toHaveValue('取消不丢草稿');
    select('新照片.jpeg');
    await flush();
    expect(screen.getByText('新照片.jpeg')).toBeInTheDocument();
    await act(async () => old.resolve(photo('旧照片.jpeg')));
    expect(screen.queryByText('旧照片.jpeg')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '取消上传' })).not.toBeInTheDocument();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('keeps completed photos and stops the remaining queue when cancelled midway', async () => {
    const second = deferred<OrganizationGroupFile>();
    const request = vi
      .fn()
      .mockResolvedValueOnce(photo('第一张.jpeg'))
      .mockReturnValueOnce(second.promise);
    setup({ request: request as ApiClient['request'] });
    select('第一张.jpeg', '第二张.jpeg', '第三张.jpeg');
    await flush();
    expect(screen.getByRole('status')).toHaveTextContent('正在上传 2 / 3：第二张.jpeg');
    fireEvent.click(screen.getByRole('button', { name: '取消上传' }));
    expect(screen.getByText('第一张.jpeg')).toBeInTheDocument();
    await act(async () => second.resolve(photo('第二张.jpeg')));
    expect(screen.queryByText('第二张.jpeg')).not.toBeInTheDocument();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('releases the input after a server error and allows the same file to be selected again', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error('暂时无法写入图片'))
      .mockResolvedValueOnce(photo('重试.jpeg'));
    setup({ request: request as ApiClient['request'] });
    select('重试.jpeg');
    await flush();
    expect(screen.getByText('暂时无法写入图片')).toBeInTheDocument();
    expect(screen.getByLabelText('活动照片')).toHaveValue('');
    select('重试.jpeg');
    await flush();
    expect(screen.getByText('重试.jpeg')).toBeInTheDocument();
    expect(screen.queryByText('暂时无法写入图片')).not.toBeInTheDocument();
  });

  it('aborts the transport and removes its timeout when leaving the form', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | null | undefined;
    const fetch = vi.fn((_path: RequestInfo | URL, options?: RequestInit) => {
      signal = options?.signal;
      return new Promise<Response>(() => {});
    });
    const view = setup(new ApiClient({ authMode: 'main', fetch }));
    select('离开.jpeg');
    await act(async () => vi.advanceTimersByTimeAsync(0));
    view.unmount();
    await flush();
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not start duplicate batches or dispatch a valid image before checking the whole selection', async () => {
    const stalled = deferred<OrganizationGroupFile>();
    const request = vi.fn().mockReturnValue(stalled.promise);
    setup({ request: request as ApiClient['request'] });
    fireEvent.change(screen.getByLabelText('活动照片'), {
      target: {
        files: [
          new File(['jpeg'], '可用.jpeg', { type: 'image/jpeg' }),
          new File(['text'], '错误.txt', { type: 'text/plain' }),
        ],
      },
    });
    await flush();
    expect(request).not.toHaveBeenCalled();
    expect(screen.getByLabelText('活动照片')).toBeEnabled();
    select('仅一次.jpeg');
    select('重复.jpeg');
    expect(request).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '取消上传' }));
    await act(async () => stalled.resolve(photo('仅一次.jpeg')));
  });
});
