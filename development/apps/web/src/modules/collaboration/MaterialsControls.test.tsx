import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import type { CollaborationEntry, CollaborationSpace } from '@freebbs-development/contracts';
const mocks = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock('../../core/auth/AuthProvider.js', () => ({ useAuth: mocks.auth }));
import { EntryMaterials, SpaceDownloads } from './MaterialsControls.js';

const entry = {
  id: 'entry',
  uid: 'self',
  stage: 0,
  reviewStatus: 'pending',
  createdAt: '2026-10-12T09:00:00Z',
  files: [{ id: 'file', name: '项目材料.pdf', bytes: 1536 }],
} as CollaborationEntry;
const space = {
  id: 'space',
  title: '项目归档',
  kind: 'materials',
  status: 'published',
  revision: 7,
  canManage: false,
  entries: [entry],
} as CollaborationSpace;
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};
let client: { request: ReturnType<typeof vi.fn>; download: ReturnType<typeof vi.fn> };
let create: ReturnType<typeof vi.fn>;
let click: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  client = {
    request: vi.fn().mockResolvedValue({}),
    download: vi.fn().mockResolvedValue(new Blob(['binary'])),
  };
  mocks.auth.mockReturnValue({ client, user: { uid: 'self' } });
  create = vi.fn(() => 'blob:materials');
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() }));
  click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('entry files', () => {
  it('downloads the actual private binary endpoint', async () => {
    render(<EntryMaterials space={space} entry={entry} onUpdate={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /下载 项目材料.pdf/ }));
    await act(async () => {});
    expect(client.download).toHaveBeenCalledWith('/collaboration/space/entries/entry/files/file');
    expect(create).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalledOnce();
    expect(screen.getByText('1.5 KiB')).toBeInTheDocument();
  });

  it.each([
    [
      'count',
      Array.from({ length: 5 }, (_, i) => new File(['x'], `${i}.txt`)),
      '一次最多上传4个文件',
    ],
    [
      'size',
      [new File([new Uint8Array(25 * 1024 * 1024 + 1)], 'oversize.pdf')],
      '每个文件不得超过25 MiB',
    ],
  ])('rejects invalid upload %s locally', async (_reason, files, message) => {
    render(<EntryMaterials space={space} entry={entry} onUpdate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('补充附件'), { target: { files } });
    await act(async () => {});
    expect(client.request).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(message);
  });

  it('uploads FormData with revision and selected files, then refreshes only after success', async () => {
    const pending = deferred<unknown>();
    client.request.mockReturnValueOnce(pending.promise);
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    render(<EntryMaterials space={space} entry={entry} onUpdate={onUpdate} />);
    const file = new File(['contents'], 'new.pdf');
    fireEvent.change(screen.getByLabelText('补充附件'), { target: { files: [file] } });
    expect(screen.getByLabelText('补充附件')).toBeDisabled();
    expect(onUpdate).not.toHaveBeenCalled();
    const [path, options] = client.request.mock.calls[0];
    expect(path).toBe('/collaboration/space/entries/entry/files');
    expect(options.method).toBe('POST');
    expect(options.body.get('revision')).toBe('7');
    expect(options.body.getAll('files')).toEqual([file]);
    await act(async () => pending.resolve({}));
    expect(onUpdate).toHaveBeenCalledOnce();
    expect(screen.getByRole('status')).toHaveTextContent('已上传1个附件');
  });

  it('shows genuine upload failure and retains the chosen file', async () => {
    client.request.mockRejectedValueOnce(new Error('文件类型不允许'));
    const onUpdate = vi.fn();
    render(<EntryMaterials space={space} entry={entry} onUpdate={onUpdate} />);
    const file = new File(['data'], 'chosen.pdf');
    fireEvent.change(screen.getByLabelText('补充附件'), { target: { files: [file] } });
    await act(async () => {});
    expect(screen.getByRole('alert')).toHaveTextContent('文件类型不允许');
    expect((screen.getByLabelText('补充附件') as HTMLInputElement).files?.[0]).toBe(file);
    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.queryByText('已上传1个附件')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试上传' }));
    await act(async () => {});
    expect(client.request).toHaveBeenCalledTimes(2);
    expect(client.request.mock.calls[1][1].body.getAll('files')).toEqual([file]);
    expect(onUpdate).toHaveBeenCalledOnce();
  });

  it('distinguishes a completed upload from a failed refresh without offering duplicate upload', async () => {
    render(
      <EntryMaterials
        space={space}
        entry={entry}
        onUpdate={vi.fn().mockRejectedValue(new Error('列表更新失败'))}
      />,
    );
    fireEvent.change(screen.getByLabelText('补充附件'), {
      target: { files: [new File(['data'], 'chosen.pdf')] },
    });
    await act(async () => {});
    expect(screen.getByRole('alert')).toHaveTextContent('附件已上传，但列表刷新失败：列表更新失败');
    expect(screen.queryByRole('button', { name: '重试上传' })).not.toBeInTheDocument();
  });

  it.each(['client', 'entry', 'space'])(
    'discards old upload failures after %s replacement',
    async (change) => {
      const pending = deferred<unknown>();
      client.request.mockReturnValueOnce(pending.promise);
      const page = render(<EntryMaterials space={space} entry={entry} onUpdate={vi.fn()} />);
      fireEvent.change(screen.getByLabelText('补充附件'), {
        target: { files: [new File(['x'], 'old.pdf')] },
      });
      if (change === 'client')
        mocks.auth.mockReturnValue({ client: { ...client }, user: { uid: 'self' } });
      page.rerender(
        <EntryMaterials
          space={change === 'space' ? { ...space, id: 'new-space' } : space}
          entry={change === 'entry' ? { ...entry, id: 'new-entry' } : entry}
          onUpdate={vi.fn()}
        />,
      );
      await act(async () => pending.reject(new Error('旧身份上传错误')));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByLabelText('补充附件')).not.toBeDisabled();
    },
  );

  it('does not refresh another entry when an old upload succeeds', async () => {
    const pending = deferred<unknown>();
    client.request.mockReturnValueOnce(pending.promise);
    const onUpdate = vi.fn();
    const page = render(<EntryMaterials space={space} entry={entry} onUpdate={onUpdate} />);
    fireEvent.change(screen.getByLabelText('补充附件'), {
      target: { files: [new File(['x'], 'old.pdf')] },
    });
    page.rerender(
      <EntryMaterials space={space} entry={{ ...entry, id: 'next' }} onUpdate={onUpdate} />,
    );
    await act(async () => pending.resolve({}));
    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.queryByText('已上传1个附件')).not.toBeInTheDocument();
  });

  it.each(['client', 'entry'])(
    'does not save old attachment downloads after %s changes',
    async (change) => {
      const pending = deferred<Blob>();
      client.download.mockReturnValueOnce(pending.promise);
      const page = render(<EntryMaterials space={space} entry={entry} onUpdate={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: /下载 项目材料.pdf/ }));
      if (change === 'client')
        mocks.auth.mockReturnValue({ client: { ...client }, user: { uid: 'self' } });
      page.rerender(
        <EntryMaterials
          space={space}
          entry={change === 'entry' ? { ...entry, id: 'new' } : entry}
          onUpdate={vi.fn()}
        />,
      );
      await act(async () => pending.resolve(new Blob(['private'])));
      expect(create).not.toHaveBeenCalled();
      expect(click).not.toHaveBeenCalled();
    },
  );

  it('keeps a new entry download busy when the old entry download settles', async () => {
    const oldDownload = deferred<Blob>();
    const newDownload = deferred<Blob>();
    client.download
      .mockReturnValueOnce(oldDownload.promise)
      .mockReturnValueOnce(newDownload.promise);
    const page = render(<EntryMaterials space={space} entry={entry} onUpdate={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /下载 项目材料.pdf/ }));
    page.rerender(
      <EntryMaterials space={space} entry={{ ...entry, id: 'next' }} onUpdate={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /下载 项目材料.pdf/ }));
    await act(async () => oldDownload.resolve(new Blob(['old private bytes'])));
    expect(create).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /下载 项目材料.pdf/ })).toBeDisabled();
    await act(async () => newDownload.reject(new Error('新附件下载失败')));
    expect(screen.getByRole('alert')).toHaveTextContent('新附件下载失败');
    expect(screen.getByRole('button', { name: /下载 项目材料.pdf/ })).toBeEnabled();
  });

  it.each([
    [{ ...space, status: 'closed' }, entry],
    [space, { ...entry, reviewStatus: 'approved' }],
    [
      { ...space, kind: 'review', canManage: true },
      { ...entry, stage: 1 },
    ],
    [space, { ...entry, uid: 'someone-else' }],
  ] as const)(
    'keeps closed, approved, review-stage and ownership upload locks',
    (currentSpace, currentEntry) => {
      render(
        <EntryMaterials
          space={currentSpace as CollaborationSpace}
          entry={currentEntry as CollaborationEntry}
          onUpdate={vi.fn()}
        />,
      );
      expect(screen.queryByLabelText('补充附件')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /下载 项目材料.pdf/ })).toBeEnabled();
    },
  );
});

