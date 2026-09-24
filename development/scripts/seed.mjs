#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';

import { createPool as createMySqlPool } from 'mysql2/promise';

import {
  acquireDatabaseLock,
  databaseLockName,
  loadMySqlConfig,
  releaseDatabaseLock,
  splitSqlStatements,
} from './migrate.mjs';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const usage = `Usage: node scripts/seed.mjs [options]

Options:
  --file PATH            Seed SQL file (default: database/seeds/001_demo.sql)
  --lock-timeout SECONDS Wait for the database advisory lock, 0-300 (default: 60)
  --help                 Show this help

Required environment: DATA_MODE=mysql, ALLOW_DEMO_SEED=true and MYSQL_*.
Production also requires ALLOW_PRODUCTION_DEMO_SEED=true.
`;

function parseLockTimeout(value) {
  const timeout = Number(value);
  if (!Number.isInteger(timeout) || timeout < 0 || timeout > 300) {
    throw new Error('--lock-timeout must be an integer between 0 and 300');
  }
  return timeout;
}

export function parseSeedArguments(argv) {
  const parsed = { file: undefined, help: false, lockTimeoutSeconds: 60 };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      parsed.help = true;
    } else if (argument === '--file') {
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) throw new Error('--file requires a path');
      parsed.file = value;
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

export function makeSeedStatementIdempotent(statement) {
  const normalized = statement.trim().replace(/;\s*$/, '');
  if (!/^INSERT\s+INTO\b/i.test(normalized)) {
    throw new Error('Seed files may contain INSERT statements only');
  }
  if (/\bON\s+DUPLICATE\s+KEY\s+UPDATE\b/i.test(normalized)) return normalized;
  return `${normalized}\nON DUPLICATE KEY UPDATE id = id`;
}

function enabled(value) {
  return value?.trim().toLowerCase() === 'true';
}

function requireSeedGate(environment) {
  if (environment.DATA_MODE?.trim() !== 'mysql') {
    throw new Error('DATA_MODE=mysql is required for database operations');
  }
  if (!enabled(environment.ALLOW_DEMO_SEED)) {
    throw new Error('Demo seed is disabled; set ALLOW_DEMO_SEED=true to proceed');
  }
  const nodeEnvironment = environment.NODE_ENV?.trim();
  const isExplicitlyNonProduction = nodeEnvironment === 'development' || nodeEnvironment === 'test';
  if (!isExplicitlyNonProduction && !enabled(environment.ALLOW_PRODUCTION_DEMO_SEED)) {
    throw new Error(
      'Production demo seed is disabled; also set ALLOW_PRODUCTION_DEMO_SEED=true to proceed',
    );
  }
}

export async function runSeedCli(options = {}) {
  const {
    argv = process.argv.slice(2),
    environment = process.env,
    rootDirectory = repositoryRoot,
    createPoolImpl = createMySqlPool,
    readFileImpl = readFile,
    splitSqlStatementsImpl = splitSqlStatements,
    writeOutput = (message) => process.stdout.write(message),
  } = options;
  const args = parseSeedArguments(argv);
  if (args.help) {
    writeOutput(usage);
    return 0;
  }

  requireSeedGate(environment);
  const config = loadMySqlConfig(environment);
  const file = resolve(rootDirectory, args.file ?? 'database/seeds/001_demo.sql');
  const contents = await readFileImpl(file, 'utf8');
  const statements = splitSqlStatementsImpl(contents).map(makeSeedStatementIdempotent);
  if (statements.length === 0) throw new Error(`No seed statements found in ${file}`);

  const lockName = databaseLockName(config.database);
  const pool = createPoolImpl({ ...config, connectionLimit: 1 });
  let connection;
  let lockAcquired = false;
  let transactionStarted = false;
  let failure;

  try {
    connection = await pool.getConnection();
    await acquireDatabaseLock(connection, lockName, args.lockTimeoutSeconds);
    lockAcquired = true;
    await connection.beginTransaction();
    transactionStarted = true;
    for (const statement of statements) await connection.execute(statement);
    await connection.commit();
    transactionStarted = false;
  } catch (error) {
    failure = error;
    if (connection && transactionStarted) {
      try {
        await connection.rollback();
      } catch {
        // Preserve the original database error; rollback failure will surface in server logs.
      }
      transactionStarted = false;
    }
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
  writeOutput(`Demo seed verified: ${statements.length} statements from ${file}\n`);
  return statements.length;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  runSeedCli().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Database seed failed: ${message}\n`);
    process.exitCode = 1;
  });
}
