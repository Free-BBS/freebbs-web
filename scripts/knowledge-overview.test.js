const assert = require('node:assert/strict');
const test = require('node:test');
const { model, readFields } = require('../public/knowledge-overview');

test('normalizes headings, colon fields and contributor aliases without changing source', () => {
  const node = {
    id: 'CAL-01-01',
    title: '导数',
    sections: {
      basicInfoMarkdown: `## 课程名称\n\n高等微积分\n## 章节/单元\n第一章\n知识点类型: "概念"\n知识点层级：核心\n难度（1-5）：2\n重要程度(1-5): 4\n建议学习时长：20分钟\n填写人:\n\n"同学甲"\n修改人: "同学乙、同学甲"\n审核人：同学丙`,
      applicationsMarkdown: '## 1.1 知识点概述\n\n理解变化率。\n\n## 联系\n不应挤进摘要。',
    },
  };
  const copy = JSON.stringify(node);
  assert.deepEqual(model(node), {
    id: 'CAL-01-01',
    title: '导数',
    course: '高等微积分',
    chapter: '第一章',
    type: '概念',
    level: '核心',
    difficulty: '2',
    importance: '4',
    duration: '20分钟',
    participants: ['同学甲', '同学乙', '同学丙'],
    summary: '理解变化率。',
  });
  assert.equal(JSON.stringify(node), copy);
});

test('accepts Markdown table fields and a canonical participants field', () => {
  const fields = readFields(
    '| 字段 | 值 |\n| --- | --- |\n| **难度（1-5）** | 3 |\n| 参与同学 | 同学甲，同学乙 |\n难度：5',
  );
  assert.equal(fields.difficulty, '3');
  assert.deepEqual(fields.participants, ['同学甲，同学乙']);
  assert.deepEqual(
    model({ sections: { basicInfoMarkdown: '参与同学: ["甲", "乙"]' } }).participants,
    ['甲', '乙'],
  );
});

test('preserves numeric metadata values on the line after their heading', () => {
  for (const duration of ['60 分钟', '30 分钟', '1.5 小时', '90–120 分钟']) {
    const markdown = `## 建议学习时长\n\n${duration}\n## 难度\n2 / 5\n## 章节/单元\n1 基础概念`;
    const fields = readFields(markdown);
    assert.equal(fields.duration, duration);
    assert.equal(fields.difficulty, '2 / 5');
    assert.equal(fields.chapter, '1 基础概念');
    const node = { sections: { basicInfoMarkdown: markdown } };
    const original = JSON.stringify(node);
    assert.equal(model(node).duration, duration);
    assert.equal(JSON.stringify(node), original);
  }
});

test('still accepts numbered field headings, colon fields and table labels', () => {
  const fields = readFields(
    '## 1. 建议学习时长\n60 分钟\n2、 难度：3\n### 3.1 章节/单元\n2 微分\n| 4. 重要程度 | 4 |\n5 填写人：同学甲\n6. 修改人：同学乙',
  );
  assert.equal(fields.duration, '60 分钟');
  assert.equal(fields.difficulty, '3');
  assert.equal(fields.chapter, '2 微分');
  assert.equal(fields.importance, '4');
  assert.deepEqual(fields.participants, ['同学甲', '同学乙']);
});

test('does not invent missing metadata, participants or inferred learning progress', () => {
  const value = model({
    id: 'A1',
    title: '空资料',
    sections: { basicInfoMarkdown: '填写人：待补充\n## 难度\n## 知识点名称\n空资料' },
  });
  assert.deepEqual(value.participants, []);
  assert.equal(value.difficulty, '');
  assert.equal(value.duration, '');
  assert.equal(value.summary, '');
  assert.equal(value.stars, undefined);
});

test('bounds overview prose, strips Markdown formatting, and keeps all people', () => {
  const people = Array.from({ length: 25 }, (_, i) => `同学${i}`);
  const value = model(
    {
      summary: '**摘要**'.repeat(80),
      sections: { basicInfoMarkdown: `参与同学：${people.join('、')}` },
    },
    { name: '课程名' },
  );
  assert.equal(value.summary.length, 151);
  assert.equal(value.course, '课程名');
  assert.deepEqual(value.participants, people);
});
