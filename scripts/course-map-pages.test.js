const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const staticServer = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : null;
      probe.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function waitForServer(url, child) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Static server exited with code ${child.exitCode}`);
    }

    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });
    }
  }

  throw new Error(`Static server did not start at ${url}`);
}

test('static server exposes the course map editor routes', () => {
  assert.match(staticServer, /\['\/course-map-editor', '\/course-map-editor\.html'\]/);
  assert.match(staticServer, /\['\/markdown-editor', '\/markdown-editor\.html'\]/);
});

test('static server serves browser vendor assets on Windows-style paths', async (t) => {
  const port = await getAvailablePort();
  const child = childProcess.spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) },
    stdio: 'ignore',
  });

  t.after(() => child.kill());
  await waitForServer(`http://127.0.0.1:${port}/knowledge`, child);

  for (const assetPath of [
    '/vendor/marked/lib/marked.umd.js',
    '/vendor/katex/dist/katex.min.js',
    '/vendor/katex/dist/contrib/auto-render.min.js',
    '/vendor/@highlightjs/cdn-assets/highlight.min.js',
  ]) {
    const response = await fetch(`http://127.0.0.1:${port}${assetPath}`);
    assert.equal(response.status, 200, assetPath);
    assert.match(response.headers.get('content-type') || '', /javascript/);
  }
});

test('course map pages load their dedicated controllers', () => {
  const reader = fs.readFileSync(path.join(root, 'public', 'course.html'), 'utf8');
  const editor = fs.readFileSync(path.join(root, 'public', 'course-map-editor.html'), 'utf8');
  const markdownEditor = fs.readFileSync(path.join(root, 'public', 'markdown-editor.html'), 'utf8');

  assert.match(reader, /data-course-map-page/);
  assert.match(reader, /<script src="\/course-map\.js\?v=[A-Za-z0-9-]+"><\/script>/);
  assert.doesNotMatch(reader, /course-map-reader-hud/);
  assert.doesNotMatch(reader, /course-map-reader-title/);
  assert.doesNotMatch(reader, /course-map-reader-meta/);
  assert.match(editor, /data-course-map-editor/);
  assert.match(editor, /id="course-map-canvas"/);
  assert.match(editor, /course-map-editor-immersive/);
  assert.match(editor, /id="course-background-panel-toggle"/);
  assert.match(editor, /id="course-map-background-input"/);
  assert.match(markdownEditor, /data-markdown-editor/);
  assert.match(markdownEditor, /id="markdown-source"/);
  assert.match(markdownEditor, /data-markdown-section="knowledgeMarkdown"/);
  assert.match(markdownEditor, /data-markdown-section="basicInfoMarkdown"/);
  assert.match(markdownEditor, /data-markdown-section="applicationsMarkdown"/);
  assert.match(markdownEditor, /vendor\/katex/);
});

