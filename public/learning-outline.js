/* On-demand public reading navigation. No copied textbook, new anchors or learning evidence. */
(function expose(root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    root.FreeBbsLearningOutline = api;
    api.install(root, root.document);
  }
})(typeof window === 'undefined' ? globalThis : window, (root) => {
  const HEADINGS = 'h1,h2,h3,h4,h5,h6';
  const blocked = 'details:not([open]),[hidden],.hidden,.learning-annotation-popover';
  const plain = (value) =>
    String(value || '')
      .replace(/\s+/g, ' ')
      .trim();
  function collect(container, browser = root) {
    if (!container || container.hasAttribute?.('data-learning-document-empty')) return [];
    const entries = [...container.querySelectorAll(HEADINGS)].filter((heading) => {
      if (!plain(heading.textContent) || heading.closest?.(blocked)) return false;
      const style = browser.getComputedStyle?.(heading);
      return style?.display !== 'none' && style?.visibility !== 'hidden';
    });
    const base = Math.min(...entries.map((heading) => Number(heading.tagName.slice(1))));
    return entries.map((heading) => ({
      target: heading,
      label: plain(heading.textContent),
      depth: Math.min(3, Math.max(0, Number(heading.tagName.slice(1)) - base)),
    }));
  }
  function install(browser, dom) {
    const page = dom.querySelector('[data-knowledge-page]');
    const body = dom.getElementById('knowledge-body');
    const reading = dom.getElementById('knowledge-reading');
    const trigger = dom.getElementById('learning-outline-open');
    if (!page || !body || !reading || !trigger) return null;
    trigger.hidden = true;
    const make = (tag, label, className) => {
      const item = dom.createElement(tag);
      if (label) item.textContent = label;
      if (className) item.className = className;
      return item;
    };
    const floating = make('button', '阅读导航', 'learning-outline-floating');
    floating.type = 'button';
    floating.id = 'learning-outline-floating';
    floating.hidden = true;
    const dialog = make('dialog', '', 'learning-outline-dialog');
    dialog.id = 'learning-outline-dialog';
    dialog.setAttribute('aria-labelledby', 'learning-outline-title');
    const header = make('header');
    const title = make('h2', '本页目录');
    title.id = 'learning-outline-title';
    const close = make('button', '×');
    close.type = 'button';
    close.setAttribute('aria-label', '关闭本页目录');
    header.append(title, close);
    const list = make('nav');
    list.setAttribute('aria-label', '正文段落');
    const footer = make('footer');
    const practice = make('button', '去做题');
    practice.type = 'button';
    practice.dataset.outlineTool = 'feedback';
    const next = make('button', '下一步建议');
    next.type = 'button';
    next.dataset.outlineTool = 'continue';
    footer.append(practice, next);
    dialog.append(header, list, footer);
    dom.body.append(floating, dialog);
    for (const item of [trigger, floating]) {
      item.setAttribute('aria-controls', dialog.id);
      item.setAttribute('aria-haspopup', 'dialog');
      item.setAttribute('aria-expanded', 'false');
    }
    let loaded = false;
    let lastTrigger = trigger;
    let returnFocus = true;
    let scheduled = false;
    const readable = () =>
      loaded &&
      !reading.hidden &&
      !reading.closest('[hidden],.hidden') &&
      !body.hasAttribute('data-learning-document-empty') &&
      ['content', 'notes'].includes(page.dataset.learningTool || 'content');
    function closeWithoutFocus() {
      if (!dialog.open) return;
      returnFocus = false;
      dialog.close();
    }
    function focusHeading(target) {
      const ownTabIndex = target.hasAttribute('tabindex');
      if (!ownTabIndex) {
        target.setAttribute('tabindex', '-1');
        target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true });
      }
      target.focus({ preventScroll: true });
    }
    function populate() {
      list.replaceChildren();
      const entries = collect(body, browser);
      if (!entries.length) list.append(make('p', '正文暂无分段标题。'));
      for (const entry of entries) {
        const item = make('button', entry.label);
        item.type = 'button';
        item.style.setProperty('--outline-depth', entry.depth);
        item.addEventListener('click', () => {
          // Revalidate a live public heading; a saved list cannot target a replaced document.
          if (
            !readable() ||
            !collect(body, browser).some((current) => current.target === entry.target)
          ) {
            closeWithoutFocus();
            return;
          }
          closeWithoutFocus();
          const navigate = browser.FreeBbsLearningReader?.scrollToHeading;
          if (navigate ? navigate(entry.target) : true) {
            if (!navigate) entry.target.scrollIntoView({ block: 'start', behavior: 'instant' });
            focusHeading(entry.target);
          }
        });
        list.append(item);
      }
      for (const item of [practice, next])
        item.hidden = !dom.querySelector(`[data-knowledge-tool="${item.dataset.outlineTool}"]`);
    }
    function open(event) {
      if (!readable()) return;
      lastTrigger = event.currentTarget;
      populate();
      returnFocus = true;
      if (!dialog.open) dialog.showModal();
      trigger.setAttribute('aria-expanded', 'true');
      floating.setAttribute('aria-expanded', 'true');
      close.focus();
    }
    trigger.addEventListener('click', open);
    floating.addEventListener('click', open);
    close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
      trigger.setAttribute('aria-expanded', 'false');
      floating.setAttribute('aria-expanded', 'false');
      if (returnFocus && readable() && !lastTrigger.hidden)
        lastTrigger.focus({ preventScroll: true });
      returnFocus = true;
    });
    for (const item of [practice, next])
      item.addEventListener('click', () => {
        if (!readable()) return;
        // Use the same real tool control, from the current paragraph rather than the page top.
        browser.FreeBbsLearningReader?.capture();
        closeWithoutFocus();
        dom.querySelector(`[data-knowledge-tool="${item.dataset.outlineTool}"]`)?.click();
      });
    function sync() {
      scheduled = false;
      const active = readable();
      trigger.hidden = !active;
      const heading = reading.querySelector('.course-material-section-heading');
      const headingBounds = heading?.getBoundingClientRect();
      const readingBounds = reading.getBoundingClientRect();
      const mobileChatOpen =
        browser.matchMedia?.('(max-width: 920px)').matches &&
        dom.querySelector('.knowledge-workbench')?.classList.contains('is-interaction-open');
      floating.hidden = !(
        active &&
        !mobileChatOpen &&
        headingBounds &&
        headingBounds.bottom < 80 &&
        readingBounds.bottom > 100
      );
      if (!floating.hidden) {
        const bounds = body.getBoundingClientRect();
        const width = Math.max(44, Math.min(180, bounds.width - 16, browser.innerWidth - 32));
        floating.style.maxWidth = `${width}px`;
        let left = Math.max(
          16,
          Math.min(
            bounds.right - floating.offsetWidth - 8,
            browser.innerWidth - floating.offsetWidth - 16,
          ),
        );
        const chatToggle = dom.getElementById('knowledge-chat-toggle');
        const control = chatToggle?.getBoundingClientRect();
        const ownBounds = floating.getBoundingClientRect();
        if (
          control?.width > 0 &&
          control.top < ownBounds.bottom + 8 &&
          control.bottom > ownBounds.top - 8 &&
          left + ownBounds.width > control.left - 8 &&
          left < control.right + 8
        )
          left = Math.max(16, control.left - ownBounds.width - 8);
        floating.style.left = `${left}px`;
      }
    }
    function schedule() {
      if (scheduled) return;
      scheduled = true;
      browser.requestAnimationFrame(sync);
    }
    page.addEventListener('knowledge:loaded', () => {
      loaded = true;
      closeWithoutFocus();
      schedule();
    });
    page.addEventListener('knowledge:document-saved', () => {
      closeWithoutFocus();
      schedule();
    });
    for (const type of ['knowledge:tool-select', 'knowledge:view-change']) {
      page.addEventListener(type, () => {
        closeWithoutFocus();
        schedule();
      });
    }
    dom.addEventListener('scroll', schedule, { capture: true, passive: true });
    browser.addEventListener('resize', schedule);
    const observer = browser.MutationObserver && new browser.MutationObserver(schedule);
    observer?.observe(reading, { attributes: true, attributeFilter: ['class', 'hidden'] });
    const workbench = dom.querySelector('.knowledge-workbench');
    if (workbench) observer?.observe(workbench, { attributes: true, attributeFilter: ['class'] });
    const existing = browser.freeBbsKnowledge?.getLearningContext?.();
    if (existing?.node && existing?.course && page.getAttribute('aria-busy') === 'false') {
      loaded = true;
      schedule();
    }
    return { collect: () => collect(body, browser), close: closeWithoutFocus, sync };
  }
  return { HEADINGS, collect, install };
});
