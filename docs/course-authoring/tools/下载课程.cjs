// Authenticated author snapshot only. Public reader Markdown is not an author backup.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  SECTION_KEYS,
  courseSlug,
  nodeId,
  createCourseClient,
  checkedNode,
  safeError,
} = require('./课程接口.cjs');

async function downloadCourse(course, output, suppliedClient) {
  courseSlug(course);
  if (!output || output === '.' || output === '..')
    throw new Error('请使用 --out 指定一个不存在的新目录。');
  const directory = path.resolve(output);
  if (directory === path.parse(directory).root || fs.existsSync(directory))
    throw new Error('下载目录必须是新的非根目录，不会覆盖已有文件。');
  if (!fs.statSync(path.dirname(directory)).isDirectory())
    throw new Error('下载目录的父目录须已存在。');
  const client = suppliedClient || createCourseClient();
  const map = await client.getMap(course);
  if (
    map?.course?.slug !== course ||
    !Array.isArray(map.nodes) ||
    !Array.isArray(map.edges) ||
    map.nodes.length > 5000
  )
    throw new Error('课程地图返回结构无效，已停止。');
  const ids = map.nodes.map((node) => nodeId(node.id));
  if (new Set(ids).size !== ids.length) throw new Error('地图包含重复知识点 ID，已停止。');
  const nodes = [];
  let bytes = Buffer.byteLength(JSON.stringify(map));
  for (const id of ids) {
    const payload = await client.getNode(course, id);
    checkedNode(payload, id);
    bytes += Buffer.byteLength(JSON.stringify(payload));
    if (bytes > 256 * 1024 * 1024) throw new Error('课程快照超出本工具的 256 MB 限制，已停止。');
    nodes.push(payload);
  }
  const lastMap = await client.getMap(course);
  if (JSON.stringify(lastMap) !== JSON.stringify(map))
    throw new Error('下载期间课程地图发生变化，未生成快照。请择时重新只读下载。');
  // Fetch and validate first. Permission or network failure cannot leave a misleading complete backup.
  fs.mkdirSync(directory, { mode: 0o700 });
  const write = (target, content) =>
    fs.writeFileSync(target, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  write(path.join(directory, '课程地图原始.json'), `${JSON.stringify(map, null, 2)}\n`);
  fs.mkdirSync(path.join(directory, '知识点'), { mode: 0o700 });
  const manifest = {
    format: 'freebbs-author-snapshot-v1',
    course,
    source: client.origin,
    exportedAt: new Date().toISOString(),
    complete: true,
    atomicSnapshot: false,
    assetsDownloaded: false,
    nodes: [],
  };
  for (const payload of nodes) {
    const { node } = payload;
    const nodeDirectory = path.join(directory, '知识点', node.id);
    fs.mkdirSync(nodeDirectory, { mode: 0o700 });
    const raw = `${JSON.stringify(payload, null, 2)}\n`;
    write(path.join(nodeDirectory, '节点原始.json'), raw);
    write(path.join(nodeDirectory, 'revision.txt'), `${node.revision}\n`);
    for (const [index, name] of ['基本信息.md', '背景与应用.md', '正文.md'].entries())
      write(path.join(nodeDirectory, name), node.sections[SECTION_KEYS[index]]);
    manifest.nodes.push({
      id: node.id,
      revision: node.revision,
      sha256: crypto.createHash('sha256').update(raw).digest('hex'),
    });
  }
  // Written last. A local I/O failure leaves no completion marker; do not remove files automatically.
  write(path.join(directory, '快照清单.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    course,
    output: directory,
    nodes: nodes.length,
    complete: true,
    assetsDownloaded: false,
    message:
      '完整作者分区已只读下载，保留评分配置及 revision；图片和附件未下载。这不是数据库事务级快照。',
  };
}

async function main(args = process.argv.slice(2)) {
  const course = args.shift();
  if (args.shift() !== '--out' || args.length !== 1)
    throw new Error('用法：node 下载课程.cjs 课程slug --out 不存在的新目录');
  const output = args.shift();
  console.log(JSON.stringify(await downloadCourse(course, output), null, 2));
  return 0;
}

if (require.main === module)
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(safeError(error));
      process.exitCode = 1;
    });

module.exports = { downloadCourse, main };
