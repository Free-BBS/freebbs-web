const test = require('node:test');
const assert = require('node:assert/strict');
const { compareHomework, isPending } = require('../public/workbench-homework');

test('unfinished homework stays first and sorts from earlier to later deadlines', () => {
  const items = [
    { title: '已交', status: 'submitted', dueAt: '2026-09-01' },
    { title: '明天', status: 'unsubmitted', dueAt: '2026-09-30' },
    { title: '下周', status: 'unsubmitted', dueAt: '2026-10-05' },
    { title: '今天', status: 'unsubmitted', dueAt: '2026-09-29' },
    { title: '逾期', status: 'unsubmitted', dueAt: '2026-09-28' },
    { title: '已批', status: 'graded', dueAt: '2026-09-02' },
  ];
  assert.deepEqual(
    items.sort(compareHomework).map((item) => item.title),
    ['逾期', '今天', '明天', '下周', '已交', '已批'],
  );
});

test('missing, invalid and unverified deadlines stay behind known pending deadlines', () => {
  const uncertain = [
    { title: '无日期', status: 'unsubmitted' },
    { title: '坏日期', status: 'unsubmitted', dueAt: 'bad' },
    { title: '未核对', status: 'unsubmitted', dueAt: '2020-01-01', deadlineUnverified: true },
  ];
  const dated = { title: '明确', status: 'unsubmitted', dueAt: '2030-01-01' };
  for (const item of uncertain) {
    assert.ok(compareHomework(item, dated) > 0);
    assert.ok(compareHomework(dated, item) < 0);
    assert.equal(compareHomework(item, { ...item }), 0);
  }
  assert.equal(isPending({ status: 'unknown' }), true);
  assert.equal(isPending({ status: 'submitted' }), false);
  assert.equal(isPending({ status: 'graded' }), false);
});
