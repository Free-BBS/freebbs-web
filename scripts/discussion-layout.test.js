const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/discussion.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/discussion.css'), 'utf8');
const desktopCss = fs.readFileSync(path.join(root, 'public/desktop-elegant.css'), 'utf8');

test('discussion boards precede the feed and obsolete personal statistics are absent', () => {
  const boards = html.indexOf('id="discussion-board-list"');
  const feed = html.indexOf('class="discussion-feed"');
  assert.ok(boards > 0 && boards < feed);
  assert.doesNotMatch(html, /discussion-stats-posts|discussion-stats-likes/);
  assert.doesNotMatch(html, /发帖统计|获赞统计/);
});

test('desktop discussion layout uses a single column with horizontal board navigation', () => {
  assert.match(css, /grid-template-areas:\s*'stats'\s*'feed'/);
  assert.match(css, /\.discussion-board-list\s*{[^}]*display:\s*flex/s);
  assert.match(css, /\.discussion-board-list\s*{[^}]*overflow-x:\s*auto/s);
});

test('desktop discussion content fills the space beside the navigation rail', () => {
  assert.match(
    desktopCss,
    /body\.discussion-page \.main-content\s*>\s*\.settings-shell[^{]*{[^}]*width:\s*100%\s*!important;[^}]*max-width:\s*none\s*!important;/s,
  );
  assert.match(
    desktopCss,
    /body\.discussion-page \.main-content::before\s*{[^}]*max-width:\s*none;/s,
  );
  assert.match(
    desktopCss,
    /body\.discussion-page \.discussion-layout:not\(\.is-detail-view\)[^{]*{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)\s*!important;/s,
  );
});
