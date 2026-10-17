import type { ShowcaseContent, ShowcaseImage } from '../types.js';

const image = (number: number, alt: string): ShowcaseImage => ({
  src: `/development/organization-showcase/images/training-${String(number).padStart(2, '0')}.webp`,
  alt,
  aspectRatio: 4 / 3,
  position: 'center',
});

const content: ShowcaseContent = {
  slug: 'training',
  departmentId: 'science_association.training',
  name: '学习培养部',
  englishName: 'Learn, Share, Grow',
  tagline: '把学习的经验，变成彼此的助力。',
  summary:
    '小班辅导、课程口袋书、Matlab 与 Python 培训，还有来自学长学姐的成长经验。学习和科研路上，我们一起找方向。',
  introduction: [
    '学习培养部负责收集整理学习资料，共享学业与科研信息，帮助电子系同学在学业和科研发展的道路上走得更加顺利。',
    '从初入校园的新生，到面临更多选择的高年级同学，我们希望让实用的学业资源和真实的成长经验，为每一个需要它的人所用。',
  ],
  duties: [
    '联系讲师开展小班辅导，为复习中的同学答疑解惑。',
    '编写“课程口袋书”，整理课程配套学习资料，让学业资源惠及更多同学。',
    '在寒假举办 Matlab 和 Python 技能培训，帮助同学入门专业工具。',
    '开展新生学法分享与选修课指南活动，提供学业指引和实用资源。',
    '筹办未来发展经验分享会，邀请学长学姐交流留学、推研和实习求职的经验。',
  ],
  contacts: [
    { name: '学习培养部副主席 宋宣增', email: 'songxz23@mails.tsinghua.edu.cn' },
    { name: '学习培养部部长 桑梓恒', email: 'sangzh24@mails.tsinghua.edu.cn' },
    { name: '学习培养部部长 姜胜凯', email: 'jsk24@mails.tsinghua.edu.cn' },
    { name: '学习培养部部长 郑尚文', email: 'zsw24@mails.tsinghua.edu.cn' },
  ],
  accent: '#3c8192',
  darkAccent: '#8fd4e0',
  layout: 'community',
  hero: {
    ...image(1, '学习培养部第一次部会合影'),
    caption: '学习培养部第一次部会',
    aspectRatio: 1.8,
    mobileAspectRatio: 1.5,
    position: 'center 35%',
  },
  keywords: [
    '学习培养',
    '学培',
    '小班辅导',
    '课程口袋书',
    '学习资料',
    'MatPyFly',
    'Matlab',
    'Python',
    '技能培训',
    '学法分享',
    '选修课指南',
    '未来发展',
    '留学',
    '推研',
    '实习求职',
  ],
  sections: [
    {
      id: 'activities',
      title: '学习与成长，都有伙伴同行',
      eyebrow: '代表活动',
      layout: 'cards',
      items: [
        {
          title: '小班辅导',
          description: '联系讲师开展课程辅导，为正在复习的同学答疑解惑。',
          image: image(2, '小班辅导中的讲解与学习现场'),
        },
        {
          title: 'MatPyFly',
          description: '寒假里的 Matlab 与 Python 技能培训，帮助同学入门实用的专业工具。',
          image: { ...image(3, 'MatPyFly 教程与 Jupyter Notebook 示例'), fit: 'contain' },
        },
        {
          title: '新生发展经验分享会',
          description: '从学法分享和选修课指南开始，为刚走进大学的同学提供学业指引。',
          image: image(4, '新生发展经验分享会现场'),
        },
        {
          title: '未来发展经验分享会',
          description: '邀请学长学姐交流留学、推研乃至实习求职的真实经验与心得。',
          image: image(5, '未来发展经验分享会现场'),
        },
      ],
    },
    {
      id: 'daily',
      title: '交流的日常，也藏着新的收获',
      eyebrow: '部门日常',
      layout: 'cards',
      items: [
        {
          title: '部员交流',
          description: '把 Weekly 中的经验带来分享，让一个人的探索成为大家的收获。',
          image: { ...image(6, '部员分享交流现场'), position: 'center bottom' },
        },
        {
          title: '部门风采',
          description: '第一次部会，一起认识将要并肩工作的伙伴。',
          image: image(1, '学习培养部第一次部会合影'),
        },
      ],
    },
  ],
  sourceNotes: [
    '学习培养部/Free BBS上的学培部介绍.docx；6 张配图均来自学培部.zip。',
    '按部门方案保留代表活动 2×2 排列、部门日常双图并列；手机端顺次排列。',
    '部门正式名称依 NotingSr 要求统一为“学习培养部”；联系人、职务和 4 个邮箱均按本次材料录入。',
    'MatPyFly 图完整显示；部员交流图在展示卡片中保留讲述者头部与手势，查看大图可见原图全貌。原图均未裁切。',
  ],
};

export default content;
