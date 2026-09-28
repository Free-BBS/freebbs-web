const { createCourseThreadsPreview } = require('./preview-course-threads');

function createCalendarThreadsPreview() {
  const preview = createCourseThreadsPreview();
  const event = (publicId, title, start, end, extra = {}) => ({
    publicId,
    title,
    startAt: new Date(`${start}+08:00`).toISOString(),
    endAt: new Date(`${end}+08:00`).toISOString(),
    description: '本地模拟 · 不对应真实安排',
    allDay: false,
    status: 'confirmed',
    kind: 'event',
    sourceType: 'manual',
    version: 1,
    ...extra,
  });
  preview.workbench.events.splice(
    0,
    preview.workbench.events.length,
    event('ws_meeting', '实验室例会', '2026-09-28T12:00', '2026-09-28T14:00', {
      description: '罗姆楼 10-206 · 阶段进展交流',
      seriesKey: 'manual:recurring:meeting',
    }),
    event('ws_course', '中文写作', '2026-09-28T13:30', '2026-09-28T15:05', {
      description: '新水利馆 404 · 旁听课程',
      kind: 'course',
      seriesKey: 'manual:course:writing',
    }),
    event('ws_next', '整理实验记录', '2026-09-28T15:05', '2026-09-28T16:00'),
    event('ws_repeat', '实验室例会', '2026-10-05T12:00', '2026-10-05T14:00', {
      description: '罗姆楼 10-206 · 阶段进展交流',
      seriesKey: 'manual:recurring:meeting',
    }),
    ...[
      ['urgent', '今晚提交报告', '2026-09-28T19:59', '2026-09-28T20:00'],
      ['soon', '阶段材料提交', '2026-09-30T11:59', '2026-09-30T12:00'],
      ['safe', '下阶段方案', '2026-10-02T17:59', '2026-10-02T18:00'],
      ['overdue', '逾期示例', '2026-09-28T08:59', '2026-09-28T09:00'],
    ].map(([id, title, start, end]) => event(`ws_${id}`, title, start, end, { kind: 'deadline' })),
  );
  preview.workbench.importantItems.splice(
    0,
    preview.workbench.importantItems.length,
    ...preview.workbench.events
      .filter((item) => item.kind === 'deadline')
      .map((item) => ({
        publicId: `wi_${item.publicId}`,
        title: item.title,
        dueAt: item.endAt,
        status: 'confirmed',
        priority: 'normal',
        description: '本地模拟 DDL',
        sourceType: 'manual',
      })),
  );
  return preview;
}
if (require.main === module) {
  const { server } = createCalendarThreadsPreview();
  server.listen(3142, '127.0.0.1', () =>
    console.log('Memory-only calendar/thread preview: http://127.0.0.1:3142/workbench'),
  );
}
module.exports = { createCalendarThreadsPreview };
