import { fireEvent, render, screen, within } from '@testing-library/react';
import { Link, MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ReviewShell } from './ReviewShell.js';

function renderShell(path = '/organizations/youth_league/research') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ReviewShell departmentPage>
        <main>
          <Link to="/organizations/youth_league">电子系团委</Link>
          <iframe title="部门网页" />
        </main>
      </ReviewShell>
    </MemoryRouter>,
  );
}

describe('portable development preview shell', () => {
  it('shows the real development navigation while keeping offline-only functionality honest', () => {
    renderShell();
    const header = screen.getByRole('banner');
    expect(within(header).getByRole('heading', { name: '风采展示', level: 1 })).toBeInTheDocument();
    expect(within(header).getByRole('link', { name: '风采展示' })).toHaveAttribute(
      'href',
      '/organizations',
    );
    expect(within(header).getByText('调研组')).toHaveAttribute('aria-current', 'page');
    expect(within(header).getByRole('link', { name: '电子系团委' })).toHaveAttribute(
      'href',
      '/organizations/youth_league',
    );
    const navigation = screen.getByRole('navigation', { name: '主要导航' });
    expect(within(navigation).getAllByRole('link')).toHaveLength(1);
    expect(within(navigation).getByRole('link', { name: '风采展示' })).toHaveAttribute(
      'href',
      '/organizations',
    );
    for (const label of ['無界广场', '萬事屋', '無体育', '無尽书桌', '个人成长档案']) {
      expect(within(navigation).getByText(label).closest('[aria-disabled]')).toHaveAttribute(
        'aria-disabled',
        'true',
      );
    }
    expect(screen.queryByRole('link', { name: /返回上一级/ })).not.toBeInTheDocument();
    expect(screen.queryByText('访问身份')).not.toBeInTheDocument();
    expect(screen.getByTitle('部门网页')).toBeInTheDocument();
  });

  it.each([
    ['/organizations', '风采展示'],
    ['/organizations/student_union', '电子系学生会'],
    ['/organizations/tms', '电子系 TMS 分会'],
  ])('shows the matching top-header label for %s', (path, label) => {
    renderShell(path);
    const header = screen.getByRole('banner');
    expect(within(header).getByRole('heading', { name: '风采展示', level: 1 })).toBeInTheDocument();
    if (label !== '风采展示')
      expect(within(header).getByText(label)).toHaveAttribute('aria-current', 'page');
  });

  it('toggles both page theme markers without any account or storage dependency', () => {
    renderShell();
    expect(document.body).toHaveClass('theme-light');
    expect(document.body).not.toHaveClass('theme-dark');
    fireEvent.click(screen.getByRole('button', { name: '切换到暗色模式' }));
    expect(document.body).toHaveClass('theme-dark');
    expect(document.body).not.toHaveClass('theme-light');
    fireEvent.click(screen.getByRole('button', { name: '切换到浅色模式' }));
    expect(document.body).toHaveClass('theme-light');
  });

  it('supports keyboard dismissal and closes the mobile drawer after navigating', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: '打开发展平台侧栏' }));
    expect(screen.getByRole('button', { name: '关闭发展平台侧栏' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('link', { name: 'FREE BBS' })).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('button', { name: '打开发展平台侧栏' })).toHaveFocus();
    expect(screen.queryByRole('button', { name: '关闭侧栏' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '打开发展平台侧栏' }));
    fireEvent.click(
      within(screen.getByRole('navigation', { name: '主要导航' })).getByRole('link', {
        name: '风采展示',
      }),
    );
    expect(screen.getByRole('button', { name: '打开发展平台侧栏' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });
});
