// One isolated origin: the full Max tour plus authoring-demo learning tools.
const { createOnboardingPreview } = require('./preview-onboarding');
const { createLearningFixture } = require('./preview-learning-workspace');
const { listenAllowedLoopback } = require('./fixtures/allowed-loopback');

function createCompleteLearningPreview(options = {}) {
  const preview = createOnboardingPreview({
    ...options,
    learningFixture: createLearningFixture(),
    transformHtml(html, route) {
      const page = html
        .replace(
          '<summary>Max 新手导览实验 · 本地模拟 · 未发布</summary>',
          '<summary>完整学习与 Max 导引预览 · 本地内存 · 模拟 AI</summary>',
        )
        .replace(
          '</body>',
          '<p data-learning-complete-notice style="margin:12px;font:14px/1.5 system-ui">信号与系统使用作者演示包：长正文、章节/知识点关系、批注、练习与正式演示自测共用本地记录。题目不是正式课程审核内容；Max 回答为模拟，不连接真实 AI。未预置上传附件，资料列表为空；数据仅在本地内存中保存，服务重启会清空。<a href="/world">学习世界</a> · <a href="/course?course=signals">信号与系统目录</a> · <a href="/guide">Max 新手导引</a></p></body>',
        );
      return options.transformHtml ? options.transformHtml(page, route) : page;
    },
  });
  // Public lists intentionally omit authentication, as the real resource API
  // does. No uploads are seeded in this lab; unknown courses still return 404.
  const [handlePreviewRequest] = preview.server.listeners('request');
  preview.server.removeListener('request', handlePreviewRequest);
  preview.server.on('request', (req, res) => {
    const files = /^\/api\/course-upload\/public\/courses\/([^/]+)\/files$/.exec(
      req.url.split('?')[0],
    );
    if (!files) return handlePreviewRequest(req, res);
    const host = `127.0.0.1:${preview.server.address()?.port}`;
    let status = 200;
    let body = { files: [] };
    if (
      req.headers.host !== host ||
      (req.headers.origin && req.headers.origin !== `http://${host}`)
    ) {
      status = 403;
      body = { message: 'Loopback preview only' };
    } else if (!['GET', 'HEAD'].includes(req.method)) {
      status = 405;
      body = { message: '本地公开资料仅支持读取' };
    } else if (!['math', 'circuits', 'signals'].includes(files[1])) {
      status = 404;
      body = { message: '本地示例课程不存在' };
    }
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    return res.end(req.method === 'HEAD' ? undefined : JSON.stringify(body));
  });
  return preview;
}

async function startCompleteLearningPreview(options = {}) {
  const preview = createCompleteLearningPreview(options);
  const portSelection = await listenAllowedLoopback(preview.server);
  return { ...preview, portSelection };
}

if (require.main === module)
  startCompleteLearningPreview()
    .then((preview) => {
      console.log(
        `Complete learning preview: http://127.0.0.1:${preview.portSelection.port}/world?guideTour=1`,
      );
      console.log(
        'One demo account and memory learning store; simulated Max only; no database or external API.',
      );
      console.log(`Loopback port selection: ${JSON.stringify(preview.portSelection)}`);
    })
    .catch((error) => {
      console.error('Complete learning preview not started:', error.message);
      process.exitCode = 1;
    });

module.exports = { createCompleteLearningPreview, startCompleteLearningPreview };
