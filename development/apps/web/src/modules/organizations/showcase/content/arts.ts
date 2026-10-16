import type { ShowcaseContent, ShowcaseImage } from '../types.js';

const image = (index: number, caption: string): ShowcaseImage => ({
  src: `/development/organization-showcase/content/arts/${String(index).padStart(2, '0')}.webp`,
  alt: caption,
  caption,
  fit: 'contain',
});

export const arts: ShowcaseContent = {
  slug: 'arts',
  departmentId: 'student_union.arts_center',
  name: '电子系学生会文艺中心',
  shortName: '学生文艺中心',
  englishName: 'BECAUSE WE LOVE THE STAGE',
  tagline: '因为热爱，所以文艺',
  summary: '从策划宣传到灯光音台，从剧本镜头到舞台中央。一起做梦、造梦，让每一种表达都有回声。',
  introduction: [
    '电子系学生文艺中心，是电子系学生会中一个以热爱为起点、以舞台为答案的文艺部门。我们秉持“因为热爱，所以文艺”的理念，在工科的严谨与理性之外，为每一个心怀文艺的电子人保留一片可以做梦、造梦、圆梦的天地。',
    '从策划宣传到灯光音台，从剧本镜头到舞台中央，文艺中心以尽可能完整的配置，让每一种表达都被看见，让每一份热爱都有回声。它不只是一个办活动的部门，更是一群人并肩奔赴山海的理由。',
  ],
  duties: [
    '策划并承办学生节、系歌赛、新生舞会、新生 Free 之夜、毕业舞会等品牌活动，负责节目统筹、流程设计与现场执行。',
    '通过推送文案与排版、舞台设计与实现等真实项目，提升成员的审美、创意与执行力。',
    '在日常策划、排练协作和艺术体验中凝聚伙伴，让每位成员在快乐中成长，收获挚友与归属感。',
  ],
  contacts: [
    { name: '文艺中心联系邮箱 1', email: 'hzs24@mails.tsinghua.edu.cn' },
    { name: '文艺中心联系邮箱 2', email: 'frq24@mails.tsinghua.edu.cn' },
    { name: '文艺中心联系邮箱 3', email: 'zym24@mails.tsinghua.edu.cn' },
  ],
  accent: '#b55074',
  darkAccent: '#f5abc6',
  layout: 'studio',
  hero: image(1, '“掠影”学生节大合影'),
  keywords: ['文艺', '学生节', '系歌赛', '舞会', 'Free之夜', '灯光', '舞台', '排练'],
  sections: [
    {
      id: 'stages',
      title: '一起走过的舞台',
      eyebrow: '属于我们的高光时刻',
      layout: 'gallery',
      introduction: '每一次掌声背后，都有一起策划、排练、搭台和守候的伙伴。',
      images: [image(2, '系歌赛合影'), image(3, '新生 Free 之夜合影'), image(4, '毕业舞会合影')],
    },
  ],
  sourceNotes: [
    '学生文艺中心/部门介绍.docx；四张原始配图均保留。原稿只提供邮箱，未提供联系人姓名。',
  ],
};
