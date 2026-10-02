const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  STEPS,
  STATIONS,
  ARCHIVED_STEPS,
  ARCHIVED_STATIONS,
} = require('../public/max-guide-stations');

const read = (file) => fs.readFileSync(path.join(__dirname, '../public', file), 'utf8');
const guide = read('guide.html');
const homepage = read('index.html');
const text = (html) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
const principles = [
  ['FREE LEARNING', '自主学习', '理解并掌握电子信息学科脉络，构建个性化、智能化的个人知识图谱基座'],
  [
    'FREE DISCUSSION',
    '自主讨论',
    '人与人、人与AI深度交流，验证思考、独立判断，找到求知路上的同行者',
  ],
  [
    'FREE EXPLORATION',
    '自主探索',
    '融通电子系代际复利，在真实应用场景中发现边界、推动创新、领跑时代',
  ],
];

test('workbench guide matches five mixed events and individual or batch confirmation', () => {
  const copy = STEPS.find((step) => step.id === 'workbench-ai-plan').body;
  assert.match(copy, /自动识别最多 5 个事件/);
  assert.match(copy, /普通安排与 DDL/);
  assert.match(copy, /逐项修改、分别确认.*全部确认/);
  assert.doesNotMatch(copy, /最多 3/);
});

test('the homepage keeps the approved three FREE statements without repeating them in the handbook', () => {
  principles.forEach(([english, chinese, copy]) => {
    assert.ok(homepage.includes(`<h2>${chinese}</h2>`));
    assert.ok(homepage.includes(`<p>${copy}</p>`));
    assert.ok(homepage.includes(`>${english}</span>`));
  });
  assert.doesNotMatch(guide, /guide-manifesto|guide-values/);
});

test('handbook positioning, identity and agency match the approved copy without stale promises', () => {
  const body = text(guide);
  assert.match(body, /学生主导/);
  assert.match(body, /学习与探索向导/);
  assert.match(body, /尊重他人、保护个人信息/);
  assert.match(body, /学习选择与最终判断始终属于你/);
  assert.match(body, /AI 的重要结论需要核对/);
  assert.doesNotMatch(
    body,
    /小小向导|把疑问交给彼此的思考|支持匿名发帖|昵称与匿名保护|以下是 V1\.0|点击顶部资产数字/,
  );
  assert.match(body, /独立于评价体系/);
  assert.match(body, /每个账号可领取一次/);
  assert.match(body, /不会重复发放/);
  assert.match(STEPS.find((step) => step.id === 'home-launchpad').body, /师生共同建设/);
  assert.match(
    ARCHIVED_STEPS.find((step) => step.id === 'knowledge-companions').reveal.body,
    /课程 RAG/,
  );
  assert.equal(
    ARCHIVED_STATIONS.find((station) => station.id === 'max').title,
    '平台寻址，思路引导和解释',
  );
});

test('handbook opens with its feature directory and keeps the one-time reward at the end', () => {
  const sections = [...guide.matchAll(/<section\b[^>]*>/g)].map((match) => match[0]);
  assert.equal(sections.length, 5);
  assert.match(sections[0], /class="guide-hero"/);
  assert.match(sections[1], /id="guide-stations"/);
  assert.match(sections[2], /id="guide-atlas"/);
  assert.match(sections[3], /id="guide-other-features"/);
  assert.match(sections[4], /class="guide-reward"/);
});

test('handbook focuses on three core cards and describes other features briefly', () => {
  const section = guide.match(/<div class="guide-atlas-grid">([\s\S]*?)<\/section>/)[1];
  const cards = [...section.matchAll(/<article[^>]*>([\s\S]*?)<\/article>/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(
    cards.map((card) => text(card.match(/<h3>(.*?)<\/h3>/s)[1])),
    ['学习世界', '讨论区', '我的工作台'],
  );
  for (const [index, route] of [
    [0, '/world'],
    [1, '/discussion'],
    [2, '/workbench'],
  ])
    assert.ok(cards[index].includes(`href="${route}"`));
  assert.match(text(cards[0]), /学习资源等工具按课程建设进度逐步开放/);
  const other = guide.match(/<section[^>]+id="guide-other-features"[\s\S]*?<\/section>/)[0];
  assert.match(text(other), /Max 问答、实验与工具、活动报名、个人设置/);
  assert.match(text(other), /建设中的入口会标明状态/);
  assert.ok(text(other).length < 240, 'secondary features remain a brief introduction');
  assert.doesNotMatch(guide, /id="guide-(?:missions|community|economy|horizon)"/);
  assert.deepEqual(
    STATIONS.map((station) => station.label),
    ['开始', '学习', '讨论', '计划', '其他功能'],
  );
  assert.equal(STEPS.length, 16);
  for (const tag of guide.matchAll(/<(h1|h2)[^>]*>([\s\S]*?)<\/\1>/g))
    assert.doesNotMatch(text(tag[2]), /。$/);
});
