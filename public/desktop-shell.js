/* Move existing controls (and their listeners), never clone account state.
 * Every move has a marker so returning to mobile restores its original layout. */
(() => {
  const { body } = document;
  const nav = document.querySelector('.topbar .nav-actions');
  const main = document.querySelector('.main-content[data-page-title]');
  if (!nav || !main || body.classList.contains('auth-page-body')) return;
  const media = window.matchMedia('(min-width: 901px)');
  const moves = [];
  let header;
  let footer;
  let observer;
  let developmentLabel;
  let originalDevelopmentLabel;
  const move = (element, destination) => {
    if (!element) return;
    const marker = document.createComment('desktop-shell: original position');
    element.before(marker);
    moves.push({ element, marker });
    destination.append(element);
  };
  const resetSearch = () => {
    delete body.dataset.searchWrappedTitle;
    delete body.dataset.searchCompactAccount;
    delete main.dataset.searchWrappedTitle;
  };
  function sync() {
    if (media.matches === Boolean(header)) return;
    resetSearch();
    if (!media.matches) {
      observer?.disconnect();
      if (developmentLabel) developmentLabel.textContent = originalDevelopmentLabel;
      moves.reverse().forEach(({ element, marker }) => marker.replaceWith(element));
      moves.length = 0;
      header.remove();
      footer.remove();
      header = null;
      body.classList.remove('desktop-shell-active');
      body.style.removeProperty('--desktop-header-height');
      window.freeBbsApp?.renderHeaderBalances?.();
      window.dispatchEvent(new Event('resize'));
      return;
    }
    body.classList.add('desktop-shell-active');
    header = document.createElement('header');
    header.className = 'desktop-header';
    header.setAttribute('aria-label', '页面标题与快捷工具');
    const title = document.createElement('h1');
    title.className = 'desktop-header-title';
    title.textContent = body.classList.contains('home-page')
      ? '首页 / 开始探索'
      : main.dataset.pageTitle;
    const controls = document.createElement('div');
    controls.className = 'desktop-header-controls';
    const tools = document.createElement('div');
    tools.className = 'desktop-header-tools';
    header.append(title, controls);
    body.append(header);
    footer = document.createElement('div');
    footer.className = 'desktop-sidebar-bottom';
    nav.append(footer);
    move(document.querySelector('.site-search-trigger'), controls);
    move(document.getElementById('user-panel'), controls);
    controls.append(tools);
    move(nav.querySelector('[href="/settings"]'), tools);
    move(nav.querySelector('.sidebar-theme-toggle'), tools);
    move(document.querySelector('.notification-widget'), tools);
    const development = nav.querySelector('[href="/development"]');
    developmentLabel = development?.querySelector('span');
    originalDevelopmentLabel = developmentLabel?.textContent;
    if (developmentLabel) developmentLabel.textContent = '前往发展端';
    move(development, footer);
    const balances = document.createElement('div');
    balances.className = 'desktop-assets';
    balances.setAttribute('aria-label', '我的资产，点击货币查看说明');
    footer.append(balances);
    move(document.getElementById('user-status'), balances);
    window.freeBbsApp?.renderHeaderBalances?.();
    tools.querySelector('[href="/settings"]')?.setAttribute('title', '设置');
    tools.querySelector('[href="/settings"]')?.setAttribute('aria-label', '设置');
    observer = new ResizeObserver(() => {
      body.style.setProperty(
        '--desktop-header-height',
        `${Math.ceil(header.getBoundingClientRect().height)}px`,
      );
    });
    observer.observe(header);
  }
  media.addEventListener('change', sync);
  sync();
})();
