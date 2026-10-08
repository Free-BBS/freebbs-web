const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { toMapNode, createCourseMapsRouter } = require('../backend/course-maps');
const {
  stripAssessmentBlocks,
  getAssessmentDocumentVersion,
  createMysqlAssessmentStore,
} = require('../backend/learning-assessment');
const { documentVersion, createMysqlLearningStore } = require('../backend/learning-workspace');
const { normalizeAdminAccount } = require('../backend/teacher-accounts');
const { stripQuizSource } = require('../public/learning-content');
const { createAnchor, stableBlocks } = require('../public/knowledge-annotations');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const SECRET = 'private-course-scoring-contract-marker';
const quiz = (fence = '```', newline = '\n') =>
  [
    `${fence}freebbs-quiz`,
    JSON.stringify({
      version: 'v1',
      questions: [{ scoring: { answer: SECRET }, explanation: SECRET }],
    }),
    fence,
  ].join(newline);
const courseRow = (markdown) => ({
  node_id: 'SS-01-01',
  title: '卷积',
  summary: '将输入与脉冲响应进行卷积',
  position_x: 80,
  position_y: 90,
  document_markdown: markdown,
  knowledge_markdown: markdown,
  basic_info_markdown: '章节/单元：时域分析',
  applications_markdown: '',
});

test('public course node strips grading source while keeping the fingerprint of the complete authoring document', () => {
  const source = `## 知识正文\r\n\r\n正式课程说明。\r\n\r\n${quiz('````', '\r\n')}\r\n尾部说明。`;
  const row = courseRow(source);
  const student = toMapNode(row, true);
  const manager = toMapNode(row, true, true);
  assert.doesNotMatch(
    JSON.stringify(student),
    /private-course-scoring-contract-marker|freebbs-quiz|"scoring"/,
  );
  assert.match(student.markdown, /正式课程说明/);
  assert.match(student.markdown, /尾部说明/);
  assert.equal(manager.markdown, source);
  assert.match(manager.sections.knowledgeMarkdown, /private-course-scoring-contract-marker/);
  const expected = crypto.createHash('sha256').update(source).digest('hex');
  assert.equal(student.documentVersion, expected);
  assert.equal(manager.documentVersion, expected);
  assert.equal(getAssessmentDocumentVersion(source), expected);
  assert.equal(documentVersion({ document_markdown: source }), expected);
  const [block] = stableBlocks([{ text: '正式课程说明。' }]);
  assert.equal(
    createAnchor({
      nodeId: row.node_id,
      documentVersion: student.documentVersion,
      block,
      start: 0,
      end: 1,
    }).documentVersion,
    expected,
  );
  assert.notEqual(expected, crypto.createHash('sha256').update(student.markdown).digest('hex'));
});

test('all student-facing supplementary sections strip grading data and public graph summaries never return the document', () => {
  const row = courseRow('知识正文。');
  row.basic_info_markdown = `章节/单元：时域分析\n${quiz()}`;
  row.applications_markdown = `应用说明。\n${quiz('~~~~')}`;
  const publicNode = toMapNode(row, true);
  assert.doesNotMatch(
    JSON.stringify(publicNode),
    /private-course-scoring-contract-marker|freebbs-quiz/,
  );
  assert.equal(publicNode.chapterTitle, '时域分析');
  const summary = toMapNode(row);
  assert.equal(summary.markdown, undefined);
  assert.equal(summary.sections, undefined);
  assert.equal(summary.documentVersion, undefined);
});

