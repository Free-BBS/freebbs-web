/* Public course uploads are resources, not private learning records or completion evidence. */
(function exposeLearningResources(root) {
  const LIMIT = 200;
  const FILE_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  const NODE_ID = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/;
  const validNodeId = (value) =>
    typeof value === 'string' && value.length >= 4 && value.length <= 64 && NODE_ID.test(value);
  function downloadUrl(id, apiBaseUrl, locationHref) {
    if (typeof id !== 'string' || !FILE_ID.test(id)) return null;
    try {
      const base = new URL(apiBaseUrl, locationHref);
      if (
        !['http:', 'https:'].includes(base.protocol) ||
        base.username ||
        base.password ||
        base.search ||
        base.hash ||
        !base.pathname.endsWith('/api')
      )
        return null;
      return `${base.href}/course-upload/files/${id}`;
    } catch {
      return null;
    }
  }
  function groupFiles(payload, nodeId, apiBaseUrl, locationHref) {
    if (!payload || !Array.isArray(payload.files)) throw new Error('Invalid public file response');
    const associated = [];
    const courseFiles = [];
    const seen = new Set();
    let omitted = 0;
    let otherNodeCount = 0;
    for (const file of payload.files.slice(0, LIMIT)) {
      const href = downloadUrl(file?.id, apiBaseUrl, locationHref);
      if (
        !href ||
        typeof file.fileName !== 'string' ||
        !file.fileName.trim() ||
        file.fileName.length > 1024 ||
        !(file.nodeId === null || validNodeId(file.nodeId)) ||
        seen.has(file.id)
      ) {
        omitted += 1;
        continue;
      }
      seen.add(file.id);
      const record = {
        id: file.id,
        fileName: file.fileName,
        nodeId: file.nodeId,
        href,
        url: href,
        size: Number.isFinite(file.size) && file.size > 0 ? file.size : null,
        createdAt: typeof file.createdAt === 'string' ? file.createdAt : '',
      };
      if (file.nodeId === nodeId) associated.push(record);
      else if (file.nodeId === null) courseFiles.push(record);
      else otherNodeCount += 1;
    }
    return { associated, courseFiles, otherNodeCount, omitted, limit: LIMIT };
  }
  function install(browser, dom, app) {
    const page = dom.querySelector('[data-knowledge-page]');
    const host = dom.getElementById('learning-resources-content');
    if (!page || !host) return null;
    const requests = new Map();
    let context = null;
    let generation = 0;
    let stale = false;
    let snapshot = { status: 'idle', associated: [], courseFiles: [], resources: [], limit: LIMIT };
    const signature = () =>
      JSON.stringify([app?.userState?.isLoggedIn, app?.userState?.uid, app?.userState?.token]);
    const element = (tag, className, copy) => {
      const item = dom.createElement(tag);
      if (className) item.className = className;
      if (copy) item.textContent = copy;
      return item;
    };
    function announce(status, files = {}) {
      snapshot = {
        courseSlug: context?.courseSlug || '',
        nodeId: context?.nodeId || '',
        status,
        associated: files.associated || [],
        courseFiles: files.courseFiles || [],
        resources: files.associated || [],
        hasAssociatedResources: Boolean(files.associated?.length),
        hasCourseResources: Boolean(files.courseFiles?.length),
        limit: LIMIT,
      };
      page.dispatchEvent(
        new browser.CustomEvent('knowledge:resources-updated', { detail: snapshot }),
      );
    }
    function renderState(status, copy, retry = false, notify = true) {
      host.replaceChildren();
      host.dataset.resourcesState = status;
      host.setAttribute('aria-busy', String(status === 'loading'));
      const message = element('p', 'learning-form-status', copy);
      message.setAttribute('role', 'status');
      host.append(message);
      if (retry) {
        const button = element('button', 'button button-ghost', '重新载入公开资料');
        button.type = 'button';
        button.addEventListener('click', refresh);
        host.append(button);
      }
      if (notify) announce(status);
    }
    function renderGroup(title, records, empty) {
      const group = element('section', 'learning-resource-group');
      group.append(element('h3', '', title));
      if (!records.length) group.append(element('p', 'learning-caption', empty));
      else {
        const list = element('ul', 'course-files-list');
        for (const record of records) {
          const item = element('li', 'learning-resource-file');
          const link = element('a', '', record.fileName);
          link.href = record.href;
          link.setAttribute('download', record.fileName);
          link.style.overflowWrap = 'anywhere';
          let size = '大小未提供';
          if (record.size)
            size =
              record.size >= 1048576
                ? `${(record.size / 1048576).toFixed(1)} MB`
                : `${Math.max(1, Math.ceil(record.size / 1024))} KB`;
          item.append(link, element('small', 'learning-caption', ` ${size}`));
          list.append(item);
        }
        group.append(list);
      }
      host.append(group);
    }
    function renderFiles(files) {
      const count = files.associated.length + files.courseFiles.length;
      renderState(
        count ? 'ready' : 'empty',
        '公开资料无需登录；仅检查课程最近上传的最多 200 份文件，不代表全部资料。',
        false,
        false,
      );
      renderGroup(
        `与 ${context.nodeId} 关联的资料`,
        files.associated,
        '最近 200 份上传文件中未找到本知识点关联资料。',
      );
      renderGroup(
        '课程资料（未指定知识点）',
        files.courseFiles,
        '最近 200 份上传文件中未找到未指定知识点的课程资料。',
      );
      if (files.otherNodeCount)
        host.append(element('p', 'learning-caption', '其他知识点的关联文件未列入本页。'));
      if (files.omitted)
        host.append(element('p', 'learning-caption', '部分返回记录格式无效，未提供下载链接。'));
      announce(count ? 'ready' : 'empty', files);
    }
    function key(owner) {
      return JSON.stringify([app?.apiBaseUrl, context?.courseSlug, context?.nodeId, owner]);
    }
    async function load() {
      generation += 1;
      const current = generation;
      const owner = signature();
      const requestedContext = context;
      if (!context) return;
      if (stale) {
        renderState('stale', '账号状态已变化；公开资料无需登录，可重新载入。', true);
        return;
      }
      renderState('loading', '正在载入公开资料（无需登录）…');
      const cacheKey = key(owner);
      let request = requests.get(cacheKey);
      try {
        if (
          !app?.callApi ||
          !downloadUrl(
            '00000000-0000-0000-0000-000000000000',
            app.apiBaseUrl,
            browser.location.href,
          )
        )
          throw new Error('Public API unavailable');
        if (!request) {
          request = app.callApi(
            `/course-upload/public/courses/${encodeURIComponent(context.courseSlug)}/files`,
            {
              method: 'GET',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'omit',
            },
          );
          requests.set(cacheKey, request);
          if (requests.size > 8) requests.delete(requests.keys().next().value);
        }
        const data = await request;
        if (
          current !== generation ||
          owner !== signature() ||
          requestedContext !== context ||
          stale ||
          !host.isConnected
        )
          return;
        renderFiles(groupFiles(data, context.nodeId, app.apiBaseUrl, browser.location.href));
      } catch {
        if (requests.get(cacheKey) === request) requests.delete(cacheKey);
        if (
          current === generation &&
          owner === signature() &&
          requestedContext === context &&
          !stale &&
          host.isConnected
        )
          renderState(
            'error',
            '公开资料暂未载入，请重试；此状态不表示没有资料，也无需登录。',
            true,
          );
      }
    }
    function setContext(detail) {
      const courseSlug = detail?.course?.slug;
      const nodeId = detail?.node?.id;
      if (
        typeof courseSlug !== 'string' ||
        !/^[a-z0-9-]{1,64}$/.test(courseSlug) ||
        !validNodeId(nodeId)
      ) {
        context = null;
        generation += 1;
        renderState('idle', '选择知识点后查看公开资料。');
        return;
      }
      context = { courseSlug, nodeId };
      load();
    }
    function refresh() {
      stale = false;
      requests.delete(key(signature()));
      load();
    }
    page.addEventListener('knowledge:loaded', (event) => setContext(event.detail));
    browser.addEventListener('freebbs:session-change', () => {
      stale = false;
      requests.clear();
      load();
    });
    browser.addEventListener('storage', (event) => {
      if (event.key !== 'free_bbs_auth_token' && event.key !== null) return;
      generation += 1;
      requests.clear();
      stale = true;
      renderState('stale', '账号状态已变化；公开资料无需登录，可重新载入。', true);
    });
    browser.addEventListener('pageshow', (event) => {
      if (event.persisted) refresh();
    });
    renderState('idle', '选择知识点后查看公开资料。');
    return { setContext, refresh, getSnapshot: () => snapshot };
  }
  const api = { LIMIT, downloadUrl, groupFiles, install };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FreeBbsLearningResources = { ...api, ...install(root, root.document, root.freeBbsApp) };
})(typeof window !== 'undefined' ? window : globalThis);
