const { createHash, randomBytes } = require('node:crypto');
const { expand } = require('../public/schedule-recurrence');

const SERIES_TABLE = `CREATE TABLE IF NOT EXISTS schedule_series (
  user_id BIGINT NOT NULL,
  series_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  definition_json JSON NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, series_key),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
)`;
const FULL_RANGE = {
  start: new Date('2000-01-01T00:00:00Z'),
  end: new Date('2201-01-01T00:00:00Z'),
};
const iso = (value) => new Date(value).toISOString();
const json = (value) => (typeof value === 'string' ? JSON.parse(value) : value);
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
const manualKey = (key) => /^manual:(?:course|recurring):[a-f0-9]+$/.test(key || '');
const dayKey = (value) => iso(Date.parse(value) + 8 * 3600000).slice(0, 10);

function importedSeriesKey(event) {
  // A course can have several weekly slots. Keep each original slot independent.
  const start = new Date(Date.parse(event.startAt) + 8 * 3600000);
  const key = JSON.stringify([
    event.semesterId,
    event.courseReference,
    start.getUTCDay(),
    event.sectionStart || start.toISOString().slice(11, 16),
    event.sectionEnd || new Date(Date.parse(event.endAt) + 8 * 3600000).toISOString().slice(11, 16),
  ]);
  return `campus:${createHash('sha256').update(key).digest('hex').slice(0, 32)}`;
}

function definitionFor(items, recurrence = null, imported = false) {
  return {
    recurrence: recurrence ? { ...recurrence } : null,
    recurrenceStartAt: items[0]?.originalStartAt || items[0]?.startAt || null,
    imported,
    occurrences: items.map((item) => ({
      publicId: item.publicId,
      startAt: item.originalStartAt || item.startAt,
      endAt: item.originalEndAt || item.endAt,
    })),
  };
}

async function writeDefinition(connection, userId, key, definition, version = 1) {
  await connection.execute(
    `INSERT INTO schedule_series (user_id, series_key, definition_json, version)
     VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE definition_json = VALUES(definition_json),
       version = VALUES(version), updated_at = CURRENT_TIMESTAMP`,
    [userId, key, JSON.stringify(definition), version],
  );
}

function toManual(row) {
  return {
    publicId: row.public_id,
    seriesKey: row.source_reference,
    title: row.title,
    description: row.description || '',
    startAt: iso(row.start_at),
    endAt: iso(row.end_at),
    allDay: Boolean(row.all_day),
    kind: row.source_reference?.startsWith('manual:course:') ? 'course' : 'event',
    version: Number(row.version),
    deleted: Boolean(row.deleted_at),
    exception: Boolean(row.user_overridden_at),
  };
}

async function readSeries(connection, userId, publicId) {
  let items;
  let key;
  let selected;
  const imported = publicId.startsWith('cs_');
  if (imported) {
    const { listCourseSchedules } = require('./course-schedule');
    const all = await listCourseSchedules(connection, userId, FULL_RANGE, '', {
      includeDeleted: true,
    });
    selected = all.find((item) => item.publicId === publicId && !item.deleted);
    if (!selected) fail(404, '课程安排不存在，请刷新计划表');
    key = selected.seriesKey;
    items = all.filter((item) => item.seriesKey === key);
  } else {
    const [rows] = await connection.execute(
      `SELECT * FROM schedule_items WHERE public_id = ? AND user_id = ? AND deleted_at IS NULL`,
      [publicId, userId],
    );
    if (!rows[0]) fail(404, '日程不存在');
    if (!manualKey(rows[0].source_reference)) return null;
    key = rows[0].source_reference;
    const [seriesRows] = await connection.execute(
      `SELECT * FROM schedule_items WHERE user_id = ? AND source_reference = ? ORDER BY start_at, public_id`,
      [userId, key],
    );
    items = seriesRows.map(toManual);
    selected = items.find((item) => item.publicId === publicId);
  }
  const [rows] = await connection.execute(
    `SELECT definition_json, version FROM schedule_series WHERE user_id = ? AND series_key = ?`,
    [userId, key],
  );
  const definition = rows[0] ? json(rows[0].definition_json) : definitionFor(items, null, imported);
  const anchors = new Map(definition.occurrences.map((item) => [item.publicId, item]));
  // An explicitly re-added manual series may reuse its content hash. Its saved
  // membership defines the new series, rather than old deleted occurrences.
  // Imported sources can gain new teaching dates, so retain their projected rows.
  if (rows[0] && !imported) items = items.filter((item) => anchors.has(item.publicId));
  items = items.map((item) => ({
    ...item,
    originalStartAt: anchors.get(item.publicId)?.startAt || item.originalStartAt || item.startAt,
    originalEndAt: anchors.get(item.publicId)?.endAt || item.originalEndAt || item.endAt,
  }));
  selected = items.find((item) => item.publicId === publicId);
  const version = Number(rows[0]?.version || 0);
  // Includes source data and every occurrence, so an individual edit invalidates stale series forms.
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify([
        key,
        version,
        definition,
        [...items].sort((a, b) => a.publicId.localeCompare(b.publicId)),
      ]),
    )
    .digest('hex');
  return { key, imported, items, selected, definition, version, fingerprint };
}

