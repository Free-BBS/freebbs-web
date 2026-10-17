const test = require('node:test');
const assert = require('node:assert/strict');
const { runCases } = require('./moderation-topic-evaluation');
const cases = require('../test/fixtures/moderation-topics-v1.json');
const { getReviewFocus } = require('../backend/moderation-review-focus');

test('fixed suite contains four local routes and twelve semantic/control cases without keywords', () => {
  assert.equal(cases.length, 16);
  for (const item of cases) {
    const focus = getReviewFocus({ content: item.content });
    assert.equal(focus.political || focus.psychological, item.id.startsWith('词库'), item.id);
  }
});
test('runner skips paid calls on local matches and never sends labels or reasons', async () => {
  const inputs = [];
  const report = await runCases({
    assess: async (input) => {
      inputs.push(input);
      assert.deepEqual(Object.keys(input).sort(), [
        'content',
        'inputMode',
        'model',
        'requireReviewTopics',
        'title',
      ]);
      assert.equal(input.requireReviewTopics, true);
      return {
        assessment: {
          decision: 'no_risk_detected',
          categories: [],
          reason: '测试',
          ruleMatches: [],
          uncertainties: [],
          supportPriority: 'none',
          supportReason: '',
          reviewTopics: { political: [], psychological: [] },
        },
      };
    },
  });
  assert.equal(inputs.length, 12);
  assert.deepEqual(report.summary, { total: 16, matched: 8, mismatches: 8, failures: 0, unrun: 0 });
});
test('three consecutive invalid replies stop the suite and preserve failures without converting to safe results', async () => {
  let calls = 0;
  const report = await runCases({
    assess: async () => {
      calls++;
      throw new Error('PRIVATE_KEY');
    },
  });
  assert.equal(calls, 3);
  assert.equal(report.summary.failures, 3);
  assert.equal(report.summary.unrun, 9);
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_KEY/);
  let attempted = false;
  await assert.rejects(
    runCases(
      {
        assess: async () => {
          attempted = true;
        },
      },
      () => {
        throw new Error('not writable');
      },
    ),
  );
  assert.equal(attempted, false);
});
