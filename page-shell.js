// Shared server-rendered footer: one definition for production and local previews.
// Only site footers are replaced; editor/dialog action footers remain untouched.
const SITE_FOOTER = `<footer class="site-footer site-footer-compact" data-shared-footer>
  <nav class="footer-links" aria-label="关于平台">
    <a href="/about">关于 FREE BBS</a>
    <a href="/staff">FREE BBS 工作人员名单</a>
    <a href="https://www.ee.tsinghua.edu.cn/" target="_blank" rel="noreferrer">清华大学电子系</a>
    <a href="https://www.eesast.com">电子系学生科协</a>
  </nav>
  <div class="footer-meta">
    <p>© 2026-2027 FREE BBS 工作组</p>
    <p>京ICP备2025155858号-2</p>
  </div>
</footer>`;

function preparePageShell(source) {
  if (!/<body\b/.test(source) || /class="[^"]*\bcircuit-embed-page\b/.test(source)) return source;
  const footer = /<footer\b[^>]*class=["'][^"']*\bsite-footer\b[^"']*["'][^>]*>[\s\S]*?<\/footer>/;
  let html = footer.test(source)
    ? source.replace(footer, SITE_FOOTER)
    : source.replace('</main>', `</main>\n${SITE_FOOTER}`);
  if (!html.includes('href="/site-footer.css"'))
    html = html.replace('</head>', '<link rel="stylesheet" href="/site-footer.css"></head>');
  // Apply saved font size and theme before any page content can paint. The same
  // preference module still executes once, before app.js, including on auth pages.
  const typography = /<script\b[^>]*src=["']\/typography\.js["'][^>]*>\s*<\/script>/;
  if (
    typography.test(html) &&
    !/<body\b[^>]*>\s*<script src="\/typography.js"><\/script>/.test(html)
  )
    html = html
      .replace(typography, '')
      .replace(/(<body\b[^>]*>)/, '$1\n<script src="/typography.js"></script>');
  return html;
}

module.exports = { SITE_FOOTER, preparePageShell };
