const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const navigation = require('../public/course-navigation');

const sample = {
  course: 'signals',
  focus: 'SS-02-001',
  chapter: 'SS-02',
  find: '  卷积 con  ',
  findPage: 2,
  pickerChapter: 'SS-02',
  pickerQuery: '  线 性系统  ',
  pickerPage: 1,
  routePage: 4,
  catalogChapter: 'SS-02',
  catalogQuery: '  查 卷积 😀  ',
  catalogPage: 2,
  catalogOpen: 1,
};
test('navigation context exposes a DOM-free UMD global and never requires storage or user state', () => {
  const sandbox = { window: {}, URLSearchParams };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../public/course-navigation.js'), 'utf8'),
    sandbox,
  );
  assert.equal(typeof sandbox.window.FreeBbsCourseNavigation.encode, 'function');
  assert.equal(typeof sandbox.window.FreeBbsCourseNavigation.parse, 'function');
});

test('native Back can restore the current course entry without adding a history step or overwriting unrelated preferences', () => {
  const calls = [];
  const original = { existingView: 'preserved' };
  const environment = {
    location: {
      href: 'https://freebbs.example/course?course=signals&as=student&theme=dark&focus=SS-01-01#directory',
    },
    history: { state: original, replaceState: (...args) => calls.push(args) },
  };
  assert.equal(
    navigation.remember(navigation.encode(sample, 'signals'), 'signals', environment),
    true,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], original);
  const restored = new URL(calls[0][2], 'https://freebbs.example');
  assert.equal(restored.pathname, '/course');
  assert.equal(restored.searchParams.get('as'), 'student');
  assert.equal(restored.searchParams.get('theme'), 'dark');
  assert.equal(restored.searchParams.get('focus'), sample.focus);
  assert.equal(restored.searchParams.get('catalogQuery'), sample.catalogQuery);
  assert.equal(restored.searchParams.getAll('focus').length, 1);
  assert.equal(restored.hash, '#directory');
  for (const href of [
    'https://freebbs.example/knowledge?course=signals',
    'https://freebbs.example/course?course=math',
  ])
    assert.equal(
      navigation.remember(navigation.encode(sample, 'signals'), 'signals', {
        ...environment,
        location: { href },
      }),
      false,
    );
  for (const value of ['https://evil.example', '/course?course=math', null])
    assert.equal(navigation.remember(value, 'signals', environment), false);
  assert.equal(calls.length, 1);
  assert.equal(
    navigation.remember(navigation.encode(sample, 'signals'), 'signals', {
      ...environment,
      history: {
        replaceState() {
          throw new Error('restricted history');
        },
      },
    }),
    false,
  );
});

test('public chapter, searches and route pages round-trip canonically without losing Unicode or IME spaces', () => {
  const before = JSON.stringify(sample);
  const encoded = navigation.encode(sample, 'signals');
  assert.ok(encoded.startsWith('/course?course=signals'));
  const parsed = navigation.parse(encoded, 'signals');
  Object.entries(sample).forEach(([key, value]) => assert.equal(parsed.get(key), String(value)));
  assert.equal(navigation.encode(parsed, 'signals'), encoded);
  assert.equal(navigation.encode(encoded, 'signals'), encoded);
  assert.equal(JSON.stringify(sample), before);
});

test('returnTo survives one normal outer URLSearchParams encoding but is never decoded twice', () => {
  const value = navigation.encode(sample, 'signals');
  const knowledge = new URLSearchParams({ course: 'signals', point: 'SS-02-001', returnTo: value });
  const reparsed = new URLSearchParams(knowledge.toString()).get('returnTo');
  assert.equal(navigation.encode(reparsed, 'signals'), value);
  for (const invalid of [
    encodeURIComponent(value),
    encodeURIComponent(encodeURIComponent(value)),
    '/%63ourse?course=signals',
    '/course%3Fcourse=signals',
    '/course?course=%2573ignals',
    '/course?course=signals&focus=SS%252D02%252D001',
    '/course?course=signals&routePage=%2534',
    '/course?course=signals&%2572eturnTo=%252F%252Fevil.example',
  ])
    assert.equal(navigation.parse(invalid, 'signals'), null, invalid);
});