function summarizeSeries(state) {
  if (!state) return null;
  const anchor = state.selected.originalStartAt;
  const dates = [...state.items].sort((a, b) => a.originalStartAt.localeCompare(b.originalStartAt));
  const future = dates.filter((item) => item.originalStartAt >= anchor);
  const recurrence = state.definition.recurrence ? { ...state.definition.recurrence } : null;
  if (recurrence && Object.hasOwn(recurrence, 'count')) {
    const step = recurrence.interval * (recurrence.unit === 'week' ? 7 : 1) * 86400000;
    const passed = Math.max(
      0,
      Math.round(
        (Date.parse(anchor) -
          Date.parse(state.definition.recurrenceStartAt || dates[0].originalStartAt)) /
          step,
      ),
    );
    recurrence.count = Math.max(1, recurrence.count - passed);
  }
  return {
    key: state.key,
    version: state.version,
    fingerprint: state.fingerprint,
    imported: state.imported,
    recurrence,
    description: state.imported
      ? '按课程实际教学日期安排；个人修改不回写网络学堂'
      : recurrence
        ? '重复规则已保存；修改本次及以后会保留此前安排与其他单次修改'
        : '旧安排未保存原重复规则，以下为实际日期；可保留这些日期或设置新规则',
    occurrences: dates.map((item) => ({
      publicId: item.publicId,
      startAt: item.startAt,
      endAt: item.endAt,
      originalStartAt: item.originalStartAt,
      deleted: Boolean(item.deleted),
      exception: Boolean(item.exception),
    })),
    remaining: future.filter((item) => !item.deleted).length,
  };
}

function validatedPatch(selected, body) {
  const allowed = new Set(['title', 'description', 'startAt', 'endAt', 'allDay', 'timezone']);
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => !allowed.has(key))
  )
    fail(400, '日程修改字段无效');
  const next = { ...selected, ...body };
  if (
    typeof next.title !== 'string' ||
    !next.title.trim() ||
    next.title.length > 200 ||
    typeof next.description !== 'string' ||
    next.description.length > 4000 ||
    typeof next.allDay !== 'boolean' ||
    (body.timezone && body.timezone !== 'Asia/Shanghai')
  )
    fail(400, '标题、备注或日程设置无效');
  for (const key of ['startAt', 'endAt']) {
    if (
      typeof next[key] !== 'string' ||
      !/T.*(?:Z|[+-]\d\d:\d\d)$/.test(next[key]) ||
      !Number.isFinite(Date.parse(next[key]))
    )
      fail(400, '请输入有效日期和时间');
    next[key] = iso(next[key]);
  }
  const start = Date.parse(next.startAt);
  const end = Date.parse(next.endAt);
  if (
    end <= start ||
    end - start > 86400000 ||
    new Date(start).getUTCFullYear() < 2000 ||
    new Date(end).getUTCFullYear() > 2200
  )
    fail(400, '每次安排需在有效日期内，结束晚于开始且不超过 24 小时');
  if (
    selected.kind === 'course' &&
    (next.allDay || iso(start + 8 * 3600000).slice(0, 10) !== iso(end + 8 * 3600000).slice(0, 10))
  )
    fail(400, '课程需要同一天内的准确起止时间');
  return {
    title: next.title.trim(),
    description: next.description.trim(),
    startAt: next.startAt,
    endAt: next.endAt,
    allDay: next.allDay,
    timezone: 'Asia/Shanghai',
  };
}

