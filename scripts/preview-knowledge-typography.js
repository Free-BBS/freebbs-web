const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const HOST = '127.0.0.1';
const PORT = 3105;
const root = path.resolve(__dirname, '..');
const publicRoot = path.join(root, 'public');
const vendorRoot = path.join(root, 'node_modules');
const fixture = path.join(__dirname, 'fixtures', 'knowledge-typography.html');
const publicFiles = new Set([
  '/styles.css',
  '/course.css',
  '/ui-polish.css',
  '/knowledge-typography.css',
  '/typography.js',
]);
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};
const assetExtensions = new Set([
  '.svg',
  '.png',
  '.webp',
  '.jpg',
  '.jpeg',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
]);

// This isolated preview cannot reach the API or load ordinary application pages.
function resolvePreviewFile(requestPath) {
  if (requestPath === '/' || requestPath === '/knowledge-typography') {
    return { file: fixture, allowedRoot: path.dirname(fixture) };
  }
  if (
    requestPath.includes('\\') ||
    requestPath.includes('\0') ||
    requestPath.split('/').some((part) => part === '..' || part === '.')
  ) {
    return null;
  }
  const extension = path.extname(requestPath).toLowerCase();
  if (
    publicFiles.has(requestPath) ||
    ((requestPath.startsWith('/assets/') || requestPath.startsWith('/fonts/')) &&
      assetExtensions.has(extension))
  ) {
    return { file: path.join(publicRoot, requestPath.slice(1)), allowedRoot: publicRoot };
  }
  if (
    requestPath === '/vendor/marked/lib/marked.umd.js' ||
    (requestPath.startsWith('/vendor/katex/dist/') &&
      ['.css', '.js', '.woff', '.woff2', '.ttf'].includes(extension)) ||
    requestPath === '/vendor/@highlightjs/cdn-assets/styles/github-dark.min.css'
  ) {
    return {
      file: path.join(vendorRoot, requestPath.slice('/vendor/'.length)),
      allowedRoot: vendorRoot,
    };
  }
  return null;
}

function createPreviewServer() {
  return http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; connect-src 'none'; script-src 'self' 'unsafe-inline'; " +
        "style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; " +
        "frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end('Read-only preview');
      return;
    }
    try {
      const requestUrl = new URL(request.url || '/', `http://${HOST}:${PORT}`);
      const target = resolvePreviewFile(decodeURIComponent(requestUrl.pathname));
      if (!target) {
        response.writeHead(404);
        response.end('Preview asset not found');
        return;
      }
      const [realFile, realRoot] = await Promise.all([
        fs.promises.realpath(target.file),
        fs.promises.realpath(target.allowedRoot),
      ]);
      const relativePath = path.relative(realRoot, realFile);
      if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        response.writeHead(403);
        response.end('Outside preview directory');
        return;
      }
      const data = await fs.promises.readFile(realFile);
      response.writeHead(200, {
        'Content-Type': mimeTypes[path.extname(realFile).toLowerCase()],
        'Content-Length': data.length,
      });
      response.end(request.method === 'HEAD' ? undefined : data);
    } catch (error) {
      response.writeHead(error instanceof URIError ? 400 : 404);
      response.end('Preview asset unavailable');
    }
  });
}

if (require.main === module) {
  const server = createPreviewServer();
  server.on('error', (error) => {
    console.error(`Typography preview could not start: ${error.code || error.message}`);
    process.exitCode = 1;
  });
  server.listen(PORT, HOST, () => {
    console.log(`Isolated typography preview: http://${HOST}:${PORT}/knowledge-typography`);
    console.log('Fixed test content only; no API, account data, or persisted preference changes.');
  });
}

module.exports = { createPreviewServer, resolvePreviewFile };
