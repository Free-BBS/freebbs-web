// Local-only demonstration. No account credentials, production API or database.
const { createCourseThreadsPreview } = require('./preview-course-threads');

async function createEditableCalendarPreview({ extraApi, ...previewOptions } = {}) {
  const preview = createCourseThreadsPreview({
    ...previewOptions,
    now: () => Date.parse('2026-09-29T02:00:00Z'),
    extraApi,
  });
  preview.workbench.campusCourses.push({
    sourceReference: 'demo:variable-sections',
    title: '模拟课程 · 研讨与实验',
    sectionSystem: 'tsinghua-large',
    scheduleText: '星期五第5节(全周)，实验室301;星期二第6节(全周)，研讨室101',
  });
  preview.workbench.events.push({
    publicId: 'ws_hour_location',
    title: '科协主席部长会',
    description: '罗姆楼3层',
    startAt: '2026-09-29T10:00:00.000Z',
    endAt: '2026-09-29T11:00:00.000Z',
    kind: 'event',
    sourceType: 'manual',
    status: 'confirmed',
    version: 1,
    allDay: false,
  });
  await preview.workbench.handle({
    route: '/api/workbench/campus/course-calendar',
    method: 'PUT',
    url: new URL('http://127.0.0.1/api/workbench/campus/course-calendar'),
    body: {
      semesterId: 'preview-semester',
      firstWeekMonday: '2026-09-14',
      teachingWeeks: 16,
      options: { holidayPreset: 'tsinghua-2026-autumn' },
    },
  });
  return preview;
}

if (require.main === module)
  createEditableCalendarPreview()
    .then(({ server }) => {
      server.listen(Number(process.env.EDITABLE_CALENDAR_PREVIEW_PORT || 3143), '127.0.0.1', () => {
        console.log(
          `Local editable calendar preview: http://127.0.0.1:${server.address().port}/workbench`,
        );
        console.log('Memory-only simulation; home page also available at /');
      });
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });

module.exports = { createEditableCalendarPreview };
