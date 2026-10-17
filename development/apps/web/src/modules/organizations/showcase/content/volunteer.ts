import type { ShowcaseContent } from '../types.js';

const content: ShowcaseContent = {
  slug: 'volunteer',
  departmentId: 'youth_league.volunteer',
  name: '电子系团委志愿组',
  shortName: '志愿组',
  englishName: 'Small Acts, Shared Warmth',
  tagline: '让志愿成为行动，让服务连接你我。',
  summary: '策划志愿项目，连接社区与同学，为电子系本科生搭建参与公益、实现服务设想的平台。',
  introduction: [
    '电子系团委志愿组，是校团委志愿中心和电子系团委指导下的基层志愿者组织。我们通过策划志愿项目、组织同学参与志愿活动等方式，宣传志愿精神，营造志愿氛围，培养同学志愿公益意识以及服务社会的理念，并为电子系同学在学习生活中提供力所能及的帮助和服务。',
  ],
  duties: [
    '为电子系及全体本科生提供参与志愿活动的机会：策划鸿越计划、E林故事会、社区清洁等项目，负责志愿者招募、组织前往、工时录入及总结答辩。',
    '面向电子系班团支部、扬帆计划同学以及所有对策划志愿活动感兴趣的电子系本科同学，对接志愿资源，搭建活动平台，在流程管理与活动开展等方面提供帮助。',
    '策划志愿公益论坛，与兄弟高校及相关院系志愿组开展联络与志愿项目合作。',
    '做好与学校志愿中心的沟通联络，转发和转载学校其他部门组织的志愿服务项目。',
  ],
  contacts: [{ name: '部门公共邮箱', email: 'eezijing@163.com' }],
  accent: '#ed9d76',
  darkAccent: '#ffc7ac',
  layout: 'field',
  hero: {
    src: '/development/organization-showcase/content/volunteer/01.webp',
    alt: '志愿组合照',
    caption: '志愿组合照',
    fit: 'cover',
    aspectRatio: 2.35,
    mobileAspectRatio: 1.75,
    position: 'center 70%',
  },
  sections: [
    {
      id: 'volunteering-nearby',
      title: '在身边的社区，做力所能及的事',
      eyebrow: 'VOLUNTEER WITH US',
      layout: 'editorial',
      paragraphs: [
        '鸿越计划、E林故事会、社区清洁……志愿组策划组织的活动主要在清华周边多个社区开展，面向不同年龄段人群。我们为电子系及全体本科生提供参与的机会，负责志愿者招募、组织前往、工时录入及总结答辩。',
      ],
    },
    {
      id: 'bring-your-idea',
      title: '你有服务的设想，我们一起把它实现',
      layout: 'cards',
      items: [
        {
          title: '连接志愿资源',
          description:
            '面向班团支部、扬帆计划同学和对志愿活动策划感兴趣的电子系本科同学，对接资源，搭建开展志愿活动的平台。',
        },
        {
          title: '陪伴活动开展',
          description: '在流程管理、活动开展等方面提供多方位帮助，支持大家实现活动设想。',
        },
        {
          title: '交流与合作',
          description: '策划志愿公益论坛，与兄弟高校和相关院系志愿组联络，开展志愿项目合作。',
        },
        {
          title: '共享志愿机会',
          description: '与学校志愿中心保持沟通，转发和转载学校其他部门组织的志愿服务项目。',
        },
      ],
    },
    {
      id: 'learn-more',
      title: '认识志愿组，从这里开始',
      layout: 'projects',
      items: [
        {
          title: '志愿组招新推送',
          description: '了解志愿组的项目与参与方式。',
          href: 'https://mp.weixin.qq.com/s/0s4SQgKZ1Ft-L9R_GZQvgQ',
          linkLabel: '阅读招新推送',
        },
      ],
    },
  ],
  sourceNotes: [
    '依据志愿组公开投稿《部门介绍.docx》整理。',
    '保留部门职责、项目名称、公共邮箱及招新推送原链接；封面为 NotingSr 于 2026-10-16 补充指定的志愿组合照。',
  ],
};

export default content;
