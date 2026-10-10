const crypto = require('node:crypto');
const { getPolicyRule } = require('../backend/moderation-policy');
const { sanitizeDiagnostics } = require('../backend/moderation-ai-diagnostics');

const DECISIONS = ['no_risk_detected', 'needs_review', 'high_risk'];
const SUPPORT = ['none', 'attention', 'urgent'];
const DECISION_LABELS = {
  no_risk_detected: '未发现禁止内容',
  needs_review: '需要人工核查',
  high_risk: '明确风险建议',
};
const SUPPORT_LABELS = { none: '无关怀信号', attention: '关注', urgent: '紧急关怀' };
const CATEGORY_LABELS = {
  privacy: '隐私信息',
  harassment: '霸凌与骚扰',
  threat: '人身威胁',
  self_harm: '自伤教唆',
  sexual_content: '色情与性相关违规',
  violence: '暴力内容',
  fraud: '诈骗',
  illegal_activity: '违法活动',
  hate: '仇恨与歧视',
  misinformation: '虚假与误导信息',
  political_compliance: '政治内容合规',
};
const FIELD_LABELS = {
  decision: '判断决定',
  categories: '风险类别',
  ruleIds: '适用规则',
  supportPriority: '关怀级别',
};
const STATUS_LABELS = {
  running: '运行中',
  completed: '已完成',
  stopped: '已停止',
  failed: '执行失败',
  interrupted: '已中断',
  not_started: '未开始',
  partial: '部分模型未完成',
};
const BUCKET_LABELS = {
  prohibited: '禁止范围',
  normal: '正常表达',
  boundary: '边界核查',
  support: '关怀',
  adversarial: '引用与指令干扰',
};
const FAILURE_LABELS = {
  configuration_invalid: '审核渠道配置未通过校验',
  input_invalid: '送审输入未通过校验',
  model_unavailable: '所选模型不可用',
  http_error: '供应商返回了非成功状态',
  transport_error: '网络传输失败',
  timeout: '调用超过等待时限',
  response_redirected: '响应发生重定向，已拒绝接收',
  response_body_invalid: '响应正文无法完整读取',
  response_type_invalid: '响应类型不符合接口约定',
  response_too_large: '响应超过允许大小',
  response_utf8_invalid: '响应文字编码无效',
  response_json_invalid: '接口响应不是有效的结构化数据',
  response_envelope_invalid: '接口响应外层结构不符合约定',
  message_invalid: '接口未提供有效的助手文字消息',
  finish_reason_not_stop: '模型输出未正常完成',
  content_json_invalid: '模型审核正文不是有效的结构化数据',
  assessment_fields_invalid: '审核字段、类型或取值不符合约定',
  rule_evidence_invalid: '规则证据不是送审文字中的有效原句',
  rule_unknown: '返回了当前规则库中不存在的规则',
  category_rule_mismatch: '风险类别与适用规则不一致',
  support_rule_mismatch: '关怀级别与适用规则不一致',
  high_risk_without_block: '明确风险判断缺少允许拦截的规则依据',
};
const SHAPE_LABELS = {
  startsWithObject: '正文以对象起始符开头',
  endsWithObject: '正文以对象结束符结尾',
  startsWithFence: '正文以代码块标记开头',
  singleJsonFence: '正文是单个结构化数据代码块',
  fencedJsonParseable: '代码块内可解析为结构化数据',
  decodedJsonStringObject: '二次编码的字符串可解码为对象',
  hasBom: '正文含开头字节序标记',
};
const SYNTAX_LABELS = {
  none: '未发现语法错误',
  unexpected_end: '正文提前结束或字符串未闭合',
  trailing_content: '完整数据后附带了其他内容',
  property_name: '对象字段名写法不正确',
  expected_separator: '字段或数组的分隔符不正确',
  invalid_escape: '字符串转义不正确',
  control_character: '字符串包含不允许的控制字符',
  other: '其他语法问题',
};
const equalSet = (a, b) =>
  Array.isArray(a) && Array.isArray(b) && [...a].sort().join('\n') === [...b].sort().join('\n');

