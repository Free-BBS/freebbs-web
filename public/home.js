/* Reuse the workbench's browser-local route. This is navigation, not learning progress. */
(() => {
  const STORAGE_KEY = 'free_bbs_last_learning_route';
  const courses = Object.freeze({
    math: '高等微积分',
    circuits: '电子电路与系统基础',
    signals: '信号与系统',
  });

  function readRecentRoute(storage, origin) {
    try {
      const stored = JSON.parse(storage.getItem(STORAGE_KEY) || 'null');
      if (!stored || typeof stored.href !== 'string' || stored.href.length > 1024) return null;
      // Accept only canonical local course/knowledge routes, never an arbitrary stored URL.
      if (!/^\/(course|knowledge)\?/.test(stored.href)) return null;
      const url = new URL(stored.href, origin);
      if (url.origin !== origin || url.pathname !== stored.pathname) return null;
      const course = url.searchParams.get('course');
      if (!Object.prototype.hasOwnProperty.call(courses, course)) return null;
      const query = new URLSearchParams({ course });
      let point = '';
      if (url.pathname === '/knowledge') {
        point = url.searchParams.get('point') || '';
        if (
          !point ||
          point.length > 128 ||
          [...point].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
        )
          return null;
        query.set('point', point);
      }
      return { href: `${url.pathname}?${query}`, course, point, name: courses[course] };
    } catch {
      return null;
    }
  }

  function installHomeResume({ document: doc, window: win, app }) {
    const link = doc.getElementById('home-learning-link');
    const note = doc.getElementById('home-resume-note');
    const worldLink = doc.getElementById('home-world-link');
    if (!link || !note || !worldLink) return;
    let revision = 0;
    function reset() {
      link.href = '/world';
      link.textContent = '进入学习世界 ↗';
      note.textContent = '选择一门课程，从知识地图开始。';
      worldLink.hidden = true;
    }
    async function refresh() {
      revision += 1;
      const request = revision;
      reset();
      let recent;
      try {
        recent = readRecentRoute(win.localStorage, win.location.origin);
      } catch {
        return;
      }
      if (!recent) return;
      let title = recent.name;
      // Check that a remembered point still exists and is readable for this session.
      if (recent.point) {
        try {
          await app?.sessionReady;
          if (request !== revision || !app?.callApi) return;
          const payload = await app.callApi(
            `/courses/${encodeURIComponent(recent.course)}/map/nodes/${encodeURIComponent(recent.point)}`,
            { method: 'GET' },
          );
          if (payload?.node?.id !== recent.point || typeof payload.node.title !== 'string') return;
          title = `${recent.name} · ${payload.node.title.slice(0, 160)}`;
        } catch {
          return;
        }
      }
      if (request !== revision) return;
      link.href = recent.href;
      link.textContent = '继续上次浏览 ↗';
      note.textContent = `本浏览器最近访问：${title}。非账号同步记录。`;
      worldLink.hidden = false;
    }
    win.addEventListener('storage', (event) => {
      if (event.key === STORAGE_KEY || event.key === null) refresh();
    });
    win.addEventListener('freebbs:session-change', refresh);
    win.addEventListener('pageshow', refresh);
    refresh();
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { readRecentRoute, installHomeResume };
  } else {
    installHomeResume({ document, window, app: window.freeBbsApp });
  }
})();
