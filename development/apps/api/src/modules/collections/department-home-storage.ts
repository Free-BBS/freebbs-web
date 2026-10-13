import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  departmentById,
  type DepartmentHomePayload,
  type DepartmentId,
} from '@freebbs-development/contracts';
import { HttpError } from '../../core/errors/http-error.js';

type SavedHome = Omit<DepartmentHomePayload, 'canEdit'>;
const writes = new Map<string, Promise<unknown>>();
function homePath(directory: string, id: DepartmentId): string {
  if (!departmentById(id)) throw new HttpError(404, 'department_not_found', '未找到部门');
  return join(resolve(directory), 'organization-pages', `${id}.json`);
}
export async function readDepartmentHome(directory: string, id: DepartmentId): Promise<SavedHome> {
  try {
    return JSON.parse(await readFile(homePath(directory, id), 'utf8')) as SavedHome;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return {
      departmentId: id,
      html: null,
      originalFilename: null,
      revision: 0,
      updatedAt: null,
      editor: null,
    };
  }
}
export async function saveDepartmentHome(
  directory: string,
  id: DepartmentId,
  input: { html: string; originalFilename: string; revision: number; editor: SavedHome['editor'] },
): Promise<SavedHome> {
  const path = homePath(directory, id);
  const previous = writes.get(path) ?? Promise.resolve();
  const operation = previous
    .catch(() => undefined)
    .then(async () => {
      const current = await readDepartmentHome(directory, id);
      if (current.revision !== input.revision)
        throw new HttpError(409, 'revision_conflict', '部门主页已更新，请刷新后重试');
      const snapshot: SavedHome = {
        departmentId: id,
        ...input,
        revision: current.revision + 1,
        updatedAt: new Date().toISOString(),
      };
      const temporary = `${path}.${randomUUID()}.tmp`;
      await mkdir(join(resolve(directory), 'organization-pages'), { recursive: true });
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
