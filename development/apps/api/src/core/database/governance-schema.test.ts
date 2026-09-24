import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { splitSqlStatements } from './migrate.js';

const migrationPath = fileURLToPath(
  new URL('../../../../../database/migrations/004_production_governance.sql', import.meta.url),
);

describe('production governance migration', () => {
  it('uses only statements supported by the real migration splitter', async () => {
    const sql = await readFile(migrationPath, 'utf8');

    expect(() => splitSqlStatements(sql)).not.toThrow();
    expect(splitSqlStatements(sql)).not.toHaveLength(0);
    expect(sql).not.toMatch(/\bDELIMITER\b|CREATE\s+PROCEDURE/i);
  });
  it('creates tag permissions and adds governance foreign keys', async () => {
    const sql = await readFile(migrationPath, 'utf8');

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS tag_permissions');
    expect(sql).toContain('FOREIGN KEY (role_key) REFERENCES roles(role_key)');
    expect(sql).toContain(
      'FOREIGN KEY (action, resource) REFERENCES permissions(action, resource)',
    );
    expect(sql).toContain('FOREIGN KEY (subject_uid) REFERENCES subjects(uid)');
    expect(sql).toContain('FOREIGN KEY (tag_key) REFERENCES tag_definitions(tag_key)');
    expect(sql).toContain('FOREIGN KEY (module_id) REFERENCES modules(module_id)');
    expect(sql).not.toMatch(/FOREIGN KEY \(owner_id\)/i);
  });

  it('uses ordinary ALTER statements that the runner can replay safely', async () => {
    const sql = await readFile(migrationPath, 'utf8');
    const constraints = [
      'fk_role_permissions_role',
      'fk_role_permissions_permission',
      'fk_role_assignments_subject',
      'fk_role_assignments_role',
      'fk_tag_permissions_tag',
      'fk_tag_permissions_permission',
      'fk_tag_assignments_subject',
      'fk_tag_assignments_tag',
      'fk_module_owners_module',
    ];

    expect(sql).not.toMatch(/\bPREPARE\b|\bEXECUTE\b|information_schema/i);
    expect(sql.match(/^ALTER TABLE/gm)).toHaveLength(9);
    for (const constraint of constraints) {
      expect(sql).toContain(`ADD CONSTRAINT ${constraint}`);
    }
  });
  it('rejects orphan governance rows before adding constraints', async () => {
    const sql = await readFile(migrationPath, 'utf8');
    const firstForeignKey = sql.indexOf('FOREIGN KEY');

    expect(sql).toContain('CREATE TEMPORARY TABLE production_governance_orphan_guard');
    expect(sql).toContain('CHECK (orphan_count = 0)');
    expect(sql).toMatch(/orphan role_permissions/i);
    expect(sql).toMatch(/orphan role_assignments/i);
    expect(sql).toMatch(/orphan tag_permissions/i);
    expect(sql).toMatch(/orphan tag_assignments/i);
    expect(sql).toMatch(/orphan module_owners/i);
    expect(sql.indexOf('INSERT INTO production_governance_orphan_guard')).toBeLessThan(
      firstForeignKey,
    );
  });
});