function expectation(fixture) {
  return {
    expectedDecision: fixture.expectedDecision,
    categories: fixture.categories,
    ruleIds: fixture.ruleIds,
    supportPriority: fixture.supportPriority,
  };
}

function differences(assessment, expected) {
  const result = [];
  if (assessment.decision !== expected.expectedDecision) result.push('decision');
  if (!equalSet(assessment.categories, expected.categories)) result.push('categories');
  if (
    !equalSet(
      assessment.ruleMatches?.map((match) => match.ruleId),
      expected.ruleIds,
    )
  )
    result.push('ruleIds');
  if (assessment.supportPriority !== expected.supportPriority) result.push('supportPriority');
  return result;
}

function compareRow(row, metadata) {
  if (!row.assessment || row.error)
    return { result: 'error', acceptedExpectationIndex: null, differences: [] };
  const primary = expectation(row.fixture);
  // Alternatives explain legitimate rule overlap, never excuse a different decision or care level.
  const alternatives = (metadata?.acceptedExpectations || []).filter(
    (item) =>
      item.expectedDecision === primary.expectedDecision &&
      item.supportPriority === primary.supportPriority &&
      Array.isArray(item.categories) &&
      Array.isArray(item.ruleIds),
  );
  const expected = [primary, ...alternatives];
  const index = expected.findIndex((item) => differences(row.assessment, item).length === 0);
  return {
    result: index >= 0 ? 'matched' : 'review',
    acceptedExpectationIndex: index >= 0 ? index : null,
    differences: index >= 0 ? [] : differences(row.assessment, primary),
    reasonRequiresHumanReview: true,
  };
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function isCareOnlyReview(row) {
  const f = row.fixture;
  const a = row.assessment;
  if (
    !a ||
    row.error ||
    f.expectedDecision !== 'no_risk_detected' ||
    a.decision !== 'needs_review' ||
    !Array.isArray(f.categories) ||
    f.categories.length !== 0 ||
    !Array.isArray(a.categories) ||
    a.categories.length !== 0 ||
    !['attention', 'urgent'].includes(f.supportPriority) ||
    a.supportPriority !== f.supportPriority ||
    !Array.isArray(f.ruleIds) ||
    f.ruleIds.length === 0 ||
    !equalSet(
      f.ruleIds,
      a.ruleMatches?.map((match) => match.ruleId),
    )
  )
    return false;
  const rules = f.ruleIds.map(getPolicyRule);
  return (
    rules.every(
      (rule) =>
        rule?.supportOnly === true &&
        rule.kind === 'support' &&
        ['attention', 'urgent'].includes(rule.supportPriority),
    ) &&
    Math.max(...rules.map((rule) => SUPPORT.indexOf(rule.supportPriority))) ===
      SUPPORT.indexOf(f.supportPriority)
  );
}

function sanitizeErrorDiagnostics(value) {
  if (!value || typeof value !== 'object') return value;
  const { diagnostics: _discard, ...rest } = value;
  const diagnostics = sanitizeDiagnostics(value.diagnostics);
  return { ...rest, ...(diagnostics ? { diagnostics } : {}) };
}

function metrics(rows, plannedCount) {
  const valid = rows.filter((row) => row.assessment && !row.error);
  const elapsed = valid.map((row) => row.elapsedMs).filter((ms) => Number.isFinite(ms) && ms >= 0);
  const confusion = Object.fromEntries(
    DECISIONS.map((a) => [a, Object.fromEntries(DECISIONS.map((b) => [b, 0]))]),
  );
  valid.forEach((row) => {
    if (confusion[row.fixture.expectedDecision]?.[row.assessment.decision] !== undefined) {
      confusion[row.fixture.expectedDecision][row.assessment.decision] += 1;
    }
  });
  const primaryMatches = valid.filter(
    (row) => row.comparisonEvaluation.acceptedExpectationIndex === 0,
  ).length;
  const acceptedVariantMatches = valid.filter(
    (row) => row.comparisonEvaluation.acceptedExpectationIndex > 0,
  ).length;
  return {
    planned: plannedCount,
    processed: rows.length,
    unprocessed: Math.max(0, plannedCount - rows.length),
    networkAttempts: rows.filter((row) => row.networkAttempted).length,
    validResults: valid.length,
    primaryMatches,
    acceptedVariantMatches,
    matchedLabels: primaryMatches + acceptedVariantMatches,
    labelsToReview: valid.filter((row) => row.comparisonEvaluation.result === 'review').length,
    failed: rows.filter((row) => !row.assessment || row.error).length,
    normalEscalations: valid.filter(
      (row) =>
        row.fixture.expectedDecision === 'no_risk_detected' &&
        row.assessment.decision !== 'no_risk_detected' &&
        !isCareOnlyReview(row),
    ).length,
    careOnlyReviews: valid.filter(isCareOnlyReview).length,
    riskReleased: valid.filter(
      (row) =>
        row.fixture.expectedDecision !== 'no_risk_detected' &&
        row.assessment.decision === 'no_risk_detected',
    ).length,
    highRiskDowngraded: valid.filter(
      (row) =>
        row.fixture.expectedDecision === 'high_risk' && row.assessment.decision !== 'high_risk',
    ).length,
    careUnderstated: valid.filter(
      (row) =>
        SUPPORT.indexOf(row.assessment.supportPriority) <
        SUPPORT.indexOf(row.fixture.supportPriority),
    ).length,
    decisionConfusion: confusion,
    latency: {
      sampleCount: elapsed.length,
      meanMs: elapsed.length
        ? Math.round(elapsed.reduce((a, b) => a + b, 0) / elapsed.length)
        : null,
      medianMs: percentile(elapsed, 0.5),
      p95Ms: percentile(elapsed, 0.95),
      maxMs: elapsed.length ? Math.max(...elapsed) : null,
      withinFiveSeconds: elapsed.filter((ms) => ms <= 5000).length,
    },
  };
}

function buildComparison(input) {
  const plannedCases = input.plannedCases || input.cases?.map((item) => item.fixture) || [];
  const metadata =
    input.manifest?.cases ||
    Object.fromEntries((input.cases || []).map((item) => [item.fixture.id, item.metadata]));
  const selectedModels = input.selectedModels || input.models.map((model) => model.model);
  const caseCount = plannedCases.length;
  const cases = plannedCases.map((fixture) => ({
    fixture,
    metadata: metadata[fixture.id] || null,
  }));
  const models = input.models.map((model) => {
    const results = model.results.map((row) => ({
      ...row,
      ...(row.error ? { error: sanitizeErrorDiagnostics(row.error) } : {}),
      comparisonEvaluation: compareRow(row, metadata[row.fixture.id]),
    }));
    const revisions = [
      ...new Set(
        results
          .map((row) => row.settingsRevision)
          .filter((value) => value !== null && value !== undefined),
      ),
    ];
    const ruleFocus = [
      ...new Set(cases.flatMap((item) => item.metadata?.ruleFocus || item.fixture.ruleIds)),
    ];
    const byRule = ruleFocus.map((ruleId) => {
      const focusIds = new Set(
        cases
          .filter((item) => (item.metadata?.ruleFocus || item.fixture.ruleIds).includes(ruleId))
          .map((item) => item.fixture.id),
      );
      return {
        ruleId,
        ...metrics(
          results.filter((row) => focusIds.has(row.fixture.id)),
          focusIds.size,
        ),
      };
    });
    return {
      ...model,
      ...(model.error ? { error: sanitizeErrorDiagnostics(model.error) } : {}),
      results,
      metrics: metrics(results, caseCount),
      settingsRevisions: revisions,
      byRule,
    };
  });
  const summary = metrics(
    models.flatMap((model) => model.results),
    caseCount * selectedModels.length,
  );
  const allRevisions = [...new Set(models.flatMap((model) => model.settingsRevisions))];
  const sampleSetSha256 = crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        policyVersion: input.policyVersion,
        cases,
        annotationStatus:
          input.manifest?.annotationStatus || input.annotationStatus || 'provided_expected_labels',
      }),
    )
    .digest('hex');
  // Omit the full manifest/duplicate plannedCases; cases already retain every tested annotation.
  const { manifest: _manifest, plannedCases: _planned, ...rest } = input;
  return {
    ...rest,
    ...(rest.error ? { error: sanitizeErrorDiagnostics(rest.error) } : {}),
    format: 'freebbs-moderation-model-comparison-v1',
    selectedModels,
    caseCount,
    plannedCalls: caseCount * selectedModels.length,
    annotationStatus:
      input.manifest?.annotationStatus || input.annotationStatus || 'provided_expected_labels',
    sampleSetSha256,
    cases,
    models,
    summary: { ...summary, plannedCalls: caseCount * selectedModels.length },
    comparabilityWarnings:
      allRevisions.length > 1
        ? ['本次运行读取到不同模型设置版本，比较结果需核查渠道或模型设置变化。']
        : [],
  };
}

