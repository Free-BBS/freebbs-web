function activityWindow(now = new Date()) {
  const end = new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
  const start = new Date(`${end}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 364);
  return { start: start.toISOString().slice(0, 10), end };
}

async function loadProfileActivity(pool, userId, now) {
  const { start, end } = activityWindow(now);
  // UNIX_TIMESTAMP interprets DATETIME in the writing session's timezone.
  // Epoch arithmetic avoids dependence on optional MySQL named-timezone tables.
  const day = (column) =>
    `DATE_FORMAT(DATE_ADD('1970-01-01', INTERVAL (UNIX_TIMESTAMP(${column}) + 28800) SECOND), '%Y-%m-%d')`;
  const visible =
    'p.is_deleted = 0 AND p.is_hidden = 0 AND p.login_required = 0 AND p.is_anonymous = 0';
  const bounds = (column) => `${column} >= FROM_UNIXTIME(?) AND ${column} < FROM_UNIXTIME(?)`;
  const queries = [
    [
      "SELECT DATE_FORMAT(checkin_date, '%Y-%m-%d') AS day, COUNT(*) AS count FROM user_checkins WHERE user_id = ? AND checkin_date BETWEEN ? AND ? GROUP BY checkin_date",
      'checkins',
    ],
    [
      `SELECT ${day('p.created_at')} AS day, COUNT(*) AS count FROM discussion_posts p WHERE p.user_id = ? AND ${visible} AND ${bounds('p.created_at')} GROUP BY day`,
      'posts',
    ],
    [
      `SELECT ${day('c.created_at')} AS day, COUNT(*) AS count FROM discussion_comments c INNER JOIN discussion_posts p ON p.id = c.post_id WHERE c.user_id = ? AND c.is_deleted = 0 AND ${visible} AND ${bounds('c.created_at')} GROUP BY day`,
      'comments',
    ],
  ];
  const days = new Map();
  await Promise.all(
    queries.map(async ([sql, kind]) => {
      const dates =
        kind === 'checkins'
          ? [start, end]
          : [
              Date.parse(`${start}T00:00:00+08:00`) / 1000,
              Date.parse(`${end}T00:00:00+08:00`) / 1000 + 86400,
            ];
      const [rows] = await pool.execute(sql, [userId, ...dates]);
      for (const row of rows) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(row.day) || row.day < start || row.day > end) continue;
        const value = days.get(row.day) || {
          date: row.day,
          checkins: 0,
          posts: 0,
          comments: 0,
          count: 0,
        };
        const count = Math.max(0, Number(row.count) || 0);
        value[kind] += count;
        value.count += count;
        days.set(row.day, value);
      }
    }),
  );
  return {
    start,
    end,
    timezone: 'Asia/Shanghai',
    days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

module.exports = { activityWindow, loadProfileActivity };
