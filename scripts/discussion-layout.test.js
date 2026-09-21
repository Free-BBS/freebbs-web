const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/discussion.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/discussion.css'), 'utf8');
const desktopCss = fs.readFileSync(path.join(root, 'public/desktop-elegant.css'), 'utf8');
const postReaderCss = fs.readFileSync(path.join(root, 'public/post-reader.css'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');

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

test('desktop post reader uses a wide technical-content column while mobile remains fluid', () => {
  assert.match(
    postReaderCss,
    /body\.discussion-page\.post-reading \.discussion-detail\s*{[^}]*max-width:\s*1280px;[^}]*width:\s*100%;/s,
  );
  assert.match(
    postReaderCss,
    /@media \(max-width:\s*900px\)[\s\S]*?body\.discussion-page\.post-reading \.discussion-detail\s*{[^}]*padding:\s*0\s*!important;/s,
  );
});

test('mobile child comments name their parent and retain a bounded thread guide', () => {
  assert.match(
    appSource,
    /class="discussion-comment-parent" href="#comment-\$\{Number\(parentComment\.id\)\}"/,
  );
  assert.match(
    appSource,
    /data-parent-comment-id="\$\{Number\(comment\.parentCommentId \|\| 0\)\}"/,
  );
  assert.match(
    postReaderCss,
    /@media \(max-width:\s*900px\)[\s\S]*?#discussion-detail \.discussion-comment-reply\s*{[^}]*margin-left:\s*min\(calc\(var\(--comment-depth, 1\) \* 12px\), 36px\)\s*!important;[^}]*border-left:\s*2px solid/s,
  );
});

test('reply threads show one reply by default and expose a flat expand control', () => {
  assert.match(
    appSource,
    /const flattenReplies = \(parentId, depth = 1\) =>[\s\S]*?\.\.\.flattenReplies\(reply\.id, depth \+ 1\)/,
  );
  assert.match(appSource, /renderComment\(comment, depth, \{ hidden: !expanded && index > 0 \}\)/);
  assert.match(
    appSource,
    /data-action="toggle-comment-thread"[\s\S]*?aria-expanded="\$\{expanded\}"/,
  );
  assert.match(appSource, /`展开全部 \$\{replies\.length\} 条回复`/);
  assert.match(
    postReaderCss,
    /\.discussion-comment-thread-toggle\s*{[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/s,
  );
});
