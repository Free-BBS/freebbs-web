import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FestivalSubmission, FestivalSubmissionList } from '@freebbs-development/contracts';
import type { ApiClient } from '../../core/api/client.js';
import { FestivalPage } from './FestivalPage.js';

const base = '/events/festival/submissions';
const work: FestivalSubmission = {
  id: 'work-1',
  title: '夏日合奏',
  description: '把排练室里的快乐带上舞台。',
  authorName: '林同学',
  ownerUid: 'student-1',
  status: 'approved',
  displayConsent: true,
  mimeType: 'video/mp4',
  sizeBytes: 2048,
  createdAt: '2026-09-15T08:00:00.000Z',
  updatedAt: '2026-09-15T08:00:00.000Z',
  reviewedAt: null,
  reviewNote: '',
  canViewMedia: true,
};
function listing(
  items: FestivalSubmission[] = [],
  extra: Partial<FestivalSubmissionList> = {},
): FestivalSubmissionList {
  return {
    items,
    page: 1,
    pageSize: 12,
    total: items.length,
    canReview: false,
    maxUploadBytes: 100 * 1024 * 1024,
    ...extra,
  };
}
function mount(
  request = vi.fn().mockResolvedValue(listing()),
  download = vi.fn().mockResolvedValue(new Blob(['video'])),
) {
  const client = { request: request as ApiClient['request'], download };
  return {
    ...render(
      <MemoryRouter>
        <FestivalPage client={client} />
      </MemoryRouter>,
    ),
    request,
    download,
  };
}
async function fillForm() {
  fireEvent.change(screen.getByLabelText('作品名称'), { target: { value: '夏日合奏' } });
  fireEvent.change(screen.getByLabelText('作品介绍'), {
    target: { value: '把排练室里的快乐带上舞台。' },
  });
  fireEvent.change(screen.getByLabelText('投稿视频'), {
    target: { files: [new File(['video'], 'ensemble.mp4', { type: 'video/mp4' })] },
  });
  await waitFor(() => expect(screen.getByRole('button', { name: '提交作品' })).toBeEnabled());
}

afterEach(() => vi.unstubAllGlobals());

