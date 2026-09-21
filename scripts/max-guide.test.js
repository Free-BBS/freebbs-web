const test = require('node:test');
const assert = require('node:assert/strict');
const {
  VERSION,
  FLOATING_PATHS,
  hasBlockingModal,
  initialGuideDecision,
  TASKS,
  STEPS,
  emptyProgress,
  normalizeProgress,
  mergeGuest,
  taskForPath,
  tourUrl,
  safeGuideHref,
  tourGeometry,
  stepsFor,
  createProgressClient,
  createRewardClient,
  createController,
} = require('../public/max-guide');
const { GUIDE_VERSION, TASK_IDS, mergeProgress } = require('../backend/onboarding');
const { RELEASES, LATEST_RELEASE, LEGACY_GUIDE_VERSIONS } = require('../public/max-guide-releases');
const { STATIONS, RELEASE_STEP_IDS } = require('../public/max-guide-stations');

const fixed = Date.parse('2026-09-20T10:00:00Z');
const serverReply = (patch = {}) => ({ ...emptyProgress(), ...patch });
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

test('reward requests coalesce duplicate claims and reject stale responses after token changes', async () => {
  let owner = { key: 'member', token: 'first-token' };
  const pending = deferred();
  const calls = [];
  const reward = createRewardClient({
    identity: () => owner,
    request(method, account) {
      calls.push({ method, account });
      return pending.promise;
    },
  });
  const first = reward.claim();
  const same = reward.claim();
  assert.equal(first, same);
  const rejected = assert.rejects(first, { name: 'AbortError' });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls.length, 1);
  owner = { key: 'member', token: 'second-token' };
  pending.resolve({ eligible: true, claimed: true, awarded: true });
  await rejected;
  assert.equal(reward.snapshot(), null);
  assert.equal(calls[0].account.token, 'first-token');
});

test('reward clients keep GET read-only, reject incomplete grant confirmations and never call as guests', async () => {
  let owner = { key: 'member', token: 'token' };
  let response = { eligible: true, claimed: false, claimedAt: null };
  const calls = [];
  const reward = createRewardClient({
    identity: () => owner,
    async request(method) {
      calls.push(method);
      return response;
    },
  });
  await reward.load();
  assert.deepEqual(calls, ['GET']);
  await assert.rejects(reward.claim(), /奖励状态暂未确认/);
  assert.equal(reward.snapshot().claimed, false);
  response = { eligible: true, claimed: true, awarded: false };
  await reward.claim();
  assert.equal(reward.snapshot().claimed, true);
  owner = { key: 'guest', token: '' };
  assert.equal(reward.snapshot(), null);
  await assert.rejects(reward.claim(), { name: 'AbortError' });
  assert.deepEqual(calls, ['GET', 'POST', 'POST']);
});

test('guide paths are fixed same-origin routes and exploration tasks match the account API', () => {
  assert.equal(VERSION, GUIDE_VERSION);
  assert.deepEqual(
    TASKS.map((task) => task.id),
    [...TASK_IDS],
  );
  for (const task of TASKS) assert.equal(taskForPath(task.route), task.id);
  for (const path of [
    '/login',
    '/api/checkin',
    'https://evil.test/world',
    '//evil.test',
    '/world/../admin',
  ])
    assert.equal(taskForPath(path), null);
  for (let index = 0; index < STEPS.length; index += 1) {
    const url = new URL(tourUrl(index), 'https://www.free-bbs.cn');
    assert.equal(url.origin, 'https://www.free-bbs.cn');
    assert.equal(url.pathname, STEPS[index].route);
    assert.equal(url.search, '?guideTour=1');
  }
  for (const index of [-1, STEPS.length, '1', NaN, 2.5, '//evil.test'])
    assert.throws(() => tourUrl(index));
});

test('unknown versions and statuses fail closed; task IDs are a strict array whitelist', () => {
  assert.throws(() => normalizeProgress({ ...emptyProgress(), version: 'v2' }));
  assert.throws(() => normalizeProgress({ ...emptyProgress(), status: '__proto__' }));
  assert.deepEqual(
    normalizeProgress(serverReply({ completedTasks: 'explore_world' })).completedTasks,
    [],
  );
  assert.deepEqual(
    normalizeProgress(serverReply({ completedTasks: ['meet_max', 'claim_reward', 'meet_max'] }))
      .completedTasks,
    ['meet_max'],
  );
  assert.equal(normalizeProgress(serverReply({ step: 10000 })).step, STEPS.length - 1);
  assert.equal(normalizeProgress(serverReply({ step: '3' })).step, 0);
  assert.equal(normalizeProgress(serverReply({ seenAt: {} })).seenAt, null);
});

