#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';

import { createPool as createMySqlPool } from 'mysql2/promise';

import {
  acquireDatabaseLock,
  databaseLockName,
  loadMySqlConfig,
  releaseDatabaseLock,
} from './migrate.mjs';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const migrationDirectory = 'database/migrations';
const lockTimeoutSeconds = 60;

const usage = `Usage: node scripts/admin-bootstrap.mjs [options]

Required:
  --uid UID              Target subject UID
  --confirm TEXT         BOOTSTRAP_SUPER_ADMIN:<uid>

Options:
  --recovery             Reconcile governance data during emergency recovery
  --help                 Show this help

Recovery confirmation: RECOVER_SUPER_ADMIN:<uid>
Required environment: NODE_ENV=production, DATA_MODE=mysql and MYSQL_*.
Credentials, tokens and SQL are accepted through neither options nor positional arguments.
`;

function requireValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('-')) throw new Error(`${flag} requires a value`);
  return value;
}

function rejectSensitiveArgument(argument) {
  const optionName = argument.split('=', 1)[0]?.toLowerCase() ?? '';
  if (optionName.startsWith('-') && /(password|token|sql)/.test(optionName)) {
    throw new Error('Password, token and SQL values are not accepted as CLI arguments');
  }
}

export function parseBootstrapArguments(argv) {
  const parsed = { uid: undefined, confirm: undefined, recovery: false, help: false };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    rejectSensitiveArgument(argument);
    if (argument === '--help' || argument === '-h') {
      if (seen.has('help')) throw new Error('--help may be specified once');
      seen.add('help');
      parsed.help = true;
    } else if (argument === '--uid') {
      if (seen.has('uid')) throw new Error('--uid may be specified once');
      seen.add('uid');
      parsed.uid = requireValue(argv, index, '--uid');
      index += 1;
    } else if (argument === '--confirm') {
      if (seen.has('confirm')) throw new Error('--confirm may be specified once');
      seen.add('confirm');
      parsed.confirm = requireValue(argv, index, '--confirm');
      index += 1;
    } else if (argument === '--recovery') {
      if (seen.has('recovery')) throw new Error('--recovery may be specified once');
      seen.add('recovery');
      parsed.recovery = true;
    } else {
      const optionName = argument.startsWith('--') ? argument.split('=', 1)[0] : undefined;
      throw new Error(optionName ? `Unknown argument: ${optionName}` : 'Unknown argument');
    }
  }
  return parsed;
}

async function discoverRepositoryMigrations(directory) {
  const names = (await readdir(directory))
    .filter((name) => /^\d+_[a-z0-9_-]+\.sql$/i.test(name))
    .sort((left, right) => left.localeCompare(right));
  return Promise.all(
    names.map(async (name) => {
      const contents = await readFile(join(directory, name), 'utf8');
      const checksum = createHash('sha256').update(contents, 'utf8').digest('hex');
      return { name, checksum };
    }),
  );
}

async function verifyMigrationHistory(connection, migrations) {
  if (migrations.length === 0) {
    throw new Error(
      'Migration history cannot be verified because the repository has no migrations',
    );
  }
  const [rows] = await connection.execute(
    'SELECT name, checksum FROM development_schema_migrations ORDER BY name',
  );
  if (!Array.isArray(rows) || rows.length !== migrations.length) {
    throw new Error('Migration history does not exactly match repository migration filenames');
  }
  for (let index = 0; index < migrations.length; index += 1) {
    const expected = migrations[index];
    const applied = rows[index];
    if (String(applied?.name ?? '') !== expected.name) {
      throw new Error('Migration history does not exactly match repository migration filenames');
    }
    if (String(applied?.checksum ?? '') !== expected.checksum) {
      throw new Error(`Migration checksum mismatch: ${expected.name}`);
    }
  }
}

async function importRuntimeModule(compiledUrl, sourceUrl) {
  try {
    return await import(compiledUrl.href);
  } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND' || error?.url !== compiledUrl.href) {
      throw error;
    }
    const { tsImport } = await import('tsx/esm/api');
    return tsImport(sourceUrl.href, import.meta.url);
  }
}

