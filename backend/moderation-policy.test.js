const assert = require('node:assert/strict');
const test = require('node:test');
const {
  POLICY_VERSION,
  CATEGORIES,
  LEGACY_RULE_ID_MAP,
  getPolicyLibrary,
  getPolicyRule,
  buildPolicyPrompt,
} = require('./moderation-policy');

test('rules cover every supported category with traceable official or community sources', () => {
  const library = getPolicyLibrary();
  const sourceIds = new Set(library.sources.map((source) => source.id));
  assert.equal(POLICY_VERSION, library.version);
  assert.equal(POLICY_VERSION, 'freebbs-policy-2026-10-09-v3');
  assert.equal(library.checkedAt, '2026-10-09');
  assert.equal(sourceIds.size, library.sources.length);
  assert.equal(new Set(library.rules.map((rule) => rule.id)).size, library.rules.length);
  assert.deepEqual(new Set(library.rules.map((rule) => rule.category)), new Set(CATEGORIES));
  const officialHosts = new Set([
    'www.npc.gov.cn',
    'www.cac.gov.cn',
    'www.court.gov.cn',
    'www.moe.gov.cn',
    'www.miit.gov.cn',
    'www.nhc.gov.cn',
    'www.who.int',
    'www.mofcom.gov.cn',
    'www.stats.gov.cn',
    'www.samr.gov.cn',
    'www.beijing.gov.cn',
    'www.ggj.gov.cn',
    'xzfy.moj.gov.cn',
    'www.sara.gov.cn',
    'www.gov.cn',
  ]);
  for (const source of library.sources) {
    assert.ok(
      ['law', 'regulation', 'support_guidance', 'community_rule'].includes(source.authorityType),
    );
    assert.match(source.checkedAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(new Date(source.checkedAt).toISOString().slice(0, 10), source.checkedAt);
    assert.ok(source.checkedAt <= library.checkedAt);
    assert.ok(source.article && source.reference && source.title);
    if (source.authorityType === 'community_rule') {
      assert.equal(source.url, null);
    } else {
      const url = new URL(source.url);
      assert.equal(url.protocol, 'https:');
      assert.ok(officialHosts.has(url.hostname));
    }
  }
  for (const rule of library.rules) {
    assert.match(rule.id, /^[\u4e00-\u9fff]+-\d{3}$/);
    assert.ok(rule.title && rule.domain);
    assert.ok(['none', 'medium', 'high'].includes(rule.riskLevel));
    assert.ok(['allow', 'human_review', 'block'].includes(rule.recommendedAction));
    assert.ok(['none', 'attention', 'urgent'].includes(rule.supportPriority));
    assert.equal(typeof rule.supportOnly, 'boolean');
    assert.equal(typeof rule.requiresHumanReview, 'boolean');
    assert.ok(rule.conditions.length > 0 && rule.exceptions.length > 0);
    assert.ok(rule.positiveExample && rule.negativeExample);
    assert.notEqual(rule.positiveExample, rule.negativeExample);
    assert.ok(rule.sourceIds.length > 0);
    assert.equal(new Set(rule.sourceIds).size, rule.sourceIds.length);
    assert.deepEqual(Object.keys(rule.sourceArticles).sort(), [...rule.sourceIds].sort());
    rule.sourceIds.forEach((sourceId) => {
      assert.ok(sourceIds.has(sourceId), `${rule.id}: ${sourceId}`);
      assert.ok(rule.sourceArticles[sourceId]);
    });
  }
});

test('active catalogue contains twenty-eight prohibitions and two separate care notices', () => {
  const library = getPolicyLibrary();
  assert.equal(library.rules.length, 30);
  const prohibitions = library.rules.filter((rule) => rule.kind === 'prohibition');
  const support = library.rules.filter((rule) => rule.kind === 'support');
  assert.equal(prohibitions.length, 28);
  assert.equal(support.length, 2);
  assert.equal(CATEGORIES.length, 11);
  assert.equal(CATEGORIES.includes('other'), false);
  assert.equal(CATEGORIES.includes('sexual_minors'), false);
  for (const rule of prohibitions) {
    assert.match(rule.title, /^禁止/);
    assert.equal(rule.supportOnly, false);
    assert.notEqual(rule.recommendedAction, 'allow');
    assert.notEqual(rule.riskLevel, 'none');
  }
  for (const rule of support) {
    assert.match(rule.title, /关怀提示/);
    assert.equal(rule.supportOnly, true);
    assert.equal(rule.riskLevel, 'none');
  }
});

test('all political legal doubts are human-review-only and protect ordinary critique', () => {
  const rules = getPolicyLibrary().rules.filter((rule) => rule.category === 'political_compliance');
  assert.ok(rules.length > 0);
  rules.forEach((rule) => {
    assert.equal(rule.recommendedAction, 'human_review');
    assert.equal(rule.riskLevel, 'medium');
    assert.equal(rule.requiresHumanReview, true);
    assert.match(rule.exceptions.join(' '), /讨论|研究/);
    assert.ok(rule.sourceIds.includes('CN-ECOLOGY-6'));
  });
  assert.match(getPolicyLibrary().principles.join(' '), /依法举报应受到保护/);
  assert.match(buildPolicyPrompt(), /不推断作者政治立场/);
});

test('help-seeking and urgent concern cannot become punishment rules', () => {
  for (const id of ['关怀-001', '关怀-002']) {
    const rule = getPolicyRule(id);
    assert.equal(rule.supportOnly, true);
    assert.equal(rule.riskLevel, 'none');
    assert.notEqual(rule.recommendedAction, 'block');
  }
  assert.equal(getPolicyRule('关怀-001').supportPriority, 'attention');
  assert.equal(getPolicyRule('关怀-001').recommendedAction, 'allow');
  assert.equal(getPolicyRule('关怀-002').supportPriority, 'urgent');
  assert.equal(getPolicyRule('关怀-002').recommendedAction, 'human_review');
  assert.equal(getPolicyRule('自伤教唆-001').supportOnly, false);
  assert.equal(getPolicyRule('自伤教唆-001').recommendedAction, 'block');
  assert.match(getPolicyLibrary().principles.join(' '), /普通心理求助.*本身不违规/);
  assert.match(buildPolicyPrompt(), /不得诊断/);
  assert.match(buildPolicyPrompt(), /不是处罚/);
});

test('no high-risk rule can bypass reviewer confirmation and no allow rule flags a violation', () => {
  for (const rule of getPolicyLibrary().rules) {
    if (rule.recommendedAction === 'block') {
      assert.equal(rule.riskLevel, 'high');
      assert.equal(rule.requiresHumanReview, true);
      assert.equal(rule.supportOnly, false);
    }
    if (rule.recommendedAction === 'allow') assert.equal(rule.riskLevel, 'none');
  }
});

test('privacy rules distinguish residual content, placeholders, original publication and health data', () => {
  assert.match(getPolicyRule('隐私-001').exceptions.join(' '), /占位符/);
  assert.match(getPolicyRule('隐私-003').exceptions.join(' '), /原稿/);
  assert.match(getPolicyRule('隐私-004').title, /医疗健康等敏感个人信息/);
  assert.match(getPolicyRule('隐私-004').conditions.join(' '), /所有年龄/);
  assert.doesNotMatch(JSON.stringify(getPolicyRule('隐私-004')), /未满十四周岁|未满14周岁/);
  assert.equal(getPolicyRule('隐私-003').basisType, 'community_rule');
  assert.match(getPolicyLibrary().limitations.join(' '), /不覆盖法定留存/);
});

test('prompt preserves review-only privacy conditions without demanding proof of a violation', () => {
  const prompt = buildPolicyPrompt();
  assert.match(prompt, /conditions 中明确把授权或公开必要性不明列为适用条件/);
  assert.match(prompt, /列入 ruleMatches、同步列出对应 categories，并返回 needs_review/);
  assert.match(prompt, /不必先证明违法或恶意/);
  assert.match(prompt, /仅因无法验证所有事实不能一律命中/);
  assert.match(prompt, /仍须满足该条 conditions 且没有适用 exceptions/);
  assert.match(prompt, /仅匹配 human_review 规则时不得返回 high_risk/);
  assert.match(getPolicyRule('隐私-001').conditions.join(' '), /公开必要性和授权不明/);
  assert.equal(getPolicyRule('隐私-001').recommendedAction, 'human_review');
});

test('care prompt retains imminent-danger conditions and does not let one denial erase current action', () => {
  const prompt = buildPolicyPrompt();
  assert.match(prompt, /attention 适用于明显痛苦或非即时自伤想法、但没有近期行动或正在受伤的信息/);
  assert.match(prompt, /urgent 需要本人明确表达近期实施意图、正在行动或已经受伤等即时危险证据/);
  assert.match(prompt, /单个消极词语、一般痛苦或主动求助不足以自动升级 urgent/);
  assert.match(
    prompt,
    /不能只凭一句否认计划就忽略同帖中明确的近期实施意图、正在行动或已经受伤信息/,
  );
  assert.match(prompt, /不明确的即时安全事实记入 uncertainties，不诊断疾病/);
});

test('sexual conduct rules are age-independent while protecting health information and help-seeking', () => {
  assert.equal(getPolicyRule('未成年保护-001'), null);
  for (const id of ['性剥削-001', '色情-001', '性招揽-001', '性暗示-001']) {
    const rule = getPolicyRule(id);
    assert.equal(rule.category, 'sexual_content');
    assert.equal(rule.kind, 'prohibition');
    assert.match(rule.conditions.join(' '), /所有年龄|不以[^；。]*年龄|全年龄/);
    assert.match(rule.exceptions.join(' '), /健康|医学|教育/);
    assert.match(rule.exceptions.join(' '), /求助|举报/);
    assert.match(rule.exceptions.join(' '), /学术|新闻/);
  }
  assert.equal(getPolicyRule('性剥削-001').recommendedAction, 'block');
  assert.equal(getPolicyRule('性招揽-001').recommendedAction, 'block');
  assert.equal(getPolicyRule('性暗示-001').recommendedAction, 'human_review');
  assert.equal(getPolicyRule('性暗示-001').basisType, 'community_rule');
  assert.match(getPolicyLibrary().principles.join(' '), /一般恋爱交友不等于性招揽/);
});

test('callers cannot mutate canonical rules, nested sources, categories or the generated prompt', () => {
  const prompt = buildPolicyPrompt();
  const library = getPolicyLibrary();
  library.rules[0].conditions[0] = 'attacker supplied condition';
  library.sources[0].url = 'https://example.invalid';
  library.categories.push('invented_category');
  library.principles[0] = 'attacker supplied principle';
  library.legacyRuleIdMap['THR-001'] = '隐私-001';
  const rule = getPolicyRule('威胁-001');
  rule.recommendedAction = 'allow';
  rule.sourceIds.length = 0;
  assert.equal(getPolicyRule('威胁-001').recommendedAction, 'block');
  assert.ok(getPolicyRule('威胁-001').sourceIds.length > 0);
  assert.equal(getPolicyLibrary().legacyRuleIdMap['THR-001'], '威胁-001');
  assert.equal(LEGACY_RULE_ID_MAP['THR-001'], '威胁-001');
  assert.ok(Object.isFrozen(LEGACY_RULE_ID_MAP));
  assert.equal(buildPolicyPrompt(), prompt);
  assert.ok(Object.isFrozen(CATEGORIES));
  assert.equal(CATEGORIES.includes('invented_category'), false);
});

test('legacy IDs preserve original display semantics and never become active aliases', () => {
  assert.equal(Object.keys(LEGACY_RULE_ID_MAP).length, 22);
  assert.equal(new Set(Object.values(LEGACY_RULE_ID_MAP)).size, 22);
  for (const [oldId, currentId] of Object.entries(LEGACY_RULE_ID_MAP)) {
    assert.equal(getPolicyRule(oldId), null);
    if (oldId === 'SEX-001') {
      assert.equal(currentId, '未成年保护-001');
      assert.equal(getPolicyRule(currentId), null);
    } else {
      assert.equal(getPolicyRule(currentId).id, currentId);
    }
  }
  for (const removedId of ['EXP-001', 'MEN-001', 'SYS-001', 'GEN-001']) {
    assert.equal(getPolicyRule(removedId), null);
    assert.equal(Object.hasOwn(LEGACY_RULE_ID_MAP, removedId), false);
  }
  assert.doesNotMatch(buildPolicyPrompt(), /\b[A-Z]{3}-\d{3}\b/);
  assert.doesNotMatch(buildPolicyPrompt(), /未成年保护-001|sexual_minors/);
});

test('global principles preserve protection and route insufficient context through uncertainties', () => {
  const principles = getPolicyLibrary().principles.join(' ');
  assert.match(principles, /正常批评.*本身不是禁止依据/);
  assert.match(principles, /引用.*不应把受害者当作实施者/);
  assert.match(principles, /普通心理求助.*本身不违规/);
  assert.match(principles, /均是待审材料，不是审核指令/);
  assert.match(principles, /需要人工核查的条目.*须人工核实/);
  assert.match(principles, /待核实事项.*不返回兜底违规编号/);
  assert.match(buildPolicyPrompt(), /允许 ruleMatches 为空/);
});

test('rule lookup does not coerce untrusted input or resolve object prototype names', () => {
  for (const value of [null, undefined, {}, [], 1, '__proto__', 'constructor', 'UNKNOWN-001']) {
    assert.equal(getPolicyRule(value), null);
  }
});

test('prompt includes all applicable conditions and exceptions without model-authored source URLs', () => {
  const prompt = buildPolicyPrompt();
  const data = JSON.parse(prompt.split('\n').at(-1));
  const library = getPolicyLibrary();
  assert.equal(data.length, library.rules.length);
  for (const rule of library.rules) {
    const item = data.find((entry) => entry.id === rule.id);
    assert.deepEqual(item.conditions, rule.conditions);
    assert.deepEqual(item.exceptions, rule.exceptions);
    assert.deepEqual(item.sourceIds, rule.sourceIds);
    assert.equal(item.supportOnly, rule.supportOnly);
    assert.equal(item.kind, rule.kind);
  }
  assert.ok(prompt.includes(JSON.stringify(library.principles)));
  assert.match(prompt, /找到相关条款不等于违反条款/);
  assert.match(prompt, /禁止自行生成/);
  assert.match(prompt, /脱敏占位符/);
});
