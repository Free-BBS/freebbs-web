import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { expect, it } from 'vitest';
import { createApp } from '../../app.js';

it('imports a full class roster through the integrated app without raising the global body limit', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'org-group-app-'));
  try {
    const app = createApp({
      authMode: 'demo',
      collectionsUploadDirectory: directory,
      environment: { NODE_ENV: 'test', AUTH_MODE: 'demo', DATA_MODE: 'memory' },
    });
    const path = '/api/development/v1/organization-group';
    const workspace = await request(app)
      .get(path + '/workspace')
      .set('X-Demo-User', 'demo-admin');
    expect(workspace.status).toBe(200);
    const input = {
      revision: workspace.body.data.revision,
      classes: [{ id: 'class-a', label: '测试班级' }],
      members: Array.from({ length: 1000 }, (_, index) => ({
        uid: `roster-student-${index}`,
        studentId: `2026${String(index).padStart(6, '0')}`,
        classId: 'class-a',
        submitClassIds: ['class-a'],
      })),
    };
    expect(Buffer.byteLength(JSON.stringify(input))).toBeGreaterThan(64 * 1024);
    const imported = await request(app)
      .patch(path + '/settings')
      .set('X-Demo-User', 'demo-admin')
      .send(input);
    expect(imported.status).toBe(200);
    expect(imported.body.data.members).toHaveLength(1000);
    const invalidLargeGlobal = await request(app)
      .post('/api/development/v1/events')
      .set('X-Demo-User', 'demo-admin')
      .send({ title: 'x'.repeat(70 * 1024) });
    expect(invalidLargeGlobal.status).toBe(413);
    const tooLarge = await request(app)
      .patch(path + '/settings')
      .set('X-Demo-User', 'demo-admin')
      .send({ padding: 'x'.repeat(8 * 1024 ** 2 + 1) });
    expect(tooLarge.status).toBe(413);
    expect(tooLarge.body.data.error.code).toBe('payload_too_large');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
