// Test/preview fixture only. Production always uses the authenticated MySQL store.
const { isDeepStrictEqual } = require('node:util');
const {
  LearningError,
  prepareEntryMetadata,
  documentVersion,
} = require('../../backend/learning-workspace');

function createMemoryLearningStore({ allowedPathTargets = null } = {}) {
  const rows = [];
  let serial = 0;
  const owned = (row, user, context) =>
    row.user === user.id && row.course === context.course_id && row.point === context.node_id;
  const record = ({ user, course, point, key, ...row }) => ({ ...row });
  function validatePathContext(entry, context) {
    const allowed = allowedPathTargets
      ? allowedPathTargets.get(String(context.course_id)) || new Set()
      : new Set(['SS-01-00', 'SS-01-01', 'SS-01-02']);
    if ((entry.path || []).some((step) => step.point && !allowed.has(step.point)))
      throw new LearningError(400, '学习路径中的目标必须属于当前课程');
  }
  return {
    rows,
    async context(slug, point) {
      return ['signals', 'circuits'].includes(slug) &&
        ['SS-01-00', 'SS-01-01', 'SS-01-02'].includes(point)
        ? {
            course_id: slug === 'signals' ? 1 : 2,
            node_id: point,
            title: '学习预览知识点',
            document_markdown: '学习预览正文',
            knowledge_markdown: '学习预览正文',
            basic_info_markdown: '',
            applications_markdown: '## 知识起源\n\n学习预览起源',
          }
        : null;
    },
    async canReview(user, context) {
      return user.is_admin || (user.id === 3 && context.course_id === 1);
    },
    async list(user, context, before, review, kind, annotationOnly = false) {
      return rows
        .filter(
          (row) =>
            row.course === context.course_id &&
            row.point === context.node_id &&
            (review
              ? row.kind === 'contribution' && row.status === 'pending'
              : row.user === user.id) &&
            (!kind || row.kind === kind) &&
            (!annotationOnly || (row.annotation && typeof row.annotation === 'object')) &&
            (!before || Number(row.id) < Number(before)),
        )
        .sort((a, b) => Number(b.id) - Number(a.id))
        .slice(0, 51)
        .map(record);
    },
    async create(user, context, entry, key) {
      validatePathContext(entry, context);
      const existing = rows.find((row) => row.user === user.id && row.key === key);
      if (existing) {
        if (
          !owned(existing, user, context) ||
          Object.entries(entry).some(([name, value]) => !isDeepStrictEqual(existing[name], value))
        )
          throw new LearningError(409, '提交标识已被使用');
        return record(existing);
      }
      serial += 1;
      const metadata = prepareEntryMetadata(entry, context);
      const row = {
        ...entry,
        ...metadata,
        id: String(serial),
        key,
        user: user.id,
        course: context.course_id,
        point: context.node_id,
        status: entry.kind === 'contribution' ? 'pending' : 'private',
        response: '',
        revision: 1,
        documentVersion: documentVersion(context),
        updatedAt: new Date().toISOString(),
      };
      rows.push(row);
      return record(row);
    },
    async update(user, context, id, entry, revision) {
      validatePathContext(entry, context);
      const row = rows.find(
        (item) =>
          item.id === id &&
          owned(item, user, context) &&
          item.kind === entry.kind &&
          ['note', 'path'].includes(item.kind) &&
          item.revision === revision,
      );
      if (!row) return false;
      const metadata = prepareEntryMetadata(entry, context, row);
      Object.assign(row, {
        title: entry.title,
        content: entry.content,
        ...metadata,
        ...(entry.kind === 'path' ? { documentVersion: documentVersion(context) } : {}),
        revision: revision + 1,
        updatedAt: new Date().toISOString(),
      });
      return true;
    },
    async remove(user, context, id, revision) {
      const index = rows.findIndex(
        (row) =>
          row.id === id &&
          owned(row, user, context) &&
          ['note', 'reflection', 'path'].includes(row.kind),
      );
      if (index < 0) return false;
      if (revision !== undefined && rows[index].revision !== revision)
        throw new LearningError(409, '个人记录已变更，请刷新后核对；当前内容不会丢失');
      rows.splice(index, 1);
      return true;
    },
    async review(user, context, id, status, response) {
      const row = rows.find(
        (item) =>
          item.id === id &&
          item.course === context.course_id &&
          item.point === context.node_id &&
          item.kind === 'contribution' &&
          item.status === 'pending',
      );
      if (!row) return false;
      Object.assign(row, {
        status,
        response,
        revision: row.revision + 1,
        updatedAt: new Date().toISOString(),
      });
      return true;
    },
  };
}
module.exports = { createMemoryLearningStore };
