import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { splitSqlStatements } from './migrate.js';

const migrationUrl = new URL(
  '../../../../../database/migrations/007_platform_content_update.sql',
  import.meta.url,
);

describe('platform content migration', () => {
  it('adds the new records and compatibility columns without destructive DDL', async () => {
    const sql = await readFile(migrationUrl, 'utf8');

    expect(() => splitSqlStatements(sql)).not.toThrow();
    expect(sql).toContain('CREATE TABLE proposals');
    expect(sql).toContain('CREATE TABLE activity_milestones');
    expect(sql).toContain('CREATE TABLE competition_fixtures');
    expect(sql).toContain('ADD COLUMN audience');
    expect(sql).toContain('ADD COLUMN organization_id');
    expect(sql).not.toMatch(/\bDROP\s+(?:TABLE|COLUMN|DATABASE)\b/iu);
  });
});
