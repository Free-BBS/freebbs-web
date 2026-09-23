const { StringDecoder } = require('string_decoder');

const MAX_STREAM_BYTES = 30 * 1024 * 1024;

async function readMaxBackgroundStream(upstream, { onImageGeneration } = {}) {
  if (!upstream?.body) throw new Error('Max 没有返回进度数据。');
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  let bytes = 0;
  let result = null;

  for await (const chunk of upstream.body) {
    bytes += chunk.length;
    if (bytes > MAX_STREAM_BYTES) throw new Error('Max 图片响应过大，请调整描述后重试。');
    buffer += decoder.write(Buffer.from(chunk));
    let separator = buffer.match(/\r?\n\r?\n/);
    while (separator) {
      const frame = buffer.slice(0, separator.index);
      buffer = buffer.slice(separator.index + separator[0].length);
      const data = frame
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /, ''))
        .join('\n');
      if (data) {
        let event;
        try {
          event = JSON.parse(data);
        } catch {
          throw new Error('Max 进度响应格式无效。');
        }
        if (event.error) throw new Error(event.error.message || 'Max 生成失败，请重试。');
        if (event.status === 'image_generating') await onImageGeneration?.();
        if (event.done === true) {
          if (!event.result || typeof event.result !== 'object' || Array.isArray(event.result))
            throw new Error('Max 没有返回完整回答。');
          result = event.result;
          break;
        }
      }
      separator = buffer.match(/\r?\n\r?\n/);
    }
    if (result) break;
    if (Buffer.byteLength(buffer, 'utf8') > MAX_STREAM_BYTES) throw new Error('Max 进度响应过大。');
  }
  if (!result) throw new Error('Max 的生成过程提前中断，请重试。');
  return result;
}

module.exports = { readMaxBackgroundStream };
