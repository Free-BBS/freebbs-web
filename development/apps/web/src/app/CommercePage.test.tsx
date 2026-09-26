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
        <Route path="/sports" element={<div>无体育</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('development commerce', () => {
  it('loads the main-site shop inside development and returns to the previous module', () => {
    renderCommerce();
    expect(screen.getByTitle('FREE-BBS 商店')).toHaveAttribute(
      'src',
      '/electromagnetic?embed=development',
    );
    fireEvent.click(screen.getByRole('button', { name: '返回发展端' }));
    expect(screen.getByText('无体育')).toBeInTheDocument();
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
});