test('frontend and backend strip quiz fences identically for CRLF, unclosed and long fences', () => {
  const cases = [
    ['ordinary Markdown', 'ordinary Markdown'],
    [`before\n${quiz()}\nafter`, 'before\nafter'],
    [`before\r\n${quiz('~~~', '\r\n')}\r\nafter`, 'before\nafter'],
    [`before\n\n\`\`\`freebbs-quiz\n${SECRET}\nno closing fence`, 'before\n'],
    [
      `before\n\`\`\`\`\`freebbs-quiz\n${SECRET}\n\`\`\`\nstill private\n\`\`\`\`\`\nafter`,
      'before\nafter',
    ],
    [`before\n~~~~freebbs-quiz\n${SECRET}\n~~~\nstill private\n~~~~~\nafter`, 'before\nafter'],
    [`before\n   \`\`\`FREEBBS-QUIZ  \n${SECRET}\n   \`\`\`\nafter`, 'before\nafter'],
    [`before\n${quiz()}\nmid\n${quiz('~~~~')}\nafter`, 'before\nmid\nafter'],
    [`before\n\`\`\`freebbs-quiz\n${SECRET}\n~~~\nnot closed`, 'before'],
    ['before\rbare carriage return\rafter', 'before\nbare carriage return\nafter'],
  ];
  for (const [source, expected] of cases) {
    assert.equal(stripAssessmentBlocks(source), expected);
    assert.equal(stripQuizSource(source), expected);
    assert.equal(stripQuizSource(stripQuizSource(source)), expected);
    assert.doesNotMatch(stripQuizSource(source), /private-course-scoring-contract-marker/);
  }
});

async function mapFixture(t) {
  let row = courseRow(`正式正文。\n${quiz()}`);
  const course = { id: 1, slug: 'signals', name: '信号与系统', board_slug: 'signal' };
  const execute = async (sql, params = []) => {
    if (/FROM courses/.test(sql)) return [[course]];
    if (/FROM course_material_managers/.test(sql))
      return [params[1] === 3 ? [{ course_id: 1 }] : []];
    if (/FROM course_map_nodes n/.test(sql)) return [[{ ...row }]];
    if (/INSERT INTO course_map_node_sections/.test(sql)) {
      row = {
        ...row,
        knowledge_markdown: params[2],
        basic_info_markdown: params[3],
        applications_markdown: params[4],
      };
      return [{ affectedRows: 1 }];
    }
    if (/UPDATE course_map_nodes/.test(sql)) {
      row = { ...row, document_markdown: params[0] };
      return [{ affectedRows: 1 }];
    }
    if (/^\s*SELECT/.test(sql)) return [[]];
    return [{ affectedRows: 1 }];
  };
  const connection = {
    execute,
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
  };
  const pool = { execute, getConnection: async () => connection };
  const user = (request) =>
    request.get('Authorization') === 'Bearer manager'
      ? { id: 3, is_admin: false }
      : { id: 1, is_admin: false };
  const app = express();
  app.use(express.json());
  app.use(
    '/api/courses',
    createCourseMapsRouter({
      pool,
      getOptionalAuthUser: async (request) => user(request),
      requireAuth: async (request) => user(request),
    }),
  );
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  const base = `http://127.0.0.1:${server.address().port}/api/courses/signals/map/nodes/SS-01-01`;
  const call = async (method, suffix, body, as = 'student') => {
    const response = await fetch(`${base}${suffix || ''}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${as}` },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: await response.json() };
  };
  return { call };
}

test('manager GET and saved-document response retain editable quiz source; students continue receiving stripped content', async (t) => {
  const { call } = await mapFixture(t);
  const manager = await call('GET', '', undefined, 'manager');
  assert.equal(manager.status, 200);
  assert.equal(manager.data.course.canEditMap, true);
  assert.match(manager.data.node.markdown, /private-course-scoring-contract-marker/);
  assert.doesNotMatch(
    JSON.stringify((await call('GET')).data),
    /private-course-scoring-contract-marker/,
  );
  const edited = `${manager.data.node.sections.knowledgeMarkdown}\n新补充说明。`;
  const saved = await call(
    'PUT',
    '/document',
    {
      sections: { ...manager.data.node.sections, knowledgeMarkdown: edited },
      expectedRevision: manager.data.node.revision,
    },
    'manager',
  );
  assert.equal(saved.status, 200);
  assert.equal(saved.data.node.sections.knowledgeMarkdown, edited);
  assert.match(saved.data.sections.knowledgeMarkdown, /private-course-scoring-contract-marker/);
  assert.equal(saved.data.node.documentVersion, getAssessmentDocumentVersion(edited));
  const student = await call('GET');
  assert.equal(student.data.course.canEditMap, false);
  assert.doesNotMatch(JSON.stringify(student.data), /private-course-scoring-contract-marker/);
  assert.match(student.data.node.markdown, /新补充说明/);
  assert.equal(student.data.node.documentVersion, saved.data.node.documentVersion);
  assert.equal(
    (await call('PUT', '/document', { sections: { knowledgeMarkdown: '无权修改' } })).status,
    403,
  );
});

