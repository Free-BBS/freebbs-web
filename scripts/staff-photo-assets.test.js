const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const sharp = require('sharp');
const roster = require('../public/data/staff.json');
const { BUDGETS, MAX_THUMBNAIL_BYTES, createVariant } = require('./optimize-staff-photos');

const root = path.resolve(__dirname, '..');

test('every list photo is a small proportional WebP and every full original remains available', async () => {
  let thumbnailBytes = 0;
  assert.equal(new Set(roster.members.map((member) => member.photoThumbnail)).size, 34);
  for (const member of roster.members) {
    assert.match(member.photo, /^\/assets\/staff\/[a-z0-9_-]+\.(?:png|jpe?g|webp)$/);
    assert.doesNotMatch(member.photo, /-(?:thumb|preview)\.webp$/);
    assert.equal(
      member.photoThumbnail,
      member.photo.replace(/\.(?:png|jpe?g|webp)$/, '-thumb.webp'),
    );
    const original = await sharp(path.join(root, 'public', member.photo)).metadata();
    const rotated = [5, 6, 7, 8].includes(original.orientation);
    const originalWidth = rotated ? original.height : original.width;
    const originalHeight = rotated ? original.width : original.height;
    const file = path.join(root, 'public', member.photoThumbnail);
    const bytes = (await fs.stat(file)).size;
    const thumbnail = await sharp(file).metadata();
    assert.equal(thumbnail.format, 'webp');
    assert.ok(bytes > 0 && bytes <= MAX_THUMBNAIL_BYTES, `${member.name}: 800 KB limit`);
    assert.ok(bytes <= BUDGETS.thumbnail.bytes, `${member.name}: thumbnail budget`);
    assert.ok(thumbnail.width <= BUDGETS.thumbnail.width);
    assert.ok(thumbnail.height <= BUDGETS.thumbnail.height);
    assert.ok(thumbnail.width <= originalWidth && thumbnail.height <= originalHeight);
    assert.ok(
      Math.abs(thumbnail.width * originalHeight - thumbnail.height * originalWidth) <=
        originalWidth + originalHeight,
      `${member.name}: thumbnail must not crop or distort the original`,
    );
    thumbnailBytes += bytes;
  }
  assert.ok(thumbnailBytes <= 256 * 1024, 'all 34 list thumbnails stay below 256 KiB');
});

test('default product leaders have a combined thumbnail payload below 80 KiB', async () => {
  const product = roster.members.filter((member) => member.generalResponsibilities?.length);
  assert.equal(product.length, 9);
  const sizes = await Promise.all(
    product.map(
      async (member) => (await fs.stat(path.join(root, 'public', member.photoThumbnail))).size,
    ),
  );
  assert.ok(sizes.reduce((sum, size) => sum + size, 0) <= 80 * 1024);
});

test('conversion preserves original bytes and orientation without enlarging or overwriting a source', async () => {
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'staff-photo-conversion-'));
  const source = path.join(output, 'original.jpg');
  const target = path.join(output, 'original-thumb.webp');
  const original = await sharp({
    create: { width: 300, height: 600, channels: 3, background: '#3b7e97' },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  await fs.writeFile(source, original);
  const info = await createVariant(source, target);
  assert.deepEqual(await fs.readFile(source), original);
  assert.ok(info.width > info.height, 'rotation must respect EXIF orientation');
  assert.ok(info.bytes <= BUDGETS.thumbnail.bytes);
  await assert.rejects(createVariant(source, source), /Original photos stay unchanged/);
  assert.deepEqual(await fs.readFile(source), original);
});
