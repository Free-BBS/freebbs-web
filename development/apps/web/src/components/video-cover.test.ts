import { describe, expect, it } from 'vitest';
import { coverCrop } from './video-cover.js';
describe('video cover crop', () => {
  it('uses a centered crop for portrait recordings without stretching', () => {
    expect(coverCrop(1080, 1920, 16 / 9)).toEqual({ x: 0, y: 656.25, width: 1080, height: 607.5 });
  });
  it('preserves a matching frame and rejects invalid dimensions', () => {
    expect(coverCrop(1920, 1080, 16 / 9)).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    expect(() => coverCrop(0, 10, 1)).toThrow();
  });
});
