import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type {
  ActivityWorkspace,
  ActivityNotification,
  RegistrationSource,
} from '@freebbs-development/contracts';
export interface SavedNotice extends Omit<ActivityNotification, 'readAt'> {
  recipients: string[];
  reads: Array<{ uid: string; readAt: string }>;
}
export interface SavedActivityWorkspace extends Pick<
  ActivityWorkspace,
  'source' | 'activityId' | 'revision' | 'intro' | 'updates' | 'recaps' | 'assets' | 'schedule'
> {
  followers: string[];
  notices: SavedNotice[];
}
const writes = new Map<string, Promise<unknown>>();
function folder(directory: string) {
  return join(resolve(directory), 'activity-workspaces');
}
function path(directory: string, source: RegistrationSource, id: string) {
  return join(
    folder(directory),
    `${createHash('sha256').update(`${source}:${id}`).digest('hex')}.json`,
  );
}
export async function readActivityWorkspace(
  directory: string,
  source: RegistrationSource,
  id: string,
): Promise<SavedActivityWorkspace> {
  try {
    const value = JSON.parse(
      await readFile(path(directory, source, id), 'utf8'),
    ) as SavedActivityWorkspace;
    if (
      value.source !== source ||
      value.activityId !== id ||
      !Number.isInteger(value.revision) ||
      !Array.isArray(value.notices) ||
      !Array.isArray(value.followers)
    )
      throw new Error('Invalid activity workspace storage');
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return {
      source,
      activityId: id,
      revision: 0,
      intro: [],
      updates: [],
      recaps: [],
      assets: [],
      followers: [],
      notices: [],
    };
  }
}
export async function changeActivityWorkspace<T>(
  directory: string,
  source: RegistrationSource,
  id: string,
  change: (value: SavedActivityWorkspace) => Promise<T> | T,
): Promise<T> {
  const target = path(directory, source, id);
  const operation = (writes.get(target) ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      const value = await readActivityWorkspace(directory, source, id);
      const result = await change(value);
      const temporary = `${target}.${randomUUID()}.tmp`;
      await mkdir(folder(directory), { recursive: true });
      try {
        await writeFile(temporary, JSON.stringify(value), { encoding: 'utf8', flag: 'wx' });
        await rename(temporary, target);
      } finally {
        await rm(temporary, { force: true });
      }
      return result;
    });
  writes.set(target, operation);
  try {
    return await operation;
  } finally {
    if (writes.get(target) === operation) writes.delete(target);
  }
}
export async function listActivityWorkspaces(directory: string): Promise<SavedActivityWorkspace[]> {
  const names = await readdir(folder(directory)).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  return Promise.all(
    names
      .filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
      .map(
        async (name) =>
          JSON.parse(
            await readFile(join(folder(directory), name), 'utf8'),
          ) as SavedActivityWorkspace,
      ),
  );
}
