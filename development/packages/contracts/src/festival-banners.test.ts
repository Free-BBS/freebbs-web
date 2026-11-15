import { describe, expect, it } from 'vitest';
import {
  BOYS_DAY_BANNER,
  PUBLISHED_FESTIVAL_BANNER_IDS,
  publishedFestivalBannerIds,
} from './festival-banners.js';

describe('published festival banner eligibility', () => {
  it('derives the seven active IDs from the approved shared banner content', () => {
    expect(PUBLISHED_FESTIVAL_BANNER_IDS).toEqual(BOYS_DAY_BANNER.messages.map(({ id }) => id));
    expect(new Set(PUBLISHED_FESTIVAL_BANNER_IDS).size).toBe(7);
    for (const id of PUBLISHED_FESTIVAL_BANNER_IDS) expect(id).toMatch(/^boys-day-2026-wu\d{2}$/);
    expect(PUBLISHED_FESTIVAL_BANNER_IDS).not.toContain('boys-day-placement-preview');
  });

  it('excludes disabled campaigns and messages without published wording', () => {
    const messages = [
      { id: 'published', text: '已发布内容' },
      { id: 'empty-draft', text: '' },
      { id: 'blank-draft', text: ' \n\t ' },
    ];
    expect(publishedFestivalBannerIds({ enabled: true, messages })).toEqual(['published']);
    expect(publishedFestivalBannerIds({ enabled: false, messages })).toEqual([]);
  });
});
