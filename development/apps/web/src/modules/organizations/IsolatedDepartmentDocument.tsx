import { useEffect, useMemo, useRef, useState } from 'react';

const MIN_HEIGHT = 240;
const MAX_HEIGHT = 2400;
const POLICY =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https: data:; img-src https: data:; font-src https: data:; media-src https: data:; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'; frame-src 'none'";

// The policy and bridge are parsed before any uploaded markup, including full documents.
export function IsolatedDepartmentDocument({ html, title }: { html: string; title: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(360);
  const token = useMemo(() => crypto.randomUUID(), []);
  const srcDoc = useMemo(() => {
    // Keep measurement inside the opaque document. Root scrollHeight is floored
    // to its viewport, so use rendered boxes and body overflow for shrinking.
    const bridge = `(() => {
      const token=${JSON.stringify(token)};
      let pending = false, last = 0;
      const pixels = value => Number.parseFloat(value) || 0;
      const measure = () => {
        const root = document.documentElement;
        const body = document.body;
        const rootStyle = getComputedStyle(root);
        const rootBox = root.getBoundingClientRect();
        const rootExtent = rootBox.bottom + scrollY + Math.max(0, pixels(rootStyle.marginBottom));
        if (!body) return rootExtent;
        const style = getComputedStyle(body);
        const box = body.getBoundingClientRect();
        const borders = pixels(style.borderTopWidth) + pixels(style.borderBottomWidth);
        const bodyExtent = box.top + scrollY + Math.max(box.height, body.scrollHeight + borders)
          + Math.max(0, pixels(style.marginBottom)) + pixels(rootStyle.paddingBottom) + pixels(rootStyle.borderBottomWidth);
        // Preserve real overflow outside the body, but never use a viewport floor.
        const overflow = root.scrollHeight > root.clientHeight + 1 ? root.scrollHeight : 0;
        return Math.ceil(Math.max(rootExtent, bodyExtent, overflow));
      };
      const send = () => {
        if (pending) return;
        pending = true;
        requestAnimationFrame(() => {
          pending = false;
          const height = measure();
          if (height !== last) { last = height; parent.postMessage({type:'department-height',token,height}, '*'); }
        });
      };
      addEventListener('DOMContentLoaded', () => {
        send();
        const observer = new ResizeObserver(send);
        observer.observe(document.documentElement);
        if (document.body) {
          observer.observe(document.body);
          new MutationObserver(send).observe(document.body, {childList:true,subtree:true,attributes:true,characterData:true});
        }
        document.fonts?.ready.then(send);
      });
      addEventListener('load', send, true);
      addEventListener('resize', send);
    })();`;
    return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${POLICY}"><meta name="referrer" content="no-referrer"><script>${bridge}</script>${html}`;
  }, [html, token]);
  useEffect(() => {
    let previous = 360;
    let lastAt = 0;
    let growing = 0;
    const resize = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; token?: unknown; height?: unknown } | null;
      if (
        event.source !== frame.current?.contentWindow ||
        !data ||
        data.type !== 'department-height' ||
        data.token !== token ||
        typeof data.height !== 'number' ||
        !Number.isFinite(data.height)
      )
        return;
      const frameStyle = frame.current ? getComputedStyle(frame.current) : null;
      const borders = frameStyle
        ? (Number.parseFloat(frameStyle.borderTopWidth) || 0) +
          (Number.parseFloat(frameStyle.borderBottomWidth) || 0)
        : 0;
      const next = Math.ceil(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, data.height + borders)));
      const now = Date.now();
      // A 100vh root with padding grows with its own viewport. Freeze this loop and
      // let the frame scroll, while still accepting later genuine layout changes.
      if (next > previous && next - previous < 160 && now - lastAt < 500) growing += 1;
      else if (next < previous || now - lastAt >= 500 || next - previous >= 160) growing = 0;
      lastAt = now;
      previous = next;
      if (growing > 6) return;
      setHeight(next);
    };
    window.addEventListener('message', resize);
    return () => window.removeEventListener('message', resize);
  }, [token]);
  return (
    <iframe
      ref={frame}
      title={title}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      srcDoc={srcDoc}
      className="department-document"
      style={{ height }}
    />
  );
}
