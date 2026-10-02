const { createHash } = require('node:crypto');

const OVERRIDE_TABLE = `CREATE TABLE IF NOT EXISTS campus_schedule_overrides (
  user_id BIGINT NOT NULL,
  connector_generation INT UNSIGNED NOT NULL,
  public_id VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  patch_json JSON NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 2,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, connector_generation, public_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
)`;

async function loadOverrides(pool, userId, generation = null) {
  if (generation !== null) {
    const [rows] = await pool.execute(
      `SELECT o.public_id, o.patch_json, o.version, o.updated_at, o.connector_generation
       FROM campus_schedule_overrides o WHERE o.user_id = ? AND o.connector_generation = ?`,
      [userId, generation],
    );
    return new Map(rows.map((row) => [row.public_id, row]));
  }
  const [rows] = await pool.execute(
    `SELECT o.public_id, o.patch_json, o.version, o.updated_at, o.connector_generation
     FROM campus_schedule_overrides o
     INNER JOIN user_campus_connectors c ON c.user_id = o.user_id
       AND c.provider = 'tsinghua-learn' AND c.generation = o.connector_generation
     WHERE o.user_id = ? AND c.status IN ('active_verified', 'active_unverified', 'reauthorization_required')`,
    [userId],
  );
  return new Map(rows.map((row) => [row.public_id, row]));
}

async function loadCourseOverrides(pool, userId) {
  const [rows] = await pool.execute(
    `SELECT o.public_id, o.patch_json, o.version, o.updated_at, o.connector_generation
     FROM campus_schedule_overrides o WHERE o.user_id = ? AND LEFT(o.public_id, 3) = 'cs_'
       AND o.connector_generation > 0 ORDER BY o.version, o.updated_at, o.connector_generation`,
    [userId],
  );
  // Stable occurrence IDs include semester/course/week/section. Personal edits
  // belong to the local user and survive renewing the upstream credential.
  return new Map(rows.map((row) => [row.public_id, row]));
}

function applyOverride(event, row) {
  const patch = row
    ? typeof row.patch_json === 'string'
      ? JSON.parse(row.patch_json)
      : row.patch_json
    : {};
  if (patch?.deleted) return null;
  // This fingerprint covers upstream data and binding identity, not only the override version.
  const sourceRevision = createHash('sha256').update(JSON.stringify(event)).digest('hex');
  const allowed = {};
  for (const field of ['title', 'description', 'startAt', 'endAt', 'allDay', 'timezone'])
    if (Object.hasOwn(patch || {}, field)) allowed[field] = patch[field];
  return {
    ...event,
    ...allowed,
    sourceRevision,
    editable: true,
    version: row?.version || 1,
    personallyEdited: Boolean(row),
    updatedAt: row?.updated_at || event.updatedAt,
  };
}

function makePatch(existing, body, previous = {}) {
  const fail = (message) => {
    throw Object.assign(new Error(message), { status: 400 });
  };
  const patch = { ...previous };
  for (const field of Object.keys(body)) {
    if (
      ![
        'title',
        'description',
        'startAt',
        'endAt',
        'allDay',
        'timezone',
        'version',
        'sourceRevision',
      ].includes(field)
    )
      fail('同步日程只支持修改标题、备注和时间');
  }
  for (const [field, max, required] of [
    ['title', 200, true],
    ['description', 4000, false],
  ]) {
    if (!Object.hasOwn(body, field)) continue;
    if (
      typeof body[field] !== 'string' ||
      body[field].length > max ||
      (required && !body[field].trim())
    )
      fail('标题或地点/备注无效');
    const value = body[field].trim();
    if (value !== existing[field]) patch[field] = value;
  }
  const next = { ...existing };
  for (const field of ['startAt', 'endAt']) {
    if (!Object.hasOwn(body, field)) continue;
    const date = new Date(body[field]);
    if (
      typeof body[field] !== 'string' ||
      !/T.*(?:Z|[+-]\d\d:\d\d)$/.test(body[field]) ||
      !Number.isFinite(date.getTime()) ||
      date.getUTCFullYear() < 2000 ||
      date.getUTCFullYear() > 2200
    )
      fail('请输入有效的开始和结束时间');
    next[field] = date.toISOString();
    if (next[field] !== existing[field]) patch[field] = next[field];
  }
  if (new Date(next.endAt) <= new Date(next.startAt)) fail('结束时间必须晚于开始时间');
  if (existing.kind === 'deadline' && new Date(next.endAt) - new Date(next.startAt) !== 60000)
    fail('DDL 请设置一个准确的截止时间');
  if (Object.hasOwn(body, 'allDay') && body.allDay !== false) fail('同步课程和 DDL 需要准确时间');
  if (Object.hasOwn(body, 'timezone') && body.timezone !== 'Asia/Shanghai')
    fail('同步日程使用北京时间');
  return patch;
}

async function editImportedSchedule(pool, userId, publicId, body, { remove = false } = {}) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    // Serialize edits with rebinding/revocation. Source data is re-read inside this transaction.
    await connection.execute(
      `SELECT generation FROM user_campus_connectors WHERE user_id = ? AND provider = 'tsinghua-learn' FOR UPDATE`,
      [userId],
    );
    const range = {
      start: new Date('2000-01-01T00:00:00Z'),
      end: new Date('2201-01-01T00:00:00Z'),
    };
    // Lazy imports avoid a projection/override module cycle.
    const items = publicId.startsWith('cs_')
      ? await require('./course-schedule').listCourseSchedules(connection, userId, range)
      : await require('./homework-schedule').listHomeworkDeadlines(connection, userId, range);
    const existing = items.find((item) => item.publicId === publicId);
    if (!existing) throw Object.assign(new Error('同步日程不存在，请刷新课表'), { status: 404 });
    if (body.version !== existing.version || body.sourceRevision !== existing.sourceRevision)
      throw Object.assign(new Error('日程或课程源信息已更新，请刷新后重试'), { status: 409 });
    const previous = (
      publicId.startsWith('cs_')
        ? await loadCourseOverrides(connection, userId)
        : await loadOverrides(connection, userId, existing.connectorGeneration)
    ).get(publicId);
    const previousPatch = previous
      ? typeof previous.patch_json === 'string'
        ? JSON.parse(previous.patch_json)
        : previous.patch_json
      : {};
    const patch = remove
      ? { ...previousPatch, deleted: true, seriesManaged: false }
      : { ...makePatch(existing, body, previousPatch), seriesManaged: false };
    await connection.execute(
      `INSERT INTO campus_schedule_overrides (user_id, connector_generation, public_id, patch_json, version)
       VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE patch_json = VALUES(patch_json),
         version = VALUES(version), updated_at = CURRENT_TIMESTAMP`,
      [userId, existing.connectorGeneration, publicId, JSON.stringify(patch), existing.version + 1],
    );
    await connection.commit();
    return { ...existing, ...patch, personallyEdited: true, version: existing.version + 1 };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  OVERRIDE_TABLE,
  loadOverrides,
  loadCourseOverrides,
  applyOverride,
  makePatch,
  editImportedSchedule,
};
