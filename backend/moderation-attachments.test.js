const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const {
  ATTACHMENT_ROUTE,
  MAX_ATTACHMENT_BYTES,
  ModerationAttachmentError,
  attachmentIdFromUrl,
  validateModerationMarkdown,
  resolvePrivateDirectory,
  attachmentFilePath,
  validateStoredImage,
  createModerationAttachmentStore,
} = require('./moderation-attachments');

const ID = '12345678-1234-4234-8234-123456789abc';
const OTHER_ID = '87654321-1234-4234-8234-123456789abc';
const URL = `${ATTACHMENT_ROUTE}${ID}`;
const OTHER_URL = `${ATTACHMENT_ROUTE}${OTHER_ID}`;

test('collects inline and reference images from nested Markdown, deduplicating attachment IDs', () => {
  const markdown = `# Test\n\n![one](${URL})\n\n> - ![two][picture]\n\n| Image |\n| --- |\n| ![three](${OTHER_URL}) |\n\n[picture]: ${URL} "caption"`;
  assert.deepEqual(validateModerationMarkdown(markdown), [ID, OTHER_ID]);
});

test('allows ordinary links, autolinks and formatting while leaving code examples uninterpreted', () => {
  const markdown = `**Hello** [web](https://example.com) <https://example.org> [mail](mailto:example@example.com)\n\n\`<img src="https://example.com/picture">\`\n\n\`\`\`html\n<iframe src="https://example.com"></iframe>\n![external](https://example.com/picture)\n[tool](/tool-workshop?tool=t_0123456789abcdef)\n\`\`\``;
  assert.deepEqual(validateModerationMarkdown(markdown), []);
});

test('checks reference and linked images instead of relying on inline-image regular expressions', () => {
  for (const markdown of [
    '![external][picture]\n\n[picture]: https://example.com/picture.png',
    '[![external](https://example.com/picture.png)](https://example.com)',
    '![external]\n\n[external]: data:image/png;base64,YQ==',
    '> ![external](//example.com/picture.png)',
  ]) {
    assert.throws(() => validateModerationMarkdown(markdown), /本站上传/);
  }
});

test('only canonical private attachment URLs are accepted for rendered images', () => {
  for (const value of [
    `https://example.com${URL}`,
    `${URL}?raw=1`,
    `${URL}#preview`,
    `${URL}/..`,
    `${ATTACHMENT_ROUTE}../${ID}`,
    `${ATTACHMENT_ROUTE}%2e%2e/${ID}`,
    `${ATTACHMENT_ROUTE}%31${ID.slice(1)}`,
    `${ATTACHMENT_ROUTE}${ID.toUpperCase()}`,
    `/uploads/${ID}.webp`,
    `\\api\\moderation\\attachments\\${ID}`,
    `data:image/webp;base64,YQ==`,
    'javascript:alert%281%29', // eslint-disable-line no-script-url -- intentional rejection fixture
  ]) {
    assert.equal(attachmentIdFromUrl(value), null);
    assert.throws(
      () => validateModerationMarkdown(`![image](<${value}>)`),
      ModerationAttachmentError,
    );
  }
  assert.equal(attachmentIdFromUrl(URL), ID);
});

test('rejects HTML multimedia and other raw HTML without rejecting escaped text examples', () => {
  for (const markup of [
    `<img src="${URL}">`,
    '<IMG SRC="https://example.com/remote.png">',
    '<svg><image href="https://example.com/remote.png"/></svg>',
    '<iframe srcdoc="hello"></iframe>',
    '<video poster="https://example.com/remote.png"></video>',
    '<picture><source srcset="https://example.com/remote.png"></picture>',
    '<object data="https://example.com/remote.svg"></object>',
    '<audio src="https://example.com/audio"></audio>',
    '<div style="background-image: url(https://example.com/image)">hello</div>',
    '<a href="/tool-workshop?tool=t_0123456789abcdef">tool</a>',
  ]) {
    assert.throws(() => validateModerationMarkdown(markup), /HTML/);
  }
  assert.deepEqual(validateModerationMarkdown('&lt;img src="example"&gt;'), []);
});

