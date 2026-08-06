const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');

const projectRoot = path.resolve(__dirname, '..');
const defaultEnvPath = path.join(projectRoot, 'backend', '.env');
const defaultBackupDir = path.join(projectRoot, 'database', 'backups');

function loadEnvironmentFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const contents = fs.readFileSync(filePath, 'utf8');
  contents.split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*([^#][^=]*)=(.*)$/);
    if (!match) {
      return;
    }

    const name = match[1].trim();
    let value = match[2].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }

    if (!Object.hasOwn(process.env, name)) {
      process.env[name] = value;
    }
  });
}

function parseArguments(argv) {
  const options = {
    source: 'https://www.free-bbs.cn/api',
    course: 'signals',
    concurrency: 10,
    backupDir: defaultBackupDir,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--source') {
      options.source = argv[index + 1] || '';
      index += 1;
    } else if (argument === '--course') {
      options.course = argv[index + 1] || '';
      index += 1;
    } else if (argument === '--concurrency') {
      options.concurrency = Number(argv[index + 1]);
      index += 1;
    } else if (argument === '--backup-dir') {
      options.backupDir = path.resolve(argv[index + 1] || '');
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  const sourceUrl = new URL(options.source);
  if (!['http:', 'https:'].includes(sourceUrl.protocol)) {
    throw new Error('--source must use http:// or https://');
  }
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(options.course)) {
    throw new Error('--course must be a lowercase course slug');
  }
  if (
    !Number.isInteger(options.concurrency) ||
    options.concurrency < 1 ||
    options.concurrency > 25
  ) {
    throw new Error('--concurrency must be an integer from 1 to 25');
  }

  options.source = sourceUrl.toString().replace(/\/$/, '');
  return options;
}

async function fetchJson(url, timeoutMs = 20000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    throw new Error(`Failed to fetch ${url}: ${error.message}`, { cause: error });
  } finally {
    clearTimeout(timeout);
  }
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.min(concurrency, Math.max(items.length, 1));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function normalizeNode(node) {
  return {
    id: String(node.id || '').trim(),
    title: String(node.title || '').trim(),
    summary: String(node.summary || '').trim(),
    position: {
      x: Math.round(Number(node.position?.x)),
      y: Math.round(Number(node.position?.y)),
    },
    markdown: String(node.markdown || ''),
    updatedAt: node.updatedAt || null,
  };
}

function validateSnapshot(snapshot, expectedSlug) {
  if (snapshot.course?.slug !== expectedSlug) {
    throw new Error(`Source returned course ${snapshot.course?.slug || '<missing>'}`);
  }
  if (!Array.isArray(snapshot.nodes) || !snapshot.nodes.length) {
    throw new Error('Source returned no course-map nodes');
  }
  if (!Array.isArray(snapshot.edges)) {
    throw new Error('Source returned invalid course-map edges');
  }

  const nodeIds = new Set();
  snapshot.nodes.forEach((node) => {
    if (!/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/.test(node.id)) {
      throw new Error(`Invalid node id: ${node.id || '<missing>'}`);
    }
    if (nodeIds.has(node.id)) {
      throw new Error(`Duplicate node id: ${node.id}`);
    }
    if (!node.title || node.title.length > 160 || node.summary.length > 500) {
      throw new Error(`Invalid title or summary for node ${node.id}`);
    }
    if (
      !Number.isInteger(node.position.x) ||
      !Number.isInteger(node.position.y) ||
      node.position.x < 0 ||
      node.position.y < 0 ||
      node.position.x > 10000 ||
      node.position.y > 10000
    ) {
      throw new Error(`Invalid position for node ${node.id}`);
    }
    if (node.markdown.length > 500000) {
      throw new Error(`Markdown is too long for node ${node.id}`);
    }
    nodeIds.add(node.id);
  });

  const edgeKeys = new Set();
  snapshot.edges.forEach((edge) => {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      throw new Error(`Edge references a missing node: ${edge.source} -> ${edge.target}`);
    }
    if (!['ordered', 'related'].includes(edge.type)) {
      throw new Error(`Invalid edge type: ${edge.type}`);
    }
    const key = `${edge.source}\u0000${edge.target}\u0000${edge.type}`;
    if (edgeKeys.has(key)) {
      throw new Error(`Duplicate edge: ${edge.source} -> ${edge.target} (${edge.type})`);
    }
    edgeKeys.add(key);
  });
}

