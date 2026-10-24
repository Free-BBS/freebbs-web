import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createIntegratedDevelopmentRuntime } from './integrated-runtime.js';

const mocks = vi.hoisted(() => ({
  ready: vi.fn(),
  close: vi.fn(),
  app: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
}));
vi.mock('./app.js', () => ({ createApp: mocks.app }));
vi.mock('./core/database/mysql-store.js', () => ({
  createMySqlStore: () => ({
    store: {},
    checkReadiness: mocks.ready,
    close: mocks.close,
    getAppliedMigrationCount: vi.fn(),
  }),
}));
vi.mock('./modules/connectors/feed.js', () => ({ startFeedScheduler: mocks.start }));
const options = {
  authClient: {},
  userDirectory: {},
  database: {},
  uploadDirectory: '/uploads',
  collectionsUploadDirectory: '/collections',
} as Parameters<typeof createIntegratedDevelopmentRuntime>[0];
beforeEach(() => {
  vi.resetAllMocks();
  mocks.ready.mockResolvedValue(undefined);
  mocks.close.mockResolvedValue(undefined);
  mocks.app.mockReturnValue({});
  mocks.start.mockReturnValue(mocks.stop);
});
afterEach(() => vi.unstubAllEnvs());
it('exposes the shared root authority to the learning platform before a first development login', async () => {
  vi.stubEnv('PLATFORM_ROOT_ADMIN_UIDS', 'additional-root');
  const runtime = await createIntegratedDevelopmentRuntime(options);
  for (const uid of ['u_48370eb1aba453c7', 'additional-root'])
    expect(await runtime.resolvePlatformAuthority(uid)).toEqual({
      rootAdmin: true,
      learningAdmin: true,
      developmentAdmin: true,
      developmentLead: true,
    });
  await runtime.close();
});
it('passes private finance configuration and public upload roots into the app', async () => {
  const runtime = await createIntegratedDevelopmentRuntime({
    ...options,
    financeDirectory: '/private-finance',
    publicUploadDirectory: '/public-uploads',
  });
  expect(mocks.app).toHaveBeenCalledWith(
    expect.objectContaining({
      financeDirectory: '/private-finance',
      publicUploadDirectory: '/public-uploads',
    }),
  );
  await runtime.close();
});
it('starts the integrated feed with the effective app environment and stops it before closing once', async () => {
  vi.stubEnv('DEVELOPMENT_ARTICLE_FEED_URL', 'https://feed.example/articles');
  vi.stubEnv('DEVELOPMENT_FEED_OWNER_UID', 'publisher');
  const runtime = await createIntegratedDevelopmentRuntime(options);
  const environment = mocks.app.mock.calls[0]![0].environment;
  expect(mocks.start).toHaveBeenCalledExactlyOnceWith('/collections', environment);
  expect(environment).toMatchObject({
    AUTH_MODE: 'main',
    HOST: '127.0.0.1',
    DEVELOPMENT_FEED_OWNER_UID: 'publisher',
  });
  await Promise.all([runtime.close(), runtime.close()]);
  expect(mocks.stop).toHaveBeenCalledOnce();
  expect(mocks.close).toHaveBeenCalledOnce();
  expect(mocks.stop.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.close.mock.invocationCallOrder[0]!,
  );
});
it('closes the database if app initialization fails without starting a scheduler', async () => {
  mocks.app.mockImplementationOnce(() => {
    throw new Error('app initialization failed');
  });
  await expect(createIntegratedDevelopmentRuntime(options)).rejects.toThrow(
    'app initialization failed',
  );
  expect(mocks.close).toHaveBeenCalledOnce();
  expect(mocks.start).not.toHaveBeenCalled();
});
it('closes the database if readiness or scheduler initialization fails', async () => {
  mocks.ready.mockRejectedValueOnce(new Error('not ready'));
  await expect(createIntegratedDevelopmentRuntime(options)).rejects.toThrow('not ready');
  expect(mocks.app).not.toHaveBeenCalled();
  expect(mocks.close).toHaveBeenCalledOnce();
  mocks.start.mockImplementationOnce(() => {
    throw new Error('scheduler failed');
  });
  await expect(createIntegratedDevelopmentRuntime(options)).rejects.toThrow('scheduler failed');
  expect(mocks.close).toHaveBeenCalledTimes(2);
});
