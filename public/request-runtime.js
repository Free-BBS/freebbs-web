// One deadline covers transport and response consumption in both site frontends.
(function requestRuntime(root) {
  const DEFAULT_TIMEOUT_MS = 15000;
  const SESSION_TIMEOUT_MS = 8000;
  const TRANSFER_TIMEOUT_MS = 120000;
  const LONG_OPERATION_TIMEOUT_MS = 180000;

  function validTimeout(value) {
    return Number.isFinite(value) && value > 0 ? Math.min(value, 2147483647) : null;
  }

  function timeoutFor(input, options = {}) {
    const explicit = validTimeout(options.timeoutMs);
    if (explicit !== null) return explicit;
    const path = String(input)
      .replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, '')
      .split('?')[0]
      .replace(/^\/api(?:\/development\/v1)?(?=\/)/, '');
    if (path === '/auth/me' || path === '/me') return SESSION_TIMEOUT_MS;
    // Slow operations keep their own budget; ordinary lists and job polling stay bounded.
    if (
      /^\/ai\/circuit\/(chat|recognize)$/.test(path) ||
      path === '/ai/creation-intent' ||
      path === '/workbench/schedule-planner/preview' ||
      path === '/code/run' ||
      /^\/workbench\/connectors\/[^/]+\/(probe|direct-login)$/.test(path) ||
      (/^\/workbench\/connectors\/[^/]+\/sync-runs$/.test(path) &&
        String(options.method).toUpperCase() === 'POST')
    )
      return LONG_OPERATION_TIMEOUT_MS;
    if (
      /\/uploads?(?:\/|$)/.test(path) ||
      path === '/profile/avatar' ||
      (typeof FormData !== 'undefined' && options.body instanceof FormData) ||
      (typeof Blob !== 'undefined' && options.body instanceof Blob)
    )
      return TRANSFER_TIMEOUT_MS;
    return DEFAULT_TIMEOUT_MS;
  }

  function timeoutError(timeoutMs) {
    return Object.assign(new Error('请求等待超时，请稍后重试。'), {
      name: 'TimeoutError',
      code: 'request_timeout',
      status: 0,
      timeoutMs,
    });
  }

  function abortReason(signal) {
    return signal.reason ?? new DOMException('请求已取消。', 'AbortError');
  }

  async function run(options, operation) {
    const { signal } = options;
    if (signal?.aborted) throw abortReason(signal);
    const timeoutMs = validTimeout(options.timeoutMs) ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    let rejectCancellation;
    const cancelled = new Promise((resolve, reject) => {
      rejectCancellation = reject;
    });
    const cancel = (reason) => {
      if (controller.signal.aborted) return;
      // Settle even if a fetch implementation or body reader ignores AbortSignal.
      rejectCancellation(reason);
      controller.abort(reason);
    };
    const onAbort = () => cancel(abortReason(signal));
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => cancel(timeoutError(timeoutMs)), timeoutMs);
    try {
      return await Promise.race([
        Promise.resolve().then(() => {
          if (controller.signal.aborted) throw controller.signal.reason;
          return operation(controller.signal);
        }),
        cancelled,
      ]);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  function request(input, options, consume, fetchImplementation = root.fetch.bind(root)) {
    const { timeoutMs, ...init } = options;
    return run({ signal: init.signal, timeoutMs: timeoutFor(input, options) }, async (signal) => {
      const response = await fetchImplementation(input, { ...init, signal });
      if (signal.aborted) throw signal.reason;
      return consume(response);
    });
  }

  const runtime = {
    DEFAULT_TIMEOUT_MS,
    SESSION_TIMEOUT_MS,
    TRANSFER_TIMEOUT_MS,
    LONG_OPERATION_TIMEOUT_MS,
    timeoutFor,
    run,
    request,
  };
  // The typed development adapter imports this file for its browser side effect.
  root.freeBbsRequests = runtime;
  if (typeof module !== 'undefined' && module.exports) module.exports = runtime;
})(globalThis);