function canonicalSnapshot(snapshot) {
  const course = snapshot.course || {};
  return {
    course: {
      slug: course.slug || '',
      name: course.name || '',
      code: course.code || '',
      boardSlug: course.boardSlug || '',
      description: course.description || '',
      summary: course.summary || '',
      sortOrder: Number(course.sortOrder || 0),
    },
    backgroundUrl: snapshot.backgroundUrl || '',
    nodes: snapshot.nodes
      .map((node) => ({
        id: node.id,
        title: node.title,
        summary: node.summary || '',
        position: { x: Number(node.position.x), y: Number(node.position.y) },
        markdown: node.markdown || '',
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    edges: snapshot.edges
      .map((edge) => ({ source: edge.source, target: edge.target, type: edge.type }))
      .sort((left, right) =>
        `${left.source}\u0000${left.target}\u0000${left.type}`.localeCompare(
          `${right.source}\u0000${right.target}\u0000${right.type}`,
        ),
      ),
  };
}

function snapshotDigest(snapshot) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalSnapshot(snapshot)))
    .digest('hex');
}

async function downloadSnapshot(options) {
  const mapUrl = `${options.source}/courses/${encodeURIComponent(options.course)}/map`;
  console.log(`[sync] fetching map: ${mapUrl}`);
  const map = await fetchJson(mapUrl);
  let completed = 0;
  const nodes = await mapWithConcurrency(map.nodes || [], options.concurrency, async (node) => {
    const nodeUrl = `${mapUrl}/nodes/${encodeURIComponent(node.id)}`;
    const payload = await fetchJson(nodeUrl);
    completed += 1;
    if (completed % 25 === 0 || completed === map.nodes.length) {
      console.log(`[sync] fetched node documents: ${completed}/${map.nodes.length}`);
    }
    return normalizeNode(payload.node);
  });

  const snapshot = {
    source: options.source,
    fetchedAt: new Date().toISOString(),
    course: map.course,
    backgroundUrl: map.backgroundUrl || '',
    nodes,
    edges: map.edges || [],
  };
  validateSnapshot(snapshot, options.course);
  return snapshot;
}

function rowsToSnapshot(course, backgroundUrl, nodeRows, edgeRows) {
  return {
    course,
    backgroundUrl: backgroundUrl || '',
    nodes: nodeRows.map((row) => ({
      id: row.node_id,
      title: row.title,
      summary: row.summary || '',
      position: { x: Number(row.position_x), y: Number(row.position_y) },
      markdown: row.document_markdown || '',
      updatedAt: row.updated_at || null,
    })),
    edges: edgeRows.map((row) => ({
      source: row.source_node_id,
      target: row.target_node_id,
      type: row.relation_type,
    })),
  };
}

async function readDatabaseSnapshot(connection, courseSlug) {
  const [courseRows] = await connection.execute(
    `SELECT id, slug, name, code, board_slug, description, summary, sort_order
     FROM courses WHERE slug = ? LIMIT 1`,
    [courseSlug],
  );
  if (!courseRows[0]) {
    return null;
  }

  const [courseRow] = courseRows;
  const [nodeRows] = await connection.execute(
    `SELECT node_id, title, summary, position_x, position_y, document_markdown, updated_at
     FROM course_map_nodes WHERE course_id = ?`,
    [courseRow.id],
  );
  const [edgeRows] = await connection.execute(
    `SELECT source_node_id, target_node_id, relation_type
     FROM course_map_edges WHERE course_id = ?`,
    [courseRow.id],
  );
  const [settingsRows] = await connection.execute(
    `SELECT background_url FROM course_map_settings WHERE course_id = ? LIMIT 1`,
    [courseRow.id],
  );

  return rowsToSnapshot(
    {
      slug: courseRow.slug,
      name: courseRow.name,
      code: courseRow.code || '',
      boardSlug: courseRow.board_slug || '',
      description: courseRow.description || '',
      summary: courseRow.summary || '',
      sortOrder: Number(courseRow.sort_order || 0),
    },
    settingsRows[0]?.background_url || '',
    nodeRows,
    edgeRows,
  );
}

