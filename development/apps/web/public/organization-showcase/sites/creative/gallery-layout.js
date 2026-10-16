function arrangeOrdered(ratios, width) {
  width = Number(width);
  if (!Number.isFinite(width) || width <= 0 || !ratios.length)
    return { items: [], height: 0 };
  const inset = Math.min(10, width * .04);
  const available = width - inset * 2;
  const gap = Math.min(width <= 520 ? 12 : 16, available * .04);
  const maxHeight = width <= 520 ? 320 : 360;
  const targetHeight = Math.min(width <= 520 ? 220 : 260, available * .72);
  const maxPerRow = width <= 520 ? 2 : 4;
  const safeRatios = ratios.map(ratio =>
    Number.isFinite(ratio) && ratio > 0 ? ratio : 1);
  const result = [];
  let start = 0, y = inset;
  while (start < safeRatios.length) {
    let end = start, sum = 0;
    do {
      sum += safeRatios[end++];
    } while (
      end < safeRatios.length &&
      end - start < maxPerRow &&
      (available - gap * (end - start - 1)) / sum > targetHeight
    );
    const count = end - start;
    const height = Math.min(maxHeight, (available - gap * (count - 1)) / sum);
    const rowWidth = sum * height + gap * (count - 1);
    let x = (width - rowWidth) / 2;
    for (let index = start; index < end; index++) {
      const imageWidth = safeRatios[index] * height;
      result.push({ x, y, width: imageWidth, height, angle: 0 });
      x += imageWidth + gap;
    }
    y += height + gap;
    start = end;
  }
  return { items: result, height: y - gap + inset };
}
if (typeof module !== 'undefined') module.exports = arrangeOrdered;

if (typeof document !== 'undefined')
  document.querySelectorAll('.year-gallery,.free-gallery').forEach(gallery => {
    const items = Array.from(gallery.children);
    let pending = false;
    const layout = () => {
      pending = false;
      const width = gallery.clientWidth;
      if (!width) return;
      const ratios = items.map(item => {
        const image = item.querySelector('img');
        return image?.naturalWidth && image.naturalHeight
          ? image.naturalWidth / image.naturalHeight : 1;
      });
      const arranged = arrangeOrdered(ratios, width);
      gallery.classList.remove('layout-scattered');
      gallery.classList.add('layout-ordered');
      gallery.style.height = arranged.height + 'px';
      arranged.items.forEach((position, index) => {
        const item = items[index];
        item.style.width = position.width + 'px';
        item.style.height = position.height + 'px';
        item.style.left = position.x + 'px';
        item.style.top = position.y + 'px';
        item.style.setProperty('--scatter-angle', '0deg');
        item.style.zIndex = '1';
      });
    };
    const schedule = () => {
      if (!pending) {
        pending = true;
        requestAnimationFrame(layout);
      }
    };
    items.forEach(item => {
      const image = item.querySelector('img');
      image?.addEventListener('load', schedule);
      image?.addEventListener('error', schedule);
    });
    let lastWidth = 0;
    new ResizeObserver(entries => {
      const width = entries[0].contentRect.width;
      if (Math.abs(width - lastWidth) > .5) {
        lastWidth = width;
        schedule();
      }
    }).observe(gallery);
    schedule();
  });
