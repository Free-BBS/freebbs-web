// Read-only browser QA math: sRGB source-over, then WCAG relative luminance.
// Gradients, images, blend modes and antialiased pixels are not reduced to a
// fake exact computed-style ratio by the browser auditor that uses this module.
function createContrastMath() {
  function parseColor(value) {
    const source = String(value || '').trim();
    if (source === 'transparent') return [0, 0, 0, 0];
    const rgb = source.match(/^rgba?\((.*)\)$/i);
    const srgb = source.match(/^color\(srgb\s+(.*)\)$/i);
    if (!rgb && !srgb) return null;
    const parts = (rgb ? rgb[1] : srgb[1]).replace(/[,/]/g, ' ').trim().split(/\s+/);
    if (parts.length < 3 || parts.length > 4) return null;
    const channel = (part) =>
      Number.parseFloat(part) * (part.endsWith('%') ? 2.55 : srgb ? 255 : 1);
    const result = parts.slice(0, 3).map(channel);
    const alpha =
      parts.length === 4 ? Number.parseFloat(parts[3]) / (parts[3].endsWith('%') ? 100 : 1) : 1;
    return result.every(Number.isFinite) && Number.isFinite(alpha) ? [...result, alpha] : null;
  }
  function over(front, back) {
    const alpha = front[3] + back[3] * (1 - front[3]);
    if (!alpha) return [0, 0, 0, 0];
    return [0, 1, 2]
      .map((index) => (front[index] * front[3] + back[index] * back[3] * (1 - front[3])) / alpha)
      .concat(alpha);
  }
  const opacity = (pixel, value) => [...pixel.slice(0, 3), pixel[3] * value];
  function luminance(color) {
    return color
      .slice(0, 3)
      .map((channel) => channel / 255)
      .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
      .reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0);
  }
  function ratio(front, back) {
    const a = luminance(front);
    const b = luminance(back);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }
  const threshold = (size, weight) =>
    size >= 24 || (size >= (14 * 96) / 72 && Number(weight) >= 700) ? 3 : 4.5;
  return { parseColor, over, opacity, luminance, ratio, threshold };
}
module.exports = { createContrastMath };
