const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { parseAssessmentMarkdown } = require('./learning-assessment');
const { readFields } = require('../public/knowledge-overview');
const { isChapterNode } = require('../public/course-structure');

const COURSE_SCOPE = '@course';
const NODE_ID = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/;
const NODE_LABELS = {
  course_learning: '课程学习',
  self_learning: '自主学习',
  deep_mastery: '深入掌握',
};
const COURSE_LABELS = {
  course_lit: '课程点亮',
  complete_review: '完整复习',
  full_mastery: '全面掌握',
};
class LearningStarError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
function levelOf(node) {
  const fields = readFields(node.basic_info_markdown || node.sections?.basicInfoMarkdown);
  const raw = fields.level || node.metadata?.['知识点层级'] || node.level || '';
  const value = String(raw)
    .replace(/[*`"'\s]/g, '')
    .toLowerCase();
  if (['核心', 'core'].includes(value)) return 'core';
  if (['一般', 'general'].includes(value)) return 'general';
  if (['拓展', '拓展/选学', 'extension', 'elective'].includes(value)) return 'extension';
  return 'unknown';
}
function leafNodes(nodes) {
  return nodes.filter((node) => !isChapterNode({ id: node.node_id }));
}
function toAward(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    nodeId: row.node_id,
    key: row.star_key,
    documentVersion: row.document_version || null,
    questionVersion: row.question_version || null,
    earnedAt: row.earned_at,
    evidence:
      typeof row.evidence_json === 'string' ? JSON.parse(row.evidence_json) : row.evidence_json,
  };
}
async function ensureLearningStarTables(pool) {
  const sql = fs.readFileSync(
    path.join(__dirname, '../database/migrations/067_learning_stars.sql'),
    'utf8',
  );
  await pool.execute(sql.trim().replace(/;\s*$/, ''));
}
function createMysqlLearningStarStore(pool, transactional = false) {
  return {
    async transaction(work) {
      if (transactional) return work(this);
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const result = await work(createMysqlLearningStarStore(connection, true));
        await connection.commit();
        return result;
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    },
    async course(slug, id) {
      const [courses] = await pool.execute(
        `SELECT id, slug, name FROM courses WHERE ${id ? 'id' : 'slug'} = ? AND is_active = 1 LIMIT 1${transactional ? ' FOR UPDATE' : ''}`,
        [id || slug],
      );
      const course = courses[0];
      if (!course) return null;
      const [nodes] = await pool.execute(
        `SELECT n.course_id, n.node_id, n.title, n.document_markdown, s.basic_info_markdown
         FROM course_map_nodes n LEFT JOIN course_map_node_sections s
         ON s.course_id = n.course_id AND s.node_id = n.node_id
         WHERE n.course_id = ? ORDER BY n.node_id${transactional ? ' FOR UPDATE' : ''}`,
        [course.id],
      );
      return { ...course, nodes };
    },
    async awards(user, course) {
      const [rows] = await pool.execute(
        'SELECT id, node_id, star_key, document_version, question_version, evidence_json, earned_at FROM learning_star_awards WHERE user_id = ? AND course_id = ?',
        [user.id, course.id],
      );
      return rows.map(toAward);
    },
    async attempts(user, course, node) {
      const [rows] = await pool.execute(
        `SELECT id, question_id, question_version, document_version, status, verdict, is_official, updated_at
         FROM learning_assessment_attempts WHERE user_id = ? AND course_id = ? AND node_id = ?
         AND is_official = 1 ORDER BY id`,
        [user.id, course.id, node.node_id],
      );
      return rows;
    },
    async grant(
      user,
      course,
      nodeId,
      key,
      evidence,
      documentVersion = null,
      questionVersion = null,
    ) {
      if (!['self_learning', 'course_lit'].includes(key))
        throw new Error('Unsupported learning star');
      await pool.execute(
        'INSERT INTO learning_star_awards (user_id, course_id, node_id, star_key, document_version, question_version, evidence_json) VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE id = id',
        [
          user.id,
          course.id,
          nodeId,
          key,
          documentVersion,
          questionVersion,
          JSON.stringify(evidence),
        ],
      );
      const [rows] = await pool.execute(
        'SELECT id, node_id, star_key, document_version, question_version, evidence_json, earned_at FROM learning_star_awards WHERE user_id = ? AND course_id = ? AND node_id = ? AND star_key = ? LIMIT 1',
        [user.id, course.id, nodeId, key],
      );
      if (!rows[0]) throw new Error('Learning star award was not persisted');
      return toAward(rows[0]);
    },
  };
}

// Injected previews share the assessment store; never used as a production fallback.
function createMemoryLearningStarStore({ contexts = [], assessmentStore } = {}) {
  const rows = [];
  let pending = Promise.resolve();
  return {
    rows,
    contexts,
    transaction(work) {
      const operation = pending.then(async () => {
        const snapshot = rows.map((row) => ({ ...row }));
        try {
          return await work(this);
        } catch (error) {
          rows.splice(0, rows.length, ...snapshot);
          throw error;
        }
      });
      pending = operation.catch(() => {});
      return operation;
    },
    async course(slug, id) {
      const context = contexts.find(
        (node) =>
          (id ? String(node.course_id) === String(id) : node.slug === slug) &&
          node.is_active !== false &&
          node.is_active !== 0,
      );
      if (!context) return null;
      return {
        id: context.course_id,
        slug: context.slug,
        name: context.course_name || context.name || context.slug,
        nodes: contexts.filter((node) => String(node.course_id) === String(context.course_id)),
      };
    },
    async awards(user, course) {
      return rows
        .filter(
          (row) =>
            String(row.user_id) === String(user.id) && String(row.course_id) === String(course.id),
        )
        .map(toAward);
    },
    async attempts(user, course, node) {
      return (assessmentStore?.rows || []).filter(
        (row) =>
          String(row.user_id) === String(user.id) &&
          String(row.course_id) === String(course.id) &&
          row.node_id === node.node_id &&
          Boolean(row.is_official),
      );
    },
    async grant(
      user,
      course,
      nodeId,
      key,
      evidence,
      documentVersion = null,
      questionVersion = null,
    ) {
      if (!['self_learning', 'course_lit'].includes(key))
        throw new Error('Unsupported learning star');
      let row = rows.find(
        (item) =>
          String(item.user_id) === String(user.id) &&
          String(item.course_id) === String(course.id) &&
          item.node_id === nodeId &&
          item.star_key === key,
      );
      if (!row) {
        row = {
          id: String(rows.length + 1),
          user_id: user.id,
          course_id: course.id,
          node_id: nodeId,
          star_key: key,
          document_version: documentVersion,
          question_version: questionVersion,
          evidence_json: JSON.stringify(evidence),
          earned_at: new Date().toISOString(),
        };
        rows.push(row);
      }
      return toAward(row);
    },
  };
}

async function selftestEvidence(store, user, course, node) {
  const assessment = parseAssessmentMarkdown(node.document_markdown);
  const { questions } = assessment;
  const attempts = questions.length ? await store.attempts(user, course, node) : [];
  const latest = questions
    .map(
      (question) =>
        attempts
          .filter((row) => row.question_id === question.id && Boolean(row.is_official))
          .sort((a, b) => {
            if (BigInt(a.id) < BigInt(b.id)) return 1;
            if (BigInt(a.id) > BigInt(b.id)) return -1;
            return 0;
          })[0],
    )
    // Select the newest official attempt before checking versions. Otherwise
    // rolling a document back could resurrect an older pass over a newer failure.
    .filter(
      (row) =>
        row &&
        row.document_version === assessment.documentVersion &&
        row.question_version === assessment.questionVersion,
    );
  const evidence = latest.filter((row) => row.status === 'graded' && row.verdict === 'pass');
  const pending = latest.filter((row) => row.status === 'pending_review');
  return {
    assessment,
    evidence,
    summary: {
      available: questions.length > 0,
      questionCount: questions.length,
      passedQuestionCount: evidence.length,
      pendingReviewCount: pending.length,
      eligible: questions.length > 0 && evidence.length === questions.length,
      reason: questions.length ? '' : '未配置发布的正式自测',
    },
  };
}
function nodeModel(node, awards, selftest) {
  const level = levelOf(node);
  const own = awards.filter((award) => award.nodeId === node.node_id);
  const keys = level === 'extension' ? ['self_learning', 'deep_mastery'] : Object.keys(NODE_LABELS);
  return {
    nodeId: node.node_id,
    title: node.title,
    level,
    stars: keys.map((key) => {
      const award = own.find((item) => item.key === key);
      return {
        key,
        label: NODE_LABELS[key],
        earned: Boolean(award),
        available: key === 'self_learning' && selftest.summary.available,
        earnedAt: award?.earnedAt || null,
        historicalVersion: Boolean(
          award && award.documentVersion !== selftest.assessment.documentVersion,
        ),
        evidence: award?.evidence || null,
      };
    }),
    selftest: selftest.summary,
  };
}
function courseModel(course, nodes, awards) {
  const ordinary = nodes.filter((node) => ['core', 'general'].includes(node.level));
  const unknown = nodes.filter((node) => node.level === 'unknown');
  const lit = ordinary.filter((node) => node.stars.some((star) => star.earned));
  const currentScope = ordinary.map((node) => node.nodeId).sort();
  return {
    id: String(course.id),
    slug: course.slug,
    name: course.name,
    eligibleNodeCount: ordinary.length,
    litNodeCount: lit.length,
    unclassifiedNodeCount: unknown.length,
    stars: Object.keys(COURSE_LABELS).map((key) => {
      const award = awards.find((item) => item.nodeId === COURSE_SCOPE && item.key === key);
      return {
        key,
        label: COURSE_LABELS[key],
        earned: Boolean(award),
        available: key === 'course_lit' && ordinary.length > 0 && unknown.length === 0,
        earnedAt: award?.earnedAt || null,
        historicalScope: Boolean(
          award &&
          (unknown.length ||
            JSON.stringify((award.evidence.scopeNodeIds || []).slice().sort()) !==
              JSON.stringify(currentScope)),
        ),
        evidence: award?.evidence || null,
      };
    }),
  };
}
function createLearningStarService({ store }) {
  async function context(slug, point, scopedStore = store) {
    const course = await scopedStore.course(slug);
    if (!course) throw new LearningStarError(404, '课程不存在');
    if (point && !leafNodes(course.nodes).some((node) => node.node_id === point))
      throw new LearningStarError(404, '知识点不存在或为章节');
    return course;
  }
  async function snapshot(user, course, scopedStore = store) {
    const awards = await scopedStore.awards(user, course);
    const nodes = [];
    for (const node of leafNodes(course.nodes))
      nodes.push(nodeModel(node, awards, await selftestEvidence(scopedStore, user, course, node)));
    return { course: courseModel(course, nodes, awards), nodes };
  }
  async function reconcileCourse(user, course, scopedStore, point) {
    const node = leafNodes(course.nodes).find((item) => item.node_id === point);
    if (!node) throw new LearningStarError(404, '知识点不存在或为章节');
    let awards = await scopedStore.awards(user, course);
    const evidence = await selftestEvidence(scopedStore, user, course, node);
    const already = awards.some((item) => item.nodeId === point && item.key === 'self_learning');
    if (evidence.summary.eligible && !already) {
      await scopedStore.grant(
        user,
        course,
        point,
        'self_learning',
        {
          source: 'published_final_selftest',
          rule: 'all_current_published_questions_passed',
          documentVersion: evidence.assessment.documentVersion,
          questionVersion: evidence.assessment.questionVersion,
          questionIds: evidence.assessment.questions.map((question) => question.id),
          attemptIds: evidence.evidence.map((row) => String(row.id)),
          reviewedBy: evidence.assessment.reviewedBy,
        },
        evidence.assessment.documentVersion,
        evidence.assessment.questionVersion,
      );
      awards = await scopedStore.awards(user, course);
    }
    const leaves = leafNodes(course.nodes);
    const ordinary = leaves.filter((item) => ['core', 'general'].includes(levelOf(item)));
    if (
      ordinary.length &&
      !leaves.some((item) => levelOf(item) === 'unknown') &&
      ordinary.every((item) =>
        awards.some((award) => award.nodeId === item.node_id && award.key === 'self_learning'),
      )
    ) {
      await scopedStore.grant(user, course, COURSE_SCOPE, 'course_lit', {
        source: 'all_non_extension_nodes_have_star',
        scopeNodeIds: ordinary.map((item) => item.node_id).sort(),
        nodeAwardIds: ordinary.map(
          (item) =>
            awards.find((award) => award.nodeId === item.node_id && award.key === 'self_learning')
              .id,
        ),
      });
    }
    const result = await snapshot(user, course, scopedStore);
    return {
      course: result.course,
      node: result.nodes.find((item) => item.nodeId === point),
      awarded: !already && evidence.summary.eligible,
    };
  }
  return {
    async course(user, slug) {
      return snapshot(user, await context(slug));
    },
    async node(user, slug, point) {
      const result = await snapshot(user, await context(slug, point));
      return { course: result.course, node: result.nodes.find((item) => item.nodeId === point) };
    },
    async reconcile(user, slug, point) {
      return store.transaction(async (scopedStore) =>
        reconcileCourse(user, await context(slug, point, scopedStore), scopedStore, point),
      );
    },
    async recordAssessment({ user, context: assessmentContext, attempt }) {
      if (!attempt?.official || attempt.status !== 'graded' || attempt.verdict !== 'pass')
        return null;
      const owner = { id: attempt.userId || user.id };
      return store.transaction(async (scopedStore) => {
        const course = await scopedStore.course(null, assessmentContext.course_id);
        if (!course) return null;
        // Ownership and grading are independently checked against persisted attempts.
        return reconcileCourse(owner, course, scopedStore, assessmentContext.node_id);
      });
    },
  };
}
function createLearningStarsRouter({
  requireAuth,
  pool,
  store = createMysqlLearningStarStore(pool),
  service = createLearningStarService({ store }),
}) {
  const router = express.Router();
  const route = (handler) => async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    try {
      const user = await requireAuth(req, res);
      if (!user) return;
      const { slug, point } = req.params;
      if (!SLUG.test(slug) || (point !== undefined && (!NODE_ID.test(point) || point.length > 64)))
        throw new LearningStarError(400, '课程或知识点编号无效');
      if (
        Object.keys(req.query).length ||
        (req.body &&
          (typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length))
      )
        throw new LearningStarError(400, '星级由正式学习证据判定，不接受额外参数');
      await handler(req, res, user);
    } catch (error) {
      if (!error.status) console.error('Learning stars request failed:', error.code || error.name);
      if (!res.headersSent)
        res
          .status(error.status || 500)
          .json({ message: error.status ? error.message : '学习星服务暂时不可用，请稍后重试' });
    }
  };
  router.get(
    '/:slug',
    route(async (req, res, user) => res.json(await service.course(user, req.params.slug))),
  );
  router.get(
    '/:slug/:point',
    route(async (req, res, user) =>
      res.json(await service.node(user, req.params.slug, req.params.point)),
    ),
  );
  router.post(
    '/:slug/:point/reconcile',
    route(async (req, res, user) =>
      res.json(await service.reconcile(user, req.params.slug, req.params.point)),
    ),
  );
  return router;
}
module.exports = {
  LearningStarError,
  ensureLearningStarTables,
  createMysqlLearningStarStore,
  createMemoryLearningStarStore,
  createLearningStarService,
  createLearningStarsRouter,
  levelOf,
};
