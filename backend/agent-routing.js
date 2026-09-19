// Route before attaching site/circuit context, so retrieved text cannot select an agent.
const SUBJECT =
  /数学|物理|化学|生物|计算机|编程|算法|数据结构|电路|电子|电磁|信号|控制系统|微积分|积分|导数|微分|线性代数|概率|统计|熵|能量|光合作用|力学|热学|光学|卷积|傅里叶|拉普拉斯|滤波|运放|晶体管|二极管|量子|英语|语法|经济学|哲学|历史|文学|\b(?:calculus|algebra|physics|chemistry|biology|algorithm|programming|fourier|convolution|circuit|theorem)\b/i;
const STUDY =
  /知识点|解题|解答.*题|这道题|这题|习题|题目|作业|讲义|课件|教材|课程资料|复习|预习|备考|推导|证明|定理|定律|求解|求导|求极限|学习.{0,15}(?:方法|计划|路线|建议)|(?:怎么|如何)学|\b(?:homework|exercise|derive|prove|solve|study|learn|explain)\b/i;
const QUESTION =
  /什么|为什么|为何|怎样|怎么|如何|解释|讲讲|讲解|分析|计算|原理|区别|关系|理解|教我|帮我|[?？]|\b(?:what|why|how)\b/i;
const SITE_ACTION =
  /(?:打开|进入|前往|跳转|在哪|哪里|(?:怎么用|如何使用).{0,8}(?:本站|网站|实验室|工作台|Max|max)|推荐.*帖|找.*帖|查看.*记录|我的进度|我的课表|今天.*课|明天.*课)|\b(?:open|navigate)\b/i;
const FOLLOWUP =
  /^(?:那|那么|所以)?(?:再|请|能不能|可以)?(?:详细|展开|继续|举个例子|举例|换个例子|解释一下|讲清楚|为什么|怎么得出|怎么算|下一步|这一步|这个公式|这道题|看不懂|没懂|不明白)|\b(?:elaborate|another example|why is that)\b/i;

function userText(message) {
  const content = message?.content;
  const text = Array.isArray(content)
    ? content
        .filter((part) => part?.type === 'text')
        .map((part) => part.text || '')
        .join('\n')
    : typeof content === 'string'
      ? content
      : '';
  return text
    .split(/--- 附件：|【本站电路读取结果/)[0]
    .trim()
    .slice(0, 3000);
}
function isLearningQuestion(text) {
  if (!text || SITE_ACTION.test(text)) return false;
  return STUDY.test(text) || (SUBJECT.test(text) && (QUESTION.test(text) || text.length < 40));
}
function maxAgentRoute(payload) {
  if (payload.source === 'circuit_report') {
    return { agent: 'general_chat', execute_subagent: 'none', combine_general_chat: false };
  }
  const turns = (Array.isArray(payload.messages) ? payload.messages : [])
    .filter((message) => message?.role === 'user')
    .map(userText);
  const question = turns.at(-1) || userText({ content: payload.message });
  let learning = isLearningQuestion(question);
  if (!learning && FOLLOWUP.test(question) && !SITE_ACTION.test(question)) {
    // Stop at the first unrelated user turn instead of reviving an old learning topic.
    for (const previous of turns.slice(0, -1).slice(-4).reverse()) {
      if (isLearningQuestion(previous)) {
        learning = true;
        break;
      }
      if (!FOLLOWUP.test(previous)) break;
    }
  }
  return learning
    ? { agent: 'rag', execute_subagent: 'none', combine_general_chat: false }
    : { agent: 'navigation', execute_subagent: 'auto', combine_general_chat: true };
}
module.exports = { maxAgentRoute };
