const { canReadPost } = require('./discussion-visibility');

const fail = (message, status = 409) => Object.assign(new Error(message), { status });

// Called only inside the decision transaction. Pending drafts never enter the
// public discussion tables, so existing readers cannot expose an unreviewed draft.
function createModerationPublisher({ createPostPid, awardMagnetic, notifications }) {
  return async function publishSubmission(connection, submission) {
    const { kind, authorId, payload } = submission;
    const [[author]] = await connection.execute(
      'SELECT id, username, full_name, student_id, is_admin FROM users WHERE id = ? FOR SHARE',
      [authorId],
    );
    if (!author) throw fail('作者账号已不存在，不能发布');

    if (kind === 'post') {
      const [[board]] = await connection.execute(
        'SELECT id, slug, is_active FROM discussion_boards WHERE id = ? FOR SHARE',
        [payload.boardId],
      );
      if (!board?.is_active) throw fail('讨论版块已停用，不能发布');
      if (board.slug === 'changelog' && !author.is_admin) throw fail('作者已没有更新日志发帖权限');
      if (payload.anonymous && board.slug !== 'daily') throw fail('该版块不支持匿名发帖');
      const pid = await createPostPid(connection);
      const [created] = await connection.execute(
        `INSERT INTO discussion_posts
           (pid, board_id, user_id, author_student_id, title, content_markdown, is_anonymous, login_required)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          pid,
          board.id,
          author.id,
          author.student_id,
          payload.title,
          payload.content,
          payload.anonymous ? 1 : 0,
          payload.loginRequired ? 1 : 0,
        ],
      );
      await awardMagnetic(
        connection,
        author.id,
        `post:${created.insertId}`,
        1,
        undefined,
        'community',
      );
      if (!payload.anonymous) {
        await notifications.notifyMentions(
          {
            actor: author,
            post: { id: created.insertId, pid, title: payload.title, user_id: author.id },
            contentMarkdown: payload.content,
          },
          connection,
        );
      }
      return {
        publishedId: created.insertId,
        publishedUrl: `/discussion?post=${encodeURIComponent(pid)}`,
      };
    }

    if (kind !== 'comment') throw fail('不支持的审核内容类型', 400);
    const [[post]] = await connection.execute(
      `SELECT id, pid, board_id, title, user_id, is_anonymous, is_deleted, is_hidden, login_required
       FROM discussion_posts WHERE id = ? FOR UPDATE`,
      [payload.postId],
    );
    if (!canReadPost(post, author) || Number(post.is_hidden))
      throw fail('原帖已删除或不可见，不能发布评论');
    let parentAuthorId = null;
    if (payload.parentCommentId) {
      const [[parent]] = await connection.execute(
        `SELECT id, user_id FROM discussion_comments
         WHERE id = ? AND post_id = ? AND is_deleted = 0 FOR UPDATE`,
        [payload.parentCommentId, post.id],
      );
      if (!parent) throw fail('被回复的评论已删除，不能发布');
      parentAuthorId = parent.user_id;
    }
    const [created] = await connection.execute(
      `INSERT INTO discussion_comments
         (post_id, parent_comment_id, user_id, author_student_id, content_markdown)
       VALUES (?, ?, ?, ?, ?)`,
      [post.id, payload.parentCommentId || null, author.id, author.student_id, payload.content],
    );
    await notifications.notifyReply(
      {
        actor: author,
        post,
        commentId: created.insertId,
        parentAuthorId,
        contentMarkdown: payload.content,
      },
      connection,
    );
    await notifications.notifyMentions(
      {
        actor: author,
        post,
        commentId: created.insertId,
        contentMarkdown: payload.content,
        excludeUserIds: [post.user_id, parentAuthorId],
      },
      connection,
    );
    return {
      publishedId: created.insertId,
      publishedUrl: `/discussion?post=${encodeURIComponent(post.pid || post.id)}#comment-${created.insertId}`,
    };
  };
}

module.exports = { createModerationPublisher };
