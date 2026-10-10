import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { CommercePage } from './CommercePage.js';

function renderCommerce() {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/shop', state: { from: '/sports' } }]}>
      <Routes>
        <Route path="/shop" element={<CommercePage section="shop" />} />
        <Route path="/inventory" element={<CommercePage section="inventory" />} />
        <Route path="/profile" element={<CommercePage section="profile" userUid="student-1" />} />
        <Route path="/settings" element={<CommercePage section="settings" />} />
        <Route path="/ranch" element={<CommercePage section="ranch" />} />
        <Route path="/sports" element={<div>无体育</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('development commerce', () => {
  it('loads the main-site shop inside development and returns to the previous module', () => {
    renderCommerce();
    expect(screen.queryByRole('heading', { name: '商店' })).not.toBeInTheDocument();
    expect(screen.getByTitle('FREE-BBS 商店')).toHaveAttribute(
      'src',
      '/electromagnetic?embed=development',
    );
    fireEvent.click(screen.getByRole('button', { name: '返回发展端' }));
    expect(screen.getByText('无体育')).toBeInTheDocument();
  });

  it.each([
    ['profile', '/profile?uid=student-1&embed=development', 'FREE-BBS 个人主页'],
    ['settings', '/settings?embed=development', 'FREE-BBS 设置'],
  ] as const)('keeps the main-site %s page inside development', (section, source, title) => {
    render(
      <MemoryRouter initialEntries={[`/${section}`]}>
        <Routes>
          <Route
            path={`/${section}`}
            element={<CommercePage section={section} userUid="student-1" />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTitle(title)).toHaveAttribute('src', source);
  });

  it('keeps shop-to-inventory navigation inside development', async () => {
    renderCommerce();
    const frame = screen.getByTitle('FREE-BBS 商店') as HTMLIFrameElement;
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        source: frame.contentWindow,
        data: { type: 'freebbs:development-commerce-navigation', path: '/inventory' },
      }),
    );
    await waitFor(() =>
      expect(screen.getByTitle('FREE-BBS 仓库')).toHaveAttribute(
        'src',
        '/inventory?embed=development',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: '返回发展端' }));
    expect(screen.getByText('无体育')).toBeInTheDocument();
  });

  it('keeps warehouse profile and ranch links in one development shell with their uid', async () => {
    renderCommerce();
    const openFromFrame = (title: string, path: string) => {
      const frame = screen.getByTitle(title) as HTMLIFrameElement;
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: window.location.origin,
          source: frame.contentWindow,
          data: { type: 'freebbs:development-commerce-navigation', path },
        }),
      );
    };
    openFromFrame('FREE-BBS 商店', '/inventory');
    await screen.findByTitle('FREE-BBS 仓库');
    openFromFrame('FREE-BBS 仓库', '/profile?uid=u_other#outfits');
    await waitFor(() =>
      expect(screen.getByTitle('FREE-BBS 个人主页')).toHaveAttribute(
        'src',
        '/profile?uid=u_other&embed=development#outfits',
      ),
    );
    openFromFrame('FREE-BBS 个人主页', '/ranch?uid=u_other');
    await waitFor(() =>
      expect(screen.getByTitle('FREE-BBS 电子牧场')).toHaveAttribute(
        'src',
        '/ranch?uid=u_other&embed=development',
      ),
    );
    expect(document.querySelectorAll('iframe')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '返回发展端' }));
    expect(screen.getByText('无体育')).toBeInTheDocument();
  });

  it('ignores forged, external and unsupported navigation messages', () => {
    renderCommerce();
    const frame = screen.getByTitle('FREE-BBS 商店') as HTMLIFrameElement;
    for (const [origin, source, path] of [
      ['https://untrusted.example', frame.contentWindow, '/profile?uid=u_other'],
      [window.location.origin, window, '/profile?uid=u_other'],
      [window.location.origin, frame.contentWindow, 'https://untrusted.example/profile'],
      [window.location.origin, frame.contentWindow, '/admin'],
    ] as const) {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin,
          source,
          data: { type: 'freebbs:development-commerce-navigation', path },
        }),
      );
    }
    expect(screen.getByTitle('FREE-BBS 商店')).toBeInTheDocument();
  });

  it('fits the embedded content to its validated height without a second scroll frame', async () => {
    renderCommerce();
    const frame = screen.getByTitle('FREE-BBS 商店') as HTMLIFrameElement;
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        source: frame.contentWindow,
        data: { type: 'freebbs:development-commerce-size', height: 1280 },
      }),
    );
    await waitFor(() => expect(frame).toHaveStyle({ height: '1280px' }));
    for (const height of [-5, NaN, Infinity, '900']) {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: window.location.origin,
          source: frame.contentWindow,
          data: { type: 'freebbs:development-commerce-size', height },
        }),
      );
    }
    expect(frame).toHaveStyle({ height: '1280px' });
  });
});
