import type { ShowcaseContent } from '../types.js';

const image = (number: number, caption: string, fit: 'cover' | 'contain' = 'cover') => ({
  src: `/development/organization-showcase/content/freshman/${String(number).padStart(2, '0')}.webp`,
  alt: caption,
  caption,
  fit,
});

const content: ShowcaseContent = {
  slug: 'freshman',
  departmentId: 'youth_league.freshman',
  name: '办公室·新生组',
  shortName: '办公室·新生组',
  englishName: 'Your First Days, Our Shared Story',
  tagline: '带着为学弟学妹服务的初心，陪你走过大学的第一程。',
  summary:
    '从报到迎新、Free 之夜到新生对接和工作坊，帮助新同学适应大学生活；也做团委日常运转的“小管家”。',
  introduction: [
    '办公室·新生组是电子系团委下属的学生组织，秉持为学弟学妹服务的初心。一方面，我们通过每年的迎新活动、新生对接、新生工作坊等，帮助大一年级的学弟学妹更快地适应大学的学习生活；另一方面，我们还扮演着“小管家”的角色，负责联络团委各部门，帮助团委高效运转。',
  ],
  duties: [
    '筹备迎新：制作宿舍名牌、新生手册与入学推送，承担迎新现场接待。',
    '筹备 Free 之夜晚会，创作辅导员视频与 DV 剧。',
    '组织新生对接，帮助新同学熟悉选课、备考与大学生活。',
    '举办新生工作坊，提供体育技能、实用技能的体验教学。',
    '联络团委各部门，参与财务报销、活动室整理等日常事务。',
  ],
  contacts: [{ name: '新生组副书记 郭珂羽', email: 'guoky23@mails.tsinghua.edu.cn' }],
  accent: '#f1bb49',
  darkAccent: '#ffe09a',
  layout: 'community',
  hero: image(2, '迎新现场'),
  sections: [
    {
      id: 'welcome',
      title: '你的报到，我们从暑假开始准备',
      eyebrow: 'WELCOME TO EE',
      layout: 'editorial',
      paragraphs: [
        '每年暑假的时候，新生组就要开始为学弟学妹的报到做准备。大家的宿舍名牌、正在读的新生手册、入学推送、迎新现场的接待，包括军训结束后的 Free 之夜晚会，都有新生组的很大功劳！',
      ],
      images: [image(2, '迎新现场'), image(1, '新生组合影')],
    },
    {
      id: 'free-night',
      title: 'Free 之夜，幕后也有我们',
      layout: 'gallery',
      paragraphs: [
        '大家在 Free 之夜中看到的辅导员视频和 DV 剧也出自我们之手。所以，如果有创作、表演或者恶搞辅导员的愿望，新生组也是你发挥的天地！',
      ],
      images: [
        image(3, '辅导员视频', 'contain'),
        image(4, '辅导员热舞', 'contain'),
        image(5, 'Free 之夜合影'),
      ],
    },
    {
      id: 'through-the-first-year',
      title: '陪你熟悉新的节奏',
      layout: 'cards',
      items: [
        {
          title: '新生对接',
          paragraphs: [
            '学期中我们还会组织多次新生对接活动，帮助大家熟悉选课、备考的节奏，更快地适应大学生活，顺利迎接各种挑战。大家有什么问题也可以随时询问对接的学长学姐！',
          ],
        },
        {
          title: '新生工作坊',
          meta: '2024 年秋季开始',
          paragraphs: [
            '我们开创了“新生工作坊”活动，为新生们举办了“冰壶”“射箭”“LaTeX”等体育技能、实用技能的体验教学活动，帮助大家多多探索清华园里的资源。我们会继续这项活动，欢迎大家积极反馈感兴趣的工作坊，说不定就会在下次通知中看到它啦！',
          ],
        },
        {
          title: '团委的小管家',
          paragraphs: [
            '团委背后默默运营的财务报销、活动室整理，也都有我们的身影。能够看到团委工作的顺利开展，我们就心满意足！',
          ],
        },
      ],
    },
    {
      id: 'together',
      title: '还有更多惊喜，等你一起探索',
      layout: 'gallery',
      paragraphs: [
        '新生组还有丰富多彩的团建活动、和谐愉快的组内氛围……更多惊喜，期待大家前来探索！欢迎大家多多和我们交流，更欢迎大家加入我们！',
      ],
      images: [image(6, '新生组团建 1'), image(7, '新生组团建 2')],
    },
  ],
  sourceNotes: [
    '依据新生组投稿《BBS新生组介绍.doc》整理，全部 7 张配图按正文指定位置编排。',
    '保留办公室·新生组正式名称与投稿联系邮箱。',
  ],
};

export default content;
