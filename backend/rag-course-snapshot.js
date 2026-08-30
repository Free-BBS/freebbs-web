const RAG_STATE_ROW_ID = 1;

function toIsoString(value) {
  if (!value) {
    return '';
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function normalizeSnapshotRow(row, relationsByNode) {
  const courseId = Number(row.course_id);
  const nodeId = String(row.node_id || '');
  const relationKey = `${courseId}:${nodeId}`;
  return {
    courseId,
    courseSlug: String(row.course_slug || ''),
    courseName: String(row.course_name || ''),
    courseCode: String(row.course_code || ''),
    courseSummary: String(row.course_summary || ''),
    nodeId,
    title: String(row.title || ''),
    summary: String(row.summary || ''),
    knowledgeMarkdown: String(row.knowledge_markdown || ''),
    basicInfoMarkdown: String(row.basic_info_markdown || ''),
    applicationsMarkdown: String(row.applications_markdown || ''),
    updatedAt: toIsoString(row.content_updated_at),
    relations: relationsByNode.get(relationKey) || [],
  };
}

function addRelation(relationsByNode, key, relation) {
  const relations = relationsByNode.get(key) || [];
  relations.push(relation);
  relationsByNode.set(key, relations);
}

function buildRelations(edgeRows) {
  const relationsByNode = new Map();
  edgeRows.forEach((row) => {
    const courseId = Number(row.course_id);
    const sourceNodeId = String(row.source_node_id || '');
    const targetNodeId = String(row.target_node_id || '');
    const relationType = String(row.relation_type || 'related');
    addRelation(relationsByNode, `${courseId}:${sourceNodeId}`, {
      direction: 'outgoing',
      type: relationType,
      nodeId: targetNodeId,
      title: String(row.target_title || ''),
    });
    addRelation(relationsByNode, `${courseId}:${targetNodeId}`, {
      direction: 'incoming',
      type: relationType,
      nodeId: sourceNodeId,
      title: String(row.source_title || ''),
    });
  });
  return relationsByNode;
}

async function readRagCourseSnapshot(pool) {
  const connection = await pool.getConnection();
  try {
    await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await connection.beginTransaction();
    const [stateRows] = await connection.execute(
      `SELECT requested_revision, requested_at
       FROM rag_index_state
       WHERE id = ?
       LIMIT 1`,
      [RAG_STATE_ROW_ID],
    );
    const [nodeRows] = await connection.execute(
      `SELECT
         c.id AS course_id,
         c.slug AS course_slug,
         c.name AS course_name,
         c.code AS course_code,
         c.summary AS course_summary,
         n.node_id,
         n.title,
         n.summary,
         COALESCE(NULLIF(s.knowledge_markdown, ''), n.document_markdown, '')
           AS knowledge_markdown,
         COALESCE(s.basic_info_markdown, '') AS basic_info_markdown,
         COALESCE(s.applications_markdown, '') AS applications_markdown,
         GREATEST(n.updated_at, COALESCE(s.updated_at, n.updated_at)) AS content_updated_at
       FROM courses c
       INNER JOIN course_map_nodes n ON n.course_id = c.id
       LEFT JOIN course_map_node_sections s
         ON s.course_id = n.course_id AND s.node_id = n.node_id
       WHERE c.is_active = 1
       ORDER BY c.sort_order ASC, c.id ASC, n.position_y ASC, n.position_x ASC, n.node_id ASC`,
    );
    const [edgeRows] = await connection.execute(
      `SELECT
         e.course_id,
         e.source_node_id,
         source.title AS source_title,
         e.target_node_id,
         target.title AS target_title,
         e.relation_type
       FROM course_map_edges e
       INNER JOIN courses c ON c.id = e.course_id AND c.is_active = 1
       INNER JOIN course_map_nodes source
         ON source.course_id = e.course_id AND source.node_id = e.source_node_id
       INNER JOIN course_map_nodes target
         ON target.course_id = e.course_id AND target.node_id = e.target_node_id
       ORDER BY e.course_id ASC, e.created_at ASC`,
    );
    await connection.commit();

    const state = stateRows[0] || {};
    const relationsByNode = buildRelations(edgeRows);
    return {
      revision: String(state.requested_revision || 0),
      requestedAt: toIsoString(state.requested_at),
      generatedAt: new Date().toISOString(),
      documents: nodeRows.map((row) => normalizeSnapshotRow(row, relationsByNode)),
    };
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  buildRelations,
  normalizeSnapshotRow,
  readRagCourseSnapshot,
};
