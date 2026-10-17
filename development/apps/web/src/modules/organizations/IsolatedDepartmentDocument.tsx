import { useEffect, useMemo, useRef, useState } from 'react';

const MIN_HEIGHT = 240;
const MAX_HEIGHT = 2400;
const POLICY =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https: data:; img-src https: data:; font-src https: data:; media-src https: data:; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'; frame-src 'none'";

// The policy and bridge are parsed before any uploaded markup, including full documents.
export function IsolatedDepartmentDocument({ html, title }: { html: string; title: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(360);
  const token = useMemo(() => crypto.randomUUID(), [html]);
  const srcDoc = useMemo(() => {
    // Keep measurement inside the opaque document. Root scrollHeight is floored
    // to its viewport, so use rendered boxes and body overflow for shrinking.
    const bridge = `(() => {
      const token=${JSON.stringify(token)};
      let pending = false, last = '', revision = 0, width = innerWidth;
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
          if (document.readyState === 'loading' || !document.body) return;
          if (innerWidth !== width) { width = innerWidth; revision += 1; }
          const viewportWidth = innerWidth, viewportHeight = innerHeight;
          const height = measure();
          const signature = [revision, viewportWidth, viewportHeight, height].join(':');
          if (signature !== last) {
            last = signature;
            parent.postMessage({type:'department-height',token,height,viewportWidth,viewportHeight,revision}, '*');
          }
        });
      };
      const contentChanged = () => { revision += 1; send(); };
      addEventListener('DOMContentLoaded', () => {
        contentChanged();
        const observer = new ResizeObserver(send);
        observer.observe(document.documentElement);
        if (document.body) {
          observer.observe(document.body);
        }
        new MutationObserver(contentChanged).observe(document.documentElement, {childList:true,subtree:true,attributes:true,characterData:true});
        document.fonts?.ready.then(contentChanged);
      });
      addEventListener('load', contentChanged, true);
      addEventListener('resize', send);
    })();`;
    return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${POLICY}"><meta name="referrer" content="no-referrer"><script>${bridge}</script>${html}`;
  }, [html, token]);
  useEffect(() => {
    let growing = 0;
    let revision = -1;
    let width = 0;
    setHeight(360);
    const resize = (event: MessageEvent) => {
      const data = event.data as {
        type?: unknown;
        token?: unknown;
        height?: unknown;
        viewportHeight?: unknown;
        viewportWidth?: unknown;
        revision?: unknown;
      } | null;
      const element = frame.current;
      if (
        !element ||
        event.source !== element.contentWindow ||
        !data ||
        data.type !== 'department-height' ||
        data.token !== token ||
        typeof data.height !== 'number' ||
        !Number.isFinite(data.height) ||
        typeof data.viewportHeight !== 'number' ||
        !Number.isFinite(data.viewportHeight) ||
        data.viewportHeight <= 0 ||
        typeof data.viewportWidth !== 'number' ||
        !Number.isFinite(data.viewportWidth) ||
        data.viewportWidth <= 0 ||
        typeof data.revision !== 'number' ||
        !Number.isSafeInteger(data.revision) ||
        data.revision < 0
      )
        return;
      const frameStyle = getComputedStyle(element);
      const pixels = (value: string) => Number.parseFloat(value) || 0;
      const borders = pixels(frameStyle.borderTopWidth) + pixels(frameStyle.borderBottomWidth);
      const viewportHeight =
        element.clientHeight - pixels(frameStyle.paddingTop) - pixels(frameStyle.paddingBottom);
      const viewportWidth =
        element.clientWidth - pixels(frameStyle.paddingLeft) - pixels(frameStyle.paddingRight);
      // A queued report may describe the viewport before a more recent resize.
      // Applying it creates two interleaved feedback chains that can evade a guard.
      if (
        Math.abs(data.viewportHeight - viewportHeight) > 1 ||
        Math.abs(data.viewportWidth - viewportWidth) > 1 ||
        data.revision < revision
      )
        return;
      if (data.revision !== revision || data.viewportWidth !== width) {
        growing = 0;
        revision = data.revision;
        width = data.viewportWidth;
      }
      const next = Math.ceil(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, data.height + borders)));
      // A 100vh root with padding grows with its own viewport. Freeze this loop and
      // let the frame scroll. Only authored content or a width change starts a new
      // budget, so slow frames and old small/large oscillations cannot reset it.
      if (next > element.clientHeight + borders) {
        growing += 1;
        if (growing > 6) return;
      }
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
