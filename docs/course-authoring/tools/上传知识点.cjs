// One reviewed, complete author template. --publish is the explicit write confirmation.
const { parse } = require('./整理知识点.cjs');
const {
  CourseApiError,
  SECTION_KEYS,
  revision,
  readUtf8,
  createCourseClient,
  checkedNode,
  safeError,
} = require('./课程接口.cjs');

function prepareUpload(file, options = {}) {
  const node = parse(readUtf8(file));
  const expectedRevision = revision(options.revision);
  const position = {};
  for (const key of ['x', 'y']) {
    if (options[key] !== undefined) {
      if (!/^\d+$/.test(String(options[key]))) throw new Error('坐标须为 0 至 10000 整数。');
      const value = Number(options[key]);
      if (!Number.isSafeInteger(value) || value > 10000)
        throw new Error('坐标须为 0 至 10000 整数。');
      position[key] = value;
    }
  }
  if (expectedRevision === 'new' && (position.x === undefined || position.y === undefined))
    throw new Error('新建节点须明确提供 --x 和 --y，并确认不会覆盖其他节点。');
  const patch = {
    title: node.title,
    summary: node.summary,
    sections: node.sections,
    expectedRevision,
  };
  if (Object.keys(position).length) patch.position = position;
  return { node, patch };
}

async function uploadKnowledgePoint(file, options = {}, suppliedClient = null) {
  const { node, patch } = prepareUpload(file, options);
  const client = suppliedClient || createCourseClient();
  let previous;
  try {
    previous = checkedNode(await client.getNode(node.courseSlug, node.id), node.id);
  } catch (error) {
    if (!(
      error instanceof CourseApiError &&
      error.status === 404 &&
      patch.expectedRevision === 'new'
    ))
      throw error;
  }
  if ((previous?.revision || 'new') !== patch.expectedRevision)
    throw new CourseApiError(409, '预读 revision 已改变，请回读并合并；没有写入。');
  const position = { ...(previous?.position || {}), ...(patch.position || {}) };
  const summary = {
    course: node.courseSlug,
    id: node.id,
    title: node.title,
    expectedRevision: patch.expectedRevision,
    changedSections: SECTION_KEYS.filter((key) => previous?.sections[key] !== node.sections[key]),
    positionChanged: Object.keys(patch.position || {}).length > 0,
    published: false,
    link: `${client.origin}/knowledge?course=${encodeURIComponent(node.courseSlug)}&point=${encodeURIComponent(node.id)}`,
  };
  if (!options.publish)
    return { ...summary, message: '校验及线上对比完成，未写入。审核确认后追加 --publish。' };
  try {
    await client.putNode(node.courseSlug, node.id, patch);
  } catch (error) {
    if (error instanceof CourseApiError && error.status > 0 && error.status < 500) throw error;
    throw new Error('发布请求结果不确定，可能已经保存。请回读该知识点，不要直接重传。');
  }
  try {
    const saved = checkedNode(await client.getNode(node.courseSlug, node.id), node.id);
    const matches =
      saved.title === patch.title &&
      saved.summary === patch.summary &&
      SECTION_KEYS.every((key) => saved.sections[key] === patch.sections[key]) &&
      ['x', 'y'].every((key) => saved.position?.[key] === position[key]);
    if (!matches) throw new Error('回读内容与本次发布不同。');
    return {
      ...summary,
      published: true,
      verified: true,
      revision: saved.revision,
      message: '单次发布并回读核对成功，请打开网页复核。',
    };
  } catch {
    return {
      ...summary,
      published: true,
      verified: false,
      message: '保存请求已成功，但回读未确认。可能已保存或随后被修改，请只读核查，不要直接重传。',
    };
  }
}

async function main(args = process.argv.slice(2)) {
  const file = args.shift();
  if (!file)
    throw new Error(
      '用法：node 上传知识点.cjs 完整稿.md --revision 旧revision|new [--x 坐标 --y 坐标] [--publish]',
    );
  const options = {};
  while (args.length) {
    const flag = args.shift();
    const key = flag.slice(2);
    if (Object.hasOwn(options, key)) throw new Error('请勿重复提供选项。');
    if (flag === '--publish') options.publish = true;
    else if (
      ['--revision', '--x', '--y'].includes(flag) &&
      args.length &&
      !args[0].startsWith('--')
    )
      options[key] = args.shift();
    else throw new Error('未知选项或缺少值。Token 只能通过环境变量配置。');
  }
  const result = await uploadKnowledgePoint(file, options);
  console.log(JSON.stringify(result, null, 2));
  return result.published && !result.verified ? 2 : 0;
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

module.exports = { prepareUpload, uploadKnowledgePoint, main };