function planMutation(state, body) {
  if (
    !['single', 'following'].includes(body.scope) ||
    !['update', 'delete'].includes(body.operation)
  )
    fail(400, '请选择仅本次或本次及以后的操作');
  if (body.version !== state.version || body.fingerprint !== state.fingerprint)
    fail(409, '日程系列或课程源信息已更新，请刷新后重试');
  const selected = state.selected;
  const anchor = selected.originalStartAt;
  const affected =
    body.scope === 'single'
      ? [selected]
      : state.items.filter(
          (item) =>
            item.originalStartAt >= anchor &&
            (!item.exception || item.publicId === selected.publicId),
        );
  if (body.operation === 'delete') return { affected, remove: true, anchor };
  const patch = validatedPatch(selected, body.patch || {});
  if (body.scope === 'single') return { affected, patches: [patch], anchor };
  if (!['keep', 'replace'].includes(body.recurrenceMode))
    fail(400, '请选择保留实际日期或设置重复规则');
  if (body.recurrenceMode === 'replace') {
    const dates = expand({ ...patch, recurrence: body.recurrence });
    if (selected.kind === 'course')
      for (const date of dates) validatedPatch(selected, { ...patch, ...date });
    // Reserve exception slots in the replacement rule's coordinates. A bulk
    // move may have shifted the whole series across a day boundary; a personal
    // move instead keeps its own time while reserving its original series slot.
    const slotDelta = Date.parse(patch.startAt) - Date.parse(selected.originalStartAt);
    const exceptions = [
      ...(state.definition.externalExceptions || []),
      ...state.items
        .filter((item) => item.exception && item.publicId !== selected.publicId)
        .map((item) => ({ publicId: item.publicId, originalStartAt: item.originalStartAt })),
    ].map((item) => ({
      ...item,
      originalStartAt: iso(Date.parse(item.originalStartAt) + slotDelta),
    }));
    const exceptionDates = new Set(exceptions.map((item) => dayKey(item.originalStartAt)));
    return {
      affected,
      remove: true,
      anchor,
      recurrence: body.recurrence,
      exceptions,
      generated: dates
        .filter((date) => !exceptionDates.has(dayKey(date.startAt)))
        .map((date) => ({ ...patch, ...date })),
    };
  }
  const startDelta = Date.parse(patch.startAt) - Date.parse(selected.startAt);
  const endDelta = Date.parse(patch.endAt) - Date.parse(selected.endAt);
  const patches = affected.map((item) =>
    validatedPatch(item, {
      ...patch,
      startAt: iso(Date.parse(item.startAt) + startDelta),
      endAt: iso(Date.parse(item.endAt) + endDelta),
    }),
  );
  return { affected, patches, anchor };
}

async function persistItem(
  connection,
  userId,
  item,
  patch,
  { remove = false, exception = false } = {},
) {
  if (item.publicId.startsWith('cs_')) {
    const previous = item.personalPatch || {};
    const fields = remove ? { deleted: true } : patch;
    await connection.execute(
      `INSERT INTO campus_schedule_overrides (user_id, connector_generation, public_id, patch_json, version)
       VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE patch_json = VALUES(patch_json), version = VALUES(version),
         updated_at = CURRENT_TIMESTAMP`,
      [
        userId,
        item.connectorGeneration,
        item.publicId,
        JSON.stringify({ ...previous, ...fields, seriesManaged: !exception }),
        item.version + 1,
      ],
    );
  } else if (remove) {
    const [result] = await connection.execute(
      `UPDATE schedule_items SET status = 'cancelled', deleted_at = CURRENT_TIMESTAMP,
       cancelled_at = COALESCE(cancelled_at, CURRENT_TIMESTAMP), dedupe_key = NULL,
       user_overridden_at = IF(?, CURRENT_TIMESTAMP, user_overridden_at), version = version + 1
       WHERE user_id = ? AND public_id = ? AND version = ?`,
      [exception ? 1 : 0, userId, item.publicId, item.version],
    );
    if (!result.affectedRows) fail(409, '日程已更新，请刷新后重试');
  } else {
    const [result] = await connection.execute(
      `UPDATE schedule_items SET title = ?, description = ?, start_at = ?, end_at = ?, all_day = ?,
       user_overridden_at = IF(?, CURRENT_TIMESTAMP, user_overridden_at), version = version + 1
       WHERE user_id = ? AND public_id = ? AND version = ? AND deleted_at IS NULL`,
      [
        patch.title,
        patch.description,
        new Date(patch.startAt),
        new Date(patch.endAt),
        patch.allDay ? 1 : 0,
        exception ? 1 : 0,
        userId,
        item.publicId,
        item.version,
      ],
    );
    if (!result.affectedRows) fail(409, '日程已更新，请刷新后重试');
  }
}

