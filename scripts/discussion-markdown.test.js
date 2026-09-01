const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { marked } = require('marked');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const functionStart = appSource.indexOf('function protectMarkdownMath');
const functionEnd = appSource.indexOf('\n\nfunction renderMarkdownContent', functionStart);
const functionSource = appSource.slice(functionStart, functionEnd);

function protect(markdown) {
  const context = { markdown };
  vm.runInNewContext(
    `${functionSource}\nresult = protectMarkdownMath(markdown, 'MATH_TOKEN_');`,
    context,
  );
  return context.result;
}

test('讨论区在 Markdown 解析前保护四种 KaTeX 分隔符', () => {
  const result = protect(
    String.raw`行内 $E=mc^2$ 与 \(a^2+b^2=c^2\)。

块级：
$$\int_0^1 x^2\,dx$$

\[f(E)=\frac{1}{e^{(E-\mu)/(k_B T)}+1}\]`,
  );

  assert.equal(result.mathBlocks.length, 4);
  assert.deepEqual(
    Array.from(result.mathBlocks, ({ displayMode, expression }) => ({
      displayMode,
      expression,
    })),
    [
      { displayMode: true, expression: String.raw`\int_0^1 x^2\,dx` },
      {
        displayMode: true,
        expression: String.raw`f(E)=\frac{1}{e^{(E-\mu)/(k_B T)}+1}`,
      },
      { displayMode: false, expression: 'E=mc^2' },
      { displayMode: false, expression: 'a^2+b^2=c^2' },
    ],
  );

  const rendered = marked.parse(result.protectedMarkdown);
  for (let index = 0; index < result.mathBlocks.length; index += 1) {
    assert.match(rendered, new RegExp(`MATH_TOKEN_${index}`));
  }
  assert.doesNotMatch(rendered, /\\[()[\]]/);
});

test('讨论区明亮模式下的深色代码框使用浅色文字', () => {
  const discussionHtml = fs.readFileSync(path.join(root, 'public', 'discussion.html'), 'utf8');
  const discussionStyles = fs.readFileSync(path.join(root, 'public', 'discussion.css'), 'utf8');

  assert.ok(
    discussionHtml.indexOf('/discussion.css') > discussionHtml.indexOf('/ui-polish.css'),
    'discussion.css must load after shared theme styles',
  );
  assert.match(
    discussionStyles,
    /body\.theme-light\.discussion-page[\s\S]*?\.discussion-markdown-body pre code \*[\s\S]*?color:\s*#edf7f8 !important;/,
  );
});

test('切回已有哈希的分区时恢复该分区缓存，而不是保留当前分区帖子', () => {
  const cacheFunctionStart = appSource.indexOf('function applyDiscussionPostsPayload');
  const cacheFunctionEnd = appSource.indexOf(
    '\n\nfunction getDiscussionVisiblePosts',
    cacheFunctionStart,
  );
  const cacheFunctionSource = appSource.slice(cacheFunctionStart, cacheFunctionEnd);
  const discussionState = {
    posts: [],
    postsByBoard: new Map(),
    postsHashByBoard: {},
    postCache: new Map(),
  };
  const context = { discussionState };

  vm.runInNewContext(cacheFunctionSource, context);
  context.applyDiscussionPostsPayload('upper', {
    posts: [{ id: 'upper-post', title: '上方分区' }],
    hash: 'upper-hash',
  });
  context.applyDiscussionPostsPayload('lower', {
    posts: [{ id: 'lower-post', title: '下方分区' }],
    hash: 'lower-hash',
  });
  context.applyDiscussionPostsPayload('upper', { notModified: true });

  assert.equal(discussionState.posts[0].id, 'upper-post');
  assert.equal(discussionState.postsHashByBoard.upper, 'upper-hash');
});

test('讨论区帖子请求只允许最新一次切换更新页面', () => {
  assert.match(appSource, /postsRequestId:\s*0/);
  assert.match(appSource, /if \(requestId !== discussionState\.postsRequestId\) \{\s*return;\s*\}/);
});

test('切换版块时只显示目标缓存，未缓存时显示加载态', () => {
  const restoreFunctionStart = appSource.indexOf('function restoreDiscussionBoardPosts');
  const restoreFunctionEnd = appSource.indexOf(
    '\n\nfunction updateCachedDiscussionPost',
    restoreFunctionStart,
  );
  const restoreFunctionSource = appSource.slice(restoreFunctionStart, restoreFunctionEnd);
  const discussionState = {
    posts: [{ id: 'previous-board-post' }],
    postsByBoard: new Map([['target', [{ id: 'target-post' }]]]),
  };
  const discussionPostList = { innerHTML: '' };
  let renders = 0;
  const context = {
    discussionState,
    discussionPostList,
    renderDiscussionPosts() {
      renders += 1;
    },
  };

  vm.runInNewContext(restoreFunctionSource, context);
  context.restoreDiscussionBoardPosts('target');
  assert.deepEqual(discussionState.posts, [{ id: 'target-post' }]);
  assert.equal(renders, 1);

  context.restoreDiscussionBoardPosts('uncached');
  assert.deepEqual(Array.from(discussionState.posts), []);
  assert.match(discussionPostList.innerHTML, /正在加载帖子/);
});

test('置顶和精华状态同步所有帖子缓存并使哈希失效', () => {
  const updateFunctionStart = appSource.indexOf('function updateCachedDiscussionPost');
  const updateFunctionEnd = appSource.indexOf(
    '\n\nfunction getDiscussionVisiblePosts',
    updateFunctionStart,
  );
  const updateFunctionSource = appSource.slice(updateFunctionStart, updateFunctionEnd);
  const discussionState = {
    postsByBoard: new Map([
      ['all', [{ id: 'post-1', isPinned: false, isFeatured: false }]],
      ['signals', [{ id: 'post-1', isPinned: false, isFeatured: false }]],
      ['other', [{ id: 'post-2', isPinned: false }]],
    ]),
    postsHashByBoard: { all: 'all-hash', signals: 'signals-hash', other: 'other-hash' },
    postCache: new Map([['post-1', { id: 'post-1', isPinned: false }]]),
  };
  const context = { discussionState };

  vm.runInNewContext(updateFunctionSource, context);
  context.updateCachedDiscussionPost('post-1', { isPinned: true, isFeatured: true });

  assert.equal(discussionState.postsByBoard.get('all')[0].isPinned, true);
  assert.equal(discussionState.postsByBoard.get('signals')[0].isFeatured, true);
  assert.equal(discussionState.postCache.get('post-1').isPinned, true);
  assert.equal(Object.hasOwn(discussionState.postsHashByBoard, 'all'), false);
  assert.equal(Object.hasOwn(discussionState.postsHashByBoard, 'signals'), false);
  assert.equal(discussionState.postsHashByBoard.other, 'other-hash');
});