test('guest progression follows the server rules without claiming rewards or learning completion', () => {
  let guest = emptyProgress();
  let server = emptyProgress();
  for (const patch of [
    {},
    { status: 'in_progress', step: 2 },
    { completedTasks: ['explore_world'] },
    { status: 'skipped' },
    { status: 'in_progress' },
    { status: 'completed', step: 9 },
    { status: 'in_progress', step: 0 },
    { completedTasks: ['meet_max'] },
    { restart: true, status: 'in_progress', step: 0 },
  ]) {
    guest = mergeGuest(guest, patch, fixed);
    server = mergeProgress(server, patch, fixed);
    assert.deepEqual(guest, server);
  }
  assert.equal(guest.status, 'in_progress');
  assert.equal(guest.completedTasks.length, 2);
  assert.equal(guest.reward, undefined);
  assert.equal(guest.seenAt, new Date(fixed).toISOString());
  assert.equal(guest.completedAt, new Date(fixed).toISOString());
});

function assertGeometry(geometry, viewport) {
  const { card, hole, curtains } = geometry;
  for (const box of [card, hole, ...curtains].filter(Boolean)) {
    assert.ok(box.x >= 0 && box.y >= 0, JSON.stringify(box));
    assert.ok(box.width >= 0 && box.height >= 0, JSON.stringify(box));
    assert.ok(box.x + box.width <= viewport.width + 0.001, JSON.stringify(box));
    assert.ok(box.y + box.height <= viewport.height + 0.001, JSON.stringify(box));
  }
  const covered =
    curtains.reduce((sum, box) => sum + box.width * box.height, 0) +
    (hole ? hole.width * hole.height : 0);
  assert.ok(Math.abs(covered - viewport.width * viewport.height) < 0.1);
  if (hole) {
    const overlapWidth = Math.max(
      0,
      Math.min(card.x + card.width, hole.x + hole.width) - Math.max(card.x, hole.x),
    );
    const overlapHeight = Math.max(
      0,
      Math.min(card.y + card.height, hole.y + hole.height) - Math.max(card.y, hole.y),
    );
    const overlaps = overlapWidth * overlapHeight > 0;
    assert.equal(geometry.overlap, overlaps, 'the geometry must report any occlusion honestly');
    if (geometry.layout !== 'overview')
      assert.equal(overlaps, false, 'side and compact docking cannot cover the feature');
    if (overlaps) assert.equal(geometry.layout, 'overview');
  }
}

test('spotlight curtains cover everything except the target while the card remains on screen', () => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
    { width: 320, height: 480 },
    { width: 812, height: 375 },
  ]) {
    for (const rect of [
      null,
      { left: 20, right: 300, top: 80, bottom: 300, width: 280, height: 220 },
      { left: -30, right: 1600, top: 70, bottom: 1100, width: 1630, height: 1030 },
      { left: 250, right: 600, top: 450, bottom: 800, width: 350, height: 350 },
      { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 },
      { left: 30, right: 100, top: -300, bottom: -200, width: 70, height: 100 },
    ]) {
      assertGeometry(tourGeometry(rect, viewport, { width: 470, height: 430 }), viewport);
    }
  }
});

test('narrow Max composer stays illuminated with the explanation placed above it', () => {
  const rect = {
    left: 14.666,
    top: 459.667,
    right: 800.667,
    bottom: 634.04,
    width: 786,
    height: 174,
  };
  for (const width of [800, 815]) {
    const viewport = { width, height: 736 };
    const geometry = tourGeometry(rect, viewport, { width: 470, height: 399.34375 });
    assertGeometry(geometry, viewport);
    assert.ok(
      geometry.hole,
      'space above the composer must not fall back to a fully dark viewport',
    );
    assert.ok(geometry.card.x >= 16 && geometry.card.x + geometry.card.width <= width - 16);
    assert.equal(geometry.placement, 'top');
    assert.equal(geometry.layout, 'side');
    assert.ok(Math.abs(geometry.card.y - 34.32325) < 0.001);
    assert.ok(geometry.card.y + geometry.card.height <= geometry.hole.y - 18 + 0.001);
    assert.equal(geometry.hole.y + geometry.hole.height, rect.bottom + 8);
  }
});

