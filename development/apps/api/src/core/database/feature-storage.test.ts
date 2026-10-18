import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { expect, it } from 'vitest';
import { featureStorage } from './feature-storage.js';

function worker(directory: string, mode: string) {
  return spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      fileURLToPath(
        new URL('../../../../../tests/fixtures/feature-storage-worker.mjs', import.meta.url),
      ),
      fileURLToPath(new URL('./feature-storage.ts', import.meta.url)),
      directory,
      mode,
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
}
async function exited(child: ChildProcess) {
  let error = '';
  child.stderr?.on('data', (data) => {
    error += String(data);
  });
  const [code] = await once(child, 'exit');
  if (code !== 0 && code !== 17) throw new Error(error || `Worker exited ${code}`);
  return code;
}

it('recovers a crashed worker lock without losing the committed record', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'feature-crash-'));
  try {
    const storage = featureStorage<{ id: string; count: number }>(directory, 'test-records');
    await storage.change('record', () => ({ record: { id: 'record', count: 1 }, result: null }));
    expect(await exited(worker(directory, 'crash'))).toBe(17);
    await storage.change('record', (record) => ({
      record: { ...record!, count: record!.count + 1 },
      result: null,
    }));
    expect((await storage.get('record'))?.count).toBe(2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);

it('never takes a live worker lock and preserves every concurrent increment', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'feature-live-'));
  let child: ChildProcess | undefined;
  try {
    child = worker(directory, 'hold');
    const done = exited(child);
    await once(child.stdout!, 'data');
    const storage = featureStorage<{ id: string; count: number }>(directory, 'test-records');
    let finished = false;
    const contender = storage
      .change('record', (record) => ({
        record: { id: 'record', count: (record?.count ?? 0) + 1 },
        result: null,
      }))
      .then(() => {
        finished = true;
      });
    await new Promise((resume) => setTimeout(resume, 150));
    expect(finished).toBe(false);
    child.stdin?.end('release\n');
    expect(await done).toBe(0);
    await contender;
    expect((await storage.get('record'))?.count).toBe(2);
  } finally {
    child?.kill();
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);

it('lets competing processes recover one dead owner without deleting replacement locks', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'feature-recover-race-'));
  try {
    const storage = featureStorage<{ id: string; count: number }>(directory, 'test-records');
    await storage.change('record', () => ({ record: { id: 'record', count: 1 }, result: null }));
    expect(await exited(worker(directory, 'crash'))).toBe(17);
    expect(
      await Promise.all(Array.from({ length: 4 }, () => exited(worker(directory, 'increment')))),
    ).toEqual([0, 0, 0, 0]);
    expect((await storage.get('record'))?.count).toBe(5);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);
it('serializes independently created stores and releases locks on rejected changes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'feature-lock-'));
  try {
    const first = featureStorage<{ id: string; count: number }>(directory, 'test-records');
    const second = featureStorage<{ id: string; count: number }>(directory, 'test-records');
    await first.change('record', () => ({ record: { id: 'record', count: 0 }, result: null }));
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        (index % 2 ? first : second).change('record', async (value) => {
          await new Promise((resolve) => setTimeout(resolve, 2));
          return { record: { id: 'record', count: value!.count + 1 }, result: null };
        }),
      ),
    );
    expect((await first.get('record'))?.count).toBe(12);
    await expect(
      first.change('record', () => {
        throw new Error('rejected');
      }),
    ).rejects.toThrow('rejected');
    await second.change('record', (value) => ({ record: { ...value!, count: 13 }, result: null }));
    expect((await first.get('record'))?.count).toBe(13);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
