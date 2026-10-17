import type { ShowcaseContent } from '../types.js';

const content: ShowcaseContent = {
  slug: 'planning',
  departmentId: 'science_association.planning',
  name: '智能策划部',
  shortName: '智能策划部',
  englishName: 'Planning & Communications',
  tagline: '哪里需要，我们就到哪里。',
  summary: '电子系学生科协的「志愿兵」：连接赛事筹划、宣传制作与现场执行，让每一个想法顺利落地。',
  introduction: [
    '智能策划部是科协的「志愿兵」——哪里需要，我们就到哪里。',
    '我们负责辅助大型赛事和活动的筹划安排，同时承担科协的宣传工作。从进入科协的破冰迎新会，到一年一度总结与展望的科协年会，再到大型赛事的全流程筹办，对内筹划与对外宣传都在我们的工作范围内。加入我们，你就是科协综合实力的第一发言人。',
  ],
  duties: [
    '大型赛事与活动的筹划安排：辅助系内大型赛事和活动的整体筹划、物料制作与现场执行。',
    '大型赛事全流程筹办：以智能无人机挑战赛、具身智能比赛为代表，从前期的展板、易拉宝、奖状制作与预告推送，到后期的现场场务、B 站直播与总结推送，全流程由策划部操办。',
    '科协宣传工作：承担科协对外的宣传与推送，是科协综合实力的第一发言人。',
    '跨部门协同支持：在科协其他部门需要时提供人力、创意与执行支持。',
  ],
  contacts: [
    { name: '智能策划部部长 黄雅斐', email: 'huangyf24@mails.tsinghua.edu.cn' },
    { name: '智能策划部部长 龙灿', email: 'longc24@mails.tsinghua.edu.cn' },
  ],
  accent: '#f59b36',
  darkAccent: '#ffd197',
  layout: 'lab',
  sections: [
    {
      id: 'from-idea-to-live',
      title: '让一场赛事从想法走到现场',
      eyebrow: 'THE WHOLE PROCESS',
      introduction: '智能无人机挑战赛、具身智能比赛，是我们全流程筹办大型赛事的代表。',
      layout: 'timeline',
      items: [
        {
          title: '筹划与准备',
          description: '辅助整体筹划安排，制作展板、易拉宝与奖状，完成预告推送。',
          meta: '活动之前',
        },
        {
          title: '场务与直播',
          description: '承担现场场务，开展 B 站直播，为赛事运行提供执行支持。',
          meta: '活动现场',
        },
        {
          title: '记录与传播',
          description: '完成总结推送，让比赛的过程与成果被更多同学看见。',
          meta: '活动之后',
        },
      ],
    },
    {
      id: 'inside-and-outside',
      title: '对内筹划，对外发声',
      layout: 'cards',
      items: [
        {
          title: '从破冰迎新会开始',
          description: '参与进入科协的第一场相遇，筹划欢迎新伙伴的活动。',
        },
        {
          title: '在科协年会相聚',
          description: '在一年一度的总结与展望中，协助完成科协年会的筹划安排。',
        },
        {
          title: '做科协的第一发言人',
          description: '承担科协宣传与推送，把各部门的创意、工作和综合实力传递出去。',
        },
        {
          title: '哪里需要，就到哪里',
          description: '与其他部门协同，在需要时提供人力、创意与执行支持。',
        },
      ],
    },
  ],
  sourceNotes: [
    '依据智能策划部公开投稿《01_部门介绍.docx》整理。',
    '投稿注明的“01_智能无人机挑战赛.jpg”未随包提供，因此未引用该图片。',
    '联系方式保留投稿邮箱，未将个人电话号码发布到页面。',
  ],
};

export default content;