test('edge placements stay on screen without moving into or cropping the target', () => {
  const viewport = { width: 1440, height: 900 };
  for (const rect of [
    { left: 40, right: 240, top: 8, bottom: 890, width: 200, height: 882 },
    { left: 40, right: 240, top: 840, bottom: 890, width: 200, height: 50 },
    { left: 1260, right: 1430, top: 8, bottom: 890, width: 170, height: 882 },
  ]) {
    const geometry = tourGeometry(rect, viewport, { width: 470, height: 430 });
    assertGeometry(geometry, viewport);
    assert.ok(geometry.hole);
    assert.equal(geometry.hole.y, Math.max(0, rect.top - 8));
    assert.equal(
      geometry.hole.y + geometry.hole.height,
      Math.min(viewport.height, rect.bottom + 8),
    );
    assert.ok(
      geometry.card.x >= geometry.hole.x + geometry.hole.width + 18 ||
        geometry.card.x + geometry.card.width <= geometry.hole.x - 18 ||
        geometry.card.y >= geometry.hole.y + geometry.hole.height + 18 ||
        geometry.card.y + geometry.card.height <= geometry.hole.y - 18,
    );
  }
});

test('oversized targets retain their entire visible hole and explicitly request compact remeasurement', () => {
  const viewport = { width: 390, height: 844 };
  const rect = { left: 10, right: 380, top: 80, bottom: 420, width: 370, height: 340 };
  const full = tourGeometry(rect, viewport, { width: 358, height: 430 });
  assertGeometry(full, viewport);
  assert.equal(full.layout, 'overview');
  assert.equal(full.needsCompact, true);
  assert.deepEqual(full.hole, { x: 2, y: 72, width: 386, height: 356, radius: 16 });
  const compact = tourGeometry(rect, viewport, { width: 358, height: 120 }, { compact: true });
  assertGeometry(compact, viewport);
  assert.deepEqual(compact.hole, full.hole, 'shrinking the card must never shrink the target');
  assert.equal(compact.layout, 'dock');
  assert.equal(compact.needsCompact, false);
  assert.equal(compact.overlap, false);
  const all = tourGeometry(
    { left: -100, top: -100, right: 490, bottom: 944 },
    viewport,
    { width: 358, height: 120 },
    { compact: true },
  );
  assertGeometry(all, viewport);
  assert.equal(all.layout, 'overview');
  assert.equal(all.overlap, true);
  assert.equal(all.needsCompact, false);
  assert.deepEqual(all.hole, { x: 0, y: 0, width: 390, height: 844, radius: 16 });
});

test('guide versions resolve only declared full/release catalogues and every release step exists', () => {
  assert.equal(stepsFor(), STEPS);
  assert.equal(stepsFor(VERSION), STEPS);
  assert.ok(STEPS.length > 30 && STEPS.length <= 201);
  assert.equal(new Set(STEPS.map((step) => step.id)).size, STEPS.length);
  for (const release of RELEASES) {
    const ids = release.stepIds || RELEASE_STEP_IDS;
    assert.ok(ids.length > 0 && ids.length < STEPS.length);
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ids)
      assert.ok(
        STEPS.some((step) => step.id === id),
        `missing release step: ${id}`,
      );
    assert.deepEqual(
      stepsFor(release.id).map((step) => step.id),
      ids,
    );
    assert.equal(
      normalizeProgress({ ...emptyProgress(release.id), step: 999 }, release.id).step,
      ids.length - 1,
    );
  }
  for (const version of ['unknown', '__proto__', '', null, ...LEGACY_GUIDE_VERSIONS]) {
    assert.throws(() => stepsFor(version), `unknown client catalogue: ${version}`);
    assert.throws(() => tourUrl(0, version));
    assert.throws(() =>
      createProgressClient({ version, identity: () => ({ key: 'guest', token: '' }) }),
    );
  }
});

