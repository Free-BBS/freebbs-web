const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createResearchPreview, TOKENS } = require('./preview-learning-research');
const { sourceSummary } = require('../public/learning-companion-memory');
const { validateStudy } = require('../backend/learning-research');

async function lab(t) {
  const preview = await createResearchPreview({ seed: false });
  t.after(async () => {
    preview.server.closeAllConnections();
    await new Promise((resolve) => {
      preview.server.close(resolve);
    });
  });
  const call = async (route, { role = 'student', method = 'GET', body, headers = {} } = {}) => {
    const response = await fetch(`${preview.base}${route}`, {
      method,
      headers: {
        ...(TOKENS[role] ? { Authorization: `Bearer ${TOKENS[role]}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    return {
      status: response.status,
      response,
      data: response.headers.get('content-type')?.includes('application/json')
        ? JSON.parse(text)
        : text,
    };
  };
  return { ...preview, call };
}

test('integrated real routers save owner notes, expose only source metadata and provide fresh owner content to simulated Max', async (t) => {
  const preview = await lab(t);
  const route = '/api/learning/signals/SS-01-01/entries';
  const create = (content) => ({
    kind: 'note',
    title: '本人笔记',
    content,
    requestKey: crypto.randomUUID(),
  });
  const own = await preview.call(route, {
    method: 'POST',
    body: create('OWNER_SAVED_PRIVATE_TEXT'),
  });
  const other = await preview.call(route, {
    role: 'other',
    method: 'POST',
    body: create('OTHER_USER_SECRET'),
  });
  assert.equal(own.status, 201);
  assert.equal(other.status, 201);
  const sourcesRoute = '/api/learning-companion/sources?course=signals&point=SS-01-01';
  const sources = await preview.call(sourcesRoute);
  assert.equal(sources.status, 200);
  assert.match(sources.response.headers.get('cache-control'), /no-store/);
  assert.equal(sources.data.sources.counts.note, 1);
  assert.doesNotMatch(
    JSON.stringify(sources.data),
    /OWNER_SAVED_PRIVATE_TEXT|OTHER_USER_SECRET|本人笔记/,
  );
  assert.equal((await preview.call(sourcesRoute, { role: 'guest' })).status, 401);
  const ask = () =>
    preview.call('/api/ai/knowledge/chat', {
      method: 'POST',
      body: {
        question: '请结合我的笔记说明下一步。',
        context: {
          courseSlug: 'signals',
          knowledgePointId: 'SS-01-01',
          personalLearningContent: { records: ['FORGED'] },
        },
      },
    });
  assert.equal((await ask()).status, 200);
  const trusted = JSON.stringify(
    preview.requests.at(-1).trustedCompanionContext.personalLearningContent,
  );
  assert.match(trusted, /OWNER_SAVED_PRIVATE_TEXT/);
  assert.doesNotMatch(trusted, /OTHER_USER_SECRET|FORGED/);
  assert.equal(
    (await preview.call(`${route}/${own.data.entry.id}`, { method: 'DELETE' })).status,
    200,
  );
  await ask();
  assert.doesNotMatch(
    JSON.stringify(preview.requests.at(-1).trustedCompanionContext.personalLearningContent),
    /OWNER_SAVED_PRIVATE_TEXT|OTHER_USER_SECRET/,
  );
  assert.equal((await preview.call(sourcesRoute)).data.sources.counts.note, 0);
});

test('integrated research is a real write and aggregate path, separate from private notes, grades and stars', async (t) => {
  const preview = await lab(t);
  const payload = {
    requestKey: crypto.randomUUID(),
    module: 'creative',
    purpose: 'explore',
    helpfulness: 3,
    barriers: ['support'],
    comment: 'PRIVATE_RESEARCH_COMMENT',
    consent: true,
  };
  const feedback = await preview.call('/api/learning/research/feedback', {
    method: 'POST',
    body: payload,
  });
  assert.equal(feedback.status, 201);
  assert.match(
    JSON.stringify((await preview.call('/api/learning/research/me')).data),
    /PRIVATE_RESEARCH_COMMENT/,
  );
  const admin = await preview.call('/api/learning/research/admin?window=30', { role: 'admin' });
  assert.equal(admin.status, 200);
  assert.doesNotMatch(
    JSON.stringify(admin.data),
    /PRIVATE_RESEARCH_COMMENT|u_preview01|NotingSr_preview/,
  );
  assert.equal((await preview.call('/api/learning/research/admin')).status, 403);
  assert.equal(preview.learning.store.rows.length, 0);
  assert.equal(preview.learning.assessmentStore.rows.length, 0);
  assert.equal(
    (
      await preview.call(`/api/learning/research/feedback/${feedback.data.feedback.id}`, {
        method: 'DELETE',
      })
    ).status,
    200,
  );
  assert.equal(
    (await preview.call('/api/learning/research/feedback', { method: 'POST', body: payload }))
      .status,
    409,
    'a late retry cannot restore deleted research content',
  );
});

test('all three integrated screens use current assets, controls and honest synthetic-data notices', async (t) => {
  const preview = await lab(t);
  for (const [route, marker] of [
    ['/profile?as=student', 'data-learning-research-personal'],
    ['/adminusers?as=admin', 'data-learning-research-admin'],
    ['/knowledge?course=signals&point=SS-01-01', 'data-learning-companion-sources'],
  ]) {
    const page = await preview.call(route);
    assert.equal(page.status, 200);
    assert.match(page.data, new RegExp(marker));
    assert.match(page.data, /统计与研究题均为假设演示数据/);
    assert.match(page.data, /learning-research.js\?v=20261011-research-2/);
  }
  for (const asset of [
    'learning-companion-memory.js',
    'learning-companion-memory.css',
    'learning-research.js',
    'learning-research.css',
  ]) {
    const version = asset === 'learning-research.js' ? 'research-2' : 'research-1';
    assert.equal((await preview.call(`/${asset}?v=20261011-${version}`)).status, 200);
  }
  assert.equal(
    (
      await preview.call('/api/learning/research/me', {
        headers: { Origin: 'https://unrelated.invalid' },
      })
    ).status,
    403,
  );
});

test('production source wires the persisted owner store and research migrations rather than only preview fixtures', () => {
  const source = fs.readFileSync(path.join(__dirname, '../backend/server.js'), 'utf8');
  assert.match(source, /companionLearningStore = createMysqlLearningStore\(pool\)/);
  assert.match(source, /learningStore: companionLearningStore/);
  assert.match(source, /ensureLearningResearchTables\(pool\)/);
  assert.match(source, /createLearningResearchRouter\(\{ pool, requireAuth, requireAdmin \}\)/);
  assert.doesNotMatch(source, /research-preview-only/);
});

test('owner source descriptions distinguish missing and partial from empty observed records', () => {
  assert.match(
    sourceSummary({
      scope: 'authenticated_owner_current_node',
      counts: { note: 1 },
      notesStatus: 'partial',
      assessmentStatus: 'unavailable',
      limited: true,
    }),
    /笔记 1.*部分资料暂不可用.*部分近期记录/,
  );
  assert.match(sourceSummary(null), /暂不可用/);
});

test('the optional course-department research template matches the actual study contract without becoming a mandatory course section', () => {
  const template = fs.readFileSync(
    path.join(__dirname, '../docs/course-authoring/templates/平台研究任务-四阶段.md'),
    'utf8',
  );
  const block = template.match(/```json\s*([\s\S]*?)\s*```/);
  assert.ok(block);
  const authorDraft = JSON.parse(block[1]);
  assert.equal(Object.hasOwn(authorDraft, 'requestKey'), false);
  const definition = validateStudy({ ...authorDraft, requestKey: crypto.randomUUID() });
  assert.deepEqual(Object.keys(definition.phases), ['baseline', 'post', 'delayed', 'transfer']);
  assert.equal(definition.minDelayedHours, 24);
  assert.match(template, /替换下方所有【占位说明】后试测/);
  assert.match(template, /旧任务不会自动关闭/);
  assert.match(template, /没有独立的课程部审核闸门/);
  const readme = fs.readFileSync(
    path.join(__dirname, '../docs/course-authoring/README.md'),
    'utf8',
  );
  assert.match(readme, /templates\/平台研究任务-四阶段.md/);
  assert.match(readme, /不嵌入正文或 `freebbs-quiz`/);
});
