const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const { anonymousAuthor, visibleComments } = require('./discussion-interactions');

const source = fs.readFileSync(require.resolve('./server'), 'utf8');
const serializer = source.slice(
  source.indexOf('function toDiscussionPostSummary'),
  source.indexOf('async function getDiscussionCommentById'),
);
const context = vm.createContext({
  anonymousAuthor,
  config: { publicWebUrl: '' },
  getDiscussionPreview: (body) => ({ body }),
});
vm.runInContext(serializer, context);
const plain = (value) => JSON.parse(JSON.stringify(value));

test('public anonymous summaries and details strip all identity fields while preserving admin permissions', () => {
  const row = {
    id: 2,
    pid: 'p_example',
    title: '标题',
    content_markdown: '正文',
    is_anonymous: 1,
    user_id: 123,
    uid: 'u_private',
    username: 'private_username',
    full_name: 'private_name',
    avatar_path: '/private-avatar',
    author_student_id: 'private_student',
    can_delete: 1,
  };
  for (const render of [context.toDiscussionPostSummary, context.toDiscussionPostDetail]) {
    const post = plain(render(row));
    assert.equal(post.isAnonymous, true);
    assert.equal(post.canDelete, true);
    assert.deepEqual(post.author, anonymousAuthor());
    assert.doesNotMatch(JSON.stringify(post), /private|123/);
  }
  assert.equal(context.toDiscussionPostDetail({ ...row, is_anonymous: 0 }).author.uid, 'u_private');
});
test('deleted posts require the server reveal flag for original content and retain the deletion marker', () => {
  const row = { id: 1, title: '原始标题', content_markdown: '原始正文', is_deleted: 1 };
  assert.equal(context.toDiscussionPostDetail(row).contentMarkdown, '这篇帖子已被删除。');
  const revealed = context.toDiscussionPostDetail({ ...row, reveal_deleted: true });
  assert.equal(revealed.isDeleted, true);
  assert.equal(revealed.title, '原始标题');
  assert.equal(revealed.contentMarkdown, '原始正文');
  assert.equal(revealed.canDelete, false);
});
test('deleted comments redact content and identity and only retain ancestors of live replies', () => {
  const hidden = context.toDiscussionComment({
    id: 1,
    is_deleted: 1,
    content_markdown: 'secret',
    user_id: 10,
    username: 'secret',
    uid: 'u_secret',
    avatar_path: 'secret',
    like_count: 8,
    liked_by_me: 1,
    can_delete: 1,
  });
  assert.equal(hidden.contentMarkdown, '该评论已删除');
  assert.equal(hidden.author.id, null);
  assert.equal(hidden.likeCount, 0);
  assert.equal(hidden.canDelete, false);
  assert.doesNotMatch(JSON.stringify(hidden), /secret/);
  const comments = [
    { id: 1, isDeleted: true },
    { id: 2, parentCommentId: 1, isDeleted: true },
    { id: 3, parentCommentId: 2, isDeleted: false },
    { id: 4, isDeleted: true },
  ];
  const before = structuredClone(comments);
  assert.deepEqual(
    visibleComments(comments).map((c) => c.id),
    [1, 2, 3],
  );
  assert.deepEqual(visibleComments(comments.map((c) => ({ ...c, isDeleted: true }))), []);
  assert.deepEqual(comments, before);
});
