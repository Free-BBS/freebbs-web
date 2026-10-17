(() => {
  'use strict';
  const data = window.LC_CONTENT;
  if (!data) return;
  const $ = id => document.getElementById(id);
  const text = (id, value) => { const node = $(id); if (node) node.textContent = value ?? ''; };
  const node = (tag, className = '', value) => { const e = document.createElement(tag); e.className = className; if (value !== undefined) e.textContent = value; return e; };
  const icons = {
    users:'<circle cx="8.3" cy="8" r="3.2"/><path d="M2.6 20v-2.2a5.7 5.7 0 0 1 11.4 0V20M17 4.7a3 3 0 0 1 0 5.7M17.5 14.2a5 5 0 0 1 3.9 4.9V20"/>',
    building:'<rect x="3.5" y="5.3" width="17" height="15.2" rx="1.8"/><path d="M7.5 9h2m4 0h2m-8 4h2m4 0h2M10 20.5v-4h4v4M8 5.2V2.8h8v2.4"/>',
    handshake:'<path d="m2.7 11 4.7-4.2 4 1.2m0 0 2-1.2 4.7 1.1 3.3 4.2-4.1 6.1c-.6.9-1.6 1.2-2.4.5l-4.9-4.2m-2.5-7.7 4.1 1.2-2 2.3a1.9 1.9 0 0 0 2.7 2.5l2-1.9m-8.7 3.8 3.4 4.1c.6.8 1.8.8 2.5.2l.8-.8"/>',
    spark:'<path d="m12 2 1.7 6.3L20 10l-6.3 1.7L12 18l-1.7-6.3L4 10l6.3-1.7L12 2ZM19.6 17l.7 2.2 2.2.7-2.2.7-.7 2.2-.7-2.2-2.2-.7 2.2-.7.7-2.2Z"/>',
    graduation:'<path d="m2.4 9.1 9.6-5 9.6 5-9.6-5ZM6.1 11.3v5.2c3.6 2.9 8.3 2.9 11.8 0v-5.2M21.6 9.1v7.7"/>',
    compass:'<circle cx="12" cy="12" r="9"/><path d="m16 8-2.7 5.2L8 16l2.8-5.3L16 8Z"/>',
  };
  const svg = key => `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[key] || icons.spark}</svg>`;

  document.title = `${data.identity.name} | 让联结成为更多可能`;
  text('lc-hero-eyebrow', data.hero.eyebrow);
  text('lc-hero-title-first', data.hero.titleFirst);
  text('lc-hero-title-second', data.hero.titleSecond);
  text('lc-hero-description', data.hero.description);
  $('lc-hero-image').src = data.hero.cover;
  $('lc-hero-image').alt = data.hero.coverAlt;
  text('lc-hero-cover-note', data.hero.coverNote);
  text('lc-about-title', data.about.title);
  text('lc-about-intro', data.about.intro);
  text('lc-inner-title', data.about.innerTitle);
  text('lc-inner-desc', data.about.innerDesc);
  text('lc-outer-title', data.about.outerTitle);
  text('lc-outer-desc', data.about.outerDesc);
  [['lc-inner-keywords',data.about.innerKeywords], ['lc-outer-keywords',data.about.outerKeywords]].forEach(([id,words]) => {
    (words || []).forEach(w => $(id).append(node('span','',w)));
  });

  /* Accessible dialog support, shared by work details and photo albums. */
  let activeDialog = null;
  let returnFocus = null;
  const focusables = modal => [...modal.querySelectorAll('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')].filter(el => el.getClientRects().length > 0);
  function openDialog(modal) {
    if (activeDialog) closeDialog();
    returnFocus = document.activeElement;
    activeDialog = modal;
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden','false');
    document.body.classList.add('lc-modal-open');
    const first = focusables(modal)[0];
    if (first) first.focus({preventScroll:true});
  }
  function closeDialog() {
    if (!activeDialog) return;
    activeDialog.classList.remove('is-open');
    activeDialog.setAttribute('aria-hidden','true');
    document.body.classList.remove('lc-modal-open');
    activeDialog = null;
    if (returnFocus && returnFocus.isConnected) returnFocus.focus({preventScroll:true});
    returnFocus = null;
  }
  document.querySelectorAll('[data-close]').forEach(control => control.addEventListener('click', closeDialog));
  document.addEventListener('keydown', event => {
    if (!activeDialog) return;
    if (event.key === 'Escape') {event.preventDefault(); closeDialog(); return;}
    if (event.key === 'Tab') {
      const all = focusables(activeDialog), first = all[0], last = all[all.length - 1];
      if (!first) return;
      if (event.shiftKey && document.activeElement === first) {event.preventDefault(); last.focus();}
      else if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first.focus();}
    }
    if (activeDialog === $('lc-lightbox') && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
      event.preventDefault(); changeSlide(event.key === 'ArrowRight' ? 1 : -1);
    }
  });

  /* Work cards open a two-column details dialog with image and editable bullet points. */
  const grid = $('lc-work-grid');
  const workModal = $('lc-work-modal');
  (data.work || []).forEach((item, index) => {
    const card = node('button','lc-work-card');
    card.type = 'button'; card.dataset.type = item.type;
    card.setAttribute('aria-haspopup','dialog');
    card.setAttribute('aria-label',`了解${item.title}的具体工作`);
    const top = node('div','lc-work-card-top');
    top.append(node('span','lc-work-num',item.number || String(index + 1).padStart(2,'0')),
      node('span','lc-work-type',`${item.type === 'outer' ? '对外' : '对内'} · ${item.category}`));
    const icon = node('div','lc-work-card-icon'); icon.innerHTML = svg(item.icon);
    const bottom = node('div','lc-card-bottom');
    bottom.append(node('span','',item.footnote),node('span','lc-card-open','查看详情 ↗'));
    card.append(top, icon, node('h3','',item.title), node('p','',item.text), bottom);
    card.addEventListener('click', () => {
      text('lc-detail-kicker',`${item.number} / ${item.type === 'outer' ? '对外联络' : '对内联结'} · ${item.category}`);
      text('lc-detail-title',item.title);
      text('lc-detail-lead',item.text);
      $('lc-detail-image').src = item.photo || data.hero.cover;
      $('lc-detail-image').alt = item.photoAlt || `${item.title}活动照片`;
      text('lc-detail-caption',item.photoCaption || '活动现场照片');
      const list = $('lc-detail-points'); list.replaceChildren();
      (item.details || [item.text]).forEach(point => list.append(node('li','',point)));
      openDialog(workModal);
    });
    grid.append(card);
  });
  const filters = [...document.querySelectorAll('.lc-filter button')];
  filters.forEach(button => button.addEventListener('click', () => {
    const choice = button.dataset.filter;
    filters.forEach(f => {
      const selected = f === button;
      f.classList.toggle('lc-filter-active',selected);
      f.setAttribute('aria-pressed',String(selected));
    });
    [...grid.children].forEach(card => card.classList.toggle('is-hidden',choice !== 'all' && card.dataset.type !== choice));
  }));

  /* Multi-photo activity galleries. Each album can contain any number of images. */
  const galleryGrid = $('lc-gallery-grid');
  const galleryModal = $('lc-lightbox');
  const slideImage = $('lc-slide-image');
  const counter = $('lc-slide-counter');
  const dots = $('lc-slide-dots');
  let currentAlbum = null;
  let currentSlide = 0;
  function renderSlide() {
    const images = currentAlbum?.images || [];
    if (!images.length) return;
    const pic = images[currentSlide];
    slideImage.src = pic.src;
    slideImage.alt = pic.alt || `${currentAlbum.title}照片 ${currentSlide + 1}`;
    text('lc-slide-caption',pic.caption || '');
    counter.textContent = `${String(currentSlide + 1).padStart(2,'0')} / ${String(images.length).padStart(2,'0')}`;
    dots.replaceChildren();
    images.forEach((_,i) => {
      const dot = node('button', i === currentSlide ? 'is-active' : '');
      dot.type = 'button';
      dot.setAttribute('aria-label',`查看第 ${i+1} 张照片`);
      dot.setAttribute('aria-current',String(i === currentSlide));
      dot.addEventListener('click', () => {currentSlide = i; renderSlide();});
      dots.append(dot);
    });
    const multiple = images.length > 1;
    $('lc-slide-prev').hidden = !multiple;
    $('lc-slide-next').hidden = !multiple;
    $('lc-slide-dots').hidden = !multiple;
    document.querySelector('.lc-slide-hint').hidden = !multiple;
  }
  function changeSlide(direction) {
    const count = currentAlbum?.images?.length || 0;
    if (count < 2) return;
    currentSlide = (currentSlide + direction + count) % count;
    renderSlide();
  }
  (data.gallery || []).forEach(item => {
    const pictures = Array.isArray(item.images) ? item.images : (item.image ? [{src:item.image, alt:item.alt, caption:item.caption}] : []);
    if (!pictures.length) return;
    const card = node('button','lc-gallery-card'); card.type = 'button';
    card.setAttribute('aria-haspopup','dialog');
    card.setAttribute('aria-label',`打开${item.title}相册，共${pictures.length}张照片`);
    const img = node('img'); img.src = pictures[0].src; img.alt = pictures[0].alt || item.title;
    img.loading = 'eager'; img.decoding = 'async';
    const detail = node('div','lc-gallery-card-content'), info = node('div','lc-gallery-info');
    info.append(node('span','',`${item.number} / ${item.category}`),node('h3','',item.title),node('small','lc-gallery-photo-count',`${pictures.length} 张照片`));
    detail.append(info,node('span','lc-gallery-arrow','↗'));
    card.append(img,detail);
    card.addEventListener('click', () => {
      currentAlbum = {...item,images:pictures}; currentSlide = 0;
      text('lc-gallery-modal-category',`${item.number} / ${item.category}`);
      text('lc-gallery-modal-title',item.title);
      renderSlide(); openDialog(galleryModal);
    });
    galleryGrid.append(card);
  });
  $('lc-slide-prev').addEventListener('click', () => changeSlide(-1));
  $('lc-slide-next').addEventListener('click', () => changeSlide(1));
  let touchX = null, touchY = null;
  const stage = $('lc-lightbox-stage');
  stage.addEventListener('touchstart',event => {
    if (event.touches.length !== 1) return;
    touchX = event.touches[0].clientX; touchY = event.touches[0].clientY;
  },{passive:true});
  stage.addEventListener('touchend',event => {
    if (touchX === null || !event.changedTouches.length) return;
    const dx = event.changedTouches[0].clientX - touchX;
    const dy = event.changedTouches[0].clientY - touchY;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.25) changeSlide(dx < 0 ? 1 : -1);
    touchX = null; touchY = null;
  },{passive:true});

  /* Recruitment ending: no email CTA, no external "more" link. */
  text('lc-contact-title',data.closing.title);
  text('lc-contact-description',data.closing.description);
  (data.closing.benefits || []).forEach(item => $('lc-benefits').append(node('li','',item)));
  const email = data.contact?.email?.trim();
  text('lc-contact-label',data.contact?.label || '负责人邮箱 / EMAIL');
  text('lc-email-text', email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '邮箱待补充 · 请在 content.js 中填写');
  text('lc-publish-note',data.publishNote);

  /* Stable section navigation / safe route to top. */
  const nav = $('lc-nav'), menu = $('lc-menu');
  menu.addEventListener('click', () => {
    const open = menu.getAttribute('aria-expanded') !== 'true';
    menu.setAttribute('aria-expanded',String(open));
    menu.setAttribute('aria-label',open ? '关闭菜单' : '打开菜单');
    nav.classList.toggle('is-open',open);
  });
  nav.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
    nav.classList.remove('is-open');
    menu.setAttribute('aria-expanded','false');
    menu.setAttribute('aria-label','打开菜单');
  }));
  const backTop = $('lc-back-top');
  document.querySelectorAll('a[href="#lc-top"]').forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    window.scrollTo({top:0,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
  }));
  backTop.addEventListener('click',() => window.scrollTo({top:0,behavior:'smooth'}));
  const sections = ['lc-about','lc-work','lc-gallery','lc-contact'].map($);
  const navAnchors = [...nav.querySelectorAll('a')];
  let scheduled = false;
  function updateScrollUI() {
    scheduled = false;
    const max = Math.max(0,document.documentElement.scrollHeight - window.innerHeight);
    $('lc-progress').style.width = `${max ? Math.min(100,Math.max(0,window.scrollY / max * 100)) : 0}%`;
    // 页脚有更显眼的返回顶部按钮；页脚进入视口后隐藏浮球，避免两个入口重叠。
    const footerInView = document.querySelector('.lc-footer').getBoundingClientRect().top < window.innerHeight - 50;
    backTop.classList.toggle('is-visible',window.scrollY > Math.min(650,window.innerHeight * .85) && !footerInView);
    const probe = window.innerHeight * .38;
    let activeId = 'lc-top'; // 默认高亮「首页」，到达下方区块后依次切换
    for (const section of sections) {
      if (section.getBoundingClientRect().top <= probe) activeId = section.id;
    }
    navAnchors.forEach(a => {
      const active = a.getAttribute('href') === `#${activeId}`;
      a.classList.toggle('is-current',active);
      if (active) a.setAttribute('aria-current','location'); else a.removeAttribute('aria-current');
    });
  }
  window.addEventListener('scroll', () => {
    if (!scheduled) { scheduled = true; requestAnimationFrame(updateScrollUI); }
  },{passive:true});
  window.addEventListener('resize',updateScrollUI,{passive:true});
  updateScrollUI();
})();