test('community guide additions preserve published base indexes and the original release receipt', () => {
  const publishedIds = [
    'home-launchpad',
    'home-handbook',
    'world-atlas',
    'world-coming-islands',
    'world-mathematics',
    'world-island-overview',
    'world-course-orbit',
    'course-directory',
    'course-relations',
    'course-enter-knowledge',
    'knowledge-overview',
    'knowledge-reading',
    'knowledge-tools-status',
    'knowledge-companions',
    'discussion-filters',
    'discussion-open-post',
    'discussion-detail',
    'discussion-reply-max',
    'discussion-composer',
    'max-conversation',
    'max-composer',
    'max-options',
    'max-history',
    'workbench-week',
    'workbench-ai-plan',
    'workbench-priorities',
    'workbench-notifications',
    'shop-catalog',
    'shop-item-details',
    'inventory-assets',
    'inventory-recycling',
    'inventory-ledger-entry',
    'inventory-ledger-filters',
    'inventory-ledger',
    'settings-reading',
    'settings-security',
    'settings-profile-entry',
    'profile-identity',
    'profile-wardrobe',
    'profile-ranch',
    'profile-wool',
    'handbook-missions',
    'handbook-future',
  ];
  assert.equal(VERSION, 'max-v2');
  assert.deepEqual(
    STEPS.slice(0, publishedIds.length).map((step) => step.id),
    publishedIds,
  );
  const original = RELEASES.find((release) => release.id === 'guide-depth-2026-09');
  assert.deepEqual(original.stepIds, [
    'world-atlas',
    'world-mathematics',
    'world-island-overview',
    'workbench-ai-plan',
    'inventory-recycling',
    'inventory-ledger-entry',
    'inventory-ledger',
    'profile-ranch',
    'profile-wool',
  ]);
  assert.notEqual(LATEST_RELEASE.id, original.id);
  assert.deepEqual(
    STEPS.slice(publishedIds.length).map((step) => step.id),
    LATEST_RELEASE.stepIds,
  );
  const completed = normalizeProgress({ ...emptyProgress(), status: 'completed', step: 42 });
  assert.equal(completed.status, 'completed');
  assert.equal(completed.step, 42);
  const originalProgress = normalizeProgress(
    { ...emptyProgress(original.id), status: 'in_progress', step: 6 },
    original.id,
  );
  assert.equal(stepsFor(original.id)[originalProgress.step].id, 'inventory-ledger');
});

test('development and activity steps use compact public targets and never act on signup forms', () => {
  const additions = stepsFor(LATEST_RELEASE.id);
  assert.deepEqual(
    additions.map((step) => step.station),
    ['development', 'development', 'activities', 'activities', 'activities'],
  );
  for (const step of additions) {
    assert.equal(step.action, undefined);
    assert.equal(step.prepare, undefined);
    assert.equal(step.target.includes('form'), false);
    assert.equal(['.main-content', '#content', '.development-hero'].includes(step.target), false);
  }
  assert.match(additions[1].body, /独立入口.*发展端上线后.*整合进入发展端.*尚未完成整合/);
  assert.match(additions[2].body, /独立.*发展端上线后.*整合进入发展端/);
  assert.match(additions.at(-1).body, /下载.*回执.*查询结果/);
  assert.equal(additions.at(-1).emptyTarget, '.activity-hero-links');
});

