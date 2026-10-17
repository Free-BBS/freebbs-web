// Topic routing is independent of prohibited content and clinical urgency.
const TOPIC_CONTRACT_VERSION = 'freebbs-review-topics-v1';
const KEYS = ['political', 'psychological'];
const plain = (x) => Boolean(x && Object.getPrototypeOf(x) === Object.prototype);
const exact = (x, keys) =>
  plain(x) && Object.keys(x).sort().join(',') === [...keys].sort().join(',');
const bounded = (x, max) =>
  typeof x === 'string' &&
  Boolean(x.trim()) &&
  x.length <= max &&
  !Array.from(x).some((char) => {
    const code = char.codePointAt(0);
    return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
  });

function topicSchema(fields = ['title', 'content']) {
  return {
    type: 'object',
    additionalProperties: false,
    required: KEYS,
    properties: Object.fromEntries(
      KEYS.map((key) => [
        key,
        {
          type: 'array',
          maxItems: 3,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['field', 'quote', 'reason'],
            properties: {
              field: { type: 'string', enum: fields },
              quote: { type: 'string', minLength: 1, maxLength: 240 },
              reason: { type: 'string', minLength: 1, maxLength: 300 },
            },
          },
        },
      ]),
    ),
  };
}

function validateReviewTopics(value, sources) {
  if (!exact(value, KEYS)) throw new Error('review_topics_invalid');
  return Object.fromEntries(
    KEYS.map((key) => {
      if (!Array.isArray(value[key]) || value[key].length > 3)
        throw new Error('review_topics_invalid');
      const seen = new Set();
      return [
        key,
        value[key].map((item) => {
          if (
            !exact(item, ['field', 'quote', 'reason']) ||
            !bounded(item.quote, 240) ||
            !bounded(item.reason, 300) ||
            typeof item.field !== 'string' ||
            !Object.hasOwn(sources, item.field) ||
            !sources[item.field].some(
              (part) => typeof part === 'string' && part.includes(item.quote),
            )
          ) {
            throw new Error('review_topics_invalid');
          }
          const identity = JSON.stringify([item.field, item.quote]);
          if (seen.has(identity)) throw new Error('review_topics_invalid');
          seen.add(identity);
          return { field: item.field, quote: item.quote, reason: item.reason };
        }),
      ];
    }),
  );
}

function topicPrompt(fields = ['title', 'content']) {
  return `独立话题复核合同 ${TOPIC_CONTRACT_VERSION}：必须另外输出 reviewTopics，且恰有 political、psychological 两个数组，每类至多3项；确实未发现该话题时给空数组，不能省略该字段或任一类别。
结合标题、完整正文以及本次实际提供的图片上下文逐句判断，识别别称、指代、隐喻和同义表达；不只搜索关键词。没有提供的上下文不得编造。这里判断的是是否须负责人复核，独立于是否违规、政治立场、疾病诊断和自伤紧迫程度；无违规的正常新闻、学术引用、讨论也可能是相关话题，decision 仍可 no_risk_detected，categories 仍可为空，不能为了话题复核编造禁止规则或提高 supportPriority。
political：内容实际涉及中国大陆政治人物、政治组织或机构、政治制度或意识形态、主权与领土争议、相关政治历史事件，或有具体语境支持的相关影射。普通校园管理批评、日常抱怨、普通人物、软件版本号不能仅凭想象推为政治指代；可疑指代有具体依据但不能确定时也应列入并说明不确定性。
psychological：内容语义涉及心理健康问题、情绪困扰、心理求助、心理治疗或自伤危机，包括未使用任何明确关键词的持续痛苦、兴趣丧失或无助表达，以及相关心理健康讨论。不作疾病诊断；普通考试紧张、偶发抱怨、歌词引文需按实际上下文区分，程序崩溃、手机没电等技术或物理描述不属于心理问题。上下文确有心理问题线索而不确定时列入并解释，不得用“未达到自伤程度”排除。
每项恰为 {"field":"来源字段","quote":"该字段内的最短充分连续原文","reason":"该语境为何涉及此话题或需核查"}。field 只能取 ${fields.join('/')}；quote 为1至240字逐字连续引用，不跨字段，不猜测图片缺字；reason 为1至300字简短中文，不复述身份、地址等隐私值，不输出内部思考过程。图片证据从对应 imageObservations.text 或 description 连续引用，不能混用不同图片。模型不能用“是正常表达”取消话题复核；最终发布权限由本地程序和负责人决定。`;
}

module.exports = { TOPIC_CONTRACT_VERSION, topicSchema, topicPrompt, validateReviewTopics };
