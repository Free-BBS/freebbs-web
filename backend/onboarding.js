const fs = require('node:fs');
const path = require('node:path');

const { GUIDE_VERSION, LEGACY_GUIDE_VERSIONS, RELEASES } = require('../public/max-guide-releases');

const ALLOWED_GUIDE_VERSIONS = Object.freeze([
  GUIDE_VERSION,
  ...LEGACY_GUIDE_VERSIONS,
  ...RELEASES.map((release) => release.id),
]);
const TASK_IDS = Object.freeze([
  'explore_world',
  'visit_discussion',
  'meet_max',
  'open_workbench',
  'visit_inventory',
]);
const STATUSES = new Set(['not_started', 'in_progress', 'skipped', 'completed']);
const PATCH_FIELDS = new Set(['version', 'status', 'step', 'completedTasks', 'restart']);
const initialization = new WeakMap();

class OnboardingError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function resolveGuideVersion(value = GUIDE_VERSION) {
  if (typeof value !== 'string' || !ALLOWED_GUIDE_VERSIONS.includes(value))
    throw new OnboardingError('导览已更新或版本不存在，请刷新页面', 409);
  return value;
}

function isBaseGuideVersion(version) {
  return version === GUIDE_VERSION || LEGACY_GUIDE_VERSIONS.includes(version);
}

function emptyProgress(version = GUIDE_VERSION) {
  return {
    version: resolveGuideVersion(version),
    status: 'not_started',
    step: 0,
    completedTasks: [],
    seenAt: null,
    completedAt: null,
    dismissedAt: null,
    updatedAt: null,
  };
}

function validatePatch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new OnboardingError('导览进度格式不正确');
  if (Object.keys(value).some((key) => !PATCH_FIELDS.has(key)))
    throw new OnboardingError('导览进度包含不支持的字段');
  const version = resolveGuideVersion(value.version);
  if (value.status !== undefined && !STATUSES.has(value.status))
    throw new OnboardingError('导览状态不正确');
  if (
    value.step !== undefined &&
    (!Number.isInteger(value.step) || value.step < 0 || value.step > 200)
  )
    throw new OnboardingError('导览步骤不正确');
  if (
    value.completedTasks !== undefined &&
    (!Array.isArray(value.completedTasks) ||
      value.completedTasks.length > TASK_IDS.length ||
      value.completedTasks.some((task) => !TASK_IDS.includes(task)))
  )
    throw new OnboardingError('新手任务不正确');
  if (!isBaseGuideVersion(version) && value.completedTasks?.length)
    throw new OnboardingError('新功能导览的进度与新手任务分别保存');
  if (value.restart !== undefined && typeof value.restart !== 'boolean')
    throw new OnboardingError('重开导览参数不正确');
  if (value.restart && value.status && value.status !== 'in_progress')
    throw new OnboardingError('重开导览时状态应为进行中');
  return value;
}

function mergeProgress(previous, patch, now) {
  const version = resolveGuideVersion(patch.version ?? previous.version);
  if (previous.version !== version)
    throw new OnboardingError('导览版本与已读取进度不一致，请重新读取', 409);
  const stamp = new Date(now).toISOString();
  const next = { ...previous, seenAt: previous.seenAt || stamp, updatedAt: stamp };
  // Tasks are visit receipts, never learning results or currency entitlements.
  // Merge under the row lock so devices cannot erase one another's discoveries.
  next.completedTasks = isBaseGuideVersion(version)
    ? TASK_IDS.filter(
        (task) => previous.completedTasks.includes(task) || patch.completedTasks?.includes(task),
      )
    : [];
  if (patch.restart) {
    next.status = 'in_progress';
    next.step = patch.step ?? 0;
    next.dismissedAt = null;
  } else if (previous.status !== 'completed') {
    next.status = patch.status ?? previous.status;
    next.step = patch.step ?? previous.step;
  }
  // An old tab cannot undo a completed tour; manual replay uses restart explicitly.
  // Keep the first completion timestamp even after replaying the tour.
  if (next.status === 'completed' && !next.completedAt) next.completedAt = stamp;
  if (next.status === 'skipped' && patch.status === 'skipped') next.dismissedAt = stamp;
  return next;
}

async function ensureOnboardingTable(pool) {
  if (!initialization.has(pool)) {
    const pending = (async () => {
      const sql = fs.readFileSync(
        path.join(__dirname, '../database/migrations/045_user_onboarding.sql'),
        'utf8',
      );
      await pool.query(sql);
    })().catch((error) => {
      initialization.delete(pool);
      throw error;
    });
    initialization.set(pool, pending);
  }
  await initialization.get(pool);
}

function progressFromRow(row, version = row?.guide_version || GUIDE_VERSION) {
  resolveGuideVersion(version);
  if (!row) return emptyProgress(version);
  if (row.guide_version && row.guide_version !== version)
    throw new Error('Guide row version mismatch');
  const parsed =
    typeof row.completed_tasks_json === 'string'
      ? JSON.parse(row.completed_tasks_json)
      : row.completed_tasks_json;
  const toIso = (value) => (value == null ? null : new Date(Number(value)).toISOString());
  return {
    version,
    status: row.status,
    step: Number(row.current_step),
    completedTasks: isBaseGuideVersion(version)
      ? TASK_IDS.filter((task) => Array.isArray(parsed) && parsed.includes(task))
      : [],
    seenAt: toIso(row.seen_at_ms),
    completedAt: toIso(row.completed_at_ms),
    dismissedAt: toIso(row.dismissed_at_ms),
    updatedAt: toIso(row.updated_at_ms),
  };
}

