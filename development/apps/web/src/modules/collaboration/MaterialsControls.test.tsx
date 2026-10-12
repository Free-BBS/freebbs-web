import { act, fireEvent, render, screen } from '@testing-library/react';
import { it, expect, vi } from 'vitest';
import type { CollaborationSpace } from '@freebbs-development/contracts';
const mocks = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock('../../core/auth/AuthProvider.js', () => ({ useAuth: mocks.auth }));
import { SpaceDownloads } from './MaterialsControls.js';
it('does not save private exports after the identity view is unmounted', async () => {
  let finish!: (blob: Blob) => void;
  const download = vi.fn(
    () =>
      new Promise<Blob>((resolve) => {
        finish = resolve;
      }),
  );
  mocks.auth.mockReturnValue({ client: { download } });
  const create = vi.fn(() => 'blob:private');
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create }));
  const space = {
    id: 'space',
    title: 'Private export',
    entries: [],
  } as unknown as CollaborationSpace;
  const page = render(<SpaceDownloads space={space} />);
  fireEvent.click(screen.getByText('下载Excel记录'));
  page.unmount();
  await act(async () => {
    finish(new Blob(['private']));
  });
  expect(create).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
