const { getPolicyRule } = require('./moderation-policy');

// Routing hints only: these signals request a person's attention and never
// establish a violation, political position, diagnosis or punishment.
function getReviewFocus({ title = '', content = '', assessments = [], observations = [] } = {}) {
  const text = [
    title,
    content,
    ...observations.flatMap((item) => [item.text || '', item.description || '']),
  ].join('\n');
  const rules = assessments
    .flatMap((item) => (item?.ruleMatches || []).map((match) => getPolicyRule(match.ruleId)))
    .filter(Boolean);
  const political =
    assessments.some((item) => item?.categories?.includes('political_compliance')) ||
    rules.some((rule) => rule.category === 'political_compliance') ||
    /(?:政治敏感|国家领导人|国家主席|中国共产党|中央政治局|分裂国家|颠覆国家政权|台湾独立|台独|国家安全法|反分裂国家法)/u.test(
      text,
    );
  const psychological =
    assessments.some((item) => item?.supportPriority && item.supportPriority !== 'none') ||
    assessments.some((item) => item?.categories?.includes('self_harm')) ||
    rules.some((rule) => rule.domain === 'mental_support' || rule.category === 'self_harm') ||
    /(?:心理求助|心理咨询|抑郁症|双相情感障碍|惊恐发作|不想活了|不想再活|想结束生命|想自杀|想轻生|想自伤|想伤害自己)/u.test(
      text,
    ) ||
    /(?:我|同学|朋友|室友|有人).{0,24}(?:抑郁|持续焦虑|焦虑到|情绪崩溃|心理问题)/u.test(text);
  return { political, psychological };
}

module.exports = { getReviewFocus };