test('external, protocol-relative, look-alike, userinfo and fragment return destinations are rejected', () => {
  for (const value of [
    'https://evil.example/course?course=signals',
    'http://localhost/course?course=signals',
    '//evil.example/course?course=signals',
    '///evil.example/course?course=signals',
    String.raw`/\\evil.example/course?course=signals`,
    '/course/../evil?course=signals',
    '/courseevil?course=signals',
    '/course/?course=signals',
    ' /course?course=signals',
    '/COURSE?course=signals',
    // eslint-disable-next-line no-script-url -- A hostile destination under rejection testing, never executed.
    'javascript:alert(1)',
    '/course?course=signals#https://evil.example',
    '/course?course=signals&returnTo=https://evil.example',
    '/course?course=signals&redirect=//evil.example',
  ])
    assert.equal(navigation.encode(value, 'signals'), '', value);
});

test('cross-course context, duplicate fields and invalid chapter or node identifiers cannot be replayed', () => {
  for (const value of [
    '/course?course=math',
    '/course?course=signals&course=math',
    '/course?course=signals&find=x&find=y',
    '/course?course=signals&focus=ss-02-01',
    '/course?course=signals&focus=SS-01-<script>',
    '/course?course=signals&chapter=SS-02-001',
    '/course?course=signals&pickerChapter=SS-02-001',
    '/course?focus=SS-02-001',
  ])
    assert.equal(navigation.parse(value, 'signals'), null);
  assert.equal(navigation.encode(sample, 'math'), '');
  assert.equal(navigation.encode({ ...sample, course: 'signals.example' }, 'signals.example'), '');
});

test('query text is bounded to 200 Unicode characters while literal URL-like search text is not a redirect', () => {
  const allowed = navigation.encode(
    { course: 'signals', find: '😀'.repeat(200), pickerQuery: '中'.repeat(200) },
    'signals',
  );
  assert.equal(navigation.parse(allowed, 'signals').get('find'), '😀'.repeat(200));
  assert.equal(navigation.encode({ course: 'signals', find: '中'.repeat(201) }, 'signals'), '');
  assert.equal(
    navigation.encode({ course: 'signals', pickerQuery: '😀'.repeat(201) }, 'signals'),
    '',
  );
  const query = String.raw` %2F%2Fevil.example \\omega 中文  `;
  assert.equal(
    navigation
      .parse(navigation.encode({ course: 'signals', find: query }, 'signals'), 'signals')
      .get('find'),
    query,
  );
  assert.equal(
    navigation.parse(`/course?course=signals&find=${'x'.repeat(9000)}`, 'signals'),
    null,
  );
});

test('page values are canonical bounded integers, including real explicit zero, not arbitrary executable state', () => {
  for (const page of [0, 1, 10000]) {
    const result = navigation.parse(
      navigation.encode(
        { course: 'signals', findPage: page, pickerPage: page, routePage: page },
        'signals',
      ),
      'signals',
    );
    for (const key of ['findPage', 'pickerPage', 'routePage'])
      assert.equal(result.get(key), String(page));
  }
  for (const page of [-1, 10001, 1.5, Infinity, NaN, '01', '1e2', '1;alert(1)', '']) {
    assert.equal(
      navigation.encode({ course: 'signals', routePage: page }, 'signals'),
      '',
      String(page),
    );
  }
});

test('empty optional filters are omitted while page zero and deliberate IME spaces survive', () => {
  const value = navigation.encode(
    {
      course: 'signals',
      focus: '',
      chapter: '',
      pickerChapter: '',
      find: '',
      pickerQuery: '',
      findPage: 0,
      pickerPage: 0,
      routePage: 0,
    },
    'signals',
  );
  assert.equal(value, '/course?course=signals&findPage=0&pickerPage=0&routePage=0');
  assert.equal(
    navigation
      .parse(navigation.encode({ course: 'signals', find: '  ' }, 'signals'), 'signals')
      .get('find'),
    '  ',
  );
  for (const suffix of ['focus=&focus=SS-02-001', 'find=&find=x', 'chapter=&chapter=SS-02'])
    assert.equal(navigation.parse(`/course?course=signals&${suffix}`, 'signals'), null);
});

