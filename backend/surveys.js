const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}
function parseJson(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}
function validateSurvey(body) {
  const title = String(body.title || '').trim();
  const description = String(body.description || '').trim();
  const opensAt = new Date(body.opensAt);
  const closesAt = new Date(body.closesAt);
  const winnerCount = Number(body.winnerCount);
  const repeatDays = Number(body.repeatDays || 0);
  if (!title || title.length > 160 || description.length > 5000)
    fail('请填写标题（最多 160 字），说明最多 5000 字');
  if (
    !Number.isFinite(opensAt.getTime()) ||
    !Number.isFinite(closesAt.getTime()) ||
    closesAt <= opensAt
  )
    fail('截止时间必须晚于开放时间');
  if (!Number.isInteger(winnerCount) || winnerCount < 1 || winnerCount > 10000)
    fail('抽签名额应为 1–10000');
  if (!['auto', 'manual'].includes(body.drawMode)) fail('请选择抽签方式');
  if (
    !Number.isInteger(repeatDays) ||
    repeatDays < 0 ||
    repeatDays > 365 ||
    (repeatDays && closesAt - opensAt > repeatDays * 86400000)
  )
    fail('重复周期应为 1–365 天，且不得短于报名时长');
  if (!Array.isArray(body.questions) || !body.questions.length || body.questions.length > 50)
    fail('请设置 1–50 道题目');
  const questions = body.questions.map((q, index) => {
    if (!q || !['single', 'multiple', 'text', 'textarea'].includes(q.type)) fail('不支持的题型');
    const label = String(q.label || '').trim();
    if (!label || label.length > 300) fail('题目标题应为 1–300 字');
    let options = [];
    if (['single', 'multiple'].includes(q.type)) {
      if (!Array.isArray(q.options)) fail('请填写选项');
      options = q.options.map((item) => String(item).trim());
      if (
        options.length < 2 ||
        options.length > 30 ||
        options.some((item) => !item || item.length > 200) ||
        new Set(options).size !== options.length
      )
        fail('选择题需要 2–30 个不重复的选项，每项最多 200 字');
    }
    return { id: `q${index + 1}`, label, type: q.type, required: q.required === true, options };
  });
  return {
    title,
    description,
    opensAt,
    closesAt,
    winnerCount,
    repeatDays,
    requiresLogin: body.requiresLogin === true,
    drawMode: body.drawMode,
    questions,
  };
}
function validateAnswers(questions, answers) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) fail('请填写问卷');
  if (Object.keys(answers).some((key) => !questions.some((q) => q.id === key)))
    fail('问卷题目已变更，请刷新');
  const result = {};
  for (const q of questions) {
    const value = answers[q.id];
    if (q.type === 'multiple') {
      const selected = value === undefined ? [] : value;
      if (
        !Array.isArray(selected) ||
        selected.some((item) => !q.options.includes(item)) ||
        new Set(selected).size !== selected.length
      )
        fail(`${q.label}：选项无效`);
      if (q.required && !selected.length) fail(`${q.label}：必填`);
      result[q.id] = selected;
    } else {
      if (value !== undefined && typeof value !== 'string') fail(`${q.label}：格式错误`);
      const answer = (value || '').trim();
      if (q.required && !answer) fail(`${q.label}：必填`);
      if (answer.length > 5000 || (q.type === 'single' && answer && !q.options.includes(answer)))
        fail(`${q.label}：答案无效`);
      result[q.id] = answer;
    }
  }
  return result;
}
function chooseWinners(ids, count, randomInt = crypto.randomInt) {
  const shuffled = [...ids];
  for (let i = 0; i < Math.min(count, shuffled.length); i += 1) {
    const j = randomInt(i, shuffled.length);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, count);
}
async function ensureSurveyTables(pool) {
  const sql = fs.readFileSync(
    path.join(__dirname, '../database/migrations/032_surveys.sql'),
    'utf8',
  );
  for (const statement of sql.split(';').filter((s) => s.trim())) await pool.query(statement);
  const upgrade = fs.readFileSync(
    path.join(__dirname, '../database/migrations/033_survey_login.sql'),
    'utf8',
  );
  for (const statement of upgrade.split(';').filter((item) => item.trim())) {
    try {
      await pool.query(statement);
    } catch (error) {
      if (!['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME'].includes(error.code)) throw error;
    }
  }
}
function publicSurvey(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    questions: parseJson(row.questions),
    opensAt: row.opens_at,
    closesAt: row.closes_at,
    winnerCount: row.winner_count,
    drawMode: row.draw_mode,
    requiresLogin: Boolean(row.requires_login),
    status: row.status,
    drawnAt: row.drawn_at,
  };
}
function createSurveyService(pool) {
  async function transaction(fn) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await fn(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
  async function locked(connection, id) {
    const [[row]] = await connection.execute('SELECT * FROM surveys WHERE id = ? FOR UPDATE', [id]);
    if (!row) fail('问卷不存在', 404);
    const [[clock]] = await connection.execute(
      'SELECT NOW(3) AS db_now, opens_at <= NOW(3) AS has_opened, closes_at <= NOW(3) AS has_closed FROM surveys WHERE id = ?',
      [id],
    );
    Object.assign(row, clock);
    return row;
  }
  async function insert(connection, body, creator, status = 'draft') {
    const id = crypto.randomUUID();
    await connection.execute(
      'INSERT INTO surveys (id,title,description,questions,opens_at,closes_at,winner_count,draw_mode,repeat_days,status,created_by,requires_login) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [
        id,
        body.title,
        body.description,
        JSON.stringify(body.questions),
        body.opensAt,
        body.closesAt,
        body.winnerCount,
        body.drawMode,
        body.repeatDays,
        status,
        creator,
        body.requiresLogin ? 1 : 0,
      ],
    );
    return id;
  }
  async function draw(id, actor, automatic = false) {
    return transaction(async (connection) => {
      const row = await locked(connection, id);
      if (row.status === 'drawn') return { alreadyDrawn: true };
      if (row.status !== 'published' || !row.has_closed || (automatic && row.draw_mode !== 'auto'))
        fail('仅可在报名截止后抽签');
      const [entries] = await connection.execute(
        'SELECT id FROM survey_entries WHERE survey_id = ? ORDER BY id',
        [id],
      );
      const winners = chooseWinners(
        entries.map((entry) => entry.id),
        row.winner_count,
      );
      for (const winner of winners)
        await connection.execute('UPDATE survey_entries SET winner = 1 WHERE id = ?', [winner]);
      await connection.execute(
        "UPDATE surveys SET status = 'drawn', drawn_at = NOW(3), drawn_by = ? WHERE id = ?",
        [String(actor), id],
      );
      return { participantCount: entries.length, winnerCount: winners.length };
    });
  }
  async function submit(id, body, user = null) {
    const contact = String(body.contact || '')
      .trim()
      .toLowerCase();
    const receipt = String(body.receipt || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) || contact.length > 254)
      fail('请填写有效联系邮箱');
    if (!/^[a-f0-9]{64}$/.test(receipt)) fail('无效报名回执，请刷新页面');
    const hash = crypto.createHash('sha256').update(receipt).digest('hex');
    return transaction(async (connection) => {
      const row = await locked(connection, id);
      if (row.requires_login && !user?.id) fail('此活动需要登录后报名', 401);
      const [[existing]] = await connection.execute(
        'SELECT id FROM survey_entries WHERE survey_id = ? AND receipt_hash = ?',
        [id, hash],
      );
      if (existing) return { receipt };
      if (row.status !== 'published' || !row.has_opened || row.has_closed)
        fail('当前不在报名时间内', 409);
      const answers = validateAnswers(parseJson(row.questions), body.answers);
      try {
        await connection.execute(
          'INSERT INTO survey_entries (id,survey_id,contact,receipt_hash,answers,user_id) VALUES (?,?,?,?,?,?)',
          [
            crypto.randomUUID(),
            id,
            contact,
            hash,
            JSON.stringify(answers),
            row.requires_login ? user.id : null,
          ],
        );
      } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') fail('此邮箱或账号已报名，请使用原报名回执查询', 409);
        throw error;
      }
      return { receipt };
    });
  }
  async function tick() {
    const [rows] = await pool.query(
      "SELECT id, draw_mode FROM surveys WHERE status IN ('published','drawn') AND closes_at <= NOW(3) AND (status = 'published' AND draw_mode = 'auto' OR repeat_days > 0 AND next_id IS NULL) ORDER BY closes_at LIMIT 100",
    );
    for (const row of rows) {
      try {
        if (row.draw_mode === 'auto') await draw(row.id, 'automatic', true);
        await transaction(async (connection) => {
          const current = await locked(connection, row.id);
          if (
            !current.repeat_days ||
            current.next_id ||
            !['published', 'drawn'].includes(current.status)
          )
            return;
          const interval = current.repeat_days * 86400000;
          // Resume at the next live/future period after downtime; do not create expired rounds.
          const steps = Math.max(
            1,
            Math.floor((current.db_now - current.closes_at) / interval) + 1,
          );
          const nextId = await insert(
            connection,
            {
              ...publicSurvey(current),
              opensAt: new Date(current.opens_at.getTime() + steps * interval),
              closesAt: new Date(current.closes_at.getTime() + steps * interval),
              repeatDays: current.repeat_days,
            },
            current.created_by,
            'published',
          );
          await connection.execute('UPDATE surveys SET next_id = ? WHERE id = ?', [nextId, row.id]);
        });
      } catch (error) {
        console.error('Survey scheduler failed', row.id, error);
      }
    }
  }
  function startWorker() {
    let running = false;
    const run = async () => {
      if (running) return;
      running = true;
      try {
        await tick();
      } catch (error) {
        console.error('Survey worker failed', error);
      } finally {
        running = false;
      }
    };
    run();
    const timer = setInterval(run, 30000);
    timer.unref();
    return timer;
  }
  return { transaction, locked, insert, draw, submit, tick, startWorker };
}
function createSurveysRouter({
  pool,
  requireAdmin,
  getOptionalAuthUser = async () => null,
  service,
}) {
  const router = express.Router();
  router.use(['/surveys', '/admin/surveys'], (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  const route = (fn) => async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (error) {
      if (!error.status) console.error('Survey request failed', error);
      res
        .status(error.status || 500)
        .json({ message: error.status ? error.message : '问卷服务暂时不可用，请稍后重试' });
    }
  };
  const attempts = new Map();
  router.post(['/surveys/:id/entries', '/surveys/:id/result'], (req, res, next) => {
    const now = Date.now();
    for (const [key, entry] of attempts) if (entry.until <= now) attempts.delete(key);
    const key = req.ip;
    const entry = attempts.get(key) || { count: 0, until: now + 60000 };
    if (entry.count >= 120 || (!attempts.has(key) && attempts.size >= 10000)) {
      res.set('Retry-After', '60');
      return res.status(429).json({ message: '请求过于频繁，请稍后重试' });
    }
    entry.count += 1;
    attempts.set(key, entry);
    return next();
  });
  router.get(
    '/surveys',
    route(async (req, res) => {
      const page = Math.max(0, Math.min(100000, Number.parseInt(req.query.page, 10) || 0));
      const [rows] = await pool.query(
        "SELECT * FROM surveys WHERE status IN ('published','drawn') ORDER BY opens_at DESC, id DESC LIMIT 100 OFFSET ?",
        [page * 100],
      );
      res.json({
        surveys: rows.map(publicSurvey),
        nextPage: rows.length === 100 ? page + 1 : null,
      });
    }),
  );
  router.get(
    '/surveys/:id',
    route(async (req, res) => {
      const [[row]] = await pool.execute(
        "SELECT * FROM surveys WHERE id = ? AND status IN ('published','drawn','cancelled')",
        [req.params.id],
      );
      if (!row) fail('问卷不存在或尚未发布', 404);
      res.json({ survey: publicSurvey(row) });
    }),
  );
  router.post(
    '/surveys/:id/entries',
    route(async (req, res) =>
      res
        .status(201)
        .json(await service.submit(req.params.id, req.body, await getOptionalAuthUser(req))),
    ),
  );
  router.post(
    '/surveys/:id/result',
    route(async (req, res) => {
      const receipt = String(req.body.receipt || '');
      if (!/^[a-f0-9]{64}$/.test(receipt)) fail('回执格式错误');
      const hash = crypto.createHash('sha256').update(receipt).digest('hex');
      const [[row]] = await pool.execute(
        'SELECT e.winner,s.status,s.drawn_at FROM survey_entries e JOIN surveys s ON s.id = e.survey_id WHERE e.survey_id = ? AND e.receipt_hash = ?',
        [req.params.id, hash],
      );
      if (!row) fail('未找到此报名回执', 404);
      res.json({
        result:
          row.status === 'drawn'
            ? row.winner
              ? 'won'
              : 'lost'
            : row.status === 'cancelled'
              ? 'cancelled'
              : 'pending',
        drawnAt: row.drawn_at,
      });
    }),
  );
  router.use(
    '/admin/surveys',
    route(async (req, res, next) => {
      // Authentication is checked on every administrative request, before accessing submissions.
      const user = await requireAdmin(req, res);
      if (user) {
        req.surveyAdmin = user;
        next();
      }
    }),
  );
  router.get(
    '/admin/surveys',
    route(async (req, res) => {
      const [rows] = await pool.query(
        'SELECT s.*, (SELECT COUNT(*) FROM survey_entries e WHERE e.survey_id = s.id) AS entry_count FROM surveys s ORDER BY created_at DESC LIMIT 200',
      );
      res.json({
        surveys: rows.map((row) => ({
          ...publicSurvey(row),
          repeatDays: row.repeat_days,
          nextId: row.next_id,
          entryCount: row.entry_count,
          drawnBy: row.drawn_by,
        })),
      });
    }),
  );
  router.post(
    '/admin/surveys',
    route(async (req, res) => {
      const body = validateSurvey(req.body);
      const id = await service.insert(pool, body, req.surveyAdmin.id);
      res.status(201).json({ id });
    }),
  );
  router.put(
    '/admin/surveys/:id',
    route(async (req, res) => {
      const body = validateSurvey(req.body);
      await service.transaction(async (connection) => {
        const row = await service.locked(connection, req.params.id);
        if (row.status !== 'draft') fail('仅草稿可修改；已发布问卷请复制为新一期', 409);
        await connection.execute(
          'UPDATE surveys SET title=?,description=?,questions=?,opens_at=?,closes_at=?,winner_count=?,draw_mode=?,repeat_days=?,requires_login=? WHERE id=?',
          [
            body.title,
            body.description,
            JSON.stringify(body.questions),
            body.opensAt,
            body.closesAt,
            body.winnerCount,
            body.drawMode,
            body.repeatDays,
            body.requiresLogin ? 1 : 0,
            row.id,
          ],
        );
      });
      res.json({ ok: true });
    }),
  );
  router.post(
    '/admin/surveys/:id/publish',
    route(async (req, res) => {
      await service.transaction(async (connection) => {
        const row = await service.locked(connection, req.params.id);
        if (row.status !== 'draft' || row.has_closed) fail('仅未过期草稿可发布', 409);
        await connection.execute("UPDATE surveys SET status='published' WHERE id=?", [row.id]);
      });
      res.json({ ok: true });
    }),
  );
  router.post(
    '/admin/surveys/:id/cancel',
    route(async (req, res) => {
      await service.transaction(async (connection) => {
        const row = await service.locked(connection, req.params.id);
        if (row.status === 'drawn') fail('已完成抽签，不能取消', 409);
        await connection.execute(
          "UPDATE surveys SET status='cancelled', repeat_days=0 WHERE id=?",
          [row.id],
        );
      });
      res.json({ ok: true });
    }),
  );
  router.post(
    '/admin/surveys/:id/stop-repeat',
    route(async (req, res) => {
      await service.transaction(async (connection) => {
        let id = req.params.id;
        while (id) {
          const row = await service.locked(connection, id);
          await connection.execute('UPDATE surveys SET repeat_days=0 WHERE id=?', [id]);
          id = row.next_id;
        }
      });
      res.json({ ok: true });
    }),
  );
  router.post(
    '/admin/surveys/:id/draw',
    route(async (req, res) => res.json(await service.draw(req.params.id, req.surveyAdmin.id))),
  );
  router.get(
    '/admin/surveys/:id/entries',
    route(async (req, res) => {
      const [rows] = await pool.execute(
        'SELECT id, contact, answers, winner, created_at FROM survey_entries WHERE survey_id=? ORDER BY created_at',
        [req.params.id],
      );
      res.json({ entries: rows.map((row) => ({ ...row, answers: parseJson(row.answers) })) });
    }),
  );
  return router;
}
module.exports = {
  validateSurvey,
  validateAnswers,
  chooseWinners,
  ensureSurveyTables,
  createSurveyService,
  createSurveysRouter,
};
