(function exposeGuideGeometry(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else Object.assign(root, { FreeBbsGuideGeometry: api });
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const finite = (value, fallback) => (Number.isFinite(value) ? value : fallback);
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function visibleHole(rect, viewport, padding, radius) {
    if (!rect) return null;
    const left = finite(rect.left, rect.x);
    const top = finite(rect.top, rect.y);
    const right = finite(rect.right, left + rect.width);
    const bottom = finite(rect.bottom, top + rect.height);
    if (
      ![left, top, right, bottom].every(Number.isFinite) ||
      right <= left ||
      bottom <= top ||
      right <= 0 ||
      bottom <= 0 ||
      left >= viewport.width ||
      top >= viewport.height
    )
      return null;
    // Clip only at viewport boundaries. The explanation may never crop this hole.
    const x = clamp(left - padding, 0, viewport.width);
    const y = clamp(top - padding, 0, viewport.height);
    const width = clamp(right + padding, 0, viewport.width) - x;
    const height = clamp(bottom + padding, 0, viewport.height) - y;
    return { x, y, width, height, radius: Math.min(radius, width / 2, height / 2) };
  }

  function curtainsAround(hole, viewport) {
    const { width, height } = viewport;
    if (!hole) return [{ x: 0, y: 0, width, height }];
    const right = hole.x + hole.width;
    const bottom = hole.y + hole.height;
    return [
      { x: 0, y: 0, width, height: hole.y },
      { x: 0, y: bottom, width, height: height - bottom },
      { x: 0, y: hole.y, width: hole.x, height: hole.height },
      { x: right, y: hole.y, width: width - right, height: hole.height },
    ];
  }

  /**
   * Pure viewport geometry; all units are CSS pixels. Inputs are never mutated.
   * side: normal card beside the target; dock: compact card beside the target.
   * overview: no side fits, so keep the whole hole and use a bottom strip.
   * Its overlap flag is explicit; callers must not treat overview as occlusion-free.
   * Retry needsCompact with measured compact dimensions and options.compact=true.
   * Cards at most 120px high are also recognized as compact when the option is absent.
   */
  function tourGeometry(rect, viewport = {}, card = {}, options = {}) {
    const width = Math.max(1, finite(viewport.width, 1));
    const height = Math.max(1, finite(viewport.height, 1));
    const bounds = { width, height };
    const margin = Math.min(16, width / 8, height / 8);
    const gap = 18;
    const padding = Math.max(0, finite(options.padding, 8));
    const radius = Math.max(0, finite(options.radius, 16));
    const rawHeight = Math.max(0, finite(card.height, 0));
    const cardWidth = clamp(finite(card.width, 0), 0, width - margin * 2);
    const cardHeight = clamp(rawHeight, 0, height - margin * 2);
    const compact = options.compact === true || (options.compact !== false && rawHeight <= 120);
    const hole = visibleHole(rect, bounds, padding, radius);
    const curtains = curtainsAround(hole, bounds);
    const centered = {
      x: (width - cardWidth) / 2,
      y: (height - cardHeight) / 2,
      width: cardWidth,
      height: cardHeight,
    };
    if (!hole)
      return {
        card: centered,
        hole,
        curtains,
        layout: 'overview',
        needsCompact: false,
        placement: 'center',
        overlap: false,
      };

    const centerX = hole.x + hole.width / 2;
    const centerY = hole.y + hole.height / 2;
    const alignedX = clamp(centerX - cardWidth / 2, margin, width - cardWidth - margin);
    const alignedY = clamp(centerY - cardHeight / 2, margin, height - cardHeight - margin);
    const candidates = [
      { placement: 'right', x: hole.x + hole.width + gap, y: alignedY },
      { placement: 'bottom', x: alignedX, y: hole.y + hole.height + gap },
      { placement: 'left', x: hole.x - cardWidth - gap, y: alignedY },
      { placement: 'top', x: alignedX, y: hole.y - cardHeight - gap },
    ];
    const fits = candidates.filter(
      (candidate) =>
        candidate.x >= margin &&
        candidate.y >= margin &&
        candidate.x + cardWidth <= width - margin &&
        candidate.y + cardHeight <= height - margin,
    );
    const score = (candidate) => {
      const vertical = ['top', 'bottom'].includes(candidate.placement);
      const drift = vertical
        ? Math.abs(candidate.x + cardWidth / 2 - centerX) / Math.max(1, cardWidth, hole.width)
        : Math.abs(candidate.y + cardHeight / 2 - centerY) / Math.max(1, cardHeight, hole.height);
      const edgeRoom = Math.min(
        candidate.x,
        candidate.y,
        width - candidate.x - cardWidth,
        height - candidate.y - cardHeight,
      );
      // Center alignment carries most weight; breathing room breaks near-ties.
      // An explicit placement is preferred only among candidates that truly fit.
      const preference = options.placement === candidate.placement ? -1000 : 0;
      const stableTie = candidates.indexOf(candidate) * 0.001;
      return preference + drift * 4 + Math.max(0, 64 - edgeRoom) / 64 + stableTie;
    };
    fits.sort((a, b) => score(a) - score(b));
    if (fits.length) {
      const best = fits[0];
      return {
        card: { x: best.x, y: best.y, width: cardWidth, height: cardHeight },
        hole,
        curtains,
        layout: compact ? 'dock' : 'side',
        needsCompact: false,
        placement: best.placement,
        overlap: false,
      };
    }

    // This is a request for compact remeasurement, not permission to cut the target.
    // After the compact retry, overview exposes the unavoidable overlap explicitly.
    const bottomCard = {
      x: (width - cardWidth) / 2,
      y: height - margin - cardHeight,
      width: cardWidth,
      height: cardHeight,
    };
    const overlap =
      Math.min(bottomCard.x + cardWidth, hole.x + hole.width) > Math.max(bottomCard.x, hole.x) &&
      Math.min(bottomCard.y + cardHeight, hole.y + hole.height) > Math.max(bottomCard.y, hole.y);
    return {
      card: bottomCard,
      hole,
      curtains,
      layout: 'overview',
      needsCompact: !compact,
      placement: 'bottom',
      overlap,
    };
  }
  return { tourGeometry };
});
