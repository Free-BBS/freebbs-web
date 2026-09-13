const crypto = require('node:crypto');

async function ensureWorkbenchTables(pool) {
  await pool.execute(`CREATE TABLE IF NOT EXISTS circuit_revision_events (
    cid CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    revision INT UNSIGNED NOT NULL,
    kind VARCHAR(16) NOT NULL DEFAULT 'save',
    message VARCHAR(240) NOT NULL DEFAULT '',
    source_cid CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
    source_revision INT UNSIGNED NULL,
    PRIMARY KEY (cid, revision),
    FOREIGN KEY (cid, revision) REFERENCES circuit_revisions(cid, revision) ON DELETE CASCADE
  )`);
  await pool.execute(`CREATE TABLE IF NOT EXISTS circuit_reports (
    id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    owner_id BIGINT NOT NULL,
    cid CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    circuit_revision INT UNSIGNED NOT NULL,
    title VARCHAR(120) NOT NULL,
    markdown MEDIUMTEXT NOT NULL,
    version INT UNSIGNED NOT NULL DEFAULT 1,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (cid) REFERENCES circuits(cid) ON DELETE CASCADE,
    INDEX idx_circuit_reports_owner (owner_id, cid, updated_at)
  )`);
}
function validateReport(body) {
  if (
    !body ||
    typeof body.title !== 'string' ||
    !body.title.trim() ||
    body.title.length > 120 ||
    typeof body.markdown !== 'string' ||
    Buffer.byteLength(body.markdown) > 2 * 1024 * 1024 ||
    !Number.isSafeInteger(body.circuitRevision) ||
    body.circuitRevision < 1
  )
    throw Object.assign(new Error('报告标题最多 120 字，正文最多 2 MB，须关联有效电路版本。'), {
      status: 400,
    });
  return {
    title: body.title.trim(),
    markdown: body.markdown,
    circuitRevision: body.circuitRevision,
  };
}
function registerWorkbench(
  router,
  {
    pool,
    requireAuth,
    handle,
    CircuitError,
    validateCid,
    readIntegerQuery,
    readCircuit,
    withTransaction,
    insertRevision,
    canEditCircuit,
  },
) {
  const revisionNumber = (value) => readIntegerQuery(String(value ?? ''), { name: 'revision' });
  const message = (value, fallback) => {
    if (value !== undefined && (typeof value !== 'string' || value.length > 240))
      throw new CircuitError('存档说明最多 240 字。');
    return value?.trim() || fallback;
  };
  router.get(
    '/:cid/history',
    handle(async (req, res) => {
      validateCid(req.params.cid);
      await readCircuit(pool, req.params.cid, null, null);
      const before = req.query.before ? revisionNumber(req.query.before) : 4294967295;
      const [rows] = await pool.execute(
        `SELECT r.revision, r.title, r.created_at AS createdAt, e.kind, e.message, e.source_cid AS sourceCid, e.source_revision AS sourceRevision
      FROM circuit_revisions r LEFT JOIN circuit_revision_events e ON e.cid=r.cid AND e.revision=r.revision
      WHERE r.cid=? AND r.revision < ? ORDER BY r.revision DESC LIMIT 51`,
        [req.params.cid, before],
      );
      const [branches] = await pool.execute(
        `SELECT e.cid, e.source_revision AS sourceRevision, r.title FROM circuit_revision_events e JOIN circuit_revisions r ON r.cid=e.cid AND r.revision=1 WHERE e.source_cid=? AND e.kind='fork' ORDER BY r.created_at DESC LIMIT 50`,
        [req.params.cid],
      );
      res.json({ entries: rows.slice(0, 50), hasMore: rows.length > 50, branches });
    }),
  );
  router.post(
    '/:cid/fork',
    handle(async (req, res) => {
      const user = await requireAuth(req, res);
      if (!user) return;
      validateCid(req.params.cid);
      const sourceRevision = revisionNumber(req.body.revision);
      const label = message(req.body.message, 'Fork 实验分支');
      const result = await withTransaction(pool, async (connection) => {
        const source = await readCircuit(connection, req.params.cid, sourceRevision, user);
        const cid = `c_${crypto.randomBytes(12).toString('hex')}`;
        await connection.execute('INSERT INTO circuits (cid, owner_id) VALUES (?, ?)', [
          cid,
          user.id,
        ]);
        await insertRevision(
          connection,
          cid,
          1,
          { ...source, title: `${source.title} · fork`.slice(0, 120) },
          user.id,
        );
        await connection.execute(
          'INSERT INTO circuit_revision_events (cid, revision, kind, message, source_cid, source_revision) VALUES (?, 1, ?, ?, ?, ?)',
          [cid, 'fork', label, source.cid, sourceRevision],
        );
        return readCircuit(connection, cid, 1, user);
      });
      res.status(201).json({ circuit: result });
    }),
  );
  router.post(
    '/:cid/restore',
    handle(async (req, res) => {
      const user = await requireAuth(req, res);
      if (!user) return;
      validateCid(req.params.cid);
      const target = revisionNumber(req.body.revision);
      const expected = revisionNumber(req.body.expectedRevision);
      const label = message(req.body.message, `恢复至版本 ${target}`);
      const circuit = await withTransaction(pool, async (connection) => {
        const [rows] = await connection.execute(
          'SELECT owner_id, current_revision FROM circuits WHERE cid=? FOR UPDATE',
          [req.params.cid],
        );
        if (!rows[0]) throw new CircuitError('电路不存在', 404);
        if (!canEditCircuit(user, rows[0].owner_id))
          throw new CircuitError('只有作者或管理员可以恢复版本', 403);
        if (Number(rows[0].current_revision) !== expected)
          throw new CircuitError('电路已有新版本，请刷新历史后重试。', 409);
        if (expected >= 4294967295) throw new CircuitError('版本数达到上限');
        const source = await readCircuit(connection, req.params.cid, target, user);
        await insertRevision(connection, source.cid, expected + 1, source, user.id);
        await connection.execute(
          'INSERT INTO circuit_revision_events (cid, revision, kind, message, source_cid, source_revision) VALUES (?, ?, ?, ?, ?, ?)',
          [source.cid, expected + 1, 'restore', label, source.cid, target],
        );
        await connection.execute(
          'UPDATE circuits SET current_revision=?, updated_at=CURRENT_TIMESTAMP(3) WHERE cid=?',
          [expected + 1, source.cid],
        );
        return readCircuit(connection, source.cid, expected + 1, user);
      });
      res.json({ circuit });
    }),
  );
  router.get(
    '/:cid/reports',
    handle(async (req, res) => {
      const user = await requireAuth(req, res);
      if (!user) return;
      validateCid(req.params.cid);
      const [reports] = await pool.execute(
        'SELECT id, title, circuit_revision AS circuitRevision, version, updated_at AS updatedAt FROM circuit_reports WHERE owner_id=? AND cid=? ORDER BY updated_at DESC LIMIT 100',
        [user.id, req.params.cid],
      );
      res.json({ reports });
    }),
  );
  router.get(
    '/:cid/reports/:id',
    handle(async (req, res) => {
      const user = await requireAuth(req, res);
      if (!user) return;
      validateCid(req.params.cid);
      const [rows] = await pool.execute(
        'SELECT id, title, markdown, circuit_revision AS circuitRevision, version FROM circuit_reports WHERE id=? AND cid=? AND owner_id=?',
        [req.params.id, req.params.cid, user.id],
      );
      if (!rows[0]) throw new CircuitError('报告不存在', 404);
      res.json({ report: rows[0] });
    }),
  );
  for (const method of ['post', 'put'])
    router[method](
      method === 'post' ? '/:cid/reports' : '/:cid/reports/:id',
      handle(async (req, res) => {
        const user = await requireAuth(req, res);
        if (!user) return;
        validateCid(req.params.cid);
        let data;
        try {
          data = validateReport(req.body);
        } catch (error) {
          throw new CircuitError(error.message);
        }
        await readCircuit(pool, req.params.cid, data.circuitRevision, user);
        const id =
          method === 'post' ? `r_${crypto.randomBytes(12).toString('hex')}` : req.params.id;
        let version = 1;
        if (method === 'put') {
          if (!Number.isSafeInteger(req.body.expectedVersion) || req.body.expectedVersion < 1)
            throw new CircuitError('须提供报告版本号');
          const [result] = await pool.execute(
            'UPDATE circuit_reports SET title=?, markdown=?, circuit_revision=?, version=version+1, updated_at=CURRENT_TIMESTAMP(3) WHERE id=? AND cid=? AND owner_id=? AND version=?',
            [
              data.title,
              data.markdown,
              data.circuitRevision,
              id,
              req.params.cid,
              user.id,
              req.body.expectedVersion,
            ],
          );
          if (!result.affectedRows)
            throw new CircuitError('报告已更新或不可编辑，请保留草稿后重新打开。', 409);
          version = req.body.expectedVersion + 1;
        } else
          await pool.execute(
            'INSERT INTO circuit_reports (id, owner_id, cid, circuit_revision, title, markdown) VALUES (?, ?, ?, ?, ?, ?)',
            [id, user.id, req.params.cid, data.circuitRevision, data.title, data.markdown],
          );
        res.status(method === 'post' ? 201 : 200).json({ report: { id, ...data, version } });
      }),
    );
}
module.exports = { ensureWorkbenchTables, registerWorkbench, validateReport };
