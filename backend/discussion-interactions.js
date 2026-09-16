const { canReadPost } = require('./discussion-visibility');
const { awardMagnetic } = require('./economy-rewards');

const schemaReady = new WeakMap();
const anonymousAuthor = () => ({
  id: null,
  uid: '',
  username: '匿名用户',
  fullName: '',
  displayName: '匿名用户',
  avatarPath: '',
});

async function ensureDiscussionInteractions(pool) {
  if (!schemaReady.has(pool)) {
    schemaReady.set(
      pool,
      (async () => {
        for (const [table, columns] of [
          ['discussion_posts', { is_anonymous: 'TINYINT(1) NOT NULL DEFAULT 0' }],
          [
            'discussion_comments',
            {
              is_deleted: 'TINYINT(1) NOT NULL DEFAULT 0',
              deleted_at: 'DATETIME NULL',
              deleted_by: 'BIGINT NULL',
              is_featured: 'TINYINT(1) NOT NULL DEFAULT 0',
              featured_by: 'BIGINT NULL',
              featured_at: 'DATETIME NULL',
            },
          ],
        ]) {
          const [existing] = await pool.execute(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
            [table],
          );
          for (const [column, definition] of Object.entries(columns)) {
            if (!existing.some((row) => row.COLUMN_NAME === column)) {
              try {
                await pool.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
              } catch (error) {
                if (error.code !== 'ER_DUP_FIELDNAME') throw error;
              }
            }
          }
        }
        await pool.execute(`CREATE TABLE IF NOT EXISTS discussion_comment_likes (
        comment_id BIGINT NOT NULL, user_id BIGINT NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (comment_id, user_id),
        CONSTRAINT fk_comment_likes_comment FOREIGN KEY (comment_id) REFERENCES discussion_comments(id) ON DELETE CASCADE,
        CONSTRAINT fk_comment_likes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`);
      })().catch((error) => {
        schemaReady.delete(pool);
        throw error;
      }),
    );
  }
  return schemaReady.get(pool);
}

// Retain redacted ancestors only when a surviving reply needs their position.
function visibleComments(comments) {
  const byId = new Map(comments.map((comment) => [Number(comment.id), comment]));
  const keep = new Set();
  comments
    .filter((comment) => !comment.isDeleted)
    .forEach((comment) => {
      let current = comment;
      while (current && !keep.has(Number(current.id))) {
        keep.add(Number(current.id));
        current = byId.get(Number(current.parentCommentId));
      }
    });
  return comments.filter((comment) => keep.has(Number(comment.id)));
}