test('teacher identity creation and binding do not grant learning review access without a course assignment', async () => {
  const account = normalizeAdminAccount({
    username: 'teacher_demo',
    fullName: '示例教师',
    role: 'teacher',
    password: 'example-password',
  });
  assert.equal(account.studentId, null);
  assert.equal(account.email, null);
  const teacher = { id: 8, role: account.role, is_admin: false, student_id: null, email: null };
  const boundTeacher = { ...teacher, student_id: '2020123456', email: 'teacher@example.test' };
  const managers = new Set();
  const pool = {
    async execute(sql, [courseId, userId]) {
      assert.match(sql, /FROM course_material_managers/);
      return [managers.has(`${courseId}:${userId}`) ? [{ course_id: courseId }] : []];
    },
  };
  const stores = [createMysqlLearningStore(pool), createMysqlAssessmentStore(pool)];
  for (const store of stores) {
    assert.equal(await store.canReview(teacher, { course_id: 1 }), false);
    assert.equal(await store.canReview(boundTeacher, { course_id: 1 }), false);
    managers.add('1:8');
    assert.equal(await store.canReview(boundTeacher, { course_id: 1 }), true);
    assert.equal(await store.canReview(boundTeacher, { course_id: 2 }), false);
    assert.equal(await store.canReview({ ...teacher, is_admin: true }, { course_id: 2 }), true);
    managers.clear();
  }
});

function scriptOrder(html) {
  return [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g)].map(
    (match) => match[1].split('?')[0],
  );
}
function assertBefore(scripts, earlier, later) {
  assert.ok(scripts.includes(earlier), `${earlier} must be loaded`);
  assert.ok(scripts.includes(later), `${later} must be loaded`);
  assert.ok(scripts.indexOf(earlier) < scripts.indexOf(later), `${earlier} must precede ${later}`);
}

test('user administration loads teacher identity and learning analytics resources together', () => {
  const html = read('public/adminusers.html');
  const scripts = scriptOrder(html);
  const styles = [...html.matchAll(/<link\b[^>]*\bhref=["']([^"']+)["']/g)].map(
    (match) => match[1].split('?')[0],
  );
  for (const stylesheet of ['/account-identity.css', '/learning-analytics.css']) {
    assert.equal(styles.filter((source) => source === stylesheet).length, 1);
    assert.ok(read(`public${stylesheet}`).trim());
  }
  for (const script of ['/admin-account-credentials.js', '/learning-analytics.js']) {
    assert.equal(scripts.filter((source) => source === script).length, 1);
    assertBefore(scripts, '/app.js', script);
    assert.ok(read(`public${script}`).trim());
  }
  assert.match(html, /id="admin-student-requests"/);
  assert.match(html, /id="admin-learning-data"/);
});

test('CI retains teacher account and learning regression suites after synchronization', () => {
  const scripts = JSON.parse(read('package.json')).scripts;
  const ci = read('scripts/ci-validate.sh');
  for (const name of [
    'test:teacher-accounts',
    'test:learning-workspace',
    'test:learning-assessment',
    'test:learning-analytics',
    'test:learning-structure',
    'test:course-authoring',
  ]) {
    assert.match(scripts[name], /^node --test /, `${name} must have a test command`);
    assert.match(ci, new RegExp(`^npm run ${name}\\s*$`, 'm'), `${name} must run in CI`);
  }
  assert.match(scripts['test:workbench'], /backend\/schedule-series\.test\.js/);
  assert.match(scripts['test:workbench'], /backend\/schedule-series\.mysql\.test\.js/);
  assert.match(scripts['test:staff-teacher-calendar'], /scripts\/staff-page\.test\.js/);
});

