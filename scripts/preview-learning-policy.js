/* Adds only the isolated experiment HTML to an existing loopback public-snapshot preview. */
const fs = require('node:fs');
const path = require('node:path');
const { listenAllowedLoopback } = require('./fixtures/allowed-loopback');
const { getAssessmentDocumentVersion } = require('../backend/learning-assessment');

function alignPublicSnapshotVersion(res) {
  const writeHead = res.writeHead.bind(res);
  res.writeHead = (...args) => {
    if (!res.headersSent) {
      res.removeHeader('Content-Length');
      res.removeHeader('ETag');
    }
    const last = args.length - 1;
    if (args[last] && typeof args[last] === 'object' && !Array.isArray(args[last]))
      args[last] = Object.fromEntries(
        Object.entries(args[last]).filter(([key]) => !/^(?:content-length|etag)$/i.test(key)),
      );
    return writeHead(...args);
  };
  const end = res.end.bind(res);
  res.end = (chunk, encoding, callback) => {
    let payload;
    try {
      payload = JSON.parse(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk);
    } catch {
      return end(chunk, encoding, callback);
    }
    if (payload?.node && typeof payload.node === 'object' && !Array.isArray(payload.node)) {
      // The read-only factory reconstructs its local store from this exact public
      // source. Original snapshots can retain an authoring-source hash that no
      // longer matches their cleaned public text. Do not weaken production scope.
      const source = payload.node.markdown || payload.node.sections?.knowledgeMarkdown || '';
      payload.node.documentVersion = getAssessmentDocumentVersion(source);
      payload.previewVersionSource = 'public_reconstructed_source_not_authoring_backup';
      return end(JSON.stringify(payload), encoding, callback);
    }
    return end(chunk, encoding, callback);
  };
}

function withLearningPolicyPage(preview) {
  const original = preview.server.listeners('request');
  preview.server.removeAllListeners('request');
  preview.server.on('request', (req, res) => {
    const host = `127.0.0.1:${preview.server.address()?.port}`;
    if (
      req.headers.host !== host ||
      (req.headers.origin && req.headers.origin !== `http://${host}`)
    ) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Loopback only');
      return;
    }
    const url = new URL(req.url, `http://${host}`);
    if (req.method === 'GET' && /^\/api\/courses\/[^/]+\/map\/nodes\/[^/]+$/.test(url.pathname))
      alignPublicSnapshotVersion(res);
    if (['/learning-policy-lab', '/learning-policy-lab.html'].includes(url.pathname)) {
      if (req.method !== 'GET') {
        res.writeHead(405, { Allow: 'GET' });
        res.end('Read-only preview');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Security-Policy':
          "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'self'",
      });
      res.end(fs.readFileSync(path.resolve(__dirname, '../public/learning-policy-lab.html')));
      return;
    }
    original.forEach((listener) => listener.call(preview.server, req, res));
  });
  return preview;
}

async function main() {
  const source = process.argv.find((arg) => arg.startsWith('--preview-module='))?.slice(17);
  if (!source) throw new Error('Use --preview-module=<read-only public snapshot preview factory>');
  // The caller chooses an existing local preview module; never a remote module or package install.
  // eslint-disable-next-line import/no-dynamic-require
  const factory = require(path.resolve(source));
  const preview = withLearningPolicyPage(
    factory.createPublicPreview({ complete: process.argv.includes('--complete') }),
  );
  await listenAllowedLoopback(preview.server);
  const origin = `http://127.0.0.1:${preview.server.address().port}`;
  console.log(
    JSON.stringify({
      origin,
      url: `${origin}/learning-policy-lab?course=signals&point=SS-02-01`,
      boundary:
        'Local public snapshots, synthetic private stores and simulated Max only. No production writes.',
      documentVersions:
        'Public-source reconstructed versions, not original authoring backup versions.',
    }),
  );
  process.once('SIGINT', () => preview.server.close());
  process.once('SIGTERM', () => preview.server.close());
}
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { withLearningPolicyPage };