function createMysqlOnboardingStore(pool) {
  return {
    async read(userId, version = GUIDE_VERSION) {
      resolveGuideVersion(version);
      await ensureOnboardingTable(pool);
      const [rows] = await pool.execute(
        'SELECT * FROM user_onboarding WHERE user_id = ? AND guide_version = ?',
        [userId, version],
      );
      return progressFromRow(rows[0], version);
    },
    async update(userId, change, now, version = GUIDE_VERSION) {
      resolveGuideVersion(version);
      await ensureOnboardingTable(pool);
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        // The upsert also serializes simultaneous first visits for this account/version.
        await connection.execute(
          `INSERT INTO user_onboarding
            (user_id, guide_version, completed_tasks_json, seen_at_ms, updated_at_ms)
           VALUES (?, ?, '[]', ?, ?) ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)`,
          [userId, version, now, now],
        );
        const [rows] = await connection.execute(
          'SELECT * FROM user_onboarding WHERE user_id = ? AND guide_version = ? FOR UPDATE',
          [userId, version],
        );
        const next = change(progressFromRow(rows[0], version));
        if (next.version !== version) throw new Error('Guide update version mismatch');
        await connection.execute(
          `UPDATE user_onboarding SET status = ?, current_step = ?, completed_tasks_json = ?,
           completed_at_ms = ?, dismissed_at_ms = ?, updated_at_ms = ?
           WHERE user_id = ? AND guide_version = ?`,
          [
            next.status,
            next.step,
            JSON.stringify(next.completedTasks),
            next.completedAt ? Date.parse(next.completedAt) : null,
            next.dismissedAt ? Date.parse(next.dismissedAt) : null,
            now,
            userId,
            version,
          ],
        );
        await connection.commit();
        return next;
      } catch (error) {
        try {
          await connection.rollback();
        } catch {
          // Preserve the original failure; an interrupted connection may also fail rollback.
        }
        throw error;
      } finally {
        connection.release();
      }
    },
  };
}

function createOnboardingService(store, { now = Date.now } = {}) {
  async function inheritedTasks(userId, version) {
    if (version !== GUIDE_VERSION) return [];
    const history = await Promise.all(
      LEGACY_GUIDE_VERSIONS.map((legacy) => store.read(userId, legacy)),
    );
    return TASK_IDS.filter((task) => history.some((state) => state.completedTasks.includes(task)));
  }
  function withTasks(progress, inherited) {
    return {
      ...progress,
      completedTasks: TASK_IDS.filter(
        (task) => progress.completedTasks.includes(task) || inherited.includes(task),
      ),
    };
  }
  return {
    async read(userId, requestedVersion = GUIDE_VERSION) {
      const version = resolveGuideVersion(requestedVersion);
      const progress = await store.read(userId, version);
      // This is a read-only union, not a completion or reward. Old receipts remain
      // untouched and old clients can still add visits without losing them in v2.
      return withTasks(progress, await inheritedTasks(userId, version));
    },
    async update(userId, value) {
      const patch = validatePatch(value);
      const version = resolveGuideVersion(patch.version);
      const inherited = await inheritedTasks(userId, version);
      const stamp = now();
      return store.update(
        userId,
        (previous) => mergeProgress(withTasks(previous, inherited), patch, stamp),
        stamp,
        version,
      );
    },
  };
}

function registerOnboarding(app, { pool, requireAuth, service, logger = console }) {
  const progress = service || createOnboardingService(createMysqlOnboardingStore(pool));
  async function handle(request, response, writing) {
    response.set('Cache-Control', 'no-store');
    try {
      const user = await requireAuth(request, response);
      if (!user) return;
      const result = writing
        ? await progress.update(user.id, request.body)
        : await progress.read(user.id, resolveGuideVersion(request.query?.version));
      response.json(result);
    } catch (error) {
      if (!(error instanceof OnboardingError))
        logger.error('Onboarding progress unavailable', error.code || error.name);
      response.status(error instanceof OnboardingError ? error.status : 503).json({
        message:
          error instanceof OnboardingError ? error.message : '暂时无法同步导览进度，请稍后重试',
      });
    }
  }
  app.get('/api/onboarding', (request, response) => handle(request, response, false));
  app.patch('/api/onboarding', (request, response) => handle(request, response, true));
  app.post('/api/onboarding', (request, response) => handle(request, response, true));
  return progress;
}

module.exports = {
  GUIDE_VERSION,
  LEGACY_GUIDE_VERSIONS,
  ALLOWED_GUIDE_VERSIONS,
  TASK_IDS,
  OnboardingError,
  resolveGuideVersion,
  isBaseGuideVersion,
  emptyProgress,
  validatePatch,
  mergeProgress,
  ensureOnboardingTable,
  progressFromRow,
  createMysqlOnboardingStore,
  createOnboardingService,
  registerOnboarding,
};
