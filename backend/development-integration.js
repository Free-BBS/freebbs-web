const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { open, lstat } = require('node:fs/promises');
const { constants } = require('node:fs');

async function readDevelopmentMapTokenDigest(repositoryRoot) {
  const filename = path.join(repositoryRoot, '.development-map-token.sha256');
  let handle;
  try {
    const info = await lstat(filename);
    if (!info.isFile() || info.size > 256) return undefined;
    handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const buffer = Buffer.alloc(257);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 256) return undefined;
    const digest = buffer.subarray(0, bytesRead).toString('utf8').trim();
    return /^[a-f0-9]{64}$/.test(digest) ? digest : undefined;
  } catch {
    // An unavailable verifier disables Map integration, never the main backend.
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function profileToDevelopmentIdentity(profile) {
  return {
    uid: profile.uid,
    username: profile.username || null,
    studentId: profile.studentId || null,
    displayName: profile.username || profile.fullName || profile.uid,
    avatarUrl: profile.avatarPath || null,
    baseRole: 'student',
    roles: [],
    tags: [],
    mainSiteAdmin: profile.isAdmin === true,
  };
}

function createDevelopmentDatabaseConfig(mainDatabase, environment = process.env) {
  const socketPath =
    environment.DEVELOPMENT_MYSQL_SOCKET?.trim() || mainDatabase.socketPath || undefined;
  return {
    host: environment.DEVELOPMENT_MYSQL_HOST?.trim() || mainDatabase.host,
    port: Number(environment.DEVELOPMENT_MYSQL_PORT || mainDatabase.port),
    user: environment.DEVELOPMENT_MYSQL_USER?.trim() || mainDatabase.user,
    password:
      environment.DEVELOPMENT_MYSQL_PASSWORD !== undefined
        ? environment.DEVELOPMENT_MYSQL_PASSWORD
        : mainDatabase.password,
    database:
      environment.DEVELOPMENT_MYSQL_DATABASE?.trim() || `${mainDatabase.database}_development`,
    ...(socketPath ? { socketPath } : {}),
  };
}

function createDevelopmentAuthClient({ verifyToken, getUserById, toUserProfile }) {
  return {
    async introspect(token) {
      const payload = verifyToken(token);
      if (!payload || !payload.sub) return null;
      const row = await getUserById(payload.sub);
      return row ? profileToDevelopmentIdentity(toUserProfile(row)) : null;
    },
  };
}

function createDevelopmentUserDirectory(pool) {
  function map(row) {
    return {
      uid: row.uid,
      username: row.username,
      displayName: row.username || row.full_name || row.uid,
      studentId: row.student_id || null,
      avatarUrl: row.avatar_path || null,
    };
  }

  function selection(options = {}) {
    const normalized = String(options.query || '').trim().slice(0, 80);
    const like = `%${normalized.replace(/[!%_]/g, '!$&')}%`;
    const parameters = [normalized, like, like, like, like];
    let where = `uid IS NOT NULL AND uid <> ''
      AND (? = '' OR username LIKE ? ESCAPE '!' OR full_name LIKE ? ESCAPE '!'
        OR student_id LIKE ? ESCAPE '!' OR uid LIKE ? ESCAPE '!')`;
    if (options.uids) {
      where += options.uids.length ? ` AND uid IN (${options.uids.map(() => '?').join(',')})` : ' AND 1 = 0';
      parameters.push(...options.uids);
    }
    for (const [key, negate] of [['include', false], ['exclude', true]]) {
      const filter = options[key];
      if (!filter) continue;
      const clauses = [];
      for (const [field, column] of [['uids', 'uid'], ['studentIds', 'student_id'], ['usernames', 'LOWER(username)']]) {
        if (!filter[field]?.length) continue;
        clauses.push(`COALESCE(${column} IN (${filter[field].map(() => '?').join(',')}), FALSE)`);
        parameters.push(...filter[field]);
      }
      where += ` AND ${negate ? 'NOT ' : ''}(${clauses.join(' OR ') || '1 = 0'})`;
    }
    return { where, parameters };
  }
  return {
    async list(query = '') {
      const { where, parameters } = selection({ query });
      const [rows] = await pool.execute(
        `SELECT uid, username, full_name, student_id, avatar_path FROM users
         WHERE ${where} ORDER BY username ASC, id ASC`, parameters);
      return rows.map(map);
    },
    async page(options = {}) {
      const page = Number.isSafeInteger(options.page) && options.page > 0 ? options.page : 1;
      const pageSize = Number.isSafeInteger(options.pageSize) && options.pageSize > 0 ? Math.min(options.pageSize, 100) : 20;
      const { where, parameters } = selection(options);
      const [counts] = await pool.execute(`SELECT COUNT(*) AS total FROM users WHERE ${where}`, parameters);
      const [rows] = await pool.execute(
        `SELECT uid, username, full_name, student_id, avatar_path FROM users WHERE ${where}
         ORDER BY username ASC, id ASC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, parameters);
      return { items: rows.map(map), total: Number(counts[0]?.total || 0), page, pageSize };
    },
    async get(uid) {
      const [rows] = await pool.execute(
        `SELECT uid, username, full_name, student_id, avatar_path
         FROM users WHERE uid = ? LIMIT 1`,
        [String(uid)],
      );
      return rows[0] ? map(rows[0]) : null;
    },
  };
}

async function loadDevelopmentRuntime({
  repositoryRoot,
  authClient,
  userDirectory,
  database,
  uploadDirectory,
  collectionsUploadDirectory,
  sportsUploadDirectory,
  developmentRewardProvider,
  learningAchievementProvider,
}) {
  const modulePath = path.join(
    repositoryRoot,
    'development',
    'apps',
    'api',
    'dist',
    'integrated-runtime.js',
  );
  const { createIntegratedDevelopmentRuntime } = await import(pathToFileURL(modulePath).href);
  const developmentMapTokenDigest = await readDevelopmentMapTokenDigest(repositoryRoot);
  return createIntegratedDevelopmentRuntime({
    authClient,
    userDirectory,
    database,
    uploadDirectory,
    collectionsUploadDirectory,
    sportsUploadDirectory,
    ...(developmentRewardProvider ? { developmentRewardProvider } : {}),
    ...(learningAchievementProvider ? { learningAchievementProvider } : {}),
    ...(developmentMapTokenDigest ? { developmentMapTokenDigest } : {}),
  });
}

async function initializeDevelopmentRuntime(options, dependencies = {}) {
  const loader = dependencies.loader || loadDevelopmentRuntime;
  const reportError = dependencies.reportError || console.error;

  try {
    return await loader(options);
  } catch (error) {
    reportError(
      '[development] runtime initialization failed; development API will remain unavailable',
      error,
    );
    return null;
  }
}

module.exports = {
  createDevelopmentAuthClient,
  createDevelopmentDatabaseConfig,
  createDevelopmentUserDirectory,
  initializeDevelopmentRuntime,
  loadDevelopmentRuntime,
  profileToDevelopmentIdentity,
  readDevelopmentMapTokenDigest,
};
