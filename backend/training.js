const crypto = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const express = require('express');
const { makeSchedule } = require('./training-scheduling');
const { createHandoutProcessor, MAX_PDF_BYTES } = require('./training-handouts');

const MAX_COURSES = 40;
const MAX_PREFERENCES = 20;
const MAX_LECTURERS = 20;
const DEFAULT_QUESTIONS = ['讲解清晰程度', '课程内容的实用性', '课堂节奏'];
const BATCH_FIELDS = `id, slug, title, opens_at AS opensAt, closes_at AS closesAt,
  published_at AS publishedAt, revision`;
const COURSE_VISIBILITY = `(c.offered = 1 OR (c.capacity > 0 AND b.published_at IS NOT NULL))
  AND (? OR (b.published_at IS NOT NULL AND EXISTS (
    SELECT 1 FROM training_assignments assigned WHERE assigned.course_id = c.id
  )))`;

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

function requirePermission(permitted) {
  if (!permitted) fail(403, '你没有执行此操作的权限');
}

function integer(value, min, max, message) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(400, message);
  return value;
}

function id(value) {
  return integer(Number(value), 1, Number.MAX_SAFE_INTEGER, '无效编号');
}

function input(value, max, label, optional = false) {
  if (optional && value === undefined) return '';
  if (typeof value !== 'string') fail(400, `请填写${label}`);
  const cleaned = value.trim();
  if (
    (!optional && !cleaned) ||
    cleaned.length > max ||
    [...cleaned].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 && code !== 9 && code !== 10 && code !== 13;
    })
  ) {
    fail(400, `${label}最多 ${max} 字${optional ? '' : '且必填'}`);
  }
  return cleaned;
}

function timestamp(value, label) {
  return integer(value, Date.UTC(2000, 0), Date.UTC(2100, 0), `请选择有效的${label}`);
}

function subjectKey(title) {
  const key = title.normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ');
  if (key.length > 180) fail(400, '科目名称过长');
  return key;
}

function signature(value) {
  const valid =
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 100 &&
    value.every(
      (stroke) =>
        Array.isArray(stroke) &&
        stroke.length > 0 &&
        stroke.every(
          (point) =>
            Array.isArray(point) &&
            point.length === 2 &&
            point.every((number) => Number.isInteger(number) && number >= 0 && number <= 1000),
        ),
    ) &&
    value.reduce((count, stroke) => count + stroke.length, 0) <= 5000 &&
    value.some(([first, ...points]) =>
      points.some(([x, y]) => Math.hypot(x - first[0], y - first[1]) >= 15),
    );
  if (!valid) fail(400, '请完成手写签名');
  return JSON.stringify(value);
}

function replayUrl(value) {
  try {
    const url = new URL(input(value, 2048, '腾讯会议回放链接'));
    if (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      url.href.length <= 2048 &&
      /^(?:[a-z0-9-]+\.)*meeting\.(?:tencent|qq)\.com$/.test(url.hostname)
    )
      return url.href;
  } catch {
    // Use the same validation message for malformed and unsupported links.
  }
  return fail(400, '请输入腾讯会议的 HTTPS 回放链接');
}

async function rows(db, sql, args = []) {
  const [result] = await db.execute(sql, args);
  return result;
}

async function one(db, sql, args) {
  return (await rows(db, sql, args))[0];
}

async function transaction(pool, action) {
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const result = await action(db);
    await db.commit();
    return result;
  } catch (error) {
    await db.rollback();
    throw error;
  } finally {
    db.release();
  }
}

async function batchBySlug(db, slug, lock = false) {
  const batch = await one(
    db,
    `SELECT ${BATCH_FIELDS} FROM training_batches WHERE slug = ?${lock ? ' FOR UPDATE' : ''}`,
    [slug],
  );
  if (!batch) fail(404, '报名批次不存在');
  return batch;
}

function phase(batch, now = Date.now()) {
  if (batch.publishedAt !== null) return 'published';
  if (now < batch.opensAt) return 'upcoming';
  return now < batch.closesAt ? 'open' : 'closed';
}

async function readTrainingUserAccess(db, userId) {
  const access = await one(
    db,
    'SELECT staff_role AS staffRole, viewing_revoked AS revoked FROM training_user_access WHERE user_id = ?',
    [userId],
  );
  return { staffRole: access?.staffRole ?? null, revoked: Boolean(access?.revoked) };
}

async function setTrainingUserAccess(db, userId, settings, isAdmin) {
  if (isAdmin) fail(400, '主站管理员已拥有全部学培权限');
  const { staffRole, revoked } = settings || {};
  if (![null, 'member', 'minister'].includes(staffRole) || typeof revoked !== 'boolean') {
    fail(400, '请选择有效的学培身份和查看权限');
  }
  await rows(
    db,
    `INSERT INTO training_user_access (user_id, staff_role, viewing_revoked)
      VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE staff_role = ?, viewing_revoked = ?`,
    [userId, staffRole, revoked, staffRole, revoked],
  );
  return { staffRole, revoked };
}

