// Memory-only QA: real ranch routers and shop transactions, no external writes.
const express = require('express');
const { createEconomyPreview, TOKEN } = require('./preview-economy');
const { preparePageShell } = require('../page-shell');
const { createRanchWorldRouter } = require('../backend/ranch-world');
const { createRanchDesignRouter } = require('../backend/ranch-designs');
const { blank } = require('../public/ranch-design-data');

function createRanchPreview() {
  const preview = createEconomyPreview({
    accounts: Array.from({ length: 14 }, (_, i) => ({
      id: i + 1,
      assets: { max_pet: 1, fish: 3 },
      fedUntilMs: Date.now() + 86400000,
    })),
    transformHtml: (html) =>
      preparePageShell(html)
        .replace(
          '</head>',
          '<link rel="stylesheet" href="/mobile-shell.css"><link rel="stylesheet" href="/desktop-elegant.css"></head>',
        )
        .replace('</body>', '<script src="/mobile-shell.js"></script></body>'),
  });
  const designs = new Map();
  let state = { revision: 0, state_json: JSON.stringify({ scene: 'meadow', events: [] }) };
  let queue = Promise.resolve();
  const rows = () =>
    Array.from({ length: 14 }, (_, i) => {
      const id = i + 1;
      const design = designs.get(id);
      return {
        id,
        uid: `u_preview${String(id).padStart(2, '0')}`,
        username: id === 1 ? 'NotingSr_preview' : `羊伙伴 ${id}`,
        adopted: 1,
        design_json: design?.design || blank(),
        revision: design?.revision || 0,
        ranch_assets: Object.entries(preview.store.account(id).assets)
          .filter(([key, quantity]) => key.startsWith('ranch_') && quantity > 0)
          .map(([key, quantity]) => `${key}:${quantity}`)
          .join(','),
      };
    });
  const pool = {
    async execute(sql, values = []) {
      if (sql.includes('ranch_world_state')) return [[structuredClone(state)]];
      if (sql.startsWith('SELECT id FROM users')) return [[{ id: values[0] }]];
      if (sql.startsWith('SELECT revision FROM'))
        return [[{ revision: designs.get(values[0])?.revision || 0 }]];
      if (sql.startsWith('SELECT asset_key, quantity'))
        return [
          Object.entries(preview.store.account(values[0]).assets).map(([assetKey, quantity]) => ({
            asset_key: assetKey,
            quantity,
          })),
        ];
      if (sql.includes('FROM users u')) {
        if (sql.includes('u.id = ?')) return [[rows().find((row) => row.id === values[0])]];
        if (sql.includes('u.uid = ?')) return [[rows().find((row) => row.uid === values[0])]];
        return [rows()];
      }
      throw new Error(`Unexpected preview SQL: ${sql}`);
    },
    async getConnection() {
      let release;
      let pending;
      let pendingDesign;
      return {
        async beginTransaction() {
          const prior = queue;
          queue = new Promise((resolve) => {
            release = resolve;
          });
          await prior;
        },
        async execute(sql, values) {
          if (sql.startsWith('UPDATE ranch_world_state')) {
            pending = { state_json: values[0], revision: values[1] };
            return [{}];
          }
          if (sql.startsWith('INSERT INTO user_ranch_designs')) {
            pendingDesign = [values[0], { design: JSON.parse(values[1]), revision: values[2] }];
            return [{}];
          }
          return pool.execute(sql, values);
        },
        async commit() {
          if (pending) state = pending;
          if (pendingDesign) designs.set(...pendingDesign);
          release();
        },
        async rollback() {
          release();
        },
        release() {},
      };
    },
  };
  const requireAuth = async (req, res) => {
    if (req.headers.authorization === `Bearer ${TOKEN}`) return { id: 1, uid: 'u_preview01' };
    res.status(401).json({ message: '仅限本地模拟登录' });
    return null;
  };
  const fallback = preview.server.listeners('request')[0];
  const app = express();
  app.use('/api/ranch-world', express.json(), createRanchWorldRouter({ pool, requireAuth }));
  app.use('/api/ranch-designs', express.json(), createRanchDesignRouter({ pool, requireAuth }));
  app.use((req, res) => fallback(req, res));
  preview.server.removeAllListeners('request');
  preview.server.on('request', app);
  return preview;
}
if (require.main === module)
  createRanchPreview().server.listen(3214, '127.0.0.1', () =>
    console.log('Shared ranch QA: http://127.0.0.1:3214/ranch-gallery (memory only)'),
  );
module.exports = { createRanchPreview };
