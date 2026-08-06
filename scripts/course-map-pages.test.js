const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const test = require('node:test');

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
  assert.match(reader, /<script src="\/course-map\.js"><\/script>/);
  assert.match(reader, /id="course-map-reader-title"/);
  assert.match(editor, /data-course-map-editor/);
  assert.match(editor, /id="course-map-canvas"/);
  assert.match(editor, /course-map-editor-immersive/);
  assert.match(editor, /id="course-background-panel-toggle"/);
  assert.match(editor, /id="course-map-background-input"/);
  assert.match(markdownEditor, /data-markdown-editor/);
  assert.match(markdownEditor, /id="markdown-source"/);
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

  assert.match(reader, /href="\/world" aria-label="返回学习世界"/);
  assert.match(reader, /id="course-map-reset-view"/);
  assert.match(controller, /function courseChapters\(\)/);
  assert.match(controller, /manualExpandedChapters: new Set\(\)/);
  assert.match(controller, /activeChapterId: ''/);
  assert.match(controller, /function renderDirectoryView\(viewModel\)/);
  assert.match(controller, /initialChapters\[0\]\?\.nodes\[0\]\?\.id/);
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
  assert.match(controller, /data-focus-exit/);
  assert.match(controller, /data-reader-node-id/);
  assert.match(controller, /free_bbs_current_learning_node_v1/);
  assert.match(styles, /\.course-map-chapter-card\.is-expanded/);
  assert.match(styles, /\.course-map-directory-layout/);
  assert.match(styles, /\.course-map-index-list/);
  assert.match(styles, /\.course-map-directory-current/);
  assert.match(styles, /\.course-map-chapter-card\.is-preview/);
  assert.match(styles, /\.course-map-focus-workspace/);
  assert.match(styles, /\.course-map-focus-side\.is-left/);
  assert.match(styles, /\.course-map-cross-relations\.is-incoming/);
  assert.match(styles, /\.course-map-cross-relations\.is-outgoing/);
  assert.match(styles, /\.course-map-cross-grid/);
  assert.match(styles, /\.course-map-topic\.is-focused/);
  assert.match(styles, /\.course-map-topic\.is-learning/);
});

test('knowledge page uses database-backed knowledge controller', () => {
  const knowledge = fs.readFileSync(path.join(root, 'public', 'knowledge.html'), 'utf8');
  const controller = fs.readFileSync(path.join(root, 'public', 'knowledge.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'public', 'course.css'), 'utf8');
  assert.match(knowledge, /<script src="\/knowledge\.js"><\/script>/);
  assert.match(knowledge, /id="knowledge-learn-button"/);
  assert.match(knowledge, /id="knowledge-review-button"/);
  assert.match(knowledge, /id="knowledge-course-link"/);
  assert.match(knowledge, /href="\/course\?course=signals"/);
  assert.match(knowledge, /id="knowledge-workbench"/);
  assert.match(knowledge, /id="knowledge-tools"/);
  assert.match(knowledge, /id="knowledge-panel-resizer"/);
  assert.match(knowledge, /id="knowledge-previous-link"/);
  assert.match(knowledge, /id="knowledge-next-link"/);
  assert.doesNotMatch(knowledge, /id="knowledge-route-canvas"/);
  assert.match(knowledge, /id="knowledge-chat-panel"/);
  assert.match(knowledge, /id="knowledge-chat-form"/);
  assert.match(knowledge, /id="knowledge-chat-tab-max"/);
  assert.match(knowledge, /id="knowledge-chat-tab-discussion"/);
  assert.match(knowledge, /id="knowledge-discussion-list"/);
  assert.match(knowledge, /id="knowledge-discussion-detail"/);
  assert.doesNotMatch(knowledge, /<script src="\/course-data\.js"><\/script>/);
  assert.match(controller, /free_bbs_course_progress_v1/);
  assert.match(controller, /renderMarkdownContent/);
  assert.match(controller, /createMockReply/);
  assert.match(controller, /orderedKnowledgeNodes/);
  assert.match(controller, /renderKnowledgeSequence/);
  assert.match(controller, /free_bbs_knowledge_interaction_width_v1/);
  assert.match(controller, /free_bbs_knowledge_tools_collapsed_v1/);
  assert.match(controller, /knowledge:tool-select/);
  assert.match(controller, /setInteractionWidth/);
  assert.match(controller, /loadDiscussionPosts/);
  assert.match(controller, /\/discussion\/posts\?board=/);
  assert.match(controller, /\/discussion\/posts\/\$\{encodeURIComponent\(postId\)\}/);
  assert.match(styles, /\.knowledge-workbench\.is-interaction-open/);
  assert.match(styles, /\.knowledge-panel-resizer/);
  assert.match(styles, /\.knowledge-sequence-navigation/);
});
