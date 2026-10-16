import type { ShowcaseContent, ShowcaseImage } from '../types.js';
const image = (index: number, caption: string): ShowcaseImage => ({
  src: `/development/organization-showcase/content/project/${String(index).padStart(2, '0')}.webp`,
  alt: caption,
  caption,
  fit: 'contain',
});
export const project: ShowcaseContent = {
  slug: 'project',
  departmentId: 'science_association.project',
  name: '项目部',
  englishName: 'MAKE EXPLORATION VISIBLE',
  tagline: '连接科创，让探索被看见',
  summary:
    '跟进挑战杯，组织科创年会，走进实验室。让每一个认真探索的想法，都有相遇、交流和被看见的机会。',
  introduction: [
    '在项目部，我们跟进挑战杯，也组织策划科创年会。我们连接信息、搭建平台，帮助同学推进科研与科创，让持续投入的探索，有机会被更多人看见。',
    '我们关注真实的项目，也关注项目推进中的每一步：从想法的提出，到实践中的尝试，再到阶段成果的交流与展示。围绕挑战杯和科创年会，我们希望让同学们更方便地获取信息、分享进展，在交流中获得启发，让探索继续向前。',
  ],
  duties: [
    '跟进挑战杯相关信息与项目进展，协助同学了解赛事安排、推进参赛准备和成果展示。',
    '参与科创年会的策划与组织，为同学提供交流科研经历、展示科创成果的平台。',
    '关注科研与科创实践，通过项目记录和成果交流，让更多真实的探索被了解、被看见。',
    '组织 SAST LabView 实验室探访，了解老师的科研方向，获取本科生科研指导与建议。',
  ],
  contacts: [
    { name: '宁斌吉', email: 'nbj23@mails.tsinghua.edu.cn' },
    { name: '苏琪烨', email: 'sqy24@mails.tsinghua.edu.cn' },
    { name: '王颢宸', email: 'wanghc24@mails.tsinghua.edu.cn' },
    { name: '王荪彦', email: 'wangsuny24@mails.tsinghua.edu.cn' },
  ],
  accent: '#377f89',
  darkAccent: '#9fdae0',
  layout: 'lab',
  hero: image(2, '电子系挑战杯合影'),
  keywords: ['挑战杯', '科创年会', 'LabView', '实验室探访', '启航计划', '启航沙龙', '科研'],
  sections: [
    {
      id: 'challenge',
      title: '围绕挑战杯，记录探索的过程',
      eyebrow: '把想法变成作品',
      layout: 'gallery',
      paragraphs: [
        '从项目准备到交流展示，挑战杯相关记录承载着同学们投入科创的具体瞬间。我们关注作品背后的思考与实践，也希望让这些积累被更多人了解。',
      ],
      images: [image(1, '挑战杯作品展示'), image(2, '电子系挑战杯合影')],
    },
    {
      id: 'exchange',
      title: '相聚科创年会',
      eyebrow: '让想法在交流中生长',
      layout: 'gallery',
      paragraphs: [
        '科创年会是展示成果的窗口，也是交流想法的现场。在分享与讨论中，看见不同方向的探索，听见项目背后的经历，让新的启发从交流中发生。',
      ],
      images: [image(3, '启航计划介绍'), image(4, '启航沙龙')],
    },
    {
      id: 'labview',
      title: '走进实验室',
      eyebrow: 'SAST LabView',
      layout: 'gallery',
      paragraphs: [
        'SAST LabView 是电子系学生科协项目部组织的实验室探访活动。我们以老师的科研方向为主线，结合对本科生科研的指导与建议，帮助同学们了解实验室正在探索的问题，认识不同研究方向，也为自己的科研起步寻找路径。',
        '从对一个方向感到好奇，到进一步了解其中的研究内容，我们希望通过面对面的探访与交流，让同学们找到科研之路的起点。',
      ],
      images: [image(5, '参观生物光子学实验室')],
    },
  ],
  sourceNotes: ['项目部/项目部.docx；图1至图5按原文位置展示，保留原署名与邮箱。'],
};
