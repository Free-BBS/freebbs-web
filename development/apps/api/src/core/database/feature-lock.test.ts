import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { identifyFeatureLock, recoverFeatureLock } from './feature-lock.js';

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'feature-owner-'));
  directories.push(root);
  const lock = join(root, 'record.lock');
  await mkdir(lock);
  await identifyFeatureLock(lock);
  const filename = join(lock, (await readdir(lock))[0]!);
  const owner = JSON.parse(await readFile(filename, 'utf8'));
  return { lock, filename, owner };
}

it('never recovers an unknown legacy lock or steals a live local owner', async () => {
  const f = await fixture();
  expect(await recoverFeatureLock(f.lock)).toBe(false);
  expect(await readdir(f.lock)).toHaveLength(1);
  await rm(f.filename);
  expect(await recoverFeatureLock(f.lock)).toBe(false);
  expect(await readdir(f.lock)).toEqual([]);
});

it.each([
  { host: 'another-host' },
  { namespace: 'another-pid-namespace' },
  { pid: -1 },
  { pid: '123' },
  { id: 'different-token' },
])('does not reclaim an unverifiable owner %j', async (change) => {
  const f = await fixture();
  await writeFile(f.filename, JSON.stringify({ ...f.owner, ...change }));
  const kill = vi.spyOn(process, 'kill');
  expect(await recoverFeatureLock(f.lock)).toBe(false);
  expect(kill).not.toHaveBeenCalled();
  expect(await readFile(f.filename, 'utf8')).toContain(JSON.stringify(Object.values(change)[0]));
});

it('treats permission failure as unknown liveness rather than death', async () => {
  const f = await fixture();
  vi.spyOn(process, 'kill').mockImplementation(() => {
    throw Object.assign(new Error('not permitted'), { code: 'EPERM' });
  });
  expect(await recoverFeatureLock(f.lock)).toBe(false);
  expect(await readFile(f.filename, 'utf8')).toContain(f.owner.id);
});

it('allows only one reclaimer to unlink a proven-dead owner', async () => {
  const f = await fixture();
  vi.spyOn(process, 'kill').mockImplementation(() => {
    throw Object.assign(new Error('gone'), { code: 'ESRCH' });
  });
  const results = await Promise.all([recoverFeatureLock(f.lock), recoverFeatureLock(f.lock)]);
  expect(results.filter(Boolean)).toHaveLength(1);
  await mkdir(f.lock);
  await identifyFeatureLock(f.lock);
  vi.restoreAllMocks();
  expect(await recoverFeatureLock(f.lock)).toBe(false);
  expect(await readdir(f.lock)).toHaveLength(1);
});
