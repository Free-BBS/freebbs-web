// Keep notification previews independent of the submitted text, risk labels and reasons.
// A person who is both author and reviewer receives separate notices for each role.
async function sendModerationNotice(db, notifications, data) {
  const recipients = [...new Set(data.recipients.map(Number))]
    .filter((id) => Number.isSafeInteger(id) && id > 0)
    .sort((a, b) => a - b);
  if (!recipients.length) return;
  if (notifications?.notifyModeration)
    return notifications.notifyModeration({ ...data, recipients }, db);
  for (const recipient of recipients)
    await db.execute(
      `INSERT INTO community_notifications
       (recipient_id, actor_id, kind, title, body, link, event_key)
       VALUES (?, NULL, 'moderation', ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
      [recipient, data.title, data.body, data.link, data.eventKey],
    );
}

async function notifyAuthor(db, notifications, { id, authorId, status, publishedUrl = '' }) {
  if (!authorId) return;
  const link = `/moderation?mine=1&id=${encodeURIComponent(id)}`;
  if (status === 'approved') {
    // Never insert a successful-publication notice or enqueue email. Updating only these
    // fields also preserves the original timestamp and read/unread state.
    await db.execute(
      `UPDATE community_notifications SET title = ?, body = ?, link = ?
       WHERE recipient_id = ? AND kind = 'moderation' AND event_key = ?`,
      [
        '内容已发布',
        '你提交的内容已发布，可点击查看。',
        publishedUrl || link,
        Number(authorId),
        `moderation-author:${id}:pending`,
      ],
    );
    return;
  }
  const wording = {
    pending: ['内容正在等待处理', '你提交的内容需要工作人员确认，处理完成后可在此查看状态。'],
    rejected: [
      '内容未通过',
      '你提交的内容未能发布。请查看处理详情及说明；如有异议，可联系网站管理员。',
    ],
    withdrawn: [
      '已发布的内容已撤回',
      '你提交的内容已被撤回。请查看处理详情及说明；如有异议，可联系网站管理员。',
    ],
    expired: ['内容处理材料已到期', '相关材料已到期，请查看处理详情；如仍需发布，可重新提交。'],
  }[status];
  if (!wording) return;
  if (status !== 'pending')
    // Keep the earlier waiting/published card accurate, while the new terminal
    // event below still gives the author an unread rejection/withdrawal notice.
    await db.execute(
      `UPDATE community_notifications SET title = ?, body = ?, link = ?
       WHERE recipient_id = ? AND kind = 'moderation' AND event_key = ?`,
      [...wording, link, Number(authorId), `moderation-author:${id}:pending`],
    );
  await sendModerationNotice(db, notifications, {
    submissionId: id,
    status,
    recipients: [authorId],
    title: wording[0],
    body: wording[1],
    link,
    eventKey: `moderation-author:${id}:${status}`,
  });
}

module.exports = { sendModerationNotice, notifyAuthor };
