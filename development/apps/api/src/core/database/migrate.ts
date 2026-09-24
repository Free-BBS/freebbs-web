import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createPool, type Pool, type PoolConnection, type RowDataPacket } from 'mysql2/promise';

import { splitSqlStatements } from './sql-splitter.js';

export { splitSqlStatements } from './sql-splitter.js';

export const migrationFileNamePattern = /^\d+_[a-z0-9_-]+\.sql$/i;

export interface MigrationFile {
  name: string;
  path: string;
  checksum: string;
}

export interface MySqlConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  socketPath?: string;
}

export function calculateChecksum(contents: string): string {
  return createHash('sha256').update(contents, 'utf8').digest('hex');
}

export async function discoverMigrations(directory: string): Promise<MigrationFile[]> {
  const names = (await readdir(directory))
    .filter((name) => migrationFileNamePattern.test(name))
    .sort((left, right) => left.localeCompare(right));
  return Promise.all(
    names.map(async (name) => {
      const path = join(directory, name);
      return { name, path, checksum: calculateChecksum(await readFile(path, 'utf8')) };
    }),
  );
}

function requireEnvironment(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required when DATA_MODE=mysql`);
  return value;
}

export function loadMySqlConfig(environment: NodeJS.ProcessEnv = process.env): MySqlConfig {
  const portText = environment.MYSQL_PORT?.trim() || '3306';
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('MYSQL_PORT must be an integer between 1 and 65535');
  }
  const host = requireEnvironment(environment, 'MYSQL_HOST');
  const user = requireEnvironment(environment, 'MYSQL_USER');
  const database = requireEnvironment(environment, 'MYSQL_DATABASE');
  const socketPath = environment.MYSQL_SOCKET?.trim() || undefined;
  const password =
    environment.NODE_ENV === 'test' && socketPath && environment.MYSQL_PASSWORD !== undefined
      ? environment.MYSQL_PASSWORD
      : requireEnvironment(environment, 'MYSQL_PASSWORD');
  return {
    host,
    port,
    user,
    password,
    database,
    ...(socketPath ? { socketPath } : {}),
  };
}

interface AppliedMigrationRow extends RowDataPacket {
  name: string;
  checksum: string;
}

interface ForeignKeyDefinition {
  table: string;
  constraint: string;
  columns: string[];
  referencedTable: string;
  referencedColumns: string[];
}

interface ForeignKeyUsageRow extends RowDataPacket {
  column_name: string;
  referenced_table_name: string;
  referenced_column_name: string;
}

function parseIdentifierList(value: string): string[] | null {
  const identifiers = value.split(',').map((identifier) => identifier.trim());
  return identifiers.length > 0 &&
    identifiers.every((identifier) => /^[a-z0-9_]+$/i.test(identifier))
    ? identifiers
    : null;
}

function parseForeignKeyDefinition(statement: string): ForeignKeyDefinition | null {
  const match = statement.match(
    /^ALTER\s+TABLE\s+([a-z0-9_]+)\s+ADD\s+CONSTRAINT\s+(fk_[a-z0-9_]+)\s+FOREIGN\s+KEY\s*\(([^)]+)\)\s+REFERENCES\s+([a-z0-9_]+)\s*\(([^)]+)\)\s*$/i,
  );
  if (!match) return null;
  const columns = parseIdentifierList(match[3] ?? '');
  const referencedColumns = parseIdentifierList(match[5] ?? '');
  if (!columns || !referencedColumns || columns.length !== referencedColumns.length) return null;
  return {
    table: match[1] ?? '',
    constraint: match[2] ?? '',
    columns,
    referencedTable: match[4] ?? '',
    referencedColumns,
  };
}

function isDuplicateForeignKeyError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: unknown; errno?: unknown };
  return candidate.code === 'ER_FK_DUP_NAME' || candidate.errno === 1826;
}

async function existingForeignKeyMatches(
  connection: PoolConnection,
  expected: ForeignKeyDefinition,
): Promise<boolean> {
  const [rows] = await connection.execute<ForeignKeyUsageRow[]>(
    `SELECT column_name, referenced_table_name, referenced_column_name, ordinal_position
     FROM information_schema.key_column_usage
     WHERE constraint_schema = DATABASE()
       AND table_name = ?
       AND constraint_name = ?
     ORDER BY ordinal_position`,
    [expected.table, expected.constraint],
  );
  if (rows.length !== expected.columns.length) return false;
  return rows.every(
    (row, index) =>
      String(row.column_name).toLocaleLowerCase() ===
        expected.columns[index]?.toLocaleLowerCase() &&
      String(row.referenced_table_name).toLocaleLowerCase() ===
        expected.referencedTable.toLocaleLowerCase() &&
      String(row.referenced_column_name).toLocaleLowerCase() ===
        expected.referencedColumns[index]?.toLocaleLowerCase(),
  );
}
export async function applyMigration(
  connection: PoolConnection,
  migration: MigrationFile,
): Promise<void> {
  const [rows] = await connection.execute<AppliedMigrationRow[]>(
    'SELECT name, checksum FROM development_schema_migrations WHERE name = ?',
    [migration.name],
  );
  const applied = rows[0];
  if (applied) {
    if (applied.checksum !== migration.checksum) {
      throw new Error(`Migration checksum mismatch: ${migration.name}`);
    }
    return;
  }

  const contents = await readFile(migration.path, 'utf8');
  await connection.beginTransaction();
  try {
    for (const statement of splitSqlStatements(contents)) {
      try {
        await connection.query(statement);
      } catch (error) {
        if (!isDuplicateForeignKeyError(error)) throw error;
        const expected = parseForeignKeyDefinition(statement);
        if (!expected || !(await existingForeignKeyMatches(connection, expected))) throw error;
      }
    }
    await connection.execute(
      'INSERT INTO development_schema_migrations (name, checksum, applied_at) VALUES (?, ?, NOW(3))',
      [migration.name, migration.checksum],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}

export interface MigrationOptions {
  pool?: Pool;
  directory?: string;
  environment?: NodeJS.ProcessEnv;
}

export async function runMigrations(options: MigrationOptions = {}): Promise<string[]> {
  const ownPool = !options.pool;
  const pool =
    options.pool ?? createPool({ ...loadMySqlConfig(options.environment), connectionLimit: 2 });
  const connection = await pool.getConnection();
  try {
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS development_schema_migrations (
        name VARCHAR(255) PRIMARY KEY,
        checksum CHAR(64) NOT NULL,
        applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    const defaultDirectory = resolve(process.cwd(), 'database/migrations');
    const migrations = await discoverMigrations(options.directory ?? defaultDirectory);
    for (const migration of migrations) await applyMigration(connection, migration);
    return migrations.map(({ name }) => name);
  } finally {
    connection.release();
    if (ownPool) await pool.end();
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === invokedPath) {
  runMigrations()
    .then((migrations) => {
      process.stdout.write(`Database migrations verified: ${migrations.join(', ')}\n`);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Database migration failed: ${message}\n`);
      process.exitCode = 1;
    });
}
