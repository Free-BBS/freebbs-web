const net = require('node:net');

function isLoopback(address) {
  const value = String(address || '').toLowerCase();
  return value === '::1' || value === '0:0:0:0:0:0:0:1' || /^(?:::ffff:)?127\./.test(value);
}

function clientIpForBackend(request) {
  const peer = String(request.socket?.remoteAddress || '');
  if (!isLoopback(peer)) return peer;
  // Only a local reverse proxy may supply this header. The final entry was
  // appended by that proxy; earlier entries may have been supplied by a client.
  const forwarded = request.headers?.['x-forwarded-for'];
  if (typeof forwarded !== 'string') return peer;
  const nearest = forwarded.split(',').at(-1)?.trim() || '';
  return net.isIP(nearest) ? nearest : peer;
}

module.exports = { clientIpForBackend };
