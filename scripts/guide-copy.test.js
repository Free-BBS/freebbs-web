const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { STEPS, STATIONS } = require('../public/max-guide-stations');

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

test('the handbook three FREE statements exactly match the approved homepage wording', () => {
  const section = guide.match(/<div class="guide-values">([\s\S]*?)<\/section>/)[1];
  const cards = [...section.matchAll(/<article>([\s\S]*?)<\/article>/g)].map((match) => match[1]);
  assert.equal(cards.length, 3);
  principles.forEach(([english, chinese, copy], index) => {
    assert.equal(text(cards[index].match(/<h3>(.*?)<\/h3>/s)[1]), english);
    assert.equal(text(cards[index].match(/<strong>(.*?)<\/strong>/s)[1]), chinese);
    assert.equal(text(cards[index].match(/<p>(.*?)<\/p>/s)[1]), copy);
    assert.ok(homepage.includes(`<h2>${chinese}</h2>`));
    assert.ok(homepage.includes(`<p>${copy}</p>`));
    assert.ok(homepage.includes(`>${english}</span>`));
  });
});

test('handbook positioning, identity and agency match the approved copy without stale promises', () => {
  const body = text(guide);
  assert.match(body, /由学生主导、师生共同建设的电子系学习发展共同体/);
  assert.match(body, /学习与探索向导/);
  assert.match(body, /讨论区前台显示昵称，后台保留实名身份/);
  assert.match(body, /学习选择与最终判断始终属于你/);
  assert.match(body, /不代替你思考或直接交付作业答案/);
  assert.doesNotMatch(
    body,
    /小小向导|把疑问交给彼此的思考|支持匿名发帖|昵称与匿名保护|以下是 V1\.0|点击顶部资产数字/,
  );
  assert.match(body, /电脑端点击左下角资产区域/);
  assert.match(body, /热力.*不用于评价学习能力或综合表现/);
  assert.match(body, /每个账号可领取一次/);
  assert.match(body, /不会重复发放/);
  assert.match(STEPS.find((step) => step.id === 'home-launchpad').body, /师生共同建设/);
  assert.match(STEPS.find((step) => step.id === 'knowledge-companions').reveal.body, /课程 RAG/);
  assert.equal(STATIONS.find((station) => station.id === 'max').title, '平台寻址，思路引导和解释');
});

test('handbook feature cards follow navigation order and keep planned capabilities explicitly planned', () => {
  const section = guide.match(/<div class="guide-atlas-grid">([\s\S]*?)<\/section>/)[1];
  const cards = [...section.matchAll(/<article[^>]*>([\s\S]*?)<\/article>/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(
    cards.map((card) => text(card.match(/<h3>(.*?)<\/h3>/s)[1])),
    [
      '学习世界',
      '讨论区',
      '我的工作台',
      '实验室',
      '创意工坊',
      'PBL 计划',
      '问问 Max',
      '活动报名（试用）',
      '发展端',
    ],
  );
  for (const [index, route, source] of [
    [4, '/creative-workshop', 'creative-workshop.html'],
    [5, '/pbl', 'pbl.html'],
  ]) {
    assert.match(cards[index], /guide-tag-future">规划中/);
    assert.ok(cards[index].includes(`href="${route}"`));
    assert.match(cards[index], /目前尚未开放/);
    const page = read(source);
    assert.ok(page.includes(index === 4 ? 'V1.2' : 'V2.0'));
    assert.ok(cards[index].includes(index === 4 ? 'V1.2' : 'V2.0'));
  }
  assert.match(text(cards[3]), /代码实验室支持 C\/C\+\+ 多架构汇编/);
  assert.match(text(cards[0]), /学习资源等工具按课程建设进度逐步开放/);
  for (const tag of guide.matchAll(/<(h1|h2)[^>]*>([\s\S]*?)<\/\1>/g))
    assert.doesNotMatch(text(tag[2]), /。$/);
});
