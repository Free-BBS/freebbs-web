const assert = require('node:assert/strict');
const test = require('node:test');
const { createWorkbenchPreviewApi } = require('./workbench-preview-api');

function fixture() {
  const preview = createWorkbenchPreviewApi({ now: () => Date.parse('2026-09-24T06:00:00Z') });
  preview.events.splice(0);
  return {
    ...preview,
    request(action, body) {
      return preview.handle({
        route: `/api/workbench/schedule-planner/${action}`,
        method: 'POST',
        body,
      });
    },
  };
}

const meetings =
  '我今天晚上9点要开书记会，罗姆楼5103；10点要开支书例会，罗姆楼10-206，两个会都是1小时';

test('preview uses the real batch parser and never inserts before confirmation', async () => {
  const view = fixture();
  const result = await view.request('preview', { message: meetings });
  assert.equal(result.status, 200);
  assert.equal(result.body.taskCount, 2);
  assert.deepEqual(
    result.body.suggestions.map(({ title, description, startAt, endAt }) => ({
      title,
      description,
      startAt,
      endAt,
    })),
    [
      {
        title: '书记会',
        description: '罗姆楼5103',
        startAt: '2026-09-24T13:00:00.000Z',
        endAt: '2026-09-24T14:00:00.000Z',
      },
      {
        title: '支书例会',
        description: '罗姆楼10-206',
        startAt: '2026-09-24T14:00:00.000Z',
        endAt: '2026-09-24T15:00:00.000Z',
      },
    ],
  );
  assert.deepEqual(view.events, []);
  result.body.suggestions[1].description += '；带电脑';
  const saved = await view.request('confirm', { suggestions: result.body.suggestions });
  assert.equal(saved.status, 201);
  assert.equal(saved.body.created, 2);
  assert.equal(view.events[1].description, '罗姆楼10-206；带电脑');
});

test('four tasks return a readable limit error without accepting the first three', async () => {
  const view = fixture();
  const result = await view.request('preview', {
    message: '明天下午1点开组会1小时；2点整理数据1小时；3点写报告1小时；4点讨论实验1小时',
  });
  assert.equal(result.status, 422);
  assert.match(result.body.message, /3/);
  assert.deepEqual(view.events, []);
});

test('batch preview and confirm both reject collisions without partial local writes', async () => {
  const view = fixture();
  const result = await view.request('preview', { message: meetings });
  assert.equal(result.status, 200);
  const { suggestions } = result.body;
  const internal = await view.request('confirm', {
    suggestions: [suggestions[0], { ...suggestions[1], startAt: suggestions[0].startAt }],
  });
  assert.equal(internal.status, 409);
  assert.deepEqual(view.events, []);
  view.events.push({ ...suggestions[1], publicId: 'busy' });
  const before = structuredClone(view.events);
  assert.equal((await view.request('preview', { message: meetings })).status, 409);
  assert.equal((await view.request('confirm', { suggestions })).status, 409);
  assert.deepEqual(view.events, before);
});

test('an incomplete second task never becomes a silently partial local preview', async () => {
  const view = fixture();
  const result = await view.request('preview', { message: '明天上午9点开会1小时；还要写报告' });
  assert.equal(result.status, 422);
  assert.deepEqual(view.events, []);
});
