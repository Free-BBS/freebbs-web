import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MediaCapture } from './MediaCapture.js';

afterEach(() => vi.unstubAllGlobals());
describe('MediaCapture', () => {
  it('explains unavailable recording without blocking file uploads', () => {
    vi.stubGlobal('MediaRecorder', undefined);
    render(<MediaCapture kind="audio" onFile={vi.fn()} />);
    expect(screen.getByText(/不支持直接录制/)).toBeVisible();
  });
  it('stops capture tracks and hands a real recorded File to the form', async () => {
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }] };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });
    class Recorder {
      static isTypeSupported() {
        return true;
      }
      state = 'inactive';
      mimeType = 'audio/webm';
      ondataavailable?: (event: { data: Blob }) => void;
      onstop?: () => void;
      start() {
        this.state = 'recording';
      }
      stop() {
        this.state = 'inactive';
        this.ondataavailable?.({ data: new Blob(['recording'], { type: this.mimeType }) });
        this.onstop?.();
      }
    }
    vi.stubGlobal('MediaRecorder', Recorder);
    vi.stubGlobal(
      'URL',
      Object.assign(URL, {
        createObjectURL: vi.fn(() => 'blob:recording'),
        revokeObjectURL: vi.fn(),
      }),
    );
    const onFile = vi.fn();
    render(<MediaCapture kind="audio" onFile={onFile} />);
    fireEvent.click(screen.getByRole('button', { name: '开始录音' }));
    await screen.findByRole('button', { name: '完成录制' });
    fireEvent.click(screen.getByRole('button', { name: '完成录制' }));
    await waitFor(() => expect(stop).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: '使用这段录音' }));
    expect(onFile.mock.calls[0]?.[0]).toBeInstanceOf(File);
    expect(onFile.mock.calls[0]?.[0].type).toBe('audio/webm');
  });
  it('releases a stream whose permission request resolves after unmount', async () => {
    let accept!: (value: unknown) => void;
    const stop = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: () =>
          new Promise((resolve) => {
            accept = resolve;
          }),
      },
    });
    vi.stubGlobal(
      'MediaRecorder',
      class {
        static isTypeSupported() {
          return true;
        }
      },
    );
    const { unmount } = render(<MediaCapture kind="video" onFile={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '开始录像' }));
    unmount();
    accept({ getTracks: () => [{ stop }] });
    await waitFor(() => expect(stop).toHaveBeenCalledOnce());
  });
});
