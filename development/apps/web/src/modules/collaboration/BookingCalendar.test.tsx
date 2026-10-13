import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BookingCalendar } from './BookingCalendar.js';

describe('booking occupancy calendar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-12T17:30:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('selects Shanghai today and returns to it after navigating', () => {
    render(<BookingCalendar occupancy={[]} />);
    const date = screen.getByLabelText('日历日期');
    expect(date).toHaveValue('2026-10-13');
    expect(screen.getByText('今天', { selector: 'small' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下一天' }));
    expect(date).toHaveValue('2026-10-14');
    fireEvent.click(screen.getByRole('button', { name: '今天' }));
    expect(date).toHaveValue('2026-10-13');
  });

  it('filters only projected resources and preserves genuine date selection', () => {
    render(
      <BookingCalendar
        occupancy={[
          {
            resource: '实验室 A',
            startsAt: '2026-10-13T01:00:00Z',
            endsAt: '2026-10-13T02:00:00Z',
          },
          {
            resource: '会议室 B',
            startsAt: '2026-10-13T03:00:00Z',
            endsAt: '2026-10-13T04:00:00Z',
          },
        ]}
      />,
    );
    fireEvent.change(screen.getByLabelText('资源筛选'), { target: { value: '实验室 A' } });
    expect(screen.getByRole('heading', { name: '实验室 A' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '会议室 B' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('日历日期'), { target: { value: '2026-10-16' } });
    expect(screen.getByText('当天暂无预约占用')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('日历日期'), { target: { value: '' } });
    expect(screen.getByLabelText('日历日期')).toHaveValue('2026-10-16');
  });

  it('clips Shanghai cross-midnight bookings and never renders extra private fields', () => {
    const booking = {
      resource: '实验室',
      startsAt: '2026-10-12T15:30:00Z',
      endsAt: '2026-10-12T17:30:00Z',
      displayName: '私密参与者',
      uid: 'private-uid',
      text: '私密申请原因',
    };
    render(<BookingCalendar occupancy={[booking]} />);
    fireEvent.click(screen.getByRole('button', { name: '周视图' }));
    const days = screen.getAllByRole('article');
    expect(days).toHaveLength(7);
    expect(within(days[0]).getByText('23:30 — 24:00')).toBeInTheDocument();
    expect(within(days[1]).getByText('00:00 — 01:30')).toBeInTheDocument();
    expect(screen.queryByText(/私密|private-uid/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下一周' }));
    expect(screen.getByLabelText('日历日期')).toHaveValue('2026-10-20');
    expect(screen.getByRole('status')).toHaveTextContent('本周暂无预约占用');
  });

  it('resets a removed resource filter so updated occupancy remains visible', () => {
    const old = [
      { resource: '旧资源', startsAt: '2026-10-13T01:00:00Z', endsAt: '2026-10-13T02:00:00Z' },
    ];
    const page = render(<BookingCalendar occupancy={old} />);
    fireEvent.change(screen.getByLabelText('资源筛选'), { target: { value: '旧资源' } });
    page.rerender(<BookingCalendar occupancy={[{ ...old[0], resource: '新资源' }]} />);
    expect(screen.getByLabelText('资源筛选')).toHaveValue('');
    expect(screen.getByRole('heading', { name: '新资源' })).toBeInTheDocument();
  });
});
