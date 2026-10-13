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

  return {
    async list(query = '') {
      const normalized = String(query).trim().slice(0, 80);
      const like = `%${normalized.replace(/[!%_]/g, '!$&')}%`;
      const [rows] = await pool.execute(
        `SELECT uid, username, full_name, student_id, avatar_path
         FROM users
         WHERE uid IS NOT NULL AND uid <> ''
           AND (? = '' OR username LIKE ? ESCAPE '!' OR full_name LIKE ? ESCAPE '!'
             OR student_id LIKE ? ESCAPE '!' OR uid LIKE ? ESCAPE '!')
         ORDER BY username ASC, id ASC
         LIMIT 2000`,
        [normalized, like, like, like, like],
      );
      return rows.map(map);
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
