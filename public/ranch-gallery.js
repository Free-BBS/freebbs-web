(() => {
  const host = document.getElementById('sheep-gallery');
  const status = document.getElementById('gallery-status');
  const more = document.getElementById('gallery-more');
  let next = null;
  let busy = false;
  const seen = new Set();
  async function load() {
    if (busy) return;
    busy = true;
    more.disabled = true;
    status.textContent = '羊群正在赶来…';
    try {
      const base = window.freeBbsApp?.apiBaseUrl || window.FREEBBS_API_BASE || '/api';
      const response = await fetch(
        `${base}/ranch-designs${next ? `?before=${encodeURIComponent(next)}` : ''}`,
      );
      if (!response.ok) throw new Error('羊群暂时走远了，请重试。');
      const result = await response.json();
      for (const sheep of result.sheep) {
        if (seen.has(sheep.uid)) continue;
        seen.add(sheep.uid);
        const link = document.createElement('a');
        link.className = 'sheep-portrait';
        link.href = `/ranch?uid=${encodeURIComponent(sheep.uid)}`;
        const animal = document.createElement('div');
        animal.className = 'sheep-portrait-animal';
        animal.innerHTML = window.FreeBbsMaxRanch.previewMarkup();
        window.FreeBbsRanchDesign.apply(animal, sheep.design);
        animal.querySelector('svg').setAttribute('aria-label', `${sheep.username} 的羊`);
        const caption = document.createElement('div');
        const name = document.createElement('strong');
        name.textContent = sheep.username;
        const visit = document.createElement('span');
        visit.textContent = '逛逛牧场 ↗';
        caption.append(name, visit);
        link.append(animal, caption);
        host.append(link);
      }
      next = result.next;
      more.hidden = !next;
      more.textContent = '再看看更多羊';
      status.textContent = seen.size
        ? `已遇见 ${seen.size} 只羊${next ? '' : ' · 全部到齐了'}`
        : '还没有人领养羊，你可以成为第一位牧场主人。';
    } catch (error) {
      status.textContent = error.message;
      more.hidden = false;
      more.textContent = '重试';
    } finally {
      busy = false;
      more.disabled = false;
    }
  }
  more.addEventListener('click', load);
  load();
})();
