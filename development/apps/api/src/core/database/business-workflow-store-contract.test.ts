import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';

import { createMemoryStore } from './memory-store.js';
import { createMySqlStore } from './mysql-store.js';
import { RecordConflictError } from './record-conflict-error.js';

import type { DevelopmentStore } from './types.js';

const publicScope = { type: 'public', id: '*' };
const teamScope = { type: 'sports_team', id: 'team-a' };

function createMySqlTestStore(): DevelopmentStore {
  const rows = new Map<string, Record<string, unknown>>();
  const execute = vi.fn(async (sql: string, values: unknown[] = []) => {
    const insert = sql.match(/^INSERT INTO ([a-z_]+) \(([^)]+)\) VALUES/);
    if (insert) {
      const table = insert[1] ?? '';
      const columns = (insert[2] ?? '').split(',').map((column) => column.trim());
      const row = Object.fromEntries(columns.map((column, index) => [column, values[index]]));
      if (
        table === 'sports_team_members' &&
        [...rows.entries()].some(
          ([key, current]) =>
            key.startsWith(`${table}:`) &&
            current.team_id === row.team_id &&
            current.member_uid === row.member_uid,
        )
      ) {
        throw Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY', errno: 1062 });
      }
      rows.set(`${table}:${String(row.id)}`, row);
      return [{ affectedRows: 1 }, []];
    }

    const select = sql.match(/^SELECT \* FROM ([a-z_]+) WHERE id = \? LIMIT 1/);
    if (select) {
      const row = rows.get(`${select[1]}:${String(values[0])}`);
      return [row ? [row] : [], []];
    }

    const update = sql.match(/^UPDATE ([a-z_]+) SET (.+) WHERE id = \?$/);
    if (update) {
      const key = `${update[1]}:${String(values.at(-1))}`;
      const row = rows.get(key);
      if (!row) return [{ affectedRows: 0 }, []];
      const columns = (update[2] ?? '')
        .split(',')
        .map((assignment) => assignment.trim().match(/^([a-z_]+) = \?$/)?.[1])
        .filter((column): column is string => column !== undefined);
      columns.forEach((column, index) => {
        row[column] = values[index];
      });
      return [{ affectedRows: 1 }, []];
    }

    throw new Error(`Unexpected SQL in business workflow test double: ${sql}`);
  });
  const pool = {
    execute,
    getConnection: vi.fn(),
    end: vi.fn().mockResolvedValue(undefined),
  } as unknown as Pool;
  return createMySqlStore({ pool }).store;
}

function storeCases(): Array<[string, () => DevelopmentStore]> {
  return [
    ['memory', () => createMemoryStore({ seed: false })],
    ['MySQL', createMySqlTestStore],
  ];
}

describe.each(storeCases())('%s business workflow store', (_adapter, createStore) => {
  it('persists consultation handling and club/activity technical support', async () => {
    const store = createStore();
    const consultation = await store.consultations.create({
      title: 'Venue access',
      body: 'How do I reserve the room?',
      requesterUid: 'student-a',
      assigneeUid: null,
      reply: null,
      status: 'open',
      ownerUid: 'student-a',
      scope: publicScope,
    });
    expect(
      await store.consultations.update(consultation.id, {
        assigneeUid: 'staff-a',
        reply: 'Use the venue request form.',
      }),
    ).toMatchObject({
      assigneeUid: 'staff-a',
      reply: 'Use the venue request form.',
    });

    const club = await store.clubs.create({
      name: 'Robotics Club',
      description: 'Build robots together.',
      technicalSupportStatus: 'not_requested',
      technicalSupportNote: null,
      status: 'active',
      ownerUid: 'staff-a',
      scope: publicScope,
    });
    expect(
      await store.clubs.update(club.id, {
        technicalSupportStatus: 'requested',
        technicalSupportNote: 'Projector and network access',
      }),
    ).toMatchObject({
      technicalSupportStatus: 'requested',
      technicalSupportNote: 'Projector and network access',
    });

    const activity = await store.activities.create({
      title: 'Demo Day',
      description: 'Annual project showcase.',
      clubId: club.id,
      startsAt: null,
      technicalSupportStatus: 'requested',
      technicalSupportNote: 'Livestream support',
      status: 'pending',
      ownerUid: 'staff-a',
      scope: publicScope,
    });

    expect(
      await store.activities.update(activity.id, {
        technicalSupportStatus: 'confirmed',
      }),
    ).toMatchObject({
      technicalSupportStatus: 'confirmed',
      technicalSupportNote: 'Livestream support',
    });
  });

  it('applies compatible defaults for audience and organization fields', async () => {
    const store = createStore();
    const knowledge = await store.knowledge.create({
      type: 'faq',
      title: 'General answer',
      body: 'Visible to everyone.',
      status: 'published',
      ownerUid: 'staff-a',
      scope: publicScope,
    });
    expect(knowledge).toMatchObject({ audience: 'general', organizationId: null });

    const club = await store.clubs.create({
      name: 'Open group',
      description: 'Public interest group.',
      technicalSupportStatus: 'not_requested',
      technicalSupportNote: null,
      status: 'active',
      ownerUid: 'staff-a',
      scope: publicScope,
    });
    expect(club.organizationId).toBeNull();

    const activity = await store.activities.create({
      title: 'Open day',
      description: 'Public event.',
      clubId: club.id,
      startsAt: null,
      technicalSupportStatus: 'not_requested',
      technicalSupportNote: null,
      status: 'published',
      ownerUid: 'staff-a',
      scope: publicScope,
    });
    expect(activity).toMatchObject({
      endsAt: null,
      location: '',
      organizationId: null,
      standingActivity: false,
    });
  });

  it('enforces one sports team membership per team and member', async () => {
    const store = createStore();
    const membership = {
      teamId: 'team-a',
      memberUid: 'student-a',
      status: 'active',
      ownerUid: 'staff-a',
      scope: teamScope,
    } as const;

    await expect(store.sportsTeamMembers.create(membership)).resolves.toMatchObject(membership);
    await expect(store.sportsTeamMembers.create(membership)).rejects.toBeInstanceOf(
      RecordConflictError,
    );
  });
});
