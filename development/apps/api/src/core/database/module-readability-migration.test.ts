import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { splitSqlStatements } from './migrate.js';

describe('module readability migration', () => {
  it('adds every field without removing existing records and backfills JSON tags', async () => {
    const sql = await readFile(
      new URL(
        '../../../../../database/migrations/008_module_readability_fields.sql',
        import.meta.url,
      ),
      'utf8',
    );
    expect(splitSqlStatements(sql).length).toBeGreaterThanOrEqual(8);
    for (const table of [
      'knowledge_entries',
      'consultations',
      'proposals',
      'clubs',
      'activities',
      'sports_teams',
    ]) {
      expect(sql).toContain(`ALTER TABLE ${table}`);
    }
    for (const column of [
      'category',
      'tags',
      'summary',
      'maintained_at',
      'maintainer_uid',
      'due_at',
      'contact_name',
      'public_contact',
      'registration_deadline',
      'capacity',
      'contact',
      'season',
      'training_schedule',
    ]) {
      expect(sql).toContain(`ADD COLUMN ${column} `);
    }
    expect(sql).toMatch(/ADD COLUMN tags JSON NULL/);
    expect(sql).toMatch(/UPDATE knowledge_entries SET tags = JSON_ARRAY\(\) WHERE tags IS NULL/);
    expect(sql).toMatch(/MODIFY COLUMN tags JSON NOT NULL/);
    expect(sql).not.toMatch(/\b(DROP|DELETE|TRUNCATE)\b/i);
  });
});
