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
    title: 'Max 正在构思',
    detail: 'Max 正在理解你的描述。准备好画面后，会在这里显示生成进度。',
    step: 1,
  });
  assert.equal(results.statusCopy('Max 已开始生成图片…').step, 2);
  assert.equal(results.statusCopy('图片已经生成，正在保存到对话…').step, 3);
  assert.equal(results.isGenerationPhase('image_generating'), true);
  assert.equal(results.isGenerationPhase('thinking'), false);
});

test('Ask Max and discussions load and use the image result UI', () => {
  const app = fs.readFileSync(require.resolve('../public/app'), 'utf8');
  const chat = fs.readFileSync(require.resolve('../public/aichat.html'), 'utf8');
  const discussion = fs.readFileSync(require.resolve('../public/discussion.html'), 'utf8');
  assert.match(chat, /max-image-results\.js/);
  assert.match(chat, /max-tetris\.js/);
  assert.match(discussion, /max-image-results\.js/);
  assert.match(app, /FreeBbsMaxImageResults\.showProgress/);
  assert.match(app, /FreeBbsMaxImageResults\?\.finish/);
  assert.match(app, /Max 正在思考…/);
  assert.match(resultsSource(), /图片未能加载/);
  assert.match(resultsSource(), /image\.addEventListener\('error', markUnavailable\)/);
  assert.match(resultsSource(), /重新加载/);
});

test('settings exposes persistent email notification preferences', () => {
  const html = fs.readFileSync(require.resolve('../public/settings.html'), 'utf8');
  const controller = fs.readFileSync(
    require.resolve('../public/settings-notification-preferences'),
    'utf8',
  );
  assert.match(html, /settings-notification-form/);
  assert.match(html, /data-notification-preference="weeklyDigest"/);
  assert.match(controller, /notifications\/email-preferences/);
  assert.match(controller, /method: 'PATCH'/);
});

function resultsSource() {
  return fs.readFileSync(require.resolve('../public/max-image-results'), 'utf8');
}
