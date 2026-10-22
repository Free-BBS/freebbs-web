(() => {
  function installAdminTeachingCourses({ document: doc, window: host, app }) {
    const root = doc.getElementById('admin-teaching-courses');
    const users = doc.getElementById('admin-users');
    if (!root || !users || !app) return;
    const el = Object.fromEntries(
      ['name', 'status', 'form', 'options', 'confirmed', 'save', 'refresh'].map((name) => [
        name,
        doc.getElementById(`teaching-${name}`),
      ]),
    );
    if (Object.values(el).some((node) => !node)) return;
    let owner = '';
    let generation = 0;
    let request = 0;
    let target = '';
    let busy = false;
    let ready = false;
    let clearingOnly = false;
    let externalChange = false;
    function storedSessionMatches() {
      try {
        if (typeof host.localStorage?.getItem !== 'function') return true;
        return host.localStorage.getItem('free_bbs_auth_token') === app.userState.token;
      } catch {
        return false;
      }
    }
    const session = () =>
      !externalChange &&
      storedSessionMatches() &&
      app.userState.isLoggedIn &&
      (app.userState.isAdmin || app.userState.role === 'admin') &&
      app.userState.uid &&
      app.userState.token
        ? `${app.userState.uid}:${app.userState.token}:${app.userState.role}:${Boolean(app.userState.isAdmin)}`
        : '';
    const owns = (key, epoch, ticket, id) =>
      key === session() && epoch === generation && ticket === request && id === target;
    function controls() {
      el.refresh.disabled = !session() || !target || busy;
      for (const input of el.options.querySelectorAll('input')) {
        input.disabled = busy || !ready || !session() || clearingOnly;
      }
      el.confirmed.disabled = busy || !ready || !session();
      el.save.disabled = busy || !ready || !session() || !el.confirmed.checked;
    }
    function clear() {
      ready = false;
      clearingOnly = false;
      el.save.textContent = '保存课程分配';
      el.options.replaceChildren();
      el.confirmed.checked = false;
      el.form.hidden = true;
      controls();
    }
    function linkButtons() {
      users.querySelectorAll('.admin-user-row[data-user-id]').forEach((card) => {
        if (!/^\d+$/.test(card.dataset.userId || '') || card.querySelector('[data-teaching-user]'))
          return;
        const heading = card.querySelector('.admin-user-summary');
        if (!heading) return;
        const button = doc.createElement('button');
        button.type = 'button';
        button.className = 'admin-button admin-button-secondary admin-teaching-open';
        button.dataset.teachingUser = card.dataset.userId;
        button.textContent = '分配课程';
        button.setAttribute(
          'aria-label',
          `${card.querySelector('[data-admin-summary-name]')?.textContent || '此用户'}的课程分配`,
        );
        heading.append(button);
      });
    }
    async function load(id = target) {
      if (!session() || !/^\d+$/.test(id)) return;
      target = id;
      request += 1;
      const ticket = request;
      const epoch = generation;
      const key = session();
      busy = true;
      clear();
      el.status.textContent = '正在读取课程分配…';
      controls();
      try {
        const payload = await app.callApi(`/admin/users/${id}/teaching-courses`);
        if (!owns(key, epoch, ticket, id)) return;
        if (
          typeof payload.eligible !== 'boolean' ||
          !Array.isArray(payload.courses) ||
          !Array.isArray(payload.courseSlugs)
        )
          throw new Error('课程信息格式不完整，请重试。');
        if (!payload.eligible && !payload.courseSlugs.length) {
          el.status.textContent =
            '此账号尚无已核实的教师身份。请先完成教师认证审核，或核实后开通教师账号。';
          return;
        }
        const selected = new Set(payload.courseSlugs);
        clearingOnly = !payload.eligible;
        payload.courses
          .filter(
            (course) =>
              typeof course.slug === 'string' &&
              /^[a-z0-9][a-z0-9-]{0,119}$/.test(course.slug) &&
              (!clearingOnly || selected.has(course.slug)),
          )
          .forEach((course) => {
            const label = doc.createElement('label');
            const input = doc.createElement('input');
            input.type = 'checkbox';
            input.name = 'courseSlugs';
            input.value = course.slug;
            input.checked = selected.has(course.slug);
            const copy = doc.createElement('span');
            copy.textContent = `${course.name || course.slug}${course.code ? ` · ${course.code}` : ''}`;
            label.append(input, copy);
            el.options.append(label);
          });
        ready = true;
        el.form.hidden = false;
        el.save.textContent = clearingOnly ? '清除旧分配' : '保存课程分配';
        if (clearingOnly)
          el.status.textContent = `此账号已无核实的教师身份，仍有 ${payload.courseSlugs.length} 门旧分配。这里只能核实后清空，不能新增或修改。`;
        else
          el.status.textContent = payload.courses.length
            ? '可为老师分配多门课程，最多 20 门；全部取消可移除分配。不会修改角色、余额、资料编辑或审核权限。'
            : '目前没有可分配的课程。';
      } catch (error) {
        if (owns(key, epoch, ticket, id))
          el.status.textContent = `${error.message || '课程读取失败'} 点击“重新读取”重试。`;
      } finally {
        if (owns(key, epoch, ticket, id)) {
          busy = false;
          controls();
        }
      }
    }
    users.addEventListener('click', (event) => {
      const button = event.target.closest('[data-teaching-user]');
      if (!button || !session() || busy) return;
      const card = button.closest('.admin-user-row');
      const name = card?.querySelector('[data-admin-summary-name]')?.textContent || '此用户';
      el.name.textContent = `${name}的课程分配`;
      root.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
      load(button.dataset.teachingUser);
    });
    el.refresh.addEventListener('click', () => load());
    el.confirmed.addEventListener('change', controls);
    el.form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!session() || !ready || busy || !el.confirmed.checked || !target) return;
      const id = target;
      const key = session();
      const epoch = generation;
      request += 1;
      const ticket = request;
      const courseSlugs = clearingOnly
        ? []
        : [...el.options.querySelectorAll('input')]
            .filter((input) => input.checked)
            .map((input) => input.value);
      if (courseSlugs.length > 20) {
        el.status.textContent = '最多分配 20 门课程，请取消多余课程后再保存。';
        return;
      }
      busy = true;
      el.status.textContent = '正在保存课程分配…';
      controls();
      try {
        const payload = await app.callApi(`/admin/users/${id}/teaching-courses`, {
          method: 'PUT',
          body: JSON.stringify({ courseSlugs, identityConfirmed: true }),
        });
        if (!owns(key, epoch, ticket, id)) return;
        if (!Array.isArray(payload.courseSlugs))
          throw new Error('保存结果不完整，请重新读取核对。');
        const saved = new Set(payload.courseSlugs);
        for (const input of el.options.querySelectorAll('input')) {
          input.checked = saved.has(input.value);
        }
        el.confirmed.checked = false;
        el.status.textContent =
          '课程分配已保存。账号角色、余额与资料编辑权限未改动，审核权限也不变。';
        if (clearingOnly) {
          clear();
          el.status.textContent = '旧课程分配已清除。';
        }
      } catch (error) {
        if (owns(key, epoch, ticket, id))
          el.status.textContent = `${error.message || '保存失败'} 您的选择仍保留，可重试保存或重新读取核对。`;
      } finally {
        if (owns(key, epoch, ticket, id)) {
          busy = false;
          controls();
        }
      }
    });
    function sync() {
      const key = session();
      if (owner === key) return;
      owner = key;
      generation += 1;
      busy = false;
      target = '';
      clear();
      root.hidden = !key;
      el.name.textContent = '分配管理课程';
      el.status.textContent = key
        ? '在下方账号列表点击“分配课程”，再选择老师可集中查看的课程。'
        : '';
      linkButtons();
    }
    if (host.MutationObserver)
      new host.MutationObserver(linkButtons).observe(users, { childList: true, subtree: true });
    host.addEventListener('freebbs:session-change', () => {
      externalChange = false;
      sync();
    });
    host.addEventListener('storage', (event) => {
      if (event.key === 'free_bbs_auth_token' || event.key === null) {
        externalChange = true;
        sync();
      }
    });
    host.addEventListener('pagehide', () => {
      externalChange = true;
      sync();
    });
    host.addEventListener('pageshow', (event) => {
      if (event.persisted) {
        externalChange = !storedSessionMatches();
        sync();
      }
    });
    controls();
    Promise.resolve(app.sessionReady).then(sync);
  }
  if (typeof module !== 'undefined' && module.exports)
    module.exports = { installAdminTeachingCourses };
  else installAdminTeachingCourses({ document, window, app: window.freeBbsApp });
})();
