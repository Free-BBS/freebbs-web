const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('path');
const sharp = require('sharp');
const {
  AVATAR_SIZE,
  MAX_AVATAR_BYTES,
  AvatarUploadError,
  normalizeAvatar,
  ownedAvatarFileName,
  createAvatarUploadService,
  createMysqlAvatarStore,
} = require('./avatar-upload');

function dataUrl(buffer, mime = 'image/png') {
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

function makeImage(width = 32, height = 24) {
  return sharp({ create: { width, height, channels: 4, background: '#087f8c' } });
}

for (const format of ['png', 'jpeg', 'webp', 'gif']) {
  test(`decodes real ${format} content and normalizes it to a bounded WebP`, async () => {
    const input = await makeImage(900, 600)[format]().toBuffer();
    const result = await normalizeAvatar(dataUrl(input, `image/${format}`));
    const metadata = await sharp(result.buffer).metadata();
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.width, AVATAR_SIZE);
    assert.ok(metadata.height <= AVATAR_SIZE);
    assert.equal(result.animated, false);
  });
}

test('does not enlarge small images and strips metadata after EXIF rotation', async () => {
  const input = await makeImage(40, 20).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const result = await normalizeAvatar(dataUrl(input, 'image/jpeg'));
  const metadata = await sharp(result.buffer).metadata();
  assert.equal(metadata.width, 20);
  assert.equal(metadata.height, 40);
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.orientation, undefined);
});

test('converts animated GIF to the first static frame and reports the conversion', async () => {
  const input = await sharp(Buffer.concat([Buffer.alloc(48, 255), Buffer.alloc(48, 0)]), {
    raw: { width: 4, height: 8, channels: 3, pageHeight: 4 },
  })
    .gif({ delay: [100, 100] })
    .toBuffer();
  assert.equal((await sharp(input).metadata()).pages, 2);
  const result = await normalizeAvatar(dataUrl(input, 'image/gif'));
  const metadata = await sharp(result.buffer).metadata();
  assert.equal(result.animated, true);
  assert.equal(metadata.height, 4);
  assert.equal(metadata.pages || 1, 1);
});

test('rejects non-images, mismatched MIME declarations and incomplete image payloads', async () => {
  await assert.rejects(normalizeAvatar(dataUrl(Buffer.from('not an image'))), AvatarUploadError);
  const png = await makeImage().png().toBuffer();
  await assert.rejects(normalizeAvatar(dataUrl(png, 'image/jpeg')), /格式不一致/);
  await assert.rejects(normalizeAvatar(dataUrl(png.subarray(0, 40))), AvatarUploadError);
  await assert.rejects(normalizeAvatar(dataUrl(Buffer.from('<svg/>'), 'image/svg+xml')), /请上传/);
});

test('rejects invalid, noncanonical and over-limit data URLs before decoding an image', async () => {
  for (const value of [null, {}, '', 'data:image/png;base64,ab=c', 'data:image/png;base64,AAA']) {
    await assert.rejects(normalizeAvatar(value), AvatarUploadError);
  }
  await assert.rejects(normalizeAvatar(dataUrl(Buffer.alloc(MAX_AVATAR_BYTES + 1))), /5MB/);
  await assert.rejects(normalizeAvatar('data:image/png;base64,'), /5MB/);
});

test('rejects excessively large dimensions and decoded pixel counts', async () => {
  const wideImage = await makeImage(12001, 1).png().toBuffer();
  await assert.rejects(normalizeAvatar(dataUrl(wideImage)), /尺寸过大/);
  const hugeImage = await makeImage(6001, 6000).png().toBuffer();
  await assert.rejects(normalizeAvatar(dataUrl(hugeImage)), /尺寸过大/);
});

test('cleanup recognizes only local avatar filenames owned by the authenticated user', () => {
  assert.equal(ownedAvatarFileName('/uploads/user-7-123456.png', 7), 'user-7-123456.png');
  const filename = 'user-7-12345678-1234-4234-8234-123456789abc.webp';
  assert.equal(ownedAvatarFileName(`/uploads/${filename}`, 7), filename);
  for (const value of [
    '/assets/user-7-123456.png',
    '/uploads/user-8-123456.png',
    '/uploads/../user-7-123456.png',
    '/uploads/nested/user-7-123456.png',
    'https://example.com/uploads/user-7-123456.png',
    '/uploads/user-7-123456.png?x=1',
    '/uploads/user-7-123456.png/..',
    null,
  ]) {
    assert.equal(ownedAvatarFileName(value, 7), null);
  }
});

