const { performance } = require('node:perf_hooks');
const { aiTestEnvironmentEnabled } = require('./moderation-ai-test');
const { ModerationAiError, validateAssessment } = require('./moderation-ai-client');
const { sanitizeDiagnostics } = require('./moderation-ai-diagnostics');
const { POLICY_VERSION } = require('./moderation-policy');
const { normalizePolicyDecision } = require('./moderation-policy-decision');
const { buildAutomaticResult, IMAGE_MODEL } = require('./moderation-automation-result');
const { getReviewFocus, mergeReviewFocus } = require('./moderation-review-focus');

const PRIMARY_MODEL = 'qwen3.6-27b';
const BACKUP_MODEL = 'glm-5.1';
const POLL_INTERVAL_MS = 1000;
const MAINTENANCE_INTERVAL_MS = 30000;

function automationEnvironmentEnabled(config = {}) {
  return Boolean(
    aiTestEnvironmentEnabled(config) &&
    ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(config.db?.host) &&
    config.discussionModerationAutoTestEnabled === true &&
    (config.discussionModerationAutoModel ?? PRIMARY_MODEL) === PRIMARY_MODEL &&
    (config.discussionModerationBackupModel ?? BACKUP_MODEL) === BACKUP_MODEL,
  );
}

function imageAutomationEnabled(config = {}) {
  return (
    automationEnvironmentEnabled(config) &&
    config.discussionModerationAutoImagesEnabled === true &&
    (config.discussionModerationImageModel ?? IMAGE_MODEL) === IMAGE_MODEL
  );
}

function snapshotValid(snapshot, claim) {
  return Boolean(
    snapshot &&
    snapshot.submissionId === claim.submissionId &&
    Number.isSafeInteger(snapshot.version) &&
    snapshot.version === claim.submissionVersion &&
    snapshot.contentHash === claim.contentHash &&
    typeof snapshot.contentHash === 'string' &&
    /^[a-f0-9]{64}$/.test(snapshot.contentHash) &&
    typeof snapshot.inputHash === 'string' &&
    /^[a-f0-9]{64}$/.test(snapshot.inputHash) &&
    typeof snapshot.title === 'string' &&
    typeof snapshot.content === 'string' &&
    Number.isSafeInteger(snapshot.imageCount) &&
    snapshot.imageCount >= 0 &&
    snapshot.counts &&
    typeof snapshot.counts === 'object' &&
    !Array.isArray(snapshot.counts) &&
    Object.values(snapshot.counts).every((value) => Number.isSafeInteger(value) && value >= 0) &&
    typeof snapshot.redactorVersion === 'string' &&
    snapshot.redactorVersion.length > 0 &&
    snapshot.redactorVersion.length <= 80,
  );
}

function responseMetadataValid(response) {
  return Boolean(
    response?.model === PRIMARY_MODEL &&
    Number.isSafeInteger(response.settingsRevision) &&
    response.settingsRevision >= 0 &&
    response.policyVersion === POLICY_VERSION,
  );
}

