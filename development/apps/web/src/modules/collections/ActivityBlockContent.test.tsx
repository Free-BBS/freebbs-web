import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ActivityBlockContent } from './ActivityBlockContent.js';
describe('protected activity media', () => {
  it('fetches image bytes with the authenticated client and revokes object URLs on unmount', async () => {
    const create = vi.fn(() => 'blob:protected');
    const revoke = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
    const download = vi.fn(async () => new Blob(['image'], { type: 'image/png' }));
    const view = render(
      <ActivityBlockContent
        blocks={[{ id: 'b', kind: 'image', text: '', assetId: 'asset', caption: '合影' }]}
        assets={[
          {
            id: 'asset',
            name: 'photo.png',
            mimeType: 'image/png',
            sizeBytes: 5,
            url: '/private/photo',
          },
        ]}
        client={{ download }}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole('img', { name: '合影' })).toHaveAttribute('src', 'blob:protected'),
    );
    expect(download).toHaveBeenCalledWith('/private/photo');
    view.unmount();
    expect(revoke).toHaveBeenCalledWith('blob:protected');
  });
});
