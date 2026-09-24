import { useState } from 'react';
import { EditorDrawer } from '../../components/EditorDrawer.js';
import { FREE_BBS_MAP_URL, safeMapUrl } from './site-config.js';

export function FreeBbsMapAction({ url = FREE_BBS_MAP_URL }: { url?: string | null }) {
  const [open, setOpen] = useState(false);
  const href = safeMapUrl(url);
  return (
    <>
      {href ? (
        <a className="map-entry" href={href} target="_blank" rel="noopener noreferrer">
          frEE bbs MAP <span aria-hidden="true">↗</span>
        </a>
      ) : (
        <button className="map-entry" type="button" onClick={() => setOpen(true)}>
          frEE bbs MAP <span className="map-coming-soon">即将上线</span>
        </button>
      )}
      <EditorDrawer open={open} title="frEE bbs MAP" onClose={() => setOpen(false)}>
        <p>小程序尚未发布，正在准备上线。发布后，你可以从这里直接打开 frEE bbs MAP。</p>
      </EditorDrawer>
    </>
  );
}
