const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildRelations,
  normalizeSnapshotRow,
  readRagCourseSnapshot,
} = require('./rag-course-snapshot');

test('maps directed and related course edges onto both knowledge nodes', () => {
  const relations = buildRelations([
    {
      course_id: 7,
      source_node_id: 'SS-01',
      source_title: '信号',
      target_node_id: 'SS-02',
      target_title: '系统',
      relation_type: 'ordered',
    },
  ]);

  assert.deepEqual(relations.get('7:SS-01'), [
    {
      direction: 'outgoing',
      type: 'ordered',
      nodeId: 'SS-02',
      title: '系统',
    },
  ]);
  assert.deepEqual(relations.get('7:SS-02'), [
    {
      direction: 'incoming',
      type: 'ordered',
      nodeId: 'SS-01',
      title: '信号',
    },
  ]);
});

test('normalizes course snapshot rows without leaking database field names', () => {
  const row = normalizeSnapshotRow(
    {
      course_id: 7,
      course_slug: 'signals',
      course_name: '信号系统',
      course_code: 'Signals and Systems',
      course_summary: '课程摘要',
      node_id: 'SS-01',
      title: '连续时间信号',
      summary: '知识点摘要',
      knowledge_markdown: '核心知识',
      basic_info_markdown: '基本信息',
      applications_markdown: '应用',
      content_updated_at: new Date('2026-08-28T00:00:00.000Z'),
    },
    new Map(),
  );

  assert.equal(row.courseSlug, 'signals');
  assert.equal(row.nodeId, 'SS-01');
  assert.equal(row.updatedAt, '2026-08-28T00:00:00.000Z');
  assert.deepEqual(row.relations, []);
  assert.equal(Object.hasOwn(row, 'course_id'), false);
});

test('reads revision, course content and relations in one transaction', async () => {
  const calls = [];
  const connection = {
    async query(statement) {
      calls.push(statement);
    },
    async beginTransaction() {
      calls.push('BEGIN');
    },
    async commit() {
      calls.push('COMMIT');
    },
    async rollback() {
      calls.push('ROLLBACK');
    },
    release() {
      calls.push('RELEASE');
    },
    async execute(statement) {
      if (statement.includes('FROM rag_index_state')) {
        return [[{ requested_revision: 12, requested_at: '2026-08-28T08:00:00Z' }]];
      }
      if (statement.includes('FROM courses c') && statement.includes('course_map_nodes n')) {
        return [
          [
            {
              course_id: 7,
              course_slug: 'signals',
              course_name: '信号系统',
              node_id: 'SS-01',
              title: '信号',
              knowledge_markdown: '正文',
              content_updated_at: '2026-08-28T08:00:00Z',
            },
          ],
        ];
      }
      if (statement.includes('FROM course_map_edges e')) {
        return [[]];
      }
      throw new Error(`unexpected query: ${statement}`);
    },
  };
  const pool = {
    async getConnection() {
      return connection;
    },
  };

  const snapshot = await readRagCourseSnapshot(pool);
  assert.equal(snapshot.revision, '12');
  assert.equal(snapshot.documents.length, 1);
  assert.equal(snapshot.documents[0].knowledgeMarkdown, '正文');
  assert.deepEqual(calls.slice(-2), ['COMMIT', 'RELEASE']);
  assert.equal(calls.includes('ROLLBACK'), false);
});