async function mutateSeries(pool, userId, publicId, body) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId]);
    if (publicId.startsWith('cs_'))
      await connection.execute(
        `SELECT generation FROM user_campus_connectors WHERE user_id = ? AND provider = 'tsinghua-learn' FOR UPDATE`,
        [userId],
      );
    const state = await readSeries(connection, userId, publicId);
    if (!state) fail(400, '该事件不属于重复系列');
    const plan = planMutation(state, body);
    if (body.operation === 'update' && body.allowConflicts !== true) {
      const proposals =
        plan.generated || plan.patches.filter((_, index) => !plan.affected[index].deleted);
      if (proposals.length) {
        const start = new Date(Math.min(...proposals.map((item) => Date.parse(item.startAt))));
        const end = new Date(Math.max(...proposals.map((item) => Date.parse(item.endAt))));
        const [otherRows] = await connection.execute(
          `SELECT public_id, start_at, end_at FROM schedule_items WHERE user_id = ?
           AND deleted_at IS NULL AND status IN ('draft', 'confirmed')
           AND (source_reference IS NULL OR source_reference NOT IN ('planner:deadline', 'manual:deadline'))
           AND start_at < ? AND end_at > ? LIMIT 2001`,
          [userId, end, start],
        );
        const courses = await require('./course-schedule').listCourseSchedules(connection, userId, {
          start,
          end,
        });
        const ids = new Set(plan.affected.map((item) => item.publicId));
        const others = [
          ...otherRows.map((row) => ({
            publicId: row.public_id,
            startAt: iso(row.start_at),
            endAt: iso(row.end_at),
          })),
          ...courses,
        ];
        if (
          otherRows.length > 2000 ||
          others.some(
            (other) =>
              !ids.has(other.publicId) &&
              proposals.some((item) => item.startAt < other.endAt && item.endAt > other.startAt),
          )
        ) {
          throw Object.assign(
            new Error('修改后的安排与已有日程重叠，请核对；确认仍要保存时再次提交'),
            { status: 409, code: 'course_conflict' },
          );
        }
      }
    }
    for (let index = 0; index < plan.affected.length; index += 1) {
      const item = plan.affected[index];
      if (item.deleted) continue;
      await persistItem(connection, userId, item, plan.patches?.[index], {
        remove: plan.remove,
        exception: body.scope === 'single',
      });
    }
    const definition = { ...state.definition };
    if (body.scope === 'following' && plan.remove) {
      definition.suppressedFrom =
        definition.suppressedFrom && definition.suppressedFrom < plan.anchor
          ? definition.suppressedFrom
          : plan.anchor;
    }
    if (state.imported && body.scope === 'following' && plan.remove) {
      // This policy also suppresses newly synced occurrences in the same original slot.
      await connection.execute(
        `INSERT INTO campus_schedule_overrides (user_id, connector_generation, public_id, patch_json, version)
         VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE patch_json = VALUES(patch_json), version = VALUES(version)`,
        [
          userId,
          state.selected.connectorGeneration,
          `cs_series_${state.key.slice(7)}`,
          JSON.stringify({ suppressedFrom: definition.suppressedFrom }),
          state.version + 2,
        ],
      );
    }
    await writeDefinition(connection, userId, state.key, definition, state.version + 1);
    let created = 0;
    if (plan.generated?.length) {
      const key = `manual:${state.selected.kind === 'course' ? 'course' : 'recurring'}:${randomBytes(16).toString('hex')}`;
      const items = [];
      for (const patch of plan.generated) {
        const id = `ws_${randomBytes(12).toString('hex')}`;
        await connection.execute(
          `INSERT INTO schedule_items (public_id, user_id, created_by_user_id, source_type, source_reference,
           dedupe_key, title, description, start_at, end_at, all_day, timezone, status, user_confirmed_at)
           VALUES (?, ?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, 'Asia/Shanghai', 'confirmed', CURRENT_TIMESTAMP)`,
          [
            id,
            userId,
            userId,
            key,
            `${key}:${created}`,
            patch.title,
            patch.description,
            new Date(patch.startAt),
            new Date(patch.endAt),
            patch.allDay ? 1 : 0,
          ],
        );
        items.push({ ...patch, publicId: id });
        created += 1;
      }
      await writeDefinition(connection, userId, key, {
        ...definitionFor(items, plan.recurrence),
        externalExceptions: plan.exceptions || [],
      });
    }
    await connection.commit();
    return { ok: true, affected: plan.affected.filter((item) => !item.deleted).length, created };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  SERIES_TABLE,
  importedSeriesKey,
  definitionFor,
  writeDefinition,
  readSeries,
  summarizeSeries,
  planMutation,
  mutateSeries,
  validatedPatch,
};
