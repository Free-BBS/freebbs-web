// Max receives published course text and a bounded summary of the authenticated learner's evidence.
// Neither chat, recommendations nor a self-report can change grading or stars.
const { parseAssessmentMarkdown, getAssessmentDocumentVersion } = require('./learning-assessment');
const { normalizePreference } = require('../public/learning-start');
const { originMarkdown } = require('../public/learning-content');
const { resolveKnowledgeSections, isValidNodeId } = require('./course-maps');

function normalizeTask(raw, questions = []) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const tool = [
    'content',
    'notes',
    'feedback',
    'discussion',
    'continue',
    'resources',
    'contribute',
  ].includes(raw.tool)
    ? raw.tool
    : 'content';
  const quizView =
    tool === 'feedback' && ['practice', 'quick', 'mistakes'].includes(raw.quizView)
      ? raw.quizView
      : '';
  const question = questions.find((item) => item.id === raw.questionId);
  return {
    tool,
    ...(quizView ? { quizView } : {}),
    ...(raw.view === 'origin' && tool === 'content' ? { view: 'origin' } : {}),
    ...(question
      ? {
          questionId: question.id,
          questionTitle: question.prompt,
          ...(question.difficulty ? { difficulty: question.difficulty } : {}),
        }
      : {}),
  };
}

function summarizeEvidence(assessment, attempts) {
  const questions = assessment.questions || [];
  const byId = new Map(questions.map((question) => [question.id, question]));
  const latest = new Map();
  for (const attempt of attempts) {
    const question = byId.get(attempt.questionId);
    if (!question || attempt.official !== true || latest.has(question.id)) continue;
    // The authenticated store returns newest first. Select the newest formal
    // attempt before checking versions, as grading and star evidence do, so a
    // rollback cannot revive an older pass over a newer failure or pending review.
    latest.set(question.id, attempt);
  }
  const records = [...latest.values()].filter(
    (attempt) =>
      attempt.documentVersion === assessment.documentVersion &&
      attempt.questionVersion === byId.get(attempt.questionId).questionVersion,
  );
  return {
    officialTotal: questions.length,
    observed: records.length,
    passed: records.filter((item) => item.status === 'graded' && item.verdict === 'pass').length,
    failed: records.filter((item) => item.status === 'graded' && item.verdict === 'fail').length,
    pending: records.filter((item) => item.status === 'pending_review').length,
    source: 'authenticated_current_version_recent_records',
    limited: attempts.length >= 51,
  };
}

function companionHint(context) {
  const evidence = context.learningEvidence;
  const task = context.learningTask;
  return [
    '你是辅助老师。以课程审核内容为依据，区分已知结论、条件和推测；缺少依据时说明不确定。',
    '学生需要基础支持时，从必要术语和最基本原理细致讲解，分步示范并解释原因，不只反问。已有经验者减少重复，提供条件、反例、联系或可检验的探索问题。',
    '用户可随时改变目标、直接查阅或探索；不要要求先拿星或把点击、阅读时间、聊天轮数当作掌握。不要宣称你的临时题、回答或评分会授星；正式自测按课程规则和人工复核独立进行。',
    evidence
      ? `本人的近期正式题证据（当前正文/题目版本，非全面能力）：共${evidence.officialTotal}题，本次读取见到${evidence.observed}题记录，通过${evidence.passed}，未通过${evidence.failed}，待人工复核${evidence.pending}。${evidence.limited ? '只读取最近51条作答，缺失不代表未做；不据此认定全部通过。' : '没有记录表示未知，待复核不表示失败。'}`
      : '',
    task
      ? `当前主动打开的入口：${task.tool}${task.quizView ? ` / ${task.quizView}` : ''}${task.view ? ` / ${task.view}` : ''}。${task.questionId ? `题号：${task.questionId}；题干：${task.questionTitle}` : ''}`
      : '',
    '私人批注不自动读取；只使用学生在当前问题中主动提供的文字。不要泄露或索取其他人的记录。',
  ]
    .filter(Boolean)
    .join('\n');
}

async function loadCompanionContext({ store, user, rawContext, loadNode }) {
  const raw =
    rawContext && typeof rawContext === 'object' && !Array.isArray(rawContext) ? rawContext : {};
  const slug = typeof raw.courseSlug === 'string' ? raw.courseSlug : '';
  const point = typeof raw.knowledgePointId === 'string' ? raw.knowledgePointId : '';
  if (!/^[a-z0-9][a-z0-9-]{0,119}$/.test(slug) || !isValidNodeId(point)) {
    const error = new Error('课程或知识点标识无效');
    error.status = 400;
    throw error;
  }
  const node = loadNode ? await loadNode(slug, point) : await store.context(slug, point);
  if (!node) {
    const error = new Error('课程或知识点不存在');
    error.status = 404;
    throw error;
  }
  const assessment = parseAssessmentMarkdown(node.document_markdown);
  const assessmentContext = { ...node, node_id: node.node_id || point };
  const attempts = await store.list(user, assessmentContext, '', false);
  const sections = resolveKnowledgeSections(node, false);
  const markdown = sections.knowledgeMarkdown.slice(0, 30000);
  const allQuestions = [...assessment.questions, ...assessment.practiceQuestions];
  return {
    courseSlug: slug,
    courseName: node.course_name || slug,
    knowledgePointId: point,
    knowledgePointTitle: node.title || point,
    knowledgePointSummary: String(node.summary || '').slice(0, 2000),
    knowledgePointMarkdown: markdown,
    documentVersion: getAssessmentDocumentVersion(node.document_markdown),
    learningStartPreference: normalizePreference(raw.learningStartPreference),
    learningTask: normalizeTask(raw.learningTask, allQuestions),
    learningEvidence: summarizeEvidence(assessment, attempts),
    resources: {
      nodeTitle: node.title || point,
      hasContent: Boolean(markdown.trim()),
      hasOrigin: Boolean(originMarkdown(sections)),
      hasRelations: Number(node.has_relations) > 0,
      hasQuestions: allQuestions.length > 0,
    },
  };
}

function createMysqlCompanionNodeLoader(pool) {
  return async (slug, point) => {
    const [rows] = await pool.execute(
      `SELECT c.id AS course_id, c.name AS course_name, n.node_id, n.title, n.summary,
              n.document_markdown, s.knowledge_markdown, s.basic_info_markdown, s.applications_markdown,
              EXISTS(SELECT 1 FROM course_map_edges e WHERE e.course_id = c.id
                AND (e.source_node_id = n.node_id OR e.target_node_id = n.node_id)) AS has_relations
       FROM courses c JOIN course_map_nodes n ON n.course_id = c.id
       LEFT JOIN course_map_node_sections s ON s.course_id = n.course_id AND s.node_id = n.node_id
       WHERE c.slug = ? AND c.is_active = 1 AND n.node_id = ? LIMIT 1`,
      [slug, point],
    );
    return rows[0] || null;
  };
}

module.exports = {
  loadCompanionContext,
  normalizeTask,
  summarizeEvidence,
  companionHint,
  createMysqlCompanionNodeLoader,
};
