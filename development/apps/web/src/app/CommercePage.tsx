import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { mainSiteHref } from './main-site-api.js';

interface CommercePageProps {
  section: 'shop' | 'inventory';
}

export function CommercePage({ section }: CommercePageProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from || '/dashboard';
  const source = mainSiteHref(
    section === 'shop' ? '/electromagnetic?embed=development' : '/inventory?embed=development',
  );

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
    <section className="development-commerce" aria-label={section === 'shop' ? '商店' : '仓库'}>
      <div className="development-commerce-heading">
        <div>
          <p>FREE-BBS · 电磁场</p>
          <h1>{section === 'shop' ? '商店' : '仓库'}</h1>
        </div>
        <button type="button" onClick={() => navigate(from)}>
          返回发展端
        </button>
      </div>
      <iframe
        ref={frame}
        key={section}
        title={section === 'shop' ? 'FREE-BBS 商店' : 'FREE-BBS 仓库'}
        src={source}
      />
    </section>
  );
}
