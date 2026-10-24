import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import console from 'node:console';

const roots = ['collections', 'festival', 'sports', 'settings', 'finance'];
const digest = (data) => createHash('sha256').update(data).digest('hex');
const inside = (parent, child) => {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
};

async function regular(path, directory = false) {
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile()))
    throw new Error('Only regular files and directories are supported; links are refused');
}

async function files(path, prefix) {
  await regular(path, true);
  const result = [];
  for (const name of (await readdir(path)).sort()) {
    const entry = join(path, name);
    const stat = await lstat(entry);
    if (name.endsWith('.lock') || name.endsWith('.tmp'))
      throw new Error('Transient storage found: stop development writes and resolve locks first');
    if (stat.isDirectory()) result.push(...(await files(entry, `${prefix}/${name}`)));
    else {
      await regular(entry);
      result.push({ source: entry, path: `${prefix}/${name}` });
    }
  }
  return result;
}

async function newDestination(path, sources) {
  const target = join(await realpath(dirname(resolve(path))), basename(path));
  if (sources.some((source) => inside(source, target) || inside(target, source)))
    throw new Error('Snapshot destination must be separate from every source');
  await mkdir(target, { mode: 0o700 }); // Deliberately fails if the target already exists.
  return target;
}

async function put(target, path, data) {
  await mkdir(dirname(join(target, path)), { recursive: true, mode: 0o700 });
  await writeFile(join(target, path), data, { flag: 'wx', mode: 0o600 });
}

export async function createSnapshot({ sql, directories, output, confirm }) {
  if (confirm !== 'DEVELOPMENT_WRITES_STOPPED')
    throw new Error('Stop development writes for the SQL dump and file snapshot first');
  if (!sql || !output || !directories?.collections)
    throw new Error('SQL dump, collections storage and a new output directory are required');
  if (Object.keys(directories).some((key) => !roots.includes(key)))
    throw new Error('Unknown development storage root');
  if (directories.finance) {
    const finance = await realpath(directories.finance);
    for (const [name, path] of Object.entries(directories)) {
      if (name === 'finance' || !path) continue;
      const other = await realpath(path);
      if (inside(finance, other) || inside(other, finance))
        throw new Error('Finance storage must be separate from upload and other feature roots');
    }
  }
  await regular(sql);
  const entries = [{ source: sql, path: 'database.sql' }];
  const sources = [await realpath(sql)];
  for (const [name, path] of Object.entries(directories)) {
    if (!path) continue;
    await regular(path, true);
    sources.push(await realpath(path));
    entries.push(...(await files(path, name)));
  }
  const target = await newDestination(output, sources);
  const manifest = { version: 1, roots: Object.keys(directories), files: [] };
  for (const entry of entries) {
    const data = await readFile(entry.source);
    if (entry.path === 'database.sql' && data.length === 0) throw new Error('Empty SQL dump');
    await put(target, entry.path, data);
    manifest.files.push({ path: entry.path, bytes: data.length, sha256: digest(data) });
  }
  await put(target, 'manifest.json', JSON.stringify(manifest, null, 2));
  return target;
}

export async function verifySnapshot(source) {
  await regular(source, true);
  await regular(join(source, 'manifest.json'));
  const manifest = JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8'));
  if (
    manifest.version !== 1 ||
    !Array.isArray(manifest.files) ||
    !Array.isArray(manifest.roots) ||
    !manifest.roots.includes('collections') ||
    manifest.roots.some((root) => !roots.includes(root)) ||
    new Set(manifest.roots).size !== manifest.roots.length
  )
    throw new Error('Invalid snapshot manifest');
  const expected = new Set(['manifest.json']);
  for (const entry of manifest.files) {
    if (
      typeof entry.path !== 'string' ||
      !/^(database\.sql|(?:collections|festival|sports|settings|finance)\/.+)$/.test(entry.path) ||
      /[\\:]/.test(entry.path) ||
      [...entry.path].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
      entry.path.split('/').some((part) => !part || part === '..' || part === '.') ||
      expected.has(entry.path) ||
      (entry.path !== 'database.sql' && !manifest.roots.includes(entry.path.split('/')[0]))
    )
      throw new Error('Invalid snapshot path');
    expected.add(entry.path);
  }
  if (!expected.has('database.sql')) throw new Error('SQL dump is missing');
  const actual = (await files(source, '')).map((file) => file.path.slice(1));
  if (actual.length !== expected.size || actual.some((path) => !expected.has(path)))
    throw new Error('Unexpected or missing snapshot files');
  for (const entry of manifest.files) {
    const data = await readFile(join(source, entry.path));
    if (data.length !== entry.bytes || digest(data) !== entry.sha256)
      throw new Error('Snapshot checksum mismatch');
    if (entry.path === 'database.sql' && data.length === 0) throw new Error('Empty SQL dump');
  }
  return manifest;
}

export async function stageSnapshot(source, output) {
  const manifest = await verifySnapshot(source);
  const target = await newDestination(output, [await realpath(source)]);
  for (const root of manifest.roots) await mkdir(join(target, root), { mode: 0o700 });
  for (const entry of manifest.files) {
    const data = await readFile(join(source, entry.path));
    if (data.length !== entry.bytes || digest(data) !== entry.sha256)
      throw new Error('Snapshot changed while staging');
    await put(target, entry.path, data);
  }
  return target; // Never imports SQL or replaces live storage.
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === '--help') {
    console.log(
      'create --sql FILE --collections DIR [--festival DIR] [--sports DIR] [--settings DIR] [--finance DIR] --output NEWDIR --confirm DEVELOPMENT_WRITES_STOPPED\nverify --source DIR\nstage --source DIR --output NEWDIR',
    );
    return;
  }
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index]?.slice(2);
    if (!args[index]?.startsWith('--') || !args[index + 1] || options[name] !== undefined)
      throw new Error('Invalid or duplicate arguments');
    options[name] = args[index + 1];
  }
  const allowed =
    command === 'create' ? ['sql', ...roots, 'output', 'confirm'] : ['source', 'output'];
  if (Object.keys(options).some((name) => !allowed.includes(name)))
    throw new Error('Unknown argument');
  if (command === 'create')
    await createSnapshot({
      ...options,
      directories: Object.fromEntries(
        roots.filter((root) => options[root]).map((root) => [root, options[root]]),
      ),
    });
  else if (command === 'verify' && options.source) await verifySnapshot(options.source);
  else if (command === 'stage' && options.source && options.output)
    await stageSnapshot(options.source, options.output);
  else throw new Error('Use --help for snapshot commands');
  console.log('Development snapshot operation completed');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