const escapeHtml = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
const label = (map, key) => map[key] || key || '—';
const seconds = (ms) => (Number.isFinite(ms) ? `${(ms / 1000).toFixed(2)} 秒` : '—');
const join = (values) => (values?.length ? values.join('、') : '无');
const e = escapeHtml;

function renderExpected(value) {
  return `${e(label(DECISION_LABELS, value.expectedDecision))}；类别：${e(join(value.categories?.map((category) => label(CATEGORY_LABELS, category))))}；${e(join(value.ruleIds))}；${e(label(SUPPORT_LABELS, value.supportPriority))}`;
}

function renderDiagnostics(value) {
  const diagnostic = sanitizeDiagnostics(value);
  if (!diagnostic) return '';
  const shape = Object.entries(diagnostic.contentShape || {})
    .filter(([key, flag]) => SHAPE_LABELS[key] && typeof flag === 'boolean')
    .map(([key, flag]) => `<li>${e(SHAPE_LABELS[key])}：${flag ? '是' : '否'}</li>`)
    .join('');
  return `<p><strong>失败位置：</strong>${e(FAILURE_LABELS[diagnostic.failureCode] || '接口校验失败')}。${diagnostic.httpStatus !== null ? ` 供应商响应状态：${diagnostic.httpStatus}。` : ''}</p>${diagnostic.jsonSyntaxKind ? `<p><strong>语法检查：</strong>${e(SYNTAX_LABELS[diagnostic.jsonSyntaxKind])}。</p>` : ''}${shape ? `<details><summary>返回格式检查（仅记录形态，不含原文）</summary><ul>${shape}</ul></details>` : ''}`;
}

