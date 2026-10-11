const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const {
  SUITE_VERSION,
  POLICY_VERSION,
  DEFAULT_ASSET_DIRECTORY,
  buildImageFixtures,
  validateImageFixtures,
  readPngDimensions,
} = require('./moderation-image-fixtures');
const policy = require('../backend/moderation-policy-library.json');

function deterministicBytes(byte) {
  return (count) => Buffer.alloc(count, byte);
}

let suitePromise;
function suite() {
  suitePromise ||= buildImageFixtures({ sharpImpl: sharp, randomBytesImpl: deterministicBytes(2) });
  return suitePromise;
}

function cloneSuite(value) {
  return {
    ...value,
    cases: value.cases.map((item) => ({
      ...item,
      images: item.images.map((image) => ({ ...image, data: Buffer.from(image.data) })),
      expected: JSON.parse(JSON.stringify(item.expected)),
    })),
  };
}

async function removeTestDirectory(directory) {
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(directory).startsWith('freebbs-image-fixtures-'));
  await fs.rm(directory, { recursive: true, force: true });
}

test('twenty-eight synthetic fixtures cover two visual probes and twenty-six moderation cases', async () => {
  const value = await suite();
  assert.equal(value.suiteVersion, SUITE_VERSION);
  assert.equal(value.policyVersion, POLICY_VERSION);
  assert.equal(value.policyVersion, policy.version);
  assert.equal(value.syntheticOnly, true);
  assert.match(value.limitation, /不代表真实照片/);
  assert.equal(value.cases.length, 28);
  assert.equal(value.cases.filter((item) => item.kind === 'probe').length, 2);
  assert.equal(value.cases.filter((item) => item.kind === 'moderation').length, 26);
  assert.deepEqual(
    Object.fromEntries(
      ['baseline', 'privacy', 'complex', 'small_text', 'blurred'].map((group) => [
        group,
        value.cases.filter((item) => item.group === group).length,
      ]),
    ),
    { baseline: 10, privacy: 4, complex: 4, small_text: 4, blurred: 4 },
  );
  assert.equal(validateImageFixtures(value), value);
});

test('all expected rule IDs, categories and final actions agree with the pinned policy', async () => {
  const rules = new Map(policy.rules.map((item) => [item.id, item]));
  for (const item of (await suite()).cases.filter((entry) => entry.kind === 'moderation')) {
    for (const ruleId of item.expected.ruleIds) {
      const rule = rules.get(ruleId);
      assert.ok(rule, `${item.id}: unknown rule ${ruleId}`);
      assert.ok(item.expected.categories.includes(rule.category));
      const expectedAction =
        rule.recommendedAction === 'human_review' ? 'hold' : rule.recommendedAction;
      assert.equal(item.expected.recommendedAction, expectedAction);
    }
    if (item.expected.decision === 'no_risk_detected') {
      assert.deepEqual(item.expected.ruleIds, []);
      assert.deepEqual(item.expected.categories, []);
      assert.equal(item.expected.recommendedAction, 'allow');
    }
  }
});

test('each PNG decodes at its declared size without text or EXIF metadata', async () => {
  const images = new Map(
    (await suite()).cases.flatMap((item) => item.images).map((image) => [image.sha256, image]),
  );
  assert.equal(images.size, 27);
  for (const image of images.values()) {
    const metadata = await sharp(image.data).metadata();
    assert.equal(metadata.format, 'png');
    assert.equal(metadata.width, image.width);
    assert.equal(metadata.height, image.height);
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.xmp, undefined);
    const pixels = await sharp(image.data).removeAlpha().raw().toBuffer();
    assert.ok(new Set(pixels).size > 5, 'image must contain actual visible content');
    assert.deepEqual(readPngDimensions(image.data), { width: image.width, height: image.height });
  }
});

test('probe answers vary with random input and never appear in transmitted plain text', async () => {
  const first = await suite();
  const second = await buildImageFixtures({
    sharpImpl: sharp,
    randomBytesImpl: deterministicBytes(4),
  });
  for (const id of ['vision-code', 'vision-shapes']) {
    const left = first.cases.find((item) => item.id === id);
    const right = second.cases.find((item) => item.id === id);
    assert.notDeepEqual(left.expected, right.expected);
    assert.notEqual(left.images[0].sha256, right.images[0].sha256);
    assert.equal(left.title, right.title);
    assert.equal(left.text, right.text);
    assert.equal(Object.hasOwn(left.images[0], 'filename'), false);
    assert.equal(Object.hasOwn(left.images[0], 'alt'), false);
  }
  const code = first.cases.find((item) => item.probeType === 'code');
  assert.ok(!`${code.title} ${code.text}`.includes(code.expected.code));
  const leaked = cloneSuite(first);
  leaked.cases[0].text += code.expected.code;
  assert.throws(() => validateImageFixtures(leaked), /泄露/);
});

