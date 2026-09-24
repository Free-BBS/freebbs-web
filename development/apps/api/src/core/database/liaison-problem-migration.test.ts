import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import type { PoolConnection } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';

import { applyMigration, calculateChecksum, splitSqlStatements } from './migrate.js';

const migrationUrl = new URL(
  '../../../../../database/migrations/009_liaison_problem_board.sql',
  import.meta.url,
);
const migrationPath = fileURLToPath(migrationUrl);

describe('liaison problem-board migration', () => {
  it('adds five relational tables without changing the legacy liaison resource table', async () => {
    const sql = await readFile(migrationUrl, 'utf8');
    expect(() => splitSqlStatements(sql)).not.toThrow();
    for (const table of [
      'liaison_problems',
      'liaison_teams',
      'liaison_team_members',
      'liaison_posts',
      'liaison_outcomes',
    ]) {
      expect(sql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`, 'i'));
    }
    expect(sql).toContain('tags JSON NOT NULL');
    expect(sql.match(/DATETIME\(3\)/g)?.length).toBeGreaterThanOrEqual(14);
    expect(sql).toContain('UNIQUE KEY uq_liaison_team_member (problem_id, team_id, member_uid)');
    expect(sql).toContain('UNIQUE KEY uq_liaison_outcome_version (problem_id, team_id, version)');
    for (const constraint of [
      'fk_liaison_teams_problem',
      'fk_liaison_team_members_team',
      'fk_liaison_posts_problem',
      'fk_liaison_outcomes_team',
    ]) {
      expect(sql).toContain(`CONSTRAINT ${constraint}`);
    }
    expect(sql).not.toMatch(/\b(?:ALTER|DROP|DELETE|TRUNCATE)\s+(?:TABLE\s+)?liaison_resources\b/i);
  });

  it('defines searchable and lifecycle indexes for every board aggregate', async () => {
    const sql = await readFile(migrationUrl, 'utf8');
    for (const index of [
      'idx_liaison_problems_status_deadline',
      'idx_liaison_problems_source',
      'idx_liaison_teams_problem_status',
      'idx_liaison_team_members_member',
      'idx_liaison_posts_problem_created',
      'idx_liaison_outcomes_problem_status',
    ]) {
      expect(sql).toContain(`INDEX ${index}`);
    }
  });

  it('retries after MySQL commits part of the DDL before a connection failure', async () => {
    const installedTables = new Set<string>();
    let injectedFailure = false;
    let recordedChecksum: string | undefined;
    const connection = {
      execute: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.startsWith('SELECT name, checksum FROM development_schema_migrations')) {
          return [
            recordedChecksum
              ? [{ name: '009_liaison_problem_board.sql', checksum: recordedChecksum }]
              : [],
            [],
          ];
        }
        if (sql.startsWith('INSERT INTO development_schema_migrations')) {
          recordedChecksum = String(values?.[1]);
        }
        return [[], []];
      }),
      query: vi.fn(async (sql: string) => {
        const table = sql.match(/^CREATE TABLE IF NOT EXISTS ([a-z_]+)/i)?.[1];
        if (!table) throw new Error(`unexpected liaison migration statement: ${sql}`);
        installedTables.add(table);
        if (table === 'liaison_teams' && !injectedFailure) {
          injectedFailure = true;
          throw new Error('connection lost after committed CREATE TABLE');
        }
        return [[], []];
      }),
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
    } as unknown as PoolConnection;
    const sql = await readFile(migrationUrl, 'utf8');
    const checksum = calculateChecksum(sql);
    const migration = {
      name: '009_liaison_problem_board.sql',
      path: migrationPath,
      checksum,
    };

    await expect(applyMigration(connection, migration)).rejects.toThrow(
      'connection lost after committed CREATE TABLE',
    );
    await expect(applyMigration(connection, migration)).resolves.toBeUndefined();

    expect([...installedTables]).toEqual([
      'liaison_problems',
      'liaison_teams',
      'liaison_team_members',
      'liaison_posts',
      'liaison_outcomes',
    ]);
    expect(recordedChecksum).toBe(checksum);
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).toHaveBeenCalledOnce();
  });
});
