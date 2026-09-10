/* Circuit chat streams presentation updates; only a complete result can propose actions. */
(function circuitChatModule(root) {
  function failure(payload = {}, status = 502) {
    if (!payload || typeof payload !== 'object') return failure({}, status);
    const code = Number.isInteger(payload.status) ? payload.status : status;
    const fallback =
      {
        401: '登录已失效，请重新登录。',
        403: '请求被拒绝，请检查当前账号权限。',
        413: '请求内容过大，请缩小电路或问题范围后重试。',
        429: '请求过于频繁，请稍后重试。',
        502: '服务连接失败，请稍后重试。',
        503: '服务暂时不可用，请稍后重试。',
        504: '服务器等待回答超时，请重试。',
      }[code] || `请求失败（HTTP ${code}）。`;
    const message =
      typeof payload.message === 'string' && payload.message.trim() ? payload.message : fallback;
    const detail = typeof payload.detail === 'string' ? payload.detail : '';
    return Object.assign(new Error(detail ? `${message}：${detail}` : message), {
      status: code,
      code: typeof payload.code === 'string' ? payload.code : 'request_failed',
    });
  }

  function checkResult(payload) {
    if (payload?.ok === false) throw failure(payload);
    if (
      !payload ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      typeof payload.answer !== 'string' ||
      !Array.isArray(payload.actions)
    ) {
      throw Object.assign(new Error('Max 返回了无效的完整结果，请重试。'), {
        code: 'invalid_result',
      });
    }
    return payload;
  }

  async function request({
    url,
    token,
    payload,
    signal,
    onProgress = () => {},
    fetchImpl = root.fetch.bind(root),
    timeoutMs = 360000,
    idleTimeoutMs = 60000,
  }) {
    const controller = new AbortController();
    let reader;
    let idleTimer;
    const cancel = () => controller.abort(signal.reason);
    if (signal?.aborted) cancel();
    else signal?.addEventListener('abort', cancel, { once: true });
    const timedOut = (message, code) =>
      controller.abort(Object.assign(new Error(message), { code }));
    const totalTimer = setTimeout(
      () => timedOut('等待 Max 回答超时，请重试。', 'request_timeout'),
      timeoutMs,
    );
    const touch = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(
        () => timedOut('与 Max 的连接已中断，请重试。', 'stream_idle'),
        idleTimeoutMs,
      );
    };
    const { signal: requestSignal } = controller;
    const guard = () => {
      if (requestSignal.aborted) throw requestSignal.reason;
    };
    const wait = (operation) =>
      new Promise((resolve, reject) => {
        const aborted = () => reject(requestSignal.reason);
        requestSignal.addEventListener('abort', aborted, { once: true });
        Promise.resolve(operation).then(
          (value) => {
            requestSignal.removeEventListener('abort', aborted);
            if (requestSignal.aborted) aborted();
            else resolve(value);
          },
          (error) => {
            requestSignal.removeEventListener('abort', aborted);
            reject(requestSignal.aborted ? requestSignal.reason : error);
          },
        );
        if (requestSignal.aborted) aborted();
      });
    try {
      guard();
      touch();
      const response = await wait(
        fetchImpl(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(payload),
          signal: requestSignal,
        }),
      );
      guard();
      touch();
      const streaming =
        response.ok && /\btext\/event-stream\b/i.test(response.headers.get('content-type') || '');
      if (!response.body?.getReader) {
        if (streaming) throw new Error('浏览器未能读取 Max 的流式回答，请刷新后重试。');
        const result = await wait(response.json().catch(() => ({})));
        if (!response.ok) throw failure(result, response.status);
        return checkResult(result);
      }
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let event = '';
      let data = [];
      let eventSize = 0;
      let totalSize = 0;
      let result;
      let skipLeadingLf = false;
      const dispatch = () => {
        if (!data.length) {
          event = '';
          return;
        }
        const eventName = event;
        const raw = data.join('\n');
        event = '';
        data = [];
        eventSize = 0;
        if (!['status', 'answer', 'result', 'error'].includes(eventName)) return;
        let value;
        try {
          value = JSON.parse(raw);
        } catch {
          throw new Error('Max 的流式回答格式不完整，请重试。');
        }
        if (eventName === 'error') throw failure(value);
        if (eventName === 'result') {
          result = checkResult(value);
          return;
        }
        guard();
        if (eventName === 'answer' && typeof value?.answer === 'string')
          onProgress({ type: 'answer', answer: value.answer });
        if (
          eventName === 'status' &&
          ['thinking', 'generating', 'validating'].includes(value?.phase)
        )
          onProgress({ type: 'status', phase: value.phase, message: String(value.message || '') });
        guard();
      };
      const line = (value) => {
        if (value === '') {
          dispatch();
          return;
        }
        if (value.startsWith(':')) return;
        eventSize += value.length;
        if (eventSize > 2 * 1024 * 1024) throw new Error('Max 的回答过长，请缩小任务后重试。');
        const separator = value.indexOf(':');
        const field = separator < 0 ? value : value.slice(0, separator);
        const rest = separator < 0 ? '' : value.slice(separator + 1).replace(/^ /, '');
        if (field === 'event') event = rest;
        if (field === 'data') data.push(rest);
      };
      while (true) {
        const chunk = await wait(reader.read());
        guard();
        if (!chunk.done && chunk.value?.byteLength) touch();
        totalSize += chunk.value?.byteLength || 0;
        if (totalSize > 64 * 1024 * 1024) throw new Error('Max 的回答过长，请缩小任务后重试。');
        buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
        if (buffer.length > (streaming ? 2 : 8) * 1024 * 1024)
          throw new Error('Max 的回答过长，请缩小任务后重试。');
        if (streaming) {
          if (skipLeadingLf && buffer.length) {
            if (buffer[0] === '\n') buffer = buffer.slice(1);
            skipLeadingLf = false;
          }
          for (let index = 0; index < buffer.length; index += 1) {
            if (buffer[index] !== '\n' && buffer[index] !== '\r') continue;
            const end = index + (buffer[index] === '\r' && buffer[index + 1] === '\n' ? 2 : 1);
            skipLeadingLf = buffer[index] === '\r' && end === buffer.length;
            line(buffer.slice(0, index));
            buffer = buffer.slice(end);
            index = -1;
            if (result) return result;
          }
        }
        if (chunk.done) break;
      }
      if (streaming)
        throw Object.assign(new Error('Max 的回答连接提前结束，未收到完整结果，请重试。'), {
          code: 'stream_incomplete',
        });
      let value;
      try {
        value = JSON.parse(buffer);
      } catch {
        value = {};
      }
      if (!response.ok) throw failure(value, response.status);
      return checkResult(value);
    } catch (error) {
      controller.abort(error);
      throw error;
    } finally {
      clearTimeout(totalTimer);
      clearTimeout(idleTimer);
      signal?.removeEventListener('abort', cancel);
      // Cancelling also unblocks a stalled reader without delaying the Stop button.
      if (reader) {
        Promise.resolve(reader.cancel()).catch(() => {});
        reader.releaseLock();
      }
    }
  }

  const api = { request };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CircuitChat = api;
})(typeof window !== 'undefined' ? window : globalThis);
