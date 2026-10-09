// Offline only. No credentials, requests or changes to the original document.
const fs = require('node:fs');
const path = require('node:path');
const { validateOptionalQuiz } = require('./检查自测.cjs');

const headings = ['## 0. 基本信息', '## 1. 知识背景与应用', '## 2. 知识点正文'];
const keys = ['basicInfoMarkdown', 'applicationsMarkdown', 'knowledgeMarkdown'];
const required = [
  '课程名称',
  '课程标识',
  '课程ID',
  '章节/单元',
  '章节ID',
  '节点级别',
  '知识点名称',
  '知识点ID',
  '知识点类型',
  '知识点层级',
  '难度（1-5）',
  '重要程度（1-5）',
  '建议学习时长',
  '参与同学',
];

function parse(source, { allowDemo = false } = {}) {
  const markdown = source
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .trim();
  if (/\{\{[^]*?\}\}/.test(markdown)) throw new Error('仍有双花括号占位符，请完成填写。');
  if (/fbcu_[A-Za-z0-9_-]{43}/.test(markdown)) throw new Error('疑似包含课程Token，不能提交。');
  if (!allowDemo && /示例编写者|示例复核者|尚未经过课程负责人审核/.test(markdown))
    throw new Error('未审核示例只能加 --allow-demo 在本地演示。');
  if (/\]\(\s*(?:file:|[A-Za-z]:[\\/])/.test(markdown))
    throw new Error('图片或附件不能使用本机路径。');
  const sections = Object.fromEntries(keys.map((key) => [key, []]));
  let index = -1;
  let title = '';
  let fence = '';
  for (const line of markdown.split('\n')) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = '';
    } else if (!fence && /^##\s/.test(line)) {
      const next = headings.indexOf(line.trim());
      if (next !== index + 1 || next === -1)
        throw new Error('三个二级标题必须按模板顺序各出现一次，其他标题使用三级及以下。');
      index = next;
      continue;
    }
    if (index === -1) {
      if (/^#\s+/.test(line) && !title) title = line.replace(/^#\s+/, '').trim();
      else if (line.trim()) throw new Error('开头只保留知识点一级标题。');
    } else sections[keys[index]].push(line);
  }
  if (index !== 2 || fence) throw new Error('分区不完整或代码围栏未闭合。');
  for (const key of keys) {
    sections[key] = sections[key].join('\n').trim();
    if (!sections[key] || sections[key].length > 500000)
      throw new Error('每个分区须非空且不超过500000字符。');
  }
  if (
    validateOptionalQuiz(sections.basicInfoMarkdown) ||
    validateOptionalQuiz(sections.applicationsMarkdown)
  )
    throw new Error('自测评分扩展只能放在知识点正文的末尾。');
  validateOptionalQuiz(sections.knowledgeMarkdown);
  const metadata = {};
  for (const line of sections.basicInfoMarkdown.split('\n')) {
    if (!line.trim()) continue;
    const pair = line.match(/^([^：:]+)[：:]\s*(.+?)\s*$/);
    if (!pair) throw new Error('基本信息使用模板中的“字段：值”格式。');
    const key = pair[1].trim();
    if (Object.hasOwn(metadata, key)) throw new Error(`重复字段：${key}`);
    metadata[key] = pair[2].trim();
  }
  for (const key of required) if (!metadata[key]) throw new Error(`缺少基本信息：${key}`);
  const id = metadata['知识点ID'];
  if (id.length < 4 || id.length > 64 || !/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/.test(id))
    throw new Error('编号须符合平台的大写英文/数字及连字符规则，长度4至64字符。');
  if (!/^[01]$/.test(metadata['节点级别'])) throw new Error('节点级别只支持0（章）或1（知识点）。');
  if (metadata['章节ID'] !== id.split('-').slice(0, 2).join('-'))
    throw new Error('章节ID与知识点ID不一致。');
  const chapterNode = /^[A-Z][A-Z0-9]*-[A-Z0-9]+-0+$/.test(id);
  if (chapterNode !== (metadata['节点级别'] === '0'))
    throw new Error('0级章节节点的末段必须为00；已有普通知识点不得使用全零编号。');
  if (chapterNode && title !== metadata['章节/单元'])
    throw new Error('章节节点名称必须为实际章名。');
  if (!/^### 知识起源\s*$/m.test(sections.applicationsMarkdown))
    throw new Error('缺少知识起源小节。');
  if (!chapterNode && !/^### 练习与思考\s*$/m.test(sections.knowledgeMarkdown))
    throw new Error('缺少练习与思考小节。');
  if (metadata['课程ID'] !== id.split('-')[0]) throw new Error('课程ID与知识点ID前缀不一致。');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(metadata['课程标识']))
    throw new Error('课程标识使用平台现有slug。');
  if (title !== metadata['知识点名称'] || title.length > 160)
    throw new Error('标题与知识点名称不一致或超过160字符。');
  if (!['概念', '方法', '综合'].includes(metadata['知识点类型'])) throw new Error('类型不正确。');
  if (!['核心', '一般', '拓展'].includes(metadata['知识点层级'])) throw new Error('层级不正确。');
  for (const key of ['难度（1-5）', '重要程度（1-5）'])
    if (!/^[1-5]$/.test(metadata[key])) throw new Error(`${key}须为1至5整数。`);
  if (!/^[1-9]\d*\s*分钟$/.test(metadata['建议学习时长']))
    throw new Error('建议时长使用正整数分钟。');
  if (/^(暂无|无|待补充|未填写|—|-)$/.test(metadata['参与同学'])) throw new Error('请确认署名。');
  const summary = sections.applicationsMarkdown.split(/\n\s*\n/)[0].trim();
  if (/^[#>|]/.test(summary) || summary.length > 150)
    throw new Error('背景与应用首段应为不超过150字的纯文字简介。');
  return {
    id,
    courseSlug: metadata['课程标识'],
    title,
    summary,
    metadata,
    sections,
  };
}

function prepare(file, options) {
  const source = new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(file));
  const node = parse(source, options);
  if (!options.out)
    return {
      id: node.id,
      title: node.title,
      summaryLength: node.summary.length,
      checked: true,
    };
  const revision = options.revision;
  if (!(revision === 'new' || /^[a-f0-9]{64}$/.test(revision || '')))
    throw new Error('导出须明确提供 --revision new 或此前读取的64位revision。');
  const position = {};
  for (const key of ['x', 'y']) {
    if (options[key] !== undefined) {
      const value = Number(options[key]);
      if (!Number.isInteger(value) || value < 0 || value > 10000)
        throw new Error('坐标须为0至10000整数。');
      position[key] = value;
    }
  }
  if (revision === 'new' && (position.x === undefined || position.y === undefined))
    throw new Error('新建时须同时提供已确认的 --x 和 --y。');
  const output = path.resolve(options.out, node.id);
  if (fs.existsSync(output)) throw new Error('输出目录已存在，请使用新的输出目录。');
  fs.mkdirSync(output, { recursive: true });
  for (const [name, key] of [
    ['基本信息.md', 'basicInfoMarkdown'],
    ['背景与应用.md', 'applicationsMarkdown'],
    ['正文.md', 'knowledgeMarkdown'],
  ])
    fs.writeFileSync(path.join(output, name), `${node.sections[key]}\n`, 'utf8');
  const patch = {
    title: node.title,
    summary: node.summary,
    sections: node.sections,
    expectedRevision: revision,
  };
  if (Object.keys(position).length) patch.position = position;
  fs.writeFileSync(
    path.join(output, '发布数据.json'),
    `${JSON.stringify(patch, null, 2)}\n`,
    'utf8',
  );
  return {
    id: node.id,
    courseSlug: node.courseSlug,
    output,
    summaryLength: node.summary.length,
  };
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    const file = args.shift();
    if (!file)
      throw new Error(
        '用法：node 整理知识点.cjs 完整稿.md [--allow-demo] [--out 输出目录 --revision new --x 坐标 --y 坐标]',
      );
    const options = {};
    while (args.length) {
      const flag = args.shift();
      if (flag === '--allow-demo') options.allowDemo = true;
      else if (
        ['--out', '--revision', '--x', '--y'].includes(flag) &&
        args.length &&
        !args[0].startsWith('--')
      )
        options[flag.slice(2)] = args.shift();
      else throw new Error(`未知选项或缺少值：${flag}`);
    }
    console.log(JSON.stringify(prepare(file, options), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { parse, prepare };
