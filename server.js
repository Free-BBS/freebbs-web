const http = require('http');
const fs = require('fs');
const path = require('path');

const host = process.env.HOST || '127.0.0.1';
const port = process.env.PORT || 3000;
const publicDir = path.join(__dirname, 'public');
const vendorDir = path.join(__dirname, 'node_modules');
const pageRoutes = new Map([
  ['/surveys', '/surveys.html'],
  ['/system-settings/surveys', '/system-settings-surveys.html'],
  ['/adminusers', '/adminusers.html'],
  ['/aichat', '/aichat.html'],
  ['/course', '/course.html'],
  ['/course-map-editor', '/course-map-editor.html'],
  ['/circuit', '/circuit.html'],
  ['/circuits', '/circuit.html'],
  ['/circuit-embed', '/circuit-embed.html'],
  ['/development', '/development.html'],
  ['/discussion', '/discussion.html'],
  ['/electromagnetic', '/electromagnetic.html'],
  ['/inventory', '/inventory.html'],
  ['/knowledge', '/knowledge.html'],
  ['/markdown-editor', '/markdown-editor.html'],
  ['/login', '/login.html'],
  ['/profile', '/profile.html'],
  ['/register', '/register.html'],
  ['/remake', '/remake.html'],
  ['/settings', '/settings.html'],
  ['/system-settings', '/system-settings.html'],
  ['/system-settings/announcements', '/system-settings-announcements.html'],
  ['/system-settings/course-materials', '/system-settings-course-materials.html'],
  ['/system-settings/model', '/system-settings-model.html'],
  ['/workbench', '/workbench.html'],
  ['/world', '/world.html'],
]);
const htmlRedirects = new Map([
  ['/adminusers.html', '/adminusers'],
  ['/aichat.html', '/aichat'],
  ['/course.html', '/course'],
  ['/course-map-editor.html', '/course-map-editor'],
  ['/circuit.html', '/circuit'],
  ['/circuit-embed.html', '/circuit-embed'],
  ['/development.html', '/development'],
  ['/discussion.html', '/discussion'],
  ['/electromagnetic.html', '/electromagnetic'],
  ['/inventory.html', '/inventory'],
  ['/index.html', '/'],
  ['/knowledge.html', '/knowledge'],
  ['/markdown-editor.html', '/markdown-editor'],
  ['/login.html', '/login'],
  ['/profile.html', '/profile'],
  ['/register.html', '/register'],
  ['/remake.html', '/remake'],
  ['/settings.html', '/settings'],
  ['/system-settings-announcements.html', '/system-settings/announcements'],
  ['/system-settings-course-materials.html', '/system-settings/course-materials'],
  ['/system-settings-model.html', '/system-settings/model'],
  ['/system-settings.html', '/system-settings'],
  ['/workbench.html', '/workbench'],
  ['/world.html', '/world'],
]);

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

function sendNotFoundPage(response) {
  const filePath = path.join(publicDir, '404.html');
  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404, {
        'Content-Type': 'text/plain; charset=utf-8',
      });
      response.end('404 Not Found');
      return;
    }

    response.writeHead(404, {
      'Content-Type': 'text/html; charset=utf-8',
    });
    response.end(data);
  });
}

function sendFile(filePath, response, options = {}) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      if (error.code === 'ENOENT' && options.htmlNotFound) {
        sendNotFoundPage(response);
        return;
      }

      response.writeHead(error.code === 'ENOENT' ? 404 : 500, {
        'Content-Type': 'text/plain; charset=utf-8',
      });
      response.end(error.code === 'ENOENT' ? '404 Not Found' : '500 Internal Server Error');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const headers = {
      'Content-Type': mimeTypes[ext] || 'application/octet-stream',
    };

    if (
      [
        '.png',
        '.jpg',
        '.jpeg',
        '.svg',
        '.webp',
        '.ico',
        '.woff',
        '.woff2',
        '.ttf',
        '.otf',
      ].includes(ext)
    ) {
      headers['Cache-Control'] = 'public, max-age=31536000, immutable';
    }

    response.writeHead(200, {
      ...headers,
    });
    response.end(data);
  });
}

const server = http.createServer((request, response) => {
  const requestUrl = new URL(
    request.url || '/',
    `http://${request.headers.host || `${host}:${port}`}`,
  );
  if (requestUrl.pathname.startsWith('/api/') || requestUrl.pathname.startsWith('/uploads/')) {
    const upstream = http.request(
      {
        hostname:
          process.env.API_HOST === '0.0.0.0' ? '127.0.0.1' : process.env.API_HOST || '127.0.0.1',
        port: Number(process.env.API_PORT || 3001),
        method: request.method,
        path: request.url,
        headers: {
          ...request.headers,
          'x-forwarded-for': request.socket.remoteAddress,
          host: `127.0.0.1:${process.env.API_PORT || 3001}`,
        },
      },
      (apiResponse) => {
        response.writeHead(apiResponse.statusCode, apiResponse.headers);
        apiResponse.pipe(response);
      },
    );
    upstream.on('error', () => {
      if (!response.headersSent) {
        response.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ message: '后端服务尚未就绪，请稍后重试' }));
      } else response.destroy();
    });
    request.on('aborted', () => upstream.destroy());
    request.pipe(upstream);
    return;
  }
  const cleanPath =
    requestUrl.pathname.endsWith('/') && requestUrl.pathname !== '/'
      ? requestUrl.pathname.slice(0, -1)
      : requestUrl.pathname;

  if (htmlRedirects.has(cleanPath)) {
    const redirectUrl = new URL(
      request.url || '/',
      `http://${request.headers.host || `${host}:${port}`}`,
    );
    redirectUrl.pathname = htmlRedirects.get(cleanPath);
    response.writeHead(301, {
      Location: `${redirectUrl.pathname}${redirectUrl.search}${redirectUrl.hash}`,
    });
    response.end();
    return;
  }

  const urlPath = cleanPath === '/' ? '/index.html' : pageRoutes.get(cleanPath) || cleanPath;
  // URL paths always use `/`, even when the static server is running on Windows.
  // Using path.normalize here turns `/vendor/...` into `\\vendor\\...`, which
  // prevents vendor requests from being recognized and makes every dependency 404.
  const normalizedPath = path.posix.normalize(urlPath).replace(/^(\.\.\/)+/, '');
  const isVendorRequest = normalizedPath.startsWith('/vendor/');
  const baseDir = isVendorRequest ? vendorDir : publicDir;
  const relativePath = isVendorRequest ? normalizedPath.slice('/vendor'.length) : normalizedPath;
  const filePath = path.join(baseDir, relativePath);
  const ext = path.extname(filePath).toLowerCase();
  const acceptsHtml = (request.headers.accept || '').includes('text/html');
  const htmlNotFound = !isVendorRequest && (acceptsHtml || !ext || ext === '.html');

  if (!filePath.startsWith(baseDir)) {
    response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('403 Forbidden');
    return;
  }

  sendFile(filePath, response, { htmlNotFound });
});

server.listen(port, host, () => {
  console.log(`FREE-BBS homepage running at http://${host}:${port}`);
});