test('rejects all current dynamic embeds, including autolinks and entity-encoded queries', () => {
  for (const href of [
    '/tool-workshop?tool=t_0123456789abcdef',
    '/tool-workshop.html?tool=t_0123456789abcdef',
    '/code-lab?experiment=e_0123456789abcdef0123456789abcdef',
    '/code-lab.html?experiment=e_0123456789abcdef0123456789abcdef',
    '/circuit?cid=c_0123456789abcdef01234567&revision=1&view=live',
    '/circuit?cid=c_0123456789abcdef01234567&amp;revision=1&amp;view=waveform',
    'https://example.com/a/../tool-workshop?tool=t_0123456789abcdef',
  ]) {
    assert.throws(() => validateModerationMarkdown(`[reference](${href})`), /动态嵌入/);
  }
  assert.throws(
    () => validateModerationMarkdown('<https://example.com/tool-workshop?tool=t_0123456789abcdef>'),
    /动态嵌入/,
  );
  assert.deepEqual(validateModerationMarkdown('[workshop instructions](/tool-workshop)'), []);
  assert.deepEqual(validateModerationMarkdown('[circuit instructions](/circuit)'), []);
});

test('rejects non-text, excessive text, excessive images and executable link schemes', () => {
  for (const value of [null, {}, 1, 'a'.repeat(20001)]) {
    assert.throws(() => validateModerationMarkdown(value), ModerationAttachmentError);
  }
  assert.throws(() => validateModerationMarkdown(`![x](${URL})\n`.repeat(13)), /12 张/);
  assert.throws(() => validateModerationMarkdown('[x](javascript&#58;alert%281%29)'), /链接格式/);
  assert.throws(() => validateModerationMarkdown('[x](data:text/html;base64,YQ==)'), /链接格式/);
});

test('private storage must be outside the upload tree and filenames cannot traverse it', () => {
  const root = path.resolve('attachment-config-test');
  const uploadDir = path.join(root, 'uploads');
  assert.equal(resolvePrivateDirectory({ uploadDir }), path.join(root, 'moderation-private'));
  for (const privateDir of [uploadDir, path.join(uploadDir, 'hidden'), root]) {
    assert.throws(() => resolvePrivateDirectory({ uploadDir, privateDir }), /公开上传目录之外/);
  }
  assert.throws(() => resolvePrivateDirectory({ uploadDir: 'relative' }), /配置无效/);
  for (const name of [
    '../secret.webp',
    '..\\secret.webp',
    `${ID}.webp/../secret`,
    `${ID}.svg`,
    'file.webp',
  ]) {
    assert.throws(() => attachmentFilePath(root, name), /不存在或不可访问/);
  }
  assert.equal(attachmentFilePath(root, `${ID}.webp`), path.join(root, `${ID}.webp`));
});

test('private storage rejects overlap with every static root and validates public directory configuration', () => {
  const root = path.resolve('attachment-config-test');
  const uploadDir = path.join(root, 'uploads');
  const publicDirs = [
    path.join(root, 'public'),
    path.join(root, 'development', 'apps', 'web', 'dist'),
    path.join(root, 'node_modules'),
  ];
  for (const publicDir of publicDirs) {
    for (const privateDir of [publicDir, path.join(publicDir, 'hidden'), path.dirname(publicDir)]) {
      assert.throws(
        () => resolvePrivateDirectory({ uploadDir, privateDir, publicDirs }),
        /公开上传目录之外/,
      );
    }
  }
  const privateDir = path.join(root, 'public-private');
  assert.equal(resolvePrivateDirectory({ uploadDir, privateDir, publicDirs }), privateDir);
  assert.equal(
    resolvePrivateDirectory({ uploadDir, publicDirs }),
    path.join(root, 'moderation-private'),
  );
  for (const invalid of [null, 'public', ['relative'], [null]]) {
    assert.throws(() => resolvePrivateDirectory({ uploadDir, publicDirs: invalid }), /配置无效/);
  }
});

function makeImage(width = 32, height = 24) {
  return sharp({ create: { width, height, channels: 3, background: '#27808d' } });
}

