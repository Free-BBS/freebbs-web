import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { BannerCelebration } from './BannerCelebration.js';

afterEach(() => vi.useRealTimers());

it('only shows an effect after activation and removes it after a short duration', () => {
  vi.useFakeTimers();
  const view = render(<BannerCelebration burstId={0} kind="fireworks" />);
  expect(screen.queryByTestId('banner-celebration')).not.toBeInTheDocument();
  view.rerender(<BannerCelebration burstId={1} kind="fireworks" />);
  expect(screen.getByTestId('banner-celebration')).toHaveAttribute('aria-hidden', 'true');
  act(() => vi.advanceTimersByTime(1800));
  expect(screen.queryByTestId('banner-celebration')).not.toBeInTheDocument();
});

it('restarts its cleanup timer for a new manual burst and cancels on unmount', () => {
  vi.useFakeTimers();
  const view = render(<BannerCelebration burstId={1} kind="fireworks" />);
  act(() => vi.advanceTimersByTime(1500));
  view.rerender(<BannerCelebration burstId={2} kind="blessing" />);
  act(() => vi.advanceTimersByTime(400));
  expect(screen.getByTestId('banner-celebration')).toHaveClass('banner-celebration--blessing');
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
