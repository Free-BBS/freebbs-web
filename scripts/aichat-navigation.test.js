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

test('最近对话较多时列表项保持内容高度并完整滚动', () => {
  const styles = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');

  assert.match(
    styles,
    /body\.aichat-page \.main-content \.aichat-dialog-list\s*{[^}]*grid-auto-rows:\s*max-content;/s,
  );
  assert.match(
    styles,
    /body\.aichat-page \.main-content \.aichat-dialog-item\s*{[^}]*height:\s*max-content;/s,
  );
});

test('RAG 回答留在上栏且 Navigation 跳转按钮保留在下栏', () => {
  const appSource = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');

  assert.match(appSource, /if \(agentName === 'RAG'\)/);
  assert.match(appSource, /navigationResult\?\.subagent\?\.course/);
  assert.match(appSource, /intent === 'knowledge_search' && structuredCourse/);
  assert.match(appSource, /\/discussion\?board=\$\{encodeURIComponent\(board\)\}/);
  assert.match(appSource, /\/course\?course=\$\{encodeURIComponent\(course\.slug\)\}/);
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

test('对话历史将 Agent 绝对路由保存为白名单站内路径', () => {
  const backendSource = fs.readFileSync(path.join(root, 'backend', 'server.js'), 'utf8');
  const functionStart = backendSource.indexOf('const AI_DIALOG_NAVIGATION_PATHS');
  const functionEnd = backendSource.indexOf('\n\nfunction normalizeAiMessages', functionStart);
  const functionSource = backendSource.slice(functionStart, functionEnd);
  const context = { URL };

  vm.runInNewContext(functionSource, context);

  const navigation = context.normalizeAiDialogNavigation({
    navigation_answer: '进入对应页面。',
    routes: [
      {
        title: '信号系统课程学习',
        reason: '进入课程岛屿。',
        url: 'http://127.0.0.1:3000/course?course=signals#map',
      },
      {
        title: '项目区',
        reason: '寻找项目和队友。',
        url: 'https://www.free-bbs.cn/development?q=project',
      },
      {
        title: '管理页',
        reason: '不应保存。',
        url: 'https://example.test/admin',
      },
    ],
  });

  assert.equal(navigation.navigation_answer, '进入对应页面。');
  assert.deepEqual(
    Array.from(navigation.routes, (route) => ({ ...route })),
    [
      {
        title: '信号系统课程学习',
        reason: '进入课程岛屿。',
        url: '/course?course=signals#map',
      },
      {
        title: '项目区',
        reason: '寻找项目和队友。',
        url: '/development?q=project',
      },
    ],
  );
});

test('Navigation 接受 Agent 内部域名，但只保留白名单站内路径', () => {
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
      'http://127.0.0.1:3000/course?course=signals'
    );\nrejected = normalizeMaxNavigationUrl('http://127.0.0.1:3000/admin');`,
    context,
  );

  assert.equal(context.normalized, '/course?course=signals');
  assert.equal(context.rejected, '');
});

test('课程名与 RAG 课程上下文会细化课程和讨论入口，泛化请求保持总入口', async () => {
  const appSource = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
  const functionStart = appSource.indexOf('function normalizeCourseMention');
  const functionEnd = appSource.indexOf('\n\nfunction infoResultItems', functionStart);
  const functionSource = appSource.slice(functionStart, functionEnd);
  const context = {
    userState: { token: 'test-token' },
    callApi: async () => ({
      courses: [
        { slug: 'signals', name: '信号系统', code: 'Signals and Systems', boardSlug: 'signal' },
      ],
    }),
  };
  vm.runInNewContext(functionSource, context);

  const namedCourse = await context.addMentionedCourseMapRoute(
    { routes: [{ intent: 'course_graph', module: 'course_graph', url: '/course' }] },
    '我想学习信号与系统课程',
  );
  assert.equal(namedCourse.routes[0].url, '/course?course=signals');

  const ragCourse = await context.addMentionedCourseMapRoute(
    {
      routes: [{ intent: 'knowledge_search', module: 'knowledge_rag', url: '/knowledge' }],
      subagent: {
        course: { slug: 'signals', name: '信号系统', board: 'signal' },
      },
    },
    '帮我理解傅里叶变换',
  );
  assert.equal(ragCourse.routes[0].url, '/course?course=signals');

  const namedDiscussion = await context.addMentionedCourseMapRoute(
    { routes: [{ intent: 'course_discussion', url: '/discussion' }] },
    '去信号与系统讨论区',
  );
  assert.equal(namedDiscussion.routes[0].url, '/discussion?board=signal');

  const generic = { routes: [{ intent: 'course_graph', url: '/course' }] };
  assert.equal(await context.addMentionedCourseMapRoute(generic, '带我去课程学习'), generic);
});
