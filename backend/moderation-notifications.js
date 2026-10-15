const FOCUSED_REVIEW_NOTICE = Object.freeze({
  title: '讨论内容须负责人重点复核',
  body: '该内容需要专门人工审核，负责人通过前不发布。请到审核工作台查看具体提示。',
});
const LEGACY_FOCUS_TITLES = [
  '【政治内容】须负责人重点复核',
  '【心理关怀】须负责人重点复核',
  '【政治内容／心理关怀】须负责人重点复核',
];
const AUTOMATIC_REVIEW_EVENT =
  /^moderation-auto:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}:(review|blocked)$/;

// Old notifications can outlive the evidence, including already-purged jobs. Hide their
// copied topic labels immediately on read, even if the cleanup worker has not run yet.
function moderationNotificationPreview(row) {
  if (
    row.kind === 'moderation' &&
    AUTOMATIC_REVIEW_EVENT.test(row.event_key || '') &&
    LEGACY_FOCUS_TITLES.includes(row.title)
  )
    return FOCUSED_REVIEW_NOTICE;
  return { title: row.title, body: row.body };
}

async function purgeLegacyModerationNotificationTopics(db) {
  // Only replace the preview: keep its audience, link, timestamp and read/unread state.
  await db.execute(
    `UPDATE community_notifications SET title = ?, body = ?
     WHERE kind = 'moderation' AND event_key REGEXP ? AND title IN (?, ?, ?)`,
    [
      FOCUSED_REVIEW_NOTICE.title,
      FOCUSED_REVIEW_NOTICE.body,
      AUTOMATIC_REVIEW_EVENT.source,
      ...LEGACY_FOCUS_TITLES,
    ],
  );
}

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

module.exports = {
  sendModerationNotice,
  notifyAuthor,
  FOCUSED_REVIEW_NOTICE,
  moderationNotificationPreview,
  purgeLegacyModerationNotificationTopics,
};