function renderCase(row, model, metadata) {
  const outcome = row.comparisonEvaluation.result;
  const outcomeLabel = { matched: '标签一致', review: '需要复核', error: '调用失败' }[outcome];
  const actual = row.assessment;
  const alternative = row.comparisonEvaluation.acceptedExpectationIndex > 0;
  const reasons = actual
    ? `<p><strong>模型理由：</strong>${e(actual.reason)}</p>
    <p><strong>风险类别：</strong>${e(join(actual.categories?.map((category) => label(CATEGORY_LABELS, category))))} <strong>关怀：</strong>${e(label(SUPPORT_LABELS, actual.supportPriority))}</p>
    ${actual.supportReason ? `<p><strong>关怀说明：</strong>${e(actual.supportReason)}</p>` : ''}
    <p><strong>待核实：</strong>${e(join(actual.uncertainties))}</p>
    <ul>${(actual.ruleMatches || []).map((match) => `<li><strong>${e(match.ruleId)}</strong>：${e(match.explanation || match.reason || '')}<blockquote>${e(match.evidence?.quote || match.quote || '')}</blockquote></li>`).join('')}</ul>`
    : `<p class="error"><strong>调用结果：</strong>${e(row.error?.message || '未返回有效结果')}（${e(row.error?.status || row.error?.code || 'unknown')}）</p>${renderDiagnostics(row.error?.diagnostics)}`;
  return `<tr class="case-row" data-model="${e(model)}" data-outcome="${outcome}"><td><span class="badge ${outcome}">${outcomeLabel}</span>${alternative ? '<small>接受预先标注的替代规则组合</small>' : ''}</td><td><strong>${e(row.fixture.id)}</strong><small>${e(label(BUCKET_LABELS, metadata?.bucket))}</small></td><td>${e(model)}</td><td><details><summary>${e(row.fixture.title || row.fixture.content.slice(0, 45))}</summary><div class="case-detail">
    <h4>送审文字（全部为虚构样例）</h4><p>${e(row.fixture.title)}</p><pre>${e(row.fixture.content)}</pre>
    <p><strong>主要预期：</strong>${renderExpected(row.fixture)}</p><p><strong>预期依据：</strong>${e(row.fixture.reason)}</p>
    ${metadata?.acceptedExpectations?.length ? `<p><strong>预先允许的替代组合：</strong></p><ul>${metadata.acceptedExpectations.map((item) => `<li>${renderExpected(item)}</li>`).join('')}</ul>` : ''}
    <p><strong>实际结果：</strong>${actual ? `${e(label(DECISION_LABELS, actual.decision))}；${e(join(actual.ruleMatches?.map((match) => match.ruleId)))}` : '未取得有效判断'}</p>
    <p><strong>差异字段：</strong>${e(join(row.comparisonEvaluation.differences.map((field) => label(FIELD_LABELS, field))))}</p>${isCareOnlyReview(row) ? '<p class="notice">此条为保护性关怀复核：关怀规则及级别与预期相同，未列出禁止项。判断标签仍有差异，需负责人核查；不计入“无风险预期被升级”。</p>' : ''}${reasons}
    <p class="muted">理由和证据的适用性仍需人工核查。该结果不会发布、删除或处罚任何帖子。</p></div></details></td><td>${seconds(row.elapsedMs)}</td></tr>`;
}