test('safe guide links reject off-origin and wrong-route destinations without losing course deep links', () => {
  const origin = 'https://www.free-bbs.cn';
  for (const href of [
    'https://evil.test/course?course=math',
    '//evil.test/course',
    'javascript:alert(1)', // eslint-disable-line no-script-url -- Explicitly reject script destinations.
    'data:text/html,test',
    '/api/users',
    '/course/../admin',
    '/knowledge?course=math',
    '/course/extra',
    'https://www.free-bbs.cn:444/course',
  ])
    assert.throws(() => safeGuideHref(href, origin, '/course'), href);
  const course =
    '/course?course=math&point=MA-01-1&query=a%2Bb&guideTour=0&guideVersion=unknown#chapter';
  const safe = safeGuideHref(course, origin, '/course');
  const clean = new URL(safe, origin);
  assert.equal(clean.searchParams.get('guideTour'), null);
  assert.equal(clean.searchParams.get('guideVersion'), null);
  assert.equal(clean.searchParams.get('course'), 'math');
  assert.equal(clean.searchParams.get('point'), 'MA-01-1');
  assert.equal(clean.searchParams.get('query'), 'a+b');
  assert.equal(clean.hash, '#chapter');
  const index = STEPS.findIndex((step) => step.route === '/course');
  const continuation = new URL(tourUrl(index, VERSION, { '/course': course }), origin);
  assert.equal(continuation.searchParams.get('guideTour'), '1');
  assert.equal(continuation.searchParams.get('guideVersion'), null);
  for (const key of ['course', 'point', 'query'])
    assert.equal(continuation.searchParams.get(key), clean.searchParams.get(key));
  assert.equal(continuation.hash, '#chapter');
  for (const remembered of ['https://evil.test/course?course=math', '/inventory?course=math']) {
    const fallback = new URL(tourUrl(index, VERSION, { '/course': remembered }), origin);
    assert.equal(fallback.origin, origin);
    assert.equal(fallback.pathname, '/course');
    assert.equal(fallback.searchParams.has('course'), false);
  }
  const knowledgeIndex = STEPS.findIndex((step) => step.route === '/knowledge');
  const knowledge = new URL(
    tourUrl(knowledgeIndex, VERSION, {
      '/knowledge': '/knowledge?course=math&point=MA-01-1&query=limits#section-2',
    }),
    origin,
  );
  assert.equal(knowledge.searchParams.get('point'), 'MA-01-1');
  assert.equal(knowledge.searchParams.get('course'), 'math');
  assert.equal(knowledge.hash, '#section-2');
  const releaseVersion = 'guide-depth-2026-09';
  const releaseSteps = stepsFor(releaseVersion);
  const releaseIndex = releaseSteps.findIndex((step) => step.route === '/world');
  const release = new URL(
    tourUrl(releaseIndex, releaseVersion, {
      '/world': '/world?view=orbit&guideTour=0&guideVersion=unknown',
    }),
    origin,
  );
  assert.equal(release.searchParams.get('guideVersion'), releaseVersion);
  assert.equal(release.searchParams.get('guideTour'), '1');
  assert.equal(release.searchParams.get('view'), 'orbit');
  const profile = new URL(
    tourUrl(
      STEPS.findIndex((step) => step.route === '/profile'),
      VERSION,
      {
        uid: 'my-user',
        '/profile': '/profile?uid=someone-else',
      },
    ),
    origin,
  );
  assert.equal(profile.searchParams.get('uid'), 'my-user');
});

test('station actions and preparation are restricted to an audited read-only view allowlist', () => {
  const readControls = new Set([
    '.island-orbit-item[data-world-id="mathematics"]',
    '#world-enter-island',
    '#world-modal[open] [data-close-modal]',
    '#island-course-back',
    '#course-map-directory-link',
    '[data-reader-node-id]',
    '[data-course-map-arrow-help-toggle]',
    '#knowledge-return-overview',
    '#knowledge-start-reading',
    '#knowledge-chat-tab-discussion',
    '#knowledge-chat-toggle',
    '#knowledge-chat-close',
    '#discussion-post-list .discussion-post-card:has(.discussion-pin-badge) [data-action="open-post"], #discussion-post-list:not(:has(.discussion-pin-badge)) [data-action="open-post"]',
    '[data-action="close-detail"]',
    '#discussion-create-toggle',
    '.max-composer-tools > summary',
    '#aichat-dialog-toggle',
    '#workbench-plan-tab',
    '#workbench-notifications-tab',
    '#shop-grid [data-action="inspect-item"]',
    '#wallet-ledger-open',
  ]);
  const readLinks = new Map([
    ['a.island-course-planet[data-course-slug="math"]', '/course'],
    ['.course-reader-study-link', '/knowledge'],
    ['#settings-profile-link', '/profile'],
  ]);
  const stationIds = new Set(STATIONS.map((station) => station.id));
  for (const [index, step] of STEPS.entries()) {
    assert.ok(stationIds.has(step.station));
    assert.equal(step.route, STATIONS.find((station) => station.id === step.station).route);
    assert.ok(step.target && step.title && step.body && step.caption);
    for (const view of [step, step.reveal].filter(Boolean)) {
      for (const action of view.prepare || []) {
        assert.ok(
          readControls.has(action.selector),
          `unaudited prepare control: ${action.selector}`,
        );
        assert.ok(
          action.whenMissing,
          'prepare clicks must be guarded to avoid toggling a ready view shut',
        );
      }
      if (!view.action) continue;
      assert.ok(['click', 'link'].includes(view.action.kind));
      if (view.action.kind === 'click')
        assert.ok(
          readControls.has(view.action.selector),
          `unaudited click: ${view.action.selector}`,
        );
      else assert.equal(readLinks.get(view.action.selector), STEPS[index + 1].route);
      if (view.action.alternateSelector) {
        assert.equal(view.action.kind, 'click');
        assert.ok(readControls.has(view.action.alternateSelector));
      }
    }
  }
});

