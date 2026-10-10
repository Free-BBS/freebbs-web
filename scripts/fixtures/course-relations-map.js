// Local browser/demo fixture only. These Markdown documents are not formal course materials.
function createCourseRelationsMap({ pointsPerChapter = 40 } = {}) {
  const nodes = [];
  const titles = {
    'SS-01-01': '本地演示起点',
    'SS-01-02': '本章直接前置点',
    'SS-02-01': '跨章直接关联点',
    'SS-02-02': '跨章二跳验证点',
  };
  for (const chapter of ['SS-01', 'SS-02']) {
    const chapterTitle = `本地演示板块${chapter === 'SS-01' ? '一' : '二'}`;
    for (let point = 0; point <= pointsPerChapter; point += 1) {
      const id = `${chapter}-${String(point).padStart(2, '0')}`;
      const title = point === 0 ? chapterTitle : titles[id] || `本地演示知识点 ${id}`;
      const markdown = `# ${title}\n\n本地关系图验收夹具，仅用于界面和一跳关系验证，不是正式教材。`;
      nodes.push({
        id,
        title,
        summary: '本地关系图验收夹具，不是正式教材。',
        chapterTitle,
        hasDocument: true,
        position: { x: 0, y: 0 },
        markdown,
        sections: {
          basicInfoMarkdown: `课程名称：信号与系统\n章节/单元：${chapterTitle}\n知识点层级：一般\n参与同学：本地夹具验证者`,
          applicationsMarkdown: markdown,
          knowledgeMarkdown: markdown,
        },
      });
    }
  }
  const edges = [
    { source: 'SS-01-00', target: 'SS-02-00', type: 'ordered' },
    { source: 'SS-01-02', target: 'SS-01-01', type: 'ordered' },
    {
      source: 'SS-01-01',
      target: 'SS-02-01',
      type: 'related',
      note: '本地夹具：跨章直接关联。',
    },
    { source: 'SS-02-01', target: 'SS-02-02', type: 'ordered' },
    { source: 'SS-01-02', target: 'SS-02-03', type: 'related' },
  ];
  return { nodes, edges };
}

module.exports = { createCourseRelationsMap };
