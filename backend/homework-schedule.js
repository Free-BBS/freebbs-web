const { loadOverrides, applyOverride } = require('./campus-schedule-overrides');
// Source snapshots remain read-only; personal edits are stored separately.
async function loadHomework(pool, userId) {
  const [rows] = await pool.execute(
    `SELECT s.homework_json, s.fetched_at, s.connector_generation FROM campus_homework_snapshots s
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
        items.set(item.sourceReference, {
          ...item,
          fetchedAt: row.fetched_at,
          connectorGeneration: Number(row.connector_generation),
        });
      }
    }
  }
  return items;
}

async function listHomeworkDeadlines(pool, userId, range, status = '') {
  if (status && !['confirmed', 'completed'].includes(status)) return [];
  const items = await loadHomework(pool, userId);
  if (!items.size) return [];
  const personalEdits = await loadOverrides(pool, userId);
  const [states] = await pool.execute(
    'SELECT homework_reference, completed FROM campus_homework_calendar_states WHERE user_id = ?',
    [userId],
  );
  const overrides = new Map(states.map((row) => [row.homework_reference, Boolean(row.completed)]));
  const result = [];
  for (const item of items.values()) {
    const due = new Date(item.dueAt);
    if (!item.dueAt || item.deadlineUnverified || !Number.isFinite(due.getTime())) continue;
    const completed =
      overrides.get(item.sourceReference) ?? ['submitted', 'graded'].includes(item.status);
    const calendarStatus = completed ? 'completed' : 'confirmed';
    if (status && status !== calendarStatus) continue;
    const event = applyOverride(
      {
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
        connectorGeneration: item.connectorGeneration,
      },
      personalEdits.get(`hw:${item.sourceReference}`),
    );
    if (event && new Date(event.endAt) >= range.start && new Date(event.endAt) < range.end)
      result.push(event);
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