function hashRosterToken(token) {
  return crypto.createHash('sha256').update(token).digest();
}

function createRosterToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function rosterName(value) {
  const name = input(value, 64, '姓名').normalize('NFC');
  if (name.length > 64 || /[\r\n\t]/.test(name)) fail(400, '请输入有效的姓名');
  return name;
}

// Called only inside the registration transaction after whitelist and email verification.
async function claimTrainingRoster(db, { token, fullName, userId }) {
  if (token === undefined) return;
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    fail(409, '学培注册链接无效、姓名不匹配或已使用');
  }
  const entry = await one(
    db,
    'SELECT id, full_name AS fullName, staff_role AS staffRole FROM training_roster WHERE token_hash = ? AND claimed_at IS NULL FOR UPDATE',
    [hashRosterToken(token)],
  );
  if (!entry || entry.fullName !== fullName.normalize('NFC')) {
    fail(409, '学培注册链接无效、姓名不匹配或已使用');
  }
  await setTrainingUserAccess(db, userId, { staffRole: entry.staffRole, revoked: false }, false);
  await rows(
    db,
    'UPDATE training_roster SET claimed_by = ?, claimed_at = CURRENT_TIMESTAMP WHERE id = ?',
    [userId, entry.id],
  );
}

async function getAccess(db, user) {
  const access = await readTrainingUserAccess(db, user.id);
  const admin = Boolean(user.is_admin);
  return {
    admin,
    minister: admin || access?.staffRole === 'minister',
    staff: admin || Boolean(access?.staffRole),
    revoked: !admin && Boolean(access?.revoked),
  };
}

async function assignmentsByCourse(db, batchId = null) {
  const records = await rows(
    db,
    `SELECT a.course_id AS courseId, p.full_name AS fullName
    FROM training_assignments a JOIN training_applications p ON p.id = a.application_id
    JOIN training_batches b ON b.id = p.batch_id
    WHERE b.published_at IS NOT NULL ${batchId === null ? '' : 'AND b.id = ?'}
    ORDER BY a.application_id`,
    batchId === null ? [] : [batchId],
  );
  const names = new Map();
  records.forEach(({ courseId, fullName }) => {
    if (!names.has(courseId)) names.set(courseId, []);
    names.get(courseId).push(fullName);
  });
  return names;
}

function courseCard(course, lecturers) {
  const { id: courseId, title, teacher, startsAt, endsAt, location } = course;
  return {
    id: courseId,
    title,
    teacher,
    startsAt,
    endsAt,
    location,
    lecturers: lecturers.get(courseId) || [],
  };
}

async function getCourse(
  db,
  courseId,
  context,
  { lock = false, includeDraft = context.access.staff } = {},
) {
  if (context.access.revoked) fail(403, '你的课程查看权限已暂停');
  const course = await one(
    db,
    `SELECT c.id, c.batch_id AS batchId, c.title, c.teacher,
    c.starts_at AS startsAt, c.ends_at AS endsAt, c.location, c.feedback_questions AS questions,
    c.feedback_version AS feedbackVersion, b.slug AS batchSlug, b.title AS batchTitle
    FROM training_courses c JOIN training_batches b ON b.id = c.batch_id
    WHERE c.id = ? AND ${COURSE_VISIBILITY}
    ${lock ? 'FOR UPDATE OF c' : ''}`,
    [courseId, includeDraft],
  );
  if (!course) fail(404, '课程不存在或尚未发布');
  const assigned = await one(
    db,
    `SELECT 1 FROM training_assignments a
    JOIN training_applications p ON p.id = a.application_id
    WHERE a.course_id = ? AND p.user_id = ?`,
    [courseId, context.user.id],
  );
  return {
    ...course,
    canEdit: context.access.staff || Boolean(assigned),
    canEditFeedback: context.access.minister,
  };
}

async function reviewData(db, batch, includeDetails = true) {
  const courses = await rows(
    db,
    `SELECT id, title, teacher, offered, capacity
    FROM training_courses WHERE batch_id = ? ORDER BY offered DESC, id`,
    [batch.id],
  );
  const applications = await rows(
    db,
    `SELECT id
    ${includeDetails ? ', full_name AS fullName, student_id AS studentId, email, introduction, signature' : ''}
    ${includeDetails && batch.publishedAt !== null ? ', is_lexue AS isLexue' : ''}
    FROM training_applications WHERE batch_id = ? ORDER BY id`,
    [batch.id],
  );
  const preferences = await rows(
    db,
    `SELECT application_id AS applicationId, course_id AS courseId, decision
    FROM training_preferences WHERE batch_id = ? ORDER BY preference_rank`,
    [batch.id],
  );
  const byId = new Map(
    applications.map((application) => {
      const item = application;
      item.preferences = [];
      return [item.id, item];
    }),
  );
  preferences.forEach(({ applicationId, courseId, decision }) => {
    byId.get(applicationId).preferences.push({ courseId, decision });
  });
  return { courses, applications };
}

