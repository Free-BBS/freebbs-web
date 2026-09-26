import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  calculateChecksum,
  defaultMigrationsDirectory,
  discoverMigrations,
  splitSqlStatements,
} from './migrate.js';

const databaseDirectory = fileURLToPath(new URL('../../../../../database/', import.meta.url));
const migrationsDirectory = fileURLToPath(
  new URL('../../../../../database/migrations/', import.meta.url),
);

describe('database migrations', () => {
  it('resolves the development migration directory independently of the caller cwd', () => {
    expect(defaultMigrationsDirectory()).toBe(migrationsDirectory);
  });

  it('defines every core and domain table in explicit migrations', async () => {
    const migrations = await discoverMigrations(`${databaseDirectory}/migrations`);
    expect(migrations.map(({ name }) => name)).toEqual([
      '001_core.sql',
      '002_domains.sql',
      '003_tag_definition_contract.sql',
      '004_production_governance.sql',
      '005_business_workflows.sql',
      '006_domain_reference_integrity.sql',
      '007_platform_content_update.sql',
      '008_module_readability_fields.sql',
      '009_liaison_problem_board.sql',
      '010_student_festival.sql',
      '011_wu_sports.sql',
      '012_sports_match_results.sql',
      '013_information_feed.sql',
      '014_development_access.sql',
      '015_collections.sql',
    ]);

    const sql = (await Promise.all(migrations.map(({ path }) => readFile(path, 'utf8')))).join(
      '\n',
    );
    const requiredTables = [
      'development_schema_migrations',
      'subjects',
      'development_access_grants',
      'roles',
      'permissions',
      'role_permissions',
      'role_assignments',
      'tag_definitions',
      'tag_assignments',
      'tag_permissions',
      'modules',
      'module_owners',
      'proposals',
      'audit_logs',
      'knowledge_entries',
      'announcements',
      'activity_milestones',
      'competition_fixtures',
      'consultations',
      'clubs',
      'club_memberships',
      'activities',
      'activity_registrations',
      'sports_teams',
      'sports_team_members',
      'sports_checkins',
      'sports_matches',
      'sports_team_showcases',
      'liaison_resources',
      'liaison_problems',
      'liaison_teams',
      'liaison_team_members',
      'liaison_posts',
      'liaison_outcomes',
      'finance_records',
      'festival_submissions',
      'information_replies',
      'information_likes',
      'collection_forms',
      'collection_versions',
      'collection_responses',
      'showcase_articles',
      'showcase_likes',
    ];

    for (const table of requiredTables) {
      expect(sql).toMatch(
        new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${table}\\b`, 'i'),
      );
    }
  });

  it('guards existing orphan rows before adding every domain reference constraint', async () => {
    const migration = await readFile(
      `${databaseDirectory}/migrations/006_domain_reference_integrity.sql`,
      'utf8',
    );
    const normalized = migration.replace(/\s+/g, ' ');
    expect(() => splitSqlStatements(migration)).not.toThrow();
    expect(normalized.match(/SIGNAL SQLSTATE '45000'/g)).toHaveLength(1);
    expect(normalized.match(/CALL freebbs_fail_domain_reference_integrity/g)).toHaveLength(8);
    for (const constraint of [
      'fk_club_memberships_club',
      'fk_club_memberships_subject',
      'fk_activities_club',
      'fk_activity_registrations_activity',
      'fk_activity_registrations_subject',
      'fk_sports_checkins_team',
      'fk_sports_checkins_subject',
      'fk_finance_records_activity',
    ]) {
      expect(normalized).toContain(`ADD CONSTRAINT ${constraint}`);
    }
  });
  it('keeps business workflow DDL retry-aware and maps legacy states exactly', async () => {
    const migration = await readFile(
      `${databaseDirectory}/migrations/005_business_workflows.sql`,
      'utf8',
    );
    const normalized = migration.replace(/\s+/g, ' ');
    expect(() => splitSqlStatements(migration)).not.toThrow();
    expect(migration).not.toMatch(/^\s*DELIMITER\b/im);
    expect(normalized).toContain('FROM information_schema.columns');
    expect(normalized).toContain('PREPARE business_workflow_statement');
    expect(normalized).toContain('CREATE TABLE IF NOT EXISTS sports_team_members');
    expect(normalized).toContain('CREATE TEMPORARY TABLE business_workflow_schema_guard');
    expect(normalized).toContain(
      "column_type = 'enum(''not_requested'',''requested'',''confirmed'')'",
    );
    expect(normalized).toContain("SELECT 'sports_team_members.columns', 9 - COUNT(*)");
    expect(normalized).toContain("SELECT 'consultations.assignee_uid.orphans', COUNT(*)");
    expect(normalized).toContain("DEFAULT ''not_requested''");
    expect(normalized).toContain("WHEN status = 'submitted' THEN 'open'");
    expect(normalized).toContain("WHEN status IN ('triaged', 'processing') THEN 'in_progress'");
    expect(normalized).toContain("WHEN status = 'open' THEN 'published'");
    expect(normalized).toContain("WHEN status IN ('closed', 'completed') THEN 'finished'");
    expect(normalized).toContain("WHEN status = 'cancelled' THEN 'archived'");
    expect(normalized).toContain("WHERE status = 'settled'");
    expect(normalized).toContain("UPDATE clubs SET status = 'active' WHERE status = 'draft'");
    expect(normalized).toContain(
      "UPDATE sports_teams SET status = 'active' WHERE status = 'draft'",
    );
    expect(normalized).toContain('UNIQUE KEY uq_sports_team_member (team_id, member_uid)');
    expect(normalized).toContain(
      'ALTER TABLE consultations ADD CONSTRAINT fk_consultations_assignee',
    );
    expect(normalized).toContain('FOREIGN KEY (assignee_uid) REFERENCES subjects(uid)');
    expect(normalized).toContain(
      'ALTER TABLE sports_team_members ADD CONSTRAINT fk_sports_team_members_team',
    );
    expect(normalized).toContain('FOREIGN KEY (team_id) REFERENCES sports_teams(id)');
    expect(normalized).toContain('FOREIGN KEY (member_uid) REFERENCES subjects(uid)');
  });
  it('calculates stable checksums and includes useful demo records', async () => {
    expect(calculateChecksum('SELECT 1;')).toBe(calculateChecksum('SELECT 1;'));
    expect(calculateChecksum('SELECT 1;')).not.toBe(calculateChecksum('SELECT 2;'));

    const seed = await readFile(`${databaseDirectory}/seeds/001_demo.sql`, 'utf8');
    for (const table of [
      'knowledge_entries',
      'announcements',
      'consultations',
      'clubs',
      'activities',
      'sports_teams',
      'sports_team_members',
      'liaison_resources',
      'finance_records',
    ]) {
      expect(
        seed.match(new RegExp(`INSERT\\s+INTO\\s+${table}\\b`, 'gi'))?.length,
      ).toBeGreaterThanOrEqual(1);
      const values =
        seed.match(new RegExp(`INSERT\\s+INTO\\s+${table}[\\s\\S]*?;`, 'i'))?.[0] ?? '';
      expect((values.match(/\),\s*\(/g) ?? []).length).toBeGreaterThanOrEqual(1);
    }
    for (const table of [
      'liaison_problems',
      'liaison_teams',
      'liaison_team_members',
      'liaison_posts',
      'liaison_outcomes',
    ]) {
      expect(seed).toMatch(new RegExp(`INSERT\\s+INTO\\s+${table}\\b`, 'i'));
    }
    expect(seed).toContain("'lab', '校园计算实验室'");
    expect(seed).toContain("'company', '校企联合创新伙伴'");
    expect(seed.match(/INSERT INTO liaison_teams[\s\S]*?;/)?.[0]).toContain(
      "'liaison-problem-lab-energy'",
    );
    expect(seed.match(/INSERT INTO liaison_outcomes[\s\S]*?;/)?.[0]).toContain("'adopted'");
  });
});
