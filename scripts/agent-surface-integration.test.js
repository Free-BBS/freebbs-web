const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

test('Info 内置消息页面并代理异步任务', () => {
  const appSource = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
  const backendSource = fs.readFileSync(path.join(root, 'backend', 'server.js'), 'utf8');

  assert.match(appSource, /function renderMaxSubagentResult/);
  assert.match(appSource, /function pollInfoJob/);
  assert.match(appSource, /function addMentionedCourseMapRoute/);
  assert.match(appSource, /\/course\?course=\$\{encodeURIComponent\(course\.slug\)\}/);
  assert.match(appSource, /\/ai\/info\/jobs\/get/);
  assert.match(backendSource, /app\.post\('\/api\/ai\/info\/jobs\/get'/);
  assert.match(backendSource, /\/api\/v1\/info\/jobs\/get/);
});

test('课程知识页调用真正的 RAG Agent', () => {
  const courseSource = fs.readFileSync(path.join(root, 'public', 'course.js'), 'utf8');
  assert.match(courseSource, /agent: 'rag'/);
  assert.doesNotMatch(courseSource, /agent: 'general_chat'/);
});

test('工作台在已授权且数据过期时自动同步通知', () => {
  const connectorSource = fs.readFileSync(
    path.join(root, 'public', 'workbench-connectors.js'),
    'utf8',
  );
  const brokerSource = fs.readFileSync(
    path.join(root, 'backend', 'tsinghua-connectors', 'broker.js'),
    'utf8',
  );
  assert.match(connectorSource, /function maybeAutoSync/);
  assert.match(connectorSource, /await syncNow\(\{ automatic: true \}\)/);
  assert.match(connectorSource, /autoSyncRequested/);
  assert.match(brokerSource, /minimumIntervalSeconds: runtimeConfig\.syncIntervalSeconds/);
});
