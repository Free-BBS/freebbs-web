const sourceLibrary = require('./moderation-policy-library.json');

function deepFreeze(value) {
  Object.values(value).forEach((child) => {
    if (child && typeof child === 'object') deepFreeze(child);
  });
  return Object.freeze(value);
}

// Keep the canonical rules private: neither a caller nor a model can amend them.
const library = deepFreeze(structuredClone(sourceLibrary));
const POLICY_VERSION = library.version;
const CATEGORIES = Object.freeze([...library.categories]);
// Historical display only. This mapping must not turn retired IDs into active aliases.
const LEGACY_RULE_ID_MAP = deepFreeze(structuredClone(library.legacyRuleIdMap));
const rulesById = new Map(library.rules.map((rule) => [rule.id, rule]));

function getPolicyLibrary() {
  return structuredClone(library);
}

function getPolicyRule(id) {
  const rule = typeof id === 'string' ? rulesById.get(id) : undefined;
  return rule ? structuredClone(rule) : null;
}

function buildPolicyPrompt() {
  const rules = library.rules.map((rule) => ({
    id: rule.id,
    kind: rule.kind,
    title: rule.title,
    category: rule.category,
    riskLevel: rule.riskLevel,
    recommendedAction: rule.recommendedAction,
    supportPriority: rule.supportPriority,
    supportOnly: rule.supportOnly,
    requiresHumanReview: rule.requiresHumanReview,
    conditions: rule.conditions,
    exceptions: rule.exceptions,
    sourceIds: rule.sourceIds,
  }));
  return [
    `本站审核规则版本：${POLICY_VERSION}；来源核查日期：${library.checkedAt}。`,
    '下列禁止项与独立关怀提示是审核条件，不是关键词表，也不是法律或医学结论。逐条核对适用条件与例外；找到相关条款不等于违反条款。',
    '只使用下列条目的中文规则编号；未列出的历史编号不可返回，包括已停用的中文编号。法律标题、条号、来源地址由本地程序提供，禁止自行生成或声称负责人已经确认。',
    'kind=prohibition 表示禁止范围；是否适用仍须核对条件、例外和证据。kind=support 仅提供关怀，不是禁止项，不得据此添加违规类别。supportPriority 与内容处置分别判断。',
    'supportOnly=true 的关怀卡本身不属于违规；紧急求助可以是无违规且 urgent，本地暂缓公开是保护性复核，不是处罚。',
    '政治议题、人名、机构名、政策名、历史事件、批评和不同意见本身不是拒绝依据；不推断作者政治立场，不建立立场档案。',
    '心理求助、疾病经历和负面情绪本身不是违规；不得诊断、输出自杀概率、惩罚求助者或决定联系家长、学校及执法机构。',
    '所有推荐动作均由本地程序约束、由负责人复核；human_review 规则不能单独升级成明确高风险或自动拒绝。',
    '只检查实际给出的材料。脱敏占位符不代表残留隐私，也不能替原稿作安全保证；未收到图片像素就不能判断图片。',
    '没有适用禁止项时允许 ruleMatches 为空。存在具体潜在伤害但语境不足时，通过 uncertainties 说明缺失事实，不编造规则编号或违规类别。',
    `全局判断原则（不是可返回规则）：${JSON.stringify(library.principles)}`,
    JSON.stringify(rules),
  ].join('\n');
}

module.exports = {
  POLICY_VERSION,
  CATEGORIES,
  LEGACY_RULE_ID_MAP,
  getPolicyLibrary,
  getPolicyRule,
  buildPolicyPrompt,
};
