import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createSnapshot, stageSnapshot, verifySnapshot } from '../../scripts/data-snapshot.mjs';

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'development-snapshot-'));
  try {
    const storage = join(root, 'runtime');
    await mkdir(join(storage, 'forms'), { recursive: true });
    await writeFile(join(storage, 'forms', 'record.json'), '{"id":"record"}');
    await writeFile(join(storage, '封面.png'), 'test-image');
    const sql = join(root, 'development.sql');
    await writeFile(sql, '-- isolated development database dump');
    await run({
      root,
      storage,
      sql,
      output: join(root, 'snapshot'),
      confirm: 'DEVELOPMENT_WRITES_STOPPED',
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('SQL, feature JSON and uploads survive verified staging without replacing runtime', async () => {
  await fixture(async (options) => {
    await createSnapshot({ ...options, directories: { collections: options.storage } });
    const manifest = await verifySnapshot(options.output);
    assert.equal(manifest.files.length, 3);
    const target = join(options.root, 'staged');
    await stageSnapshot(options.output, target);
    assert.equal(
      await readFile(join(target, 'collections/forms/record.json'), 'utf8'),
      '{"id":"record"}',
    );
    assert.equal(await readFile(join(target, 'collections/封面.png'), 'utf8'), 'test-image');
    assert.equal(await readFile(join(options.storage, '封面.png'), 'utf8'), 'test-image');
    await assert.rejects(stageSnapshot(options.output, options.storage));
    await assert.rejects(
      createSnapshot({ ...options, directories: { collections: options.storage } }),
    );
  });
});

test('private financial records and grants survive verified staging in their own root', async () => {
  await fixture(async (options) => {
    const finance = join(options.root, 'private-finance');
    await mkdir(join(finance, 'finance-tracking'), { recursive: true });
    const ledger = JSON.stringify({
      id: 'finance-tracking',
      grants: [{ uid: 'responsible-student', departmentIds: ['organization'] }],
      claims: [{ id: 'claim-1', payeeStudentId: 'test-student-id', amountCents: 15000 }],
    });
    await writeFile(join(finance, 'finance-tracking', 'ledger.json'), ledger);
    await createSnapshot({
      ...options,
      directories: { collections: options.storage, finance },
    });
    const manifest = await verifySnapshot(options.output);
    assert.deepEqual(manifest.roots, ['collections', 'finance']);
    const target = join(options.root, 'staged');
    await stageSnapshot(options.output, target);
    assert.equal(
      await readFile(join(target, 'finance/finance-tracking/ledger.json'), 'utf8'),
      ledger,
    );
    assert.equal(await readFile(join(finance, 'finance-tracking/ledger.json'), 'utf8'), ledger);
    await writeFile(join(options.output, 'finance/finance-tracking/ledger.json'), '{}');
    await assert.rejects(verifySnapshot(options.output), /checksum/);
  });
});

test('refuses finance storage nested in upload roots or containing those roots', async () => {
  await fixture(async (options) => {
    const nested = join(options.storage, 'finance');
    await mkdir(nested);
    for (const finance of [nested, options.storage, options.root]) {
      await assert.rejects(
        createSnapshot({
          ...options,
          directories: { collections: options.storage, finance },
        }),
        /Finance storage must be separate/,
      );
    }
  });
});

test('requires stopped writes and separate targets, rejects live lock directories', async () => {
  await fixture(async (options) => {
    const directories = { collections: options.storage };
    await assert.rejects(
      createSnapshot({ ...options, directories, confirm: '' }),
      /Stop development writes/,
    );
    await assert.rejects(
      createSnapshot({ ...options, directories, output: join(options.storage, 'backup') }),
      /separate/,
    );
    await mkdir(join(options.storage, 'active.json.lock'));
    await assert.rejects(createSnapshot({ ...options, directories }), /Transient/);
  });
});

test('rejects tampering, extra files and path traversal before staging any files', async () => {
  await fixture(async (options) => {
    await createSnapshot({ ...options, directories: { collections: options.storage } });
    const record = join(options.output, 'collections/forms/record.json');
    await writeFile(record, 'tampered');
    await assert.rejects(stageSnapshot(options.output, join(options.root, 'staged')), /checksum/);
    await writeFile(record, '{"id":"record"}');
    const extra = join(options.output, 'extra');
    await writeFile(extra, 'extra');
    await assert.rejects(verifySnapshot(options.output), /Unexpected/);
    await rm(extra);
    const path = join(options.output, 'manifest.json');
    const manifest = JSON.parse(await readFile(path, 'utf8'));
    manifest.files[0].path = 'collections/../../outside';
    await writeFile(path, JSON.stringify(manifest));
    await assert.rejects(
      stageSnapshot(options.output, join(options.root, 'staged')),
      /Invalid snapshot path/,
    );
  });
});
