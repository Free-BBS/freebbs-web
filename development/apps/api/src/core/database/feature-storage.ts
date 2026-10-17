import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { HttpError } from '../errors/http-error.js';
import { identifyFeatureLock, recoverFeatureLock } from './feature-lock.js';

const pending = new Map<string, Promise<unknown>>();
/** Feature data is isolated from learning storage; all filenames derive from a digest. */
export function featureStorage<T extends { id: string }>(root: string, namespace: string) {
  if (!/^[a-z][a-z0-9-]{1,50}$/.test(namespace)) throw new Error('Invalid feature namespace');
  const directory = join(resolve(root), namespace);
  const path = (id: string) =>
    join(directory, `${createHash('sha256').update(id).digest('hex')}.json`);
  async function get(id: string): Promise<T | null> {
    try {
      const record = JSON.parse(await readFile(path(id), 'utf8')) as T;
      if (record.id !== id) throw new Error('Invalid feature record');
      return record;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  async function list(): Promise<T[]> {
    const names = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    return Promise.all(
      names
        .filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
        .map(async (name) => JSON.parse(await readFile(join(directory, name), 'utf8')) as T),
    );
  }
  async function change<R>(
    id: string,
    operation: (record: T | null) => { record: T; result: R } | Promise<{ record: T; result: R }>,
  ): Promise<R> {
    const target = path(id);
    const task = (pending.get(target) ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        await mkdir(directory, { recursive: true });
        const lock = `${target}.lock`;
        let release: (() => Promise<void>) | undefined;
        for (let attempt = 0; attempt < 100; attempt++) {
          try {
            await mkdir(lock);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
            if (!(await recoverFeatureLock(lock)))
              await new Promise((resume) => setTimeout(resume, 20));
            continue;
          }
          release = await identifyFeatureLock(lock);
          break;
        }
        if (!release) throw new HttpError(503, 'feature_busy', '资料正在处理，请稍后重试');
        try {
          const { record, result } = await operation(await get(id));
          if (record.id !== id) throw new Error('Feature identifier cannot change');
          await mkdir(directory, { recursive: true });
          const temporary = `${target}.${randomUUID()}.tmp`;
          try {
            await writeFile(temporary, JSON.stringify(record), { encoding: 'utf8', flag: 'wx' });
            await rename(temporary, target);
          } finally {
            await rm(temporary, { force: true });
          }
          return result;
        } finally {
          await release();
        }
      });
    pending.set(target, task);
    try {
      return await task;
    } finally {
      if (pending.get(target) === task) pending.delete(target);
    }
  }
  return { get, list, change };
}
