import type { ShowcaseContent } from '../types.js';

const asset = (file: string) => `/development/organization-showcase/sites/organization/${file}`;

const content: ShowcaseContent = {
  slug: 'organization',
  departmentId: 'youth_league.organization',
  name: '清华大学电子工程系团委组织组',
  shortName: '组织组',
  englishName: '',
  tagline: '轻形式、重内容；轻材料、重活动。',
  summary: '为支部和班级活动提供支持。轻形式、重内容；轻材料、重活动。',
  introduction: ['为支部和班级活动提供支持'],
  duties: ['为支部和班级活动提供支持'],
  contacts: [{ name: '组织组副书记 俞昆鹏', email: 'yukp23@mails.tsinghua.edu.cn' }],
  accent: '#c81020',
  darkAccent: '#ffde83',
  layout: 'community',
  hero: {
    src: asset('assets/cover.svg'),
    alt: '团委组织组：为支部和班级活动提供支持',
    aspectRatio: 2,
    position: 'center',
  },
  keywords: ['组织组', '团委', '支部', '班级活动', '活动支持', '轻形式', '重内容'],
  sections: [],
  site: {
    entry: asset('index.html'),
    title: '组织组特色展区',
  },
  sourceNotes: [
    '组织组/组织组开发交接包_含首页_2026-10-16.zip，原始材料解压至组织组目录并保留SHA-256与路径校验记录。',
    '组织组/homepage/index.html、styles.css、assets/youth-league-emblem.png：保留原始团徽、红金方案及已提供的部门名称、工作内容、工作理念。',
    '部门介绍采用提交的HTML方案；由平台提供层级导航，不重复展示原顶栏。暗色模式调整红金明度，手机端允许标题自然换行。',
    '联系人按 NotingSr 补充录入：组织组副书记 俞昆鹏，yukp23@mails.tsinghua.edu.cn。业务需求、示例身份与内存填报demo仅归档，本次未作为正式业务上线。',
  ],
};

export default content;
