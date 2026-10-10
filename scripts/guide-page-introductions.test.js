const test = require('node:test');
const assert = require('node:assert/strict');
const { STEPS, STATIONS, LEGACY_V4_STEPS } = require('../public/max-guide-stations');
const { VERSION, stepsFor, tourUrl } = require('../public/max-guide');
const { GUIDE_VERSION, LEGACY_GUIDE_VERSIONS, RELEASES } = require('../public/max-guide-releases');
const {
  resolveGuideVersion,
  emptyProgress,
  mergeProgress,
  validatePatch,
} = require('../backend/onboarding');

const pageStations = [
  ['discussion', '/discussion'],
  ['workbench', '/workbench'],
  ['laboratory', '/laboratory'],
  ['creative', '/creative-workshop'],
  ['pbl', '/pbl'],
  ['max', '/aichat'],
  ['development', '/development'],
  ['shop', '/electromagnetic'],
];

test('the new tour retains seven learning steps and gives each requested page one concise frame', () => {
  assert.equal(STEPS.length, 17);
  assert.equal(STATIONS.length, 11);
  assert.equal(STEPS.filter((entry) => entry.station === 'world').length, 7);
  assert.deepEqual(
    STEPS.filter((entry) => entry.station === 'world').map((entry) => entry.id),
    LEGACY_V4_STEPS.filter((entry) => entry.station === 'world').map((entry) => entry.id),
  );
  for (const [station, route] of pageStations) {
    const entries = STEPS.filter((entry) => entry.station === station);
    assert.equal(entries.length, 1, station);
    const [entry] = entries;
    assert.equal(entry.route, route);
    assert.ok(entry.body.length < 130 && entry.caption.length < 100, station);
    assert.equal(entry.action, undefined, 'business actions stay user-initiated');
    assert.equal(entry.prepare, undefined, 'do not change views just to introduce a page');
    assert.equal(entry.reveal, undefined, 'one frame must not conceal another required frame');
    assert.doesNotMatch(
      `${entry.body} ${entry.caption}`,
      /[\u4e00-\u9fff][A-Za-z]|[A-Za-z][\u4e00-\u9fff]/,
    );
  }
  for (const station of ['creative', 'pbl', 'development']) {
    const step = STEPS.find((entry) => entry.station === station);
    assert.match(`${step.body} ${step.caption}`, /建设|尚未开放/);
  }
});

test('v4 positions are isolated from the rebuilt v5 tour and remain available for an old tab', () => {
  assert.equal(VERSION, GUIDE_VERSION);
  assert.equal(VERSION, 'max-v5');
  assert.ok(LEGACY_GUIDE_VERSIONS.includes('max-v4'));
  assert.equal(resolveGuideVersion('max-v4'), 'max-v4');
  assert.equal(stepsFor('max-v4'), LEGACY_V4_STEPS);
  assert.equal(LEGACY_V4_STEPS.length, 16);
  assert.deepEqual(
    LEGACY_V4_STEPS.slice(8, 15).map((entry) => entry.id),
    [
      'discussion-filters',
      'discussion-open-post',
      'discussion-detail',
      'discussion-composer',
      'workbench-week',
      'workbench-ai-plan',
      'workbench-priorities',
    ],
  );
  assert.match(
    LEGACY_V4_STEPS.find((entry) => entry.id === 'knowledge-reading').body,
    /前后知识点入口/,
  );
  assert.match(STEPS.find((entry) => entry.id === 'knowledge-reading').body, /批注仅自己可见/);
  const url = new URL(tourUrl(12, 'max-v4'), 'https://free-bbs.test');
  assert.equal(url.pathname, '/workbench');
  assert.equal(url.searchParams.get('guideVersion'), 'max-v4');
  assert.throws(
    () => mergeProgress(emptyProgress(), { version: 'max-v4', status: 'completed' }),
    /版本/,
  );
});

test('published update tours keep their original order and the new eight-page replay is independent', () => {
  assert.deepEqual(RELEASES.find((entry) => entry.id === 'guide-essentials-2026-10').stepIds, [
    'world-atlas',
    'discussion-filters',
    'workbench-week',
    'handbook-other-features',
  ]);
  const release = RELEASES.find((entry) => entry.id === 'guide-pages-2026-10-08');
  assert.equal(release.stepIds.length, 8);
  assert.deepEqual(
    stepsFor(release.id).map((entry) => entry.station),
    pageStations.map(([id]) => id),
  );
  assert.throws(
    () => validatePatch({ version: release.id, completedTasks: ['meet_max'] }),
    /分别保存/,
  );
});