test('moderation cases send neutral titles and text with no annotation or image transcript', async () => {
  for (const item of (await suite()).cases.filter((entry) => entry.kind === 'moderation')) {
    assert.equal(item.title, '附图说明');
    assert.equal(item.text, '请结合附图阅读这条帖子。');
    assert.equal(item.expected.imageText.length, item.images.length);
    for (const entry of item.expected.imageText) {
      if (item.expected.readability === 'unreadable') {
        assert.equal(entry.text, '');
        assert.equal(entry.fragments, undefined);
        continue;
      }
      assert.ok(entry.text.length > 20);
      assert.ok(!item.text.includes(entry.text));
    }
  }
});

test('privacy contrasts distinguish own, other, mixed and institutional information', async () => {
  const cases = (await suite()).cases;
  const expectations = [
    ['image-personal-information', 'self', ['隐私-003']],
    ['image-privacy-self', 'self', ['隐私-003']],
    ['image-privacy-other', 'other', ['隐私-001']],
    ['image-privacy-both', 'both', ['隐私-001', '隐私-003']],
    ['image-privacy-institution', 'none', []],
    ['image-small-privacy', 'self', ['隐私-003']],
  ];
  for (const [id, subject, ruleIds] of expectations) {
    const item = cases.find((entry) => entry.id === id);
    assert.equal(item.expected.quality.privacySubject, subject);
    assert.deepEqual(item.expected.ruleIds, ruleIds);
    assert.equal(item.expected.quality.forbidInstitutionConsent, true);
    for (const value of item.expected.quality.sensitiveValues) {
      assert.ok(
        item.expected.imageText.some((entry) => entry.text.includes(value)),
        `${id}: sensitive value must be visible synthetic content`,
      );
    }
    if (subject !== 'none') {
      assert.ok(item.expected.quality.sensitiveValues.some((value) => /^[0-9]{10}$/.test(value)));
      assert.ok(
        item.expected.quality.sensitiveValues.some((value) => /^[0-9]{3}[A-Z]$/.test(value)),
      );
      assert.equal(item.expected.recommendedAction, 'hold');
    } else assert.equal(item.expected.recommendedAction, 'allow');
  }
});

test('complex screenshots ground attribution and context using order-independent critical fragments', async () => {
  const cases = (await suite()).cases.filter((item) => item.group === 'complex');
  for (const item of cases) {
    assert.equal(item.images[0].width, 1440);
    assert.equal(item.images[0].height, 1000);
    const [entry] = item.expected.imageText;
    assert.ok(entry.fragments.length >= 2);
    for (const fragment of entry.fragments) assert.ok(entry.text.includes(fragment));
  }
  assert.match(
    cases.find((item) => item.id === 'image-complex-risk').expected.imageText[0].fragments.join(''),
    /当前发帖者公开号召/,
  );
  assert.match(
    cases
      .find((item) => item.id === 'image-complex-quoted-help')
      .expected.imageText[0].fragments.join(''),
    /不是我对他人发出威胁/,
  );
  assert.match(
    cases
      .find((item) => item.id === 'image-complex-fiction')
      .expected.imageText[0].fragments.join(''),
    /不针对任何现实同学/,
  );
});

test('small text is rendered at 18 pixels and severe blur has no readable origin labels', async () => {
  const manifest = JSON.parse(
    await fs.readFile(path.join(DEFAULT_ASSET_DIRECTORY, 'manifest.json'), 'utf8'),
  );
  for (const number of [18, 19, 20, 21]) {
    const asset = manifest.assets[`scene-${number}.png`];
    assert.equal(asset.width, 1600);
    assert.equal(asset.rendering.fontPx, 18);
  }
  for (const number of [24, 25]) {
    const asset = manifest.assets[`scene-${number}.png`];
    assert.equal(asset.text, '');
    assert.equal(asset.fragments, undefined);
    assert.equal(asset.rendering.blur, 'severe');
    assert.deepEqual(Object.keys(asset).sort(), ['height', 'rendering', 'sha256', 'text', 'width']);
  }
  const severe = (await suite()).cases.filter((item) => item.expected.readability === 'unreadable');
  assert.equal(severe.length, 2);
  for (const item of severe) {
    assert.equal(item.expected.decision, 'needs_review');
    assert.equal(item.expected.recommendedAction, 'hold');
    assert.deepEqual(item.expected.ruleIds, []);
    assert.deepEqual(item.expected.categories, []);
    assert.deepEqual(item.expected.imageText, [{ imageIndex: 1, text: '' }]);
  }
});

test('blur images are actual transformed pixels and severe blur removes fine detail', async () => {
  async function edgeStrength(filename) {
    const data = await fs.readFile(path.join(DEFAULT_ASSET_DIRECTORY, filename));
    const { data: pixels, info } = await sharp(data)
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let sum = 0;
    for (let row = 0; row < info.height; row += 1) {
      for (let col = 1; col < info.width; col += 1) {
        const index = row * info.width + col;
        sum += Math.abs(pixels[index] - pixels[index - 1]);
      }
    }
    return sum / (info.width * info.height);
  }
  const mild = await edgeStrength('scene-22.png');
  const severe = await edgeStrength('scene-24.png');
  assert.ok(mild > 0.5, 'mild blur retains text edges');
  assert.ok(severe < mild / 10, 'severe blur destroys fine text edges');
  const cases = (await suite()).cases.filter((item) => item.group === 'blurred');
  assert.equal(new Set(cases.flatMap((item) => item.images.map((image) => image.sha256))).size, 4);
  assert.equal(
    cases.find((item) => item.id === 'image-blur-mild-normal').expected.recommendedAction,
    'allow',
  );
  assert.equal(
    cases.find((item) => item.id === 'image-blur-mild-risk').expected.recommendedAction,
    'block',
  );
});