test('course map controller supports holographic nodes, dragging, and persisted backgrounds', () => {
  const controller = fs.readFileSync(path.join(root, 'public', 'course-map.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'public', 'course.css'), 'utf8');
  const backend = fs.readFileSync(path.join(root, 'backend', 'server.js'), 'utf8');

  assert.match(controller, /course-map-hologram/);
  assert.match(controller, /course-map-beacon/);
  assert.match(controller, /course-map-edge-pulse/);
  assert.match(controller, /orderedNodeSequence/);
  assert.match(controller, /readerGraphLayout/);
  assert.match(controller, /displayPosition/);
  assert.match(controller, /addEventListener\('pointermove'/);
  assert.match(controller, /queuePositionSave/);
  assert.match(controller, /map\/background/);
  assert.match(styles, /\.course-map-editor-immersive/);
  assert.match(styles, /\.course-map-beacon/);
  assert.match(backend, /GET, POST, PUT, PATCH, DELETE, OPTIONS/);
});

test('course map reader groups nodes by chapter and reveals only focused relations', () => {
  const reader = fs.readFileSync(path.join(root, 'public', 'course.html'), 'utf8');
  const controller = fs.readFileSync(path.join(root, 'public', 'course-map.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'public', 'course.css'), 'utf8');
  const backend = fs.readFileSync(path.join(root, 'backend', 'course-maps.js'), 'utf8');

  assert.match(reader, /id="course-map-directory-link"/);
  assert.match(reader, /href="\/world"/);
  assert.match(reader, /aria-label="返回学习世界"/);
  assert.match(reader, /id="course-map-reset-view"/);
  assert.match(controller, /function courseChapters\(\)/);
  assert.match(controller, /manualExpandedChapters: new Set\(\)/);
  assert.match(controller, /activeChapterId: ''/);
  assert.match(controller, /function renderDirectoryView\(viewModel\)/);
  assert.match(controller, /const primaryNode = learningNode \|\| activeChapter\.nodes\[0\]/);
  assert.match(controller, /focusedEdges = state\.focusedNodeId/);
  assert.match(controller, /previewNodesByChapter = new Map\(\)/);
  assert.match(controller, /sameChapterNeighborNodes/);
  assert.match(controller, /sameChapterIncomingNodes/);
  assert.match(controller, /sameChapterOutgoingNodes/);
  assert.match(controller, /crossIncomingNodesByChapter/);
  assert.match(controller, /crossOutgoingNodesByChapter/);
  assert.match(controller, /const isIncoming = edge\.target === state\.focusedNodeId/);
  assert.match(controller, /function renderCrossRelations\(direction/);
  assert.doesNotMatch(controller, /returnToPreviousLevel/);
  assert.doesNotMatch(controller, /course-map-chapter-grid is-focus-rest/);
  assert.match(controller, /fullExpandedChapters/);
  assert.match(controller, /data-chapter-toggle/);
  assert.match(controller, /data-preview-close/);
  assert.doesNotMatch(controller, /data-focus-exit/);
  assert.match(controller, /data-reader-node-id/);
  assert.match(controller, /function courseDirectoryHref\(\)/);
  assert.match(controller, /const returnToDirectory = Boolean\(state\.focusedNodeId\)/);
  assert.match(
    controller,
    /directoryLink\.href = returnToDirectory \? courseDirectoryHref\(\) : '\/world'/,
  );
  assert.match(
    controller,
    /overviewDrawer\.open\(nodeById\(id\), state.course, topicButton, focusNode\)/,
  );
  assert.match(controller, /点击知识点查看学习概览/);
  assert.match(backend, /const EDGE_TYPES = new Set\(\['ordered', 'related'\]\)/);
  assert.match(controller, /两类知识点连接/);
  assert.match(controller, /课程学习顺序 · A → B/);
  assert.match(controller, /补充关联 · A — B/);
  assert.doesNotMatch(controller, /6类设定的知识点关系/);
  assert.doesNotMatch(controller, /<dt>(?:前置|推导|应用|推广|对比|等价) · A/);
  assert.doesNotMatch(controller, /当前节点的全部连线/);
  assert.match(controller, /function readerEdgeDescription\(edge\)/);
  assert.match(controller, /course-map-reader-edge-hits/);
  assert.match(controller, /data-edge-tooltip/);
  assert.match(styles, /\.course-map-edge-hit/);
  assert.match(styles, /\.course-map-edge-tooltip/);
  assert.match(
    styles,
    /body:not\(\.world-page\)\s+\.course-map-immersive[\s\S]*?\.course-map-focus-arrow-help-panel\s+\*[\s\S]*?font-family: var\(--course-map-font-body\) !important;/,
  );
  assert.match(controller, /free_bbs_current_learning_node_v1/);
  assert.match(controller, /const KNOWLEDGE_TAGS =/);
  assert.match(controller, /function renderNodeTags\(nodeId\)/);
  assert.match(controller, /function renderDirectoryNodeTags\(nodeId\)/);
  assert.match(controller, /remainingNodes\.map\(\(node\) => renderReaderNode/);
  assert.doesNotMatch(controller, /is-knowledge-map/);
  assert.doesNotMatch(controller, /course-reader-study-link/);
  assert.match(controller, /course-map-topic-tags/);
  assert.doesNotMatch(controller, /course-map-topic-detail/);
  assert.match(styles, /\.course-map-chapter-card\.is-expanded/);
  assert.match(styles, /\.course-map-directory-layout/);
  assert.match(styles, /padding: 84px clamp\(28px, 4vw, 68px\) 86px/);
  assert.match(styles, /\.course-map-index-list/);
  assert.match(styles, /\.course-map-directory-current/);
  assert.match(styles, /\.course-map-chapter-card\.is-preview/);
  assert.match(styles, /\.course-map-focus-workspace/);
  assert.match(styles, /padding: 88px clamp\(32px, 6vw, 92px\) 36px/);
  assert.match(styles, /\.course-map-focus-side\.is-left/);
  assert.match(styles, /\.course-map-cross-relations\.is-incoming/);
  assert.match(styles, /\.course-map-cross-relations\.is-outgoing/);
  assert.match(styles, /\.course-map-cross-grid/);
  assert.match(styles, /\.course-map-topic\.is-focused/);
  assert.match(styles, /\.course-map-topic\.is-learning/);
  assert.match(styles, /\.course-map-topic-tags/);
  assert.match(styles, /\.course-map-topic-tag\.is-important/);
  assert.match(styles, /\.course-map-topic-tag\.is-learned/);
  assert.match(styles, /\.course-map-topic-tag\.is-consolidated/);
  assert.match(styles, /\.course-map-directory-current-tags/);
  assert.doesNotMatch(styles, /\.course-map-topic-detail/);
});

// Actual production functions, with only their API/storage/render boundary stubbed.
// This is a memory contract, not a browser or database test.
async function initializeReaderFixture({ current = {}, progress = {}, focus = '', nodes } = {}) {
  const source = fs.readFileSync(path.join(root, 'public/course-map.js'), 'utf8');
  const section = (start, end) => {
    const first = source.indexOf(start);
    const last = source.indexOf(end, first);
    assert.ok(first >= 0 && last > first, `Production function boundaries: ${start}`);
    return source.slice(first, last);
  };
  const inputNodes = nodes || [
    { id: 'SS-01-00', title: '真正的第一章' },
    { id: 'SS-01-01', title: '第一点' },
    { id: 'SS-02-00', title: '真正的第二章' },
    { id: 'SS-02-01', title: '第二章第一点' },
    { id: 'SS-02-02', title: '第二章第二点' },
  ];
  const currentBefore = JSON.stringify(current);
  const progressBefore = JSON.stringify(progress);
  const renderCalls = [];
  const statuses = [];
  const state = {
    course: null,
    nodes: [],
    edges: [],
    progress: {},
    learningNodeId: '',
    focusedNodeId: '',
    activeChapterId: '',
    readerLayout: 'directory',
    manualExpandedChapters: new Set(),
    manuallyCollapsedChapters: new Set(),
  };
  const context = {
    state,
    courseSlug: 'signals',
    params: new URLSearchParams({ focus }),
    PROGRESS_STORAGE_KEY: 'progress',
    CURRENT_LEARNING_STORAGE_KEY: 'current',
    mapPage: {},
    editorPage: null,
    URLSearchParams,
    window: { FreeBbsLearningContent: require('../public/learning-content') },
    app: {
      sessionReady: Promise.resolve(),
      callApi: async (endpoint, options) => {
        assert.equal(endpoint, '/courses/signals/map');
        assert.equal(options.method, 'GET');
        return { course: { slug: 'signals', name: '信号与系统' }, nodes: inputNodes, edges: [] };
      },
    },
    readLocalJson: (key) => (key === 'current' ? current : progress),
    renderReaderHeader() {},
    bindReaderViewport() {},
    setSaveState() {},
    setStatus: (message, error) => statuses.push({ message, error }),
    renderChapterIndex: () => '',
    renderDirectoryNodeTags: () => '',
    renderReaderNode: () => '',
    renderMap: () => {
      renderCalls.push('render');
      state.structureController = {
        selectChapter: (id) => renderCalls.push(['selectChapter', id]),
      };
    },
  };
  vm.runInNewContext(
    [
      section('  function escapeHtml(', '  function setStatus('),
      section('  function nodeById(', '  function knowledgeHref('),
      section('  function getLearningNodeId(', '  function getNodeTags('),
      section('  function chapterIdForNodeId(', '  function renderReaderNode('),
      section('  function renderDirectoryView(', '  function renderFocusedChapter('),
      section('  async function initialize()', '\n  initialize();'),
      'globalThis.readerFixture = { initialize, directory: () => renderDirectoryView(readerViewModel()) };',
    ].join('\n'),
    context,
  );
  await context.readerFixture.initialize();
  assert.equal(
    statuses.some((item) => item.error),
    false,
    JSON.stringify(statuses),
  );
  assert.equal(
    JSON.stringify(current),
    currentBefore,
    'Initialization must not fabricate stored current history',
  );
  assert.equal(
    JSON.stringify(progress),
    progressBefore,
    'Initialization must not mutate progress evidence',
  );
  return { state, renderCalls, html: context.readerFixture.directory() };
}

test('production reader initialize keeps a fresh first-point entry without claiming previous learning', async () => {
  const h = await initializeReaderFixture();
  assert.equal(h.state.learningNodeId, '');
  assert.equal(h.state.activeChapterId, 'SS-01');
  assert.match(h.html, /从这里开始/);
  assert.match(h.html, /data-reader-node-id="SS-01-01"/);
  assert.doesNotMatch(h.html, /继续学习|上次学习位置/);
});

test('production reader initialize retains only an existing current or actual review record as resume', async () => {
  for (const input of [
    { current: { signals: 'SS-02-01' } },
    {
      progress: {
        signals: {
          'SS-01-01': { status: 'review', updatedAt: '2026-10-08' },
          'SS-02-01': { status: 'review', updatedAt: '2026-10-10' },
        },
      },
    },
  ]) {
    const h = await initializeReaderFixture(input);
    assert.equal(h.state.learningNodeId, 'SS-02-01');
    assert.equal(h.state.activeChapterId, 'SS-02');
    assert.match(h.html, /继续学习/);
    assert.match(h.html, /已为你定位到上次学习位置/);
    assert.match(h.html, /data-reader-node-id="SS-02-01"/);
  }
  for (const current of [{ another: 'SS-02-01' }, { signals: 'SS-99-01' }]) {
    const h = await initializeReaderFixture({ current });
    assert.equal(h.state.learningNodeId, '');
    assert.doesNotMatch(h.html, /上次学习位置/);
  }
});

test('production reader zero-level focus selects its real chapter only after render without point focus or expansion', async () => {
  const h = await initializeReaderFixture({ focus: 'SS-02-00' });
  assert.equal(h.state.activeChapterId, 'SS-02');
  assert.equal(h.state.focusedNodeId, '');
  assert.equal(h.state.readerLayout, 'structure');
  assert.equal(h.state.manualExpandedChapters.size, 0);
  assert.deepEqual(h.renderCalls, ['render', ['selectChapter', 'SS-02']]);
  assert.match(h.html, /id="course-map-directory-title">真正的第二章/);
});

test('production directory uses published point chapter names when zero-level overviews are absent or unnamed', async () => {
  const h = await initializeReaderFixture({
    nodes: [
      { id: 'SS-01-00', title: '第1章' },
      { id: 'SS-01-01', title: '信号', chapterTitle: '信号的基本性质' },
      { id: 'SS-02-01', title: '卷积', chapterTitle: '连续系统时域分析' },
    ],
  });
  assert.match(h.html, /id="course-map-directory-title">信号的基本性质/);
  assert.doesNotMatch(h.html, />第1章</);
  const missing = await initializeReaderFixture({
    nodes: [{ id: 'SS-01-01', title: '不能据此虚构整章名字', chapterTitle: '第1章' }],
  });
  assert.match(missing.html, /id="course-map-directory-title">SS-01/);
  assert.doesNotMatch(missing.html, /id="course-map-directory-title">信号与系统基础/);
});

test('production reader normal-point focus and unknown focus retain their bounded previous contracts', async () => {
  const focused = await initializeReaderFixture({ focus: 'SS-02-01' });
  assert.equal(focused.state.focusedNodeId, 'SS-02-01');
  assert.equal(focused.state.activeChapterId, 'SS-02');
  assert.equal(focused.state.readerLayout, 'structure');
  assert.deepEqual(focused.renderCalls, ['render']);
  for (const focus of ['SS-99-01', 'SS-99-00', '../SS-02-00', '']) {
    const h = await initializeReaderFixture({ focus });
    assert.equal(h.state.focusedNodeId, '');
    assert.equal(h.state.activeChapterId, 'SS-01');
    assert.deepEqual(h.renderCalls, ['render']);
  }
});

test('knowledge page uses database-backed knowledge controller', () => {
  const knowledge = fs.readFileSync(path.join(root, 'public', 'knowledge.html'), 'utf8');
  const controller = fs.readFileSync(path.join(root, 'public', 'knowledge.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'public', 'course.css'), 'utf8');
  assert.match(knowledge, /<script src="\/knowledge\.js\?v=[A-Za-z0-9-]+"><\/script>/);
  assert.doesNotMatch(knowledge, /id="knowledge-learn-button"/);
  assert.doesNotMatch(knowledge, /id="knowledge-review-button"/);
  assert.match(knowledge, /id="knowledge-tag-title"/);
  assert.match(knowledge, /data-knowledge-tag="important"/);
  assert.match(knowledge, /data-knowledge-tag="learned"/);
  assert.match(knowledge, /data-knowledge-tag="consolidated"/);
  assert.match(knowledge, /id="knowledge-course-link"/);
  assert.match(knowledge, /href="\/course\?course=signals"/);
  assert.match(knowledge, /id="knowledge-workbench"/);
  assert.match(knowledge, /id="knowledge-tools"/);
  assert.match(knowledge, /id="knowledge-panel-resizer"/);
  assert.match(knowledge, /id="knowledge-previous-link"/);
  assert.match(knowledge, /id="knowledge-next-link"/);
  assert.match(knowledge, /id="knowledge-basic-info-card"/);
  assert.match(knowledge, /id="knowledge-applications-card"/);
  assert.match(knowledge, /id="knowledge-overview"/);
  assert.match(knowledge, /id="knowledge-start-reading"/);
  assert.match(knowledge, /id="knowledge-reading"/);
  assert.doesNotMatch(knowledge, /id="knowledge-route-canvas"/);
  assert.match(knowledge, /id="knowledge-chat-panel"/);
  assert.match(knowledge, /id="knowledge-chat-form"/);
  assert.match(knowledge, /id="knowledge-chat-tab-max"/);
  assert.match(knowledge, /id="knowledge-chat-tab-discussion"/);
  assert.match(knowledge, /id="knowledge-discussion-list"/);
  assert.match(knowledge, /id="knowledge-discussion-detail"/);
  assert.doesNotMatch(knowledge, /<script src="\/course-data\.js"><\/script>/);
  assert.match(controller, /free_bbs_course_progress_v1/);
  assert.match(controller, /free_bbs_current_learning_node_v1/);
  assert.match(controller, /const KNOWLEDGE_TAGS =/);
  assert.match(controller, /function toggleKnowledgeTag\(tagKey\)/);
  assert.match(controller, /tagKey === 'consolidated'/);
  assert.match(controller, /tagKey === 'learned'/);
  assert.match(controller, /function saveCurrentLearningNode\(currentNodeId\)/);
  assert.match(
    controller,
    /if \(nextView === 'reading' && state\.node\) saveCurrentLearningNode\(state\.node\.id\)/,
  );
  assert.match(controller, /renderMarkdownContent/);
  assert.match(controller, /sections\.knowledgeMarkdown/);
  assert.match(controller, /function setKnowledgeView\(view/);
  assert.match(controller, /view: params.get\('view'\) === 'overview' \? 'overview' : 'reading'/);
  assert.match(controller, /setKnowledgeView\(state\.view\)/);
  assert.match(controller, /setKnowledgeView\('reading'/);
  assert.match(controller, /function buildKnowledgeChatRequest/);
  assert.match(controller, /app\.streamKnowledgeRagResponse/);
  assert.doesNotMatch(controller, /agent: 'rag'/);
  assert.doesNotMatch(controller, /temperature:/);
  assert.match(controller, /knowledge-chat-message-body/);
  assert.match(styles, /\.knowledge-chat-message-body/);
  assert.match(styles, /@keyframes knowledge-chat-loading-dot/);
  assert.doesNotMatch(controller, /createMockReply/);
  assert.match(controller, /FreeBbsLearningNextSteps\?\.sequenceNode/);
  assert.match(controller, /sequence\?\.\(map, \{ id: nodeId \}, 'previous'\)/);
  assert.match(controller, /sequence\?\.\(map, \{ id: nodeId \}, 'next'\)/);
  assert.match(controller, /renderKnowledgeSequence/);
  assert.match(controller, /free_bbs_knowledge_interaction_width_v1/);
  assert.match(controller, /free_bbs_knowledge_tools_collapsed_v1/);
  assert.match(controller, /knowledge:tool-select/);
  assert.match(controller, /setInteractionWidth/);
  assert.match(controller, /loadDiscussionPosts/);
  assert.match(controller, /\/discussion\/posts\?board=/);
  assert.match(controller, /\/discussion\/posts\/\$\{encodeURIComponent\(postId\)\}/);
  assert.match(styles, /\.knowledge-workbench\.is-interaction-open/);
  assert.match(styles, /\.knowledge-tag-panel/);
  assert.match(styles, /\.knowledge-tag-button\.is-important/);
  assert.match(styles, /\.knowledge-tag-button\.is-learned/);
  assert.match(styles, /\.knowledge-tag-button\.is-consolidated/);
  assert.match(styles, /\.knowledge-panel-resizer/);
  assert.match(styles, /\.knowledge-sequence-navigation/);
});