test('full and release progress clients cannot override each other’s version or apply mixed replies', async () => {
  const stores = new Map(
    [VERSION, LATEST_RELEASE.id].map((version) => [version, emptyProgress(version)]),
  );
  const calls = [];
  const make = (version) =>
    createProgressClient({
      version,
      identity: () => ({ key: 'member', token: 'member-token' }),
      async request(method, patch) {
        calls.push({ method, version, patch });
        if (method === 'PATCH')
          stores.set(version, mergeProgress(stores.get(version), patch, fixed));
        return structuredClone(stores.get(version));
      },
    });
  const base = make(VERSION);
  const release = make(LATEST_RELEASE.id);
  await Promise.all([base.load(), release.load()]);
  await base.save({ status: 'in_progress', step: 12, completedTasks: ['meet_max'] });
  await release.save({ version: VERSION, status: 'completed', step: 3 });
  assert.equal(calls.at(-1).patch.version, LATEST_RELEASE.id);
  assert.equal(base.snapshot().status, 'in_progress');
  assert.equal(base.snapshot().step, 12);
  assert.deepEqual(base.snapshot().completedTasks, ['meet_max']);
  assert.equal(release.snapshot().status, 'completed');
  assert.deepEqual(release.snapshot().completedTasks, []);
  const mixed = createProgressClient({
    version: LATEST_RELEASE.id,
    identity: () => ({ key: 'member', token: 'member-token' }),
    request: async () => base.snapshot(),
  });
  await assert.rejects(mixed.load(), /版本/);
  assert.equal(mixed.isLoaded(), false);
  assert.equal(mixed.snapshot().version, LATEST_RELEASE.id);
  release.reset();
  assert.equal(base.snapshot().step, 12);
  assert.equal(release.snapshot().seenAt, null);
});

test('guest release storage rejects the full tour record and never writes the member API', async () => {
  let local = { ...emptyProgress(), status: 'completed', completedTasks: ['meet_max'] };
  const release = createProgressClient({
    version: LATEST_RELEASE.id,
    identity: () => ({ key: 'guest', token: '' }),
    request: async () => {
      assert.fail('guest must not call the account API');
    },
    guestRead: () => local,
    guestWrite: (value) => {
      local = value;
    },
    now: () => fixed,
  });
  await release.load();
  assert.equal(release.snapshot().version, LATEST_RELEASE.id);
  assert.equal(release.snapshot().status, 'not_started');
  assert.deepEqual(release.snapshot().completedTasks, []);
  await release.save({ status: 'in_progress', step: 2 });
  assert.equal(local.version, LATEST_RELEASE.id);
  assert.equal(local.step, 2);
});

test('queued updates use their captured account and apply server responses in order', async () => {
  const first = deferred();
  const seen = [];
  const client = createProgressClient({
    identity: () => ({ key: 'student-a', token: 'token-a' }),
    request(method, patch, owner) {
      seen.push({ method, patch, owner });
      if (seen.length === 1) return first.promise;
      return Promise.resolve(
        serverReply({ status: patch.status, step: patch.step, seenAt: '2026-09-20T10:00:00Z' }),
      );
    },
  });
  const load = client.load();
  const save = client.save({ status: 'in_progress', step: 3 });
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
  assert.equal(seen.length, 1);
  first.resolve(serverReply());
  await load;
  await save;
  assert.equal(seen.length, 2);
  assert.deepEqual(seen[1].owner, { key: 'student-a', token: 'token-a' });
  assert.equal(seen[1].patch.version, VERSION);
  assert.equal(client.snapshot().step, 3);
});