describe('FestivalPage', () => {
  it('organizes the submission form into clear stages and names the selected video', async () => {
    mount();
    await screen.findByText('分享你的作品');

    expect(screen.getByRole('group', { name: '作品信息' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: '视频与展示' })).toBeInTheDocument();
    expect(screen.getByText('尚未选择视频')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('投稿视频'), {
      target: { files: [new File(['video'], '羊羊合唱.webm', { type: 'video/webm' })] },
    });
    expect(screen.getByText('羊羊合唱.webm')).toBeInTheDocument();
  });

  it('opens the review queue from a prominent header action only for reviewers', async () => {
    const { request } = mount(vi.fn().mockResolvedValue(listing([], { canReview: true })));
    await userEvent.click(await screen.findByRole('button', { name: '审核投稿' }));
    await waitFor(() =>
      expect(request).toHaveBeenLastCalledWith(`${base}?view=review&page=1`, expect.anything()),
    );
    expect(screen.getByRole('tab', { name: '投稿审核' })).toHaveAttribute('aria-selected', 'true');
  });

  it('explains the review roles without offering a review action to students', async () => {
    mount();
    await screen.findByText(/文艺中心部员、部长、负责人/);
    expect(screen.queryByRole('button', { name: '审核投稿' })).not.toBeInTheDocument();
  });
  it('keeps loaded posts visible when the selected tab is clicked again', async () => {
    mount(vi.fn().mockResolvedValue(listing([work])));
    await screen.findByRole('article', { name: '夏日合奏' });
    await userEvent.click(screen.getByRole('tab', { name: '作品展示' }));
    expect(screen.getByRole('article', { name: '夏日合奏' })).toBeInTheDocument();
  });

  it('keeps failed uploads available for retry without clearing consent or the selected file', async () => {
    let attempts = 0;
    const request = vi.fn().mockImplementation(async (_path: string, init?: RequestInit) => {
      if (init?.method !== 'POST') return listing();
      if (++attempts === 1) throw new Error('网络中断');
      return { ...work, status: 'pending' };
    });
    mount(request);
    await fillForm();
    await userEvent.click(screen.getByRole('checkbox', { name: '我愿意即时展示' }));
    await userEvent.click(screen.getByRole('button', { name: '提交作品' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('网络中断');
    expect(screen.getByLabelText('作品名称')).toHaveValue('夏日合奏');
    expect(screen.getByRole('checkbox', { name: '我愿意即时展示' })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: '提交作品' }));
    await screen.findByText(/投稿成功/);
    expect(attempts).toBe(2);
  });

  it('defaults to private submission and sends the actual video in multipart without forcing its content type', async () => {
    const request = vi
      .fn()
      .mockImplementation(async (_path: string, init?: RequestInit) =>
        init?.method === 'POST' ? { ...work, status: 'private' } : listing(),
      );
    mount(request);
    expect(screen.getByRole('checkbox', { name: '我愿意即时展示' })).not.toBeChecked();
    expect(screen.getByText(/审核通过后展示/)).toBeInTheDocument();
    await fillForm();
    await userEvent.click(screen.getByRole('button', { name: '提交作品' }));
    await screen.findByText(/投稿成功/);
    const call = request.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(call?.[0]).toBe(base);
    const init = call?.[1] as RequestInit;
    expect(init.body).toBeInstanceOf(FormData);
    const body = init.body as FormData;
    expect(body.get('title')).toBe('夏日合奏');
    expect(body.get('description')).toBe('把排练室里的快乐带上舞台。');
    expect(body.get('displayConsent')).toBe('false');
    expect((body.get('video') as File).name).toBe('ensemble.mp4');
    expect(new Headers(init.headers).has('Content-Type')).toBe(false);
  });

  it('requires explicit consent and restores unchecked consent after a successful submission', async () => {
    const request = vi
      .fn()
      .mockImplementation(async (_path: string, init?: RequestInit) =>
        init?.method === 'POST' ? { ...work, status: 'pending' } : listing(),
      );
    mount(request);
    await fillForm();
    await userEvent.click(screen.getByRole('checkbox', { name: '我愿意即时展示' }));
    await userEvent.click(screen.getByRole('button', { name: '提交作品' }));
    await screen.findByText(/投稿成功/);
    const body = request.mock.calls.find(([, init]) => init?.method === 'POST')?.[1]
      .body as FormData;
    expect(body.get('displayConsent')).toBe('true');
    expect(screen.getByRole('checkbox', { name: '我愿意即时展示' })).not.toBeChecked();
  });

  it('enforces the server upload limit and rejects unsupported files before uploading', async () => {
    const { request } = mount(vi.fn().mockResolvedValue(listing([], { maxUploadBytes: 4 })));
    await fillForm();
    await userEvent.click(screen.getByRole('button', { name: '提交作品' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/超过/);
    fireEvent.change(screen.getByLabelText('投稿视频'), {
      target: { files: [new File(['x'], 'image.png', { type: 'image/png' })] },
    });
    await userEvent.click(screen.getByRole('button', { name: '提交作品' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/MP4/);
    expect(request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('loads approved video only after a click and releases its blob when leaving the feed', async () => {
    const createObjectURL = vi.fn(() => 'blob:festival-video');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const { request, download, container } = mount(
      vi
        .fn()
        .mockImplementation(async (path: string) =>
          path.includes('view=mine')
            ? listing([{ ...work, status: 'private', displayConsent: false, canViewMedia: false }])
            : listing([work]),
        ),
    );
    await screen.findByRole('article', { name: '夏日合奏' });
    expect(download).not.toHaveBeenCalled();
    expect(container.querySelector('video')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '加载视频：夏日合奏' }));
    await waitFor(() =>
      expect(container.querySelector('video')).toHaveAttribute('src', 'blob:festival-video'),
    );
    expect(download).toHaveBeenCalledWith(
      `${base}/work-1/media`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(container.querySelector('video')).not.toHaveAttribute('autoplay');
    expect(container.querySelector('video')).toHaveAttribute('controls');
    await userEvent.click(screen.getByRole('tab', { name: '我的投稿' }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(`${base}?view=mine&page=1`, expect.anything()),
    );
    const receipt = await screen.findByRole('article', { name: '夏日合奏' });
    expect(within(receipt).queryByRole('button', { name: /加载视频/ })).not.toBeInTheDocument();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:festival-video');
    expect(screen.queryByRole('tab', { name: '投稿审核' })).not.toBeInTheDocument();
  });

  it('discards a download that completes after the card is unmounted', async () => {
    const createObjectURL = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    let resolveDownload!: (blob: Blob) => void;
    const download = vi.fn(
      () =>
        new Promise<Blob>((resolve) => {
          resolveDownload = resolve;
        }),
    );
    const { unmount } = mount(vi.fn().mockResolvedValue(listing([work])), download);
    await userEvent.click(await screen.findByRole('button', { name: '加载视频：夏日合奏' }));
    unmount();
    await act(async () => resolveDownload(new Blob(['video'])));
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('offers retry for listing and media failures', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error('连接中断'))
      .mockResolvedValue(listing([work]));
    const download = vi.fn().mockRejectedValue(new Error('视频暂不可用'));
    mount(request, download);
    expect(await screen.findByRole('alert')).toHaveTextContent('连接中断');
    await userEvent.click(screen.getByRole('button', { name: '重新加载' }));
    await userEvent.click(await screen.findByRole('button', { name: '加载视频：夏日合奏' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('视频暂不可用');
    await userEvent.click(screen.getByRole('button', { name: '重试视频：夏日合奏' }));
    expect(download).toHaveBeenCalledTimes(2);
  });

  it('shows reviewer-only controls and reloads the server state after approval and removal', async () => {
    let current: FestivalSubmission = { ...work, status: 'pending' };
    const request = vi.fn().mockImplementation(async (_path: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const { decision } = JSON.parse(String(init.body)) as { decision: string };
        current = {
          ...current,
          status: ['approve', 'reapprove'].includes(decision) ? 'approved' : 'rejected',
        };
        return current;
      }
      return listing(
        [
          current,
          { ...work, id: 'private-1', title: '私密投稿', displayConsent: false, status: 'private' },
        ],
        { canReview: true },
      );
    });
    mount(request);
    await userEvent.click(await screen.findByRole('tab', { name: '投稿审核' }));
    let card = await screen.findByRole('article', { name: '夏日合奏' });
    fireEvent.change(within(card).getByLabelText('审核说明'), { target: { value: '准备上台' } });
    expect(
      within(screen.getByRole('article', { name: '私密投稿' })).queryByRole('button', {
        name: '通过并展示',
      }),
    ).not.toBeInTheDocument();
    await userEvent.click(within(card).getByRole('button', { name: '通过并展示' }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        `${base}/work-1/review`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ decision: 'approve', note: '准备上台' }),
        }),
      ),
    );
    card = await screen.findByRole('article', { name: '夏日合奏' });
    await userEvent.click(await within(card).findByRole('button', { name: '撤下展示' }));
    await waitFor(() =>
      expect(screen.getByRole('article', { name: '夏日合奏' })).toHaveTextContent('未展示'),
    );
    const removed = screen.getByRole('article', { name: '夏日合奏' });
    await userEvent.click(await within(removed).findByRole('button', { name: '重新审核并展示' }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        `${base}/work-1/review`,
        expect.objectContaining({ body: JSON.stringify({ decision: 'reapprove', note: '' }) }),
      ),
    );
    expect(await screen.findByRole('button', { name: '撤下展示' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('article', { name: '私密投稿' })).queryByRole('button', {
        name: '重新审核并展示',
      }),
    ).not.toBeInTheDocument();
  });

  it('supports pagination without requesting reviewer data for an ordinary viewer', async () => {
    const request = vi.fn().mockImplementation(async (path: string) =>
      listing([{ ...work, title: path.endsWith('page=2') ? '下一首歌' : work.title }], {
        total: 13,
        page: path.endsWith('page=2') ? 2 : 1,
      }),
    );
    mount(request);
    await userEvent.click(await screen.findByRole('button', { name: '下一页' }));
    await screen.findByRole('article', { name: '下一首歌' });
    expect(request.mock.calls.some(([path]) => path.includes('view=review'))).toBe(false);
    expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled();
  });
});
