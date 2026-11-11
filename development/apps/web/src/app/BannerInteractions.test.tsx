import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../core/api/client.js';
import type { BannerReactions } from '@freebbs-development/contracts';
import { BannerInteractions } from './BannerInteractions.js';

const initial: BannerReactions = {
  bannerId: 'preview-boys-day',
  likeCount: 0,
  liked: false,
  blessingCount: 0,
  blessed: false,
};
const asClient = (request: ReturnType<typeof vi.fn>, demoUser = 'demo-student') =>
  ({ request, demoUser }) as unknown as ApiClient;
afterEach(() => vi.useRealTimers());

describe('BannerInteractions', () => {
  it('waits for a saved like, prevents duplicate submissions and supports unlike', async () => {
    let finishLike!: (data: BannerReactions) => void;
    const request = vi
      .fn()
      .mockResolvedValueOnce(initial)
      .mockImplementationOnce(
        () =>
          new Promise<BannerReactions>((resolve) => {
            finishLike = resolve;
          }),
      )
      .mockResolvedValueOnce(initial);
    render(<BannerInteractions bannerId={initial.bannerId} client={asClient(request)} />);
    const like = await screen.findByRole('button', { name: /^点赞/ });
    await waitFor(() => expect(like).toBeEnabled());
    fireEvent.click(like);
    fireEvent.click(like);
    expect(request).toHaveBeenCalledTimes(2);
    expect(like).toHaveTextContent('0');
    expect(like).toHaveAttribute('aria-pressed', 'false');
    await act(async () => finishLike({ ...initial, liked: true, likeCount: 1 }));
    const saved = screen.getByRole('button', { name: /^已点赞/ });
    expect(saved).toHaveAttribute('aria-pressed', 'true');
    expect(saved).toHaveTextContent('1');
    fireEvent.click(saved);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^点赞/ })).toHaveAttribute(
        'aria-pressed',
        'false',
      ),
    );
    expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({ liked: true });
    expect(JSON.parse(request.mock.calls[2][1].body)).toEqual({ liked: false });
  });

  it('sends a single blessing and shows its persisted result', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce({ ...initial, blessed: true, blessingCount: 1 });
    render(<BannerInteractions bannerId={initial.bannerId} client={asClient(request)} />);
    const blessing = screen.getByRole('button', { name: /^送祝福/ });
    await waitFor(() => expect(blessing).toBeEnabled());
    fireEvent.click(blessing);
    await waitFor(() => expect(screen.getByRole('button', { name: /^已送达/ })).toBeDisabled());
    expect(screen.getByRole('button', { name: /^已送达/ })).toHaveTextContent('1');
    expect(screen.getByText('祝福已送达！')).toBeInTheDocument();
    expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({ blessed: true });
  });

  it('keeps counts unchanged after a failed save and can resynchronize', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(initial)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ...initial, liked: true, likeCount: 1 });
    render(<BannerInteractions bannerId={initial.bannerId} client={asClient(request)} />);
    const like = screen.getByRole('button', { name: /^点赞/ });
    await waitFor(() => expect(like).toBeEnabled());
    fireEvent.click(like);
    expect(await screen.findByText('未能保存，请重试')).toBeInTheDocument();
    expect(like).toHaveTextContent('0');
    fireEvent.click(screen.getByRole('button', { name: '重新同步' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^已点赞/ })).toHaveTextContent('1'),
    );
  });

  it('allows local fireworks while offline and releases the short cooldown', async () => {
    vi.useFakeTimers();
    render(<BannerInteractions bannerId={initial.bannerId} />);
    const fireworks = screen.getByRole('button', { name: '放烟花' });
    fireEvent.click(fireworks);
    expect(fireworks).toBeDisabled();
    expect(screen.getByText('烟花已绽放，快乐加一！')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(900));
    expect(fireworks).toBeEnabled();
  });

  it('ignores late data when the reader switches to a different banner', async () => {
    let finishOld!: (data: BannerReactions) => void;
    const request = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<BannerReactions>((resolve) => {
            finishOld = resolve;
          }),
      )
      .mockResolvedValueOnce({ ...initial, bannerId: 'next-banner', likeCount: 4 });
    const client = asClient(request);
    const view = render(<BannerInteractions bannerId={initial.bannerId} client={client} />);
    view.rerender(<BannerInteractions bannerId="next-banner" client={client} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^点赞/ })).toHaveTextContent('4'),
    );
    await act(async () => finishOld({ ...initial, likeCount: 99, liked: true }));
    expect(screen.getByRole('button', { name: /^点赞/ })).toHaveTextContent('4');
    expect(screen.queryByRole('button', { name: /^已点赞/ })).not.toBeInTheDocument();
  });

  it('recovers controls when the same reader receives a replacement client during a save', async () => {
    let finishOld!: (data: BannerReactions) => void;
    const previousRequest = vi
      .fn()
      .mockResolvedValueOnce(initial)
      .mockImplementationOnce(
        () =>
          new Promise<BannerReactions>((resolve) => {
            finishOld = resolve;
          }),
      );
    const nextRequest = vi
      .fn()
      .mockResolvedValueOnce({ ...initial, likeCount: 3 })
      .mockResolvedValueOnce({ ...initial, liked: true, likeCount: 4 });
    const view = render(
      <BannerInteractions bannerId={initial.bannerId} client={asClient(previousRequest)} />,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: /^点赞/ })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /^点赞/ }));
    view.rerender(
      <BannerInteractions bannerId={initial.bannerId} client={asClient(nextRequest)} />,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: /^点赞/ })).toBeEnabled());
    expect(screen.getByRole('button', { name: /^点赞/ })).toHaveTextContent('3');
    await act(async () => finishOld({ ...initial, liked: true, likeCount: 99 }));
    expect(screen.getByRole('button', { name: /^点赞/ })).toHaveTextContent('3');
    fireEvent.click(screen.getByRole('button', { name: /^点赞/ }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^已点赞/ })).toHaveTextContent('4'),
    );
  });
});
