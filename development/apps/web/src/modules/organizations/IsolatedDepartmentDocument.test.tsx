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
  frame.style.boxSizing = 'border-box';
  let viewportWidth = 800;
  // jsdom has no iframe layout; model the actual border-box viewport used by the app.
  Object.defineProperties(frame, {
    clientHeight: { configurable: true, get: () => Number.parseFloat(frame.style.height) - 2 },
    clientWidth: { configurable: true, get: () => viewportWidth },
  });
  const token = () => frame.srcdoc.match(/const token="([^"]+)"/)![1];
  const send = (
    height: unknown,
    options: {
      token?: string;
      source?: Window | null;
      fields?: Record<string, unknown>;
    } = {},
  ) =>
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: options.source === undefined ? frame.contentWindow : options.source,
          data: {
            type: 'department-height',
            token: options.token ?? token(),
            height,
            viewportHeight: frame.clientHeight,
            viewportWidth,
            revision: 0,
            ...options.fields,
          },
        }),
      );
    });
  return {
    ...view,
    frame,
    token,
    send,
    setViewportWidth: (width: number) => (viewportWidth = width),
  };
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
    send(1800, { fields: { revision: 1 } });
    expect(frame.style.height).toBe('1802px');
  });
  it('rejects dimensions without a valid viewport and content revision', () => {
    const { frame, send } = show();
    for (const fields of [
      { viewportHeight: undefined },
      { viewportHeight: Infinity },
      { viewportHeight: 0 },
      { viewportWidth: NaN },
      { viewportWidth: '800' },
      { viewportWidth: -1 },
      { revision: undefined },
      { revision: -1 },
      { revision: 0.5 },
      { revision: Number.MAX_SAFE_INTEGER + 1 },
    ])
      send(1000, { fields });
    expect(frame.style.height).toBe('360px');
  });
  it('ignores interleaved reports from old viewports instead of starting two feedback chains', () => {
    const { frame, send } = show();
    send(422);
    expect(frame.style.height).toBe('424px');
    send(302, { fields: { viewportHeight: 238 } });
    expect(frame.style.height).toBe('424px');
    send(486);
    expect(frame.style.height).toBe('488px');
    send(366, { fields: { viewportHeight: 302 } });
    expect(frame.style.height).toBe('488px');
    for (let height = 550; height <= 2000; height += 64) send(height);
    expect(parseInt(frame.style.height)).toBeLessThan(1000);
  });
  it('does not restart an unchanged viewport feedback budget after slow frames', () => {
    let now = 0;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const { frame, send } = show();
      for (let height = 424; height <= 2000; height += 64) {
        now += 600;
        send(height);
      }
      expect(parseInt(frame.style.height)).toBeLessThan(1000);
      send(1800, { fields: { revision: 1 } });
      expect(frame.style.height).toBe('1802px');
    } finally {
      clock.mockRestore();
    }
  });
  it('compares growth with the accepted frame height after a rejected larger report', () => {
    const { frame, send } = show();
    for (let height = 424; height <= 1000; height += 64) send(height);
    const accepted = Number.parseInt(frame.style.height);
    send(1800);
    send(accepted + 20);
    expect(frame.style.height).toBe(`${accepted}px`);
    send(accepted - 52);
    expect(frame.style.height).toBe(`${accepted - 50}px`);
    send(accepted - 30);
    expect(frame.style.height).toBe(`${accepted - 50}px`);
  });
  it('accepts new content and width changes while ignoring older revisions and widths', () => {
    const { frame, send, setViewportWidth } = show();
    for (let height = 424; height <= 1400; height += 64) send(height);
    send(1800, { fields: { revision: 1 } });
    expect(frame.style.height).toBe('1802px');
    send(300, { fields: { revision: 2 } });
    expect(frame.style.height).toBe('302px');
    send(1800, { fields: { revision: 1 } });
    expect(frame.style.height).toBe('302px');
    setViewportWidth(400);
    send(1200, { fields: { revision: 2 } });
    expect(frame.style.height).toBe('1202px');
    send(1600, { fields: { revision: 2, viewportWidth: 800 } });
    expect(frame.style.height).toBe('1202px');
  });
  it('continues accepting rapid small decreases through an animated collapse', () => {
    const { frame, send } = show();
    send(1800);
    for (let height = 1750; height >= 250; height -= 50) send(height);
    expect(frame.style.height).toBe('252px');
  });
  it('starts a new token and initial height when a caller replaces html without remounting', () => {
    const { frame, token, send, rerender } = show();
    const previousToken = token();
    send(1800);
    expect(frame.style.height).toBe('1802px');
    rerender(<IsolatedDepartmentDocument html="<h1>Replacement</h1>" title="Isolated document" />);
    expect(token()).not.toBe(previousToken);
    expect(frame.style.height).toBe('360px');
    send(2000, { token: previousToken });
    expect(frame.style.height).toBe('360px');
    send(700);
    expect(frame.style.height).toBe('702px');
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
