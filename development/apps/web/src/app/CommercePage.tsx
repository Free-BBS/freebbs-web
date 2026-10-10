import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { mainSiteHref } from './main-site-api.js';

interface CommercePageProps {
  section: 'shop' | 'inventory' | 'profile' | 'settings' | 'ranch' | 'ranch-gallery' | 'ranch-dye';
  userUid?: string;
}

const sectionLabels = {
  shop: { label: '商店', title: 'FREE-BBS 商店' },
  inventory: { label: '仓库', title: 'FREE-BBS 仓库' },
  profile: { label: '个人主页', title: 'FREE-BBS 个人主页' },
  settings: { label: '设置', title: 'FREE-BBS 设置' },
  ranch: { label: '电子牧场', title: 'FREE-BBS 电子牧场' },
  'ranch-gallery': { label: '羊群广场', title: 'FREE-BBS 羊群广场' },
  'ranch-dye': { label: '牧场染坊', title: 'FREE-BBS 牧场染坊' },
} as const;

const sharedRoutes: Record<string, string> = {
  '/electromagnetic': '/shop',
  '/inventory': '/inventory',
  '/profile': '/profile',
  '/settings': '/settings',
  '/ranch': '/ranch',
  '/ranch-gallery': '/ranch-gallery',
  '/ranch-dye': '/ranch-dye',
};

export function CommercePage({ section, userUid = '' }: CommercePageProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const [height, setHeight] = useState(700);
  const from = (location.state as { from?: string } | null)?.from || '/community';
  const query = new URLSearchParams(location.search);
  query.delete('embed');
  if ((section === 'profile' || section === 'ranch') && !query.has('uid') && userUid) {
    query.set('uid', userUid);
  }
  query.set('embed', 'development');
  const sourcePath = `${section === 'shop' ? '/electromagnetic' : `/${section}`}?${query}${location.hash}`;
  const source = mainSiteHref(sourcePath);
  const labels = sectionLabels[section];

  useEffect(() => {
    setHeight(700);
    const expectedOrigin = new URL(source, window.location.href).origin;
    function onMessage(event: MessageEvent) {
      if (event.source !== frame.current?.contentWindow || event.origin !== expectedOrigin) return;
      if (event.data?.type === 'freebbs:development-commerce-size') {
        const nextHeight: unknown = event.data.height;
        if (
          typeof nextHeight === 'number' &&
          Number.isFinite(nextHeight) &&
          nextHeight > 0 &&
          nextHeight <= 100_000
        ) {
          setHeight(Math.max(360, Math.ceil(nextHeight)));
        }
        return;
      }
      if (event.data?.type !== 'freebbs:development-commerce-navigation') return;
      if (typeof event.data.path !== 'string') return;
      try {
        const target = new URL(event.data.path, expectedOrigin);
        const destination = Object.hasOwn(sharedRoutes, target.pathname)
          ? sharedRoutes[target.pathname]
          : null;
        if (target.origin !== expectedOrigin || !destination) return;
        target.searchParams.delete('embed');
        navigate(`${destination}${target.search}${target.hash}`, { state: { from } });
      } catch {
        // Only parseable routes from the current shared-page frame can navigate the shell.
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [from, navigate, source]);

  return (
    <section className="development-commerce" aria-label={labels.label}>
      <div className="development-commerce-heading">
        <button type="button" onClick={() => navigate(from)}>
          返回发展端
        </button>
      </div>
      <iframe ref={frame} key={section} title={labels.title} src={source} style={{ height }} />
    </section>
  );
}
