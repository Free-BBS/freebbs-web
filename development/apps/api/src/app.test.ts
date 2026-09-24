import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { DemoAuthClient } from './core/auth/demo-auth-client.js';
import { IdentityProviderUnavailableError } from './core/auth/auth-client.js';
import { createMemoryStore } from './core/database/memory-store.js';
import { createApp } from './app.js';

describe('development API core', () => {
  it('protects main-mode identity and module metadata with the production preview list', async () => {
    const app = createApp({
      store: createMemoryStore({ seed: false }),
      authMode: 'main',
      previewAllowedUids: ['u_allowed'],
      authClient: {
        introspect: async (token) => ({
          uid: token === 'allowed' ? 'u_allowed' : 'u_other',
          displayName: 'Main user',
          avatarUrl: null,
          baseRole: 'student',
          roles: [],
          tags: [],
        }),
      },
    });
    await request(app)
      .get('/api/development/v1/me')
      .set('Authorization', 'Bearer denied')
      .expect(403);
    await request(app)
      .get('/api/development/v1/modules')
      .set('Authorization', 'Bearer denied')
      .expect(403);
    await request(app)
      .get('/api/development/v1/me')
      .set('Authorization', 'Bearer allowed')
      .expect(200);
  });
  it('returns a minimal health envelope without database secrets', async () => {
    const app = createApp({ store: createMemoryStore(), databaseMode: 'memory' });
    const response = await request(app).get('/api/development/v1/health').expect(200);

    expect(response.body).toEqual({
      data: { status: 'ok', version: '0.1.0', databaseMode: 'memory' },
      requestId: expect.any(String),
    });
    expect(Object.keys(response.body.data)).toEqual(['status', 'version', 'databaseMode']);
    expect(JSON.stringify(response.body)).not.toMatch(
      /MYSQL_HOST|MYSQL_PASSWORD|password|credential/i,
    );
    expect(response.headers['x-request-id']).toBe(response.body.requestId);
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('keeps health as pure liveness while ready uses the injected readiness check', async () => {
    const checkReadiness = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const app = createApp({
      store: createMemoryStore(),
      databaseMode: 'memory',
      checkReadiness,
    });

    await request(app).get('/api/development/v1/health').expect(200);
    expect(checkReadiness).not.toHaveBeenCalled();
    await request(app).get('/api/development/v1/ready').expect(200);
    expect(checkReadiness).toHaveBeenCalledOnce();
  });

  it('returns a stable readiness failure without database details', async () => {
    const app = createApp({
      store: createMemoryStore(),
      checkReadiness: async () => {
        throw new Error(
          'ER_ACCESS_DENIED: mysql://secret@database/internal development_schema_migrations',
        );
      },
    });

    const response = await request(app).get('/api/development/v1/ready').expect(503);
    expect(response.body).toEqual({
      data: { error: { code: 'not_ready', message: 'Service is not ready' } },
      requestId: expect.any(String),
    });
    expect(JSON.stringify(response.body)).not.toMatch(
      /mysql|secret|development_schema_migrations|internal/i,
    );
  });
  it('fails closed for MySQL readiness when no readiness check was injected', async () => {
    const app = createApp({ store: createMemoryStore(), databaseMode: 'mysql' });

    const response = await request(app).get('/api/development/v1/ready').expect(503);
    expect(response.body.data.error).toEqual({
      code: 'not_ready',
      message: 'Service is not ready',
    });
  });
  it('returns all nine enabled module manifests in stable order', async () => {
    const app = createApp({ store: createMemoryStore(), databaseMode: 'memory' });
    const response = await request(app).get('/api/development/v1/modules').expect(200);

    expect(response.body.data.map((module: { id: string }) => module.id)).toEqual([
      'dashboard',
      'knowledge',
      'information',
      'events',
      'liaison',
      'growth',
      'sports',
      'finance',
      'admin',
    ]);
    expect(response.body.data).toHaveLength(9);
    expect(
      response.body.data.every((module: { status: string }) => module.status === 'enabled'),
    ).toBe(true);
  });

  it('maps authentication outcomes to envelope-formatted 401, 503 and /me success responses', async () => {
    const store = createMemoryStore();
    const demoApp = createApp({
      store,
      databaseMode: 'memory',
      authMode: 'demo',
      authClient: new DemoAuthClient(['demo-student']),
    });
    const missing = await request(demoApp).get('/api/development/v1/me').expect(401);
    expect(missing.body).toMatchObject({
      data: { error: { code: 'missing_identity' } },
      requestId: expect.any(String),
    });
    const me = await request(demoApp)
      .get('/api/development/v1/me')
      .set('X-Demo-User', 'demo-student')
      .expect(200);
    expect(me.body).toMatchObject({
      data: { uid: 'demo-student', baseRole: 'student' },
      requestId: expect.any(String),
    });

    const unavailableApp = createApp({
      store,
      databaseMode: 'memory',
      authMode: 'main',
      authClient: {
        introspect: async () => {
          throw new IdentityProviderUnavailableError();
        },
      },
    });
    const unavailable = await request(unavailableApp)
      .get('/api/development/v1/me')
      .set('Authorization', 'Bearer opaque')
      .expect(503);
    expect(unavailable.body).toMatchObject({
      data: { error: { code: 'identity_provider_unavailable' } },
    });
  });

  it('does not enable CORS by default and only echoes an explicitly allowed origin', async () => {
    const defaultApp = createApp({ store: createMemoryStore(), databaseMode: 'memory' });
    const denied = await request(defaultApp)
      .get('/api/development/v1/health')
      .set('Origin', 'http://localhost:5173')
      .expect(200);
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();

    const allowedApp = createApp({
      store: createMemoryStore(),
      databaseMode: 'memory',
      allowedOrigins: ['http://localhost:5173'],
    });
    const allowed = await request(allowedApp)
      .get('/api/development/v1/health')
      .set('Origin', 'http://localhost:5173')
      .expect(200);
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const unlisted = await request(allowedApp)
      .get('/api/development/v1/health')
      .set('Origin', 'https://evil.example')
      .expect(200);
    expect(unlisted.headers['access-control-allow-origin']).toBeUndefined();
  });
  it('rejects an explicit demo mode in production even with an injected client', () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousAuthMode = process.env.AUTH_MODE;
    process.env.NODE_ENV = 'production';
    process.env.AUTH_MODE = 'main';
    try {
      expect(() =>
        createApp({
          store: createMemoryStore(),
          authMode: 'demo',
          authClient: { introspect: async () => null },
        }),
      ).toThrow(/demo authentication is disabled in production/i);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousAuthMode === undefined) delete process.env.AUTH_MODE;
      else process.env.AUTH_MODE = previousAuthMode;
    }
  });
  it('maps malformed JSON to a stable 400 envelope without parser details', async () => {
    const app = createApp({ store: createMemoryStore(), databaseMode: 'memory' });
    const response = await request(app)
      .post('/api/development/v1/admin/role-assignments')
      .set('Content-Type', 'application/json')
      .send('{"subjectUid":')
      .expect(400);

    expect(response.body).toEqual({
      data: { error: { code: 'invalid_json', message: 'Request body contains invalid JSON' } },
      requestId: expect.any(String),
    });
    expect(response.headers['x-request-id']).toBe(response.body.requestId);
    expect(JSON.stringify(response.body)).not.toMatch(/unexpected|syntax|position/i);
  });

  it('maps JSON bodies over 64kb to a stable 413 envelope', async () => {
    const app = createApp({ store: createMemoryStore(), databaseMode: 'memory' });
    const response = await request(app)
      .post('/api/development/v1/admin/role-assignments')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ value: 'x'.repeat(70 * 1024) }))
      .expect(413);

    expect(response.body).toEqual({
      data: { error: { code: 'payload_too_large', message: 'Request body is too large' } },
      requestId: expect.any(String),
    });
    expect(response.headers['x-request-id']).toBe(response.body.requestId);
  });
});
