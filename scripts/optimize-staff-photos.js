// Mechanical delivery conversion, adapted from the existing staff-photo pipeline.
// Originals remain the full-size viewer source; only list thumbnails are generated.
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const ASSETS = path.join(ROOT, 'public/assets/staff');
const ROSTER = path.join(ROOT, 'public/data/staff.json');
const MAX_THUMBNAIL_BYTES = 800 * 1000;
const BUDGETS = {
  thumbnail: { width: 176, height: 232, bytes: 24 * 1024 },
};

async function createVariant(source, target, budget = BUDGETS.thumbnail) {
  if (path.resolve(source) === path.resolve(target))
    throw new Error('Original photos stay unchanged');
  for (const scale of [1, 0.85, 0.7]) {
    for (const quality of [82, 74, 66, 58]) {
      const { data, info } = await sharp(source)
        .rotate()
        .resize({
          width: Math.floor(budget.width * scale),
          height: Math.floor(budget.height * scale),
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality, effort: 5 })
        .toBuffer({ resolveWithObject: true });
      if (data.length <= Math.min(budget.bytes, MAX_THUMBNAIL_BYTES)) {
        await fs.writeFile(target, data);
        return { width: info.width, height: info.height, bytes: data.length };
      }
    }
  }
  throw new Error(`Photo exceeds its byte budget: ${path.basename(source)}`);
}

async function optimizeStaffPhotos({ assets = ASSETS, rosterFile = ROSTER } = {}) {
  const roster = JSON.parse(await fs.readFile(rosterFile, 'utf8'));
  const entries = roster.members.map((member) => {
    const match = /^\/assets\/staff\/([a-z0-9_-]+)\.(?:png|jpe?g|webp)$/i.exec(member.photo || '');
    if (!match || /-(?:thumb|preview)$/i.test(match[1]))
      throw new Error(`Invalid original staff photo: ${member.name}`);
    const original = path.basename(member.photo);
    const thumbnail = `${match[1]}-thumb.webp`;
    return { member, source: path.join(assets, original), thumbnail };
  });
  const report = [];
  for (const { member, source, thumbnail } of entries) {
    const thumbInfo = await createVariant(source, path.join(assets, thumbnail));
    member.photoThumbnail = `/assets/staff/${thumbnail}`;
    report.push({ name: member.name, originalBytes: (await fs.stat(source)).size, thumbInfo });
  }
  // This is a bulk manifest update: preserve photo and all member content.
  await fs.writeFile(rosterFile, `${JSON.stringify(roster, null, 2)}\n`);
  return report;
}

if (require.main === module) {
  optimizeStaffPhotos()
    .then((report) => {
      console.log(
        JSON.stringify(
          {
            count: report.length,
            originalBytes: report.reduce((sum, item) => sum + item.originalBytes, 0),
            thumbnailBytes: report.reduce((sum, item) => sum + item.thumbInfo.bytes, 0),
            largestThumbnail: Math.max(...report.map((item) => item.thumbInfo.bytes)),
          },
          null,
          2,
        ),
      );
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

module.exports = { BUDGETS, MAX_THUMBNAIL_BYTES, createVariant, optimizeStaffPhotos };
