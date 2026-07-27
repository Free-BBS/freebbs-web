const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const staticServer = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

test('static server exposes the course map editor routes', () => {
  assert.match(staticServer, /\['\/course-map-editor', '\/course-map-editor\.html'\]/);
  assert.match(staticServer, /\['\/markdown-editor', '\/markdown-editor\.html'\]/);
});

test('course map pages load their dedicated controllers', () => {
  const reader = fs.readFileSync(path.join(root, 'public', 'course.html'), 'utf8');
  const editor = fs.readFileSync(path.join(root, 'public', 'course-map-editor.html'), 'utf8');
  const markdownEditor = fs.readFileSync(path.join(root, 'public', 'markdown-editor.html'), 'utf8');

  assert.match(reader, /data-course-map-page/);
  assert.match(reader, /<script src="\/course-map\.js"><\/script>/);
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
  assert.match(controller, /addEventListener\('pointermove'/);
  assert.match(controller, /queuePositionSave/);
  assert.match(controller, /map\/background/);
  assert.match(styles, /\.course-map-editor-immersive/);
  assert.match(styles, /\.course-map-beacon/);
  assert.match(backend, /GET, POST, PUT, PATCH, DELETE, OPTIONS/);
});

test('knowledge page uses database-backed knowledge controller', () => {
  const knowledge = fs.readFileSync(path.join(root, 'public', 'knowledge.html'), 'utf8');
  assert.match(knowledge, /<script src="\/knowledge\.js"><\/script>/);
  assert.doesNotMatch(knowledge, /<script src="\/course-data\.js"><\/script>/);
});