test('course and knowledge pages load shared structure and content helpers before their consumers', () => {
  const course = scriptOrder(read('public/course.html'));
  assertBefore(course, '/app.js', '/course-map.js');
  assertBefore(course, '/learning-progress.js', '/course-map.js');
  assertBefore(course, '/knowledge-overview.js', '/course-structure.js');
  assertBefore(course, '/learning-content.js', '/course-structure.js');
  assertBefore(course, '/course-structure.js', '/course-map.js');
  const knowledge = scriptOrder(read('public/knowledge.html'));
  assertBefore(knowledge, '/app.js', '/knowledge.js');
  assertBefore(knowledge, '/learning-progress.js', '/knowledge.js');
  assertBefore(knowledge, '/learning-content.js', '/knowledge.js');
  assertBefore(knowledge, '/learning-next-steps.js', '/knowledge.js');
  assertBefore(knowledge, '/learning-next-steps.js', '/knowledge-workspace.js');
  assertBefore(knowledge, '/knowledge-annotations.js', '/knowledge-workspace.js');
  assertBefore(knowledge, '/learning-assessment.js', '/knowledge-workspace.js');
  assertBefore(knowledge, '/learning-analytics.js', '/knowledge.js');
  assertBefore(knowledge, '/learning-analytics.js', '/knowledge-workspace.js');
  for (const name of [
    '/knowledge.js',
    '/knowledge-workspace.js',
    '/learning-next-steps.js',
    '/learning-assessment.js',
    '/knowledge-annotations.js',
    '/course-structure.js',
  ]) {
    const html = read(
      name === '/course-structure.js' ? 'public/course.html' : 'public/knowledge.html',
    );
    assert.ok(html.includes(`src="${name}?v=`), `${name} has a cache revision`);
  }
});

test('six learning tools share one Max input and annotation questions only open a draft', () => {
  const html = read('public/knowledge.html');
  const tools = [
    ...new Set(
      [...html.matchAll(/data-knowledge-tool=["']([^"']+)["']/g)].map((match) => match[1]),
    ),
  ].sort();
  assert.deepEqual(tools, ['content', 'continue', 'contribute', 'feedback', 'notes', 'resources']);
  assert.equal((html.match(/id="knowledge-chat-input"/g) || []).length, 1);
  assert.equal((html.match(/id="knowledge-chat-form"/g) || []).length, 1);
  assert.doesNotMatch(html, /id="learning-(?:advice|concern|advice-generate|advice-save)"/);
  const workspace = read('public/knowledge-workspace.js');
  assert.doesNotMatch(workspace, /streamKnowledgeRagResponse\s*\(/);
  assert.match(workspace, /knowledge:annotation-ask[\s\S]{0,220}openInteraction\('max'/);
  const knowledge = read('public/knowledge.js');
  const openHandler = knowledge.match(
    /page\.addEventListener\('knowledge:open-interaction',[\s\S]*?\n {2}\}\);/,
  )?.[0];
  assert.ok(openHandler);
  assert.match(openHandler, /input\.value\s*=/);
  assert.doesNotMatch(openHandler, /submitChatPrompt|streamKnowledgeRagResponse/);
});

test('private path and annotation pagination use separate scoped requests and preserve overlay pages', () => {
  const workspace = read('public/knowledge-workspace.js');
  assert.match(workspace, /\/entries\?kind=path/);
  const loader = workspace.slice(
    workspace.indexOf('async function loadAnnotationRecords('),
    workspace.indexOf('async function saveForm('),
  );
  assert.ok(loader);
  assert.match(loader, /\/entries\?kind=note&annotations=1/);
  assert.match(loader, /index < 10/);
  assert.match(
    loader,
    /generation !== state\.generation \|\| request !== state\.annotationRequest/,
  );
  assert.match(loader, /new Map\(entries\.map/);
  assert.equal((loader.match(/knowledge:annotation-records-loaded/g) || []).length, 1);
  assert.match(workspace, /knowledge:annotations-more[\s\S]{0,110}loadAnnotationRecords\(true\)/);
  const annotations = read('public/knowledge-annotations.js');
  assert.match(annotations, /knowledge:annotation-records-loaded/);
  assert.match(annotations, /if \(!state\.annotationRecordsLoaded\) attach\(event\.detail\)/);
  assert.doesNotMatch(annotations, /app\.callApi|streamKnowledgeRagResponse/);
});