function renderHtml(input) {
  const report = buildComparison(input);
  const lookup = new Map(report.models.map((model) => [model.model, model]));
  const metadata = Object.fromEntries(report.cases.map((item) => [item.fixture.id, item.metadata]));
  const rows = report.selectedModels
    .map((id) => {
      const model = lookup.get(id);
      if (!model)
        return `<tr><th>${e(id)}</th><td>未开始</td><td>0 / ${report.caseCount}</td><td colspan="9">没有结果，不计入语义判断统计</td></tr>`;
      const m = model.metrics;
      return `<tr><th>${e(id)}</th><td>${e(label(STATUS_LABELS, model.status))}</td><td>${m.processed} / ${m.planned}</td><td>${m.matchedLabels} / ${m.validResults}<small>主要 ${m.primaryMatches} · 替代 ${m.acceptedVariantMatches}</small></td><td>${m.labelsToReview}</td><td>${m.failed}</td><td>${m.normalEscalations}</td><td>${m.careOnlyReviews}</td><td>${m.riskReleased}</td><td>${m.careUnderstated}</td><td>${seconds(m.latency.meanMs)}<small>中位 ${seconds(m.latency.medianMs)}</small></td><td>${seconds(m.latency.p95Ms)}<small>5 秒内 ${m.latency.withinFiveSeconds} / ${m.latency.sampleCount}</small></td></tr>`;
    })
    .join('');
  const ruleRows = report.models
    .flatMap((model) =>
      model.byRule.map(
        (rule) =>
          `<tr><td>${e(model.model)}</td><th>${e(rule.ruleId)}</th><td>${rule.processed} / ${rule.planned}</td><td>${rule.matchedLabels} / ${rule.validResults}</td><td>${rule.labelsToReview}</td><td>${rule.failed}</td></tr>`,
      ),
    )
    .join('');
  const caseRows = report.models
    .flatMap((model) =>
      model.results.map((row) => renderCase(row, model.model, metadata[row.fixture.id])),
    )
    .join('');
  const matrix = report.models
    .map(
      (model) =>
        `<h3>${e(model.model)}</h3><div class="table-wrap"><table><caption>行是预期，列是实际；仅统计有效返回</caption><thead><tr><th>预期 / 实际</th>${DECISIONS.map((decision) => `<th>${e(DECISION_LABELS[decision])}</th>`).join('')}</tr></thead><tbody>${DECISIONS.map((expected) => `<tr><th>${e(DECISION_LABELS[expected])}</th>${DECISIONS.map((actual) => `<td>${model.metrics.decisionConfusion[expected][actual]}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`,
    )
    .join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>FreeBBS 多模型审核测试报告</title><style>
  :root{color-scheme:light dark;--bg:#f5f4fa;--card:#fff;--text:#202037;--muted:#656579;--line:#dedbea;--accent:#6141b8;--soft:#eeebf8;--bad:#9f2342;--good:#12674b}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.65 system-ui,'Microsoft YaHei',sans-serif}main{max-width:1320px;margin:0 auto;padding:36px 24px 70px}h1{font-size:32px;margin:8px 0 14px;line-height:1.3}h2{font-size:22px;margin:0 0 14px}h3{font-size:17px}p{margin:10px 0}.eyebrow{color:var(--accent);font-weight:700;letter-spacing:.1em}.muted,small{color:var(--muted)}small{display:block;font-weight:400}.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:24px;margin:22px 0}.notice{border-left:4px solid var(--accent);padding:12px 16px;background:var(--soft);border-radius:4px}.facts{display:flex;flex-wrap:wrap;gap:12px}.fact{padding:12px 18px;border:1px solid var(--line);border-radius:10px;background:var(--card)}.fact strong{font-size:22px;display:block}.table-wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;text-align:left;font-size:14px}th,td{border-bottom:1px solid var(--line);padding:12px 10px;vertical-align:top}thead{background:var(--soft)}th{font-weight:650}caption{text-align:left;color:var(--muted);padding:8px 0}.overview{min-width:1120px}.filters{display:flex;flex-wrap:wrap;gap:16px;margin:12px 0 18px}label{display:flex;align-items:center;gap:8px}select{font:inherit;background:var(--card);color:var(--text);border:1px solid var(--line);padding:8px;border-radius:8px;max-width:100%}.badge{display:inline-block;font-size:13px;padding:3px 8px;border-radius:6px;white-space:nowrap;background:var(--soft)}.matched{color:var(--good)}.review,.error{color:var(--bad)}details summary{cursor:pointer;color:var(--accent);font-weight:650;min-height:32px;overflow-wrap:anywhere}.case-detail{min-width:260px;max-width:650px;padding:12px 0}pre,blockquote{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--bg);padding:14px;border-radius:8px;margin:8px 0;font:inherit}blockquote{border-left:3px solid var(--line)}code{overflow-wrap:anywhere}ul{padding-left:22px}.case-table{min-width:760px}.case-table td:last-child{white-space:nowrap}.empty{padding:24px;text-align:center;border:1px dashed var(--line);color:var(--muted)}[hidden]{display:none!important}@media(max-width:600px){main{padding:24px 14px}h1{font-size:26px}.card{padding:16px;border-radius:12px}.fact{flex:1 1 40%}label{width:100%}select{flex:1;min-width:0}}@media(prefers-color-scheme:dark){:root{--bg:#14131d;--card:#201e2b;--text:#eceaf3;--muted:#b1acbf;--line:#413b54;--accent:#c0a5ff;--soft:#30283f;--bad:#ffa5b9;--good:#87d9b6}}@media print{body{background:white;color:black}.filters{display:none}.card{break-inside:avoid}.table-wrap{overflow:visible}table{min-width:0!important;font-size:10px}main{max-width:none;padding:0}}
  </style></head><body><main><div class="eyebrow">FREEBBS · 审核模型对照</div><h1>同一批样例，不同模型的判断差异</h1><p class="muted">${e(report.policyVersion)} · ${report.suite === 'smoke' ? '小批检查' : '完整样例'} · ${e(label(STATUS_LABELS, report.status))}</p>
  <div class="notice">样例及预期标签为${report.annotationStatus === 'draft_pending_owner_review' ? '初拟版本，需负责人复核' : '输入文件提供的标注'}。标签一致数用于定位差异，不代表真实用户内容准确率。模型理由与例外适用需要人工检查。</div>
  <div class="facts"><div class="fact"><strong>${report.caseCount}</strong>固定样例</div><div class="fact"><strong>${report.selectedModels.length}</strong>计划模型</div><div class="fact"><strong>${report.summary.networkAttempts} / ${report.plannedCalls}</strong>已发请求 / 上限</div><div class="fact"><strong>${report.summary.labelsToReview}</strong>标签待复核</div><div class="fact"><strong>${report.summary.failed}</strong>调用失败</div></div>
  ${report.stopReason || report.error ? `<p class="error">停止原因：${e(report.error?.message || report.stopReason)}</p>` : ''}
  ${report.comparabilityWarnings.map((message) => `<p class="notice">${e(message)}</p>`).join('')}
  <section class="card"><h2>模型对比</h2><div class="table-wrap"><table class="overview"><thead><tr><th>模型</th><th>状态</th><th>已测 / 计划</th><th>标签一致 / 有效</th><th>待复核</th><th>失败</th><th>无风险预期被升级</th><th>保护性关怀复核</th><th>风险预期被判无风险</th><th>关怀级别偏低</th><th>平均耗时</th><th>本批 P95</th></tr></thead><tbody>${rows}</tbody></table></div>
  <p class="muted">风险预期包含“需要人工核查”和“明确风险”；这两者均不等同于通过。保护性关怀复核仅指未列禁止项、关怀规则及级别均与预期相同、由无风险改为人工核查的结果；单列该项不改变严格标签对比，也不算违规升级。以上偏差是复核线索，可能反映模型或样例标注问题。调用失败不计入语义偏差，耗时仅统计有效返回；小批 P95 不代表线上性能，也不证明已满足 3～5 秒目标。</p></section>
  <section class="card"><h2>逐条核对</h2><p>展开样例可查看实际发送文字、预期依据、模型解释与证据。</p><div class="filters"><label>模型<select id="model-filter"><option value="">全部模型</option>${report.selectedModels.map((model) => `<option value="${e(model)}">${e(model)}</option>`).join('')}</select></label><label>结果<select id="result-filter"><option value="issues">待复核和失败</option><option value="">全部结果</option><option value="matched">标签一致</option><option value="review">需要复核</option><option value="error">调用失败</option></select></label></div><p id="visible-count" class="muted"></p><div class="table-wrap"><table class="case-table"><thead><tr><th>结果</th><th>样例</th><th>模型</th><th>内容与依据</th><th>耗时</th></tr></thead><tbody>${caseRows}</tbody></table></div><p id="empty-state" class="empty" hidden>此筛选条件下没有结果。请查看运行状态，或切换到全部结果。</p></section>
  <section class="card"><details><summary>按关注规则汇总</summary><p class="muted">包含该规则的正常表达及边界样例；一个样例可能关注多个规则，各行不能相加当作总数。</p><div class="table-wrap"><table><thead><tr><th>模型</th><th>关注规则</th><th>已测 / 计划</th><th>一致 / 有效</th><th>待复核</th><th>失败</th></tr></thead><tbody>${ruleRows}</tbody></table></div></details></section>
  <section class="card"><details><summary>判断分布与复核说明</summary>${matrix}<p>明确风险被降级的数量另保存在 comparison.json 的 highRiskDowngraded 中；同一结果可同时触发多个复核指标，这些数字不应相加。</p><p>本轮仅送审虚构文字原文；没有图片、真实帖子、附件或用户身份资料。脚本不测试本地脱敏命中率、自动发布或图片识别。</p><p>开始：${e(report.startedAt)}<br>结束：${e(report.completedAt || '尚未结束')}<br>样例与标注摘要：<code>${e(report.sampleSetSha256)}</code></p><p>报告与下载文件需要另行管理，不随网站的数据库保留期限自动删除。</p></details></section>
  </main><script>(()=>{const model=document.getElementById('model-filter');const result=document.getElementById('result-filter');const rows=[...document.querySelectorAll('.case-row')];function filter(){let visible=0;for(const row of rows){const matchModel=!model.value||row.dataset.model===model.value;const matchResult=!result.value||(result.value==='issues'?row.dataset.outcome!=='matched':row.dataset.outcome===result.value);row.hidden=!(matchModel&&matchResult);if(!row.hidden)visible+=1;}document.getElementById('visible-count').textContent='显示 '+visible+' / '+rows.length+' 条模型结果';document.getElementById('empty-state').hidden=visible>0;}model.addEventListener('change',filter);result.addEventListener('change',filter);filter();})();</script></body></html>`;
}

module.exports = {
  buildComparison,
  renderHtml,
  renderComparisonHtml: renderHtml,
  compareRow,
  metrics,
  percentile,
};