test('whitelisting ignores unrelated object data without leaking tokens, notes, identity or progress', () => {
  const input = {
    ...sample,
    token: 'never-export',
    uid: 'private-person',
    stars: 3,
    annotations: ['private'],
    returnTo: '//evil',
  };
  const params = navigation.parse(navigation.encode(input, 'signals'), 'signals');
  assert.deepEqual([...params.keys()], navigation.FIELDS);
  assert.ok(!params.toString().includes('never-export'));
  assert.equal(navigation.encode({ course: 'signals', find: { private: true } }, 'signals'), '');
  assert.equal(navigation.encode(new URLSearchParams('course=signals&token=bad'), 'signals'), '');
});

test('control characters or encoded control characters are rejected, not silently normalized into another URL', () => {
  for (const value of [
    '\n/course?course=signals',
    '/course?course=signals\n',
    '/course?course=signals&find=%00',
    '/course?course=signals&find=%0D%0AX-Test%3A1',
  ])
    assert.equal(navigation.parse(value, 'signals'), null);
  assert.equal(navigation.encode({ course: 'signals', find: 'line\nline' }, 'signals'), '');
});

function knowledgeFunctions(returnTo, nodeId = 'SS-02-001', { helper = true } = {}) {
  const file = fs.readFileSync(path.join(__dirname, '../public/knowledge.js'), 'utf8');
  const source = file.slice(
    file.indexOf('  function knowledgeHref('),
    file.indexOf('  function setSequenceLink('),
  );
  const sandbox = {
    URLSearchParams,
    courseSlug: 'signals',
    params: new URLSearchParams({ returnTo }),
    state: { node: nodeId ? { id: nodeId } : null },
    window: helper ? { FreeBbsCourseNavigation: navigation } : {},
  };
  vm.runInNewContext(source, sandbox);
  return sandbox;
}
test('production knowledge links carry only validated returnTo across points and back to the same course', () => {
  const returnTo = navigation.encode(sample, 'signals');
  const functions = knowledgeFunctions(returnTo);
  const next = new URLSearchParams(functions.knowledgeHref('SS-03-006').split('?')[1]);
  assert.equal(next.get('point'), 'SS-03-006');
  assert.equal(next.get('returnTo'), returnTo);
  const back = new URLSearchParams(functions.courseDirectoryHref().split('?')[1]);
  Object.entries(sample).forEach(([key, value]) => assert.equal(back.get(key), String(value)));
});

test('moving to another knowledge point keeps the search context but drops the old explicit route page', () => {
  const functions = knowledgeFunctions(navigation.encode(sample, 'signals'), 'SS-03-006');
  const back = new URLSearchParams(functions.courseDirectoryHref().split('?')[1]);
  assert.equal(back.get('focus'), 'SS-03-006');
  assert.equal(back.get('routePage'), null);
  assert.equal(back.get('find'), sample.find);
  assert.equal(back.get('pickerQuery'), sample.pickerQuery);
  assert.equal(back.get('chapter'), sample.chapter);
  assert.equal(back.get('pickerPage'), String(sample.pickerPage));
});

test('missing helper and hostile returnTo safely retain the existing ordinary course and knowledge hrefs', () => {
  for (const functions of [
    knowledgeFunctions('https://evil.example'),
    knowledgeFunctions(navigation.encode(sample, 'signals'), 'SS-02-001', { helper: false }),
  ]) {
    assert.equal(functions.courseDirectoryHref(), '/course?course=signals&focus=SS-02-001');
    assert.equal(functions.knowledgeHref('SS-03-006'), '/knowledge?course=signals&point=SS-03-006');
  }
});

