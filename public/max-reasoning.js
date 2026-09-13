((root) => {
  const states = new WeakMap();
  function update(article, { id = '1', delta } = {}) {
    if (!article || typeof delta !== 'string' || !delta) return;
    let state = states.get(article);
    if (!state) {
      const panel = document.createElement('details');
      panel.className = 'max-reasoning';
      panel.open = true;
      const summary = document.createElement('summary');
      summary.textContent = '正在思考…';
      const body = document.createElement('div');
      body.className = 'max-reasoning-content';
      body.setAttribute('aria-label', 'Max 思考内容');
      panel.append(summary, body);
      const answer = article.querySelector('.circuit-ai-message-body, .aichat-bubble');
      if (answer) answer.before(panel);
      else article.append(panel);
      state = { panel, summary, body, parts: new Map(), size: 0, started: Date.now() };
      states.set(article, state);
    }
    if (state.size >= 64000) return;
    const text = delta.slice(0, 64000 - state.size);
    state.size += text.length;
    let part = state.parts.get(id);
    if (!part) {
      if (state.parts.size >= 32) return;
      part = document.createElement('p');
      part.className = 'max-reasoning-part';
      state.parts.set(id, part);
      state.body.append(part);
    }
    const following = state.body.scrollHeight - state.body.scrollTop - state.body.clientHeight < 48;
    // Provider reasoning is display-only text, never Markdown, HTML or executable actions.
    part.append(document.createTextNode(text));
    if (following) state.body.scrollTop = state.body.scrollHeight;
  }
  function finish(article, { stopped = false } = {}) {
    const state = states.get(article);
    if (!state || state.finished) return;
    state.finished = true;
    state.summary.textContent = stopped ? '思考已停止' : '思考完成';
    state.panel.open = false;
  }
  async function request({
    url,
    token,
    payload,
    onReasoning = () => {},
    fetchImpl = root.fetch.bind(root),
    signal,
    timeoutMs = 300000,
  }) {
    const controller = new AbortController();
    const cancel = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    const timer = setTimeout(
      () => controller.abort(new Error('等待 Max 回答超时，请重试。')),
      timeoutMs,
    );
    let reader;
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ...payload, stream: true, reasoning_stream: true }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(
          data.message || data.error?.message || `请求失败（HTTP ${response.status}）`,
        );
      }
      if (!response.body) throw new Error('浏览器不支持流式回答。');
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let data = [];
      let bytes = 0;
      let skipLf = false;
      let result;
      const dispatch = () => {
        if (!data.length) return;
        const event = JSON.parse(data.join('\n'));
        data = [];
        if (event.error) throw new Error(event.error.message || 'Max 回答失败，请重试。');
        if (typeof event.reasoning_delta === 'string')
          onReasoning({ id: String(event.reasoning_id || '1'), delta: event.reasoning_delta });
        if (event.done === true) {
          if (!event.result || typeof event.result.answer !== 'string')
            throw new Error('未收到完整的 Max 回答，请重试。');
          result = event.result;
        }
      };
      while (!result) {
        controller.signal.throwIfAborted();
        const { done, value } = await reader.read();
        controller.signal.throwIfAborted();
        if (done) throw new Error('Max 回答连接中断，请重试。');
        bytes += value.byteLength;
        if (bytes > 4 * 1024 * 1024) throw new Error('Max 回答过长，请缩小问题范围。');
        buffer += decoder.decode(value, { stream: true });
        if (skipLf && buffer.length) {
          if (buffer[0] === '\n') buffer = buffer.slice(1);
          skipLf = false;
        }
        for (let match = /\r\n|\r|\n/.exec(buffer); match; match = /\r\n|\r|\n/.exec(buffer)) {
          skipLf = match[0] === '\r' && match.index === buffer.length - 1;
          const line = buffer.slice(0, match.index);
          buffer = buffer.slice(match.index + match[0].length);
          if (!line) dispatch();
          else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
          if (result) break;
        }
      }
      return result;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      await reader?.cancel().catch(() => {});
      controller.abort();
    }
  }
  const api = { update, finish, request };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FreeBbsReasoning = api;
})(typeof window === 'object' ? window : globalThis);
