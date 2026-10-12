import { describe, it, expect } from 'vitest';
import { safePublishingUrl } from './domain.js';
describe('publishing links', () => {
  it('rejects active and credential URLs', () => {
    expect(safePublishingUrl('javascript:alert(1)')).toBe(false);
    expect(safePublishingUrl('https://a:b@example.org')).toBe(false);
    expect(safePublishingUrl('https://mp.weixin.qq.com/s/example')).toBe(true);
    expect(safePublishingUrl('http://example.org')).toBe(false);
  });
});
