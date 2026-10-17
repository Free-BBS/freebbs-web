const { ModerationAiError } = require('./moderation-ai-client');
const { sanitizeDiagnostics } = require('./moderation-ai-diagnostics');
const { normalizePolicyDecision } = require('./moderation-policy-decision');

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

class ModerationManualReviewError extends Error {
  constructor(status, result) {
    super('机器结果未通过校验，已保留人工复核；模型提示尚未核实。');
    this.status = status;
    this.reviewResult = result;
  }
}

function aiTestEnvironmentEnabled(config) {
  const local = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
  try {
    const url = new URL(config.publicWebUrl);
    return Boolean(
      (!config.discussionModerationEnvironment ||
        config.discussionModerationEnvironment === 'test') &&
      config.discussionModerationEnabled &&
      config.discussionModerationAiTestEnabled &&
      local.has(config.apiHost) &&
      local.has(url.hostname) &&
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password,
    );
  } catch {
    return false;
  }
}

function createModerationAiTest({ service, client, audit, enabled = false }) {
  const reviewers = new Set();
  let running = 0;

  async function listModels({ reviewerId }) {
    if (!enabled) throw fail('本机 AI 试审尚未启用。', 503);
    if (!(await service.isReviewer(reviewerId))) throw fail('需要审核负责人权限。', 403);
    const catalog = await client.listModels();
    if (!(await service.isReviewer(reviewerId))) throw fail('需要审核负责人权限。', 403);
    return {
      defaultModel: catalog.defaultModel,
      models: catalog.models.map(({ id, label }) => ({ id, label })),
      settingsRevision: catalog.settingsRevision,
    };
  }

  async function run({ id, reviewerId, expectedVersion, inputMode, extraTerms = [], model }) {
    if (!enabled) throw fail('本机 AI 试审尚未启用。', 503);
    if (
      !['redacted', 'synthetic_original'].includes(inputMode) ||
      !Array.isArray(extraTerms) ||
      extraTerms.length > 50 ||
      extraTerms.some((term) => typeof term !== 'string' || !term.trim() || term.length > 128)
    )
      throw fail('试审模式或补充信息无效。');
    if (
      model !== undefined &&
      (typeof model !== 'string' ||
        (model !== '' && !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(model)))
    )
      throw fail('所选试审模型无效，请重新选择。');
    const actor = String(reviewerId);
    if (running >= 2 || reviewers.has(actor))
      throw fail('已有试审正在进行，请等待结果后再试。', 429);
    running += 1;
    reviewers.add(actor);
    const start = performance.now();
    try {
      // Each local transaction completes before any provider request starts.
      const snapshot =
        inputMode === 'redacted'
          ? await service.previewPrivacy({ id, reviewerId, expectedVersion, extraTerms })
          : await service.aiTestSnapshot({ id, reviewerId, expectedVersion });
      if (audit) await audit.prepare({ id, reviewerId, snapshot });
      const input = {
        title: snapshot.title,
        content: snapshot.content,
        inputMode,
        redactionCounts: inputMode === 'redacted' ? snapshot.counts : {},
        hasImages: snapshot.imageCount > 0,
        ...(model === undefined ? {} : { model }),
      };
      let response;
      let providerError;
      try {
        response = await client.assess(input);
      } catch (error) {
        // Never turn a rejected result into a successful assessment. Only errors
        // created by our client after a provider attempt have trusted metadata.
        if (
          !(error instanceof ModerationAiError) ||
          ![502, 504].includes(error.status) ||
          !error.reviewContext ||
          !sanitizeDiagnostics(error.diagnostics)
        )
          throw error;
        providerError = error;
        response = {
          ...error.reviewContext,
          assessment: null,
          policyDecision: normalizePolicyDecision(null, input),
          policyEvidence: [],
        };
      }
      // A late provider response cannot restore evidence or supersede a human decision.
      const current = await service.aiTestSnapshot({ id, reviewerId, expectedVersion });
      if (current.contentHash !== snapshot.contentHash)
        throw fail('稿件已变化，本次试审结果已失效，请刷新后重试。', 409);
      const result = {
        submissionId: id,
        version: snapshot.version,
        contentHash: snapshot.contentHash,
        inputMode,
        assessment: response.assessment,
        policyDecision: response.policyDecision,
        policyEvidence: response.policyEvidence,
        model: response.model,
        settingsRevision: response.settingsRevision,
        policyVersion: response.policyVersion,
        redactorVersion: inputMode === 'redacted' ? snapshot.redactorVersion : null,
        elapsedMs: Math.round(performance.now() - start),
        imageCount: snapshot.imageCount,
        imagesReviewed: false,
        automaticPublication: false,
        ...(providerError
          ? {
              manualReview: {
                required: true,
                validation: 'failed',
                diagnostics: sanitizeDiagnostics(providerError.diagnostics),
              },
            }
          : {}),
      };
      if (audit) result.runId = await audit.record({ id, reviewerId, snapshot, input, result });
      if (providerError) throw new ModerationManualReviewError(providerError.status, result);
      return result;
    } finally {
      running -= 1;
      reviewers.delete(actor);
    }
  }

  return { enabled: Boolean(enabled), run, listModels };
}

module.exports = { aiTestEnvironmentEnabled, createModerationAiTest, ModerationManualReviewError };
