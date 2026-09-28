import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { mainSiteHref } from './main-site-api.js';

interface CommercePageProps {
  section: 'shop' | 'inventory' | 'profile' | 'settings';
  userUid?: string;
}

const sectionLabels = {
  shop: { label: '商店', title: 'FREE-BBS 商店' },
  inventory: { label: '仓库', title: 'FREE-BBS 仓库' },
  profile: { label: '个人主页', title: 'FREE-BBS 个人主页' },
  settings: { label: '设置', title: 'FREE-BBS 设置' },
} as const;

export function CommercePage({ section, userUid = '' }: CommercePageProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from || '/dashboard';
  const sourcePath =
    section === 'shop'
      ? '/electromagnetic?embed=development'
      : section === 'inventory'
        ? '/inventory?embed=development'
        : section === 'profile'
          ? `/profile?uid=${encodeURIComponent(userUid)}&embed=development`
          : '/settings?embed=development';
  const source = mainSiteHref(sourcePath);
  const labels = sectionLabels[section];

  useEffect(() => {
    const expectedOrigin = new URL(source, window.location.href).origin;
    function onMessage(event: MessageEvent) {
      if (event.source !== frame.current?.contentWindow || event.origin !== expectedOrigin) return;
      if (event.data?.type !== 'freebbs:development-commerce-navigation') return;
      if (event.data.path === '/inventory') navigate('/inventory', { state: { from } });
      if (event.data.path === '/electromagnetic') navigate('/shop', { state: { from } });
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
      <iframe ref={frame} key={section} title={labels.title} src={source} />
    </section>
  );
}