async function loadBootstrapRuntime() {
  const [storeApi, bootstrapApi] = await Promise.all([
    importRuntimeModule(
      new URL('../apps/api/dist/core/database/create-store.js', import.meta.url),
      new URL('../apps/api/src/core/database/create-store.ts', import.meta.url),
    ),
    importRuntimeModule(
      new URL('../apps/api/dist/core/bootstrap/bootstrap-service.js', import.meta.url),
      new URL('../apps/api/src/core/bootstrap/bootstrap-service.ts', import.meta.url),
    ),
  ]);
  return {
    createStore: storeApi.createStore,
    bootstrapPlatform: bootstrapApi.bootstrapPlatform,
  };
}

function containsControlCharacter(value) {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) return true;
  }
  return false;
}
function validateExecutionGate(environment, args) {
  if (environment.NODE_ENV?.trim() !== 'production') {
    throw new Error('Administrator bootstrap is available in production only');
  }
  if (environment.DATA_MODE?.trim() !== 'mysql') {
    throw new Error('DATA_MODE=mysql is required for administrator bootstrap');
  }
  if (!args.uid) throw new Error('--uid is required');
  if (!args.confirm) throw new Error('--confirm is required');
  if (args.uid !== args.uid.trim() || args.uid.length > 128 || containsControlCharacter(args.uid)) {
    throw new Error(
      'Bootstrap UID must be 1-128 characters without surrounding whitespace or controls',
    );
  }
  const expectedConfirmation = args.recovery
    ? `RECOVER_SUPER_ADMIN:${args.uid}`
    : `BOOTSTRAP_SUPER_ADMIN:${args.uid}`;
  if (args.confirm !== expectedConfirmation) {
    throw new Error(`Exact confirmation required: ${expectedConfirmation}`);
  }
}

export async function runBootstrapCli(options = {}) {
  const {
    argv = process.argv.slice(2),
    environment = process.env,
    rootDirectory = repositoryRoot,
    createPoolImpl = createMySqlPool,
    discoverMigrationsImpl = discoverRepositoryMigrations,
    now = () => new Date(),
    version = environment.APP_VERSION?.trim() || environment.GIT_COMMIT_SHA?.trim() || 'unknown',
    writeOutput = (message) => process.stdout.write(message),
  } = options;
  const args = parseBootstrapArguments(argv);
  if (args.help) {
    writeOutput(usage);
    return 0;
  }

  validateExecutionGate(environment, args);
  const config = loadMySqlConfig(environment);
  const lockName = databaseLockName(config.database);
  const pool = createPoolImpl({ ...config, connectionLimit: 1 });
  let connection;
  let lockAcquired = false;
  let storeHandle;
  let result;
  let failure;

  try {
    connection = await pool.getConnection();
    await acquireDatabaseLock(connection, lockName, lockTimeoutSeconds);
    lockAcquired = true;

    const directory = resolve(rootDirectory, migrationDirectory);
    const migrations = await discoverMigrationsImpl(directory);
    await verifyMigrationHistory(connection, migrations);

    let createStoreImpl = options.createStoreImpl;
    let bootstrapPlatformImpl = options.bootstrapPlatformImpl;
    if (!createStoreImpl || !bootstrapPlatformImpl) {
      const runtime = await loadBootstrapRuntime();
      createStoreImpl ??= runtime.createStore;
      bootstrapPlatformImpl ??= runtime.bootstrapPlatform;
    }
    storeHandle = createStoreImpl(environment);
    if (storeHandle.mode !== 'mysql') {
      throw new Error('Administrator bootstrap store must use mysql mode');
    }
    result = await bootstrapPlatformImpl(storeHandle.store, {
      uid: args.uid,
      recovery: args.recovery,
      version,
      now: now(),
    });
  } catch (error) {
    failure = error;
  }

  if (storeHandle) {
    try {
      await storeHandle.close();
    } catch (error) {
      failure ??= error;
    }
  }
  if (connection && lockAcquired) {
    try {
      await releaseDatabaseLock(connection, lockName);
    } catch (error) {
      failure ??= error;
    }
  }
  if (connection) {
    try {
      connection.release();
    } catch (error) {
      failure ??= error;
    }
  }
  try {
    await pool.end();
  } catch (error) {
    failure ??= error;
  }

  if (failure) throw failure;
  writeOutput(
    `Administrator bootstrap completed for ${result.uid} (${result.recovered ? 'recovery' : 'normal'}).\n`,
  );
  return result;
}

export function formatBootstrapCliFailure() {
  return 'Administrator bootstrap failed; verify arguments, migration history, and secure database logs';
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  runBootstrapCli().catch(() => {
    process.stderr.write(`${formatBootstrapCliFailure()}\n`);
    process.exitCode = 1;
  });
}
