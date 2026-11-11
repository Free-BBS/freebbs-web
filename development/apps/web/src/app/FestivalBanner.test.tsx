import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FestivalBanner } from './FestivalBanner.js';

describe('FestivalBanner', () => {
  it('reserves an honest empty placement in local preview but never publishes it', () => {
    const view = render(<FestivalBanner messages={[]} preview />);
    expect(screen.getByRole('region', { name: '男生节横幅' })).toHaveTextContent(
      '男生节横幅展示位',
    );
    expect(screen.queryByRole('navigation', { name: '横幅切换' })).not.toBeInTheDocument();

    view.rerender(<FestivalBanner messages={[]} preview={false} />);
    expect(screen.queryByRole('region', { name: '男生节横幅' })).not.toBeInTheDocument();
  });

  it('hides the entire campaign when disabled, including its local preview', () => {
    render(<FestivalBanner enabled={false} preview />);
    expect(screen.queryByRole('region', { name: '男生节横幅' })).not.toBeInTheDocument();
  });

  it('shows an approved single banner with its source and no inactive controls', () => {
    render(
      <FestivalBanner
        preview={false}
        messages={[{ id: 'one', text: '已确认的横幅文案', source: '提交班级' }]}
      />,
    );
    const banner = screen.getByRole('region', { name: '男生节横幅' });
    expect(banner).toHaveTextContent('已确认的横幅文案');
    expect(banner).toHaveTextContent('提交班级');
    expect(within(banner).queryByRole('navigation', { name: '横幅切换' })).not.toBeInTheDocument();
    expect(screen.queryByText('男生节横幅展示位')).not.toBeInTheDocument();
  });

  it('lets readers switch complete banners and recovers when the selected banner is removed', () => {
    const first = { id: 'one', text: '第一幅横幅' };
    const second = { id: 'two', text: '第二幅横幅', source: '第二个班级' };
    const view = render(<FestivalBanner messages={[first, second]} preview={false} />);
    fireEvent.click(screen.getByRole('button', { name: '下一幅横幅' }));
    expect(screen.getByText('第二幅横幅')).toBeInTheDocument();
    expect(screen.getByText('第二个班级')).toBeInTheDocument();
    expect(screen.getByLabelText('第 2 幅，共 2 幅')).toHaveTextContent('2 / 2');
    fireEvent.click(screen.getByRole('button', { name: '下一幅横幅' }));
    expect(screen.getByText('第一幅横幅')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '上一幅横幅' }));
    expect(screen.getByText('第二幅横幅')).toBeInTheDocument();

    view.rerender(<FestivalBanner messages={[first]} preview={false} />);
    expect(screen.getByText('第一幅横幅')).toBeInTheDocument();
    expect(screen.queryByText('第二幅横幅')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: '横幅切换' })).not.toBeInTheDocument();
  });
});
