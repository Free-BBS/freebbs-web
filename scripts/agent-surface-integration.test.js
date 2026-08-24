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
  const appSource = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
  const knowledgeSource = fs.readFileSync(path.join(root, 'public', 'knowledge.js'), 'utf8');
  const backendSource = fs.readFileSync(path.join(root, 'backend', 'server.js'), 'utf8');
  assert.match(appSource, /function streamKnowledgeRagResponse/);
  assert.match(appSource, /'\/ai\/knowledge\/chat'/);
  assert.match(knowledgeSource, /function buildKnowledgeChatRequest/);
  assert.match(knowledgeSource, /app\.streamKnowledgeRagResponse/);
  assert.match(knowledgeSource, /knowledge-chat-message-body/);
  assert.match(knowledgeSource, /knowledge-chat-loading-dots/);
  assert.match(knowledgeSource, /plainText: role === 'user'/);
  assert.doesNotMatch(knowledgeSource, /agent: 'rag'/);
  assert.doesNotMatch(knowledgeSource, /temperature:/);
  assert.doesNotMatch(knowledgeSource, /model:/);
  assert.doesNotMatch(knowledgeSource, /document\.createElement\('p'\)/);
  assert.doesNotMatch(knowledgeSource, /createMockReply/);
  assert.doesNotMatch(knowledgeSource, /agent: 'general_chat'/);
  assert.match(backendSource, /app\.post\('\/api\/ai\/knowledge\/chat'/);
  assert.match(backendSource, /function buildKnowledgeRagChatPayload/);
  assert.match(backendSource, /agent: 'rag'/);
  assert.match(backendSource, /temperature: KNOWLEDGE_RAG_TEMPERATURE/);
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
