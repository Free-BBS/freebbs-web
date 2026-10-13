const http = require('node:http');
const express = require('express');
const { listenAllowedLoopback } = require('../../scripts/fixtures/allowed-loopback');
const { createCompanionSourcesRouter } = require('../learning-companion-sources');

async function main() {
  const app = express();
  let nodeReads = 0;
  app.get('/health', (_req, res) => res.json({ pid: process.pid, nodeReads }));
  app.use(
    '/api',
    createCompanionSourcesRouter({
      async requireAuth(req, res) {
        if (req.headers.authorization === 'throw')
          throw Object.assign(new Error('PRIVATE_DATABASE_FAILURE'), { code: 'ECONNREFUSED' });
        if (req.headers.authorization !== 'owner') {
          res.status(401).json({ message: 'login required' });
          return null;
        }
        return { id: 1 };
      },
      store: { list: async () => [] },
      async loadNode(_course, point) {
        nodeReads += 1;
        if (point === 'SS-99-99') throw new Error('PRIVATE_NODE_FAILURE');
        if (point !== 'SS-01-01') return null;
        return {
          course_id: 1,
          node_id: point,
          title: 'Synthetic node',
          document_markdown: '# Synthetic content',
        };
      },
    }),
  );
  const server = http.createServer(app);
  await listenAllowedLoopback(server);
  process.on('disconnect', () => server.close(() => process.exit(0)));
  process.send({ port: server.address().port, pid: process.pid });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
