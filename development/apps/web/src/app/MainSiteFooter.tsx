import '../styles/shared-site-footer.css';
import '../styles/main-site-footer.css';

import { mainSiteHref } from './main-site-api.js';

export function MainSiteFooter() {
  return (
    <footer className="site-footer site-footer-compact">
      <nav className="footer-links" aria-label="关于平台">
        <a href={mainSiteHref('/about')}>关于 FREE BBS</a>
        <a href={mainSiteHref('/staff')}>FREE BBS 工作人员名单</a>
        <a href="https://www.ee.tsinghua.edu.cn/" target="_blank" rel="noreferrer">
          清华大学电子系
        </a>
        <a href="https://www.eesast.com">电子系学生科协</a>
      </nav>
      <div className="footer-meta">
        <p>© 2026-2027 FREE BBS 工作组</p>
        <p>京ICP备2025155858号-2</p>
      </div>
    </footer>
  );
}
