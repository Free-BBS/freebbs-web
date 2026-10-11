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
    self_harm: '自伤教唆与危险传播',
    sexual_minors: '旧版未成年人性风险',
    sexual_content: '色情及不当性内容',
    violence: '暴力',
    fraud: '诈骗',
    illegal_activity: '违法活动',
    hate: '仇恨歧视',
    misinformation: '不实信息',
    political_compliance: '政治与公共议题合规',
    other: '旧版其他',
  };
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  // Read-only labels for historical evidence. These do not add old IDs to the current rules.
  const LEGACY_RULE_LABELS = {
    'EXP-001': '旧版表达保护-001',
    'PRI-001': '隐私-001',
    'PRI-002': '隐私-002',
    'PRI-003': '隐私-003',
    'PRI-004': '隐私-004',
    'HAR-001': '骚扰-001',
    'HAR-002': '骚扰-002',
    'THR-001': '威胁-001',
    'HAT-001': '仇恨-001',
    'SEX-001': '未成年保护-001',
    '未成年保护-001': '未成年保护-001',
    'SEX-002': '色情-001',
    'VIO-001': '暴力-001',
    'FRA-001': '诈骗-001',
    'ILL-001': '违法交易-001',
    'MIS-001': '虚假信息-001',
    'MIS-002': '虚假信息-002',
    'POL-001': '政治内容-001',
    'POL-002': '政治内容-002',
    'POL-003': '政治内容-003',
    'MEN-001': '旧版普通求助-001',
    'MEN-002': '关怀-001',
    'MEN-003': '关怀-002',
    'MEN-004': '自伤教唆-001',
    'MEN-005': '危险诊疗-001',
    'SYS-001': '旧版指令隔离-001',
    'GEN-001': '旧版人工核查-001',
  };
  function ruleDisplayId(id, historical = false) {
    return LEGACY_RULE_LABELS[id] || historical
      ? `${LEGACY_RULE_LABELS[id] || id}（历史版本）`
      : id;
  }

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
        if (token !== getToken()) throw new Error('登录状态已变化，请刷新页面。');
        const error = new Error(payload.message || '请求失败，请稍后重试。');
        error.status = response.status;
        if ([502, 504].includes(response.status) && payload.reviewResult)
          error.reviewResult = payload.reviewResult;
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
      imageReadyListeners: [],
      nextCursor: '',
      count: 0,
      library: null,
      policyVersion: 0,
      refreshHistory: null,
      automationChanging: false,
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
      state.refreshHistory = null;
      state.imagesReady = false;
      state.imageReadyListeners = [];
      el('detail').replaceChildren(node('p', '选择一条提交，查看正文和图片。', 'moderation-empty'));
    }
    function formatTime(value) {
      const date = new Date(value);
      return value && !Number.isNaN(date.getTime()) ? date.toLocaleString('zh-CN') : '';
    }
    function reset() {
      state.generation += 1;
      state.session = null;
      state.automationChanging = false;
      el('automation').hidden = true;
      el('automation-toggle').hidden = true;
      el('automation-toggle').disabled = false;
      el('automation-message').textContent = '';
      el('image-queue').hidden = true;
      el('queue-note').textContent =
        '机器建议不直接改变发布状态。请核对完整正文与图片，再作出人工决定。';
      clearDetail();
      el('list').replaceChildren();
      el('more').hidden = true;
      state.nextCursor = '';
      state.count = 0;
      el('reviewer-list').replaceChildren();
      el('candidates').replaceChildren();
      el('reviewer-query').value = '';
      el('reviewer-message').textContent = '';
      state.library = null;
      state.policyVersion += 1;
      el('policy-list').replaceChildren();
      el('policy-support-list').replaceChildren();
      el('policy-principles').replaceChildren();
      el('policy-status').textContent = '';
      el('export-status').textContent = '';
      el('regression-export').disabled = true;
      el('policy-library').hidden = true;
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
          if (valid(generation) && version === state.detailVersion) {
            state.imagesReady = false;
            state.imageReadyListeners.forEach((update) => update());
          }
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

    const DECISION_LABELS = {
      no_risk_detected: '未发现明确禁止内容',
      needs_review: '需要人工核查',
      high_risk: '高风险迹象',
    };
    const SUPPORT_LABELS = { none: '无特别提示', attention: '优先关怀', urgent: '紧急关注' };
    const ACTION_LABELS = {
      allow: '建议通过',
      hold: '建议暂缓发布',
      human_review: '建议人工核查',
      block: '建议拦截',
    };
    const FAILURE_LABELS = {
      configuration_invalid: '审核渠道配置不符合要求',
      input_invalid: '送审输入不符合要求',
      model_unavailable: '所选模型不可用',
      http_error: '模型渠道请求未成功',
      transport_error: '模型渠道连接失败',
      timeout: '模型渠道请求超时',
      response_redirected: '模型响应地址不符合要求',
      response_body_invalid: '模型响应内容无法读取',
      response_type_invalid: '模型响应类型不符合要求',
      response_too_large: '模型响应超过大小限制',
      response_utf8_invalid: '模型响应编码不符合要求',
      response_json_invalid: '模型响应格式无法解析',
      response_envelope_invalid: '模型响应结构不符合要求',
      message_invalid: '模型消息结构不符合要求',
      finish_reason_not_stop: '模型返回的结束状态不符合要求',
      content_json_invalid: '模型审核内容不是有效的结构化结果',
      assessment_fields_invalid: '模型审核字段或取值不符合要求',
      rule_evidence_invalid: '模型规则证据未通过校验',
      rule_unknown: '模型选择了规则库之外的条目',
      category_rule_mismatch: '模型风险类别与所选规则不对应',
      support_rule_mismatch: '模型关怀等级与所选规则不对应',
      high_risk_without_block: '模型报告高风险，但所选规则不支持直接拦截',
      image_observations_invalid: '图片观察记录的结构或序号不符合要求',
    };
    const AUTOMATION_REASON_LABELS = {
      submission_changed: '提交已由人工处理、发生变化或到期，自动任务不再改变发布状态。',
      no_reviewers: '当前缺少可用负责人，稿件保留待审。',
      worker_paused: '自动审核已暂停或控制状态变化，本次转人工处理。',
      worker_stopped: '自动审核服务已停止，本次转人工处理。',
      lease_expired: '任务执行已超时或被中断，保留人工审核，不自动重发模型请求。',
      policy_review: '规则建议或结果校验要求人工复核。',
      clear_rule_violation: '存在明确禁止内容的规则依据，先暂时拦截，由负责人最终决定。',
      no_text_risk: '文字结果符合自动发布条件，已发布并通知负责人。',
      support_requires_review: '有需要关注的关怀提示，由负责人跟进；关怀需求不等于违规。',
      images_not_reviewed: '图片尚未完成机器审核，整份稿件交人工检查。',
      image_requires_review: '稿件含图片，首版未调用外部模型，交负责人检查文字及全部图片。',
      provider_failure: '模型未返回可用结果，保留人工审核。',
      configuration_invalid: '审核渠道配置不可用，保留人工审核。',
      snapshot_invalid: '送审内容未能完成校验，未发送给外部模型，交人工处理。',
      assessment_invalid: '机器结果未通过校验，交人工复核。',
      reviewer_withdrawal: '负责人已撤回自动发布内容。',
      no_image_risk: '图文结果符合发布条件，已发布并进入图片待复核队列。',
      political_requires_review: '政治敏感相关内容须负责人单独审核。',
      psychological_requires_review: '心理问题或求助信号须负责人关注；心理关怀不等于违规。',
    };

    function isReviewResult(run) {
      return Boolean(
        run &&
        run.assessment === null &&
        Array.isArray(run.policyEvidence) &&
        run.policyEvidence.length === 0 &&
        run.policyDecision?.recommendedAction === 'hold' &&
        run.policyDecision.canAutomaticallyPublish === false &&
        run.policyDecision.imagesReviewed === false &&
        run.manualReview?.required === true &&
        run.manualReview.validation === 'failed' &&
        run.manualReview.diagnostics?.version === 1 &&
        Object.prototype.hasOwnProperty.call(
          FAILURE_LABELS,
          run.manualReview.diagnostics.failureCode,
        ),
      );
    }

    function manualReviewPanel(run) {
      const panel = node('div', undefined, 'moderation-outcome moderation-outcome-hold');
      panel.append(
        node('h4', '模型提示待人工复核'),
        node('p', '输出未通过校验，不能作为有效结论。请负责人结合原稿和当前规则独立复核。'),
        node('p', '本次失败结果须人工复核，不能据此自动发布或认定违规。'),
      );
      const diagnostics = run.manualReview?.diagnostics;
      const signal =
        isReviewResult(run) && diagnostics.reviewSignal?.version === 1
          ? diagnostics.reviewSignal
          : null;
      const reportedDecisions = {
        no_risk_detected: '未报告明确风险（未经校验，不能据此放行）',
        needs_review: '需要人工核查（尚未核实）',
        high_risk: '高风险迹象（尚未核实）',
      };
      const decision =
        signal && Object.prototype.hasOwnProperty.call(reportedDecisions, signal.reportedDecision)
          ? reportedDecisions[signal.reportedDecision]
          : '';
      const categories = Array.isArray(signal?.reportedCategories)
        ? [
            ...new Set(
              signal.reportedCategories
                .slice(0, 64)
                .filter((id) => currentCategoryEntries().some(([value]) => value === id)),
            ),
          ].slice(0, 20)
        : [];
      const rules = Array.isArray(signal?.reportedRuleIds)
        ? [
            ...new Set(
              signal.reportedRuleIds
                .slice(0, 64)
                .filter((id) => state.library?.rules.some((rule) => rule.id === id)),
            ),
          ].slice(0, 6)
        : [];
      const support =
        signal &&
        Object.prototype.hasOwnProperty.call(SUPPORT_LABELS, signal.reportedSupportPriority)
          ? SUPPORT_LABELS[signal.reportedSupportPriority]
          : '';
      if (!decision && !categories.length && !rules.length && !support)
        panel.append(node('p', '未取得可用判断，请直接人工审核原稿。'));
      else {
        panel.append(node('p', '以下仅为模型上报提示，尚未核实；不代表规则已经适用。'));
        panel.append(
          node('p', `模型上报等级：${decision || '未知'}`),
          node(
            'p',
            `模型上报类别（尚未核实）：${categories.length ? categories.map((id) => AI_CATEGORY_LABELS[id]).join('、') : '未保留已知类别，不代表没有风险'}`,
          ),
          node(
            'p',
            `模型上报规则（尚未核实）：${rules.length ? rules.join('、') : '未保留已知规则，不代表没有违规'}`,
          ),
          node('p', `模型上报关怀：${support ? `${support}（尚未核实）` : '未知'}`),
        );
      }
      const failureLabel = isReviewResult(run)
        ? FAILURE_LABELS[diagnostics.failureCode]
        : '审核结果未通过校验';
      panel.append(node('p', `待复核原因：${failureLabel}。`));
      const imageDiagnostics = run.manualReview?.imageDiagnostics;
      if (imageDiagnostics && Object.hasOwn(FAILURE_LABELS, imageDiagnostics.failureCode)) {
        const checks = {
          object_keys: '字段缺失或出现多余字段',
          type: '字段类型不符合要求',
          count: '记录数量不符合要求',
          index: '图片序号不符合要求',
          text: '文字长度或格式不符合要求',
          source_field: '引用来源不符合要求',
          quote_not_present: '引用不是对应原文中的连续片段',
          duplicate_rule: '规则重复',
          assessment_contract: '审核结论未通过校验',
        };
        const issue = Object.hasOwn(checks, imageDiagnostics.validation?.issue)
          ? checks[imageDiagnostics.validation.issue]
          : '';
        panel.append(
          node('h4', '图片结果检查未通过'),
          node('p', FAILURE_LABELS[imageDiagnostics.failureCode]),
        );
        if (issue) panel.append(node('p', `具体问题：${issue}。`));
        panel.append(node('p', '不将无效结果视为安全；请负责人检查全部原图。'));
      }
      panel.append(
        node(
          'p',
          imageDiagnostics
            ? '图片结果未通过校验，请继续人工检查附件。'
            : run.imagesReviewed === true
              ? '图片已完成机器检查，请负责人继续核查附件。'
              : '图片尚未机器审核，请继续人工检查附件。',
          'moderation-note',
        ),
      );
      return panel;
    }

    function disclosure(title, className) {
      const details = node('details', undefined, className || 'moderation-disclosure');
      details.append(node('summary', title));
      return details;
    }

    function field(labelText, control, id) {
      control.id = id;
      const label = node('label', labelText);
      label.htmlFor = id;
      const group = node('div', undefined, 'moderation-field');
      group.append(label, control);
      return group;
    }

    function selectControl(entries, value) {
      const select = node('select');
      for (const [key, caption] of Object.entries(entries)) {
        const option = node('option', caption);
        option.value = key;
        select.append(option);
      }
      select.value = value || Object.keys(entries)[0];
      return select;
    }

    function safeSourceLink(source) {
      let parsed;
      try {
        parsed = new URL(source.url);
      } catch {
        return node('span', source.title || '来源待核对');
      }
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password)
        return node('span', source.title || '来源待核对');
      const link = node('a', source.title || parsed.hostname);
      link.href = parsed.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      return link;
    }

    function ruleCard(rule, sourceList = [], historical = false) {
      const card = node('article', undefined, 'moderation-rule-card');
      const isHistorical = historical || Boolean(LEGACY_RULE_LABELS[rule.id || rule.ruleId]);
      card.append(
        node('p', ruleDisplayId(rule.id || rule.ruleId || '', isHistorical), 'moderation-rule-id'),
        node('h4', rule.title || '规则依据'),
      );
      const info = [
        rule.kind === 'support' || rule.supportOnly
          ? '心理支持（不属于违规）'
          : AI_CATEGORY_LABELS[rule.category] || rule.category,
        rule.kind === 'support' || rule.supportOnly
          ? SUPPORT_LABELS[rule.supportPriority]
          : ACTION_LABELS[rule.recommendedAction],
      ].filter(Boolean);
      if (info.length) card.append(node('p', info.join(' · '), 'moderation-meta'));
      if (isHistorical)
        card.append(
          node(
            'p',
            '这是当时使用的历史依据，保留用于追溯；不作为当前禁止清单中的条目。原始编号和数据保留在结构化 JSON 中。',
            'moderation-note',
          ),
        );
      if (rule.kind === 'support' || rule.supportOnly)
        card.append(node('p', '支持与关怀规则：适用本条不表示违规。', 'moderation-note'));
      if (rule.kind === 'prohibition' && rule.recommendedAction === 'human_review')
        card.append(
          node(
            'p',
            '疑似符合禁止情形时先交负责人核实；未经核实不自动判定违规。',
            'moderation-note',
          ),
        );
      if (rule.basisType)
        card.append(
          node(
            'p',
            `本站规则性质：${{ legal_requirement: '法律合规要求', community_rule: '社区治理规则', support_guidance: '支持性指南' }[rule.basisType] || rule.basisType}。需结合条件和例外判断。`,
            'moderation-note',
          ),
        );
      let conditionCaptions = isHistorical
        ? ['当时的适用条件', '当时的例外与保护']
        : ['禁止发布的内容', '不应据此禁止的情况'];
      let exampleCaptions = isHistorical
        ? ['历史规则示例', '历史规则对照示例']
        : ['禁止情形示例', '不因本条禁止的示例'];
      if (rule.kind === 'support' || rule.supportOnly) {
        conditionCaptions = ['需要关怀的信号', '不据此触发关怀的情况'];
        exampleCaptions =
          {
            none: ['正常求助与康复分享', '需要进一步判断支持级别的情况'],
            attention: ['需要关注与支持的情况', '不按本条列为关注的情况'],
            urgent: ['需要紧急关怀的情况', '不按本条列为紧急的情况'],
          }[rule.supportPriority] || exampleCaptions;
      }
      for (const [key, caption] of [
        ['conditions', conditionCaptions[0]],
        ['exceptions', conditionCaptions[1]],
        ['positiveExample', exampleCaptions[0]],
        ['negativeExample', exampleCaptions[1]],
      ]) {
        const value = rule[key];
        if (value && (!Array.isArray(value) || value.length)) {
          card.append(
            node('strong', caption),
            node('p', Array.isArray(value) ? value.join('；') : value),
          );
        }
      }
      const sources = sourceList.filter((source) => rule.sourceIds?.includes(source.id));
      if (sources.length) {
        const list = node('ul', undefined, 'moderation-source-list');
        for (const source of sources) {
          const item = node('li');
          item.append(safeSourceLink(source));
          const article = rule.sourceArticles?.[source.id] || source.article;
          if (article) item.append(node('span', ` · ${article}`));
          if (source.authorityType)
            item.append(
              node(
                'span',
                ` · ${{ law: '法律', regulation: '行政法规或规章', official_guidance: '官方指南', health_guidance: '健康支持指南', support_guidance: '支持性指南', community_rule: '本站规则', technical_reference: '技术参考' }[source.authorityType] || source.authorityType}`,
              ),
            );
          list.append(item);
        }
        card.append(list);
      }
      return card;
    }

    function renderPolicies() {
      if (!state.library) return;
      const queryText = el('policy-query').value.trim().toLowerCase();
      const category = el('policy-category').value;
      const prohibitions = state.library.rules.filter((rule) => rule.kind === 'prohibition');
      const rules = prohibitions.filter(
        (rule) =>
          (!category || rule.category === category) &&
          (!queryText || JSON.stringify(rule).toLowerCase().includes(queryText)),
      );
      el('policy-list').replaceChildren(
        ...rules.map((rule) => {
          const details = disclosure(`${rule.id} · ${rule.title}`, 'moderation-rule-disclosure');
          details.append(ruleCard(rule, state.library.sources));
          return details;
        }),
      );
      el('policy-status').textContent =
        `清单版本 ${state.library.version} · 资料核对 ${state.library.checkedAt || '待确认'} · 显示 ${rules.length} / ${prohibitions.length} 条禁止条目`;
      if (!rules.length)
        el('policy-list').append(
          node('p', '没有匹配的禁止条目。心理关怀提示请查看下方独立区域。', 'moderation-empty'),
        );
      el('policy-support-list').replaceChildren(
        ...state.library.rules
          .filter((rule) => rule.kind === 'support')
          .map((rule) => ruleCard(rule, state.library.sources)),
      );
      el('policy-principles').replaceChildren(
        ...(state.library.principles || []).map((principle) =>
          node(
            'p',
            typeof principle === 'string'
              ? principle
              : `${principle.title || ''} ${principle.description || principle.text || ''}`,
          ),
        ),
      );
    }

    function currentCategoryEntries() {
      const categories = Array.isArray(state.library?.categories)
        ? state.library.categories
        : (state.library?.rules || []).map((rule) => rule.category);
      return [...new Set(categories)]
        .filter((value) => typeof value === 'string' && value)
        .map((value) => [value, AI_CATEGORY_LABELS[value] || value]);
    }

    async function loadPolicies() {
      if (mine || !state.session?.reviewer) return;
      const generation = state.generation;
      state.policyVersion += 1;
      const version = state.policyVersion;
      state.library = null;
      el('policy-list').replaceChildren();
      el('policy-support-list').replaceChildren();
      el('policy-principles').replaceChildren();
      el('regression-export').disabled = true;
      state.refreshHistory?.();
      el('policy-status').textContent = '正在加载规则依据…';
      try {
        const { library } = await client.request('/moderation/policies');
        if (
          !valid(generation) ||
          version !== state.policyVersion ||
          mine ||
          !state.session?.reviewer
        )
          return;
        if (!library || !Array.isArray(library.rules) || !Array.isArray(library.sources))
          throw new Error('规则库格式无效。');
        if (library.rules.some((rule) => !rule || !['prohibition', 'support'].includes(rule.kind)))
          throw new Error('后端尚未加载中文禁止清单，请重启测试后端并刷新。');
        state.library = library;
        el('regression-export').disabled = state.session?.aiTestEnabled !== true;
        const selected = el('policy-category').value;
        el('policy-category').replaceChildren(
          ...[['', '全部类别'], ...currentCategoryEntries()].map(([value, label]) => {
            const option = node('option', label);
            option.value = value;
            return option;
          }),
        );
        el('policy-category').value = currentCategoryEntries().some(([value]) => value === selected)
          ? selected
          : '';
        renderPolicies();
        state.refreshHistory?.();
      } catch (error) {
        if (valid(generation) && version === state.policyVersion)
          el('policy-status').textContent = `规则依据未能加载：${error.message}`;
      }
    }

    function policyResultPanels(run) {
      if (run.manualReview?.validation === 'not_attempted') {
        const panel = node('div', undefined, 'moderation-outcome moderation-outcome-hold');
        panel.append(
          node('h4', '未调用模型 · 保留人工审核'),
          node(
            'p',
            AUTOMATION_REASON_LABELS[run.automationReason] ||
              '此任务未取得机器审核结论，请负责人检查原稿。',
          ),
        );
        return panel;
      }
      if (!run.assessment || run.manualReview?.validation === 'failed')
        return manualReviewPanel(run);
      const group = node('div', undefined, 'moderation-policy-result');
      const assessment = run.assessment || {};
      const historical = Boolean(
        state.library && run.policyVersion && run.policyVersion !== state.library.version,
      );
      if (historical)
        group.append(
          node(
            'p',
            '历史版本结果：仅用于追溯当时判断，不能替代按当前禁止清单复核。',
            'moderation-privacy-warning',
          ),
        );
      if (run.policyDecision) {
        const action = run.policyDecision.recommendedAction;
        const banner = node(
          'div',
          undefined,
          `moderation-outcome moderation-outcome-${['allow', 'hold', 'block'].includes(action) ? action : 'hold'}`,
        );
        banner.append(
          node('p', '本地规则建议', 'moderation-eyebrow'),
          node('h4', ACTION_LABELS[action] || '交人工核查'),
          node('p', '以下为规则建议；实际处置请查看提交状态及自动审核记录。'),
        );
        const support = run.policyDecision.supportPriority || assessment.supportPriority;
        if (support && support !== 'none')
          banner.append(
            node(
              'p',
              `支持优先级：${SUPPORT_LABELS[support] || support}。关怀需求与是否违规分别判断。`,
            ),
          );
        for (const reason of run.policyDecision.reasonLabels || [])
          banner.append(node('p', reason));
        group.append(banner);
      }
      const evidence = disclosure('风险证据与规则依据');
      if (assessment.supportReason)
        evidence.append(node('p', `支持判断：${assessment.supportReason}`));
      for (const match of assessment.ruleMatches || []) {
        const item = node('article', undefined, 'moderation-evidence');
        item.append(
          node('strong', ruleDisplayId(match.ruleId, historical)),
          node('blockquote', match.evidence?.quote || ''),
          node('p', match.explanation || ''),
        );
        evidence.append(item);
      }
      if (!assessment.ruleMatches?.length)
        evidence.append(
          node(
            'p',
            '本次未列出适用的具体规则。不得据此认定原稿或图片均无风险。',
            'moderation-note',
          ),
        );
      const policyEvidence = Array.isArray(run.policyEvidence) ? run.policyEvidence : [];
      for (const entry of policyEvidence) {
        const rule = entry.rule || entry;
        evidence.append(ruleCard(rule, entry.sources || state.library?.sources || [], historical));
      }
      for (const uncertainty of assessment.uncertainties || [])
        evidence.append(node('p', `待核查：${uncertainty}`, 'moderation-privacy-warning'));
      const raw = disclosure('结构化 JSON');
      raw.append(
        node('p', '仅展示本次审核的结构化结果；不含 API 密钥和供应商原始响应。', 'moderation-note'),
        node(
          'pre',
          JSON.stringify(
            {
              model: run.model,
              policyVersion: run.policyVersion,
              assessment: run.assessment,
              policyDecision: run.policyDecision,
              policyEvidence: run.policyEvidence,
            },
            null,
            2,
          ),
          'moderation-json',
        ),
      );
      group.append(evidence, raw);
      return group;
    }

    function feedbackPanel(submission, run, current, refresh) {
      const wrapper = disclosure('人工复核与回归样例');
      const form = node('form', undefined, 'moderation-feedback-form');
      const currentPolicyVersion = state.library.version;
      const historical = run.policyVersion !== currentPolicyVersion;
      const failed = !run.assessment || run.manualReview?.validation === 'failed';
      const previousFeedback =
        run.feedback?.policyVersion === currentPolicyVersion ? run.feedback : null;
      const initial =
        previousFeedback ||
        (failed
          ? { decision: '', categories: [], supportPriority: 'none' }
          : historical
            ? { decision: 'needs_review', categories: [], supportPriority: 'none' }
            : run.assessment) ||
        {};
      const initialRuleIds =
        previousFeedback?.ruleIds ||
        (historical || failed
          ? []
          : (run.assessment?.ruleMatches || []).map((match) => match.ruleId));
      const canWrite = () =>
        current() &&
        state.session?.aiTestEnabled === true &&
        state.library?.version === currentPolicyVersion;
      const verdictOptions = failed
        ? { correct: '记录独立人工判断', escalate: '升级人工核查' }
        : historical
          ? { correct: '按当前清单重新复核', escalate: '升级人工核查' }
          : { agree: '同意机器判断', correct: '纠正机器判断', escalate: '升级人工核查' };
      const verdict = selectControl(
        verdictOptions,
        failed || historical
          ? previousFeedback?.verdict === 'escalate'
            ? 'escalate'
            : 'correct'
          : previousFeedback?.verdict || 'agree',
      );
      const decision = selectControl(
        failed ? { '': '请选择人工风险判断', ...DECISION_LABELS } : DECISION_LABELS,
        initial.decision,
      );
      const support = selectControl(SUPPORT_LABELS, initial.supportPriority || 'none');
      const categories = node('fieldset', undefined, 'moderation-category-options');
      categories.append(node('legend', '人工确认的风险类别'));
      const checks = currentCategoryEntries().map(([value, label]) => {
        const input = node('input');
        input.type = 'checkbox';
        input.value = value;
        input.checked = initial.categories?.includes(value) || false;
        const option = node('label');
        option.append(input, node('span', label));
        categories.append(option);
        return input;
      });
      const rules = node('input');
      rules.type = 'text';
      rules.maxLength = 1000;
      rules.value = initialRuleIds.join(', ');
      rules.placeholder = '例如：隐私-001，骚扰-001；最多 6 项';
      const note = node('textarea');
      note.rows = 3;
      note.maxLength = 1000;
      note.value = previousFeedback?.note || '';
      note.placeholder = '记录改判依据或需要进一步核实的事项，避免重复个人信息。';
      const status = node('p');
      status.setAttribute('role', 'status');
      const save = node('button', '保存人工复核记录');
      save.type = 'submit';
      const prefix = `moderation-feedback-${run.id}`;
      const ruleIds = () =>
        rules.value
          .split(/[,，\n]/)
          .map((value) => value.trim())
          .filter(Boolean);
      const categoryIds = () => checks.filter((input) => input.checked).map((input) => input.value);
      let feedbackIntent = null;
      let regressionIntent = null;
      const requestBody = (body, previous) => {
        const key = JSON.stringify(body);
        return previous?.key === key
          ? previous
          : { key, body: { ...body, requestId: cryptoApi.randomUUID() } };
      };
      const sameValues = (first, second) =>
        JSON.stringify([...first].sort()) === JSON.stringify([...second].sort());
      form.append(
        node('p', '复核记录会保存到本条试审历史；不会改变帖子的发布状态。', 'moderation-note'),
        node(
          'p',
          previousFeedback
            ? `已载入按当前清单保存的人工判断。${failed || historical ? '原机器结果不提供直接同意操作。' : '选择“同意机器判断”表示与最初机器结果完全一致。'}`
            : failed
              ? '模型输出未通过校验，请主动选择人工判断并填写依据；模型提示未自动填入复核结论。'
              : historical
                ? '这条机器结果使用历史版本。请按当前禁止清单完整重新复核；旧分类和旧编号未自动填入。'
                : '尚未保存人工复核；当前字段来自机器判断。',
          'moderation-note',
        ),
        field('复核结论', verdict, `${prefix}-verdict`),
        field('人工风险判断', decision, `${prefix}-decision`),
        field('支持优先级', support, `${prefix}-support`),
        categories,
        field('适用条目编号（中文）', rules, `${prefix}-rules`),
        field('复核说明', note, `${prefix}-note`),
        save,
        status,
      );
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (save.disabled || !canWrite()) return;
        if (ruleIds().length > 6) {
          status.textContent = '最多选择 6 条适用规则。';
          return;
        }
        if (!Object.prototype.hasOwnProperty.call(verdictOptions, verdict.value)) {
          status.textContent = '此结果不能直接同意，请按当前禁止清单独立复核。';
          return;
        }
        if (!Object.prototype.hasOwnProperty.call(DECISION_LABELS, decision.value)) {
          status.textContent = '请主动选择人工风险判断。';
          return;
        }
        if (ruleIds().some((id) => !state.library.rules.some((rule) => rule.id === id))) {
          status.textContent = '请填写当前清单中的中文编号；历史编号不能用于新的复核。';
          return;
        }
        if (decision.value === 'needs_review' && !categoryIds().length && !note.value.trim()) {
          status.textContent = '未对应具体禁止类别时，请在复核说明中写明需要核查的事项。';
          return;
        }
        if (verdict.value !== 'agree' && !note.value.trim()) {
          status.textContent = '纠正或升级核查时，请填写复核说明。';
          return;
        }
        if (
          verdict.value === 'agree' &&
          (decision.value !== run.assessment?.decision ||
            support.value !== (run.assessment?.supportPriority || 'none') ||
            !sameValues(categoryIds(), run.assessment?.categories || []) ||
            !sameValues(
              ruleIds(),
              (run.assessment?.ruleMatches || []).map((match) => match.ruleId),
            ))
        ) {
          status.textContent = '你已修改判断，请将复核结论改为“纠正机器判断”或“升级人工核查”。';
          return;
        }
        save.disabled = true;
        status.textContent = '正在保存复核记录…';
        try {
          feedbackIntent = requestBody(
            {
              verdict: verdict.value,
              decision: decision.value,
              categories: categoryIds(),
              ruleIds: ruleIds(),
              supportPriority: support.value,
              note: note.value.trim(),
            },
            feedbackIntent,
          );
          await client.request(
            `/moderation/submissions/${encodeURIComponent(submission.id)}/ai-runs/${encodeURIComponent(run.id)}/feedback`,
            {
              method: 'POST',
              body: JSON.stringify(feedbackIntent.body),
            },
          );
          if (!current()) return;
          status.textContent = '复核记录已保存。';
          await refresh();
        } catch (error) {
          if (current()) status.textContent = error.message;
        } finally {
          if (current()) save.disabled = false;
        }
      });
      const regression = disclosure('把此类问题改写为测试样例');
      const regressionForm = node('form', undefined, 'moderation-feedback-form');
      const title = node('input');
      title.maxLength = 120;
      const content = node('textarea');
      content.rows = 4;
      content.maxLength = 6000;
      content.required = true;
      const regressionReason = node('textarea');
      regressionReason.rows = 2;
      regressionReason.maxLength = 1000;
      regressionReason.required = true;
      const confirm = node('input');
      confirm.type = 'checkbox';
      confirm.required = true;
      const confirmLabel = node('label', undefined, 'moderation-check');
      confirmLabel.append(confirm, node('span', '我已手动改写为虚构样例，确认不含真实个人信息。'));
      const regressionSave = node('button', '保存虚构回归样例');
      regressionSave.type = 'submit';
      regressionSave.disabled = !previousFeedback;
      const regressionStatus = node('p');
      regressionStatus.setAttribute('role', 'status');
      regressionForm.append(
        node(
          'p',
          previousFeedback
            ? '标题和正文从空白开始。请重新编写同类问题的虚构样例；预期结果采用最近保存的人工判断。若修改上方判断，请先保存复核记录。'
            : '请先保存上方人工复核记录，再改写同类问题的虚构样例。标题和正文不会自动复制原稿。',
          'moderation-note',
        ),
        node(
          'p',
          '勾选确认不会自动匿名化。保存及导出的样例仍须人工检查，确保没有真实姓名、学号、地址、病史等信息。',
          'moderation-note',
        ),
        field('虚构标题（可选）', title, `${prefix}-synthetic-title`),
        field('虚构正文', content, `${prefix}-synthetic-content`),
        field('为什么预期这样判断', regressionReason, `${prefix}-synthetic-reason`),
        confirmLabel,
        regressionSave,
        regressionStatus,
      );
      regressionForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!canWrite() || regressionSave.disabled || !previousFeedback) return;
        if (
          decision.value !== previousFeedback.decision ||
          support.value !== previousFeedback.supportPriority ||
          !sameValues(categoryIds(), previousFeedback.categories || []) ||
          !sameValues(ruleIds(), previousFeedback.ruleIds || [])
        ) {
          regressionStatus.textContent =
            '上方判断尚有未保存的修改，请先保存人工复核记录，再创建回归样例。';
          return;
        }
        if (!confirm.checked || !content.value.trim() || !regressionReason.value.trim()) {
          regressionStatus.textContent = '请填写虚构正文和预期依据，并确认已去除真实个人信息。';
          return;
        }
        regressionSave.disabled = true;
        try {
          regressionIntent = requestBody(
            {
              title: title.value.trim(),
              content: content.value.trim(),
              expectedDecision: decision.value,
              categories: categoryIds(),
              ruleIds: ruleIds(),
              supportPriority: support.value,
              reason: regressionReason.value.trim(),
              syntheticConfirmed: true,
            },
            regressionIntent,
          );
          await client.request(
            `/moderation/submissions/${encodeURIComponent(submission.id)}/ai-runs/${encodeURIComponent(run.id)}/regression`,
            {
              method: 'POST',
              body: JSON.stringify(regressionIntent.body),
            },
          );
          if (current()) {
            regressionStatus.textContent = '虚构回归样例已保存，未调用外部模型。';
            regressionSave.disabled = true;
          }
        } catch (error) {
          if (current()) {
            regressionStatus.textContent = error.message;
            regressionSave.disabled = false;
          }
        }
      });
      regression.append(regressionForm);
      wrapper.append(form, regression);
      return wrapper;
    }

    function renderAutomationStatus() {
      const automation = state.session?.automation;
      const visible = !mine && state.session?.reviewer === true && Boolean(automation);
      el('automation').hidden = !visible;
      if (!visible) return;
      el('automation-summary').textContent =
        `${!automation.enabled ? '自动审核未启用' : automation.paused ? '自动审核已暂停 · 新稿排队待审' : '自动审核运行中'} · 文字模型：${automation.model || '未配置'} · 手动备选：${automation.backupModel || '未配置'} · 图片：${automation.imagesEnabled ? automation.imageModel || 'Kimi' : '未启用机器审核'}`;
      el('automation-toggle').hidden = !state.session.isAdmin || !automation.enabled;
      el('automation-toggle').disabled = state.automationChanging;
      el('automation-toggle').textContent = automation.paused ? '开启自动审核' : '暂停自动审核';
      el('queue-note').textContent = automation.enabled
        ? '含图自动发布稿件请在“图片待复核”中确认或撤回。暂停自动审核仍可处理复核；政治内容与心理关怀分别提示，须负责人审核。'
        : '机器建议不直接改变发布状态。请核对完整正文与图片，再作出人工决定。';
    }

    async function changeAutomation() {
      if (
        mine ||
        !state.session?.reviewer ||
        !state.session?.isAdmin ||
        !state.session?.automation?.enabled ||
        state.automationChanging
      )
        return;
      const generation = state.generation;
      const paused = !state.session.automation.paused;
      state.automationChanging = true;
      renderAutomationStatus();
      el('automation-message').textContent = '正在更新自动审核状态…';
      try {
        const payload = await client.request('/moderation/automation/control', {
          method: 'POST',
          body: JSON.stringify({ paused }),
        });
        if (!valid(generation)) return;
        if (
          typeof payload.automation?.enabled !== 'boolean' ||
          payload.automation.paused !== paused
        )
          throw new Error('自动审核状态未确认，请刷新页面后核对。');
        state.session.automation = payload.automation;
        el('automation-message').textContent = paused
          ? '已暂停自动审核。新稿继续排队，在途结果交人工处理。'
          : '已开启自动审核。请仅提交虚构测试内容；上线前已有稿件仍由人工处理。';
      } catch (error) {
        if (valid(generation)) el('automation-message').textContent = error.message;
      } finally {
        if (valid(generation)) {
          state.automationChanging = false;
          renderAutomationStatus();
        }
      }
    }

    function imageMachinePanels(result) {
      const group = node('section', undefined, 'moderation-image-results');
      group.append(node('h4', '图片机器审核'));
      (result.imageResults || []).forEach((batch, index) => {
        const run = batch.response || {};
        const display = run.displayAssessment;
        const item = node('article', undefined, 'moderation-image-result');
        item.append(
          node(
            'h4',
            `第 ${index + 1} 组 · ${run.model || '图片模型'} · ${batch.attachmentIds?.length || 0} 张图片`,
          ),
        );
        if (display) {
          item.append(node('p', display.reason || '请核查图片。'));
          for (const match of display.ruleMatches || [])
            item.append(node('p', `${ruleDisplayId(match.ruleId)}：${match.explanation || ''}`));
          for (const uncertainty of display.uncertainties || [])
            item.append(node('p', `待核查：${uncertainty}`, 'moderation-note'));
          if (display.supportReason) item.append(node('p', display.supportReason));
        } else item.append(node('p', '未取得可展示的脱敏说明，请负责人检查图片和受限原始证据。'));
        for (const observation of run.displayObservations || [])
          item.append(
            node('p', `本组图片 ${observation.imageIndex}：${observation.description || ''}`),
          );
        if (run.imageSafety?.requiresHumanReview)
          item.append(
            node('p', '图片关键信息无法可靠核查，必须人工检查。', 'moderation-privacy-warning'),
          );
        const raw = disclosure('受限原始 OCR 与引用证据（可能含个人资料）');
        raw.append(node('p', '仅供负责人核对，不应复制到公开通知。', 'moderation-note'));
        for (const observation of run.imageObservations || [])
          raw.append(
            node('h5', `本组图片 ${observation.imageIndex}`),
            node('pre', observation.text || '未识别出文字', 'moderation-raw'),
          );
        for (const match of run.assessment?.ruleMatches || [])
          raw.append(
            node('p', `${ruleDisplayId(match.ruleId)} · ${match.evidence?.field || ''}`),
            node('blockquote', match.evidence?.quote || ''),
          );
        item.append(raw);
        group.append(item);
      });
      return group;
    }

    function focusPanels(focus) {
      const group = node('div', undefined, 'moderation-review-focus');
      if (focus?.political) {
        const item = node('section', undefined, 'moderation-focus-political');
        item.append(
          node('h4', '政治敏感相关内容 · 须负责人审核'),
          node('p', '请单独核对内容、语境与规则依据；提示本身不等于已经违规。'),
        );
        group.append(item);
      }
      if (focus?.psychological) {
        const item = node('section', undefined, 'moderation-focus-psychological');
        item.append(
          node('h4', '心理问题与求助 · 负责人关怀复核'),
          node('p', '请优先关注并核实支持需求。心理关怀不等于违规，不因此处罚求助者。'),
        );
        group.append(item);
      }
      return group;
    }

    function automationPanel(submission, generation, version) {
      const panel = node('section', undefined, 'moderation-automation-result');
      panel.setAttribute('aria-label', '自动审核记录');
      const refreshButton = node('button', '刷新自动状态');
      refreshButton.type = 'button';
      const content = node('div');
      panel.append(node('h3', '自动审核记录'), refreshButton, content);
      const current = () =>
        valid(generation) &&
        version === state.detailVersion &&
        state.selected === submission &&
        !mine &&
        state.session?.reviewer === true;
      const labels = {
        queued: '排队待审',
        running: '机器审核中',
        review: '转人工复核',
        blocked: '机器暂时拦截 · 待负责人决定',
        published: '已自动发布',
        cancelled: '自动任务已取消',
        withdrawn: '负责人已撤回',
      };
      let loading = false;
      let withdrawing = false;
      let confirming = false;
      let withdrawalIntent = null;
      let confirmationIntent = null;
      function imageReviewPanel(review) {
        const box = node('section', undefined, 'moderation-image-review');
        box.append(
          node(
            'h4',
            review.state === 'confirmed'
              ? '图片已复核'
              : review.state === 'withdrawn'
                ? '图片对应内容已撤回'
                : '图片待复核 · 内容已自动发布',
          ),
        );
        if (review.state === 'confirmed')
          box.append(
            node(
              'p',
              `负责人已确认图片无问题${review.reviewedAt ? ` · ${formatTime(review.reviewedAt)}` : ''}；如发现问题仍可撤回。`,
            ),
          );
        else if (review.state === 'pending')
          box.append(
            node('p', '请逐张检查全部原图。确认无问题会移出待复核队列；发现问题请填写理由撤回。'),
          );
        if (
          review.canConfirm === true &&
          review.state === 'pending' &&
          submission.status === 'approved' &&
          Number.isInteger(submission.version)
        ) {
          const button = node('button', '已检查全部图片，确认无问题', 'moderation-image-confirm');
          button.type = 'button';
          const status = node('p');
          status.setAttribute('role', 'status');
          const sync = () => {
            if (!current()) return;
            button.disabled =
              confirming || withdrawing || !state.imagesReady || !submission.attachments?.length;
            if ((!state.imagesReady || !submission.attachments?.length) && !confirming)
              status.textContent = '全部图片加载成功后才能确认；请逐张查看原图。';
            else if (!confirming) status.textContent = '';
          };
          state.imageReadyListeners.push(sync);
          sync();
          button.addEventListener('click', async () => {
            if (
              !current() ||
              confirming ||
              withdrawing ||
              state.deciding ||
              !state.imagesReady ||
              !submission.attachments?.length
            )
              return;
            if (!confirmationIntent) confirmationIntent = cryptoApi.randomUUID();
            confirming = true;
            button.disabled = true;
            refreshButton.disabled = true;
            status.textContent = '正在保存图片复核结果…';
            try {
              const saved = await client.request(
                `/moderation/submissions/${encodeURIComponent(submission.id)}/image-review`,
                {
                  method: 'POST',
                  body: JSON.stringify({
                    expectedVersion: submission.version,
                    requestId: confirmationIntent,
                  }),
                },
              );
              if (!current()) return;
              if (
                String(saved.submissionId || saved.id) !== String(submission.id) ||
                saved.version !== submission.version ||
                saved.imageReview?.state !== 'confirmed'
              )
                throw new Error('图片复核状态未确认，请刷新详情核对。');
              el('message').textContent = '图片复核已确认，内容继续发布；发现问题仍可撤回。';
              await loadList(false);
              if (current()) await openSubmission(submission.id);
            } catch (error) {
              if (!current()) return;
              if ([409, 410].includes(error.status)) {
                el('message').textContent = '稿件状态已变化或审核材料到期，请重新核对。';
                await openSubmission(submission.id);
              } else status.textContent = `${error.message} 可重试同一确认操作。`;
            } finally {
              if (current()) {
                confirming = false;
                button.disabled =
                  withdrawing || !state.imagesReady || !submission.attachments?.length;
                refreshButton.disabled = false;
              }
            }
          });
          box.append(button, status);
        }
        return box;
      }
      function withdrawalForm() {
        const form = node('form', undefined, 'moderation-withdrawal');
        const label = node('label', '撤回说明（必填，作者可在提交记录中查看）');
        label.htmlFor = 'moderation-withdraw-reason';
        const reason = node('textarea');
        reason.id = 'moderation-withdraw-reason';
        reason.maxLength = 1000;
        reason.required = true;
        const button = node('button', '撤回已自动发布的内容');
        button.type = 'submit';
        const status = node('p');
        status.setAttribute('role', 'status');
        form.append(label, reason, button, status);
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          if (!current() || withdrawing || confirming || state.deciding) return;
          const text = reason.value.trim();
          if (!text || text.length > 1000) {
            status.textContent = '请填写 1～1000 字的撤回理由。';
            return;
          }
          const key = JSON.stringify([submission.id, submission.version, text]);
          if (withdrawalIntent?.key !== key)
            withdrawalIntent = { key, requestId: cryptoApi.randomUUID() };
          withdrawing = true;
          button.disabled = true;
          refreshButton.disabled = true;
          status.textContent = '正在撤回…';
          try {
            await client.request(
              `/moderation/submissions/${encodeURIComponent(submission.id)}/withdraw`,
              {
                method: 'POST',
                body: JSON.stringify({
                  expectedVersion: submission.version,
                  reason: text,
                  requestId: withdrawalIntent.requestId,
                }),
              },
            );
            if (!current()) return;
            el('message').textContent = '已撤回自动发布的内容，撤回理由已保存。';
            await loadList(false);
            if (current()) await openSubmission(submission.id);
          } catch (error) {
            if (!current()) return;
            if ([409, 410].includes(error.status)) {
              el('message').textContent = '提交状态已变化或审核数据已到期，已重新加载，请核对。';
              await openSubmission(submission.id);
            } else status.textContent = `${error.message} 可重试同一撤回操作。`;
          } finally {
            if (current()) {
              withdrawing = false;
              button.disabled = false;
              refreshButton.disabled = false;
            }
          }
        });
        return form;
      }
      async function refresh() {
        if (!current() || loading || withdrawing || confirming) return;
        loading = true;
        refreshButton.disabled = true;
        content.replaceChildren(node('p', '正在加载自动审核状态…'));
        try {
          const { job } = await client.request(
            `/moderation/submissions/${encodeURIComponent(submission.id)}/automation`,
          );
          if (!current()) return;
          if (job === null) {
            content.replaceChildren(node('p', '此稿件没有自动审核任务，继续人工审核。'));
            return;
          }
          if (!job || !Object.prototype.hasOwnProperty.call(labels, job.state))
            throw new Error('自动审核状态无效，请刷新后核对。');
          content.replaceChildren(
            node('h4', labels[job.state]),
            node(
              'p',
              `模型：${job.model || '未记录'} · ${formatTime(job.updatedAt || job.completedAt || job.createdAt)}`,
              'moderation-meta',
            ),
            node('p', AUTOMATION_REASON_LABELS[job.reasonCode] || job.reason || ''),
          );
          if (job.expired)
            content.append(
              node(
                'p',
                '审核材料已到期，详细结果已清理；如需处理已发布内容，请使用讨论区管理功能。',
              ),
            );
          if (job.state === 'withdrawn' && job.withdrawal?.reason)
            content.append(node('p', `撤回说明：${job.withdrawal.reason}`));
          if (job.state === 'blocked')
            content.append(
              node('p', '这是机器的暂时拦截，尚不是最终不予发布；负责人可核查后通过或不予发布。'),
            );
          if (job.state === 'review')
            content.append(
              node('p', '请独立核对原稿及图片。关怀需求不等于违规，机器异常也不能作为处罚依据。'),
            );
          if (job.state === 'published')
            content.append(
              node('p', '已自动发布稿件可由负责人撤回；此处不提供再次调用模型的手动试审。'),
            );
          const imageReview = job.imageReview || submission.automation?.imageReview;
          if (imageReview?.required) content.append(imageReviewPanel(imageReview));
          if (job.result?.reviewFocus) content.append(focusPanels(job.result.reviewFocus));
          if (job.result) {
            content.append(node('p', '以下为机器自动审核结果，不是负责人最终结论。'));
            if (job.result.assessment) {
              content.append(
                node('p', DECISION_LABELS[job.result.assessment.decision] || '待核对'),
                node(
                  'p',
                  `风险分类：${job.result.assessment.categories?.length ? job.result.assessment.categories.map((id) => AI_CATEGORY_LABELS[id] || '待核对类别').join('、') : '未列出风险类别'}`,
                ),
                node('p', job.result.assessment.reason || ''),
              );
            }
            content.append(policyResultPanels(job.result));
            if (Array.isArray(job.result.imageResults) && job.result.imageResults.length)
              content.append(imageMachinePanels(job.result));
          }
          if (
            job.canWithdraw === true &&
            job.state === 'published' &&
            submission.status === 'approved' &&
            Number.isInteger(submission.version)
          )
            content.append(withdrawalForm());
          else if (job.state === 'published' && submission.status === 'pending') {
            const reload = node('button', '刷新提交详情');
            reload.type = 'button';
            reload.addEventListener('click', () => current() && openSubmission(submission.id));
            content.append(
              node('p', '内容已自动发布，请刷新详情查看当前发布状态和撤回入口。'),
              reload,
            );
          }
        } catch (error) {
          if (current()) content.replaceChildren(node('p', `自动状态未能加载：${error.message}`));
        } finally {
          if (current()) {
            loading = false;
            refreshButton.disabled = false;
          }
        }
      }
      refreshButton.addEventListener('click', refresh);
      refresh();
      return panel;
    }

    function historyPanel(submission, generation, version) {
      const panel = node('section', undefined, 'moderation-history');
      panel.append(
        node('p', 'AUDIT TRAIL', 'moderation-eyebrow'),
        node('h3', '试审与人工复核记录'),
        node(
          'p',
          '以下为保存的历史结果。更换模型或补充脱敏信息，不会改写此前记录。',
          'moderation-note',
        ),
      );
      const content = node('div');
      panel.append(content);
      const current = () =>
        valid(generation) &&
        version === state.detailVersion &&
        state.selected === submission &&
        !mine &&
        state.session?.reviewer;
      let requestVersion = 0;
      async function refresh() {
        if (!current()) return;
        requestVersion += 1;
        const requestId = requestVersion;
        content.replaceChildren(node('p', '正在加载审核记录…', 'moderation-note'));
        try {
          const { runs } = await client.request(
            `/moderation/submissions/${encodeURIComponent(submission.id)}/ai-history`,
          );
          if (!current() || requestId !== requestVersion) return;
          if (!Array.isArray(runs)) throw new Error('审核记录格式无效。');
          content.replaceChildren();
          if (!runs.length) content.append(node('p', '暂无已保存的试审记录。', 'moderation-empty'));
          for (const run of runs) {
            const entry = disclosure(
              `${formatTime(run.createdAt)} · ${run.model} · ${!run.assessment || run.manualReview?.validation === 'failed' ? '模型提示待人工复核' : DECISION_LABELS[run.assessment?.decision] || '待核对'}`,
              'moderation-history-entry',
            );
            entry.append(
              node(
                'p',
                `规则版本：${run.policyVersion || '未记录'} · ${run.inputMode === 'synthetic_original' ? '虚构原文（仅测试）' : '本地脱敏文字'}`,
                'moderation-meta',
              ),
              node(
                'p',
                run.manualReview?.validation === 'failed' ? '' : run.assessment?.reason || '',
              ),
              policyResultPanels(run),
            );
            if (run.feedback)
              entry.append(
                node(
                  'p',
                  `最近复核：${{ agree: '同意', correct: '纠正', escalate: '升级核查' }[run.feedback.verdict] || '已记录'} · ${DECISION_LABELS[run.feedback.decision] || ''} · ${formatTime(run.feedback.createdAt)} · 复核规则版本：${run.feedback.policyVersion || '未记录（历史）'}`,
                ),
                node('p', run.feedback.note || ''),
              );
            if (Array.isArray(run.feedbackHistory) && run.feedbackHistory.length > 1) {
              const revisions = disclosure(`全部人工复核记录（${run.feedbackHistory.length}）`);
              for (const feedback of run.feedbackHistory)
                revisions.append(
                  node(
                    'p',
                    `${formatTime(feedback.createdAt)} · ${{ agree: '同意', correct: '纠正', escalate: '升级核查' }[feedback.verdict] || '已记录'} · ${DECISION_LABELS[feedback.decision] || ''} · 复核规则版本：${feedback.policyVersion || '未记录（历史）'}`,
                  ),
                  node('p', feedback.note || '（无补充说明）'),
                );
              entry.append(revisions);
            }
            if (state.session?.aiTestEnabled === true && state.library)
              entry.append(feedbackPanel(submission, run, current, refresh));
            else if (state.session?.aiTestEnabled === true)
              entry.append(
                node(
                  'p',
                  '当前禁止清单尚未加载，暂不能填写复核或回归样例。请刷新规则后重试。',
                  'moderation-note',
                ),
              );
            else
              entry.append(
                node(
                  'p',
                  '当前环境未启用文字试审，历史仅供查看；人工反馈与回归样例写入已停用。',
                  'moderation-note',
                ),
              );
            content.append(entry);
          }
        } catch (error) {
          if (current() && requestId === requestVersion)
            content.replaceChildren(
              node('p', `审核历史未能加载：${error.message}`, 'moderation-note'),
            );
        }
      }
      state.refreshHistory = refresh;
      refresh();
      return panel;
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
            no_risk_detected: '未发现明确禁止内容，仍需人工决定',
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
            policyResultPanels(assessmentResult),
          );
          if (assessmentResult.imageCount > 0 || submission.attachments?.length)
            result.append(
              node('p', '图片尚未机器审核，请继续人工检查全部图片。', 'moderation-privacy-warning'),
            );
          result.append(
            node('p', '试审仅提供文字建议，原稿未修改，也不会自动发布。最终由审核负责人决定。'),
          );
          status.textContent = '文字试审已完成。';
          if (assessmentResult.runId) state.refreshHistory?.();
        } catch (error) {
          if (responseCurrent()) {
            result.replaceChildren();
            const review = error.reviewResult;
            if (
              [502, 504].includes(error.status) &&
              isReviewResult(review) &&
              review.submissionId === submission.id &&
              review.version === inspectedVersion &&
              review.inputMode === inputMode &&
              review.model === requestedModel &&
              review.imagesReviewed === false &&
              review.automaticPublication === false &&
              typeof review.contentHash === 'string' &&
              /^[a-f0-9]{64}$/.test(review.contentHash) &&
              (!submission.contentHash || review.contentHash === submission.contentHash) &&
              Number.isFinite(review.elapsedMs) &&
              review.elapsedMs >= 0 &&
              Number.isSafeInteger(review.imageCount) &&
              review.imageCount >= 0 &&
              Number.isSafeInteger(review.settingsRevision) &&
              review.settingsRevision >= 0 &&
              typeof review.policyVersion === 'string' &&
              review.policyVersion.length > 0 &&
              review.policyVersion.length <= 120
            ) {
              result.append(
                node(
                  'p',
                  `模型：${review.model} · 耗时：${(review.elapsedMs / 1000).toFixed(1)} 秒`,
                  'moderation-meta',
                ),
                manualReviewPanel(review),
              );
              status.textContent = '试审输出未通过校验，已转为人工复核提示。';
              if (review.runId) state.refreshHistory?.();
              return;
            }
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
                : '本地识别未发现可替换的隐私信息；这不代表已完整脱敏。',
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
        const original = node('section', undefined, 'moderation-original');
        original.append(
          node('p', 'ORIGINAL SUBMISSION', 'moderation-eyebrow'),
          title,
          meta,
          author,
          node('h3', '正文原文'),
          body,
          images,
        );
        const detailGrid = node('div', undefined, 'moderation-detail-grid');
        const decisionColumn = node('aside', undefined, 'moderation-review-card');
        decisionColumn.setAttribute('aria-label', '人工审核决定');
        detailGrid.append(original, decisionColumn);
        el('detail').replaceChildren(detailGrid);
        if (submission.reason) original.append(node('p', `审核说明：${submission.reason}`));
        if (submission.expiresAt)
          original.append(
            node('p', `审核数据到期时间：${formatTime(submission.expiresAt)}`, 'moderation-note'),
          );
        const published = publishedLink(submission.publishedUrl, window.location.origin);
        if (submission.status === 'approved' && published) {
          const link = node('a', '查看已发布内容');
          link.href = published;
          original.append(link);
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
          form.append(
            node('p', 'HUMAN REVIEW', 'moderation-eyebrow'),
            node('h3', '负责人最终决定'),
            node(
              'p',
              state.session.automation?.enabled
                ? '人工决定与自动任务会核对同一稿件版本。请先查看自动状态，再核对内容、图片和依据；机器暂时拦截仍可由负责人处理。'
                : '核对内容、图片和依据后再发布。机器试审与复核记录均不会代替此操作。',
              'moderation-note',
            ),
            label,
            reason,
            actions,
            status,
          );
          decisionColumn.append(form);
          el('detail').append(privacyPreviewPanel(submission, generation, version));
        } else decisionColumn.hidden = true;
        if (
          !mine &&
          state.session.reviewer &&
          state.session.automation &&
          submission.status !== 'expired'
        )
          el('detail').append(automationPanel(submission, generation, version));
        if (!mine && state.session.reviewer && submission.status !== 'expired')
          el('detail').append(historyPanel(submission, generation, version));
        if (attachments.length && imageStatus)
          imageStatus.textContent = '图片加载完成后可通过审核；加载失败时请刷新重试。';
        Promise.all(
          attachments.map((attachment, index) =>
            showImage(attachment, images, generation, version, index),
          ),
        ).then((loaded) => {
          if (!valid(generation) || version !== state.detailVersion) return;
          state.imagesReady = loaded.every(Boolean);
          if (approveButton) approveButton.disabled = state.deciding || !state.imagesReady;
          if (imageStatus)
            imageStatus.textContent = state.imagesReady
              ? ''
              : '有图片未能加载，暂不能通过审核。请刷新后重试。';
          state.imageReadyListeners.forEach((update) => update());
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
        const imageQueue = !mine && el('status').value === 'image_review';
        const path = mine
          ? '/moderation/mine'
          : imageQueue
            ? '/moderation/automation/image-reviews'
            : '/moderation/submissions';
        const params = new URLSearchParams();
        if (!mine && !imageQueue) params.set('status', el('status').value);
        if (more && state.nextCursor) params.set('before', state.nextCursor);
        const payload = await client.request(`${path}?${params}`);
        if (!valid(generation) || version !== state.listVersion) return;
        const items = (imageQueue ? payload.items : payload.submissions) || [];
        state.count += items.length;
        state.nextCursor = imageQueue ? '' : payload.nextCursor || '';
        el('more').hidden = !state.nextCursor;
        el('list-status').textContent = state.count
          ? `已显示 ${state.count} 条${imageQueue ? '图片待复核稿件（已自动发布）' : '提交'}${mine ? '（所有状态）' : ''}`
          : '暂无符合条件的提交。';
        for (const item of items) {
          const button = node('button', undefined, 'moderation-item');
          button.type = 'button';
          button.append(
            node('strong', item.title || (item.kind === 'comment' ? '评论' : '帖子')),
            node(
              'span',
              `${imageQueue ? '图片待复核 · 已自动发布' : STATUS_LABELS[item.status] || '未知状态'} · ${formatTime(item.createdAt)}`,
              'moderation-meta',
            ),
          );
          button.setAttribute('aria-pressed', 'false');
          button.addEventListener('click', () => {
            el('list')
              .querySelectorAll('button')
              .forEach((entry) =>
                entry.setAttribute('aria-pressed', entry === button ? 'true' : 'false'),
              );
            openSubmission(item.id);
          });
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
          : session.automation?.enabled
            ? '自动审核仅用于虚构测试内容。请复核异常和暂时拦截结果，并留意已自动发布内容。'
            : '请结合正文和全部图片作出人工审核决定。';
        renderAutomationStatus();
        el('workspace').hidden = false;
        el('image-queue').hidden = mine || !session.reviewer;
        el('policy-library').hidden = mine || !session.reviewer;
        el('regression-export').disabled =
          mine || !session.reviewer || session.aiTestEnabled !== true;
        if (!mine && session.reviewer) loadPolicies();
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
    el('image-queue').addEventListener('click', () => {
      if (mine || !state.session?.reviewer) return;
      el('status').value = 'image_review';
      loadList();
    });
    el('automation-toggle').addEventListener('click', changeAutomation);
    el('more').addEventListener('click', () => loadList(false, true));
    el('status').addEventListener('change', () => loadList());
    el('policy-query').addEventListener('input', renderPolicies);
    el('policy-category').addEventListener('change', renderPolicies);
    el('policy-refresh').addEventListener('click', loadPolicies);
    el('regression-export').addEventListener('click', async () => {
      if (
        mine ||
        !state.session?.reviewer ||
        state.session?.aiTestEnabled !== true ||
        !state.library
      )
        return;
      const generation = state.generation;
      const button = el('regression-export');
      if (button.disabled) return;
      button.disabled = true;
      try {
        const payload = await client.request('/moderation/regressions/export');
        if (
          !valid(generation) ||
          mine ||
          !state.session?.reviewer ||
          state.session?.aiTestEnabled !== true
        )
          return;
        const blob = new Blob([JSON.stringify(payload, null, 2)], {
          type: 'application/json;charset=utf-8',
        });
        const url = urlApi.createObjectURL(blob);
        const link = node('a', '下载回归样例');
        link.href = url;
        link.download = `freebbs-moderation-regressions-${new Date().toISOString().slice(0, 10)}.json`;
        link.click();
        urlApi.revokeObjectURL(url);
        const count = Array.isArray(payload.cases) ? payload.cases.length : 0;
        const skipped = Number.isSafeInteger(payload.skippedLegacyCount)
          ? payload.skippedLegacyCount
          : 0;
        el('export-status').textContent =
          `已导出 ${count} 条当前版本样例（${payload.policyVersion || state.library?.version || '版本待核对'}）；另有 ${skipped} 条旧版样例未导出，需要按当前清单重新复核并重建。${count ? '' : '本文件没有可执行的当前版本样例。'}未调用外部模型。文件不会自动匿名化，使用或分享前请再次人工核查。`;
      } catch (error) {
        if (valid(generation)) el('export-status').textContent = error.message;
      } finally {
        button.disabled =
          mine ||
          !state.session?.reviewer ||
          state.session?.aiTestEnabled !== true ||
          !state.library;
      }
    });
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