test('stored image validation requires a complete metadata-free static WebP within size limits', async () => {
  const valid = await makeImage().webp().toBuffer();
  await validateStoredImage(valid);
  for (const buffer of [
    Buffer.alloc(0),
    Buffer.alloc(MAX_ATTACHMENT_BYTES + 1),
    Buffer.from('not an image'),
    valid.subarray(0, 20),
    await makeImage().png().toBuffer(),
    await makeImage(1601, 1).webp().toBuffer(),
    await makeImage().webp().withMetadata({ orientation: 6 }).toBuffer(),
  ]) {
    await assert.rejects(validateStoredImage(buffer), ModerationAttachmentError);
  }
  const animated = await sharp(Buffer.concat([Buffer.alloc(48, 255), Buffer.alloc(48, 0)]), {
    raw: { width: 4, height: 8, channels: 3, pageHeight: 4 },
  })
    .webp({ delay: [100, 100] })
    .toBuffer();
  await assert.rejects(validateStoredImage(animated), ModerationAttachmentError);
});

async function createHarness(t, options = {}) {
  const tempParent = await fs.realpath(os.tmpdir());
  const directory = await fs.mkdtemp(path.join(tempParent, 'freebbs-moderation-attachments-'));
  t.after(async () => {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), tempParent);
    assert.ok(path.basename(resolved).startsWith('freebbs-moderation-attachments-'));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  const uploadDir = path.join(directory, 'uploads');
  const privateDir = path.join(directory, 'private');
  await fs.mkdir(uploadDir);
  const records = new Map();
  const reads = [];
  const registrations = [];
  const service = {
    async registerAttachment(metadata) {
      registrations.push(metadata);
      if (options.failRegisterBeforeCommit) throw new Error('DB secret must not leak');
      records.set(metadata.id, { ...metadata, access: 'private' });
      if (options.failRegisterAfterCommit) throw new Error('Connection lost after COMMIT');
      return records.get(metadata.id);
    },
    async getAttachment({ id, userId }) {
      reads.push({ id, userId });
      if (options.failRead) throw new Error('Connection unavailable');
      const record = records.get(id);
      if (!record || (!record.public && record.authorId !== userId && userId !== 99)) {
        throw Object.assign(new Error('Not found'), { status: 404 });
      }
      return record;
    },
  };
  const store = createModerationAttachmentStore({
    uploadDir,
    privateDir,
    service,
    createId: () => ID,
  });
  return { directory, uploadDir, privateDir, records, reads, registrations, service, store };
}

async function directoryLink(t, target, link) {
  try {
    await fs.symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    return true;
  } catch (error) {
    if (['EPERM', 'EACCES'].includes(error.code)) {
      t.skip('This host does not permit creating a directory symlink');
      return false;
    }
    throw error;
  }
}

test('missing static build directories are checked without creating them or blocking safe private storage', async (t) => {
  const env = await createHarness(t);
  const publicDir = path.join(env.directory, 'public');
  const missingDist = path.join(env.directory, 'development', 'apps', 'web', 'dist');
  await fs.mkdir(publicDir);
  const store = createModerationAttachmentStore({
    ...env,
    publicDirs: [publicDir, missingDist],
    createId: () => ID,
  });
  const buffer = await makeImage().webp().toBuffer();
  await store.store({ ownerId: 7, buffer });
  assert.deepEqual((await store.read({ id: ID, userId: 7 })).buffer, buffer);
  await assert.rejects(fs.lstat(missingDist), { code: 'ENOENT' });
  assert.deepEqual(await fs.readdir(publicDir), []);
});

test('a private-directory alias into any static tree is rejected before writing or registration', async (t) => {
  for (const name of ['public', 'dist', 'node_modules']) {
    const env = await createHarness(t);
    const publicDir = path.join(env.directory, name);
    await fs.mkdir(publicDir);
    if (!(await directoryLink(t, publicDir, env.privateDir))) return;
    const store = createModerationAttachmentStore({ ...env, publicDirs: [publicDir] });
    await assert.rejects(store.store({ ownerId: 7, buffer: await makeImage().webp().toBuffer() }), {
      status: 503,
    });
    assert.deepEqual(await fs.readdir(publicDir), []);
    assert.equal(env.registrations.length, 0);
  }
});

