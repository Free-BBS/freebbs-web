const express = require('express');
const fs = require('node:fs');
const path = require('node:path');

const MAX_TEACHING_COURSES = 20;
const COURSE_SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/;

function teacherError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function validUserId(value) {
  const id = Number(value);
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(id))
    throw teacherError(400, 'invalid_user', '用户编号无效');
  return id;
}

function normalizeTeachingCourses(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw teacherError(400, 'invalid_teaching_courses', '请提供任教课程');
  if (body.identityConfirmed !== true)
    throw teacherError(400, 'identity_confirmation_required', '请先核实教师身份与任教课程');
  if (!Array.isArray(body.courseSlugs) || body.courseSlugs.length > MAX_TEACHING_COURSES)
    throw teacherError(400, 'invalid_teaching_courses', '最多关联 20 门任教课程');
  const slugs = body.courseSlugs.map((value) => {
    if (typeof value !== 'string' || !COURSE_SLUG.test(value.trim().toLowerCase()))
      throw teacherError(400, 'invalid_teaching_courses', '任教课程标识无效');
    return value.trim().toLowerCase();
  });
  return [...new Set(slugs)];
}

function isVerifiedTeacher(user, certified) {
  return Boolean(user && (user.role === 'teacher' || certified === true));
}

function publicIdentity(user, certified) {
  return {
    role: user.role,
    certified: Boolean(certified),
    fullName: user.full_name || '',
  };
}

async function ensureTeacherParticipationTables(pool) {
  const sql = fs.readFileSync(
    path.join(__dirname, '../database/migrations/074_teacher_participation.sql'),
    'utf8',
  );
  await pool.query(sql.trim().replace(/;\s*$/, ''));
}

