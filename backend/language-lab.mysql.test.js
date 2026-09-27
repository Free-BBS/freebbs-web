const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');
const express = require('express');
const { isolatedMysqlConfig } = require('./test-helpers/isolated-mysql');
const { createLanguageLabRouter } = require('./language-lab');

test(
  'isolated MySQL: immutable code and result snapshots survive router restart',
  { skip: !process.env.FREEBBS_TEST_MYSQL_SOCKET, timeout: 30000 },
  async (t) => {
    const config = isolatedMysqlConfig();
    const admin = await mysql.createConnection(config);

    const [[server]] = await admin.query('SELECT @@skip_networking AS isolated');
    assert.equal(Number(server.isolated), 1);
    const database = `code_lab_test_${crypto.randomBytes(8).toString('hex')}`;
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`);

    const pool = mysql.createPool({ ...config, database });
    t.after(async () => {
      await pool.end();
      await admin.query(`DROP DATABASE \`${database}\``);
      await admin.end();
    });
    async function instance() {
      const app = express();
      app.use(express.json());
      app.use(
        createLanguageLabRouter({
          pool,
          requireAuth: async () => ({ id: 42 }),
          fetchImpl: async (url) =>
            url.endsWith('/run')
              ? new Response('{"type":"result","exitCode":0,"stdout":"你好\\n","figures":[]}\n')
              : Response.json({ ok: true }),
        }),
      );
      const listener = app.listen(0, '127.0.0.1');
      await new Promise((resolve) => {
        listener.once('listening', resolve);
      });
      t.after(() => {
        listener.closeAllConnections();
        listener.close();
      });
      return (route, body) =>
        fetch(`http://127.0.0.1:${listener.address().port}${route}`, {
          method: body ? 'POST' : 'GET',
          headers: { 'Content-Type': 'application/json' },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
    }
    const request = await instance();
    const input = { language: 'python', source: 'print("你好")', title: '持久化实验 🧪' };
    const execution = (await (await request('/run', input)).text())
      .trim()
      .split('\n')
      .map(JSON.parse);
    const runId = execution.find((event) => event.type === 'saved-run').id;
    const saved = await request('/experiments', { ...input, runId });
    assert.equal(saved.status, 201);
    const { experiment } = await saved.json();
    const second = await instance();
    const read = await (await second(`/experiments/${experiment.id}`)).json();
    assert.equal(read.experiment.title, input.title);
    assert.equal(read.experiment.source, input.source);
    assert.equal(read.experiment.result.stdout, '你好\n');
    const fork = await (await second('/experiments', { ...input, source: 'print(5)' })).json();
    assert.notEqual(fork.experiment.id, experiment.id);
    assert.equal(
      (await (await request(`/experiments/${experiment.id}`)).json()).experiment.source,
      input.source,
    );
  },
);