test('switching accounts discards an old response and cancels old queued updates', async () => {
  let owner = { key: 'student-a', token: 'token-a' };
  const old = deferred();
  const seen = [];
  const client = createProgressClient({
    identity: () => owner,
    request(method, patch, captured, signal) {
      seen.push({ method, patch, captured, signal });
      return captured.key === 'student-a'
        ? old.promise
        : Promise.resolve(serverReply({ completedTasks: ['meet_max'] }));
    },
  });
  const pending = client.load();
  const queued = client.save({ completedTasks: ['explore_world'] });
  const pendingCheck = assert.rejects(pending, { name: 'AbortError' });
  const queuedCheck = assert.rejects(queued, { name: 'AbortError' });
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
  owner = { key: 'student-b', token: 'token-b' };
  client.reset();
  assert.equal(seen[0].signal.aborted, true);
  await client.load();
  old.resolve(serverReply({ status: 'completed', completedTasks: ['explore_world'] }));
  await Promise.all([pendingCheck, queuedCheck]);
  assert.deepEqual(client.snapshot().completedTasks, ['meet_max']);
  assert.equal(client.snapshot().status, 'not_started');
  assert.equal(seen.length, 2, 'queued previous-account update must never be sent');
});

test('token changes without an explicit reset still reject stale responses', async () => {
  let token = 'old';
  const held = deferred();
  const client = createProgressClient({
    identity: () => ({ key: 'same-user', token }),
    request: () => held.promise,
  });
  const pending = client.load();
  const check = assert.rejects(pending, { name: 'AbortError' });
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
  token = 'new';
  held.resolve(serverReply({ status: 'completed' }));
  await check;
  assert.equal(client.isLoaded(), false);
});

test('failed synchronization leaves the acknowledged state intact and a retry can succeed', async () => {
  let fail = true;
  const client = createProgressClient({
    identity: () => ({ key: 'member', token: 'preview' }),
    request: async (method) => {
      if (method === 'GET') return serverReply({ step: 2, status: 'in_progress' });
      if (fail) throw new Error('temporarily offline');
      return serverReply({ step: 3, status: 'in_progress' });
    },
  });
  await client.load();
  await assert.rejects(client.save({ step: 3 }), /offline/);
  assert.equal(client.snapshot().step, 2);
  fail = false;
  await client.save({ step: 3 });
  assert.equal(client.snapshot().step, 3);
});

test('guest progress uses only the supplied tab storage and is never copied to a member account', async () => {
  let guest = emptyProgress();
  let member = false;
  const calls = [];
  const client = createProgressClient({
    identity: () =>
      member ? { key: 'new-member', token: 'real-token' } : { key: 'guest', token: '' },
    request: async (...args) => {
      calls.push(args);
      return serverReply();
    },
    guestRead: () => guest,
    guestWrite: (next) => {
      guest = next;
    },
    now: () => fixed,
  });
  await client.load();
  await client.save({ completedTasks: ['explore_world'], status: 'in_progress', step: 1 });
  assert.equal(calls.length, 0);
  assert.deepEqual(guest.completedTasks, ['explore_world']);
  member = true;
  client.reset();
  await client.load();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'GET');
  assert.deepEqual(client.snapshot().completedTasks, []);
});

test('floating guide entry stays off editors and Max while remaining on the six navigation pages', () => {
  assert.deepEqual(
    [...FLOATING_PATHS],
    ['/', '/world', '/discussion', '/workbench', '/inventory', '/electromagnetic'],
  );
  for (const pathname of [
    '/aichat',
    '/circuit',
    '/circuits',
    '/course-map-editor',
    '/markdown-editor',
    '/knowledge',
    '/settings',
    '/guide',
  ])
    assert.equal(FLOATING_PATHS.has(pathname), false);
});

function modalFixture({
  native = false,
  hidden = false,
  display = 'block',
  visibility = 'visible',
} = {}) {
  return {
    hidden,
    matches: () => native,
    closest() {
      return this.hidden ? {} : null;
    },
    getBoundingClientRect: () => ({ width: 420, height: 350 }),
    style: { display, visibility },
  };
}

