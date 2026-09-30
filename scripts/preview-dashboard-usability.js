// Local memory-only fixtures. Never connects to a real campus account or database.
const { createEditableCalendarPreview } = require('./preview-editable-calendar');
const { courseFixture } = require('./preview-onboarding');

async function createDashboardUsabilityPreview() {
  const homework = Array.from({ length: 14 }, (_, index) => ({
    sourceReference: `demo:homework:${index}`,
    courseReference: `demo:weeks:${index % 3}`,
    title: `${['中文写作 · 阅读与表达', '最优化方法 · 推导练习', '应用信息论 · 习题'][index % 3]} ${
      index + 1
    }`,
    status: index % 5 === 0 ? 'submitted' : index % 7 === 0 ? 'graded' : 'unsubmitted',
    dueAt: index === 13 ? null : new Date(Date.UTC(2026, 8, 29 + index, 15, 59)).toISOString(),
    submissionType: 2,
    description: '本地模拟作业，用于检查截止时间排序和左右滚动。不会提交到网络学堂。',
    attachments: [],
    providerCourseId: 'preview',
    providerStudentHomeworkId: 'preview',
  })).reverse();
  const result = (value) => ({ status: 200, body: value });
  const preview = await createEditableCalendarPreview({
    extraApi: async ({ route, method, url }) => {
      if (method !== 'GET') return null;
      const mapMatch = /^\/api\/courses\/([^/]+)\/map(?:\/nodes\/([^/]+))?$/.exec(route);
      if (mapMatch) {
        const map = courseFixture(mapMatch[1]);
        if (!map) return null;
        map.nodes.forEach((node) => {
          node.sections.basicInfoMarkdown = `## 课程名称\n${map.course.name}\n\n## 章节/单元\n第一章 基础概念\n\n知识点类型：概念\n知识点层级：核心\n难度（1-5）：2\n重要程度（1-5）：4\n建议学习时长：20 分钟\n\n## 填写人\n演示同学甲\n\n修改人：演示同学乙、演示同学甲\n审核人：演示同学丙`;
          node.summary = `从直观例子理解「${node.title}」，掌握基本条件与常见用法。（本地演示资料）`;
        });
        if (!mapMatch[2]) return result(map);
        const node = map.nodes.find((entry) => entry.id === mapMatch[2]);
        return node
          ? result({ course: map.course, node })
          : { status: 404, body: { message: '未找到知识点' } };
      }
      if (route === '/api/leaderboard/heat')
        return result({
          users: Array.from(
            { length: Math.min(10, Number(url.searchParams.get('limit')) || 5) },
            (_, index) => ({
              uid: 'u_preview01',
              username: `演示同学 ${index + 1}`,
              heat: 120 - index * 8,
              avatarPath: '/assets/avatar_placeholder.webp',
            }),
          ),
        });
      if (/^\/api\/workbench\/connectors\/tsinghua\/homework\/semesters\/[^/]+$/.test(route))
        return result({
          items: homework,
          syncStatus: 'complete',
          fetchedAt: '2026-09-29T02:00:00Z',
        });
      const itemMatch = /\/homework\/semesters\/[^/]+\/items\/([^/]+)$/.exec(route);
      if (itemMatch)
        return result({
          homework: homework.find(
            (item) => item.sourceReference === decodeURIComponent(itemMatch[1]),
          ),
        });
      return null;
    },
  });
  preview.workbench.events.push(
    ...[
      ['ws_short', '短时碰头', '2026-09-29T09:20:00Z', '2026-09-29T09:25:00Z'],
      ['ws_short_touching', '领取材料', '2026-09-29T09:25:00Z', '2026-09-29T09:35:00Z'],
      ['ws_short_midnight', '睡前记录', '2026-09-29T15:55:00Z', '2026-09-29T16:00:00Z'],
    ].map(([publicId, title, startAt, endAt]) => ({
      publicId,
      title,
      startAt,
      endAt,
      description: '本地演示',
      kind: 'event',
      sourceType: 'manual',
      status: 'confirmed',
      version: 1,
      allDay: false,
    })),
  );
  return { ...preview, homework };
}

if (require.main === module)
  createDashboardUsabilityPreview()
    .then(({ server }) => {
      server.listen(Number(process.env.DASHBOARD_PREVIEW_PORT || 3145), '127.0.0.1', () => {
        console.log(
          `Memory-only dashboard preview: http://127.0.0.1:${server.address().port}/workbench`,
        );
      });
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });

module.exports = { createDashboardUsabilityPreview };