function drawerHref(getReturnTo, { helper = true } = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../public/knowledge-overview.js'), 'utf8');
  assert.match(source, /function createDrawer\(\{ app, courseSlug, getReturnTo \}\)/);
  const block = source.slice(
    source.indexOf('      const studyQuery ='),
    source.indexOf('      relation.hidden = !onRelations;'),
  );
  const sandbox = {
    URLSearchParams,
    courseSlug: 'signals',
    node: { id: 'SS-02-001' },
    getReturnTo,
    study: {},
    window: helper ? { FreeBbsCourseNavigation: navigation } : {},
  };
  vm.runInNewContext(block, sandbox);
  return sandbox.study.href;
}
test('production overview study link captures the callback context without making navigation depend on it', () => {
  const valid = new URLSearchParams(drawerHref(() => sample).split('?')[1]);
  assert.equal(valid.get('returnTo'), navigation.encode(sample, 'signals'));
  assert.equal(valid.get('view'), 'reading');
  for (const [callback, helper] of [
    [() => '//evil.example', true],
    [
      () => {
        throw new Error('unavailable UI context');
      },
      true,
    ],
    [undefined, true],
    [() => sample, false],
  ])
    assert.equal(
      drawerHref(callback, { helper }),
      '/knowledge?course=signals&point=SS-02-001&view=reading',
    );
});

test('return context code never reads or writes learning storage, backend records, stars or assessment evidence', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/course-navigation.js'), 'utf8');
  assert.doesNotMatch(
    source,
    /localStorage|sessionStorage|fetch\(|callApi\(|FreeBbsLearningProgress|FreeBbsLearningStars/,
  );
  const values = new URLSearchParams('course=signals&find=%20%E4%B8%AD%E6%96%87%20&routePage=0');
  const before = values.toString();
  navigation.encode(values, 'signals');
  assert.equal(values.toString(), before);
});

test('catalog context uses the same exact chapter/query/page rules and a strict explicit 0/1 open flag', () => {
  for (const open of [0, 1, '0', '1']) {
    const encoded = navigation.encode(
      {
        course: 'signals',
        catalogChapter: 'SS-02',
        catalogQuery: '  literal %2F 中文 😀  ',
        catalogPage: 0,
        catalogOpen: open,
      },
      'signals',
    );
    const parsed = navigation.parse(encoded, 'signals');
    assert.equal(parsed.get('catalogChapter'), 'SS-02');
    assert.equal(parsed.get('catalogQuery'), '  literal %2F 中文 😀  ');
    assert.equal(parsed.get('catalogPage'), '0');
    assert.equal(parsed.get('catalogOpen'), String(open));
  }
  for (const open of ['', 2, -1, 'true', 'false', true, false, '01', '%31', null]) {
    if (open === null) continue;
    assert.equal(
      navigation.encode({ course: 'signals', catalogOpen: open }, 'signals'),
      '',
      String(open),
    );
  }
  for (const suffix of [
    'catalogOpen=1&catalogOpen=0',
    'catalogQuery=x&catalogQuery=y',
    'catalogChapter=SS-02-001',
    'catalogChapter=ss-02',
    'catalogQuery=%00',
    'catalogQuery=%0A',
    'catalogPage=10001',
    'catalogPage=1e2',
    'catalogOpen=%2531',
  ])
    assert.equal(navigation.parse(`/course?course=signals&${suffix}`, 'signals'), null, suffix);
  assert.equal(
    navigation.encode({ course: 'signals', catalogQuery: '😀'.repeat(201) }, 'signals'),
    '',
  );
  assert.ok(navigation.encode({ course: 'signals', catalogQuery: '😀'.repeat(200) }, 'signals'));
});

test('catalog search context survives real overview and knowledge return links without opening unrelated state', () => {
  const returnTo = navigation.encode(sample, 'signals');
  assert.equal(
    new URLSearchParams(drawerHref(() => sample).split('?')[1]).get('returnTo'),
    returnTo,
  );
  const functions = knowledgeFunctions(returnTo, 'SS-03-006');
  const next = new URLSearchParams(functions.knowledgeHref('SS-03-007').split('?')[1]);
  assert.equal(next.get('returnTo'), returnTo);
  const back = new URLSearchParams(functions.courseDirectoryHref().split('?')[1]);
  for (const key of ['catalogChapter', 'catalogQuery', 'catalogPage', 'catalogOpen'])
    assert.equal(back.get(key), String(sample[key]));
});
