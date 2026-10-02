// Local memory-only fixtures. Never reads a real account, campus login or database.
const { createOnboardingPreview } = require('./preview-onboarding');
const { createCircuitAchievementPreviewApi } = require('./preview-circuit-achievement-api');

function createCourseThreadsPreview({
  now = () => Date.parse('2026-09-28T02:00:00Z'),
  extraApi,
  extraPages,
  transformHtml,
  allowDemoAuthentication,
} = {}) {
  const circuitApi = createCircuitAchievementPreviewApi();
  const preview = createOnboardingPreview({
    now,
    extraPages,
    transformHtml,
    allowDemoAuthentication,
    extraApi: async (context) => (await extraApi?.(context)) || circuitApi(context),
  });
  const boardNames = [
    ['daily', '日常'],
    ['math', '数学'],
    ['physics', '物理'],
    ['circuit', '电路'],
    ['signal', '信号'],
    ['computer', '计算机'],
    ['experiment', '实验'],
    ['changelog', '更新日志'],
  ];
  preview.discussion.boards.splice(
    0,
    preview.discussion.boards.length,
    ...boardNames.map(([slug, name], index) => ({
      slug,
      name,
      description: `${name}分区 · 本地演示`,
      postCount: 3,
      commentCount: index + 2,
      reactionCount: 8 - index,
      interactionCount: 10,
    })),
  );
  const firstPost = preview.discussion.posts[0];
  preview.discussion.posts.splice(
    0,
    preview.discussion.posts.length,
    ...Array.from({ length: 24 }, (_, index) => ({
      ...firstPost,
      id: String(101 + index),
      isPinned: index === 0,
      board: preview.discussion.boards[index % 8],
      title: `【本地演示】${boardNames[index % 8][1]}里的问题与发现 ${index + 1}`,
      createdAt: new Date(now() - index * 3600000 * 12).toISOString(),
      commentCount: index % 7,
      likeCount: (index * 3) % 11,
    })),
  );
  const rows = [
    ['中文写作', '星期一第3节(全周)，新水利馆404'],
    ['最优化方法', '星期二第1节(全周)，六教6C300; 星期四第2节(全周)，六教6C300'],
    [
      '应用信息论基础',
      '星期三第3节(全周)，建华/经管新楼A204; 星期三第4节(全周)，建华/经管新楼A204',
    ],
    ['前八周课程', '星期四第3节(前八周)，实验室101'],
    ['后八周课程', '星期四第3节(后八周)，实验室102'],
    ['单双周课程', '星期五第1节(单周)，教室201; 星期五第2节(双周)，教室202'],
    ['明确周次课程', '第1-2周 星期二第2节，教室301'],
    ['待补充星期的实验', '第4节(全周)，实验室401'],
  ];
  preview.workbench.campusCourses.splice(
    0,
    preview.workbench.campusCourses.length,
    ...rows.map(([title, scheduleText], index) => ({
      sourceReference: `demo:weeks:${index}`,
      title: `模拟课程 · ${title}`,
      teacher: '演示教师',
      scheduleText,
      sectionSystem: 'tsinghua-large',
    })),
  );
  const hierarchy = [
    [1010, null, '从一个问题开始：怎样看清多层回复之间的关系？'],
    [1011, 1010, '第一条分支：左侧引导线让回复关系更清楚'],
    [1012, 1011, '继续追问：子回复应该连接到它的父评论'],
    [1013, 1012, '更深一层，仍然可以点击上方的回复对象跳转'],
    [1014, 1013, '第四层：手机上也要给正文留下足够空间'],
    [1015, 1014, '第五层不会继续无限缩进，但会明确显示回复对象'],
    [1016, 1015, '第六层的长文字示例：这里保留阅读宽度与完整的回复、点赞入口'],
    [1017, 1012, '这一条和第三层第一条是同级分支'],
    [1018, 1010, '第二条分支：与第一条回复同级'],
    [1019, 1018, '这条评论已删除'],
    [1020, 1019, '父评论删除之后，下面的讨论仍可正常阅读'],
    [1021, 1010, '最后一条分支，引导线在这里结束'],
  ];
  const comments = hierarchy.map(([id, parentCommentId, contentMarkdown]) => ({
    id,
    parentCommentId,
    contentMarkdown,
    isDeleted: id === 1019,
    createdAt: new Date(now() + (id - 1010) * 60000).toISOString(),
    likeCount: 0,
    author: { id: 2, uid: 'u_preview02', username: `演示同学${id - 1009}` },
  }));
  preview.discussion.comments = () => structuredClone(comments);
  Object.assign(preview.discussion.posts[0], {
    title: '【本地演示】多层评论与左侧引导线',
    commentCount: comments.length,
    contentMarkdown: '仅用于检查回复层级、折叠、手机端和字体兼容；不是线上帖子，也不会发表评论',
  });
  return preview;
}

if (require.main === module) {
  const { server } = createCourseThreadsPreview();
  server.listen(Number(process.env.COURSE_THREADS_PREVIEW_PORT || 3141), '127.0.0.1', () => {
    console.log(`Local course/thread preview: http://127.0.0.1:${server.address().port}/workbench`);
    console.log('Memory-only simulation, no production APIs or database');
  });
}

module.exports = { createCourseThreadsPreview };
