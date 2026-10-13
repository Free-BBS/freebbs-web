const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const sharp = require('sharp');
const roster = require('../public/data/staff.json');
const { BUDGETS } = require('./optimize-staff-photos');

const root = path.resolve(__dirname, '..');
const assetDirectory = path.join(root, 'public/assets/staff');

test('all staff photos have actual bounded WebP thumbnails and previews, with unchanged originals retained', async () => {
  const assetNames = await fs.readdir(assetDirectory);
  let thumbnailBytes = 0;
  let previewBytes = 0;
  const originalPaths = new Set();
  assert.equal(new Set(roster.members.map((member) => member.photoThumbnail)).size, 34);
  for (const member of roster.members) {
    assert.match(member.photo, /^\/assets\/staff\/[a-z0-9_-]+-preview\.webp$/);
    assert.match(member.photoThumbnail, /^\/assets\/staff\/[a-z0-9_-]+-thumb\.webp$/);
    const stem = path.basename(member.photo).replace(/-preview\.webp$/, '');
    assert.equal(path.basename(member.photoThumbnail), `${stem}-thumb.webp`);
    const originalName = assetNames.find(
      (name) => path.parse(name).name === stem && /\.(?:png|jpe?g|webp)$/i.test(name),
    );
    assert.ok(originalName, `${member.name} retains their original file`);
    originalPaths.add(originalName);
    const original = await sharp(path.join(assetDirectory, originalName)).metadata();
    const rotated = [5, 6, 7, 8].includes(original.orientation);
    const originalWidth = rotated ? original.height : original.width;
    const originalHeight = rotated ? original.width : original.height;
    for (const [url, budget] of [
      [member.photoThumbnail, BUDGETS.thumbnail],
      [member.photo, BUDGETS.preview],
    ]) {
      const file = path.join(root, 'public', url);
      const bytes = (await fs.stat(file)).size;
      const actual = await sharp(file).metadata();
      assert.equal(actual.format, 'webp', url);
      assert.ok(bytes > 0 && bytes <= budget.bytes, `${url} exceeds its byte budget`);
      assert.ok(actual.width <= budget.width && actual.height <= budget.height, url);
      assert.ok(
        actual.width <= originalWidth && actual.height <= originalHeight,
        `${url} enlarged`,
      );
      const proportionalError = Math.abs(
        actual.width * originalHeight - actual.height * originalWidth,
      );
      assert.ok(proportionalError <= originalWidth + originalHeight, `${url} changed aspect ratio`);
      if (url === member.photoThumbnail) thumbnailBytes += bytes;
      else previewBytes += bytes;
    }
  }
  assert.equal(originalPaths.size, 34);
  assert.ok(thumbnailBytes <= 256 * 1024, 'all directory thumbnails stay below 256 KiB');
  assert.ok(previewBytes <= 4 * 1024 * 1024, 'all larger photos stay below 4 MiB');
});

test('default product column requests only small thumbnail files within an 80 KiB photo budget', async () => {
  const product = roster.members.filter((member) => member.generalResponsibilities?.length);
  assert.equal(product.length, 9);
  const sizes = await Promise.all(
    product.map(
      async (member) => (await fs.stat(path.join(root, 'public', member.photoThumbnail))).size,
    ),
  );
  assert.ok(sizes.reduce((sum, size) => sum + size, 0) <= 80 * 1024);
});
