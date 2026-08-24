const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

test('问问 Max 组合普通聊天与 Navigation，并渲染白名单路由按钮', () => {
  const appSource = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
  const backendSource = fs.readFileSync(path.join(root, 'backend', 'server.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');

  assert.match(appSource, /agent: 'navigation'/);
  assert.match(appSource, /execute_subagent: 'auto'/);
  assert.match(appSource, /combine_general_chat: true/);
  assert.match(appSource, /function renderMaxNavigationRoutes/);
  assert.match(appSource, /function wrapMaxAnswerPanel/);
  assert.match(appSource, /Max 回答/);
  assert.match(appSource, /页面导航/);
  assert.match(appSource, /title: '课程与知识图谱'/);
  assert.match(appSource, /MAX_NAVIGATION_PATHS/);
  assert.match(appSource, /'\/knowledge'/);
  assert.match(appSource, /'\/workbench'/);
  assert.match(appSource, /'\/discussion'/);
  assert.match(backendSource, /agent: 'navigation'/);
  assert.match(backendSource, /combine_general_chat: payload\.combine_general_chat === true/);
  assert.match(backendSource, /X-FreeBBS-Internal-Token/);
  assert.match(backendSource, /X-FreeBBS-UID/);
  assert.match(backendSource, /X-FreeBBS-Student-No/);
  assert.match(backendSource, /web_learning:read,thu_info:read/);
  assert.match(styles, /\.aichat-navigation-action/);
  assert.match(styles, /\.aichat-response-panel/);
});

test('RAG 回答留在上栏且 Navigation 跳转按钮保留在下栏', () => {
  const appSource = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');

  assert.match(appSource, /if \(agentName === 'RAG'\)/);
  assert.match(appSource, /if \(!navigationResult\?\.navigation_requested\)/);
  assert.match(
    appSource,
    /item\?\.name, item\?\.code, item\?\.slug, item\?\.description, item\?\.summary/,
  );
});

test('Navigation 导引按钮随对话保存并在重新进入页面时恢复', () => {
  const appSource = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
  const backendSource = fs.readFileSync(path.join(root, 'backend', 'server.js'), 'utf8');

  assert.match(appSource, /function createAiNavigationSnapshot/);
  assert.match(appSource, /Array\.isArray\(navigationResult\?\.navigation_routes\)/);
  assert.match(appSource, /const navigation = createAiNavigationSnapshot\(result\)/);
  assert.match(appSource, /renderMaxNavigationRoutes\(assistantArticle, navigation\)/);
  assert.match(appSource, /navigation,/);
  assert.match(appSource, /renderMaxNavigationRoutes\(article, message\.navigation\)/);
  assert.match(backendSource, /function normalizeAiDialogNavigation/);
  assert.match(backendSource, /normalizedMessage\.navigation = navigation/);
  assert.match(backendSource, /AI_DIALOG_NAVIGATION_PATHS/);
});

test('Navigation 将 Agent 内部域名的白名单路由转换为当前站点路径', () => {
  const appSource = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
  const functionStart = appSource.indexOf('function normalizeMaxNavigationUrl');
  const functionEnd = appSource.indexOf('\n\nfunction createAiNavigationSnapshot', functionStart);
  const functionSource = appSource.slice(functionStart, functionEnd);
  const context = {
    URL,
    MAX_NAVIGATION_PATHS: new Set([
      '/knowledge',
      '/workbench',
      '/discussion',
      '/course',
      '/development',
      '/profile',
    ]),
    window: { location: { origin: 'https://www.free-bbs.cn' } },
  };

  vm.runInNewContext(
    `${functionSource}\nnormalized = normalizeMaxNavigationUrl(
      'http://127.0.0.1:3000/development?q=project#team'
    );\nrejected = normalizeMaxNavigationUrl('http://127.0.0.1:3000/admin');`,
    context,
  );

  assert.equal(context.normalized, '/development?q=project#team');
  assert.equal(context.rejected, '');
});
