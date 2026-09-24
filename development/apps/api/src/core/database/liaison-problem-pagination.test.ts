import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';

import type { LiaisonProblemVisibility } from './types.js';
import { createMemoryStore } from './memory-store.js';
import { createMySqlStore } from './mysql-store.js';

const visibility: LiaisonProblemVisibility = {
  actorUid: 'student-a',
  publicStatuses: ['open', 'paused', 'closed'],
  read: { all: true, ids: [], deniedIds: ['hidden-problem'] },
  maintain: { all: false, ids: ['maintained-draft'], deniedIds: [] },
  review: { all: false, ids: ['review-problem'], deniedIds: [] },
};

function problemRow(id: string) {
  return {
    id,
    title: id,
    summary: 'summary',
    background: 'background',
    source_type: 'lab',
    source_name: 'lab',
    tags: '[]',
    expected_outcome: 'outcome',
    constraints_text: 'none',
    starts_at: null,
    deadline: null,
    public_contact: 'public',
    internal_contact_note: 'internal',
    recorder_uid: 'recorder',
    reviewer_uid: null,
    reviewed_at: null,
    review_note: null,
    status: 'open',
    owner_uid: 'owner',
    scope_type: 'public',
    scope_id: '*',
    created_at: '2026-09-14 08:00:00.000',
    updated_at: '2026-09-14 08:00:00.000',
  };
}

describe('liaison problem authorized pagination', () => {
  it('keeps the page and filtered total on one memory snapshot during a concurrent insert', async () => {
    const store = createMemoryStore();
    let markStarted = (): void => undefined;
    let releaseSnapshot = (): void => undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const snapshotGate = new Promise<void>((resolve) => {
      releaseSnapshot = resolve;
    });
    const pagePromise = store.transaction(async (transactionStore) => {
      const page = await transactionStore.liaisonProblems.pageVisible(
        undefined,
        { page: 1, pageSize: 10 },
        visibility,
      );
      markStarted();
      await snapshotGate;
      return page;
    });
    await started;
    const insertPromise = store.liaisonProblems.create({
      title: 'Concurrent problem',
      summary: 'Created after the page snapshot.',
      background: 'background',
      sourceType: 'lab',
      sourceName: 'lab',
      tags: [],
      expectedOutcome: 'outcome',
      constraints: 'none',
      startsAt: null,
      deadline: null,
      publicContact: 'public',
      internalContactNote: 'internal',
      recorderUid: 'demo-admin',
      reviewerUid: null,
      reviewedAt: null,
      reviewNote: null,
      status: 'open',
      ownerUid: 'demo-admin',
      scope: { type: 'public', id: '*' },
    });
    releaseSnapshot();

    const page = await pagePromise;
    await insertPromise;
    const after = await store.transaction((transactionStore) =>
      transactionStore.liaisonProblems.pageVisible(
        undefined,
        { page: 1, pageSize: 10 },
        visibility,
      ),
    );

    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(2);
    expect(after.total).toBe(3);
  });

  it('returns a filtered page and total with one count and one bounded select in one transaction', async () => {
    const connection = {
      execute: vi.fn().mockResolvedValueOnce([[{ total: 17 }], []]),
      query: vi.fn().mockResolvedValueOnce([[problemRow('visible-problem')], []]),
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
      release: vi.fn(),
    };
    const pool = {
      getConnection: vi.fn().mockResolvedValue(connection),
      execute: vi.fn(),
      query: vi.fn(),
      end: vi.fn().mockResolvedValue(undefined),
    };
    const handle = createMySqlStore({ pool: pool as unknown as Pool });

    const result = await handle.store.transaction((store) =>
      store.liaisonProblems.pageVisible(
        { query: 'climate', status: 'open', tag: 'data' },
        { page: 2, pageSize: 5 },
        visibility,
      ),
    );

    expect(result).toMatchObject({ page: 2, pageSize: 5, total: 17 });
    expect(result.items.map(({ id }) => id)).toEqual(['visible-problem']);
    expect(connection.execute).toHaveBeenCalledOnce();
    expect(connection.query).toHaveBeenCalledOnce();
    const countSql = String(connection.execute.mock.calls[0]?.[0]);
    const pageSql = String(connection.query.mock.calls[0]?.[0]);
    expect(countSql).toContain('FROM liaison_problems');
    expect(pageSql).toContain('FROM liaison_problems');
    expect(countSql).toContain('id NOT IN (?)');
    expect(countSql).toContain('status IN (?, ?, ?)');
    expect(countSql).toContain('owner_uid = ?');
    expect(countSql).toContain('status = ?');
    expect(pageSql).toMatch(/LIMIT \? OFFSET \?$/);
    expect(connection.query.mock.calls[0]?.[1]).toEqual([
      '"data"',
      'open',
      '%climate%',
      'climate',
      'hidden-problem',
      'open',
      'paused',
      'closed',
      'student-a',
      'maintained-draft',
      'pending_review',
      'review-problem',
      5,
      5,
    ]);
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledOnce();
  });
});
