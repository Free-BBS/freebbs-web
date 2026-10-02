// Memory-only interactive preview. Production routes are verified separately against isolated MySQL.
const { createEditableCalendarPreview } = require('./preview-editable-calendar');

async function createScheduleSeriesPreview(options = {}) {
  const preview = await createEditableCalendarPreview(options);
  await preview.workbench.handle({
    route: '/api/workbench/recurring-events',
    method: 'POST',
    url: new URL('http://127.0.0.1/api/workbench/recurring-events'),
    body: {
      title: '本地演示 · 可修改重复规则的课程',
      description: '演示教室',
      kind: 'course',
      startAt: '2026-09-29T11:00:00.000Z',
      endAt: '2026-09-29T12:00:00.000Z',
      recurrence: { unit: 'week', interval: 1, count: 8 },
      allowConflicts: true,
    },
  });
  return preview;
}

if (require.main === module)
  createScheduleSeriesPreview().then(({ server }) => {
    server.listen(Number(process.env.SCHEDULE_SERIES_PREVIEW_PORT || 3147), '127.0.0.1', () => {
      console.log(
        `Memory-only schedule preview: http://127.0.0.1:${server.address().port}/workbench`,
      );
    });
  });

module.exports = { createScheduleSeriesPreview };
