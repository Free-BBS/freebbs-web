const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const ASSETS = path.join(ROOT, 'public/assets/staff');
const ROSTER = path.join(ROOT, 'public/data/staff.json');
const BUDGETS = {
  thumbnail: { width: 176, height: 232, bytes: 24 * 1024 },
  preview: { width: 1200, height: 1200, bytes: 220 * 1024 },
};

async function createVariant(source, target, budget) {
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
      if (data.length <= budget.bytes) {
        await fs.writeFile(target, data);
        return { width: info.width, height: info.height, bytes: data.length };
      }
    }
  }
  throw new Error(`Photo exceeds its byte budget: ${path.basename(source)}`);
}

async function optimizeStaffPhotos() {
  const roster = JSON.parse(await fs.readFile(ROSTER, 'utf8'));
  const originals = (await fs.readdir(ASSETS)).filter(
    (name) => /\.(?:png|jpe?g|webp)$/i.test(name) && !/-(?:thumb|preview)\.webp$/i.test(name),
  );
  const report = [];
  for (const member of roster.members) {
    const match = /^\/assets\/staff\/([a-z0-9_-]+)\.(?:png|jpe?g|webp)$/i.exec(member.photo);
    if (!match) throw new Error(`Invalid local staff photo: ${member.name}`);
    const stem = match[1].replace(/-preview$/, '');
    const original = originals.find((name) => path.parse(name).name === stem);
    if (!original) throw new Error(`Original photo missing: ${member.name}`);
    const source = path.join(ASSETS, original);
    const thumbnail = `${stem}-thumb.webp`;
    const preview = `${stem}-preview.webp`;
    const thumbInfo = await createVariant(source, path.join(ASSETS, thumbnail), BUDGETS.thumbnail);
    const previewInfo = await createVariant(source, path.join(ASSETS, preview), BUDGETS.preview);
    member.photo = `/assets/staff/${preview}`;
    member.photoThumbnail = `/assets/staff/${thumbnail}`;
    report.push({
      name: member.name,
      originalBytes: (await fs.stat(source)).size,
      thumbInfo,
      previewInfo,
    });
  }
  await fs.writeFile(ROSTER, `${JSON.stringify(roster, null, 2)}\n`);
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
            previewBytes: report.reduce((sum, item) => sum + item.previewInfo.bytes, 0),
            largestThumbnail: Math.max(...report.map((item) => item.thumbInfo.bytes)),
            largestPreview: Math.max(...report.map((item) => item.previewInfo.bytes)),
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

module.exports = { BUDGETS, createVariant, optimizeStaffPhotos };
