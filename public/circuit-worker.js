/* global importScripts */
importScripts('/circuit-engine.js');
globalThis.onmessage = (event) => {
  const { id, document, options } = event.data || {};
  try {
    const result = globalThis.FreeBbsCircuitEngine.simulate(document, options);
    globalThis.postMessage({ id, result });
  } catch (error) {
    globalThis.postMessage({
      id,
      error: error instanceof Error ? error.message : '仿真失败，请检查电路。',
    });
  }
};
