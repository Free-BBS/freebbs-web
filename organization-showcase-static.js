const fs = require('node:fs');
const path = require('node:path');

const SHOWCASE_PREFIX = '/development/organization-showcase/';
const DEFAULT_ROOT = path.join(
  __dirname,
  'development',
  'apps',
  'web',
  'dist',
  'organization-showcase',
);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.pdf': 'application/pdf',
};

const PUBLIC_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-cache',
};

function isWithin(root, filename) {
  const relative = path.relative(root, filename);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function endError(request, response, status, message, headers = {}) {
  const body = Buffer.from(message);
  response.writeHead(status, {
    ...PUBLIC_HEADERS,
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': body.length,
    ...headers,
  });
  response.end(request.method === 'HEAD' ? undefined : body);
}

// A single byte range is enough for media seeking; never buffer the complete file.
function byteRange(value, size) {
  if (!value || !/^bytes=/i.test(value)) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim());
  if (!match || (!match[1] && !match[2]) || size === 0) return null;
  const total = BigInt(size);
  let start;
  let end;
  if (!match[1]) {
    const suffix = BigInt(match[2]);
    if (suffix === 0n) return null;
    start = suffix >= total ? 0n : total - suffix;
    end = total - 1n;
  } else {
    start = BigInt(match[1]);
    end = match[2] ? BigInt(match[2]) : total - 1n;
    if (start >= total || end < start) return null;
    if (end >= total) end = total - 1n;
  }
  return { start: Number(start), end: Number(end) };
}

function unchanged(request, etag, modified) {
  const values = request.headers['if-none-match'];
  if (values !== undefined) {
    return values
      .split(',')
      .some(
        (value) =>
          value.trim() === '*' || value.trim().replace(/^W\//, '') === etag.replace(/^W\//, ''),
      );
  }
  const since = Date.parse(request.headers['if-modified-since']);
  return Number.isFinite(since) && modified <= since;
}

function rangeAllowed(request, modified) {
  const validator = request.headers['if-range'];
  if (!validator) return true;
  // Our stat-based ETag is weak, so only an HTTP date can authorize If-Range.
  const date = Date.parse(validator);
  return Number.isFinite(date) && modified <= date;
}

async function serveFile(request, response, root, pathname) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    endError(request, response, 405, '405 Method Not Allowed', { Allow: 'GET, HEAD' });
    return;
  }

  let relative;
  try {
    relative = decodeURIComponent(pathname.slice(SHOWCASE_PREFIX.length));
  } catch {
    endError(request, response, 400, '400 Bad Request');
    return;
  }
  const segments = relative.split('/');
  if (
    relative.startsWith('/') ||
    /[\0\\:]/.test(relative) ||
    segments.some((segment) => segment === '.' || segment === '..')
  ) {
    endError(request, response, 403, '403 Forbidden');
    return;
  }
  const filename = path.resolve(root, relative || '.');
  if (!isWithin(root, filename)) {
    endError(request, response, 403, '403 Forbidden');
    return;
  }

  let handle;
  try {
    const realRoot = await fs.promises.realpath(root);
    let realFile = await fs.promises.realpath(filename);
    if (!isWithin(realRoot, realFile)) {
      endError(request, response, 403, '403 Forbidden');
      return;
    }
    const fileStat = await fs.promises.stat(realFile);
    if (fileStat.isDirectory()) {
      if (!pathname.endsWith('/')) {
        const query = (request.url || '').includes('?')
          ? (request.url || '').slice((request.url || '').indexOf('?'))
          : '';
        response.writeHead(308, { ...PUBLIC_HEADERS, Location: `${pathname}/${query}` });
        response.end();
        return;
      }
      realFile = await fs.promises.realpath(path.join(realFile, 'index.html'));
      if (!isWithin(realRoot, realFile)) {
        endError(request, response, 403, '403 Forbidden');
        return;
      }
    }
    handle = await fs.promises.open(realFile, 'r');
    const stat = await handle.stat();
    if (response.destroyed) return;
    if (!stat.isFile()) {
      endError(request, response, 404, '404 Not Found');
      return;
    }
    const modified = Math.floor(stat.mtimeMs / 1000) * 1000;
    const etag = `W/"${stat.size.toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}"`;
    const type = MIME_TYPES[path.extname(realFile).toLowerCase()] || 'application/octet-stream';
    const headers = {
      ...PUBLIC_HEADERS,
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      ETag: etag,
      'Last-Modified': new Date(modified).toUTCString(),
      ...(type.startsWith('text/html') ? { 'X-Frame-Options': 'SAMEORIGIN' } : {}),
    };
    if (unchanged(request, etag, modified)) {
      response.writeHead(304, headers);
      response.end();
      return;
    }
    const range =
      request.method === 'GET' && rangeAllowed(request, modified)
        ? byteRange(request.headers.range, stat.size)
        : undefined;
    if (range === null) {
      endError(request, response, 416, '416 Range Not Satisfiable', {
        ...headers,
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Range': `bytes */${stat.size}`,
      });
      return;
    }
    if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${stat.size}`;
    headers['Content-Length'] = range ? range.end - range.start + 1 : stat.size;
    response.writeHead(range ? 206 : 200, headers);
    if (request.method === 'HEAD' || stat.size === 0) {
      response.end();
      return;
    }
    const stream = handle.createReadStream(range || {});
    handle = null; // The stream owns and closes the open descriptor.
    response.once('close', () => stream.destroy());
    stream.once('error', () => response.destroy());
    stream.pipe(response);
  } catch (error) {
    if (response.headersSent) response.destroy();
    else if (['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code)) {
      endError(request, response, 404, '404 Not Found');
    } else {
      endError(request, response, 500, '500 Internal Server Error');
    }
  } finally {
    if (handle) await handle.close();
  }
}

function createOrganizationShowcaseHandler(rootDirectory = DEFAULT_ROOT) {
  const root = path.resolve(rootDirectory);
  return function serveOrganizationShowcase(request, response) {
    // Inspect the raw path before WHATWG URL normalization can remove ../ segments.
    const pathname = (request.url || '/').split(/[?#]/, 1)[0];
    if (!pathname.startsWith(SHOWCASE_PREFIX)) return false;
    serveFile(request, response, root, pathname).catch(() => {
      if (response.headersSent) response.destroy();
      else endError(request, response, 500, '500 Internal Server Error');
    });
    return true;
  };
}

module.exports = {
  SHOWCASE_PREFIX,
  createOrganizationShowcaseHandler,
  serveOrganizationShowcase: createOrganizationShowcaseHandler(),
};
