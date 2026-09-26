const { readAgentResponse } = require('./circuit-assistant');

function createFrontendToolGenerator({ postAgentChat, buildAgentChatPayload }) {
  return async ({ user, prompt, currentHtml, signal, onReasoning, onProgress, onHtml }) => {
    const instruction = [
      '你是 FREE-BBS 小工具工坊的前端制作助手。',
      '最终回答只返回一个完整、可独立运行的单文件 HTML，不要使用 Markdown 代码围栏或解释文字。',
      '把 CSS 和 JavaScript 全部内联；不得引用外部网络资源，不得收集个人信息，不得提交表单或打开新窗口。',
      '界面需适配手机与桌面，具备清楚的标签、键盘焦点与必要的空状态。',
      '预览在不含 allow-same-origin 的 iframe 沙盒中运行；localStorage 等持久化 API 可能不可用，必须捕获异常并回退到内存状态，不能因此导致工具无法使用。',
      currentHtml
        ? `请在下面现有 HTML 基础上修改，保留仍然符合要求的功能：\n${currentHtml}`
        : '请从零制作。',
      `用户需求：${prompt}`,
    ].join('\n\n');
    const payload = buildAgentChatPayload(
      user,
      {
        messages: [{ role: 'user', content: instruction }],
        stream: true,
        reasoning_stream: true,
        temperature: 0.35,
      },
      { agent: 'general_chat', source: 'tool_workshop', channel: 'tool_workshop' },
    );
    const upstream = await postAgentChat(payload, user, { signal });
    let emittedCharacters = 0;
    const result = await readAgentResponse(upstream, {
      signal,
      onReasoning,
      onProgress: (answer) => {
        onHtml?.(answer.slice(emittedCharacters));
        emittedCharacters = answer.length;
        onProgress?.(answer.length);
      },
      onActivity: () => {},
    });
    return result.answer || result.result?.answer || result.content || '';
  };
}

module.exports = { createFrontendToolGenerator };
