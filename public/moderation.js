(function moderationModule() {
  const STORAGE_KEY = 'free_bbs_auth_token';
  const STATUS_LABELS = {
    pending: '待审核',
    approved: '已通过',
    rejected: '未通过',
    expired: '已到期',
  };
  const AI_CATEGORY_LABELS = {
    privacy: '隐私信息',
    harassment: '骚扰侮辱',
    threat: '威胁',
    self_harm: '自伤风险',
    sexual_minors: '未成年人性风险',
    sexual_content: '色情内容',
    violence: '暴力',
    fraud: '诈骗',
    illegal_activity: '违法活动',
    hate: '仇恨歧视',
    misinformation: '不实信息',
    other: '其他',
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

    function aiTestPanel(submission, generation, version, terms) {
      const panel = node('section', undefined, 'moderation-ai-test');
      panel.setAttribute('aria-label', '无问芯穹试审（文字）');
      const modelLabel = node('label', '试审模型');
      modelLabel.htmlFor = 'moderation-ai-model';
      const model = node('select');
      model.id = 'moderation-ai-model';
      model.disabled = true;
      const modelStatus = node('p', '正在加载可用模型…', 'moderation-note');
      modelStatus.setAttribute('role', 'status');
      const retryModels = node('button', '重新加载模型列表');
      retryModels.type = 'button';
      retryModels.hidden = true;
      const label = node('label', '发送给无问芯穹的文字');
      label.htmlFor = 'moderation-ai-input-mode';
      const mode = node('select');
      mode.id = 'moderation-ai-input-mode';
      for (const [value, caption] of [
        ['redacted', '本地脱敏后的文字'],
        ['synthetic_original', '虚构原文（仅测试）'],
      ]) {
        const option = node('option', caption);
        option.value = value;
        mode.append(option);
      }
      mode.value = 'redacted';
      const button = node('button', '调用无问芯穹试审');
      button.type = 'button';
      button.disabled = true;
      const status = node('p');
      status.setAttribute('role', 'status');
      const result = node('div', undefined, 'moderation-ai-result');
      let inputVersion = 0;
      let busy = false;
      let modelIds = new Set();
      let loadingModels = false;
      let catalogVersion = 0;
      const inspectedVersion = submission.version;
      const current = () =>
        valid(generation) &&
        version === state.detailVersion &&
        state.selected === submission &&
        submission.version === inspectedVersion &&
        submission.status === 'pending' &&
        !mine &&
        state.session?.reviewer === true &&
        state.session?.aiTestEnabled === true;
      const invalidate = () => {
        inputVersion += 1;
        result.replaceChildren();
        status.textContent = '输入已变化，试审结果已清除。请手动重新调用。';
      };
      async function loadModels() {
        if (loadingModels || busy || !current()) return;
        if (catalogVersion > 0) invalidate();
        loadingModels = true;
        catalogVersion += 1;
        const requestVersion = catalogVersion;
        modelIds = new Set();
        model.disabled = true;
        model.value = '';
        const placeholder = node('option', '加载模型…');
        placeholder.value = '';
        model.replaceChildren(placeholder);
        button.disabled = true;
        retryModels.hidden = true;
        modelStatus.textContent = '正在加载可用模型…';
        try {
          const catalog = await client.request('/moderation/ai-models', { method: 'GET' });
          if (!current() || requestVersion !== catalogVersion) return;
          if (
            !Array.isArray(catalog.models) ||
            !catalog.models.length ||
            catalog.models.length > 100 ||
            catalog.models.some(
              (item) =>
                !item ||
                typeof item.id !== 'string' ||
                !item.id.trim() ||
                item.id.length > 128 ||
                typeof item.label !== 'string' ||
                !item.label.trim() ||
                item.label.length > 128,
            ) ||
            new Set(catalog.models.map((item) => item.id)).size !== catalog.models.length ||
            !catalog.models.some((item) => item.id === catalog.defaultModel)
          )
            throw new Error('模型列表无效，请重新加载。');
          modelIds = new Set(catalog.models.map((item) => item.id));
          model.replaceChildren(
            ...catalog.models.map((item) => {
              const option = node('option', item.label);
              option.value = item.id;
              return option;
            }),
          );
          model.value = catalog.defaultModel;
          model.disabled = false;
          button.disabled = false;
          modelStatus.textContent = '选择仅影响当前详情中的试审；图片仍需人工检查。';
          retryModels.hidden = false;
        } catch (error) {
          if (current() && requestVersion === catalogVersion) {
            const failedPlaceholder = node('option', '模型列表未就绪');
            failedPlaceholder.value = '';
            model.replaceChildren(failedPlaceholder);
            modelStatus.textContent = `无法加载模型列表：${error.message} 加载列表不会调用模型。`;
            retryModels.hidden = false;
          }
        } finally {
          loadingModels = false;
        }
      }
      retryModels.addEventListener('click', loadModels);
      model.addEventListener('change', invalidate);
      mode.addEventListener('change', invalidate);
      button.addEventListener('click', async () => {
        if (busy || !current() || loadingModels || !modelIds.size) return;
        const requestedModel = model.value;
        if (!modelIds.has(requestedModel)) {
          status.textContent = '请从已加载的列表选择试审模型。';
          return;
        }
        const inputMode = mode.value;
        const inputTerms = terms.value;
        const extraTerms = inputTerms
          .split(/\r?\n/)
          .map((term) => term.trim())
          .filter(Boolean);
        if (!['redacted', 'synthetic_original'].includes(inputMode)) {
          status.textContent = '请选择有效的文字发送方式。';
          return;
        }
        if (extraTerms.length > 50 || extraTerms.some((term) => term.length > 128)) {
          status.textContent = '最多填写 50 项补充信息，每项最多 128 字。';
          return;
        }
        inputVersion += 1;
        const requestVersion = inputVersion;
        const responseCurrent = () =>
          current() &&
          requestVersion === inputVersion &&
          model.value === requestedModel &&
          mode.value === inputMode &&
          terms.value === inputTerms;
        busy = true;
        button.disabled = true;
        retryModels.disabled = true;
        result.replaceChildren();
        status.textContent = `正在调用无问芯穹，发送${inputMode === 'redacted' ? '本地脱敏后的文字' : '虚构原文（仅测试）'}…`;
        try {
          const { result: assessmentResult } = await client.request(
            `/moderation/submissions/${encodeURIComponent(submission.id)}/ai-test`,
            {
              method: 'POST',
              body: JSON.stringify({
                expectedVersion: inspectedVersion,
                inputMode,
                extraTerms,
                model: requestedModel,
              }),
            },
          );
          if (!responseCurrent()) return;
          const decisions = {
            no_risk_detected: '未发现明显风险，仍需人工决定',
            needs_review: '需要人工重点核查',
            high_risk: '发现高风险迹象，请人工核查',
          };
          const assessment = assessmentResult?.assessment;
          if (
            assessmentResult?.submissionId !== submission.id ||
            assessmentResult.version !== inspectedVersion ||
            assessmentResult.inputMode !== inputMode ||
            assessmentResult.imagesReviewed !== false ||
            assessmentResult.automaticPublication !== false ||
            typeof assessmentResult.contentHash !== 'string' ||
            !/^[a-f0-9]{64}$/.test(assessmentResult.contentHash) ||
            (submission.contentHash && assessmentResult.contentHash !== submission.contentHash) ||
            assessmentResult.model !== requestedModel ||
            !Number.isFinite(assessmentResult.elapsedMs) ||
            assessmentResult.elapsedMs < 0 ||
            !Number.isSafeInteger(assessmentResult.imageCount) ||
            assessmentResult.imageCount < 0 ||
            !Object.prototype.hasOwnProperty.call(decisions, assessment?.decision) ||
            !Array.isArray(assessment.categories) ||
            assessment.categories.some(
              (category) =>
                typeof category !== 'string' ||
                !Object.prototype.hasOwnProperty.call(AI_CATEGORY_LABELS, category),
            ) ||
            typeof assessment.reason !== 'string' ||
            assessment.reason.length > 1000
          )
            throw new Error('试审结果无效，请刷新后重试。');
          result.append(
            node('h4', decisions[assessment.decision]),
            node(
              'p',
              `模型：${assessmentResult.model} · 耗时：${(assessmentResult.elapsedMs / 1000).toFixed(1)} 秒`,
              'moderation-meta',
            ),
            node(
              'p',
              `本次发送：${inputMode === 'redacted' ? '本地脱敏后的文字副本' : '虚构原文（仅测试）'}`,
            ),
            node(
              'p',
              `风险分类：${assessment.categories.length ? assessment.categories.map((category) => AI_CATEGORY_LABELS[category]).join('、') : '未列出风险类别'}`,
            ),
            node('pre', assessment.reason, 'moderation-raw'),
          );
          if (assessmentResult.imageCount > 0 || submission.attachments?.length)
            result.append(
              node('p', '图片尚未机器审核，请继续人工检查全部图片。', 'moderation-privacy-warning'),
            );
          result.append(
            node('p', '试审仅提供文字建议，原稿未修改，也不会自动发布。最终由审核负责人决定。'),
          );
          status.textContent = '文字试审已完成。';
        } catch (error) {
          if (responseCurrent()) {
            result.replaceChildren();
            status.textContent =
              error.status === 409
                ? '提交状态或版本已变化，请刷新后核对。'
                : `${error.message} 如需再次调用，请手动重试。`;
          }
        } finally {
          busy = false;
          button.disabled = loadingModels || !modelIds.size;
          retryModels.disabled = false;
        }
      });
      panel.append(
        node('h3', '无问芯穹试审（文字）'),
        node('p', '本轮仅用于虚构测试内容。点击后调用外部模型；图片不发送，风险建议仍需人工复核。'),
        modelLabel,
        model,
        modelStatus,
        retryModels,
        label,
        mode,
        button,
        status,
        result,
      );
      loadModels();
      return { panel, invalidate };
    }

    function privacyPreviewPanel(submission, generation, version) {
      const panel = node('section', undefined, 'moderation-privacy');
      panel.setAttribute('aria-label', '本地脱敏预览');
      const label = node('label', '补充需要隐藏的信息（可选，每行一项）');
      label.htmlFor = 'moderation-privacy-terms';
      const terms = node('textarea');
      terms.id = 'moderation-privacy-terms';
      terms.maxLength = 6500;
      terms.rows = 3;
      terms.placeholder = '例如遗漏的姓名、宿舍号；最多 50 项，每项最多 128 字';
      terms.autocomplete = 'off';
      terms.spellcheck = false;
      const button = node('button', '生成本地脱敏预览');
      button.type = 'button';
      const status = node('p');
      status.setAttribute('role', 'status');
      const result = node('div', undefined, 'moderation-privacy-result');
      let previewVersion = 0;
      let busy = false;
      const ai =
        state.session.aiTestEnabled === true
          ? aiTestPanel(submission, generation, version, terms)
          : null;
      const current = () =>
        valid(generation) && version === state.detailVersion && state.selected === submission;
      terms.addEventListener('input', () => {
        previewVersion += 1;
        result.replaceChildren();
        status.textContent = '补充信息已变化，请重新生成预览。';
        ai?.invalidate();
      });
      button.addEventListener('click', async () => {
        if (busy || !current()) return;
        const extraTerms = terms.value
          .split(/\r?\n/)
          .map((term) => term.trim())
          .filter(Boolean);
        if (extraTerms.length > 50 || extraTerms.some((term) => term.length > 128)) {
          status.textContent = '最多填写 50 项，每项最多 128 字。';
          return;
        }
        previewVersion += 1;
        const requestVersion = previewVersion;
        busy = true;
        button.disabled = true;
        result.replaceChildren();
        status.textContent = '正在本地处理，未发送给 AI…';
        try {
          const { preview } = await client.request(
            `/moderation/submissions/${encodeURIComponent(submission.id)}/privacy-preview`,
            {
              method: 'POST',
              body: JSON.stringify({ expectedVersion: submission.version, extraTerms }),
            },
          );
          if (!current() || requestVersion !== previewVersion) return;
          if (
            preview?.mode !== 'local_preview' ||
            preview.externalReady !== false ||
            preview.submissionId !== submission.id ||
            preview.version !== submission.version ||
            typeof preview.title !== 'string' ||
            typeof preview.content !== 'string'
          )
            throw new Error('预览结果无效，请刷新后重试。');
          const captions = {
            name: '姓名',
            studentId: '学号',
            phone: '电话',
            email: '邮箱',
            address: '地址',
            identifier: '证件或编号',
            nationalId: '身份证号',
            url: '链接',
            link: '链接',
            attachment: '图片地址',
            custom: '补充信息',
          };
          const counts = Object.entries(captions).flatMap(([key, caption]) => {
            const count = preview.counts?.[key];
            return Number.isSafeInteger(count) && count > 0 ? [`${caption} ${count} 处`] : [];
          });
          result.append(
            node('h4', '处理后的标题'),
            node('pre', preview.title || '（评论无标题）', 'moderation-raw'),
          );
          result.append(node('h4', '处理后的正文'), node('pre', preview.content, 'moderation-raw'));
          result.append(
            node(
              'p',
              counts.length
                ? `已替换：${counts.join('；')}。`
                : '未命中当前规则；这不代表内容没有隐私信息。',
            ),
          );
          if (Number.isSafeInteger(preview.imageCount) && preview.imageCount > 0)
            result.append(
              node('p', `包含 ${preview.imageCount} 张图片，图片内信息尚未处理，请继续人工检查。`),
            );
          result.append(
            node(
              'p',
              '未知姓名、变形的身份信息和图片内隐私仍可能遗漏。预览不能作为允许外发或审核通过的依据。',
              'moderation-privacy-warning',
            ),
          );
          status.textContent = '预览已生成，仅在本地处理。原稿未修改，也未发送给 AI。';
        } catch (error) {
          if (current() && requestVersion === previewVersion) {
            result.replaceChildren();
            status.textContent =
              error.status === 409
                ? '提交状态或版本已变化，或当前稿件无法生成预览，请刷新后核对。'
                : error.message;
          }
        } finally {
          busy = false;
          button.disabled = false;
        }
      });
      panel.append(
        node('h3', '本地脱敏预览'),
        node(
          'p',
          '检查姓名、学号、联系方式等信息的替换效果。此步骤不调用 AI，不修改原稿；补充信息和预览不另行保存。',
        ),
        label,
        terms,
        button,
        status,
        result,
      );
      if (ai) panel.append(ai.panel);
      return panel;
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
          el('detail').append(privacyPreviewPanel(submission, generation, version));
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
