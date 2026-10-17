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

test('current learning tour introduces real route and direct-find controls before a real overview link', () => {
  const directory = STEPS.find((entry) => entry.id === 'course-directory');
  const find = STEPS.find((entry) => entry.id === 'course-relations');
  const enter = STEPS.find((entry) => entry.id === 'course-enter-knowledge');
  assert.equal(directory.target, '.course-learning-route');
  assert.equal(find.target, '.course-direct-find');
  assert.equal(
    directory.action,
    undefined,
    'Learning route is introduced without activating a point',
  );
  assert.equal(
    find.action,
    undefined,
    'Direct find is introduced without typing or choosing for the learner',
  );
  assert.match(directory.body, /分支/);
  assert.match(directory.body, /自由选择/);
  assert.match(find.body, /名称、编号、别名/);
  assert.match(find.body, /回到上次位置/);
  assert.equal(enter.prepare.length, 1, 'Do not detour through the old relations view');
  assert.match(enter.prepare[0].selector, /data-course-route-node-id/);
  assert.match(enter.prepare[0].selector, /data-course-point-id/);
  assert.equal(enter.action.kind, 'link');
  assert.equal(enter.action.selector, '#course-knowledge-overview[open] .knowledge-overview-study');
  const reading = STEPS.find((entry) => entry.id === 'knowledge-reading');
  assert.match(reading.body, /知识起源/);
  assert.match(reading.body, /学习资源/);
  assert.match(reading.body, /练习、自测与订正/);
  assert.match(reading.body, /参与共建/);
  assert.doesNotMatch(reading.body, /只预留|还在开发/);
  assert.match(LEGACY_V4_STEPS.find((entry) => entry.id === 'course-relations').body, /直接联系/);
  for (const entry of [directory, find, enter, reading])
    assert.doesNotMatch(
      `${entry.body} ${entry.caption}`,
      /[\u4e00-\u9fff][A-Za-z]|[A-Za-z][\u4e00-\u9fff]/,
    );
});