function registerDiscussionInteractions(app, dependencies) {
  const {
    pool,
    requireAuth,
    requireAdmin,
    ensureDiscussionTables,
    withDatabaseTransaction,
    canModerateBoard,
    getDiscussionPostByPublicId,
    notifications,
  } = dependencies;
  const fail = (message, status) => Object.assign(new Error(message), { status });
  async function changeComment(request, response, deleting, featuring = false) {
    try {
      await ensureDiscussionTables();
      const user = await requireAuth(request, response);
      if (!user) return;
      const id = Number(request.params.id);
      if (!Number.isSafeInteger(id) || id <= 0) throw fail('评论不存在', 404);
      const [found] = await pool.execute('SELECT post_id FROM discussion_comments WHERE id = ?', [
        id,
      ]);
      if (!found[0]) throw fail('评论不存在', 404);
      const result = await withDatabaseTransaction(async (connection) => {
        // Use the same post -> comment lock order as reply creation/deletion.
        const [posts] = await connection.execute(
          'SELECT id, pid, title, board_id, is_deleted, is_hidden FROM discussion_posts WHERE id = ? FOR UPDATE',
          [found[0].post_id],
        );
        const post = posts[0];
        if (!post || post.is_deleted || post.is_hidden) throw fail('帖子不存在', 404);
        const [rows] = await connection.execute(
          'SELECT id, user_id, is_deleted, content_markdown FROM discussion_comments WHERE id = ? FOR UPDATE',
          [id],
        );
        const comment = rows[0];
        if (!comment || comment.is_deleted) throw fail('评论不存在或已删除', 404);
        if (featuring) {
          if (!(user.is_admin || user.role === 'admin'))
            throw fail('仅管理员可以设置精华回帖', 403);
          if (typeof request.body.featured !== 'boolean') throw fail('精华状态必须是布尔值', 400);
          const { featured } = request.body;
          await connection.execute(
            'UPDATE discussion_comments SET is_featured = ?, featured_by = ?, featured_at = IF(?, NOW(), NULL) WHERE id = ?',
            [featured ? 1 : 0, featured ? user.id : null, featured ? 1 : 0, id],
          );
          const reward = featured
            ? await awardMagnetic(connection, comment.user_id, `featured-comment:${id}`, 5)
            : 0;
          return { isFeatured: featured, reward };
        }
        if (deleting) {
          if (
            Number(comment.user_id) !== Number(user.id) &&
            !(await canModerateBoard(user, post.board_id))
          )
            throw fail('只能删除自己的评论；管理员和本版版主可管理评论', 403);
          await connection.execute(
            'UPDATE discussion_comments SET is_deleted = 1, deleted_at = NOW(), deleted_by = ? WHERE id = ?',
            [user.id, id],
          );
          await connection.execute('DELETE FROM discussion_comment_likes WHERE comment_id = ?', [
            id,
          ]);
          const [[count]] = await connection.execute(
            'SELECT COUNT(*) AS total FROM discussion_comments WHERE post_id = ? AND is_deleted = 0',
            [post.id],
          );
          return { deleted: true, commentCount: Number(count.total) };
        }
        const [existing] = await connection.execute(
          'SELECT user_id FROM discussion_comment_likes WHERE comment_id = ? AND user_id = ?',
          [id, user.id],
        );
        const active = !existing.length;
        if (active)
          await connection.execute(
            'INSERT INTO discussion_comment_likes (comment_id, user_id) VALUES (?, ?)',
            [id, user.id],
          );
        else
          await connection.execute(
            'DELETE FROM discussion_comment_likes WHERE comment_id = ? AND user_id = ?',
            [id, user.id],
          );
        await notifications.notifyCommentReaction(
          { actor: user, post, comment, active },
          connection,
        );
        if (active && Number(comment.user_id) !== Number(user.id))
          await awardMagnetic(
            connection,
            comment.user_id,
            `comment-like:${id}:${user.id}`,
            1,
            undefined,
            'community',
          );
        const [[count]] = await connection.execute(
          'SELECT COUNT(*) AS total FROM discussion_comment_likes WHERE comment_id = ?',
          [id],
        );
        return { active, likeCount: Number(count.total) };
      });
      response.json(result);
    } catch (error) {
      if (!error.status) console.error('Discussion comment action failed', error);
      response
        .status(error.status || 500)
        .json({ message: error.status ? error.message : '评论操作失败，请重试' });
    }
  }
  app.post('/api/discussion/comments/:id/like', (request, response) =>
    changeComment(request, response, false),
  );
  app.patch('/api/discussion/comments/:id/feature', (request, response) =>
    changeComment(request, response, false, true),
  );
  app.delete('/api/discussion/comments/:id', (request, response) =>
    changeComment(request, response, true),
  );
  app.get('/api/admin/discussion/posts/:id/author', async (request, response) => {
    try {
      const admin = await requireAdmin(request, response);
      if (!admin) return;
      await ensureDiscussionTables();
      const post = await getDiscussionPostByPublicId(request.params.id);
      if (!canReadPost(post, admin, true)) throw fail('帖子不存在', 404);
      const [rows] = await pool.execute(
        'SELECT u.id, u.uid, u.username, u.student_id FROM users u WHERE u.id = ?',
        [post.user_id],
      );
      response.set('Cache-Control', 'no-store').json({ author: rows[0] });
    } catch (error) {
      response
        .status(error.status || 500)
        .json({ message: error.status ? error.message : '读取发帖人失败' });
    }
  });
}
module.exports = {
  anonymousAuthor,
  ensureDiscussionInteractions,
  visibleComments,
  registerDiscussionInteractions,
};
