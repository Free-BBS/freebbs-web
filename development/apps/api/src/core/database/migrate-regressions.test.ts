import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import type { PoolConnection } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';

import { applyMigration, calculateChecksum, splitSqlStatements } from './migrate.js';

const governanceMigrationPath = fileURLToPath(
  new URL('../../../../../database/migrations/004_production_governance.sql', import.meta.url),
);

describe('migration parser and integrity regressions', () => {
  it('does not split semicolons inside quoted values, identifiers or comments', () => {
    const statements = splitSqlStatements(`
      INSERT INTO notes (body) VALUES ('single;quote');
      -- line comment with ; delimiter
      INSERT INTO notes (body) VALUES ("double;quote");
      /* block comment with ; delimiter */ SELECT \`semi;identifier\` FROM notes;
    `);

    expect(statements).toHaveLength(3);
    expect(statements[0]).toContain("'single;quote'");
    expect(statements[1]).toContain('"double;quote"');
    expect(statements[2]).toContain('`semi;identifier`');
  });

  it('explicitly rejects DELIMITER directives', () => {
    expect(() => splitSqlStatements('DELIMITER //\nCREATE PROCEDURE p() SELECT 1//')).toThrow(
      'DELIMITER',
    );
  });

  it('rejects an already-applied migration whose checksum changed', async () => {
    const connection = {
      execute: vi.fn().mockResolvedValue([[{ name: '001_core.sql', checksum: 'old' }], []]),
    } as unknown as PoolConnection;

    await expect(
      applyMigration(connection, {
        name: '001_core.sql',
        path: 'must-not-be-read.sql',
        checksum: 'new',
      }),
    ).rejects.toThrow('Migration checksum mismatch: 001_core.sql');
  });
  it('retries governance migration after MySQL commits partial DDL', async () => {
    const installedConstraints = new Map<string, string>();

    let injectedFailure = false;
    let recordedChecksum: string | undefined;
    const connection = {
      execute: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.startsWith('SELECT name, checksum FROM development_schema_migrations')) {
          const rows = recordedChecksum
            ? [{ name: '004_production_governance.sql', checksum: recordedChecksum }]
            : [];
          return [rows, []];
        }
        if (sql.startsWith('ALTER TABLE')) {
          const definition = sql.match(
            /ALTER\s+TABLE\s+([a-z0-9_]+)\s+ADD\s+CONSTRAINT\s+([a-z0-9_]+)\s+FOREIGN\s+KEY\s*\(([^)]+)\)\s+REFERENCES\s+([a-z0-9_]+)\s*\(([^)]+)\)/i,
          );
          if (!definition) throw new Error('foreign-key definition missing');
          const [, table, constraint, columns, referencedTable, referencedColumns] = definition;
          if (!constraint) throw new Error('foreign-key constraint name missing');
          if (installedConstraints.has(constraint)) {
            throw Object.assign(
              new Error(`Duplicate foreign key constraint name '${constraint}'`),
              {
                code: 'ER_FK_DUP_NAME',
                errno: 1826,
              },
            );
          }
          installedConstraints.set(
            constraint,
            `${table}(${columns?.replace(/\s/g, '')})->${referencedTable}(${referencedColumns?.replace(/\s/g, '')})`,
          );
          if (!injectedFailure) {
            injectedFailure = true;
            throw new Error('connection lost after committed ALTER TABLE');
          }
        }
        if (sql.includes('FROM information_schema.key_column_usage')) {
          return [
            [
              {
                column_name: 'role_key',
                referenced_table_name: 'roles',
                referenced_column_name: 'role_key',
                ordinal_position: 1,
              },
            ],
            [],
          ];
        }
        if (sql.startsWith('INSERT INTO development_schema_migrations')) {
          recordedChecksum = String(values?.[1]);
        }
        return [[], []];
      }),
      query: vi.fn(),
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
    } as unknown as PoolConnection;
    (connection.query as unknown as ReturnType<typeof vi.fn>).mockImplementation((sql: string) =>
      connection.execute(sql),
    );
    const sql = await readFile(governanceMigrationPath, 'utf8');
    const checksum = calculateChecksum(sql);
    const migration = {
      name: '004_production_governance.sql',
      path: governanceMigrationPath,
      checksum,
    };

    await expect(applyMigration(connection, migration)).rejects.toThrow(
      'connection lost after committed ALTER TABLE',
    );
    await expect(applyMigration(connection, migration)).resolves.toBeUndefined();

    expect(Object.fromEntries(installedConstraints)).toEqual({
      fk_role_permissions_role: 'role_permissions(role_key)->roles(role_key)',
      fk_role_permissions_permission:
        'role_permissions(action,resource)->permissions(action,resource)',
      fk_role_assignments_subject: 'role_assignments(subject_uid)->subjects(uid)',
      fk_role_assignments_role: 'role_assignments(role_key)->roles(role_key)',
      fk_tag_permissions_tag: 'tag_permissions(tag_key)->tag_definitions(tag_key)',
      fk_tag_permissions_permission:
        'tag_permissions(action,resource)->permissions(action,resource)',
      fk_tag_assignments_subject: 'tag_assignments(subject_uid)->subjects(uid)',
      fk_tag_assignments_tag: 'tag_assignments(tag_key)->tag_definitions(tag_key)',
      fk_module_owners_module: 'module_owners(module_id)->modules(module_id)',
    });
    expect(recordedChecksum).toBe(checksum);
    const execute = connection.execute as unknown as ReturnType<typeof vi.fn>;
    const ledgerInserts = execute.mock.calls.filter(([statement]) =>
      String(statement).startsWith('INSERT INTO development_schema_migrations'),
    );
    expect(ledgerInserts).toEqual([
      [
        'INSERT INTO development_schema_migrations (name, checksum, applied_at) VALUES (?, ?, NOW(3))',
        ['004_production_governance.sql', checksum],
      ],
    ]);
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).toHaveBeenCalledOnce();
  });
  it('rejects a duplicate foreign-key name whose stored definition differs', async () => {
    let duplicateThrown = false;
    const connection = {
      execute: vi.fn(async (sql: string) => {
        if (sql.startsWith('SELECT name, checksum FROM development_schema_migrations'))
          return [[], []];
        if (sql.includes('FROM information_schema.key_column_usage')) {
          return [
            [
              {
                column_name: 'role_key',
                referenced_table_name: 'roles',
                referenced_column_name: 'different_role_key',
                ordinal_position: 1,
              },
            ],
            [],
          ];
        }
        if (sql.startsWith('ALTER TABLE') && !duplicateThrown) {
          duplicateThrown = true;
          throw Object.assign(new Error('Duplicate foreign key constraint name'), {
            code: 'ER_FK_DUP_NAME',
            errno: 1826,
          });
        }
        return [[], []];
      }),
      query: vi.fn(),
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
    } as unknown as PoolConnection;
    (connection.query as unknown as ReturnType<typeof vi.fn>).mockImplementation((sql: string) =>
      connection.execute(sql),
    );
    const sql = await readFile(governanceMigrationPath, 'utf8');

    await expect(
      applyMigration(connection, {
        name: '004_production_governance.sql',
        path: governanceMigrationPath,
        checksum: calculateChecksum(sql),
      }),
    ).rejects.toMatchObject({ code: 'ER_FK_DUP_NAME', errno: 1826 });
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
  });
});
