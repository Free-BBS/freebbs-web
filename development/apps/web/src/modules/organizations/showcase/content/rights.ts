import type { ShowcaseContent } from '../types.js';

const image = (number: number, caption: string, fit: 'cover' | 'contain' = 'cover') => ({
  src: `/development/organization-showcase/content/rights/${String(number).padStart(2, '0')}.webp`,
  alt: caption,
  caption,
  fit,
});

const content: ShowcaseContent = {
  slug: 'rights',
  departmentId: 'student_union.rights_development_center',
  name: '电子系学生会权益发展中心',
  shortName: '权益发展中心',
  englishName: 'Your Voice, Our Commitment',
  tagline: '倾听同学声音，连接每一份期待。',
  summary: '连接电子系师生，回应学习、生活与发展的实际需求，让同学的声音成为推动改变的起点。',
  introduction: [
    '电子系学生会权益发展中心（简称“权发”）是连接电子系师生、服务全系同学的重要学生组织。我们始终关注同学们在学习、生活和发展过程中的实际需求，致力于收集学生声音、反馈学生诉求，为电子系同学创造更加便利、温暖、多元的成长环境。',
    '“权益”与“发展”是我们的核心关键词。一方面，我们关注同学们在学习生活中的各类问题，通过多种渠道收集意见与建议，帮助同学们表达诉求、推动问题解决；另一方面，我们积极参与电子系人才培养与学生发展建设，为课程体系优化、教学安排完善等方面贡献学生视角。',
  ],
  duties: [
    '收集学习生活中的意见与建议，反馈学生诉求，推动问题解决。',
    '举办系主任下午茶，通过问卷、走访收集问题，形成系统化提案，开展师生交流。',
    '参与人才培养与学生发展建设，为课程体系、教学安排等贡献学生视角。',
    '运营“闻新 E 言”，分享学习生活资讯、活动推荐与校园指南。',
    '整理限选课选课指南等信息资源，与任课教师沟通课程内容、教学安排和研究方向。',
    '开展素质拓展活动，参与学生节支持、师生交流协助和权益信息整理等公共事务。',
  ],
  contacts: [],
  contactNote: '有关学习、生活与发展的建议，也可以在公开提案池提出。',
  accent: '#45b6c9',
  darkAccent: '#9ce1ec',
  layout: 'community',
  hero: image(2, '权益发展中心师生交流活动合影'),
  sections: [
    {
      id: 'afternoon-tea',
      title: '系主任下午茶，让真实想法被听见',
      eyebrow: 'A BRIDGE BETWEEN STUDENTS AND FACULTY',
      layout: 'editorial',
      paragraphs: [
        '每学年举办的系主任下午茶是权益发展中心最重要的工作之一。活动前期，我们会通过问卷调研、走访交流等方式收集同学们关心的问题，并形成系统化提案；活动中，我们与系主任及相关老师进行深入交流，将学生的真实想法传递给学院。',
        '历年来，系主任下午茶已经成为电子系师生沟通的重要平台，也推动了包括课程设置、培养方案等方面的持续优化。',
      ],
    },
    {
      id: 'information-and-development',
      title: '让信息更近，让选择更清楚',
      layout: 'cards',
      items: [
        {
          title: '闻新 E 言',
          paragraphs: [
            '我们运营“闻新 E 言”系列栏目，分享学习生活资讯、有趣活动推荐、校园生活指南等内容，帮助同学们在紧张的专业学习之外获取更多实用信息与生活乐趣。',
          ],
        },
        {
          title: '限选课选课指南',
          paragraphs: [
            '我们制作与同学发展密切相关的信息资源，通过与任课教师沟通，整理课程内容、教学安排、研究方向等信息，为同学们的课程选择和未来规划提供参考。',
          ],
          image: image(5, '限选课选课指南页面', 'contain'),
        },
      ],
    },
    {
      id: 'campus-life',
      title: '工作之外，也一起收获友谊',
      layout: 'editorial',
      paragraphs: [
        '在日常工作之外，权益发展中心也组织各类素质拓展活动，如桌游、剧本杀等，为大家提供放松交流的平台，帮助同学们在科研学习之余增进交流、收获友谊。此外，我们还参与电子系学生会公共事务，包括学生节活动支持、师生交流活动协助、权益信息整理等工作，共同服务电子系大家庭。',
        '在这里，你不仅可以倾听同学们的声音，也可以学习如何将一个想法转化为实际行动；你可以与老师深入交流，也可以与志同道合的伙伴共同成长。',
        '未来，权益发展中心将继续秉持“关注同学需求、推动学生发展、建设美好电子系”的理念，成为同学与学院之间可靠的沟通桥梁。欢迎来到电子系学生会权益发展中心！',
      ],
    },
    {
      id: 'rights-moments',
      title: '权发掠影',
      eyebrow: 'MOMENTS TOGETHER',
      layout: 'carousel',
      images: [
        image(1, '师生交流现场', 'contain'),
        image(2, '权益发展中心活动合影'),
        image(3, '参与电子系学生节'),
        image(4, '素质拓展活动合影'),
        image(5, '限选课选课指南', 'contain'),
      ],
    },
  ],
  sourceNotes: [
    '依据权益发展中心投稿《权益发展中心介绍.docx》整理。',
    '按部门希望采用正文与逐张照片展示；照片没有单独提交图说，页面使用不涉及具体人物身份的客观描述。',
    '投稿未提供可用的招新推送链接与联系邮箱，未补造。',
  ],
};

export default content;
