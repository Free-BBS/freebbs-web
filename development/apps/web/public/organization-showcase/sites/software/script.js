(() => {
  'use strict';
  const imageRoot = '图像素材/';
  const galleries = {
    thuai: { title: 'THUAI 人工智能挑战赛', label: 'AI × STRATEGY', description: '软件部主办，通常在春季学期举行。选手使用 C++ 或 Python 编写 AI 策略，决赛通过天梯系统实况播送。开发涉及异步与多线程、C#、gRPC、Docker、Avalonia、Unity 等技术。', images: [
      ['THUAI9图片.png.webp', 'THUAI9 · 云厂竞逐赛'], ['THUAI8图片.png.webp', 'THUAI8 · 西游真经劫'], ['THUAI7图片.png.webp', 'THUAI7 · 星际指挥官：AI前线'], ['THUAI6图片.jpg.webp', 'THUAI6 · 毕业吧少女'], ['THUAI9天梯.png.webp', 'THUAI9 · 天梯系统'], ['THUAI9决赛合影.png.webp', 'THUAI9 · 决赛合影']
    ]},
    software: { title: '软件设计大赛', label: 'IDEA × SOFTWARE', description: '面向全校本科生，不限定赛题。选手在寒假期间自主开发软件作品，春季学期进行初审、终审与展示，在实践中提升软件工程能力。以下为历届获奖作品。', images: [
      ['2025_ZeroDay.png.webp', '2025 · ZeroDay'], ['软设2026_Malim.png.webp', '2026 · Malim'], ['软设2024_如果光有声音.jpg.webp', '2024 · 如果光有声音'], ['软设2023_Dimland Midnight Traverse.jpg.webp', '2023 · Dimland: Midnight Traverse'], ['软设2022_Galaxy.jpg', '2022 · Galaxy'], ['软设2021_Not Quite Accurate Battle Simulator.jpg.webp', '2021 · Not Quite Accurate Battle Simulator']
    ]},
    redstone: { title: '红石设计大赛', label: 'LOGIC × MINECRAFT', description: '暑假举办，以 Minecraft 为平台，融合《电子电路与系统基础》《数字逻辑与处理器基础》等课程知识。比赛分普及组和提高组：普及组给定主题，提高组推荐自动化生产、计算单元、实用工具等方向。', images: [
      ['红石设计大赛_广度优先迷宫求解器.png.webp', '往届优秀作品 · 广度优先迷宫求解器'], ['8 位单周期处理器.png.webp', '往届优秀作品 · 8 位单周期处理器'], ['单区块 200 倍高速熔炉组.png.webp', '往届优秀作品 · 单区块 200 倍高速熔炉组']
    ]},
    training: { title: '一起学习，一起实践', label: 'LEARN & CREATE', description: '软件部暑期与寒假培训，为零基础入门和独立项目开发提供技术引导。', images: [['2025暑培录屏.png.webp', '2025 暑期软件技术培训 · 录屏页面'], ['软件部bilibili主页.png.webp', '软件部 B 站主页 · 培训与技术分享']]},
    daily: { title: '部门日常', label: 'LIFE IN SOFTWARE', description: '在部会中交流，在协作中成长，让开发经验在一届届成员之间传承。', images: [['网站组部会现场.jpg', '网站组部会现场'], ['队式组部会现场.jpg.webp', '队式组部会现场'], ['伟大的81gg正在传授知识.jpg.webp', '技术分享现场'], ['THUAI9决赛合影.png.webp', 'THUAI9 决赛合影']]},
    web: { title: '网站建设', label: 'WEB DEVELOPMENT', description: '软件部开发和维护科协网站，维护技术文档，定期向 SAST Weekly 投稿。', images: [['eesast主页.png.webp', '电子系科协官网 · 首页'], ['eesast docs.png.webp', 'EESAST Docs · 技术文档'], ['eesast网站_SAST Weekly.png.webp', '科协网站 · SAST Weekly 栏目']]}
  };
  const projects = {
    home: { index: 0, address: 'eesast.com', kicker: 'EESAST.COM', title: '服务同学的线上入口', description: '电子系科协网站由软件部开发和维护，面向全系同学提供赛事报名、天梯对战、奖学金申请、新生导师等功能。', link: 'https://eesast.com', action: '访问科协官网' },
    docs: { index: 1, address: 'docs.eesast.com', kicker: 'EESAST DOCS', title: '让经验成为可共享的知识', description: '软件部维护科协技术文档，整理 Git、C#、Unity 等教程，为技术入门与项目实践提供可持续查阅的学习资料。', link: 'https://docs.eesast.com', action: '阅读技术文档' },
    weekly: { index: 2, address: 'eesast.com · SAST Weekly', kicker: 'SAST WEEKLY', title: '把技术发现，分享给更多人', description: '软件部定期向 SAST Weekly 投稿，分享技术知识与开发经验，促进同学之间的技术交流和知识传播。', link: 'https://eesast.com', action: '前往科协网站' }
  };
  const $ = id => document.getElementById(id);
  const dialog = $('gallery');
  let currentGallery;
  let currentIndex = 0;
  let currentWeb = 'home';
  let opener;

  function renderImage(index) {
    currentIndex = (index + currentGallery.images.length) % currentGallery.images.length;
    const [file, caption] = currentGallery.images[currentIndex];
    $('gallery-image').src = imageRoot + file;
    $('gallery-image').alt = caption;
    $('gallery-caption').textContent = caption;
    $('gallery-counter').textContent = `${String(currentIndex + 1).padStart(2, '0')} / ${String(currentGallery.images.length).padStart(2, '0')}`;
    [...$('gallery-thumbs').children].forEach((button, i) => button.setAttribute('aria-pressed', String(i === currentIndex)));
    $('gallery-thumbs').children[currentIndex]?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  }
  function openGallery(key, index = 0) {
    currentGallery = galleries[key];
    opener = document.activeElement;
    $('gallery-title').textContent = currentGallery.title;
    $('gallery-label').textContent = currentGallery.label;
    $('gallery-description').textContent = currentGallery.description;
    $('gallery-thumbs').replaceChildren(...currentGallery.images.map(([file, caption], i) => {
      const button = document.createElement('button');
      button.title = caption;
      button.setAttribute('aria-label', caption);
      const img = document.createElement('img');
      img.src = imageRoot + file;
      img.alt = '';
      img.loading = 'lazy';
      button.append(img);
      button.addEventListener('click', () => renderImage(i));
      return button;
    }));
    document.body.classList.add('modal-open');
    dialog.showModal();
    renderImage(index);
    $('gallery-close').focus();
  }
  document.querySelectorAll('[data-gallery]').forEach(button => button.addEventListener('click', () => openGallery(button.dataset.gallery, Number(button.dataset.index || 0))));
  $('gallery-prev').addEventListener('click', () => renderImage(currentIndex - 1));
  $('gallery-next').addEventListener('click', () => renderImage(currentIndex + 1));
  $('gallery-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { document.body.classList.remove('modal-open'); opener?.focus({ preventScroll: true }); });
  dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });
  dialog.addEventListener('keydown', event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); renderImage(currentIndex + (event.key === 'ArrowRight' ? 1 : -1)); } });

  const tabs = [...document.querySelectorAll('[data-web]')];
  function selectProject(key) {
    currentWeb = key;
    const project = projects[key];
    tabs.forEach(tab => { const active = tab.dataset.web === key; tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1; });
    $('web-panel').setAttribute('aria-labelledby', `tab-${key}`);
    $('preview-address').textContent = project.address;
    $('web-kicker').textContent = project.kicker;
    $('web-name').textContent = project.title;
    $('web-description').textContent = project.description;
    $('web-link').href = project.link;
    $('web-link').replaceChildren(document.createTextNode(project.action + ' '), Object.assign(document.createElement('span'), { textContent: '↗' }));
    const [file, caption] = galleries.web.images[project.index];
    $('web-image').src = imageRoot + file;
    $('web-image').alt = caption;
    $('web-caption').textContent = caption;
    $('web-image-button').setAttribute('aria-label', '放大' + caption);
  }
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => selectProject(tab.dataset.web));
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (i + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (i + tabs.length - 1) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next !== undefined) { event.preventDefault(); selectProject(tabs[next].dataset.web); tabs[next].focus(); }
    });
  });
  $('web-image-button').addEventListener('click', () => openGallery('web', projects[currentWeb].index));
  const menu = document.querySelector('.menu-button');
  const nav = $('navigation');
  function closeMenu() { nav.classList.remove('open'); menu.setAttribute('aria-expanded', 'false'); menu.setAttribute('aria-label', '打开导航'); }
  menu.addEventListener('click', () => { const open = nav.classList.toggle('open'); menu.setAttribute('aria-expanded', String(open)); menu.setAttribute('aria-label', open ? '关闭导航' : '打开导航'); });
  nav.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && nav.classList.contains('open')) { closeMenu(); menu.focus(); } });
  document.addEventListener('click', event => { if (!event.target.closest('.site-header')) closeMenu(); });
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => { if (entry.isIntersecting) nav.querySelectorAll('a').forEach(link => {
      const active = link.hash === '#' + entry.target.id;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'location'); else link.removeAttribute('aria-current');
    }); });
  }, { rootMargin: '-15% 0px -65% 0px', threshold: 0 });
  document.querySelectorAll('main section[id], footer[id]').forEach(section => observer.observe(section));
})();
