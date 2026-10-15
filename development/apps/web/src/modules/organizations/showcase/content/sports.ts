import type { ShowcaseContent } from '../types.js';

const image = (number: number, caption: string) => ({
  src: `/development/organization-showcase/content/sports/${String(number).padStart(2, '0')}.webp`,
  alt: caption,
  caption,
});

const content: ShowcaseContent = {
  slug: 'sports',
  departmentId: 'student_union.sports_center',
  name: '电子系学生体育中心',
  shortName: '学生体育中心',
  englishName: 'Sports, Together',
  tagline: '这里是天天开心的学生体育中心！',
  summary: '期待每一位支持电子体育的你，期待每一位热爱体育的你。从赛场到日常，一起为电子体育加油。',
  introduction: [
    '这里是天天开心的学生体育中心！期待每一位支持电子体育的你，期待每一位热爱体育的你~',
  ],
  duties: [
    '竞技体育：组织系体育代表队参加马约翰杯，并提供后勤保障。',
    '群众体育：筹办大无限杯系列赛事，筹办系运会、七系联合泳赛等系级比赛。',
    '组织报名校级各项体育活动，如临门一脚、紫荆之巅、迷你马拉松与校园马拉松等。',
    '宣传工作：在无限之声、电子体育 THU 等平台宣传体育活动，参与设计 FREE BBS 发展端体育相关板块。',
  ],
  contacts: [
    { name: '负责人', email: 'zhu-zj23@mails.tsinghua.edu.cn' },
    { name: '部长', email: 'wwy24@mails.tsinghua.edu.cn' },
  ],
  accent: '#43b58a',
  darkAccent: '#9be6c5',
  layout: 'community',
  hero: { ...image(2, '26年大马杯季军'), position: 'center 80%' },
  sections: [
    {
      id: 'sports-center-album',
      title: '体育中心',
      eyebrow: 'ON THE FIELD',
      layout: 'gallery',
      images: [
        image(1, '26年小马杯提前项'),
        image(2, '26年大马杯季军'),
        image(3, '26-27第一次部会'),
        image(4, '25新生赤足'),
        image(5, '25年大马杯亚军'),
        image(6, '25学生节掠影打下班卡'),
        image(7, '25-26第一次部会'),
        image(8, '25-26告别部会'),
      ],
    },
    {
      id: 'happy-every-day-album',
      title: '天天开心',
      eyebrow: 'OFF THE FIELD',
      layout: 'gallery',
      images: [
        image(9, '六世（部长）同堂'),
        image(10, '一起跨年的牢哥牢姐们'),
        image(11, '呜呼我们是亚军！'),
        image(12, '转身能看到老部长们的后背'),
        image(13, '见证国足U23大胜的体育中心'),
        image(14, '被牢哥们巧手化妆的牢哥们（25男生节）'),
        image(15, '愉快的25年男生（受难）节'),
        image(16, '天天开心（沙滩版）'),
      ],
    },
  ],
  sourceNotes: [
    '依据学生体育中心投稿《1部门介绍.md》与图片相册整理。',
    '按部门要求保留《体育中心》《天天开心》两本相册，全部 16 张照片图说使用投稿文件名。',
  ],
};

export default content;
