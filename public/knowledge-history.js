/* The history shell is UI-only; course-authored content will be added separately. */
(() => {
  function createController({ page, document: doc, storage, course, point, owner = () => '' }) {
    const box = doc.getElementById('knowledge-history');
    const content = doc.getElementById('knowledge-history-content');
    const toggle = doc.getElementById('knowledge-history-toggle');
    const label = doc.getElementById('knowledge-history-toggle-label');
    if (!box || !content || !toggle || !label) return null;

    let expanded = true;
    let selectedTool = 'content';
    const storageKey = () =>
      `free_bbs_knowledge_history_v1:${JSON.stringify([owner(), course, point])}`;

    function setExpanded(value, persist = false) {
      expanded = Boolean(value);
      content.hidden = !expanded;
      box.classList.toggle('is-collapsed', !expanded);
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.setAttribute('aria-label', expanded ? '收起知识起源说明' : '展开知识起源说明');
      label.textContent = expanded ? '收起 −' : '展开 ＋';
      if (persist) {
        try {
          storage.setItem(storageKey(), String(expanded));
        } catch {
          // The current interaction still works if browser storage is full or disabled.
        }
      }
    }

    function restore() {
      let value = true;
      try {
        value = storage.getItem(storageKey()) !== 'false';
      } catch {
        // First entry defaults to expanded, without writing during initialization.
      }
      setExpanded(value);
    }

    toggle.addEventListener('click', () => setExpanded(!expanded, true));
    box.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && expanded) {
        event.preventDefault();
        event.stopPropagation();
        setExpanded(false, true);
        toggle.focus({ preventScroll: true });
      }
    });
    page.addEventListener('knowledge:tool-select', (event) => {
      selectedTool = event.detail?.tool;
      box.hidden = selectedTool !== 'content';
    });
    page.addEventListener('knowledge:view-change', (event) => {
      // The overview/reading controls can also return to content, without a tool click.
      if (event.detail?.activateContent) selectedTool = 'content';
      box.hidden = event.detail?.view !== 'reading' || selectedTool !== 'content';
    });
    restore();
    return { restore };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createController };
    return;
  }

  const page = document.querySelector('[data-knowledge-page]');
  if (!page) return;
  const params = new URLSearchParams(window.location.search);
  const app = window.freeBbsApp;
  const controller = createController({
    page,
    document,
    // Access the localStorage property inside restore/save's exception boundaries too.
    storage: {
      getItem: (key) => window.localStorage.getItem(key),
      setItem: (key, value) => window.localStorage.setItem(key, value),
    },
    course: params.get('course') || 'signals',
    point: params.get('point') || '',
    owner: () => app?.userState?.uid || '',
  });
  window.addEventListener('freebbs:session-change', () => controller?.restore());
  Promise.resolve(app?.sessionReady).then(() => controller?.restore());
})();
