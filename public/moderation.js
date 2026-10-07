(function moderationModule() {
  const STORAGE_KEY = 'free_bbs_auth_token';
  const STATUS_LABELS = {
    pending: '待审核',
    approved: '已通过',
    rejected: '未通过',
    expired: '已到期',
  };
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function attachmentId(attachment, apiBase, origin) {
    if (UUID.test(attachment.id || '')) return attachment.id;
    try {
      const base = new URL(apiBase, origin);
      const url = new URL(attachment.url, origin);
      const prefix = `${base.pathname.replace(/\/$/, '')}/moderation/attachments/`;
      const id = url.pathname.slice(prefix.length);
      return url.origin === base.origin && url.pathname.startsWith(prefix) && UUID.test(id)
        ? id
        : '';
    } catch {
      return '';
    }
  }

  function publishedLink(value, origin) {
    if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '';
    try {
      const url = new URL(value, origin);
      return url.origin === origin && url.pathname === '/discussion'
        ? `${url.pathname}${url.search}${url.hash}`
        : '';
    } catch {
      return '';
    }
  }

  function createClient({ apiBase, getToken, fetch: fetchRequest }) {
    async function request(path, options = {}, image = false) {
      const token = getToken();
      if (!token) throw new Error('请先登录，再返回本页查看。');
      const response = await fetchRequest(`${apiBase}${path}`, {
        ...options,
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${token}`,
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        },
      });
      if (token !== getToken()) throw new Error('登录状态已变化，请刷新页面。');
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const error = new Error(payload.message || '请求失败，请稍后重试。');
        error.status = response.status;
        throw error;
      }
      const payload = image ? await response.blob() : await response.json();
      if (token !== getToken()) throw new Error('登录状态已变化，请刷新页面。');
      if (
        image &&
        (!/^image\/(?:webp|png|jpeg|gif)$/.test(payload.type) || payload.size > 5 * 1024 * 1024)
      )
        throw new Error('图片格式或大小无效，无法预览。');
      return payload;
    }
    return { request };
  }

  function mount({
    document,
    window,
    fetch: fetchRequest,
    storage,
    urlApi = URL,
    cryptoApi = crypto,
  }) {
    const root = document.getElementById('moderation-app');
    if (!root) return null;
    const el = (id) => document.getElementById(`moderation-${id}`);
    const apiBase = (window.FREEBBS_API_BASE || `${window.location.origin}/api`).replace(/\/$/, '');
    const getToken = () => storage.getItem(STORAGE_KEY) || '';
    const client = createClient({ apiBase, getToken, fetch: fetchRequest });
    const query = new URLSearchParams(window.location.search);
    let mine = query.get('mine') === '1';
    const state = {
      generation: 0,
      listVersion: 0,
      detailVersion: 0,
      candidateVersion: 0,
      session: null,
      selected: null,
      urls: new Set(),
      decisionIntent: null,
      deciding: false,
      imagesReady: false,
      nextCursor: '',
      count: 0,
    };

    function node(tag, text, className) {
      const element = document.createElement(tag);
      if (text !== undefined) element.textContent = String(text);
      if (className) element.className = className;
      return element;
    }
    function valid(generation) {
      return generation === state.generation && Boolean(getToken());
    }
    function clearImages() {
      for (const url of state.urls) urlApi.revokeObjectURL(url);
      state.urls.clear();
    }
    function clearDetail() {
      state.detailVersion += 1;
      clearImages();
      state.selected = null;
      state.decisionIntent = null;
      state.deciding = false;
      el('detail').replaceChildren(node('p', '选择一条提交，查看正文和图片。', 'moderation-empty'));
    }
    function formatTime(value) {
      const date = new Date(value);
      return value && !Number.isNaN(date.getTime()) ? date.toLocaleString('zh-CN') : '';
    }
    function reset() {
      state.generation += 1;
      state.session = null;
      clearDetail();
      el('list').replaceChildren();
      el('more').hidden = true;
      state.nextCursor = '';
      state.count = 0;
      el('reviewer-list').replaceChildren();
      el('candidates').replaceChildren();
      el('reviewer-query').value = '';
      el('reviewer-message').textContent = '';
      for (const id of ['workspace', 'reviewers', 'tabs', 'review-link']) el(id).hidden = true;
    }

    async function showImage(attachment, container, generation, version, index) {
      const figure = node('figure');
      const caption = node('figcaption', `图片 ${index + 1} · 正在加载`);
      figure.append(caption);
      container.append(figure);
      try {
        const id = attachmentId(attachment, apiBase, window.location.origin);
        if (!id) throw new Error('附件地址无效，未加载。');
        const blob = await client.request(`/moderation/attachments/${id}`, {}, true);
        if (!valid(generation) || version !== state.detailVersion) return;
        const url = urlApi.createObjectURL(blob);
        state.urls.add(url);
        const image = node('img');
        image.alt = `提交图片 ${index + 1}`;
        image.src = url;
        image.addEventListener('error', () => {
          image.remove();
          caption.textContent = `图片 ${index + 1} · 无法显示，请刷新后重试`;
        });
        caption.textContent = `图片 ${index + 1}`;
        figure.replaceChildren(image, caption);
        await image.decode();
        return true;
      } catch (error) {
        if (valid(generation) && version === state.detailVersion)
          caption.textContent = error.message;
        return false;
      }
    }

    async function decide(submission, decision, reason, form, status) {
      if (state.deciding || state.selected !== submission) return;
      if (decision === 'approved' && !state.imagesReady) {
        status.textContent = '请先完整加载提交图片，再通过审核。';
        return;
      }
      const text = reason.trim();
      if (decision === 'rejected' && !text) {
        status.textContent = '请填写未通过原因，便于作者修改。';
        return;
      }
      const generation = state.generation;
      const version = state.detailVersion;
      const intentKey = JSON.stringify([submission.id, submission.version, decision, text]);
      if (state.decisionIntent?.key !== intentKey)
        state.decisionIntent = { key: intentKey, requestId: cryptoApi.randomUUID() };
      state.deciding = true;
      const buttons = form.querySelectorAll('button');
      buttons.forEach((button) => {
        button.disabled = true;
      });
      status.textContent = '正在保存审核结果…';
      try {
        await client.request(
          `/moderation/submissions/${encodeURIComponent(submission.id)}/decision`,
          {
            method: 'POST',
            body: JSON.stringify({
              decision,
              reason: text,
              expectedVersion: submission.version,
              requestId: state.decisionIntent.requestId,
            }),
          },
        );
        if (!valid(generation) || version !== state.detailVersion) return;
        state.decisionIntent = null;
        el('message').textContent =
          decision === 'approved' ? '审核通过，发布结果已保存。' : '已保存未通过结果。';
        await loadList(false);
        await openSubmission(submission.id);
      } catch (error) {
        if (!valid(generation) || version !== state.detailVersion) return;
        if (error.status === 409) {
          state.decisionIntent = null;
          el('message').textContent = '这条提交的状态已变化，已重新加载，请核对后操作。';
          await openSubmission(submission.id);
        } else {
          status.textContent = `${error.message} 可重试同一决定。`;
        }
      } finally {
        if (valid(generation) && version === state.detailVersion) {
          state.deciding = false;
          buttons.forEach((button) => {
            button.disabled = button.dataset.decision === 'approved' && !state.imagesReady;
          });
        }
      }
    }

    async function openSubmission(id) {
      clearDetail();
      const version = state.detailVersion;
      const generation = state.generation;
      el('detail').replaceChildren(node('p', '正在加载提交…'));
      try {
        const payload = await client.request(`/moderation/submissions/${encodeURIComponent(id)}`);
        if (!valid(generation) || version !== state.detailVersion) return;
        const submission = payload.submission;
        if (!submission) throw new Error('提交详情不可用。');
        state.selected = submission;
        const title = node(
          'h2',
          submission.title || (submission.kind === 'comment' ? '评论' : '帖子'),
        );
        const meta = node(
          'p',
          `${STATUS_LABELS[submission.status] || '未知状态'} · ${submission.kind === 'comment' ? '评论' : '帖子'} · ${formatTime(submission.createdAt)}`,
          'moderation-meta',
        );
        const author = node('p', `提交者：${submission.author?.username || '用户'}`);
        const body = node('pre', submission.contentMarkdown || '', 'moderation-raw');
        const images = node('div', undefined, 'moderation-images');
        const attachments = submission.attachments || [];
        state.imagesReady = attachments.length === 0;
        let approveButton;
        let imageStatus;
        el('detail').replaceChildren(title, meta, author, node('h3', '正文原文'), body, images);
        if (submission.reason) el('detail').append(node('p', `审核说明：${submission.reason}`));
        if (submission.expiresAt)
          el('detail').append(
            node('p', `审核数据到期时间：${formatTime(submission.expiresAt)}`, 'moderation-note'),
          );
        const published = publishedLink(submission.publishedUrl, window.location.origin);
        if (submission.status === 'approved' && published) {
          const link = node('a', '查看已发布内容');
          link.href = published;
          el('detail').append(link);
        }
        if (
          !mine &&
          state.session.reviewer &&
          submission.status === 'pending' &&
          Number.isInteger(submission.version)
        ) {
          const form = node('form', undefined, 'moderation-decision');
          const label = node('label', '审核说明（未通过时必填）');
          label.htmlFor = 'moderation-reason';
          const reason = node('textarea');
          reason.id = 'moderation-reason';
          reason.maxLength = 1000;
          const status = node('p');
          status.setAttribute('role', 'status');
          imageStatus = status;
          const actions = node('div', undefined, 'moderation-actions');
          for (const [decision, caption] of [
            ['approved', '通过并发布'],
            ['rejected', '不予发布'],
          ]) {
            const button = node(
              'button',
              caption,
              decision === 'approved' ? 'moderation-approve' : '',
            );
            button.type = 'button';
            button.dataset.decision = decision;
            if (decision === 'approved') {
              approveButton = button;
              button.disabled = attachments.length > 0;
            }
            button.addEventListener('click', () =>
              decide(submission, decision, reason.value, form, status),
            );
            actions.append(button);
          }
          form.addEventListener('submit', (event) => event.preventDefault());
          form.append(label, reason, actions, status);
          el('detail').append(form);
        }
        if (attachments.length && imageStatus)
          imageStatus.textContent = '图片加载完成后可通过审核；加载失败时请刷新重试。';
        Promise.all(
          attachments.map((attachment, index) =>
            showImage(attachment, images, generation, version, index),
          ),
        ).then((loaded) => {
          if (!valid(generation) || version !== state.detailVersion || !approveButton) return;
          state.imagesReady = loaded.every(Boolean);
          approveButton.disabled = state.deciding || !state.imagesReady;
          imageStatus.textContent = state.imagesReady
            ? ''
            : '有图片未能加载，暂不能通过审核。请刷新后重试。';
        });
        el('detail').focus({ preventScroll: true });
      } catch (error) {
        if (valid(generation) && version === state.detailVersion)
          el('detail').replaceChildren(node('p', error.message));
      }
    }

    async function loadList(clear = true, more = false) {
      const generation = state.generation;
      state.listVersion += 1;
      const version = state.listVersion;
      if (clear) clearDetail();
      if (!more) {
        el('list').replaceChildren();
        state.count = 0;
        state.nextCursor = '';
      }
      el('more').disabled = true;
      el('list-status').textContent = '正在加载…';
      try {
        const path = mine ? '/moderation/mine' : '/moderation/submissions';
        const params = new URLSearchParams();
        if (!mine) params.set('status', el('status').value);
        if (more && state.nextCursor) params.set('before', state.nextCursor);
        const payload = await client.request(`${path}?${params}`);
        if (!valid(generation) || version !== state.listVersion) return;
        const items = payload.submissions || [];
        state.count += items.length;
        state.nextCursor = payload.nextCursor || '';
        el('more').hidden = !state.nextCursor;
        el('list-status').textContent = state.count
          ? `已显示 ${state.count} 条提交${mine ? '（所有状态）' : ''}`
          : '暂无符合条件的提交。';
        for (const item of items) {
          const button = node('button', undefined, 'moderation-item');
          button.type = 'button';
          button.append(
            node('strong', item.title || (item.kind === 'comment' ? '评论' : '帖子')),
            node(
              'span',
              `${STATUS_LABELS[item.status] || '未知状态'} · ${formatTime(item.createdAt)}`,
              'moderation-meta',
            ),
          );
          button.addEventListener('click', () => openSubmission(item.id));
          el('list').append(button);
        }
      } catch (error) {
        if (valid(generation) && version === state.listVersion)
          el('list-status').textContent = error.message;
      } finally {
        if (valid(generation) && version === state.listVersion) el('more').disabled = false;
      }
    }

    function personRow(person, enabled) {
      const row = node('div', undefined, 'moderation-person');
      const button = node('button', enabled ? '移除负责人' : '设为负责人');
      button.type = 'button';
      button.addEventListener('click', async () => {
        const generation = state.generation;
        button.disabled = true;
        try {
          const payload = await client.request(
            `/moderation/reviewers/${encodeURIComponent(person.id)}`,
            {
              method: 'PATCH',
              body: JSON.stringify({ enabled: !enabled }),
            },
          );
          if (!valid(generation)) return;
          el('reviewer-message').textContent =
            payload.activeCount === 0
              ? '当前没有审核负责人，稿件将保持待审。请添加负责人。'
              : '负责人设置已更新。';
          el('candidates').replaceChildren();
          await loadReviewers();
        } catch (error) {
          if (valid(generation)) el('reviewer-message').textContent = error.message;
        } finally {
          if (valid(generation)) button.disabled = false;
        }
      });
      row.append(node('span', person.username || `用户 ${person.id}`), button);
      return row;
    }
    async function loadReviewers() {
      const generation = state.generation;
      try {
        const payload = await client.request('/moderation/reviewers');
        if (!valid(generation)) return;
        const reviewers = payload.reviewers || [];
        el('reviewer-list').replaceChildren(
          ...(reviewers.length
            ? reviewers.map((person) => personRow(person, true))
            : [node('p', '当前没有审核负责人，稿件将保持待审。请添加负责人。')]),
        );
      } catch (error) {
        if (valid(generation)) el('reviewer-message').textContent = error.message;
      }
    }
    async function initialize() {
      reset();
      const generation = state.generation;
      mine = query.get('mine') === '1';
      el('title').textContent = mine ? '我的提交' : '审核工作台';
      el('status').hidden = mine;
      el('status-label').hidden = mine;
      el('login').href =
        `/login?next=${encodeURIComponent(`/moderation${window.location.search}`)}`;
      el('login').hidden = Boolean(getToken());
      el('message').textContent = getToken() ? '正在确认审核权限…' : '请先登录，再返回本页查看。';
      if (!getToken()) return;
      try {
        const session = await client.request('/moderation/session');
        if (!valid(generation)) return;
        state.session = session;
        if (!session.enabled) {
          el('message').textContent = '当前环境尚未启用内容审核。';
          return;
        }
        // Notifications share one detail URL; authors use their own submission view.
        if (query.get('id') && !session.reviewer) mine = true;
        el('title').textContent = mine ? '我的提交' : '审核工作台';
        el('status').hidden = mine;
        el('status-label').hidden = mine;
        el('tabs').hidden = false;
        el('review-link').hidden = !session.reviewer;
        el('mine-link').setAttribute('aria-current', mine ? 'page' : 'false');
        el('review-link').setAttribute('aria-current', mine ? 'false' : 'page');
        el('reviewers').hidden = !session.isAdmin;
        if (session.isAdmin) loadReviewers();
        if (!mine && !session.reviewer) {
          el('message').textContent = '此页面需要审核负责人权限；你可以查看“我的提交”。';
          return;
        }
        el('message').textContent = mine
          ? '仅显示你提交的审核记录。'
          : '请结合正文和全部图片作出人工审核决定。';
        el('workspace').hidden = false;
        await loadList();
        if (valid(generation) && query.get('id')) await openSubmission(query.get('id'));
      } catch (error) {
        if (valid(generation)) {
          el('message').textContent = error.message;
          if (error.status === 401) el('login').hidden = false;
        }
      }
    }
    el('refresh').addEventListener('click', () => loadList());
    el('more').addEventListener('click', () => loadList(false, true));
    el('status').addEventListener('change', () => loadList());
    el('reviewer-search').addEventListener('submit', async (event) => {
      event.preventDefault();
      const generation = state.generation;
      state.candidateVersion += 1;
      const version = state.candidateVersion;
      const text = el('reviewer-query').value.trim();
      if (!state.session?.isAdmin || !text) return;
      el('candidates').replaceChildren();
      el('reviewer-message').textContent = '正在查找…';
      try {
        const payload = await client.request(
          `/moderation/reviewer-candidates?q=${encodeURIComponent(text)}`,
        );
        if (!valid(generation) || version !== state.candidateVersion) return;
        const users = payload.users || [];
        el('reviewer-message').textContent = users.length
          ? '请选择需要添加的负责人。'
          : '未找到用户。';
        el('candidates').replaceChildren(
          ...users.map((person) => personRow(person, Boolean(person.reviewer))),
        );
      } catch (error) {
        if (valid(generation) && version === state.candidateVersion)
          el('reviewer-message').textContent = error.message;
      }
    });
    window.addEventListener('storage', (event) => {
      if (event.key === STORAGE_KEY || event.key === null) initialize();
    });
    window.addEventListener('freebbs:session-change', initialize);
    window.addEventListener('pagehide', reset);
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) initialize();
    });
    const ready = initialize();
    return { ready, initialize, loadList, openSubmission, state };
  }

  if (typeof module !== 'undefined' && module.exports)
    module.exports = { attachmentId, publishedLink, createClient, mount };
  if (typeof window !== 'undefined' && typeof document !== 'undefined')
    mount({ document, window, fetch: window.fetch.bind(window), storage: window.localStorage });
})();
