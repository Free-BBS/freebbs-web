// Mechanical delivery conversion only: preserve the generated composition and alpha.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const sharp = require('sharp');

async function main() {
  const input = process.argv[2];
  assert.ok(input, 'Pass a JSON manifest of [{key, source}] from imagegen.');
  const entries = JSON.parse(fs.readFileSync(input, 'utf8'));
  const catalog = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../public/data/shop-items.json')),
  );
  const allowed = new Set(
    catalog.items.filter((item) => item.enabled !== false).map((item) => item.key),
  );
  const output = path.join(__dirname, '../public/assets/shop/max-cartoon-v1');
  fs.mkdirSync(output, { recursive: true });
  for (const { key, source } of entries) {
    assert.ok(allowed.has(key), `Unknown enabled item: ${key}`);
    const file = path.join(output, `${key}.webp`);
    if (fs.existsSync(file) && process.argv[3] !== '--overwrite') {
      console.log(`${key}: retained existing versioned output`);
      continue;
    }
    const metadata = await sharp(source).metadata();
    assert.ok(metadata.hasAlpha, `${key}: source must have transparent alpha`);
    await sharp(source)
      .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: 86, alphaQuality: 100, effort: 6 })
      .toFile(file);
    console.log(`${key}: ${fs.statSync(file).size} bytes`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
