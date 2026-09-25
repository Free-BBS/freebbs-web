import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';
import { createMemoryStore } from './memory-store.js';
import { createMySqlStore } from './mysql-store.js';
import { decodeUtcDateTime, encodeUtcDateTime } from './date-codec.js';
import { nullableContentDateTime } from '../validation/content-fields.js';

const base = { status: 'draft', ownerUid: 'demo-admin', scope: { type: 'public', id: '*' } };
const entry = { ...base, type: 'faq' as const, title: 'Entry', body: 'Body' };
const knowledgeRow = {
  id: 'entry',
  entry_type: 'faq',
  title: 'Entry',
  body: 'Body',
  category: 'Café',
  tags: ['a"b', '50%_off', 'x\\y', 'red', 'blue'],
  summary: 'Summary',
  maintained_at: '2026-10-01 00:00:00.000',
  maintainer_uid: 'demo-admin',
  audience: 'general',
  organization_id: null,
  status: 'draft',
  owner_uid: 'demo-admin',
  scope_type: 'public',
  scope_id: '*',
  created_at: '2026-10-01 00:00:00.000',
  updated_at: '2026-10-01 00:00:00.000',
};

describe('module readability parity regressions', () => {
  it('uses exact case/accent/trailing-space-sensitive category and season filters in memory', async () => {
    const store = createMemoryStore({ seed: false });
    const knowledge = await store.knowledge.create({ ...entry, category: 'Café' });
    const club = await store.clubs.create({
      ...base,
      name: 'Club',
      description: 'Body',
      category: 'Café',
      technicalSupportStatus: 'not_requested',
      technicalSupportNote: null,
    });
    const team = await store.sportsTeams.create({
      ...base,
      name: 'Team',
      description: 'Body',
      season: 'Été',
    });
    for (const [repository, id] of [
      [store.knowledge, knowledge.id],
      [store.clubs, club.id],
    ] as const) {
      expect((await repository.list({ category: 'Café' })).map((record) => record.id)).toEqual([
        id,
      ]);
      for (const category of ['café', 'Cafe', 'Café '])
        expect(await repository.list({ category })).toEqual([]);
    }
    expect((await store.sportsTeams.list({ season: 'Été' })).map((record) => record.id)).toEqual([
      team.id,
    ]);
    for (const season of ['été', 'Ete', 'Été '])
      expect(await store.sportsTeams.list({ season })).toEqual([]);
  });

  it('overrides MySQL table collation for exact category and season predicates', async () => {
    const execute = vi.fn().mockResolvedValue([[], []]);
    const store = createMySqlStore({ pool: { execute } as unknown as Pool }).store;
    for (const category of ['Café', 'café', 'Cafe', 'Café ']) {
      await store.knowledge.list({ category });
      await store.clubs.list({ category });
      await store.proposals.list({ category });
    }
    for (const season of ['Été', 'été', 'Ete', 'Été ']) await store.sportsTeams.list({ season });
    for (const [sql, values] of execute.mock.calls) {
      const column = (sql as string).includes('sports_teams') ? 'season' : 'category';
      expect(sql).toContain(`CAST(${column} AS BINARY) = CAST(? AS BINARY)`);
      expect(values).toHaveLength(1);
    }
  });

  it('searches decoded tag strings without matching JSON syntax or invented separators in memory', async () => {
    const store = createMemoryStore({ seed: false });
    const created = await store.knowledge.create({ ...entry, tags: knowledgeRow.tags });
    for (const query of ['a"b', '50%_off', 'x\\y']) {
      expect((await store.knowledge.list({ query })).map((record) => record.id)).toEqual([
        created.id,
      ]);
    }
    for (const query of ['["', '\\"', 'red,blue', 'red blue'])
      expect(await store.knowledge.list({ query })).toEqual([]);
  });

  it('searches decoded MySQL tag elements with literal punctuation, not serialized JSON', async () => {
    const execute = vi.fn().mockResolvedValue([[], []]);
    const store = createMySqlStore({ pool: { execute } as unknown as Pool }).store;
    for (const query of ['a"b', '50%_off', 'x\\y', '["', 'red,blue']) {
      await store.knowledge.list({ query });
      const [sql, values] = execute.mock.calls.at(-1)!;
      expect(sql).toContain("JSON_TABLE(tags, '$[*]' COLUMNS (tag_value VARCHAR(80) PATH '$'))");
      expect(sql).toContain(
        'LOCATE(CAST(? AS BINARY), CAST(LOWER(knowledge_tags.tag_value) AS BINARY)) > 0',
      );
      expect(sql).not.toContain("CONCAT_WS(' ', title, body, category, summary, tags)");
      expect((values as unknown[]).at(-1)).toBe(query.toLocaleLowerCase());
    }
  });

  it('treats explicit undefined as omitted on memory create and patch', async () => {
    const store = createMemoryStore({ seed: false });
    const created = await store.knowledge.create({
      ...entry,
      category: undefined,
      tags: undefined,
      summary: undefined,
      maintainedAt: undefined,
      maintainerUid: undefined,
    });
    expect(created).toMatchObject({
      category: 'general',
      tags: [],
      summary: '',
      maintainedAt: null,
      maintainerUid: null,
    });
    await store.knowledge.update(created.id, {
      category: 'Café',
      tags: ['tag'],
      summary: 'Summary',
      maintainedAt: '2026-10-01T00:00:00.000Z',
      maintainerUid: 'demo-admin',
    });
    const updated = await store.knowledge.update(created.id, {
      category: undefined,
      tags: undefined,
      summary: undefined,
      maintainedAt: undefined,
      maintainerUid: undefined,
      title: undefined,
      scope: undefined,
      status: undefined,
    });
    expect(updated).toMatchObject({
      ...entry,
      category: 'Café',
      tags: ['tag'],
      summary: 'Summary',
      maintainedAt: '2026-10-01T00:00:00.000Z',
      maintainerUid: 'demo-admin',
    });
  });

  it('does not reset MySQL fields when a PATCH contains explicit undefined', async () => {
    const execute = vi.fn().mockResolvedValue([[knowledgeRow], []]);
    const store = createMySqlStore({ pool: { execute } as unknown as Pool }).store;
    await store.knowledge.update('entry', {
      category: undefined,
      tags: undefined,
      summary: undefined,
      maintainedAt: undefined,
      maintainerUid: undefined,
      title: undefined,
      scope: undefined,
      status: undefined,
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]![0]).toMatch(/^SELECT/);
  });

  it('retains MySQL defaults when creates explicitly supply undefined', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([[knowledgeRow], []]);
    const store = createMySqlStore({ pool: { execute } as unknown as Pool }).store;
    await store.knowledge.create({
      ...entry,
      category: undefined,
      tags: undefined,
      summary: undefined,
      maintainedAt: undefined,
      maintainerUid: undefined,
    });
    const [sql, values] = execute.mock.calls[0]!;
    const columns = (sql as string)
      .slice((sql as string).indexOf('(') + 1, (sql as string).indexOf(')'))
      .split(', ');
    for (const [column, expected] of Object.entries({
      category: 'general',
      tags: '[]',
      summary: '',
      maintained_at: null,
      maintainer_uid: null,
    }))
      expect((values as unknown[])[columns.indexOf(column)]).toEqual(expected);
  });
});