function createMysqlTeacherParticipationStore(pool, { now = () => Date.now() } = {}) {
  async function userById(executor, userId) {
    const [[user]] = await executor.execute(
      'SELECT id, role, full_name, is_admin FROM users WHERE id = ? LIMIT 1',
      [userId],
    );
    if (!user) throw teacherError(404, 'user_missing', '账号不存在');
    return user;
  }

  async function certifiedTeacher(executor, userId, lock = false) {
    const [[certification]] = await executor.execute(
      `SELECT slot FROM user_certifications WHERE user_id = ? AND slot = 'teacher' LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
      [userId],
    );
    return Boolean(certification);
  }

  async function requireDatabaseAdmin(executor, adminId) {
    const admin = await userById(executor, adminId);
    if (!admin.is_admin) throw teacherError(403, 'admin_required', '需要管理员权限');
    return admin;
  }

  async function activeCourses(executor) {
    const [courses] = await executor.execute(
      'SELECT slug, name, code FROM courses WHERE is_active = 1 ORDER BY sort_order, id',
    );
    return courses.map((course) => ({
      slug: course.slug,
      name: course.name,
      code: course.code || '',
    }));
  }

  return {
    async workspace(userId) {
      const user = await userById(pool, userId);
      const certified = await certifiedTeacher(pool, userId);
      const eligible = isVerifiedTeacher(user, certified);
      const identity = publicIdentity(user, certified);
      if (!eligible) return { eligible: false, identity, courses: [], feedback: [] };

      // Teaching association is display-only. Editing is a separate existing permission.
      const [courses] = await pool.execute(
        `SELECT c.slug, c.name, c.code,
                (? = 1 OR EXISTS (
                  SELECT 1 FROM course_material_managers m
                  WHERE m.course_id = c.id AND m.user_id = ?
                )) AS can_edit_materials
         FROM course_teaching_memberships t JOIN courses c ON c.id = t.course_id
         WHERE t.user_id = ? AND c.is_active = 1 ORDER BY c.sort_order, c.id`,
        [user.is_admin ? 1 : 0, userId, userId],
      );
      // Only explicitly submitted opinions owned by this account, never other people's notes.
      const [feedback] = await pool.execute(
        `SELECT e.id, c.slug AS course_slug, c.name AS course_name,
                e.node_id, n.title AS point_title, e.title, e.content, e.excerpt,
                e.category, e.status, e.review_response, e.updated_at, e.document_version
         FROM learning_entries e JOIN courses c ON c.id = e.course_id
         LEFT JOIN course_map_nodes n ON n.course_id = e.course_id AND n.node_id = e.node_id
         WHERE e.user_id = ? AND e.kind = 'contribution' AND c.is_active = 1
         ORDER BY e.id DESC LIMIT 20`,
        [userId],
      );
      return {
        eligible: true,
        identity,
        courses: courses.map((course) => ({
          slug: course.slug,
          name: course.name,
          code: course.code || '',
          canEditMaterials: Boolean(Number(course.can_edit_materials)),
        })),
        feedback: feedback.map((entry) => ({
          id: String(entry.id),
          courseSlug: entry.course_slug,
          courseName: entry.course_name,
          pointId: entry.node_id,
          pointTitle: entry.point_title || entry.node_id,
          title: entry.title,
          content: entry.content,
          excerpt: entry.excerpt || '',
          category: entry.category,
          status: entry.status,
          response: entry.review_response || '',
          updatedAt: entry.updated_at,
          documentVersion: entry.document_version,
        })),
      };
    },

    async adminRead(adminId, userId) {
      await requireDatabaseAdmin(pool, adminId);
      const user = await userById(pool, userId);
      const certified = await certifiedTeacher(pool, userId);
      const courses = await activeCourses(pool);
      const [assigned] = await pool.execute(
        `SELECT c.slug FROM course_teaching_memberships t JOIN courses c ON c.id = t.course_id
         WHERE t.user_id = ? ORDER BY c.sort_order, c.id`,
        [userId],
      );
      return {
        eligible: isVerifiedTeacher(user, certified),
        courses,
        courseSlugs: assigned.map((course) => course.slug),
      };
    },

    async replace(adminId, userId, courseSlugs) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        // Certification review takes the same user lock before changing teacher identity.
        const [users] = await connection.execute(
          'SELECT id, role, full_name, is_admin FROM users WHERE id IN (?, ?) ORDER BY id FOR UPDATE',
          [adminId, userId],
        );
        const admin = users.find((user) => Number(user.id) === adminId);
        const user = users.find((item) => Number(item.id) === userId);
        if (!admin?.is_admin) throw teacherError(403, 'admin_required', '需要管理员权限');
        if (!user) throw teacherError(404, 'user_missing', '账号不存在');
        const certified = await certifiedTeacher(connection, userId, true);
        if (courseSlugs.length && !isVerifiedTeacher(user, certified))
          throw teacherError(
            409,
            'verified_teacher_required',
            '请先完成教师身份核实，再关联任教课程',
          );

        let courses = [];
        if (courseSlugs.length) {
          [courses] = await connection.execute(
            `SELECT id, slug FROM courses WHERE is_active = 1 AND slug IN (${courseSlugs.map(() => '?').join(', ')}) ORDER BY id FOR UPDATE`,
            courseSlugs,
          );
          if (courses.length !== courseSlugs.length)
            throw teacherError(400, 'course_unavailable', '部分课程不存在或暂未开放，请刷新后选择');
        }
        await connection.execute('DELETE FROM course_teaching_memberships WHERE user_id = ?', [
          userId,
        ]);
        const assignedAt = new Date(now());
        for (const course of courses)
          await connection.execute(
            'INSERT INTO course_teaching_memberships (course_id, user_id, assigned_by, assigned_at) VALUES (?, ?, ?, ?)',
            [course.id, userId, adminId, assignedAt],
          );
        await connection.commit();
        return { courseSlugs };
      } catch (error) {
        await connection.rollback().catch(() => {});
        throw error;
      } finally {
        connection.release();
      }
    },
  };
}

function createTeacherParticipationRouter({
  pool,
  requireAuth,
  requireAdmin,
  store = createMysqlTeacherParticipationStore(pool),
  logger = console,
}) {
  const router = express.Router();
  function route(guard, work) {
    return async (request, response) => {
      response.set('Cache-Control', 'private, no-store');
      try {
        const user = await guard(request, response);
        if (!user) return;
        const userId = request.params.id === undefined ? null : validUserId(request.params.id);
        response.json(await work(request, user, userId));
      } catch (error) {
        if (!error.status)
          logger.error('Teacher participation request failed:', error.code || error.name);
        response.status(error.status || 503).json({
          code: error.status ? error.code : 'teacher_participation_unavailable',
          message: error.status ? error.message : '教学信息暂时不可用，请稍后重试',
        });
      }
    };
  }
  router.get(
    '/teacher/workspace',
    route(requireAuth, (_request, user) => store.workspace(Number(user.id))),
  );
  router.get(
    '/admin/users/:id/teaching-courses',
    route(requireAdmin, (_request, admin, userId) => store.adminRead(Number(admin.id), userId)),
  );
  router.put(
    '/admin/users/:id/teaching-courses',
    route(requireAdmin, (request, admin, userId) =>
      store.replace(Number(admin.id), userId, normalizeTeachingCourses(request.body)),
    ),
  );
  return router;
}

module.exports = {
  ensureTeacherParticipationTables,
  createTeacherParticipationRouter,
  createMysqlTeacherParticipationStore,
  normalizeTeachingCourses,
  isVerifiedTeacher,
};
