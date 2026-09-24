#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';

import { createPool as createMySqlPool } from 'mysql2/promise';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const compiledMigrationUrl = new URL('../apps/api/dist/core/database/migrate.js', import.meta.url);

async function loadMigrationApi() {
  try {
    return await import(compiledMigrationUrl.href);
  } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND' || error?.url !== compiledMigrationUrl.href) {
      throw error;
    }
    const { tsImport } = await import('tsx/esm/api');
    return tsImport(
      new URL('../apps/api/src/core/database/migrate.ts', import.meta.url).href,
      import.meta.url,
    );
  }
}

const migrationApi = await loadMigrationApi();

export const loadMySqlConfig = migrationApi.loadMySqlConfig;
export const splitSqlStatements = migrationApi.splitSqlStatements;

const usage = `Usage: node scripts/migrate.mjs [options]

Options:
  --directory PATH       Migration directory (default: database/migrations)
  --lock-timeout SECONDS Wait for the database advisory lock, 0-300 (default: 60)
  --help                 Show this help

Required environment: DATA_MODE=mysql, MYSQL_HOST, MYSQL_PORT, MYSQL_USER,
MYSQL_PASSWORD and MYSQL_DATABASE.
`;

function parseLockTimeout(value) {
  const timeout = Number(value);
  if (!Number.isInteger(timeout) || timeout < 0 || timeout > 300) {
    throw new Error('--lock-timeout must be an integer between 0 and 300');
  }
  return timeout;
}

export function parseMigrationArguments(argv) {
  const parsed = { directory: undefined, help: false, lockTimeoutSeconds: 60 };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      parsed.help = true;
    } else if (argument === '--directory') {
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) throw new Error('--directory requires a path');
      parsed.directory = value;
      index += 1;
    } else if (argument === '--lock-timeout') {
      const value = argv[index + 1];
      if (value === undefined) throw new Error('--lock-timeout requires a value');
      parsed.lockTimeoutSeconds = parseLockTimeout(value);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return parsed;
}

export function databaseLockName(database) {
  const digest = createHash('sha256').update(database, 'utf8').digest('hex').slice(0, 32);
  return `freebbs-development:database:${digest}`;
}

export async function acquireDatabaseLock(connection, lockName, timeoutSeconds) {
  const [rows] = await connection.execute('SELECT GET_LOCK(?, ?) AS acquired', [
    lockName,
    timeoutSeconds,
  ]);
  if (!Array.isArray(rows) || rows[0]?.acquired !== 1) {
    throw new Error(`Could not acquire database operation lock within ${timeoutSeconds} seconds`);
  }
}

export async function releaseDatabaseLock(connection, lockName) {
  const [rows] = await connection.execute('SELECT RELEASE_LOCK(?) AS released', [lockName]);
  if (!Array.isArray(rows) || rows[0]?.released !== 1) {
    throw new Error('Database operation lock was not released by this connection');
  }
}

function requireMySqlMode(environment) {
  if (environment.DATA_MODE?.trim() !== 'mysql') {
    throw new Error('DATA_MODE=mysql is required for database operations');
  }
}

export async function runMigrationCli(options = {}) {
  const {
    argv = process.argv.slice(2),
    environment = process.env,
    rootDirectory = repositoryRoot,
    createPoolImpl = createMySqlPool,
    runMigrationsImpl = migrationApi.runMigrations,
    writeOutput = (message) => process.stdout.write(message),
  } = options;
  const args = parseMigrationArguments(argv);
  if (args.help) {
    writeOutput(usage);
    return [];
  }

  requireMySqlMode(environment);
  const config = loadMySqlConfig(environment);
  const directory = resolve(rootDirectory, args.directory ?? 'database/migrations');
  const lockName = databaseLockName(config.database);
  const pool = createPoolImpl({ ...config, connectionLimit: 2 });
  let connection;
  let lockAcquired = false;
  let failure;
  let migrations;

  try {
    connection = await pool.getConnection();
    await acquireDatabaseLock(connection, lockName, args.lockTimeoutSeconds);
    lockAcquired = true;
    migrations = await runMigrationsImpl({ pool, directory, environment });
    if (migrations.length === 0) throw new Error(`No migration files found in ${directory}`);
  } catch (error) {
    failure = error;
  }

  if (connection && lockAcquired) {
    try {
      await releaseDatabaseLock(connection, lockName);
    } catch (error) {
      failure ??= error;
    }
  }
  connection?.release();
  try {
    await pool.end();
  } catch (error) {
    failure ??= error;
  }

  if (failure) throw failure;
  writeOutput(`Database migrations verified: ${migrations.join(', ')}\n`);
  return migrations;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  runMigrationCli().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Database migration failed: ${message}\n`);
    process.exitCode = 1;
  });
}
