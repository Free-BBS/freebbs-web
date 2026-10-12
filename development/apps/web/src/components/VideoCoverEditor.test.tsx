import { render, screen, fireEvent } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { VideoCoverEditor } from './VideoCoverEditor.js';
it('allows capturing a decoded frame when a recorded WebM has unknown duration', () => {
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = vi.fn(() => 'blob:test');
  URL.revokeObjectURL = vi.fn();
  try {
    const view = render(
      <VideoCoverEditor file={new File(['clip'], 'clip.webm', { type: 'video/webm' })} />,
    );
    const video = view.container.querySelector('video')!;
    Object.defineProperty(video, 'duration', { value: Infinity });
    fireEvent.loadedMetadata(video);
    expect(screen.getByRole('button', { name: '截取封面' })).toBeDisabled();
    fireEvent.loadedData(video);
    expect(screen.getByRole('button', { name: '截取封面' })).toBeEnabled();
    expect(screen.getByRole('slider', { name: '封面时间' })).toBeDisabled();
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test');
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
});
