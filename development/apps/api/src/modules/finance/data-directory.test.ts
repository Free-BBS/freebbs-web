import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { financeDataDirectory } from './data-directory.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
it('does not choose a production fallback or a relative private directory', () => {
  expect(financeDataDirectory({ nodeEnvironment: 'production' })).toBeUndefined();
  expect(() =>
    financeDataDirectory({ directory: 'finance', nodeEnvironment: 'production' }),
  ).toThrow('absolute');
});
it('rejects public upload roots, nested leaves and ancestors while permitting private siblings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'finance-path-'));
  roots.push(root);
  const publicDirectory = join(root, 'uploads');
  const check = (directory: string) =>
    financeDataDirectory({
      directory,
      nodeEnvironment: 'production',
      publicDirectories: [publicDirectory],
    });
  expect(() => check(publicDirectory)).toThrow('public');
  expect(() => check(join(publicDirectory, 'finance-private'))).toThrow('public');
  expect(() => check(root)).toThrow('public');
  expect(check(join(root, 'private'))).toBe(resolve(root, 'private'));
});
it('resolves a symlinked ancestor before accepting an uncreated finance leaf', async () => {
  const root = await mkdtemp(join(tmpdir(), 'finance-link-'));
  roots.push(root);
  const publicDirectory = join(root, 'uploads');
  await mkdir(publicDirectory);
  const alias = join(root, 'alias');
  await symlink(publicDirectory, alias, process.platform === 'win32' ? 'junction' : 'dir');
  expect(() =>
    financeDataDirectory({
      directory: join(alias, 'new-leaf'),
      nodeEnvironment: 'production',
      publicDirectories: [publicDirectory],
    }),
  ).toThrow('public');
});
