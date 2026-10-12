import { useState } from 'react';
import mapCode from '../../assets/events/free-bbs-map-code.png';
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
          frEE bbs MAP <span className="map-coming-soon">微信小程序</span>
        </button>
      )}
      <EditorDrawer open={open} title="frEE bbs MAP" onClose={() => setOpen(false)}>
        <p>frEE bbs MAP 已发布。请在微信中搜索「frEE bbs MAP」打开小程序。</p>
        <div className="map-code-panel">
          <img src={mapCode} alt="frEE bbs MAP 小程序码" />
          <a href={mapCode} download="frEE-bbs-MAP.png">
            保存小程序码
          </a>
          <p>使用微信扫一扫打开。手机浏览时，也可以保存图片后在微信中扫码。</p>
        </div>
      </EditorDrawer>
    </>
  );
}
