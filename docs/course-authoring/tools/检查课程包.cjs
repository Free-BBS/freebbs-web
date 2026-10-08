// Offline validation only: never sends requests or reads account credentials.
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('./整理知识点.cjs');

function relations(source, nodes) {
  const known = new Set(nodes.map((node) => node.id));
  const edges = [];
  const seen = new Set();
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((value) => value.trim());
    if (cells[0] === '起点ID' || /^[\s:-]+$/.test(cells[0])) continue;
    if (cells.length !== 6 || cells.some((value) => !value)) throw new Error('关系表须填写六列。');
    const [sourceId, target, type, meaning, explanation, reviewed] = cells;
    if (!known.has(sourceId) || !known.has(target)) throw new Error('关系引用了包内未提供的节点。');
    if (sourceId === target) throw new Error('不能连接知识点自身。');
    if (![sourceId, target].every((id) => !/-0+$/.test(id)))
      throw new Error('章节归属不是学习连线，不连接0级节点。');
    if (!['ordered', 'related'].includes(type)) throw new Error('网页类型仅支持ordered或related。');
    if (reviewed !== '通过') throw new Error('存在未复核关系。');
    const endpoints = type === 'related' ? [sourceId, target].sort() : [sourceId, target];
    const key = `${type}:${endpoints.join(':')}`;
    if (seen.has(key)) throw new Error('关系重复；无向关联只写一行。');
    seen.add(key);
    edges.push({ source: sourceId, target, type, meaning, explanation });
  }
  const visited = new Set();
  const visiting = new Set();
  function visit(id) {
    if (visiting.has(id)) throw new Error('学习顺序存在环，请重新确认。');
    if (visited.has(id)) return;
    visiting.add(id);
    edges
      .filter((edge) => edge.type === 'ordered' && edge.source === id)
      .forEach((edge) => visit(edge.target));
    visiting.delete(id);
    visited.add(id);
  }
  known.forEach(visit);
  return edges;
}
function layout(source, nodes) {
  const known = new Set(nodes.map((node) => node.id));
  const positions = {};
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((value) => value.trim());
    if (cells[0] === '知识点ID' || /^[\s:-]+$/.test(cells[0])) continue;
    if (cells.length !== 3 || !known.has(cells[0]))
      throw new Error('布局须引用包内节点并填写三列。');
    if (positions[cells[0]]) throw new Error('布局节点重复。');
    const [id, ...coordinates] = cells;
    if (coordinates.some((value) => !/^\d+$/.test(value) || Number(value) > 10000))
      throw new Error('布局坐标须为0至10000整数。');
    positions[id] = { x: Number(coordinates[0]), y: Number(coordinates[1]) };
  }
  if (Object.keys(positions).length !== known.size) throw new Error('布局未覆盖包内全部节点。');
  return positions;
}
function check(directory, { allowDemo = false } = {}) {
  const nodes = ['章节', '知识点'].flatMap((folder) => {
    const base = path.join(directory, folder);
    return fs
      .readdirSync(base)
      .filter((name) => name.endsWith('.md'))
      .map((name) =>
        parse(
          new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(path.join(base, name))),
          { allowDemo },
        ),
      );
  });
  if (!nodes.length || new Set(nodes.map((node) => node.id)).size !== nodes.length)
    throw new Error('包内无节点或ID重复。');
  if (new Set(nodes.map((node) => node.courseSlug)).size !== 1)
    throw new Error('每包只提交一门课程。');
  for (const node of nodes) {
    const chapter = nodes.find(
      (item) =>
        item.metadata['章节ID'] === node.metadata['章节ID'] && item.metadata['节点级别'] === '0',
    );
    if (!chapter) throw new Error('每章须提供一个0级章节节点。');
    if (chapter.title !== node.metadata['章节/单元']) throw new Error('同章名称不一致。');
    if (
      nodes.filter(
        (item) =>
          item.metadata['章节ID'] === node.metadata['章节ID'] && item.metadata['节点级别'] === '0',
      ).length !== 1
    )
      throw new Error('同章只能有一个0级节点。');
  }
  const edges = relations(fs.readFileSync(path.join(directory, '关系.md'), 'utf8'), nodes);
  const positions = layout(fs.readFileSync(path.join(directory, '布局.md'), 'utf8'), nodes);
  return { nodes: nodes.map((node) => ({ id: node.id, title: node.title })), edges, positions };
}
if (require.main === module) {
  try {
    const [directory, flag] = process.argv.slice(2);
    if (!directory || (flag && flag !== '--allow-demo'))
      throw new Error('用法：node 检查课程包.cjs 课程包目录 [--allow-demo]');
    console.log(JSON.stringify(check(directory, { allowDemo: flag === '--allow-demo' }), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { relations, layout, check };
