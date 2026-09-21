const crypto = require('node:crypto');
const { gzipSync } = require('node:zlib');
const compressed = new Map();

function sendStatic(response, body, headers) {
  const request = response.req;
  const data = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const etag = `W/"${crypto.createHash('sha256').update(data).digest('base64url')}"`;
  const outputHeaders = { ...headers, ETag: etag, Vary: 'Accept-Encoding' };
  const matches = String(request.headers['if-none-match'] || '')
    .split(',')
    .map((s) => s.trim());
  if (
    ['GET', 'HEAD'].includes(request.method) &&
    (matches.includes(etag) || matches.includes('*'))
  ) {
    response.writeHead(304, outputHeaders);
    response.end();
    return;
  }
  const acceptsGzip = String(request.headers['accept-encoding'] || '')
    .split(',')
    .some((value) => {
      const [encoding, ...parameters] = value.trim().split(';');
      return (
        encoding === 'gzip' &&
        !parameters.some((parameter) => /^\s*q=0(?:\.0*)?\s*$/.test(parameter))
      );
    });
  let output = data;
  if (
    acceptsGzip &&
    data.length > 1024 &&
    /text\/|javascript|json|svg/.test(headers['Content-Type'])
  ) {
    if (!compressed.has(etag)) {
      if (compressed.size >= 64) compressed.delete(compressed.keys().next().value);
      compressed.set(etag, gzipSync(data));
    }
    output = compressed.get(etag);
    outputHeaders['Content-Encoding'] = 'gzip';
  }
  outputHeaders['Content-Length'] = output.length;
  response.writeHead(200, outputHeaders);
  response.end(request.method === 'HEAD' ? undefined : output);
}
module.exports = { sendStatic };
