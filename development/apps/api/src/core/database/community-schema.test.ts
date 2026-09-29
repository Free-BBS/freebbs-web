import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'database/migrations/016_community.sql'),
  'utf8',
);

describe('community migration', () => {
  it('creates independent community tables and idempotency constraints', () => {
    for (const table of [
      'community_posts',
      'community_comments',
      'community_supplements',
      'community_likes',
      'community_thread_aliases',
      'community_views',
      'community_reports',
      'community_wish_workflows',
    ]) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
    expect(migration).toContain('UNIQUE KEY uq_community_like');
    expect(migration).toContain('UNIQUE KEY uq_community_alias_user');
    expect(migration).toContain('UNIQUE KEY uq_community_wish_post');
    expect(migration).toContain('UNIQUE KEY uq_activities_source_community_post');
  });
});
