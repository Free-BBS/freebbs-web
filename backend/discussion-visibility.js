// The author is the only reader of a hidden post; administrators have no bypass.
function canReadPost(post, user) {
  return Boolean(
    post &&
    !Number(post.is_deleted) &&
    (!Number(post.is_hidden) || (user?.id && Number(post.user_id) === Number(user.id))),
  );
}

function postUnavailable() {
  return Object.assign(new Error('帖子不存在或暂不可见'), { status: 404 });
}

async function lockPublicPost(connection, id) {
  const [rows] = await connection.execute(
    'SELECT id, user_id, is_deleted, is_hidden FROM discussion_posts WHERE id = ? FOR UPDATE',
    [id],
  );
  if (!canReadPost(rows[0], null)) throw postUnavailable();
  return rows[0];
}

// Remove old title/comment snapshots without deleting notification history.
// Already delivered emails or content someone has previously read cannot be recalled.
async function redactPostNotifications(connection, post) {
  await connection.execute(
    `UPDATE community_notifications
     SET title = '讨论状态已更新', body = '这篇讨论已删除或暂不可见。', link = '/discussion'
     WHERE kind IN ('reply', 'reaction') AND link LIKE '/discussion?post=%'
       AND SUBSTRING_INDEX(SUBSTRING_INDEX(link, 'post=', -1), '#', 1) IN (?, ?)`,
    [encodeURIComponent(post.pid || String(post.id)), String(post.id)],
  );
}

async function setPostVisibility(connection, post, user, hidden) {
  if (typeof hidden !== 'boolean') {
    throw Object.assign(new Error('隐藏状态必须为布尔值'), { status: 400 });
  }
  const [rows] = await connection.execute(
    'SELECT id, pid, user_id, is_deleted, is_hidden FROM discussion_posts WHERE id = ? FOR UPDATE',
    [post.id],
  );
  const current = rows[0];
  if (!canReadPost(current, user) || Number(current.user_id) !== Number(user?.id)) {
    throw postUnavailable();
  }
  await connection.execute(
    `UPDATE discussion_posts SET is_hidden = ?, updated_at = NOW(),
       is_pinned = 0, pinned_at = NULL, pinned_by = NULL,
       is_featured = 0, featured_at = NULL, featured_by = NULL
     WHERE id = ?`,
    [hidden ? 1 : 0, current.id],
  );
  if (hidden) await redactPostNotifications(connection, current);
  return { ok: true, isHidden: hidden };
}

async function deleteVisiblePost(connection, post, user) {
  const [rows] = await connection.execute(
    'SELECT id, pid, user_id, is_deleted, is_hidden FROM discussion_posts WHERE id = ? FOR UPDATE',
    [post.id],
  );
  if (!canReadPost(rows[0], user)) throw postUnavailable();
  await connection.execute(
    `UPDATE discussion_posts SET is_deleted = 1, deleted_at = NOW(), deleted_by = ?,
       is_pinned = 0, pinned_at = NULL, pinned_by = NULL,
       is_featured = 0, featured_at = NULL, featured_by = NULL WHERE id = ?`,
    [user.id, post.id],
  );
  await redactPostNotifications(connection, rows[0]);
}

module.exports = { canReadPost, lockPublicPost, setPostVisibility, deleteVisiblePost };
