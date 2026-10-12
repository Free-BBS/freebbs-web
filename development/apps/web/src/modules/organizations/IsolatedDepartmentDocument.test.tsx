import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { IsolatedDepartmentDocument } from './IsolatedDepartmentDocument.js';
function show() {
  const view = render(
    <IsolatedDepartmentDocument
      html="<!doctype html><html><body><h1>Private markup</h1></body></html>"
      title="Isolated document"
    />,
  );
  const frame = screen.getByTitle('Isolated document') as HTMLIFrameElement;
  frame.style.border = '1px solid';
  const token = frame.srcdoc.match(/const token="([^"]+)"/)![1];
  const send = (height: unknown, options: { token?: string; source?: Window | null } = {}) =>
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: options.source === undefined ? frame.contentWindow : options.source,
          data: { type: 'department-height', token: options.token ?? token, height },
        }),
      );
    });
  return { ...view, frame, token, send };
}
describe('isolated document bridge', () => {
  it('ignores wrong senders/tokens and invalid dimensions while bounding genuine heights', () => {
    const { frame, send } = show();
    send(1000, { source: window });
    send(1000, { token: 'forged' });
    send(Infinity);
    send('1000');
    send(NaN);
    expect(frame.style.height).toBe('360px');
    send(999999);
    expect(frame.style.height).toBe('2400px');
    send(-20);
    expect(frame.style.height).toBe('240px');
  });
  it('stops a rapid viewport feedback loop but accepts a later large content change', () => {
    const { frame, send } = show();
    for (let height = 424; height <= 1400; height += 64) send(height);
    expect(parseInt(frame.style.height)).toBeLessThan(1000);
    send(1800);
    expect(frame.style.height).toBe('1802px');
  });
  it('continues accepting rapid small decreases through an animated collapse', () => {
    const { frame, send } = show();
    send(1800);
    for (let height = 1750; height >= 250; height -= 50) send(height);
    expect(frame.style.height).toBe('252px');
  });
  it('puts standards mode and restrictive CSP ahead of every authored node and cleans up its listener', () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    const { frame, unmount } = show();
    expect(frame.srcdoc).toMatch(/^<!doctype html><meta http-equiv="Content-Security-Policy"/);
    for (const directive of [
      "connect-src 'none'",
      "form-action 'none'",
      "base-uri 'none'",
      "object-src 'none'",
      "frame-src 'none'",
      "default-src 'none'",
    ])
      expect(frame.srcdoc).toContain(directive);
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
    expect(screen.queryByRole('heading', { name: 'Private markup' })).not.toBeInTheDocument();
    unmount();
    expect(remove).toHaveBeenCalledWith('message', expect.any(Function));
    remove.mockRestore();
  });
});
