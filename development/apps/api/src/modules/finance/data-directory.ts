import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/** Resolve existing ancestors as well, so an uncreated leaf cannot hide a public symlink. */
function physicalPath(input: string): string {
  let ancestor = resolve(input);
  const tail: string[] = [];
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) break;
    tail.unshift(ancestor.slice(parent.length).replace(/^[/\\]+/, ''));
    ancestor = parent;
  }
  return join(realpathSync.native(ancestor), ...tail);
}
function contains(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
}

export function financeDataDirectory(options: {
  directory?: string;
  nodeEnvironment: string;
  publicDirectories?: readonly string[];
}): string | undefined {
  const configured = options.directory?.trim();
  if (!configured && options.nodeEnvironment === 'production') return undefined;
  const input = configured ?? resolve('.data/finance-private');
  if (!isAbsolute(input)) throw new Error('FINANCE_DATA_DIR must be an absolute private path');
  const directory = physicalPath(input);
  const publicRoots = [
    resolve('public'),
    resolve('uploads'),
    resolve('backend/uploads'),
    resolve('development/apps/web/dist'),
    resolve('apps/web/dist'),
    ...(options.publicDirectories ?? []),
  ];
  for (const root of publicRoots) {
    const publicDirectory = physicalPath(root);
    if (contains(publicDirectory, directory) || contains(directory, publicDirectory)) {
      throw new Error('FINANCE_DATA_DIR must not overlap a public upload or static directory');
    }
  }
  return directory;
}
