import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type { ApiClient } from '../../core/api/client.js';
import { CollectionsLandingPage } from './CollectionsLandingPage.js';

describe('CollectionsLandingPage', () => {
  it('uses the 萬事屋 name and keeps an explicit route to existing activity management', async () => {
    const request = vi.fn().mockResolvedValue({ featured: [], showcase: [], canCreate: false });

    render(
      <MemoryRouter>
        <CollectionsLandingPage client={{ request } as unknown as ApiClient} />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '萬事屋' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '现有活动' })).toHaveAttribute('href', '/events');
    expect(screen.getByLabelText('萬事屋告示板')).toBeInTheDocument();
  });
});
