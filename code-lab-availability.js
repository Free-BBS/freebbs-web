// The browser compiler is paused. Also block stale/vendor URLs on incremental deployments.
const path = require('node:path');

function servePausedCodeLab(request, response, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  const normalized = path.posix.normalize(decoded.replace(/\\/g, '/')).toLowerCase();
  const paused =
    /^\/code-lab(?:-worker)?\.(?:js|css)\/?$/.test(normalized) ||
    /^\/code-lab-assets(?:\/|$)/.test(normalized) ||
    /^\/vendor\/(?:@live-codes\/clang-wasm|@wasm-idle\/llvm-core)(?:\/|$)/.test(normalized);
  if (!paused) return false;
  response.writeHead(410, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(request.method === 'HEAD' ? undefined : 'C / C++ 运行环境规划中，暂未开放');
  return true;
}

module.exports = { servePausedCodeLab };