function checkRevision(batch, value) {
  if (batch.revision !== value) fail(409, '排班数据已更新，请刷新页面后重新排班');
}

function ensureClosed(batch) {
  if (phase(batch) !== 'closed') fail(409, '仅可在报名截止后、录取发布前执行此操作');
}

function createTrainingRouter({ pool, requireAuth, notifications }) {
  const router = express.Router();
  const processHandout = createHandoutProcessor();

  function route(action) {
    return async (request, response) => {
      response.set('Cache-Control', 'private, no-store');
      try {
        const user = await requireAuth(request, response);
        if (!user) return;
        const access = await getAccess(pool, user);
        await action(request, response, { user, access });
      } catch (error) {
        if (!error.status) console.error('Training request failed:', error.code || error.message);
        if (!response.headersSent) {
          response.status(error.status || 500).json({
            message: error.status ? error.message : '学培课程服务暂时不可用',
          });
        }
      }
    };
  }

  router.get(
    '/',
    route(async (request, response, { access }) => {
      const manage = request.query.manage === '1';
      if (manage) requirePermission(access.staff);
      const [batches, courses, lecturers] = await Promise.all([
        rows(pool, `SELECT ${BATCH_FIELDS} FROM training_batches ORDER BY opens_at DESC, id DESC`),
        access.revoked
          ? []
          : rows(
              pool,
              `SELECT c.id, c.batch_id AS batchId, c.title, c.teacher,
        c.starts_at AS startsAt, c.ends_at AS endsAt, c.location
        FROM training_courses c JOIN training_batches b ON b.id = c.batch_id
        WHERE ${COURSE_VISIBILITY} ORDER BY c.id`,
              [manage],
            ),
        access.revoked ? new Map() : assignmentsByCourse(pool),
      ]);
      const cards = new Map();
      courses.forEach((course) => {
        if (!manage && !lecturers.has(course.id)) return;
        if (!cards.has(course.batchId)) cards.set(course.batchId, []);
        cards.get(course.batchId).push(courseCard(course, lecturers));
      });
      response.json({
        access,
        batches: batches.map(({ id: batchId, slug, title, opensAt, closesAt, publishedAt }) => ({
          slug,
          title,
          opensAt,
          closesAt,
          phase: phase({ opensAt, closesAt, publishedAt }),
          courses: cards.get(batchId) || [],
        })),
      });
    }),
  );

  router.get(
    '/roster',
    route(async (request, response, { access }) => {
      requirePermission(access.admin);
      const entries = await rows(
        pool,
        `SELECT id, full_name AS fullName, staff_role AS staffRole, claimed_at AS claimedAt
        FROM training_roster ORDER BY claimed_at IS NOT NULL, id DESC`,
      );
      response.json({ entries });
    }),
  );

  router.post(
    '/roster',
    route(async (request, response, { user, access }) => {
      requirePermission(access.admin);
      const { fullNames, staffRole } = request.body || {};
      if (!Array.isArray(fullNames) || fullNames.length < 1 || fullNames.length > 100) {
        fail(400, '每次可添加 1 至 100 个姓名');
      }
      if (!['member', 'minister'].includes(staffRole)) fail(400, '请选择有效的学培身份');
      const names = [...new Set(fullNames.map(rosterName))];
      const links = await transaction(pool, async (db) => {
        const created = [];
        for (const fullName of names) {
          const token = createRosterToken();
          const result = await rows(
            db,
            'INSERT INTO training_roster (full_name, staff_role, token_hash, created_by) VALUES (?, ?, ?, ?)',
            [fullName, staffRole, hashRosterToken(token), user.id],
          );
          created.push({ id: result.insertId, token });
        }
        return created;
      });
      response.status(201).json({ links });
    }),
  );

  router.post(
    '/roster/:id/link',
    route(async (request, response, { access }) => {
      requirePermission(access.admin);
      const token = createRosterToken();
      const result = await rows(
        pool,
        'UPDATE training_roster SET token_hash = ? WHERE id = ? AND claimed_at IS NULL',
        [hashRosterToken(token), id(request.params.id)],
      );
      if (!result.affectedRows) fail(404, '待领取的名单记录不存在');
      response.json({ token });
    }),
  );

  router.delete(
    '/roster/:id',
    route(async (request, response, { access }) => {
      requirePermission(access.admin);
      const result = await rows(
        pool,
        'DELETE FROM training_roster WHERE id = ? AND claimed_at IS NULL',
        [id(request.params.id)],
      );
      if (!result.affectedRows) fail(404, '待领取的名单记录不存在');
      response.json({ ok: true });
    }),
  );

  router.get(
    '/people',
    route(async (request, response, { access }) => {
      requirePermission(access.admin);
      const query = input(request.query.q, 64, '姓名、用户名或学号', true);
      const users = await rows(
        pool,
        `SELECT u.id, u.full_name AS fullName, u.username,
      u.student_id AS studentId, u.is_admin AS admin, a.staff_role AS staffRole,
      COALESCE(a.viewing_revoked, 0) AS revoked
      FROM users u LEFT JOIN training_user_access a ON a.user_id = u.id
      WHERE (a.staff_role IS NOT NULL OR a.viewing_revoked = 1 OR ? <> '')
        AND (LOCATE(?, u.full_name) > 0 OR LOCATE(?, u.username) > 0 OR LOCATE(?, u.student_id) > 0)
      ORDER BY a.staff_role IS NULL, u.full_name, u.id LIMIT 100`,
        [query, query, query, query],
      );
      response.json({ users });
    }),
  );

  router.put(
    '/people/:id',
    route(async (request, response, { access }) => {
      requirePermission(access.admin);
      const userId = id(request.params.id);
      const user = await one(pool, 'SELECT is_admin FROM users WHERE id = ?', [userId]);
      if (!user) fail(404, '用户不存在');
      await setTrainingUserAccess(pool, userId, request.body, user.is_admin);
      response.json({ message: '权限已保存' });
    }),
  );

  router.post(
    '/batches',
    route(async (request, response, { access }) => {
      requirePermission(access.minister);
      const title = input(request.body.title, 100, '批次名称');
      const opensAt = timestamp(request.body.opensAt, '报名开始时间');
      const closesAt = timestamp(request.body.closesAt, '报名截止时间');
      if (closesAt <= opensAt || closesAt <= Date.now())
        fail(400, '截止时间必须晚于开始时间和当前时间');
      const { courses } = request.body;
      if (!Array.isArray(courses) || !courses.length || courses.length > MAX_COURSES) {
        fail(400, `请设置 1–${MAX_COURSES} 门课程`);
      }
      const offered = courses.map((course) => {
        const name = input(course?.title, 100, '科目名称');
        return {
          name,
          key: subjectKey(name),
          teacher: input(course.teacher, 100, '任课老师', true),
          capacity: integer(course.capacity, 1, MAX_LECTURERS, '每门课可设置 1–20 个讲师名额'),
        };
      });
      if (new Set(offered.map(({ key }) => key)).size !== offered.length)
        fail(400, '报名科目不能重复');
      const slug = crypto.randomUUID();
      await transaction(pool, async (db) => {
        const batch = await rows(
          db,
          `INSERT INTO training_batches (slug, title, opens_at, closes_at)
        VALUES (?, ?, ?, ?)`,
          [slug, title, opensAt, closesAt],
        );
        for (const course of offered) {
          await rows(
            db,
            `INSERT INTO training_courses
          (batch_id, title, title_key, teacher, offered, capacity, feedback_questions)
          VALUES (?, ?, ?, ?, 1, ?, ?)`,
            [
              batch.insertId,
              course.name,
              course.key,
              course.teacher,
              course.capacity,
              JSON.stringify(DEFAULT_QUESTIONS),
            ],
          );
        }
      });
      response.status(201).json({ slug });
    }),
  );

  router.get(
    '/batches/:slug',
    route(async (request, response, { user }) => {
      const batch = await batchBySlug(pool, request.params.slug);
      const currentPhase = phase(batch);
      const [courses, application] = await Promise.all([
        currentPhase === 'open'
          ? rows(
              pool,
              'SELECT id, title FROM training_courses WHERE batch_id = ? AND offered = 1 ORDER BY id',
              [batch.id],
            )
          : [],
        one(
          pool,
          `SELECT a.id, a.submitted_at AS submittedAt, c.title AS assignedCourse
        FROM training_applications a LEFT JOIN training_assignments ta ON ta.application_id = a.id
        LEFT JOIN training_courses c ON c.id = ta.course_id WHERE a.batch_id = ? AND a.user_id = ?`,
          [batch.id, user.id],
        ),
      ]);
      response.json({
        title: batch.title,
        opensAt: batch.opensAt,
        closesAt: batch.closesAt,
        phase: currentPhase,
        courses,
        application: application || null,
        fullName: user.full_name,
      });
    }),
  );

  router.post(
    '/batches/:slug/close',
    route(async (request, response, { access }) => {
      requirePermission(access.admin);
      const closesAt = await transaction(pool, async (db) => {
        const batch = await batchBySlug(db, request.params.slug, true);
        const now = Date.now();
        const currentPhase = phase(batch, now);
        if (currentPhase === 'upcoming') fail(409, '报名尚未开始');
        if (currentPhase !== 'open') return batch.closesAt;
        await rows(
          db,
          'UPDATE training_batches SET closes_at = ?, revision = revision + 1 WHERE id = ?',
          [now, batch.id],
        );
        return now;
      });
      response.json({ message: '报名已截止', closesAt });
    }),
  );

  router.post(
    '/batches/:slug/applications',
    route(async (request, response, { user }) => {
      const introduction = input(request.body.introduction, 5000, '自我介绍');
      const signed = signature(request.body.signature);
      const { isLexue, preferences } = request.body;
      if (typeof isLexue !== 'boolean') fail(400, '请选择是否为乐学讲师');
      if (
        !Array.isArray(preferences) ||
        !preferences.length ||
        preferences.length > MAX_PREFERENCES
      ) {
        fail(400, `请按志愿顺位填写 1–${MAX_PREFERENCES} 个科目`);
      }
      await transaction(pool, async (db) => {
        const batch = await batchBySlug(db, request.params.slug, true);
        if (phase(batch) !== 'open') fail(409, '当前批次未在报名时间内');
        const existing = await one(
          db,
          'SELECT id FROM training_applications WHERE batch_id = ? AND user_id = ?',
          [batch.id, user.id],
        );
        if (existing) fail(409, '你已填写本期讲师报名问卷');
        const courses = await rows(
          db,
          'SELECT id, title_key AS titleKey, offered FROM training_courses WHERE batch_id = ?',
          [batch.id],
        );
        const byId = new Map(
          courses.filter(({ offered }) => offered).map((course) => [course.id, course]),
        );
        const byTitle = new Map(courses.map((course) => [course.titleKey, course]));
        const chosen = new Set();
        for (const preference of preferences) {
          let course;
          if (typeof preference === 'number') {
            course = byId.get(id(preference));
            if (!course) fail(400, '所选报名科目不存在');
          } else {
            const title = input(preference, 100, '自选科目名称');
            const key = subjectKey(title);
            course = byTitle.get(key);
            if (!course) {
              const result = await rows(
                db,
                `INSERT INTO training_courses
              (batch_id, title, title_key, feedback_questions) VALUES (?, ?, ?, ?)`,
                [batch.id, title, key, JSON.stringify(DEFAULT_QUESTIONS)],
              );
              course = { id: result.insertId };
              byTitle.set(key, course);
            }
          }
          if (chosen.has(course.id)) fail(400, '报名科目不能重复');
          chosen.add(course.id);
        }
        const application = await rows(
          db,
          `INSERT INTO training_applications
        (batch_id, user_id, full_name, student_id, email, introduction, is_lexue, signature, submitted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            batch.id,
            user.id,
            user.full_name,
            user.student_id,
            user.email,
            introduction,
            isLexue,
            signed,
            Date.now(),
          ],
        );
        let rank = 1;
        for (const courseId of chosen) {
          await rows(
            db,
            `INSERT INTO training_preferences
          (batch_id, application_id, course_id, preference_rank) VALUES (?, ?, ?, ?)`,
            [batch.id, application.insertId, courseId, rank],
          );
          rank += 1;
        }
        await notifications.notifyInApp(db, [user.id], {
          kind: 'training',
          title: '讲师报名问卷填写成功',
          body: `已收到「${batch.title}」讲师报名问卷。录取结果发布后可在学培课程页面查看。`,
          link: `/training?apply=${batch.slug}`,
          eventKey: `training-application:${application.insertId}`,
        });
      });
      response.status(201).json({ message: '报名问卷已提交' });
    }),
  );

  router.get(
    '/batches/:slug/review',
    route(async (request, response, { access }) => {
      requirePermission(access.minister);
      const data = await transaction(pool, async (db) => {
        const batch = await batchBySlug(db, request.params.slug);
        if (!['closed', 'published'].includes(phase(batch))) fail(409, '报名截止后可查看报名情况');
        const review = await reviewData(db, batch);
        const published =
          batch.publishedAt === null
            ? null
            : {
                ...(await one(
                  db,
                  'SELECT publication_signature AS signature FROM training_batches WHERE id = ?',
                  [batch.id],
                )),
                assignments: await rows(
                  db,
                  `SELECT a.application_id AS applicationId, a.course_id AS courseId
          FROM training_assignments a JOIN training_applications p ON p.id = a.application_id
          WHERE p.batch_id = ? ORDER BY a.application_id`,
                  [batch.id],
                ),
              };
        return { batch, ...review, published };
      });
      response.json(data);
    }),
  );

  router.put(
    '/batches/:slug/courses/:id',
    route(async (request, response, { access }) => {
      requirePermission(access.minister);
      const capacity = integer(request.body.capacity, 0, MAX_LECTURERS, '讲师名额应为 0–20');
      const teacher = input(request.body.teacher, 100, '任课老师', true);
      await transaction(pool, async (db) => {
        const batch = await batchBySlug(db, request.params.slug, true);
        ensureClosed(batch);
        checkRevision(batch, request.body.revision);
        const course = await one(
          db,
          'SELECT id, offered FROM training_courses WHERE batch_id = ? AND id = ?',
          [batch.id, id(request.params.id)],
        );
        if (!course) fail(404, '报名科目不存在');
        if (
          !capacity &&
          (course.offered ||
            (await one(
              db,
              "SELECT 1 FROM training_preferences WHERE course_id = ? AND decision = 'accept' LIMIT 1",
              [course.id],
            )))
        ) {
          fail(400, '已列入报名或已有保送的科目至少需要一个讲师名额');
        }
        await rows(db, 'UPDATE training_courses SET capacity = ?, teacher = ? WHERE id = ?', [
          capacity,
          teacher,
          course.id,
        ]);
        await rows(db, 'UPDATE training_batches SET revision = revision + 1 WHERE id = ?', [
          batch.id,
        ]);
      });
      response.json({ message: '科目已更新' });
    }),
  );

  router.put(
    '/batches/:slug/applications/:applicationId/preferences/:courseId',
    route(async (request, response, { access }) => {
      requirePermission(access.minister);
      const { decision, revision } = request.body;
      if (![null, 'accept', 'deny'].includes(decision)) fail(400, '无效审核决定');
      await transaction(pool, async (db) => {
        const batch = await batchBySlug(db, request.params.slug, true);
        ensureClosed(batch);
        checkRevision(batch, revision);
        const applicationId = id(request.params.applicationId);
        const courseId = id(request.params.courseId);
        const preference = await one(
          db,
          `SELECT c.capacity FROM training_preferences p
        JOIN training_courses c ON c.id = p.course_id
        WHERE p.batch_id = ? AND p.application_id = ? AND p.course_id = ?`,
          [batch.id, applicationId, courseId],
        );
        if (!preference) fail(404, '报名志愿不存在');
        if (decision === 'accept') {
          if (!preference.capacity) fail(400, '请先为该科目设置讲师名额');
          const existing = await one(
            db,
            `SELECT 1 FROM training_preferences
          WHERE batch_id = ? AND decision = 'accept' AND (
            (course_id = ? AND application_id <> ?) OR (application_id = ? AND course_id <> ?)
          ) LIMIT 1`,
            [batch.id, courseId, applicationId, applicationId, courseId],
          );
          if (existing) fail(409, '每门课最多保送一人，每位申请者最多保送一门课');
        }
        await rows(
          db,
          'UPDATE training_preferences SET decision = ? WHERE application_id = ? AND course_id = ?',
          [decision, applicationId, courseId],
        );
        await rows(db, 'UPDATE training_batches SET revision = revision + 1 WHERE id = ?', [
          batch.id,
        ]);
      });
      response.json({ message: '审核决定已保存' });
    }),
  );

  function scheduling(publish) {
    return route(async (request, response, { access, user }) => {
      requirePermission(access.minister);
      const { revision, choices = {} } = request.body;
      if (!choices || typeof choices !== 'object' || Array.isArray(choices))
        fail(400, '无效冲突选择');
      const signed = publish ? JSON.parse(signature(request.body.signature)) : null;
      const result = await transaction(pool, async (db) => {
        const batch = await batchBySlug(db, request.params.slug, true);
        ensureClosed(batch);
        checkRevision(batch, revision);
        const { courses, applications } = await reviewData(db, batch, false);
        const schedule = makeSchedule(courses, applications, choices);
        if (!publish || schedule.conflict) return schedule;
        await rows(
          db,
          `UPDATE training_batches SET published_at = ?, published_by = ?,
          publication_signature = ?, revision = revision + 1 WHERE id = ?`,
          [
            Date.now(),
            user.id,
            JSON.stringify({ fullName: user.full_name, strokes: signed }),
            batch.id,
          ],
        );
        const byId = new Map(courses.map((course) => [course.id, course]));
        for (const { applicationId, courseId } of schedule.assignments) {
          await rows(
            db,
            'INSERT INTO training_assignments (application_id, course_id) VALUES (?, ?)',
            [applicationId, courseId],
          );
        }
        const accepted = await rows(
          db,
          `SELECT p.user_id AS userId, a.course_id AS courseId
          FROM training_assignments a JOIN training_applications p ON p.id = a.application_id
          WHERE p.batch_id = ?`,
          [batch.id],
        );
        for (const { userId, courseId } of accepted) {
          await notifications.notifyInApp(db, [userId], {
            kind: 'training',
            title: '讲师报名录取成功',
            body: `你已被录取为「${batch.title}」的「${byId.get(courseId).title}」讲师。`,
            link: `/training?course=${courseId}`,
            eventKey: `training-admission:${batch.id}`,
          });
        }
        return schedule;
      });
      if (publish && result.conflict) fail(409, '请先完成所有排班冲突的选择');
      response.json(result);
    });
  }

  router.post('/batches/:slug/schedule', scheduling(false));
  router.post('/batches/:slug/publish', scheduling(true));

  router.get(
    '/courses/:id',
    route(async (request, response, context) => {
      const courseId = id(request.params.id);
      const manage = request.query.manage === '1';
      const course = await getCourse(pool, courseId, context, {
        includeDraft: manage && context.access.staff,
      });
      if (manage) requirePermission(course.canEdit);
      const [lecturers, materials, feedback] = await Promise.all([
        assignmentsByCourse(pool, course.batchId),
        rows(
          pool,
          'SELECT id, title, kind, replay_url AS replayUrl FROM training_materials WHERE course_id = ? ORDER BY id',
          [courseId],
        ),
        one(pool, 'SELECT 1 FROM training_feedback WHERE course_id = ? AND user_id = ?', [
          courseId,
          context.user.id,
        ]),
      ]);
      response.json({
        ...courseCard(course, lecturers),
        batchTitle: course.batchTitle,
        batchSlug: course.batchSlug,
        materials,
        canEdit: course.canEdit,
        canEditFeedback: course.canEditFeedback,
        canEditTeacher: context.access.staff,
        questions: course.questions,
        feedbackVersion: course.feedbackVersion,
        feedbackOpen: course.endsAt !== null && Date.now() >= course.endsAt,
        feedbackSubmitted: Boolean(feedback),
      });
    }),
  );

  router.put(
    '/courses/:id/session',
    route(async (request, response, context) => {
      const startsAt = timestamp(request.body.startsAt, '上课时间');
      const endsAt = timestamp(request.body.endsAt, '下课时间');
      const location = input(request.body.location, 160, '上课地点');
      if (endsAt <= startsAt) fail(400, '下课时间必须晚于上课时间');
      await transaction(pool, async (db) => {
        const course = await getCourse(db, id(request.params.id), context, { lock: true });
        requirePermission(course.canEdit);
        const teacher =
          context.access.staff && request.body.teacher !== undefined
            ? input(request.body.teacher, 100, '任课老师', true)
            : course.teacher;
        await rows(
          db,
          'UPDATE training_courses SET starts_at = ?, ends_at = ?, location = ?, teacher = ? WHERE id = ?',
          [startsAt, endsAt, location, teacher, course.id],
        );
      });
      response.json({ message: '上课安排已保存' });
    }),
  );

  router.post(
    '/courses/:id/materials',
    route(async (request, response, context) => {
      const courseId = id(request.params.id);
      const course = await getCourse(pool, courseId, context);
      requirePermission(course.canEdit);
      const title = input(request.body.title, 180, '资料名称');
      const { kind } = request.body;
      let url = null;
      let pdf = null;
      if (kind === 'replay') {
        url = replayUrl(request.body.replayUrl);
      } else if (kind === 'pdf') {
        const { content } = request.body;
        if (
          typeof content !== 'string' ||
          content.length > Math.ceil(MAX_PDF_BYTES / 3) * 4 ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(content) ||
          content.length % 4 !== 0
        ) {
          fail(400, '请选择不超过 12 MB 的 PDF、JPG 或 PNG 讲义');
        }
        pdf = Buffer.from(content, 'base64');
        if (pdf.length > MAX_PDF_BYTES) fail(400, '讲义大小不能超过 12 MB');
        if (pdf.subarray(0, 5).toString() === '%PDF-') {
          await processHandout(pdf);
        } else {
          pdf = await processHandout(pdf, null, 'image');
        }
      } else {
        fail(400, '请选择 PDF 讲义或腾讯会议回放');
      }
      const result = await rows(
        pool,
        'INSERT INTO training_materials (course_id, title, kind, replay_url, pdf) VALUES (?, ?, ?, ?, ?)',
        [courseId, title, kind, url, pdf],
      );
      response.status(201).json({ id: result.insertId });
    }),
  );

  router.delete(
    '/courses/:id/materials/:materialId',
    route(async (request, response, context) => {
      const course = await getCourse(pool, id(request.params.id), context);
      requirePermission(course.canEdit);
      const result = await rows(
        pool,
        'DELETE FROM training_materials WHERE id = ? AND course_id = ?',
        [id(request.params.materialId), course.id],
      );
      if (!result.affectedRows) fail(404, '资料不存在');
      response.status(204).end();
    }),
  );

  router.post(
    '/courses/:id/materials/:materialId/download',
    route(async (request, response, context) => {
      const course = await getCourse(pool, id(request.params.id), context);
      if (request.body.acknowledged !== true) fail(400, '请先确认讲义下载须知');
      const materialId = id(request.params.materialId);
      const material = await one(
        pool,
        'SELECT title, pdf FROM training_materials WHERE id = ? AND course_id = ? AND kind = ?',
        [materialId, course.id, 'pdf'],
      );
      if (!material) fail(404, '讲义不存在');
      const document = await processHandout(material.pdf, {
        fullName: context.user.full_name,
        studentId: context.user.student_id,
      });
      requirePermission(!(await getAccess(pool, context.user)).revoked);
      if (!(await one(pool, 'SELECT 1 FROM training_materials WHERE id = ?', [materialId])))
        fail(404, '讲义不存在');
      const filename = material.title.replace(/[\r\n/\\]/g, ' ').replace(/\.pdf$/i, '');
      response.attachment(`${filename}.pdf`).send(document);
    }),
  );

  router.put(
    '/courses/:id/feedback/questions',
    route(async (request, response, context) => {
      const { questions, feedbackVersion } = request.body;
      if (!Array.isArray(questions) || !questions.length || questions.length > 12) {
        fail(400, '请设置 1–12 道评分题');
      }
      const titles = questions.map((question) => input(question, 120, '评分题'));
      if (new Set(titles).size !== titles.length) fail(400, '评分题不能重复');
      await transaction(pool, async (db) => {
        const course = await getCourse(db, id(request.params.id), context, { lock: true });
        requirePermission(course.canEditFeedback);
        if (course.feedbackVersion !== feedbackVersion) fail(409, '问卷已更新，请刷新页面');
        if (
          await one(db, 'SELECT 1 FROM training_feedback WHERE course_id = ? LIMIT 1', [course.id])
        ) {
          fail(409, '已经收到反馈，本期评分题已锁定');
        }
        await rows(
          db,
          `UPDATE training_courses SET feedback_questions = ?, feedback_version = feedback_version + 1
        WHERE id = ?`,
          [JSON.stringify(titles), course.id],
        );
      });
      response.json({ message: '反馈问卷已保存' });
    }),
  );

  router.post(
    '/courses/:id/feedback',
    route(async (request, response, context) => {
      const suggestion = input(request.body.suggestion, 2000, '其他建议和意见', true);
      const { scores, feedbackVersion } = request.body;
      await transaction(pool, async (db) => {
        const course = await getCourse(db, id(request.params.id), context, { lock: true });
        if (course.endsAt === null || Date.now() < course.endsAt) fail(409, '下课后可填写反馈问卷');
        if (course.feedbackVersion !== feedbackVersion) fail(409, '问卷已更新，请刷新页面');
        if (!Array.isArray(scores) || scores.length !== course.questions.length)
          fail(400, '请为每道题打分');
        scores.forEach((score) => integer(score, 1, 5, '请为每道题选择 1–5 分'));
        try {
          await rows(
            db,
            'INSERT INTO training_feedback (course_id, user_id, scores, suggestion) VALUES (?, ?, ?, ?)',
            [course.id, context.user.id, JSON.stringify(scores), suggestion],
          );
        } catch (error) {
          if (error.code === 'ER_DUP_ENTRY') fail(409, '你已填写本课程的反馈问卷');
          throw error;
        }
      });
      response.status(201).json({ message: '反馈已提交' });
    }),
  );

  router.get(
    '/courses/:id/feedback',
    route(async (request, response, context) => {
      const course = await getCourse(pool, id(request.params.id), context);
      requirePermission(course.canEdit);
      const feedback = await rows(
        pool,
        'SELECT scores, suggestion FROM training_feedback WHERE course_id = ? ORDER BY suggestion',
        [course.id],
      );
      const statistics = course.questions.map((question, index) => {
        const distribution = [0, 0, 0, 0, 0];
        let total = 0;
        feedback.forEach(({ scores }) => {
          const score = scores[index];
          distribution[score - 1] += 1;
          total += score;
        });
        return {
          question,
          distribution,
          average: feedback.length ? total / feedback.length : null,
        };
      });
      response.json({
        count: feedback.length,
        statistics,
        suggestions: feedback.map(({ suggestion }) => suggestion).filter(Boolean),
      });
    }),
  );

  return router;
}

async function ensureTrainingTables(pool) {
  for (const filename of ['074_training_courses.sql', '075_training_roster.sql']) {
    const migration = readFileSync(
      path.join(__dirname, '../database/migrations', filename),
      'utf8',
    );
    const statements = migration
      .split(';')
      .map((statement) => statement.trim())
      .filter(Boolean);
    for (const statement of statements) await pool.execute(statement);
  }
}

module.exports = {
  claimTrainingRoster,
  createTrainingRouter,
  ensureTrainingTables,
  setTrainingUserAccess,
};
