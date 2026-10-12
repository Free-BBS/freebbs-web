import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { HttpError } from '../../core/errors/http-error.js';
import type { StoredCollectionAsset } from './uploads.js';
import type { CollectionSchema } from '@freebbs-development/contracts';

export interface Recipient {
  name: string;
  studentId: string;
}
export interface GuestSession {
  hash: string;
  addressHash: string;
  createdAt: number;
  assets: Array<StoredCollectionAsset & { fieldId: string }>;
}
export interface GuestResponse {
  id: string;
  formId: string;
  versionId: string;
  respondentUid: string;
  submittedAt: string;
  answers: Record<string, unknown>;
  receiptHash: string;
  sessionHash: string;
  status: 'submitted';
}
export interface CollectionFeatureState {
  templates?: Array<{
    id: string;
    name: string;
    schema: CollectionSchema;
    ownerUid: string;
    departmentId?: string;
  }>;
  sessions: GuestSession[];
  responses: GuestResponse[];
  recipients: Recipient[];
  identities: Record<string, Recipient>;
}
export const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex');
function paths(directory: string, formId: string) {
  // Form IDs may be legacy strings. Hash them so neither URLs nor record IDs can traverse paths.
  const base = join(resolve(directory), 'collection-features');
  const name = tokenHash(formId);
  return { base, path: join(base, `${name}.json`), lock: join(base, `${name}.lock`) };
}
export async function readCollectionFeature(
  directory: string,
  formId: string,
): Promise<CollectionFeatureState> {
  try {
    return JSON.parse(
      await readFile(paths(directory, formId).path, 'utf8'),
    ) as CollectionFeatureState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new HttpError(503, 'collection_storage_unavailable', '表单附加存储暂不可用');
    return { sessions: [], responses: [], recipients: [], identities: {} };
  }
}
// The same filesystem lock coordinates guest and authenticated capacity checks across API workers.
// A crashed worker leaves a lock requiring operator cleanup; failing closed protects the capacity.
export async function withCollectionFeature<T>(
  directory: string,
  formId: string,
  operation: (state: CollectionFeatureState) => Promise<T>,
): Promise<T> {
  const { base, path, lock } = paths(directory, formId);
  try {
    await mkdir(base, { recursive: true });
  } catch {
    throw new HttpError(503, 'collection_storage_unavailable', '表单附加存储暂不可用');
  }
  let acquired = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await mkdir(lock);
      acquired = true;
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
        throw new HttpError(503, 'collection_storage_unavailable', '表单附加存储暂不可用');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  if (!acquired) throw new HttpError(503, 'collection_busy', '表单正在处理，请稍后重试');
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const state = await readCollectionFeature(directory, formId);
    const result = await operation(state);
    await writeFile(temporary, JSON.stringify(state), { encoding: 'utf8', flag: 'wx' });
    await rename(temporary, path);
    return result;
  } finally {
    await rm(temporary, { force: true });
    await rm(lock, { recursive: true, force: true });
  }
}
