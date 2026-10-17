const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');
const { Script } = require('node:vm');
const { load } = require('cheerio');
const sharp = require('sharp');

const site = resolve(
  __dirname,
  '../development/apps/web/public/organization-showcase/sites/creative',
);
const source = readFileSync(resolve(site, 'gallery-layout.js'), 'utf8');
const sandbox = { module: { exports: undefined } };
new Script(source).runInNewContext(sandbox);
const arrange = sandbox.module.exports;

test('every creative memory and artwork remains available as a complete local image', async () => {
  const images = new Set();
  for (const file of readdirSync(site).filter((name) => name.endsWith('.html'))) {
    const $ = load(readFileSync(resolve(site, file), 'utf8'));
    $('img').each((_, image) => images.add($(image).attr('src')));
    if (file === 'about.html') assert.equal($('.photo-collage .scattered-photo').length, 8);
  }
  for (const image of images) {
    const path = resolve(site, decodeURIComponent(image));
    assert.ok(existsSync(path), image);
    const { width, height } = await sharp(path).metadata();
    assert.ok(width > 0 && height > 0, image);
  }
});

test('submitted scattered artwork keeps its proportions and fits phone and desktop galleries', async () => {
  for (const file of readdirSync(site).filter((name) => name.endsWith('.html'))) {
    const $ = load(readFileSync(resolve(site, file), 'utf8'));
    for (const gallery of $('.year-gallery,.free-gallery').toArray()) {
      const ratios = [];
      for (const image of $(gallery).find('img').toArray()) {
        const path = resolve(site, decodeURIComponent($(image).attr('src')));
        const { width, height } = await sharp(path).metadata();
        ratios.push(width / height);
      }
      for (const width of [278, 350, 520, 768, 1200]) {
        const result = arrange(ratios, width, $(gallery).hasClass('free-gallery'));
        assert.equal(result.items.length, ratios.length);
        assert.ok(Number.isFinite(result.height) && result.height > 0);
        assert.ok(result.items.some((item) => item.angle !== 0));
        for (const [index, item] of result.items.entries()) {
          assert.ok(Object.values(item).every(Number.isFinite));
          assert.ok(item.width > 0 && item.height > 0);
          assert.ok(Math.abs(item.width / item.height - ratios[index]) < 1e-7);
          const radians = (Math.abs(item.angle) * Math.PI) / 180;
          const boundWidth = item.width * Math.cos(radians) + item.height * Math.sin(radians);
          const boundHeight = item.height * Math.cos(radians) + item.width * Math.sin(radians);
          const left = item.x + (item.width - boundWidth) / 2;
          const top = item.y + (item.height - boundHeight) / 2;
          assert.ok(left >= -1e-7 && left + boundWidth <= width + 1e-7);
          assert.ok(top >= -1e-7 && top + boundHeight <= result.height + 1e-7);
        }
      }
    }
  }
});