test('modal detection includes legacy fortune wrappers and semantic dialogs but ignores concealed panels', () => {
  let selectors;
  const win = { getComputedStyle: (node) => node.style };
  const check = (nodes, own = null) =>
    hasBlockingModal(
      {
        querySelectorAll(value) {
          selectors = value;
          return nodes;
        },
      },
      win,
      own,
    );
  assert.equal(check([modalFixture()]), true);
  assert.match(selectors, /\.fortune-modal:not\(\.hidden\)/);
  assert.match(selectors, /\.modal:not\(\.hidden\)/);
  assert.match(selectors, /\[role="dialog"\]/);
  assert.equal(check([modalFixture({ native: true })]), true);
  assert.equal(
    check([
      modalFixture({ hidden: true }),
      modalFixture({ display: 'none' }),
      modalFixture({ visibility: 'hidden' }),
    ]),
    false,
  );
  const own = modalFixture({ native: true });
  own.contains = () => false;
  assert.equal(check([own], own), false);
  const child = modalFixture();
  own.contains = (node) => node === child;
  assert.equal(check([child], own), false);
});

test('blocked first welcome preserves unseen state and visits until a safe presentation', () => {
  const progress = emptyProgress();
  const context = {
    member: true,
    pathname: '/world',
    visible: true,
    blocked: true,
    requested: false,
  };
  assert.deepEqual(initialGuideDecision(progress, context), {
    presentation: 'defer',
    saveVisit: false,
  });
  assert.equal(progress.seenAt, null);
  assert.deepEqual(initialGuideDecision(progress, { ...context, blocked: false, visible: false }), {
    presentation: 'defer',
    saveVisit: false,
  });
  assert.deepEqual(initialGuideDecision(progress, { ...context, blocked: false }), {
    presentation: 'welcome',
    saveVisit: true,
  });
  const seen = mergeProgress(progress, { completedTasks: ['explore_world'] }, fixed);
  assert.equal(initialGuideDecision(seen, { ...context, blocked: false }).presentation, 'none');
  assert.equal(initialGuideDecision(progress, { ...context, member: false }).presentation, 'none');
  assert.equal(
    initialGuideDecision(serverReply({ status: 'in_progress', step: 1 }), {
      ...context,
      requested: true,
    }).presentation,
    'defer',
  );
});

test('controller defers both automatic welcome and visit writes while an existing modal is open', async () => {
  const existingModal = modalFixture();
  const events = [];
  let watching = false;
  const doc = {
    body: { style: {} },
    visibilityState: 'visible',
    head: {},
    getElementById: () => null,
    querySelector(selector) {
      if (selector === 'link[href="/max-guide.css"]' || selector === '[data-max-guide-reopen]')
        return {};
      return null;
    },
    querySelectorAll: () => [existingModal],
    createElement: () => {
      throw new Error('Welcome must not construct a dialog while another modal is open');
    },
    addEventListener() {},
  };
  const win = {
    location: { pathname: '/world', href: 'https://www.free-bbs.cn/world' },
    getComputedStyle: (node) => node.style,
    addEventListener() {},
    cancelAnimationFrame() {},
    MutationObserver: class {
      constructor() {
        this.observe = () => {
          watching = true;
        };
        this.disconnect = () => {
          watching = false;
        };
      }
    },
  };
  const app = {
    userState: { isLoggedIn: true, uid: 'member', token: 'member-token' },
    sessionReady: Promise.resolve(),
    async callApi(route, options) {
      events.push({ route, method: options.method });
      return emptyProgress(new URL(route, 'https://www.free-bbs.cn').searchParams.get('version'));
    },
  };
  const controller = createController(win, doc, app);
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
  assert.equal(watching, true);
  assert.deepEqual(
    events,
    [VERSION, ...LEGACY_GUIDE_VERSIONS].map((version) => ({
      route: `/onboarding?version=${version}`,
      method: 'GET',
    })),
  );
  assert.equal(controller.snapshot().seenAt, null);
  await controller.refresh();
  assert.equal(
    events.filter((event) => event.method === 'PATCH').length,
    0,
    'retry must not consume the pending welcome either',
  );
  assert.equal(controller.snapshot().seenAt, null);
});