describe('authenticated space exports', () => {
  it('exports actual XLSX and configured ZIP with an archive preview', async () => {
    render(<SpaceDownloads space={space} />);
    fireEvent.click(screen.getByText('下载Excel记录'));
    await act(async () => {});
    expect(client.download).toHaveBeenCalledWith('/collaboration/space/export', {});
    fireEvent.change(screen.getByLabelText('文件命名'), { target: { value: '{index}-{name}' } });
    fireEvent.change(screen.getByLabelText('目录结构'), { target: { value: 'flat' } });
    expect(screen.getByText(/示例：001-项目材料.pdf/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('整理为ZIP'));
    await act(async () => {});
    expect(client.download).toHaveBeenLastCalledWith('/collaboration/space/materials/archive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pattern: '{index}-{name}', folders: false }),
    });
    expect(click).toHaveBeenCalledTimes(2);
  });

  it('keeps archive options after a real failure and offers retry', async () => {
    client.download.mockRejectedValueOnce(new Error('材料超过150 MiB，请按记录分别下载'));
    render(<SpaceDownloads space={space} />);
    fireEvent.change(screen.getByLabelText('文件命名'), { target: { value: '{date}-{name}' } });
    fireEvent.click(screen.getByText('整理为ZIP'));
    await act(async () => {});
    expect(screen.getByRole('alert')).toHaveTextContent('材料超过150 MiB');
    expect(screen.getByLabelText('文件命名')).toHaveValue('{date}-{name}');
    expect(screen.getByText('整理为ZIP')).toBeEnabled();
    expect(create).not.toHaveBeenCalled();
  });

  it.each(['client', 'space'])(
    'discards old archive responses and errors after %s changes',
    async (change) => {
      const pending = deferred<Blob>();
      client.download.mockReturnValueOnce(pending.promise);
      const page = render(<SpaceDownloads space={space} />);
      fireEvent.click(screen.getByText('整理为ZIP'));
      if (change === 'client') mocks.auth.mockReturnValue({ client: { ...client } });
      page.rerender(
        <SpaceDownloads space={change === 'space' ? { ...space, id: 'next' } : space} />,
      );
      await act(async () => pending.reject(new Error('旧身份下载错误')));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByText('下载Excel记录')).toBeEnabled();
    },
  );

  it('does not save an old archive after switching spaces', async () => {
    const pending = deferred<Blob>();
    client.download.mockReturnValueOnce(pending.promise);
    const page = render(<SpaceDownloads space={space} />);
    fireEvent.click(screen.getByText('整理为ZIP'));
    page.rerender(<SpaceDownloads space={{ ...space, id: 'next' }} />);
    await act(async () => pending.resolve(new Blob(['private'])));
    expect(create).not.toHaveBeenCalled();
  });

  it('invalidates an old export when switching away and returning to the same client and space', async () => {
    const pending = deferred<Blob>();
    client.download.mockReturnValueOnce(pending.promise);
    const page = render(<SpaceDownloads space={space} />);
    fireEvent.click(screen.getByText('下载Excel记录'));
    page.rerender(<SpaceDownloads space={{ ...space, id: 'next' }} />);
    page.rerender(<SpaceDownloads space={space} />);
    await act(async () => pending.resolve(new Blob(['stale export'])));
    expect(create).not.toHaveBeenCalled();
    expect(screen.queryByText('Excel记录已准备下载。')).not.toBeInTheDocument();
  });

  it('explains empty scoped materials and rejects blank archive names', () => {
    const page = render(<SpaceDownloads space={{ ...space, entries: [] }} />);
    expect(screen.getByText('整理为ZIP')).toBeDisabled();
    expect(screen.getByText('当前可见记录暂无附件，可先下载Excel记录。')).toBeInTheDocument();
    page.rerender(<SpaceDownloads space={space} />);
    fireEvent.change(screen.getByLabelText('文件命名'), { target: { value: '' } });
    expect(screen.getByText('整理为ZIP')).toBeDisabled();
    expect(screen.getByText('请输入文件命名规则。')).toBeInTheDocument();
  });
});
it('does not save private exports after the identity view is unmounted', async () => {
  let finish!: (blob: Blob) => void;
  const download = vi.fn(
    () =>
      new Promise<Blob>((resolve) => {
        finish = resolve;
      }),
  );
  mocks.auth.mockReturnValue({ client: { download } });
  const create = vi.fn(() => 'blob:private');
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create }));
  const space = {
    id: 'space',
    title: 'Private export',
    entries: [],
  } as unknown as CollaborationSpace;
  const page = render(<SpaceDownloads space={space} />);
  fireEvent.click(screen.getByText('下载Excel记录'));
  page.unmount();
  await act(async () => {
    finish(new Blob(['private']));
  });
  expect(create).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