function createModerationAutomation({
  store,
  client,
  imageClient,
  config,
  isEnabled = async () => false,
  logger = console,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
  now = () => performance.now(),
  pollIntervalMs = POLL_INTERVAL_MS,
}) {
  if (
    !store ||
    ['claim', 'prepare', 'finish', 'recover', 'purge'].some(
      (method) => typeof store[method] !== 'function',
    ) ||
    typeof client?.assess !== 'function' ||
    typeof isEnabled !== 'function'
  )
    throw new TypeError('自动审核组件配置不完整。');

  let started = false;
  let busy = false;
  let generation = 0;
  let timer = null;
  let nextMaintenance = 0;
  let nextWarning = 0;
  let lastOutcome = 'stopped';
  // Do not allow accidental tight loops even when a caller supplies a bad interval.
  const interval = Number.isFinite(pollIntervalMs)
    ? Math.max(1000, Math.min(2000, Math.round(pollIntervalMs)))
    : POLL_INTERVAL_MS;
  const environmentEnabled = () => automationEnvironmentEnabled(config);
  const current = (epoch) => started && generation === epoch && environmentEnabled();

  function status() {
    return {
      environmentEnabled: environmentEnabled(),
      running: started,
      busy,
      primaryModel: PRIMARY_MODEL,
      backupModel: BACKUP_MODEL,
      imageModel: IMAGE_MODEL,
      imagesEnabled: imageAutomationEnabled(config),
      lastOutcome,
    };
  }

  function warn() {
    const time = now();
    if (time < nextWarning) return;
    nextWarning = time + MAINTENANCE_INTERVAL_MS;
    try {
      // Never log an exception, provider response, snapshot, key or input text.
      logger?.warn?.('自动审核后台任务暂不可用；未处理的稿件继续保留人工审核。');
    } catch {
      // Logging must not create an unhandled worker rejection.
    }
  }

  function schedule(delay = interval) {
    if (!started || timer !== null || busy) return;
    timer = setTimeoutImpl(() => {
      timer = null;
      tick().catch(warn);
    }, delay);
    timer?.unref?.();
  }

  async function enabled(epoch) {
    if (!current(epoch)) return false;
    const allowed = (await isEnabled()) === true;
    return allowed && current(epoch);
  }

  function baseResult(claim, snapshot, startedAt) {
    return {
      submissionId: claim.submissionId,
      version: claim.submissionVersion,
      contentHash: claim.contentHash,
      inputHash: snapshot?.inputHash || null,
      source: 'automatic',
      executor: 'moderation-agent',
      inputMode: 'redacted',
      assessment: null,
      policyDecision: normalizePolicyDecision(null, {
        hasImages: snapshot?.imageCount > 0,
        redactionCounts: snapshot?.counts || {},
      }),
      policyEvidence: [],
      model: PRIMARY_MODEL,
      settingsRevision: null,
      policyVersion: POLICY_VERSION,
      redactorVersion: snapshot?.redactorVersion || null,
      elapsedMs: Math.max(0, Math.round(now() - startedAt)),
      imageCount: snapshot?.imageCount ?? null,
      imagesReviewed: false,
      automaticPublication: false,
      reviewFocus: mergeReviewFocus(
        snapshot?.reviewFocus,
        getReviewFocus({ title: snapshot?.title, content: snapshot?.content }),
      ),
    };
  }

  function notAttempted(claim, snapshot, startedAt, reason) {
    return {
      ...baseResult(claim, snapshot, startedAt),
      automationReason: reason,
      manualReview: {
        required: true,
        validation: 'not_attempted',
        reason: reason === 'image_requires_review' ? 'images_not_reviewed' : reason,
      },
    };
  }

  function failedResult(claim, snapshot, startedAt, error) {
    const trusted = error instanceof ModerationAiError;
    const diagnostics = trusted ? sanitizeDiagnostics(error.diagnostics) : null;
    const context =
      trusted && responseMetadataValid(error.reviewContext) ? error.reviewContext : null;
    if (diagnostics && !context) delete diagnostics.reviewSignal;
    const result = baseResult(claim, snapshot, startedAt);
    // Image errors retain only bounded structural diagnostics, never raw replies.
    const { ModerationImageError, safeImageError } = require('./moderation-image-client');
    const imageDiagnostics =
      error instanceof ModerationImageError ? safeImageError(error).diagnostics : null;
    if (context) result.settingsRevision = context.settingsRevision;
    return {
      ...result,
      automationReason:
        trusted && error.status === 503 ? 'configuration_invalid' : 'provider_failure',
      manualReview: {
        required: true,
        validation: 'failed',
        // Unknown errors remain a fixed local failure; their contents never persist.
        ...(diagnostics ? { diagnostics } : {}),
        ...(imageDiagnostics ? { imageDiagnostics } : {}),
      },
    };
  }

  async function processClaim(claim, epoch) {
    const startedAt = now();
    let snapshot;
    let result;
    try {
      snapshot = await store.prepare(claim);
      if (!snapshotValid(snapshot, claim)) {
        snapshot = null;
        result = notAttempted(claim, null, startedAt, 'snapshot_invalid');
      } else {
        // Store snapshots are copied before any await or model call can mutate them.
        snapshot = structuredClone(snapshot);
        const localFocus = mergeReviewFocus(
          snapshot.reviewFocus,
          getReviewFocus({ title: snapshot.title, content: snapshot.content }),
        );
        if (!(await enabled(epoch))) {
          result = notAttempted(
            claim,
            snapshot,
            startedAt,
            current(epoch) ? 'worker_paused' : 'worker_stopped',
          );
        } else if (localFocus.political || localFocus.psychological) {
          result = notAttempted(claim, snapshot, startedAt, 'focus_requires_review');
        } else if (snapshot.imageCount > 0 && !imageAutomationEnabled(config)) {
          result = notAttempted(claim, snapshot, startedAt, 'image_requires_review');
        } else {
          const input = Object.freeze({
            title: snapshot.title,
            content: snapshot.content,
            inputMode: 'redacted',
            redactionCounts: Object.freeze({ ...snapshot.counts }),
            hasImages: false,
            model: PRIMARY_MODEL,
            requireReviewTopics: true,
          });
          let response;
          try {
            // Exactly one attempt. GLM is a manual alternative, never a retry path.
            response = await client.assess(input);
            if (!responseMetadataValid(response)) {
              result = notAttempted(claim, snapshot, startedAt, 'assessment_invalid');
              result.manualReview.validation = 'failed';
            } else {
              const assessment = validateAssessment(response.assessment, input, {
                requireReviewTopics: true,
              });
              const textResult = {
                assessment,
                model: PRIMARY_MODEL,
                requireReviewTopics: true,
                settingsRevision: response.settingsRevision,
                policyVersion: POLICY_VERSION,
              };
              const imageResults = [];
              const textFocus = mergeReviewFocus(
                snapshot.reviewFocus,
                getReviewFocus({
                  title: snapshot.title,
                  content: snapshot.content,
                  assessments: [assessment],
                }),
              );
              if (
                snapshot.imageCount > 0 &&
                normalizePolicyDecision(assessment, input).recommendedAction === 'allow' &&
                !textFocus.political &&
                !textFocus.psychological
              ) {
                if (
                  !Array.isArray(snapshot.images) ||
                  snapshot.images.length !== snapshot.imageCount ||
                  snapshot.images.length > 12 ||
                  typeof imageClient?.assess !== 'function'
                )
                  throw new Error('image_snapshot_invalid');
                for (let offset = 0; offset < snapshot.images.length; offset += 3) {
                  if (!(await enabled(epoch))) throw new Error('worker_paused');
                  const batch = snapshot.images.slice(offset, offset + 3);
                  const imageResponse = await imageClient.assess({
                    model: IMAGE_MODEL,
                    requireReviewTopics: true,
                    title: snapshot.title,
                    content: snapshot.content,
                    images: batch.map((image) => ({
                      mimeType: image.mimeType,
                      dataBase64: image.dataBase64,
                    })),
                  });
                  imageResults.push({
                    attachmentIds: batch.map((image) => image.id),
                    response: imageResponse,
                  });
                  const checkedCount = offset + batch.length;
                  const partial = buildAutomaticResult({
                    textResult,
                    imageResults,
                    snapshot: {
                      ...snapshot,
                      imageCount: checkedCount,
                      images: snapshot.images.slice(0, checkedCount),
                    },
                  });
                  if (partial.policyDecision.recommendedAction !== 'allow') break;
                }
              }
              result = buildAutomaticResult({
                textResult,
                imageResults,
                snapshot,
                elapsedMs: Math.max(0, Math.round(now() - startedAt)),
              });
            }
          } catch (error) {
            result = failedResult(claim, snapshot, startedAt, error);
          }
        }
      }
    } catch {
      result = notAttempted(claim, snapshot, startedAt, 'snapshot_invalid');
      warn();
    }
    // The store also locks/rechecks the persistent pause revision, submission,
    // version, lease and content hash. This callback closes the local stop race.
    let allowed = false;
    try {
      allowed = await enabled(epoch);
    } catch {
      warn();
    }
    const outcome = await store.finish(claim, result, {
      canApply: () => allowed && current(epoch),
    });
    return outcome;
  }

  async function tick() {
    if (!started) return { status: 'stopped' };
    if (busy) return { status: 'busy' };
    if (timer !== null) {
      clearTimeoutImpl(timer);
      timer = null;
    }
    busy = true;
    const epoch = generation;
    try {
      if (!environmentEnabled()) {
        lastOutcome = 'disabled';
        return { status: lastOutcome };
      }
      // Retention and lease recovery continue while the administrator pauses new calls.
      if (now() >= nextMaintenance) {
        await store.recover();
        await store.purge();
        nextMaintenance = now() + MAINTENANCE_INTERVAL_MS;
      }
      if (!(await enabled(epoch))) {
        lastOutcome = current(epoch) ? 'paused' : 'stopped';
        return { status: lastOutcome };
      }
      const claim = await store.claim();
      if (!claim) {
        lastOutcome = 'idle';
        return { status: lastOutcome };
      }
      await processClaim(claim, epoch);
      lastOutcome = current(epoch) ? 'processed' : 'stopped';
      return { status: lastOutcome };
    } catch {
      // A failed claim completion stays leased and is recovered to manual review.
      // It is never automatically resubmitted to the provider.
      lastOutcome = 'unavailable';
      warn();
      return { status: lastOutcome };
    } finally {
      busy = false;
      schedule();
    }
  }

  function start() {
    if (started) return status();
    if (!environmentEnabled()) {
      lastOutcome = 'disabled';
      return status();
    }
    started = true;
    generation += 1;
    nextMaintenance = 0;
    lastOutcome = 'starting';
    schedule(0);
    return status();
  }

  function stop() {
    started = false;
    generation += 1;
    lastOutcome = 'stopped';
    if (timer !== null) clearTimeoutImpl(timer);
    timer = null;
    return status();
  }

  return { start, tick, stop, status };
}

module.exports = {
  PRIMARY_MODEL,
  BACKUP_MODEL,
  automationEnvironmentEnabled,
  imageAutomationEnabled,
  createModerationAutomation,
};
