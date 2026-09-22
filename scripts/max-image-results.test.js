const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const results = require('../public/max-image-results');

test('explicit image requests enter the dedicated generation state', () => {
  for (const request of [
    '生成一张羊吃草的卡通图片',
    '帮我画一幅横版插画',
    'Create a poster of a radio telescope',
  ]) {
    assert.equal(results.isRequest(request), true, request);
  }
  assert.equal(results.isRequest('图片生成模型是什么？'), false);
  assert.equal(results.isRequest('不要生成图片，只解释原理'), false);
});

test('image generation status uses clear progressive copy', () => {
  assert.deepEqual(results.statusCopy('Max 正在后台思考…'), {
    title: '正在生成图片',
    detail: 'Max 已开始绘制。通常需要 20–60 秒，可以离开页面，完成后会保存在对话里。',
    step: 2,
  });
  assert.equal(results.statusCopy('图片已经生成，正在保存到对话…').step, 3);
});

test('Ask Max and discussions load and use the image result UI', () => {
  const app = fs.readFileSync(require.resolve('../public/app'), 'utf8');
  const chat = fs.readFileSync(require.resolve('../public/aichat.html'), 'utf8');
  const discussion = fs.readFileSync(require.resolve('../public/discussion.html'), 'utf8');
  assert.match(chat, /max-image-results\.js/);
  assert.match(discussion, /max-image-results\.js/);
  assert.match(app, /FreeBbsMaxImageResults\.showProgress/);
  assert.match(app, /FreeBbsMaxImageResults\?\.finish/);
  assert.match(app, /Max 已开始生成图片/);
});
