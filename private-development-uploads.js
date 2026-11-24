const path = require('node:path');

function privatePathname(value) {
  let decoded;
  try {
    // send/express.static decodes the pathname before resolving its filesystem path.
    decoded = decodeURIComponent(value);
  } catch {
    // An invalid upload URL must not fall through to a different decoder.
    return /^\/+uploads(?:[\\/]|%|$)/i.test(value);
  }
  let ambiguousAlias = false;
  const segments = decoded
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => {
      if (/~\d/i.test(segment)) ambiguousAlias = true;
      // Win32 treats trailing spaces/dots and alternate-data-stream suffixes as
      // aliases. Preserve dot navigation before resolving the resulting path.
      const name = segment.split(':')[0].replace(/ +$/g, '');
      if (name === '.' || name === '..') return name;
      if (/^[. ]+$/.test(name)) ambiguousAlias = true;
      return name.replace(/[ .]+$/g, '').toLowerCase();
    });
  const parts = path.posix
    .normalize(`/${segments.join('/')}`)
    .split('/')
    .filter(Boolean);
  if (parts[0] !== 'uploads') return false;
  if (ambiguousAlias || [...decoded].some((character) => character.charCodeAt(0) === 0))
    return true;
  return parts[1] === 'development' && parts[2] === 'collections';
}

/** Files under this tree always require their feature's authenticated API. */
function isPrivateDevelopmentUploadPath(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl) return false;
  const pathname = rawUrl.split(/[?#]/, 1)[0];
  if (privatePathname(pathname)) return true;
  // HTTP proxies also accept absolute-form URLs. Match the same WHATWG parsing
  // used by the frontend without trusting its host or making any network call.
  try {
    return privatePathname(new URL(rawUrl, 'http://upload-path.invalid').pathname);
  } catch {
    return false;
  }
}

/** Shared by the Node frontend and Express backend; credentials never bypass it. */
function blockPrivateDevelopmentUploads(request, response) {
  if (!isPrivateDevelopmentUploadPath(request.originalUrl || request.url)) return false;
  response.statusCode = 404;
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.end(request.method === 'HEAD' ? undefined : 'Not Found');
  return true;
}

function guardPrivateDevelopmentUploads(request, response, next) {
  if (!blockPrivateDevelopmentUploads(request, response)) next();
}

module.exports = {
  isPrivateDevelopmentUploadPath,
  blockPrivateDevelopmentUploads,
  guardPrivateDevelopmentUploads,
};