function createMemoryFiles(initialPaths = []) {
  const values = new Map(initialPaths.map((filePath) => [filePath, Buffer.from('old avatar')]));
  return {
    values,
    async writeFile(filePath, buffer, options) {
      assert.equal(options.flag, 'wx');
      if (values.has(filePath)) throw Object.assign(new Error('File exists'), { code: 'EEXIST' });
      values.set(filePath, buffer);
    },
    async unlink(filePath) {
      if (!values.has(filePath)) throw Object.assign(new Error('Missing file'), { code: 'ENOENT' });
      values.delete(filePath);
    },
  };
}

function createMemoryPool({
  user = { id: 7, uid: 'user-seven', avatar_path: '/uploads/user-7-1.png' },
  failUpdate = false,
  uncertainCommit = false,
} = {}) {
  const state = {
    user,
    statements: [],
    commits: 0,
    rollbacks: 0,
    releases: 0,
    tail: Promise.resolve(),
  };
  return {
    state,
    async execute(_sql, [userId]) {
      return [[state.user && state.user.id === userId ? { ...state.user } : null].filter(Boolean)];
    },
    async getConnection() {
      let releaseLock;
      let current;
      return {
        async beginTransaction() {
          const previous = state.tail;
          state.tail = new Promise((resolve) => {
            releaseLock = resolve;
          });
          await previous;
          current = state.user && { ...state.user };
        },
        async execute(sql, parameters) {
          state.statements.push(sql);
          if (sql.startsWith('UPDATE')) {
            if (failUpdate) throw new Error('Database update failed');
            current.avatar_path = parameters[1];
            if (!current.uid) current.uid = parameters[0];
            return [{ affectedRows: 1 }];
          }
          return [[current && { ...current }].filter(Boolean)];
        },
        async commit() {
          state.user = current;
          state.commits += 1;
          if (uncertainCommit) throw new Error('Connection lost after commit');
        },
        async rollback() {
          state.rollbacks += 1;
        },
        release() {
          state.releases += 1;
          releaseLock();
        },
      };
    },
  };
}

function createUploadHarness(options = {}) {
  const uploadDir = path.resolve('avatar-test-virtual');
  const pool = createMemoryPool(options);
  const files = createMemoryFiles([path.join(uploadDir, 'user-7-1.png')]);
  const store = createMysqlAvatarStore({ pool, createUserUid: async () => 'fallback-uid' });
  let sequence = 0;
  const cleanupErrors = [];
  const upload = createAvatarUploadService({
    uploadDir,
    store,
    files,
    createId: () => {
      sequence += 1;
      return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
    },
    processImage: async () => ({ buffer: Buffer.from('normalized WebP'), animated: false }),
    onCleanupError: (error) => cleanupErrors.push(error),
  });
  return { upload, uploadDir, pool, files, store, cleanupErrors };
}

test('writes a unique normalized avatar, commits the profile, and removes the previous owned file', async () => {
  const harness = createUploadHarness();
  const result = await harness.upload({ userId: 7, imageDataUrl: 'mock image' });
  assert.equal(result.user.avatar_path, harness.pool.state.user.avatar_path);
  assert.equal(harness.files.values.size, 1);
  assert.ok(
    harness.files.values.has(path.join(harness.uploadDir, path.basename(result.user.avatar_path))),
  );
  assert.equal(harness.pool.state.commits, 1);
  assert.equal(harness.pool.state.releases, 1);
  assert.match(harness.pool.state.statements[0], /FOR UPDATE$/);
});

test('a database update failure removes the new file and preserves the old avatar', async () => {
  const harness = createUploadHarness({ failUpdate: true });
  await assert.rejects(harness.upload({ userId: 7, imageDataUrl: 'mock image' }), /update failed/);
  assert.deepEqual(
    [...harness.files.values.keys()],
    [path.join(harness.uploadDir, 'user-7-1.png')],
  );
  assert.equal(harness.pool.state.user.avatar_path, '/uploads/user-7-1.png');
  assert.equal(harness.pool.state.rollbacks, 1);
  assert.equal(harness.pool.state.releases, 1);
});

test('a commit with uncertain outcome never deletes the new avatar already in use', async () => {
  const harness = createUploadHarness({ uncertainCommit: true });
  await assert.rejects(
    harness.upload({ userId: 7, imageDataUrl: 'mock image' }),
    /Connection lost/,
  );
  const activeFile = path.join(
    harness.uploadDir,
    path.basename(harness.pool.state.user.avatar_path),
  );
  assert.ok(harness.files.values.has(activeFile));
  assert.equal(harness.files.values.size, 2);
});

