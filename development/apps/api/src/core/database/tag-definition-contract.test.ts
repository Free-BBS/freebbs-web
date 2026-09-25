import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';

import { createMemoryStore } from './memory-store.js';
import { discoverMigrations } from './migrate.js';
import { createMySqlStore } from './mysql-store.js';
import { RecordConflictError } from './record-conflict-error.js';

const databaseDirectory = fileURLToPath(new URL('../../../../../database/', import.meta.url));

describe('tag definition contract', () => {
  it('keeps scope requirements and extension metadata in memory', async () => {
    const store = createMemoryStore();
    const captain = (await store.tagDefinitions.list({ query: 'sports.team_captain' })).find(
      ({ key }) => key === 'sports.team_captain',
    );
    expect(captain).toMatchObject({
      ownerUid: 'demo-admin',
      requiredScopeType: 'sports_team',
      metadata: { resourceTypes: ['sports_team'] },
      status: 'active',
    });

    const created = await store.tagDefinitions.create({
      key: 'clubs.coordinator',
      name: 'Club coordinator',
      description: 'Applies only to the selected club.',
      requiredScopeType: 'club',
      metadata: { resourceTypes: ['club'], maintainedBy: 'community-team' },
      status: 'active',
      ownerUid: 'community-team',
      scope: { type: 'public', id: '*' },
    });
    expect(await store.tagDefinitions.get(created.id)).toMatchObject({
      requiredScopeType: 'club',
      metadata: { resourceTypes: ['club'], maintainedBy: 'community-team' },
    });
  });

  it('maps scope requirements and metadata through the MySQL adapter', async () => {
    const timestamp = '2026-07-22 08:09:10.123';
    const row = {
      id: 'tag-club-coordinator',
      tag_key: 'clubs.coordinator',
      name: 'Club coordinator',
      description: 'Applies only to the selected club.',
      required_scope_type: 'club',
      metadata: JSON.stringify({ resourceTypes: ['club'] }),
      status: 'active',
      owner_uid: 'community-team',
      scope_type: 'public',
      scope_id: '*',
      created_at: timestamp,
      updated_at: timestamp,
    };
    const pool = {
      execute: vi
        .fn()
        .mockResolvedValueOnce([{ affectedRows: 1 }, []])
        .mockResolvedValueOnce([[row], []]),
      end: vi.fn().mockResolvedValue(undefined),
    } as unknown as Pool;
    const handle = createMySqlStore({ pool });

    const created = await handle.store.tagDefinitions.create({
      key: row.tag_key,
      name: row.name,
      description: row.description,
      requiredScopeType: 'club',
      metadata: { resourceTypes: ['club'] },
      status: 'active',
      ownerUid: 'community-team',
      scope: { type: 'public', id: '*' },
    });

    const execute = pool.execute as ReturnType<typeof vi.fn>;
    expect(execute.mock.calls[0]?.[0]).toContain('required_scope_type');
    expect(execute.mock.calls[0]?.[0]).toContain('metadata');
    expect(execute.mock.calls[0]?.[1]).toContain('club');
    expect(execute.mock.calls[0]?.[1]).toContain(JSON.stringify({ resourceTypes: ['club'] }));
    expect(created).toMatchObject({
      requiredScopeType: 'club',
      metadata: { resourceTypes: ['club'] },
    });
  });

  it('stores tag permissions through both adapters', async () => {
    const input = {
      tagKey: 'sports.team_captain',
      action: 'sports.checkin.manage',
      resource: 'sports_team',
      effect: 'allow',
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'public', id: '*' },
    } as const;
    const memory = createMemoryStore({ seed: false });
    await expect(memory.tagPermissions.create(input)).resolves.toMatchObject(input);

    const timestamp = '2026-07-22 08:09:10.123';
    const row = {
      id: 'tag-permission-captain',
      tag_key: input.tagKey,
      action: input.action,
      resource: input.resource,
      effect: input.effect,
      status: input.status,
      owner_uid: input.ownerUid,
      scope_type: input.scope.type,
      scope_id: input.scope.id,
      created_at: timestamp,
      updated_at: timestamp,
    };
    const pool = {
      execute: vi
        .fn()
        .mockResolvedValueOnce([{ affectedRows: 1 }, []])
        .mockResolvedValueOnce([[row], []]),
      end: vi.fn().mockResolvedValue(undefined),
    } as unknown as Pool;
    const mysql = createMySqlStore({ pool });

    await expect(mysql.store.tagPermissions.create(input)).resolves.toMatchObject(input);
    const execute = pool.execute as ReturnType<typeof vi.fn>;
    expect(execute.mock.calls[0]?.[0]).toContain('INSERT INTO tag_permissions');
    expect(execute.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining([input.tagKey, input.action]),
    );
  });

  it('rejects duplicate tag permission creates in both adapters', async () => {
    const input = {
      tagKey: 'sports.team_captain',
      action: 'sports.checkin.manage',
      resource: 'sports_team',
      effect: 'allow',
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'sports_team', id: 'team-a' },
    } as const;
    const memory = createMemoryStore({ seed: false });
    await memory.tagPermissions.create(input);
    await expect(memory.tagPermissions.create(input)).rejects.toBeInstanceOf(RecordConflictError);

    const duplicate = Object.assign(new Error('Duplicate entry secret database key'), {
      code: 'ER_DUP_ENTRY',
      errno: 1062,
    });
    const pool = {
      execute: vi.fn().mockRejectedValueOnce(duplicate),
      end: vi.fn().mockResolvedValue(undefined),
    } as unknown as Pool;
    const mysql = createMySqlStore({ pool });
    const failure = mysql.store.tagPermissions.create(input);
    await expect(failure).rejects.toMatchObject({
      name: 'RecordConflictError',
      message: 'Tag permission already exists',
    });
    await expect(failure).rejects.not.toThrow(/secret database key/);
  });

  it('rejects duplicate-producing tag permission updates in both adapters', async () => {
    const first = {
      tagKey: 'sports.team_captain',
      action: 'sports.checkin.manage',
      resource: 'sports_team',
      effect: 'allow',
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'sports_team', id: 'team-a' },
    } as const;
    const second = { ...first, action: 'sports.team.manage' as const };
    const memory = createMemoryStore({ seed: false });
    await memory.tagPermissions.create(first);
    const secondRecord = await memory.tagPermissions.create(second);
    await expect(
      memory.tagPermissions.update(secondRecord.id, { action: first.action }),
    ).rejects.toBeInstanceOf(RecordConflictError);
    expect(await memory.tagPermissions.get(secondRecord.id)).toMatchObject({
      action: second.action,
    });

    const duplicate = Object.assign(new Error('Duplicate entry secret database key'), {
      code: 'ER_DUP_ENTRY',
      errno: 1062,
    });
    const pool = {
      execute: vi.fn().mockRejectedValueOnce(duplicate),
      end: vi.fn().mockResolvedValue(undefined),
    } as unknown as Pool;
    const mysql = createMySqlStore({ pool });
    const failure = mysql.store.tagPermissions.update('tag-permission-b', {
      action: first.action,
    });
    await expect(failure).rejects.toMatchObject({
      name: 'RecordConflictError',
      message: 'Tag permission already exists',
    });
    await expect(failure).rejects.not.toThrow(/secret database key/);
  });

  it('adds the tag definition fields in an append-only migration and demo seed', async () => {
    const migrations = await discoverMigrations(`${databaseDirectory}/migrations`);
    expect(migrations.map(({ name }) => name)).toContain('003_tag_definition_contract.sql');
    const migration = await readFile(
      `${databaseDirectory}/migrations/003_tag_definition_contract.sql`,
      'utf8',
    );
    expect(migration).toMatch(/required_scope_type/i);
    expect(migration).toMatch(/metadata/i);
    expect(migration).toMatch(
      /SET required_scope_type = 'sports_team'[\s\S]*WHERE tag_key = 'sports\.team_captain'/i,
    );

    const seed = await readFile(`${databaseDirectory}/seeds/001_demo.sql`, 'utf8');
    expect(seed).toMatch(/tag_definitions[\s\S]*required_scope_type[\s\S]*metadata/i);
    expect(seed).toMatch(/sports\.team_captain[\s\S]*sports_team/i);
  });
});
