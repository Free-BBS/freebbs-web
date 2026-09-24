import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { Pool } from 'mysql2/promise';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { discoverMigrations } from './migrate.js';
import { checkMySqlReadiness } from './mysql-readiness.js';

const temporaryDirectories: string[] = [];

async function migrationDirectory(files: Record<string, string>): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'freebbs-readiness-'));
  temporaryDirectories.push(directory);
  await Promise.all(
    Object.entries(files).map(([name, contents]) => writeFile(join(directory, name), contents)),
  );
  return directory;
}

function checksum(contents: string): string {
  return createHash('sha256').update(contents, 'utf8').digest('hex');
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe('MySQL readiness', () => {
  it('rejects an empty repository migration directory', async () => {
    const directory = await migrationDirectory({});
    const execute = vi
      .fn()
      .mockResolvedValueOnce([[{ alive: 1 }]])
      .mockResolvedValueOnce([[]]);

    await expect(checkMySqlReadiness({ execute } as unknown as Pool, directory)).rejects.toThrow();
  });

  it('probes MySQL and requires an exact migration filename and checksum match', async () => {
    const first = 'CREATE TABLE first_table (id INT);\n';
    const second = 'CREATE TABLE second_table (id INT);\n';
    const directory = await migrationDirectory({
      '001_first.sql': first,
      '002_second.sql': second,
    });
    const execute = vi
      .fn()
      .mockResolvedValueOnce([[{ alive: 1 }]])
      .mockResolvedValueOnce([
        [
          { name: '001_first.sql', checksum: checksum(first) },
          { name: '002_second.sql', checksum: checksum(second) },
        ],
      ]);

    await expect(
      checkMySqlReadiness({ execute } as unknown as Pool, directory),
    ).resolves.toBeUndefined();
    expect(execute).toHaveBeenNthCalledWith(1, 'SELECT 1');
    expect(execute).toHaveBeenNthCalledWith(
      2,
      'SELECT name, checksum FROM development_schema_migrations ORDER BY name',
    );
  });

  it.each([
    [[{ name: '001_first.sql', checksum: 'not-a-checksum' }]],
    [
      [
        { name: '001_first.sql', checksum: checksum('CREATE TABLE first_table (id INT);\n') },
        { name: '001_first.sql', checksum: checksum('CREATE TABLE first_table (id INT);\n') },
      ],
    ],
    [[{ name: '../001_first.sql', checksum: checksum('CREATE TABLE first_table (id INT);\n') }]],
    [[{ name: '999_extra.sql', checksum: checksum('CREATE TABLE first_table (id INT);\n') }]],
  ])('rejects invalid, duplicate, extra, or mismatched applied migrations', async (rows) => {
    const contents = 'CREATE TABLE first_table (id INT);\n';
    const directory = await migrationDirectory({ '001_first.sql': contents });
    const execute = vi
      .fn()
      .mockResolvedValueOnce([[{ alive: 1 }]])
      .mockResolvedValueOnce([rows]);

    await expect(checkMySqlReadiness({ execute } as unknown as Pool, directory)).rejects.toThrow();
  });

  it('finds repository migrations when the API starts from its workspace directory', async () => {
    const repositoryRoot = process.cwd();
    const migrations = await discoverMigrations(resolve(repositoryRoot, 'database/migrations'));
    const execute = vi
      .fn()
      .mockResolvedValueOnce([[{ alive: 1 }]])
      .mockResolvedValueOnce([migrations.map(({ name, checksum }) => ({ name, checksum }))]);
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(resolve(repositoryRoot, 'apps/api'));

    try {
      await expect(checkMySqlReadiness({ execute } as unknown as Pool)).resolves.toBeUndefined();
    } finally {
      cwd.mockRestore();
    }
  });
});
