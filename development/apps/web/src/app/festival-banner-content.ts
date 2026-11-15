export interface FestivalBannerMessage {
  id: string;
  text: string;
  source?: string;
}

export interface FestivalBannerConfiguration {
  enabled: boolean;
  messages: readonly FestivalBannerMessage[];
}

/** Approved class banners; contact information is deliberately excluded. */
export const BOYS_DAY_BANNER: FestivalBannerConfiguration = {
  enabled: true,
  messages: [
    {
      id: 'boys-day-2026-wu64',
      text: '烦忧尽数消元，喜乐满秩长存；\n电子少年挥笔，万千命题皆证！',
      source: '——无64班全体女生祝男生们男生节快乐！',
    },
    {
      id: 'boys-day-2026-wu68',
      text: '“电”亮青春不短路，“信”步未来展宏图',
      source: '——祝无68全体男生男生节快乐！',
    },
    {
      id: 'boys-day-2026-wu62',
      text: '“无”可替代，“6”到飞起，祝独一无“2”的无62男神们：\n（说了一些走心的男生节祝福语）',
      source: '——无62全体女生祝男生们男生节快乐！',
    },
    {
      id: 'boys-day-2026-wu65',
      text: '电路连通理想，代码编织星光；\n电子少年踏浪，岁岁皆得晴朗！',
      source: '——无65班全体女生祝男生们男生节快乐！',
    },
    {
      id: 'boys-day-2026-wu63',
      text: '电阻电容，不如你魅力无穷；\n算法逻辑，算不出你的帅气！',
      source: '——无63班全体女生祝男生们男生节快乐！',
    },
    {
      id: 'boys-day-2026-wu61',
      text: '通线代、晓程设，谓无系小生；\n明高微，熟离散，做无畏男人！',
      source: '——无61全体女生祝大家男生节快乐！',
    },
    {
      id: 'boys-day-2026-wu51',
      text: '纵有阻抗千千万，五一同频岁岁欢。',
      source: '——无51',
    },
  ],
};
