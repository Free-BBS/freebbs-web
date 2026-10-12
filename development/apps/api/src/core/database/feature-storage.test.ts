import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { featureStorage } from './feature-storage.js';
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
