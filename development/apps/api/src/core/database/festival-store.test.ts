import { readFile } from 'node:fs/promises';

import * as contracts from '@freebbs-development/contracts';
import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';

import { createMemoryStore } from './memory-store.js';
import { splitSqlStatements } from './migrate.js';
import { createMySqlStore } from './mysql-store.js';
import type { FestivalSubmissionRecord, NewRecord } from './types.js';

const input: NewRecord<FestivalSubmissionRecord> = {
  title: 'Student performance',
  description: 'A student festival submission',
  authorName: 'Student',
  ownerUid: 'student-1',
  scope: { type: 'public', id: '*' },
  status: 'private',
  displayConsent: false,
  mimeType: 'video/mp4',
  sizeBytes: 1024,
  storageKey: 'generated-key.mp4',
};

describe('festival reviewer contract', () => {
  it('allows exactly the arts reviewers, Youth League lead and platform administrator', () => {
    const allowed = new Set([
      'department.arts_member',
      'department.arts_director',
      'domain.arts_lead',
      'affiliation.tuanwei_lead',
      'platform.super_admin',
    ]);
    expect(contracts.canReviewFestival).toBeTypeOf('function');
    for (const role of contracts.ROLE_KEYS) {
      expect(contracts.canReviewFestival({ roles: [role] }), role).toBe(allowed.has(role));
    }
    expect(contracts.canReviewFestival({ roles: [] })).toBe(false);
    expect(contracts.canReviewFestival(null)).toBe(false);
  });
});

describe('festival memory persistence', () => {
  it('starts empty even when demo data is enabled and preserves private metadata', async () => {
    const store = createMemoryStore();
    expect(await store.festivalSubmissions.list()).toEqual([]);
    const created = await store.festivalSubmissions.create(input);
    expect(created).toMatchObject({
      ...input,
      reviewerUid: null,
      reviewedAt: null,
      reviewNote: '',
    });
    expect(await store.festivalSubmissions.get(created.id)).toEqual(created);
    expect(
      await store.festivalSubmissions.page({ status: 'private' }, { page: 1, pageSize: 12 }),
    ).toMatchObject({ items: [created], total: 1 });
  });

  it('commits reviewed metadata with UTC timestamps and rolls back failed changes', async () => {
    const store = createMemoryStore({ seed: false });
    const created = await store.festivalSubmissions.create({
      ...input,
      displayConsent: true,
      status: 'pending',
    });
    await store.transaction(async (tx) => {
      expect(await tx.festivalSubmissions.getForUpdate(created.id)).toEqual(created);
      await tx.festivalSubmissions.update(created.id, {
        status: 'approved',
        reviewerUid: 'reviewer-1',
        reviewedAt: '2026-09-15T16:00:00+08:00',
        reviewNote: 'Approved',
      });
    });
    const approved = await store.festivalSubmissions.get(created.id);
    expect(approved).toMatchObject({
      status: 'approved',
      reviewerUid: 'reviewer-1',
      reviewedAt: '2026-09-15T08:00:00.000Z',
      reviewNote: 'Approved',
    });
    await expect(
      store.transaction(async (tx) => {
        await tx.festivalSubmissions.update(created.id, { status: 'rejected' });
        throw new Error('audit unavailable');
      }),
    ).rejects.toThrow('audit unavailable');
    expect(await store.festivalSubmissions.get(created.id)).toEqual(approved);
  });

  it.each([0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid byte sizes (%s)',
    async (sizeBytes) => {
      const store = createMemoryStore({ seed: false });
      await expect(store.festivalSubmissions.create({ ...input, sizeBytes })).rejects.toThrow(
        'sizeBytes',
      );
    },
  );
});

describe('festival MySQL persistence', () => {
  it('binds submission metadata and decodes consent, byte size and review timestamps', async () => {
    const row = {
      id: 'festival-1',
      title: input.title,
      description: input.description,
      author_name: input.authorName,
      owner_uid: input.ownerUid,
      scope_type: 'public',
      scope_id: '*',
      status: 'private',
      display_consent: 0,
      mime_type: input.mimeType,
      size_bytes: '1024',
      storage_key: input.storageKey,
      reviewer_uid: null,
      reviewed_at: null,
      review_note: '',
      created_at: '2026-09-15 08:00:00.000',
      updated_at: '2026-09-15 08:00:00.000',
    };
    const pool = {
      execute: vi
        .fn()
        .mockResolvedValueOnce([{ affectedRows: 1 }, []])
        .mockResolvedValueOnce([[row], []]),
    };
    const store = createMySqlStore({ pool: pool as unknown as Pool }).store;
    expect(await store.festivalSubmissions.create(input)).toMatchObject({
      ...input,
      reviewerUid: null,
      reviewedAt: null,
      reviewNote: '',
    });
    const [sql, values] = pool.execute.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/^INSERT INTO festival_submissions/);
    expect(sql).not.toContain(input.title);
    expect(sql).toContain('storage_key');
    expect(values).toEqual(
      expect.arrayContaining([input.title, input.storageKey, 0, 1024, null, '']),
    );
    pool.execute.mockResolvedValueOnce([
      [{ ...row, display_consent: 1, reviewed_at: '2026-09-15 09:30:00.000' }],
      [],
    ]);
    expect(await store.festivalSubmissions.get(row.id)).toMatchObject({
      displayConsent: true,
      reviewedAt: '2026-09-15T09:30:00.000Z',
    });
  });

  it('locks festival records through the transaction connection', async () => {
    const connection = {
      execute: vi.fn().mockResolvedValue([[], []]),
      beginTransaction: vi.fn(),
      commit: vi.fn(),
      rollback: vi.fn(),
      release: vi.fn(),
    };
    const pool = { execute: vi.fn(), getConnection: vi.fn().mockResolvedValue(connection) };
    const store = createMySqlStore({ pool: pool as unknown as Pool }).store;
    await store.transaction((tx) => tx.festivalSubmissions.getForUpdate('festival-1'));
    expect(connection.execute).toHaveBeenCalledWith(
      'SELECT * FROM festival_submissions WHERE id = ? LIMIT 1 FOR UPDATE',
      ['festival-1'],
    );
    expect(pool.execute).not.toHaveBeenCalled();
    expect(connection.commit).toHaveBeenCalledOnce();
  });
});

describe('festival migration', () => {
  it('defines an additive rerunnable metadata table with consent and ownership indexes', async () => {
    const sql = await readFile(
      new URL('../../../../../database/migrations/010_student_festival.sql', import.meta.url),
      'utf8',
    );
    const statements = splitSqlStatements(sql);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/^CREATE TABLE IF NOT EXISTS festival_submissions/);
    expect(sql).toContain("ENUM('private', 'pending', 'approved', 'rejected')");
    expect(sql).toContain('display_consent BOOLEAN NOT NULL DEFAULT FALSE');
    expect(sql).toContain('size_bytes BIGINT UNSIGNED NOT NULL');
    expect(sql).toContain('reviewed_at DATETIME(3) NULL');
    expect(sql).toContain('review_note TEXT NOT NULL');
    expect(sql).toContain('(status, display_consent, created_at, id)');
    expect(sql).toContain('(owner_uid, created_at, id)');
    expect(sql).not.toMatch(/\b(?:INSERT|DROP|ALTER|DELETE)\b/i);
  });
});
