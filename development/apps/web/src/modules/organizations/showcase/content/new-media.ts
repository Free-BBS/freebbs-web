import type { ShowcaseContent } from '../types.js';

const image = (number: number, caption: string, fit: 'cover' | 'contain' = 'contain') => ({
  src: `/development/organization-showcase/content/new-media/${String(number).padStart(2, '0')}.webp`,
  alt: caption,
  caption,
  fit,
});

const content: ShowcaseContent = {
  slug: 'new-media',
  departmentId: 'media_center.new_media_reporters',
  name: '电子系新媒体部暨记者团',
  shortName: '新媒体部暨记者团',
  englishName: 'Stories of EE, Told by Us',
  tagline: '一起发现电子人的故事！',
  summary:
    '观察日常，发掘亮点，记录精彩。用专精覃思、精雕细刻的作品，见证电子人的青春，传递声音与思考。',
  introduction: [
    '在这里，我们观察日常生活；在这里，我们发掘身边亮点；在这里，我们记录精彩瞬间。',
    '我们是电子人美好青春的见证者，我们是电子人珍贵记忆的叙述者。我们在一篇篇专精覃思、精雕细刻的作品中，发出声音、传递思考。',
  ],
  duties: [
    '创作《无限近距离》：寻访同学、老师，发掘 EEer 不同领域的精彩，讲述普通又不平凡的 EE 故事。',
    '策划特色推送：追踪时事，挥洒灵感，捕捉 EEer 的精彩瞬间，将想法变为现实。',
    '参与招新探秘、宣传工作坊、学长话前程等活动的跟采报道。',
    '运营无限之声，参与推送全流程，学习班级宣传建设与深度采访。',
  ],
  contacts: [{ name: '部门联系邮箱', email: 'queqx23@mails.tsinghua.edu.cn' }],
  accent: '#8b8bea',
  darkAccent: '#c2bbff',
  layout: 'studio',
  hero: image(8, '新媒体部部员合影', 'cover'),
  sections: [
    {
      id: 'close-to-you',
      title: '無限近距离',
      eyebrow: '节选 >>',
      layout: 'projects',
      items: [
        {
          title: '每一个飞驰的瞬间',
          description: '电子系田径队',
          image: image(1, '《每一个飞驰的瞬间》推送封面'),
          href: 'https://mp.weixin.qq.com/s/e_0dzwnnxzjL7wPv6viQlA',
          linkLabel: '阅读推送',
        },
        {
          title: '我与我周旋久',
          description: '秦子驰',
          image: image(2, '《我与我周旋久》推送封面'),
          href: 'https://mp.weixin.qq.com/s/-SXwtiEwgvONESFsJQj5VA',
          linkLabel: '阅读推送',
        },
        {
          title: 'Electronic Enthusiasm',
          description: '李沐晟',
          image: image(3, '《無限近距离 × Electronic Enthusiasm》推送封面'),
          href: 'https://mp.weixin.qq.com/s/kFzHlqXTflK1w8EMNLNarw',
          linkLabel: '阅读推送',
        },
      ],
    },
    {
      id: 'department-reporting',
      title: '院系活动报导',
      eyebrow: '也在我们的业务范畴 >>',
      layout: 'projects',
      items: [
        {
          title: '清华大学电子工程系 2026 年毕业典礼举行',
          image: image(4, '电子工程系 2026 年毕业典礼报道封面'),
          href: 'https://mp.weixin.qq.com/s/BhrfXiRO8hckE2b4bAv4Jw',
          linkLabel: '阅读报道',
        },
        {
          title: '2026 级本科生迎新大会',
          description: '崭新起点，逐梦前行！',
          image: image(5, '电子工程系 2026 级本科生迎新大会报道封面'),
          href: 'https://mp.weixin.qq.com/s/uVoL2Yj7Fwplqjjhyre0Qw',
          linkLabel: '阅读报道',
        },
        {
          title: '欢迎新同学！2026 电子工程系迎新实录',
          image: image(6, '2026 电子工程系迎新实录封面'),
          href: 'https://mp.weixin.qq.com/s/-YbBFA-D58sbefiCG7fY7Q',
          linkLabel: '阅读报道',
        },
      ],
    },
    {
      id: 'fun-and-depth',
      title: '乐趣＋深度的双重体验',
      introduction: '加入新媒体部，你可以获得乐趣＋深度的双重体验。',
      layout: 'cards',
      items: [
        {
          title: '沟通与表达，也可以 i 人友好',
          description:
            '你可以参与 i 人友好的沟通与表达工作坊，学习采访、邮件写作等有效沟通技能，提高表达意愿。',
          image: image(7, '新媒体部沟通与表达工作坊', 'cover'),
        },
        {
          title: '自由交换创意和趣事',
          description: '部门氛围轻松，自由交换创意想法和趣事，部员留部意愿高。',
          image: image(8, '轻松愉快的新媒体部', 'cover'),
        },
      ],
    },
    {
      id: 'join-the-story',
      title: '加入我们，一起发现电子人的故事！',
      layout: 'editorial',
      paragraphs: [
        '如何做好班级宣传建设？如何写出一篇有深度的采访？如何在无限之声上走完推送全流程？在新媒体部，你可以在一次次采访、写作与合作中寻找答案。',
      ],
    },
  ],
  sourceNotes: [
    '依据新媒体部投稿《部门介绍.docx》《展示内容.docx》及 8 张独立图片整理。',
    '保留两组三篇推送的原始链接、原定次序，以及“無限近距离”“院系活动报导”栏目表达。',
    '文章标题与人物姓名按投稿封面读取；没有编造采访内容或成员寄语。',
  ],
};

export default content;
