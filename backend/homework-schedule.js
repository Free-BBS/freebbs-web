// Calendar reminders are projections of the latest homework snapshots. Only the
// student's completion override is stored, so syncing cannot duplicate reminders.
async function loadHomework(pool, userId) {
  const [rows] = await pool.execute(
    `SELECT s.homework_json, s.fetched_at FROM campus_homework_snapshots s
     INNER JOIN user_campus_connectors c ON c.user_id = s.user_id
       AND c.generation = s.connector_generation AND c.provider = 'tsinghua-learn'
     WHERE s.user_id = ? AND c.status IN
       ('active_verified', 'active_unverified', 'reauthorization_required')
     ORDER BY s.fetched_at DESC`,
    [userId],
  );
  const items = new Map();
  for (const row of rows) {
    const parsed =
      typeof row.homework_json === 'string' ? JSON.parse(row.homework_json) : row.homework_json;
    for (const item of Array.isArray(parsed) ? parsed : []) {
      if (item.sourceReference && !items.has(item.sourceReference)) {
        items.set(item.sourceReference, { ...item, fetchedAt: row.fetched_at });
      }
    }
  }
  return items;
}

async function listHomeworkDeadlines(pool, userId, range, status = '') {
  if (status && !['confirmed', 'completed'].includes(status)) return [];
  const items = await loadHomework(pool, userId);
  if (!items.size) return [];
  const [states] = await pool.execute(
    'SELECT homework_reference, completed FROM campus_homework_calendar_states WHERE user_id = ?',
    [userId],
  );
  const overrides = new Map(states.map((row) => [row.homework_reference, Boolean(row.completed)]));
  const result = [];
  for (const item of items.values()) {
    const due = new Date(item.dueAt);
    if (
      !item.dueAt ||
      item.deadlineUnverified ||
      !Number.isFinite(due.getTime()) ||
      due < range.start ||
      due >= range.end
    )
      continue;
    const completed =
      overrides.get(item.sourceReference) ?? ['submitted', 'graded'].includes(item.status);
    const calendarStatus = completed ? 'completed' : 'confirmed';
    if (status && status !== calendarStatus) continue;
    result.push({
      publicId: `hw:${item.sourceReference}`,
      homeworkReference: item.sourceReference,
      title: item.title,
      description: item.description || '',
      startAt: new Date(due.getTime() - 60000).toISOString(),
      endAt: due.toISOString(),
      allDay: false,
      timezone: 'Asia/Shanghai',
      kind: 'deadline',
      sourceType: 'network_classroom',
      status: calendarStatus,
      completed,
      updatedAt: item.fetchedAt,
    });
  }
  return result;
}

async function setHomeworkCompletion(pool, userId, reference, completed) {
  const items = await loadHomework(pool, userId);
  if (!items.has(reference)) return false;
  await pool.execute(
    `INSERT INTO campus_homework_calendar_states (user_id, homework_reference, completed)
     VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE completed = VALUES(completed)`,
    [userId, reference, completed ? 1 : 0],
  );
  return true;
}

module.exports = { listHomeworkDeadlines, setHomeworkCompletion };
