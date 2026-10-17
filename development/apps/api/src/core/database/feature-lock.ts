import { randomUUID } from 'node:crypto';
import { lstat, readFile, readdir, readlink, rmdir, unlink, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';

const localIdentity = readlink('/proc/self/ns/pid')
  .catch(() => null)
  .then((namespace) => ({ host: hostname(), namespace }));
const ownerName = /^owner-([a-f0-9-]{36})\.json$/;

/** Owner filenames are unique: unlinking an old owner can never remove a replacement's owner. */
export async function identifyFeatureLock(lock: string): Promise<() => Promise<void>> {
  const id = randomUUID();
  const filename = join(lock, `owner-${id}.json`);
  try {
    await writeFile(filename, JSON.stringify({ id, pid: process.pid, ...(await localIdentity) }), {
      encoding: 'utf8',
      flag: 'wx',
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') await unlink(filename).catch(() => {});
    await rmdir(lock).catch(() => {});
    throw error;
  }
  return async () => {
    await unlink(filename);
    await rmdir(lock);
  };
}

/** Recover only proven-dead local owners; unknown, legacy, remote or live locks fail closed. */
export async function recoverFeatureLock(lock: string): Promise<boolean> {
  try {
    const names = await readdir(lock);
    if (names.length !== 1 || !ownerName.test(names[0]!)) return false;
    const filename = join(lock, names[0]!);
    const stat = await lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024) return false;
    const owner = JSON.parse(await readFile(filename, 'utf8')) as Record<string, unknown>;
    const local = await localIdentity;
    if (
      owner.id !== names[0]!.match(ownerName)?.[1] ||
      owner.host !== local.host ||
      owner.namespace !== local.namespace ||
      typeof owner.pid !== 'number' ||
      !Number.isSafeInteger(owner.pid) ||
      owner.pid < 1
    )
      return false;
    try {
      process.kill(owner.pid, 0);
      return false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return false;
    }
    // Only the reclaimer that removes this exact immutable owner may remove the
    // empty directory. Other contenders stop at ENOENT, avoiding replacement races.
    await unlink(filename);
    await rmdir(lock);
    return true;
  } catch {
    return false;
  }
}