test('a private ancestor alias into public storage is rejected before creating its missing child', async (t) => {
  const env = await createHarness(t);
  const publicDir = path.join(env.directory, 'public');
  const alias = path.join(env.directory, 'private-parent');
  await fs.mkdir(publicDir);
  if (!(await directoryLink(t, publicDir, alias))) return;
  const store = createModerationAttachmentStore({
    ...env,
    privateDir: path.join(alias, 'new-private'),
    publicDirs: [publicDir],
  });
  await assert.rejects(store.store({ ownerId: 7, buffer: await makeImage().webp().toBuffer() }), {
    status: 503,
  });
  assert.deepEqual(await fs.readdir(publicDir), []);
  assert.equal(env.registrations.length, 0);
});

test('every read rechecks static directory aliases against the existing private directory', async (t) => {
  const env = await createHarness(t);
  const publicDir = path.join(env.directory, 'public');
  await fs.mkdir(publicDir);
  const store = createModerationAttachmentStore({
    ...env,
    publicDirs: [publicDir],
    createId: () => ID,
  });
  const buffer = await makeImage().webp().toBuffer();
  await store.store({ ownerId: 7, buffer });
  await fs.rmdir(publicDir);
  if (!(await directoryLink(t, env.privateDir, publicDir))) return;
  await assert.rejects(store.read({ id: ID, userId: 7 }), { status: 503 });
  assert.deepEqual(await fs.readFile(path.join(env.privateDir, `${ID}.webp`)), buffer);
});

test('a missing static path under an existing alias into private storage is also rejected', async (t) => {
  const env = await createHarness(t);
  const alias = path.join(env.directory, 'development');
  await fs.mkdir(env.privateDir);
  if (!(await directoryLink(t, env.privateDir, alias))) return;
  const store = createModerationAttachmentStore({
    ...env,
    publicDirs: [path.join(alias, 'apps', 'web', 'dist')],
  });
  await assert.rejects(store.store({ ownerId: 7, buffer: await makeImage().webp().toBuffer() }), {
    status: 503,
  });
  assert.deepEqual(await fs.readdir(env.privateDir), []);
  assert.equal(env.registrations.length, 0);
});

test('stores only in the private directory and returns an opaque controlled URL', async (t) => {
  const env = await createHarness(t);
  const buffer = await makeImage().webp().toBuffer();
  const result = await env.store.store({ ownerId: 7, buffer });
  assert.deepEqual(result, { id: ID, url: URL, mimeType: 'image/webp', byteSize: buffer.length });
  assert.deepEqual(await fs.readdir(env.uploadDir), []);
  assert.deepEqual(await fs.readFile(path.join(env.privateDir, `${ID}.webp`)), buffer);
  assert.equal(env.registrations[0].authorId, 7);
  assert.equal(
    env.registrations[0].sha256,
    crypto.createHash('sha256').update(buffer).digest('hex'),
  );
  assert.equal(env.registrations[0].fileName, `${ID}.webp`);
  assert.equal(JSON.stringify(result).includes(env.directory), false);
});

test('read consults current authority for the author, reviewer and public status on every request', async (t) => {
  const env = await createHarness(t);
  const buffer = await makeImage().webp().toBuffer();
  await env.store.store({ ownerId: 7, buffer });
  for (const userId of [7, 99]) {
    assert.deepEqual((await env.store.read({ id: ID, userId })).buffer, buffer);
  }
  await assert.rejects(env.store.read({ id: ID, userId: 8 }), { status: 404 });
  await assert.rejects(env.store.read({ id: ID, userId: null }), { status: 404 });
  env.records.get(ID).public = true;
  env.records.get(ID).access = 'published';
  assert.equal((await env.store.read({ id: ID, userId: null })).access, 'published');
  env.records.get(ID).public = false;
  await assert.rejects(env.store.read({ id: ID, userId: null }), { status: 404 });
  assert.equal(env.reads.length, 6);
});

test('invalid IDs do not reach DB or disk and a corrupt stored filename cannot escape the private tree', async (t) => {
  const env = await createHarness(t);
  for (const id of ['../secret', '..\\secret', `${ID}/..`, `%2e%2e`, ID.toUpperCase()]) {
    await assert.rejects(env.store.read({ id, userId: 7 }), { status: 404 });
  }
  assert.equal(env.reads.length, 0);
  await env.store.store({ ownerId: 7, buffer: await makeImage().webp().toBuffer() });
  env.records.get(ID).fileName = '../outside.webp';
  await assert.rejects(env.store.read({ id: ID, userId: 7 }), { status: 404 });
});

