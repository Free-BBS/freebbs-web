import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { SportsTeamHomepage } from '@freebbs-development/contracts';
import { HttpError } from '../../core/errors/http-error.js';

type SavedHome = Omit<SportsTeamHomepage, 'canEdit'>;
const writes = new Map<string, Promise<unknown>>();
function homePath(directory: string, teamId: string) {
  return join(
    resolve(directory),
    'sports-pages',
    `${createHash('sha256').update(teamId).digest('hex')}.json`,
  );
}
export async function readSportsHomepage(directory: string, teamId: string): Promise<SavedHome> {
  try {
    return JSON.parse(await readFile(homePath(directory, teamId), 'utf8')) as SavedHome;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return {
      teamId,
      html: null,
      originalFilename: null,
      revision: 0,
      updatedAt: null,
      editor: null,
    };
  }
}
export async function saveSportsHomepage(
  directory: string,
  teamId: string,
  input: Pick<SavedHome, 'html' | 'originalFilename' | 'revision' | 'editor'>,
): Promise<SavedHome> {
  const path = homePath(directory, teamId);
  const previous = writes.get(path) ?? Promise.resolve();
  const operation = previous
    .catch(() => undefined)
    .then(async () => {
      const current = await readSportsHomepage(directory, teamId);
      if (current.revision !== input.revision)
        throw new HttpError(
          409,
          'revision_conflict',
          '代表队主页已更新，请刷新后重试；草稿可以继续保留',
        );
      const snapshot: SavedHome = {
        teamId,
        ...input,
        revision: current.revision + 1,
        updatedAt: new Date().toISOString(),
      };
      const temporary = `${path}.${randomUUID()}.tmp`;
      await mkdir(join(resolve(directory), 'sports-pages'), { recursive: true });
      try {
        await writeFile(temporary, JSON.stringify(snapshot), { encoding: 'utf8', flag: 'wx' });
        await rename(temporary, path);
      } finally {
        await rm(temporary, { force: true });
      }
      return snapshot;
    });
  writes.set(path, operation);
  try {
    return await operation;
  } finally {
    if (writes.get(path) === operation) writes.delete(path);
  }
}