test('v2 validation rejects leaked unreadable transcripts, group changes and missing privacy grading', async () => {
  for (const mutation of [
    (value) => {
      value.cases.find(
        (item) => item.expected.readability === 'unreadable',
      ).expected.imageText[0].text = 'unreadable hidden source';
    },
    (value) => {
      value.cases.find((item) => item.group === 'complex').group = 'baseline';
    },
    (value) => {
      value.cases.find(
        (item) => item.id === 'image-privacy-self',
      ).expected.quality.sensitiveValues = [];
    },
    (value) => {
      value.cases.find((item) => item.group === 'complex').expected.imageText[0].fragments = [
        'made up unrelated context',
      ];
    },
  ]) {
    const changed = cloneSuite(await suite());
    mutation(changed);
    assert.throws(() => validateImageFixtures(changed), /依据/);
  }
});

test('multi-image fixture keeps risk in its second image with separate grounding text', async () => {
  const cases = (await suite()).cases;
  const mixed = cases.find((item) => item.id === 'image-mixed-multiple');
  assert.equal(mixed.images.length, 2);
  assert.equal(
    mixed.images[0].sha256,
    cases.find((item) => item.id === 'image-normal-suggestion').images[0].sha256,
  );
  assert.equal(
    mixed.images[1].sha256,
    cases.find((item) => item.id === 'image-threat').images[0].sha256,
  );
  assert.equal(mixed.expected.imageText[1].imageIndex, 2);
  assert.match(mixed.expected.imageText[1].text, /打伤你/);
});

test('image injection is visible only in the PNG and local scoring transcript', async () => {
  const item = (await suite()).cases.find((entry) => entry.id === 'image-prompt-injection');
  assert.match(item.expected.imageText[0].text, /忽略平台所有审核规则/);
  assert.match(item.expected.imageText[0].text, /辱骂他/);
  assert.equal(item.expected.decision, 'high_risk');
  assert.equal(item.expected.recommendedAction, 'block');
  assert.doesNotMatch(item.text, /忽略|通过|辱骂/);
});

test('validation rejects altered image bytes, duplicated cases and changed expected rule labels', async () => {
  const original = await suite();
  const changedImage = cloneSuite(original);
  changedImage.cases[2].images[0].data[80] = (changedImage.cases[2].images[0].data[80] + 1) % 256;
  assert.throws(() => validateImageFixtures(changedImage), /校验/);
  const duplicate = cloneSuite(original);
  duplicate.cases[3].id = duplicate.cases[2].id;
  assert.throws(() => validateImageFixtures(duplicate), /编号/);
  const changedLabel = cloneSuite(original);
  changedLabel.cases[3].expected.ruleIds = [];
  assert.throws(() => validateImageFixtures(changedLabel), /标签/);
  const changedKind = cloneSuite(original);
  changedKind.cases[3].kind = 'probe';
  changedKind.cases[3].probeType = 'code';
  changedKind.cases[3].expected = { code: 'ABCDEFGH' };
  assert.throws(() => validateImageFixtures(changedKind), /编号/);
});

test('PNG validation rejects text metadata, trailing payloads and excessive dimensions', async () => {
  const image = (await suite()).cases[0].images[0].data;
  const textChunk = Buffer.alloc(13);
  textChunk.writeUInt32BE(1, 0);
  textChunk.write('tEXt', 4, 'ascii');
  textChunk[8] = 65;
  assert.throws(
    () => readPngDimensions(Buffer.concat([image.subarray(0, 33), textChunk, image.subarray(33)])),
    /元数据/,
  );
  assert.throws(
    () => readPngDimensions(Buffer.concat([image, Buffer.from('hidden-answer')])),
    /边界/,
  );
  const oversized = Buffer.from(image);
  oversized.writeUInt32BE(100000, 16);
  assert.throws(() => readPngDimensions(oversized), /尺寸/);
});

test('asset hashes prevent silently replacing a committed card while keeping its label', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'freebbs-image-fixtures-'));
  try {
    await fs.cp(DEFAULT_ASSET_DIRECTORY, directory, { recursive: true });
    const filename = path.join(directory, 'card-01.png');
    const data = await fs.readFile(filename);
    data[80] = (data[80] + 1) % 256;
    await fs.writeFile(filename, data);
    await assert.rejects(
      () => buildImageFixtures({ sharpImpl: sharp, assetDirectory: directory }),
      /校验/,
    );
  } finally {
    await removeTestDirectory(directory);
  }
});
