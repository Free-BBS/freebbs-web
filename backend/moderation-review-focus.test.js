const test = require('node:test');
const assert = require('node:assert/strict');
const { getReviewFocus, mergeReviewFocus } = require('./moderation-review-focus');
const library = require('./moderation-review-keywords.json');

test('all 278 approved spellings independently require human review', () => {
  assert.deepEqual(
    library.groups.map((group) => group.keywords.length),
    [229, 49],
  );
  for (const group of library.groups)
    for (const entry of group.keywords) {
      const result = getReviewFocus({ content: `教材引用：“${entry.term}”。` });
      assert.equal(result[group.focus], true, entry.term);
      assert.ok(result.keywordMatches[group.focus].includes(entry.term), entry.term);
    }
});

test('approved broad political tokens stay mandatory even in ordinary contexts', () => {
  for (const term of [
    '台湾',
    '四通桥',
    '8964',
    '6.4',
    '六四',
    'XJP',
    'JZM',
    'CPC',
    'CCP',
    '人大',
  ]) {
    assert.equal(getReviewFocus({ content: `课程介绍 ${term}。` }).political, true, term);
  }
  for (const term of ['政府', '民主', '心理', '孤独', '崩溃', '焦虑', '抑郁']) {
    const result = getReviewFocus({ content: term });
    assert.equal(result.political || result.psychological, false, term);
  }
});

test('case, width and inserted spacing match; longer identifiers and cross-field text do not', () => {
  for (const term of ['xjp', 'ＸＪＰ', 'c c p', '习\u200b近平', '习 近平']) {
    assert.equal(getReviewFocus({ content: term }).political, true, term);
  }
  for (const term of [
    'myXJPfile',
    '189641',
    '16.4',
    '6.40',
    'v6.4.1',
    '64',
    '六月四日',
    '程序崩溃了',
  ]) {
    assert.equal(getReviewFocus({ content: term }).political, false, term);
  }
  assert.equal(getReviewFocus({ title: '习', content: '近平' }).political, false);
  assert.equal(getReviewFocus({ content: '程序崩溃了' }).psychological, false);
});

test('image OCR and semantic topics independently route, without changing content verdict', () => {
  assert.equal(
    getReviewFocus({ observations: [{ text: '台湾旅行', description: '地图' }] }).political,
    true,
  );
  for (const topic of ['political', 'psychological']) {
    const assessment = {
      decision: 'no_risk_detected',
      categories: [],
      supportPriority: 'none',
      reviewTopics: { [topic]: [{ field: 'content', quote: '测试依据', reason: '测试' }] },
    };
    const result = getReviewFocus({ assessments: [assessment] });
    assert.equal(result[topic], true);
    assert.deepEqual(result.keywordMatches[topic], []);
    assert.equal(mergeReviewFocus(result, { [topic]: false })[topic], true);
    assert.equal(assessment.decision, 'no_risk_detected');
  }
});