test('a DB authorization failure keeps the file private and does not expose internal details', async (t) => {
  const env = await createHarness(t, { failRead: true });
  await assert.rejects(env.store.read({ id: ID, userId: 7 }), (error) => {
    assert.equal(error.status, 503);
    assert.equal(error.message.includes('Connection'), false);
    return true;
  });
});

test('read rejects altered bytes and invalid recorded sizes without exposing a local path', async (t) => {
  const env = await createHarness(t);
  const buffer = await makeImage().webp().toBuffer();
  await env.store.store({ ownerId: 7, buffer });
  const altered = Buffer.from(buffer);
  altered[altered.length - 1] = (altered[altered.length - 1] + 1) % 256;
  await fs.writeFile(path.join(env.privateDir, `${ID}.webp`), altered);
  await assert.rejects(env.store.read({ id: ID, userId: 7 }), (error) => {
    assert.equal(error.status, 503);
    assert.equal(error.message.includes(env.directory), false);
    return true;
  });
  env.records.get(ID).byteSize = MAX_ATTACHMENT_BYTES + 1;
  await assert.rejects(env.store.read({ id: ID, userId: 7 }), { status: 503 });
});

test('failed registration cleans only a definitely unregistered private file', async (t) => {
  const env = await createHarness(t, { failRegisterBeforeCommit: true });
  await assert.rejects(
    env.store.store({ ownerId: 7, buffer: await makeImage().webp().toBuffer() }),
    (error) => error.status === 503 && !error.message.includes('DB secret'),
  );
  assert.deepEqual(await fs.readdir(env.privateDir), []);
});

test('uncertain registration preserves bytes if the record exists or the DB cannot be checked', async (t) => {
  for (const options of [
    { failRegisterAfterCommit: true },
    { failRegisterBeforeCommit: true, failRead: true },
  ]) {
    const env = await createHarness(t, options);
    const buffer = await makeImage().webp().toBuffer();
    await assert.rejects(env.store.store({ ownerId: 7, buffer }), { status: 503 });
    assert.deepEqual(await fs.readFile(path.join(env.privateDir, `${ID}.webp`)), buffer);
  }
});

test('a UUID collision never overwrites or removes an existing attachment', async (t) => {
  const env = await createHarness(t);
  const buffer = await makeImage().webp().toBuffer();
  await env.store.store({ ownerId: 7, buffer });
  await assert.rejects(env.store.store({ ownerId: 8, buffer }), { status: 503 });
  assert.deepEqual(await fs.readFile(path.join(env.privateDir, `${ID}.webp`)), buffer);
  assert.equal(env.records.get(ID).authorId, 7);
  assert.equal(env.registrations.length, 1);
});

test('a private-directory symlink into public uploads is rejected before bytes are written', async (t) => {
  const env = await createHarness(t);
  try {
    await fs.symlink(
      env.uploadDir,
      env.privateDir,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
  } catch (error) {
    if (['EPERM', 'EACCES'].includes(error.code)) {
      t.skip('This host does not permit creating a directory symlink');
      return;
    }
    throw error;
  }
  await assert.rejects(
    env.store.store({ ownerId: 7, buffer: await makeImage().webp().toBuffer() }),
    { status: 503 },
  );
  assert.deepEqual(await fs.readdir(env.uploadDir), []);
  assert.equal(env.registrations.length, 0);
});

test('a symlinked stored file cannot be read even when its target has matching bytes', async (t) => {
  const env = await createHarness(t);
  const buffer = await makeImage().webp().toBuffer();
  await env.store.store({ ownerId: 7, buffer });
  const destination = path.join(env.privateDir, `${ID}.webp`);
  const outside = path.join(env.directory, 'outside.webp');
  await fs.writeFile(outside, buffer);
  await fs.unlink(destination);
  try {
    await fs.symlink(outside, destination, 'file');
  } catch (error) {
    if (['EPERM', 'EACCES'].includes(error.code)) {
      t.skip('This host does not permit creating a file symlink');
      return;
    }
    throw error;
  }
  await assert.rejects(env.store.read({ id: ID, userId: 7 }), { status: 503 });
});