async function writeBackup(snapshot, backupDir, courseSlug) {
  if (!snapshot) {
    return '';
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(backupDir, `${courseSlug}-${timestamp}.json`);
  await fs.promises.mkdir(backupDir, { recursive: true });
  await fs.promises.writeFile(
    filePath,
    `${JSON.stringify({ exportedAt: new Date().toISOString(), ...snapshot }, null, 2)}\n`,
    'utf8',
  );
  return filePath;
}

function toDatabaseDate(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

async function replaceDatabaseSnapshot(connection, snapshot) {
  const { course } = snapshot;
  await connection.execute(
    `INSERT INTO courses (
       slug, name, code, board_slug, description, summary, sort_order, is_active
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name), code = VALUES(code), board_slug = VALUES(board_slug),
       description = VALUES(description), summary = VALUES(summary),
       sort_order = VALUES(sort_order), is_active = 1`,
    [
      course.slug,
      course.name,
      course.code || null,
      course.boardSlug || null,
      course.description || null,
      course.summary || null,
      Number(course.sortOrder || 0),
    ],
  );
  const [courseRows] = await connection.execute(`SELECT id FROM courses WHERE slug = ? LIMIT 1`, [
    course.slug,
  ]);
  const [{ id: courseId }] = courseRows;

  await connection.execute(`DELETE FROM course_map_edges WHERE course_id = ?`, [courseId]);
  await connection.execute(`DELETE FROM course_map_nodes WHERE course_id = ?`, [courseId]);

  const nodeBatchSize = 20;
  for (let offset = 0; offset < snapshot.nodes.length; offset += nodeBatchSize) {
    const nodeBatch = snapshot.nodes.slice(offset, offset + nodeBatchSize);
    const nodePlaceholders = nodeBatch.map(() => '(?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)');
    const nodeValues = nodeBatch.flatMap((node) => {
      const updatedAt = toDatabaseDate(node.updatedAt);
      return [
        courseId,
        node.id,
        node.title,
        node.summary || null,
        node.position.x,
        node.position.y,
        node.markdown || null,
        updatedAt,
        updatedAt,
      ];
    });
    await connection.execute(
      `INSERT INTO course_map_nodes (
         course_id, node_id, title, summary, position_x, position_y, document_markdown,
         created_by, updated_by, created_at, updated_at
       ) VALUES ${nodePlaceholders.join(', ')}`,
      nodeValues,
    );
  }

  if (snapshot.edges.length) {
    const edgeBatchSize = 200;
    for (let offset = 0; offset < snapshot.edges.length; offset += edgeBatchSize) {
      const edgeBatch = snapshot.edges.slice(offset, offset + edgeBatchSize);
      const edgePlaceholders = edgeBatch.map(() => '(?, ?, ?, ?, NULL)');
      const edgeValues = edgeBatch.flatMap((edge) => [
        courseId,
        edge.source,
        edge.target,
        edge.type,
      ]);
      await connection.execute(
        `INSERT INTO course_map_edges (
           course_id, source_node_id, target_node_id, relation_type, created_by
         ) VALUES ${edgePlaceholders.join(', ')}`,
        edgeValues,
      );
    }
  }

  await connection.execute(
    `INSERT INTO course_map_settings (course_id, background_url, updated_by)
     VALUES (?, NULLIF(?, ''), NULL)
     ON DUPLICATE KEY UPDATE background_url = VALUES(background_url), updated_by = NULL`,
    [courseId, snapshot.backgroundUrl || ''],
  );
}

async function main() {
  loadEnvironmentFile(process.env.FREE_BBS_ENV_FILE || defaultEnvPath);
  const options = parseArguments(process.argv.slice(2));
  const config = require('../backend/config');
  const sourceSnapshot = await downloadSnapshot(options);
  console.log(
    `[sync] source ready: ${sourceSnapshot.nodes.length} nodes, ${sourceSnapshot.edges.length} edges`,
  );

  const connection = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    ...(config.db.socketPath ? { socketPath: config.db.socketPath } : {}),
  });

  try {
    const currentSnapshot = await readDatabaseSnapshot(connection, options.course);
    const backupPath = await writeBackup(currentSnapshot, options.backupDir, options.course);
    if (backupPath) {
      console.log(`[sync] local backup: ${backupPath}`);
    }

    await connection.beginTransaction();
    try {
      await replaceDatabaseSnapshot(connection, sourceSnapshot);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }

    const importedSnapshot = await readDatabaseSnapshot(connection, options.course);
    const sourceHash = snapshotDigest(sourceSnapshot);
    const importedHash = snapshotDigest(importedSnapshot);
    if (sourceHash !== importedHash) {
      throw new Error(`Verification failed: source ${sourceHash}, local ${importedHash}`);
    }

    console.log(
      `[sync] verified local map: ${importedSnapshot.nodes.length} nodes, ${importedSnapshot.edges.length} edges`,
    );
    console.log(`[sync] content sha256: ${importedHash}`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(`[sync] failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});
