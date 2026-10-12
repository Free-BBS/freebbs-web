import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import request from 'supertest';
import type { CollaborationSpace, CollaborationEntry } from '@freebbs-development/contracts';
import { featureStorage } from '../../core/database/feature-storage.js';
import { createMemoryStore } from '../../core/database/memory-store.js';
import { DemoAuthClient } from '../../core/auth/demo-auth-client.js';
import { createApp } from '../../app.js';
import type { ImportedExperience } from '../connectors/router.js';
it('counts only this user confirmed attendance and past Map records', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'verified-growth-'));
  try {
    const at = '2026-01-01T00:00:00Z';
    const row = (uid: string, status: CollaborationEntry['reviewStatus']): CollaborationEntry => ({
      id: uid + status,
      uid,
      displayName: uid,
      createdAt: at,
      updatedAt: at,
      values: {},
      choices: [],
      resource: '',
      startsAt: '',
      endsAt: '',
      text: '训练记录',
      assignedSlot: null,
      stage: 1,
      reviewStatus: status,
      decisions: [],
      files: [],
    });
    const space: CollaborationSpace = {
      id: 'training',
      kind: 'attendance',
      title: '球队训练',
      ownerUid: 'captain',
      description: '',
      departmentId: null,
      teamId: 'basketball',
      audience: 'all',
      status: 'published',
      revision: 1,
      createdAt: at,
      updatedAt: at,
      columns: [],
      slots: [],
      stages: [],
      history: [],
      entries: [
        row('demo-student', 'approved'),
        row('demo-student', 'pending'),
        row('demo-captain', 'approved'),
      ],
    };
    await featureStorage<CollaborationSpace>(directory, 'collaboration').change(space.id, () => ({
      record: space,
      result: null,
    }));
    const map = featureStorage<ImportedExperience>(directory, 'map-experiences');
    for (const [id, uid, occurredAt] of [
      ['past', 'demo-student', at],
      ['future', 'demo-student', '2099-01-01T00:00:00Z'],
      ['other', 'demo-captain', at],
    ])
      await map.change(id!, () => ({
        record: {
          id: id!,
          uid: uid!,
          title: '校园探索',
          occurredAt: occurredAt!,
          domain: 'tms',
          provider: 'map',
          updatedAt: at,
        },
        result: null,
      }));
    const app = createApp({
      store: createMemoryStore({ seed: false }),
      authMode: 'demo',
      authClient: new DemoAuthClient(['demo-student', 'demo-captain']),
      collectionsUploadDirectory: directory,
    });
    const response = await request(app)
      .get('/api/development/v1/growth/summary')
      .set('X-Demo-User', 'demo-student')
      .expect(200);
    expect(response.body.data.total).toBe(2);
    expect(response.body.data.verifiedTotal).toBe(2);
    expect(
      response.body.data.activities.map((item: { source: string }) => item.source).sort(),
    ).toEqual(['map', 'verified_attendance']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
