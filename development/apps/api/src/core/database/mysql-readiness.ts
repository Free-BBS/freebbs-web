import { fileURLToPath } from 'node:url';

import type { Pool, RowDataPacket } from 'mysql2/promise';

import { discoverMigrations, migrationFileNamePattern } from './migrate.js';

interface AppliedMigrationRow extends RowDataPacket {
  name: string;
  checksum: string;
}

function defaultMigrationsDirectory(): string {
  return fileURLToPath(new URL('../../../../../database/migrations/', import.meta.url));
}

export async function checkMySqlReadiness(
  pool: Pool,
  migrationsDirectory = defaultMigrationsDirectory(),
): Promise<void> {
  await pool.execute('SELECT 1');
  const migrations = await discoverMigrations(migrationsDirectory);
  if (migrations.length === 0) {
    throw new Error('Repository migration directory is empty');
  }
  const expected = new Map(migrations.map((migration) => [migration.name, migration.checksum]));
  const [rows] = await pool.execute<AppliedMigrationRow[]>(
    'SELECT name, checksum FROM development_schema_migrations ORDER BY name',
  );
  const applied = new Set<string>();

  for (const row of rows) {
    if (
      typeof row.name !== 'string' ||
      !migrationFileNamePattern.test(row.name) ||
      typeof row.checksum !== 'string' ||
      applied.has(row.name) ||
      expected.get(row.name) !== row.checksum
    ) {
      throw new Error('Applied migrations do not match repository migrations');
    }
    applied.add(row.name);
  }

  if (applied.size !== expected.size) {
    throw new Error('Applied migrations do not match repository migrations');
  }
}