describe('MySQL DATETIME normalized UTC range', () => {
  for (const value of [
    '0999-01-01T00:00:00.000Z',
    '1000-01-01T00:00:00.000+01:00',
    '9999-12-31T23:00:00.000-01:00',
  ]) {
    it(`rejects out-of-range normalized instant ${value}`, async () => {
      expect(() => encodeUtcDateTime(value)).toThrow();
      expect(() => encodeUtcDateTime(new Date(value))).toThrow();
      expect(() => decodeUtcDateTime(new Date(value))).toThrow();
      expect(nullableContentDateTime.safeParse(value).success).toBe(false);
      await expect(
        createMemoryStore({ seed: false }).knowledge.create({ ...entry, maintainedAt: value }),
      ).rejects.toThrow();
      const execute = vi.fn();
      await expect(
        createMySqlStore({ pool: { execute } as unknown as Pool }).store.knowledge.create({
          ...entry,
          maintainedAt: value,
        }),
      ).rejects.toThrow();
      expect(execute).not.toHaveBeenCalled();
    });
  }
  for (const [value, normalized] of [
    ['1000-01-01T00:00:00.000Z', '1000-01-01T00:00:00.000Z'],
    ['0999-12-31T23:00:00.000-01:00', '1000-01-01T00:00:00.000Z'],
    ['9999-12-31T23:59:59.999Z', '9999-12-31T23:59:59.999Z'],
  ]) {
    it(`accepts valid normalized boundary ${value}`, () => {
      expect(encodeUtcDateTime(value!)?.toISOString()).toBe(normalized);
      expect(nullableContentDateTime.safeParse(value).success).toBe(true);
    });
  }
  it('rejects an out-of-range MySQL date string', () => {
    expect(() => decodeUtcDateTime('0999-12-31 23:59:59.999')).toThrow();
  });
});