test('concurrent replacements lock and use the latest old path, retaining only the final avatar', async () => {
  const harness = createUploadHarness();
  const results = await Promise.all([
    harness.upload({ userId: 7, imageDataUrl: 'first image' }),
    harness.upload({ userId: 7, imageDataUrl: 'second image' }),
  ]);
  assert.notEqual(results[0].user.avatar_path, results[1].user.avatar_path);
  const activeFile = path.join(
    harness.uploadDir,
    path.basename(harness.pool.state.user.avatar_path),
  );
  assert.deepEqual([...harness.files.values.keys()], [activeFile]);
  assert.equal(harness.pool.state.releases, 2);
});

test('missing users roll back and do not leave newly written files', async () => {
  const harness = createUploadHarness({ user: null });
  await assert.rejects(
    harness.upload({ userId: 7, imageDataUrl: 'mock image' }),
    (error) => error.status === 401,
  );
  assert.equal(harness.files.values.size, 1);
  assert.equal(harness.pool.state.rollbacks, 1);
});

test('default avatars are never removed and cleanup errors do not turn successful saves into failures', async () => {
  const defaults = createUploadHarness({ user: { id: 7, avatar_path: '/assets/default.png' } });
  await defaults.upload({ userId: 7, imageDataUrl: 'mock image' });
  assert.ok(defaults.files.values.has(path.join(defaults.uploadDir, 'user-7-1.png')));
  const harness = createUploadHarness();
  harness.files.unlink = async () => {
    throw Object.assign(new Error('Permission denied'), { code: 'EACCES' });
  };
  const result = await harness.upload({ userId: 7, imageDataUrl: 'mock image' });
  assert.equal(result.user.avatar_path, harness.pool.state.user.avatar_path);
  assert.equal(harness.cleanupErrors.length, 1);
});

test('unreadable database state after failure keeps the candidate file and reports deferred cleanup', async () => {
  const harness = createUploadHarness({ failUpdate: true });
  harness.store.isCurrent = async () => {
    throw new Error('Database unavailable');
  };
  await assert.rejects(harness.upload({ userId: 7, imageDataUrl: 'mock image' }), /update failed/);
  assert.equal(harness.files.values.size, 2);
  assert.equal(harness.cleanupErrors.length, 1);
});

test('invalid image data is rejected before filesystem or database writes', async () => {
  const upload = createAvatarUploadService({
    uploadDir: path.resolve('avatar-test-virtual'),
    store: { replace: () => assert.fail('database should not be reached') },
    files: { writeFile: () => assert.fail('filesystem should not be reached') },
  });
  await assert.rejects(upload({ userId: 7, imageDataUrl: 'not an image' }), AvatarUploadError);
  await assert.rejects(
    upload({ userId: '../7', imageDataUrl: 'not an image' }),
    (error) => error.status === 401,
  );
});

test('partial filesystem write failures remove the incomplete file without touching the profile', async () => {
  const harness = createUploadHarness();
  harness.files.writeFile = async (filePath) => {
    harness.files.values.set(filePath, Buffer.from('partial data'));
    throw Object.assign(new Error('Disk full'), { code: 'ENOSPC' });
  };
  await assert.rejects(harness.upload({ userId: 7, imageDataUrl: 'mock image' }), /Disk full/);
  assert.deepEqual(
    [...harness.files.values.keys()],
    [path.join(harness.uploadDir, 'user-7-1.png')],
  );
  assert.equal(harness.pool.state.commits, 0);
});

test('exclusive file creation preserves an existing file even on a filename collision', async () => {
  const harness = createUploadHarness();
  const existingFile = path.join(
    harness.uploadDir,
    'user-7-00000000-0000-4000-8000-000000000001.webp',
  );
  harness.files.values.set(existingFile, Buffer.from('existing avatar'));
  await assert.rejects(
    harness.upload({ userId: 7, imageDataUrl: 'mock image' }),
    (error) => error.code === 'EEXIST',
  );
  assert.equal(harness.files.values.get(existingFile).toString(), 'existing avatar');
  assert.equal(harness.pool.state.commits, 0);
});

test('failures before acquiring a database connection clean up the candidate avatar', async () => {
  const harness = createUploadHarness();
  harness.pool.getConnection = async () => {
    throw new Error('Pool unavailable');
  };
  await assert.rejects(
    harness.upload({ userId: 7, imageDataUrl: 'mock image' }),
    /Pool unavailable/,
  );
  assert.deepEqual(
    [...harness.files.values.keys()],
    [path.join(harness.uploadDir, 'user-7-1.png')],
  );
});
