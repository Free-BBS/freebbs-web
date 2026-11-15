import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

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

/** Reactions contain per-reader state and must never be written into public upload roots. */
export function bannerReactionsDataDirectory(options: {
  directory?: string;
  nodeEnvironment?: string;
  publicDirectories?: readonly string[];
}): string | undefined {
  const configured = options.directory?.trim();
  if (!configured && options.nodeEnvironment === 'production') return undefined;
  const input = configured || resolve('.data/banner-reactions');
  if (!isAbsolute(input))
    throw new Error('BANNER_REACTIONS_DATA_DIR must be an absolute private path');
  const directory = physicalPath(input);
  const roots = [
    resolve('public'),
    resolve('uploads'),
    resolve('backend/uploads'),
    resolve('development/apps/web/dist'),
    resolve('apps/web/dist'),
    ...(options.publicDirectories ?? []),
  ];
  for (const root of roots) {
    const publicDirectory = physicalPath(root);
    if (contains(publicDirectory, directory) || contains(directory, publicDirectory))
      throw new Error('BANNER_REACTIONS_DATA_DIR must not overlap public upload or static roots');
  }
  return directory;
}
