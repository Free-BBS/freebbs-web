const express = require('express');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const ID = /^[1-9]\d{0,18}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/;
const TOOLS = ['content', 'resources', 'feedback', 'continue', 'notes', 'contribute'];
const ACTIONS = [
  'visit',
  'tool_open',
  'path_save',
  'path_complete',
  'annotation_save',
  'contribution_submit',
  'mark_learned',
  'learning_start_set',
  'recommendation_choose',
];
const LEVELS = ['new', 'familiar', 'basic', 'advanced'];
const GOALS = ['concepts', 'practice', 'explore'];
const PATH_TYPES = ['recommended', 'alternative', 'custom'];
const CHOICE_FIELDS = ['level', 'goal', 'pathType', 'documentVersion'];
const SCOPE = 'learning_analytics_only';
const RECORDING_POLICY = Object.freeze({
  mode: 'required_minimal',
  version: 2,
  defaultEnabled: true,
  canDisable: false,
});
const ENABLE_RECORDING_SQL = `INSERT INTO learning_analytics_preferences
  (user_id, enabled, last_engagement_at, updated_at)
  VALUES (?, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE
  last_engagement_at = IF(enabled <> 1, UTC_TIMESTAMP(3), last_engagement_at),
  updated_at = IF(enabled <> 1, UTC_TIMESTAMP(3), updated_at), enabled = 1`;
const BROWSER_QUOTA = 120;
const QUOTA_WINDOW_SECONDS = 60;
function quotaError(remainingSeconds) {
  const error = new AnalyticsError(429, '学习过程记录提交过于频繁，请稍后再试');
  error.retryAfterSeconds = Math.max(1, Math.min(60, Math.ceil(remainingSeconds)));
  return error;
}
class AnalyticsError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
function plain(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}
function allowedKeys(value, keys) {
  if (!plain(value) || Object.keys(value).some((key) => !keys.includes(key)))
    throw new AnalyticsError(400, '过程记录仅支持规定字段，不接收文字内容或作答');
}
function validateClientEvent(value) {
  allowedKeys(value, ['requestKey', 'courseSlug', 'nodeId', 'type', 'deltaSeconds', 'metadata']);
  if (
    typeof value.requestKey !== 'string' ||
    !UUID.test(value.requestKey) ||
    typeof value.courseSlug !== 'string' ||
    !SLUG.test(value.courseSlug) ||
    typeof value.nodeId !== 'string' ||
    value.nodeId.length > 120 ||
    !require('./course-maps').isValidNodeId(value.nodeId) ||
    !['navigation', 'engagement', 'action'].includes(value.type)
  )
    throw new AnalyticsError(400, '课程、知识点或过程事件类型无效');
  const delta = value.deltaSeconds === undefined ? 0 : value.deltaSeconds;
  if (
    !Number.isInteger(delta) ||
    delta < 0 ||
    delta > 30 ||
    (value.type !== 'engagement' && delta !== 0)
  )
    throw new AnalyticsError(400, '活跃时间每次最多记录 30 秒');
  const metadata = value.metadata === undefined ? {} : value.metadata;
  allowedKeys(metadata, ['tool', 'action', 'sessionId', ...CHOICE_FIELDS]);
  if (
    (metadata.tool !== undefined && !TOOLS.includes(metadata.tool)) ||
    (metadata.action !== undefined && !ACTIONS.includes(metadata.action)) ||
    (metadata.sessionId !== undefined &&
      (typeof metadata.sessionId !== 'string' || !UUID.test(metadata.sessionId)))
  )
    throw new AnalyticsError(400, '过程记录元数据无效');
  const choice = ['learning_start_set', 'recommendation_choose'].includes(metadata.action);
  if (
    (!choice && CHOICE_FIELDS.some((key) => metadata[key] !== undefined)) ||
    (choice && value.type !== 'action') ||
    (metadata.level !== undefined && !LEVELS.includes(metadata.level)) ||
    (metadata.goal !== undefined && metadata.goal !== null && !GOALS.includes(metadata.goal)) ||
    (metadata.pathType !== undefined && !PATH_TYPES.includes(metadata.pathType)) ||
    (metadata.documentVersion !== undefined &&
      (typeof metadata.documentVersion !== 'string' ||
        !/^[a-f0-9]{64}$/.test(metadata.documentVersion))) ||
    (metadata.action === 'learning_start_set' &&
      (!LEVELS.includes(metadata.level) || metadata.pathType !== undefined)) ||
    (metadata.action === 'recommendation_choose' && !PATH_TYPES.includes(metadata.pathType))
  )
    throw new AnalyticsError(400, '学习选择只接收明确的起点、目的和路径枚举');
  if (value.type === 'navigation' && !['visit', 'tool_open'].includes(metadata.action))
    throw new AnalyticsError(400, '导航事件需要规定的访问动作');
  if (
    value.type === 'action' &&
    (!metadata.action || ['visit', 'tool_open'].includes(metadata.action))
  )
    throw new AnalyticsError(400, '操作事件需要规定的动作');
  if (value.type === 'engagement' && (!metadata.sessionId || metadata.action !== undefined))
    throw new AnalyticsError(400, '活跃事件需要会话编号且不能同时提交操作');
  return {
    requestKey: value.requestKey.toLowerCase(),
    courseSlug: value.courseSlug,
    nodeId: value.nodeId,
    type: value.type,
    source: 'browser',
    deltaSeconds: delta,
    metadata: Object.fromEntries(
      ['tool', 'action', 'sessionId', ...CHOICE_FIELDS]
        .filter((key) => metadata[key] !== undefined)
        .map((key) => [key, key === 'sessionId' ? metadata[key].toLowerCase() : metadata[key]]),
    ),
  };
}
function windowStart(value, now = new Date()) {
  const window = value ?? '30';
  if (!['7', '30', 'all'].includes(window))
    throw new AnalyticsError(400, '统计范围只能为 7、30 或 all');
  return {
    window,
    since: window === 'all' ? null : new Date(now.getTime() - Number(window) * 86400000),
  };
}
function sqlDate(value) {
  return new Date(value).toISOString().replace('T', ' ').replace('Z', '');
}
function iso(value) {
  if (!value) return null;
  const utc =
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)
      ? `${value.replace(' ', 'T')}Z`
      : value;
  return new Date(utc).toISOString();
}
function preference(row) {
  return { enabled: true, updatedAt: iso(row?.updated_at), policy: RECORDING_POLICY };
}
function requireEnabled(enabled) {
  if (enabled !== true)
    throw new AnalyticsError(
      409,
      '平台默认记录必要学习过程；可导出或清空历史，清空后继续记录新过程。',
    );
}
function fingerprint(context, event) {
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        courseId: String(context.course_id),
        nodeId: context.node_id,
        type: event.type,
        source: event.source,
        deltaSeconds: event.deltaSeconds,
        metadata: event.metadata,
      }),
    )
    .digest('hex');
}
function toEvent(row) {
  const metadata =
    typeof row.metadata_json === 'string' ? JSON.parse(row.metadata_json) : row.metadata_json;
  return {
    id: String(row.id),
    courseSlug: row.course_slug || row.slug || '',
    nodeId: row.node_id,
    type: row.event_type,
    source: row.event_source,
    deltaSeconds: Number(row.delta_seconds),
    metadata,
    createdAt: iso(row.created_at),
  };
}
function zeroProcess() {
  return {
    eventCount: 0,
    visits: 0,
    activeSeconds: 0,
    actions: 0,
    manualMarks: 0,
    assessmentEvents: 0,
  };
}
function zeroSelftest() {
  return {
    attempts: 0,
    officialAttempts: 0,
    passed: 0,
    failed: 0,
    pendingReview: 0,
    practiceAttempts: 0,
  };
}
function processCounts(row) {
  return {
    eventCount: Number(row.event_count || 0),
    visits: Number(row.visits || 0),
    activeSeconds: Number(row.active_seconds || 0),
    actions: Number(row.actions || 0),
    manualMarks: Number(row.manual_marks || 0),
    assessmentEvents: Number(row.assessment_events || 0),
  };
}
function selftestCounts(row) {
  return {
    attempts: Number(row.attempts || 0),
    officialAttempts: Number(row.official_attempts || 0),
    passed: Number(row.passed || 0),
    failed: Number(row.failed || 0),
    pendingReview: Number(row.pending_review || 0),
    practiceAttempts: Number(row.practice_attempts || 0),
  };
}
function sumCounts(rows, initial, convert) {
  return rows.reduce((totals, row) => {
    const values = convert(row);
    return Object.fromEntries(Object.keys(totals).map((key) => [key, totals[key] + values[key]]));
  }, initial);
}
function assessmentDataStatus(rows) {
  return rows.available === false ? 'not_available' : 'available';
}
function selftestSummary(rows) {
  return {
    ...sumCounts(rows, zeroSelftest(), selftestCounts),
    assessmentDataStatus: assessmentDataStatus(rows),
  };
}
function evidenceCounts(rows) {
  const comparable = rows.filter((row) => Number(row.graded_attempt_count) >= 2);
  const failed = comparable.filter((row) => row.first_verdict === 'fail');
  const improved = failed.filter((row) => row.last_verdict === 'pass');
  const notRetried = rows.filter(
    (row) => Number(row.graded_attempt_count) === 1 && row.first_verdict === 'fail',
  );
  const regressed = comparable.filter(
    (row) => row.first_verdict === 'pass' && row.last_verdict === 'fail',
  );
  const learners = (entries) => new Set(entries.map((row) => String(row.user_id))).size;
  return {
    gradedSequences: rows.length,
    firstPassSequences: rows.filter((row) => row.first_verdict === 'pass').length,
    firstFailSequences: rows.filter((row) => row.first_verdict === 'fail').length,
    sequenceUnit: 'learner_course_node_question_document_and_question_version',
    comparableSequences: comparable.length,
    comparableLearners: learners(comparable),
    failedComparableSequences: failed.length,
    failedComparableLearners: learners(failed),
    improvedSequences: improved.length,
    improvedLearners: learners(improved),
    notRetriedFailedSequences: notRetried.length,
    notRetriedFailedLearners: learners(notRetried),
    regressedSequences: regressed.length,
    regressedLearners: learners(regressed),
    limitedSample: learners(comparable) < 5,
  };
}
function learningEvidence(evidenceRows, businessRows, participationRows) {
  const courses = new Map();
  evidenceRows.forEach((row) => {
    const id = String(row.course_id);
    if (!courses.has(id))
      courses.set(id, {
        courseId: id,
        courseSlug: row.course_slug,
        courseName: row.course_name || row.course_slug,
        rows: [],
      });
    courses.get(id).rows.push(row);
  });
  const participation = (kind, allowed) =>
    allowed
      .map((value) => {
        const entries = participationRows.filter((row) => row.kind === kind && row.value === value);
        return {
          [kind === 'tool' ? 'tool' : 'action']: value,
          users: new Set(entries.map((row) => String(row.user_id))).size,
          events: entries.reduce((total, row) => total + Number(row.event_count || 0), 0),
        };
      })
      .filter((row) => row.events > 0);
  return {
    ...evidenceCounts(evidenceRows),
    officialLearners: new Set(
      businessRows
        .filter((row) => Number(row.official_attempts) > 0)
        .map((row) => String(row.user_id)),
    ).size,
    courses: [...courses.values()].map(({ rows, ...course }) => ({
      ...course,
      ...evidenceCounts(rows),
    })),
    tools: participation('tool', TOOLS),
    actions: participation('action', ['path_save', 'annotation_save', 'contribution_submit']),
    scope: 'within_window_same_question_and_document_version',
    assessmentDataStatus: evidenceRows.available === false ? 'not_available' : 'available',
    interpretation: '行为与结果证据不能单独证明平台因果效果；同题复测不等于长期掌握或迁移。',
  };
}
function eventMetadata(row) {
  try {
    const data =
      typeof row.metadata_json === 'string' ? JSON.parse(row.metadata_json) : row.metadata_json;
    return plain(data) ? data : {};
  } catch {
    return {};
  }
}
function orderedRows(rows) {
  return [...rows].sort((a, b) => {
    const time = new Date(iso(a.created_at)).getTime() - new Date(iso(b.created_at)).getTime();
    if (time) return time;
    const left = BigInt(a.id || 0);
    const right = BigInt(b.id || 0);
    if (left < right) return -1;
    return left > right ? 1 : 0;
  });
}
function startChoice(row) {
  const data = eventMetadata(row);
  if (data.action !== 'learning_start_set' || !LEVELS.includes(data.level)) return null;
  return {
    level: data.level,
    goal: GOALS.includes(data.goal) ? data.goal : null,
    documentVersion: /^[a-f0-9]{64}$/.test(data.documentVersion || '')
      ? data.documentVersion
      : null,
    selectedAt: iso(row.created_at),
  };
}
function unitSequences(attempts) {
  const groups = new Map();
  for (const row of orderedRows(attempts)) {
    if (
      !Number(row.is_official) ||
      row.status !== 'graded' ||
      !['pass', 'fail'].includes(row.verdict) ||
      !row.question_id ||
      !row.document_version ||
      !row.question_version
    )
      continue;
    const key = JSON.stringify([row.question_id, row.document_version, row.question_version]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const sequences = [...groups.values()];
  return {
    repeatedQuestions: sequences.filter((rows) => rows.length > 1).length,
    correctedQuestions: sequences.filter(
      (rows) => rows[0].verdict === 'fail' && rows.slice(1).some((row) => row.verdict === 'pass'),
    ).length,
    waitingForRetryQuestions: sequences.filter((rows) => rows.at(-1).verdict === 'fail').length,
  };
}
// The denominator is an observed learner × course × node, not a claim of enrolment or ability.
// A first explicit choice is never retroactively replaced by a later correction.
function journeyEvidence(eventRows, attemptRows, { personal = false } = {}) {
  const units = new Map();
  const getUnit = (row) => {
    const key = JSON.stringify([String(row.user_id), String(row.course_id), row.node_id]);
    if (!units.has(key))
      units.set(key, {
        userId: String(row.user_id),
        courseId: String(row.course_id),
        courseSlug: row.course_slug || '',
        courseName: row.course_name || row.course_slug || '',
        nodeId: row.node_id,
        nodeName: row.node_name || row.node_id,
        events: [],
        attempts: [],
      });
    return units.get(key);
  };
  eventRows.forEach((row) => getUnit(row).events.push(row));
  attemptRows.forEach((row) => getUnit(row).attempts.push(row));
  const cohorts = new Map();
  let classifiedUnits = 0;
  let missingGoalUnits = 0;
  let revisedUnits = 0;
  let unknownChoiceVersionUnits = 0;
  let preChoiceAttemptUnits = 0;
  let ambiguousTimeUnits = 0;
  const ownUnits = [];
  for (const unit of units.values()) {
    const starts = orderedRows(unit.events).map(startChoice).filter(Boolean);
    const first = starts[0] || null;
    const latest = starts.at(-1) || null;
    const revisions = starts.filter(
      (value, index) =>
        index > 0 &&
        (value.level !== starts[index - 1].level || value.goal !== starts[index - 1].goal),
    ).length;
    if (revisions) revisedUnits += 1;
    const relevant = first
      ? unit.attempts.filter(
          (row) =>
            new Date(iso(row.created_at)) > new Date(first.selectedAt) &&
            (!first.documentVersion || row.document_version === first.documentVersion),
        )
      : [];
    const explorationIds = new Set(
      unit.events
        .filter(
          (row) =>
            row.event_source === 'server' &&
            row.event_type === 'assessment' &&
            eventMetadata(row).assessmentRole === 'exploration',
        )
        .map((row) => String(eventMetadata(row).attemptId || '')),
    );
    const roleLinkedPracticeIds = new Set(
      unit.events
        .filter(
          (row) =>
            row.event_source === 'server' &&
            row.event_type === 'assessment' &&
            ['practice', 'exploration'].includes(eventMetadata(row).assessmentRole),
        )
        .map((row) => String(eventMetadata(row).attemptId || '')),
    );
    const sequences = unitSequences(relevant);
    if (first) {
      classifiedUnits += 1;
      if (!first.goal) missingGoalUnits += 1;
      if (!first.documentVersion) unknownChoiceVersionUnits += 1;
      if (unit.attempts.some((row) => new Date(iso(row.created_at)) < new Date(first.selectedAt)))
        preChoiceAttemptUnits += 1;
      if (unit.attempts.some((row) => iso(row.created_at) === first.selectedAt))
        ambiguousTimeUnits += 1;
      const key = JSON.stringify([first.level, first.goal]);
      if (!cohorts.has(key))
        cohorts.set(key, {
          level: first.level,
          goal: first.goal,
          units: 0,
          userIds: new Set(),
          selectedPathUnits: 0,
          attemptedUnits: 0,
          practiceUnits: 0,
          officialAttemptUnits: 0,
          gradedOfficialUnits: 0,
          retryUnits: 0,
          correctedUnits: 0,
          explorationChoiceUnits: 0,
          explorationAttemptUnits: 0,
          contributionUnits: 0,
        });
      const cohort = cohorts.get(key);
      const choices = unit.events.filter(
        (row) => new Date(iso(row.created_at)) >= new Date(first.selectedAt),
      );
      const selectedPaths = choices
        .map(eventMetadata)
        .filter(
          (data) => data.action === 'recommendation_choose' && PATH_TYPES.includes(data.pathType),
        );
      cohort.units += 1;
      cohort.userIds.add(unit.userId);
      cohort.selectedPathUnits += selectedPaths.length ? 1 : 0;
      cohort.attemptedUnits += relevant.length ? 1 : 0;
      cohort.practiceUnits += relevant.some((row) => !Number(row.is_official)) ? 1 : 0;
      cohort.officialAttemptUnits += relevant.some((row) => Number(row.is_official)) ? 1 : 0;
      cohort.gradedOfficialUnits += relevant.some(
        (row) =>
          Number(row.is_official) &&
          row.status === 'graded' &&
          ['pass', 'fail'].includes(row.verdict),
      )
        ? 1
        : 0;
      cohort.retryUnits += sequences.repeatedQuestions ? 1 : 0;
      cohort.correctedUnits += sequences.correctedQuestions ? 1 : 0;
      cohort.explorationChoiceUnits += selectedPaths.some((data) => data.goal === 'explore')
        ? 1
        : 0;
      cohort.explorationAttemptUnits += relevant.some((row) => explorationIds.has(String(row.id)))
        ? 1
        : 0;
      cohort.contributionUnits += choices.some(
        (row) => eventMetadata(row).action === 'contribution_submit',
      )
        ? 1
        : 0;
    }
    if (personal) {
      const allSequences = unitSequences(unit.attempts);
      ownUnits.push({
        courseId: unit.courseId,
        courseSlug: unit.courseSlug,
        courseName: unit.courseName,
        nodeId: unit.nodeId,
        nodeName: unit.nodeName,
        assessmentDataStatus: assessmentDataStatus(attemptRows),
        initialChoice: first,
        currentChoice: latest,
        revisions,
        attempts: unit.attempts.length,
        officialAttempts: unit.attempts.filter((row) => Number(row.is_official)).length,
        practiceAttempts: unit.attempts.filter((row) => !Number(row.is_official)).length,
        passedAttempts: unit.attempts.filter(
          (row) => Number(row.is_official) && row.status === 'graded' && row.verdict === 'pass',
        ).length,
        pendingReview: unit.attempts.filter((row) => row.status === 'pending_review').length,
        explorationAttempts: new Set(
          unit.attempts
            .filter((row) => explorationIds.has(String(row.id)))
            .map((row) => String(row.id)),
        ).size,
        explorationEvidenceKnown: unit.attempts
          .filter((row) => !Number(row.is_official))
          .every((row) => roleLinkedPracticeIds.has(String(row.id))),
        explorationUnattributedAttempts: unit.attempts.filter(
          (row) => !Number(row.is_official) && !roleLinkedPracticeIds.has(String(row.id)),
        ).length,
        ...allSequences,
        lastEvidenceAt: orderedRows([...unit.events, ...unit.attempts]).at(-1)?.created_at
          ? iso(orderedRows([...unit.events, ...unit.attempts]).at(-1).created_at)
          : null,
      });
    }
  }
  const result = {
    assessmentDataStatus: assessmentDataStatus(attemptRows),
    unit: 'learner_course_node',
    observedUnits: units.size,
    learners: new Set([...units.values()].map((unit) => unit.userId)).size,
    classifiedUnits,
    missingStartUnits: units.size - classifiedUnits,
    missingGoalUnits,
    revisedUnits,
    unknownChoiceVersionUnits,
    preChoiceAttemptUnits,
    ambiguousTimeUnits,
    cohorts: [...cohorts.values()].map(({ userIds, ...cohort }) => ({
      ...cohort,
      assessmentDataStatus: assessmentDataStatus(attemptRows),
      learners: userIds.size,
      limitedSample: userIds.size < 5,
    })),
    delayedReview: { status: 'not_collected' },
    transfer: { status: 'not_collected' },
    scope: 'first_explicit_choice_in_window_and_subsequent_observed_actions',
    interpretation:
      '起点为学生自报，不是能力判定；漏斗只描述本期选择与后续记录。同题订正不等于长期保持或迁移，也不能证明平台因果效果。',
  };
  if (personal) {
    ownUnits.sort((a, b) => new Date(b.lastEvidenceAt) - new Date(a.lastEvidenceAt));
    result.units = ownUnits.slice(0, 200);
    result.omittedUnits = Math.max(0, ownUnits.length - 200);
  }
  return result;
}
function observedUnits(eventRows, attemptRows) {
  const units = new Map();
  for (const [rows, field] of [
    [eventRows, 'events'],
    [attemptRows, 'attempts'],
  ])
    for (const row of rows) {
      const key = JSON.stringify([String(row.user_id), String(row.course_id), row.node_id]);
      if (!units.has(key))
        units.set(key, {
          userId: String(row.user_id),
          courseId: String(row.course_id),
          courseSlug: row.course_slug || '',
          courseName: row.course_name || row.course_slug || '',
          nodeId: row.node_id,
          nodeName: row.node_name || row.node_id,
          events: [],
          attempts: [],
        });
      units.get(key)[field].push(row);
    }
  return [...units.values()];
}
function latestOfficialRows(attemptRows) {
  const latest = new Map();
  for (const row of orderedRows(attemptRows))
    if (Number(row.is_official) === 1 && row.question_id) latest.set(String(row.question_id), row);
  return [...latest.values()];
}
function personalInsights(eventRows, attemptRows) {
  const units = observedUnits(eventRows, attemptRows);
  const suggestions = [];
  let needsReviewCount = 0;
  let waitingForRetryCount = 0;
  for (const unit of units) {
    const latest = latestOfficialRows(unit.attempts);
    // Pending review is a submission backlog, not the latest formal question state.
    // Practice/exploration and older still-pending attempts remain in the real review queue.
    const pending = unit.attempts.filter((row) => row.status === 'pending_review');
    const failed = latest.filter((row) => row.status === 'graded' && row.verdict === 'fail');
    needsReviewCount += pending.length;
    waitingForRetryCount += failed.length;
    const location = {
      courseSlug: unit.courseSlug,
      courseName: unit.courseName,
      nodeId: unit.nodeId,
      nodeName: unit.nodeName,
    };
    const add = (id, reasonLabel, tool, reason, extra = {}) => {
      suggestions.push({ id, ...location, reasonLabel, tool, reason, ...extra });
    };
    if (failed.length)
      add(
        'revisit_recorded_question',
        '回看待订正的自测',
        'feedback',
        '最近一次已记录的正式作答有待订正处；可回看原有反馈，也可继续自己的计划。',
        {
          quizView: 'mistakes',
          evidence: { basis: 'latest_observed_official_attempt', count: failed.length },
        },
      );
    if (pending.length)
      add(
        'pending_review',
        '查看待复核作答',
        'feedback',
        '有作答仍在等待复核；可查看记录，不必反复提交，也可以先学习其他内容。',
        {
          quizView: pending.some((row) => Number(row.is_official) === 1) ? 'quick' : 'practice',
          evidence: { basis: 'observed_pending_review_submission', count: pending.length },
        },
      );
    if (!failed.length && !pending.length) {
      const last = orderedRows(unit.events).at(-1);
      if (unit.attempts.some((row) => Number(row.is_official) === 0))
        add(
          'continue_practice',
          '回到已有练习',
          'feedback',
          '你在这里有练习记录，可回看反馈或继续尝试；练习不计正式自测。',
          { quizView: 'practice', evidence: { basis: 'observed_practice_submission' } },
        );
      else if (unit.events.some((row) => eventMetadata(row).action === 'annotation_save'))
        add(
          'review_annotation',
          '回看自己的批注',
          'notes',
          '这里有过批注保存，可回到原文核对自己的疑点；记录页不读取批注内容。',
          { evidence: { basis: 'annotation_save_action' } },
        );
      else if (last)
        add(
          'resume_reading',
          '回到这个知识点',
          'content',
          '这里有学习过程记录，可继续查阅，也可以只查清一个问题后暂停。',
          { evidence: { basis: 'observed_process_event' } },
        );
    }
  }
  const order = {
    revisit_recorded_question: 0,
    pending_review: 1,
    continue_practice: 2,
    review_annotation: 3,
    resume_reading: 4,
  };
  suggestions.sort((left, right) => order[left.id] - order[right.id]);
  return {
    nextSteps: suggestions.slice(0, 3),
    needsReviewCount,
    waitingForRetryCount,
    assessmentDataStatus: attemptRows.available === false ? 'not_available' : 'available',
    scope: 'latest_observed_official_submission_per_question_in_selected_window',
    reviewScope: 'all_observed_pending_submissions_in_selected_window',
    interpretation:
      '仅供选择下一步，不改变已保存路径。历史版本结果不能认定当前知识掌握；课程更新后需在知识点内核对当前题目。',
  };
}
function analyticsDiagnostics(eventRows, attemptRows, users, journey, processRows = eventRows) {
  const units = observedUnits(eventRows, attemptRows);
  // Coverage includes heartbeat-only process records; journey observations intentionally
  // project only navigation, actions and assessment events for ordered pathway evidence.
  const processUsers = new Set(processRows.map((row) => String(row.user_id)));
  const businessUsers = new Set(attemptRows.map((row) => String(row.user_id)));
  const after = (row, first) => new Date(iso(row.created_at)) > new Date(iso(first.created_at));
  const transitions = [
    { id: 'reading_to_attempt', label: '记录阅读 → 之后作答', fromUnits: 0, progressedUnits: 0 },
    { id: 'practice_to_selftest', label: '练习 → 之后正式自测', fromUnits: 0, progressedUnits: 0 },
    {
      id: 'formal_fail_to_retry',
      label: '正式未通过 → 之后复测',
      fromUnits: 0,
      progressedUnits: 0,
    },
  ];
  const attention = new Map();
  let explorationUnattributedAttempts = 0;
  for (const unit of units) {
    const events = orderedRows(unit.events);
    const attempts = orderedRows(unit.attempts);
    const roleLinked = new Set(
      events
        .filter(
          (row) =>
            row.event_source === 'server' &&
            row.event_type === 'assessment' &&
            ['practice', 'exploration'].includes(eventMetadata(row).assessmentRole),
        )
        .map((row) => String(eventMetadata(row).attemptId || '')),
    );
    explorationUnattributedAttempts += attempts.filter(
      (row) => !Number(row.is_official) && !roleLinked.has(String(row.id)),
    ).length;
    const reading = events.find(
      (row) => row.event_type === 'navigation' && eventMetadata(row).tool === 'content',
    );
    if (reading) {
      transitions[0].fromUnits += 1;
      if (attempts.some((row) => after(row, reading))) transitions[0].progressedUnits += 1;
    }
    const practice = attempts.find((row) => Number(row.is_official) === 0);
    if (practice) {
      transitions[1].fromUnits += 1;
      if (
        attempts.some(
          (row) =>
            Number(row.is_official) === 1 &&
            after(row, practice) &&
            row.document_version &&
            row.document_version === practice.document_version,
        )
      )
        transitions[1].progressedUnits += 1;
    }
    const failed = attempts.filter(
      (row) =>
        Number(row.is_official) === 1 &&
        row.status === 'graded' &&
        row.verdict === 'fail' &&
        row.question_id &&
        row.document_version &&
        row.question_version,
    );
    if (failed.length) {
      transitions[2].fromUnits += 1;
      if (
        failed.some((first) =>
          attempts.some(
            (row) =>
              Number(row.is_official) === 1 &&
              after(row, first) &&
              row.question_id === first.question_id &&
              row.document_version === first.document_version &&
              row.question_version === first.question_version,
          ),
        )
      )
        transitions[2].progressedUnits += 1;
    }
    const latest = latestOfficialRows(attempts);
    const pendingReviewAttempts = attempts.filter((row) => row.status === 'pending_review').length;
    const waitingForRetryQuestions = latest.filter(
      (row) => row.status === 'graded' && row.verdict === 'fail',
    ).length;
    if (pendingReviewAttempts || waitingForRetryQuestions) {
      const key = JSON.stringify([unit.courseId, unit.nodeId]);
      if (!attention.has(key))
        attention.set(key, {
          courseSlug: unit.courseSlug,
          courseName: unit.courseName,
          nodeId: unit.nodeId,
          nodeName: unit.nodeName,
          pendingReviewAttempts: 0,
          waitingForRetryQuestions: 0,
        });
      const current = attention.get(key);
      current.pendingReviewAttempts += pendingReviewAttempts;
      current.waitingForRetryQuestions += waitingForRetryQuestions;
    }
  }
  return {
    assessmentDataStatus: assessmentDataStatus(attemptRows),
    coverage: {
      eligibleUsers: users.length,
      processLearners: processUsers.size,
      businessLearners: businessUsers.size,
      observedLearners: new Set([...processUsers, ...businessUsers]).size,
      businessOnlyLearners: [...businessUsers].filter((id) => !processUsers.has(id)).length,
      observedUnits: units.length,
      denominator: 'all_account_users_not_student_enrolment_or_period_active_users',
      unit: 'users_except_observedUnits_learner_course_node',
    },
    quality: {
      missingStartUnits: journey.missingStartUnits,
      missingGoalUnits: journey.missingGoalUnits,
      unknownChoiceVersionUnits: journey.unknownChoiceVersionUnits,
      preChoiceAttemptUnits: journey.preChoiceAttemptUnits,
      ambiguousTimeUnits: journey.ambiguousTimeUnits,
      missingAssessmentIdentityAttempts: attemptRows.filter(
        (row) => !row.question_id || !row.document_version || !row.question_version,
      ).length,
      explorationUnattributedAttempts,
      assessmentDataStatus: attemptRows.available === false ? 'not_available' : 'available',
      limitedSample: new Set(units.map((unit) => unit.userId)).size < 5,
      startingPointOptional: true,
    },
    transitions: transitions.map((value) => ({
      ...value,
      assessmentDataStatus: assessmentDataStatus(attemptRows),
      ratio:
        attemptRows.available === false || !value.fromUnits
          ? null
          : value.progressedUnits / value.fromUnits,
      scope: 'learner_course_node_ordered_observations_in_selected_window',
    })),
    attention: [...attention.values()],
    notCollected: ['delayedReview', 'transfer', 'causalEffect'],
    interpretation:
      '覆盖分母包含教师和管理员账号，不是学生入课人数。未自报起点不等于缺陷；直接查阅或练习是合法路径。转化描述同单元已观察顺序，不代表必须完成的漏斗或平台因果效果。',
  };
}
function learningActivity(activityRows, attemptRows, now = new Date()) {
  const day = (value) =>
    new Date(new Date(iso(value)).getTime() + 8 * 3600000).toISOString().slice(0, 10);
  const days = new Map();
  for (const row of activityRows)
    days.set(row.date, {
      date: row.date,
      visits: Number(row.visits || 0),
      activeSeconds: Number(row.active_seconds || 0),
      attempts: 0,
    });
  for (const row of attemptRows) {
    const date = day(row.created_at);
    if (!days.has(date)) days.set(date, { date, visits: 0, activeSeconds: 0, attempts: 0 });
    days.get(date).attempts += 1;
  }
  const firstDate = day(new Date(now.getTime() - 13 * 86400000));
  const lastDate = day(now);
  const all = [...days.values()].sort((left, right) => left.date.localeCompare(right.date));
  return {
    days: all.filter((row) => row.date >= firstDate && row.date <= lastDate),
    timezone: 'Asia/Shanghai',
    scope: 'selected_window_intersect_recent_14_calendar_days',
    displayDays: 14,
    from: firstDate,
    to: lastDate,
    fromDate: firstDate,
    toDate: lastDate,
    earlierRecordedDays: all.filter((row) => row.date < firstDate).length,
    assessmentDataStatus: attemptRows.available === false ? 'not_available' : 'available',
    interpretation:
      '仅展示有记录日期；空日期不等于没有学习。活跃时间为前台过程时长，作答次数包含重复提交。',
  };
}
function unavailableRows() {
  return Object.defineProperty([], 'available', { value: false });
}
const PROCESS_SQL = `COUNT(*) AS event_count,
  SUM(e.event_type = 'navigation' AND JSON_UNQUOTE(JSON_EXTRACT(e.metadata_json, '$.action')) = 'visit') AS visits,
  SUM(e.delta_seconds) AS active_seconds, SUM(e.event_type = 'action') AS actions,
  SUM(e.event_type = 'action' AND JSON_UNQUOTE(JSON_EXTRACT(e.metadata_json, '$.action')) = 'mark_learned') AS manual_marks,
  SUM(e.event_type = 'assessment') AS assessment_events`;
const SELFTEST_SQL = `COUNT(*) AS attempts, SUM(a.is_official = 1) AS official_attempts,
  SUM(a.is_official = 1 AND a.status = 'graded' AND a.verdict = 'pass') AS passed,
  SUM(a.is_official = 1 AND a.status = 'graded' AND a.verdict = 'fail') AS failed,
  SUM(a.status = 'pending_review') AS pending_review, SUM(a.is_official = 0) AS practice_attempts`;

async function ensureLearningAnalyticsTables(pool) {
  const sql = fs.readFileSync(
    path.join(__dirname, '../database/migrations/064_learning_analytics.sql'),
    'utf8',
  );
  for (const statement of sql
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean))
    await pool.execute(statement);
  const [columns] = await pool.execute('SHOW COLUMNS FROM learning_analytics_preferences');
  const required = {
    browser_window_started_at: 'DATETIME(3) NULL',
    browser_event_count: 'SMALLINT UNSIGNED NOT NULL DEFAULT 0',
  };
  const missing = Object.entries(required).filter(
    ([name]) => !columns.some((column) => column.Field === name),
  );
  if (missing.length) {
    try {
      await pool.execute(
        `ALTER TABLE learning_analytics_preferences ${missing.map(([name, definition]) => `ADD COLUMN ${name} ${definition}`).join(', ')}`,
      );
    } catch (error) {
      if (error.code !== 'ER_DUP_FIELDNAME') throw error;
    }
  }
  const [indexes] = await pool.execute(
    "SHOW INDEX FROM learning_analytics_events WHERE Key_name = 'idx_learning_analytics_retention'",
  );
  if (!indexes.length) {
    try {
      await pool.execute(
        'ALTER TABLE learning_analytics_events ADD INDEX idx_learning_analytics_retention (created_at, id)',
      );
    } catch (error) {
      if (error.code !== 'ER_DUP_KEYNAME') throw error;
    }
  }
  // Deployment migration: activate existing accounts, including legacy opt-outs,
  // without backfilling any past activity or inspecting private business text.
  // Retried startup does not reset engagement clocks or rate-limit counters.
  await pool.execute(
    'ALTER TABLE learning_analytics_preferences ALTER COLUMN enabled SET DEFAULT 1',
  );
  await pool.execute(`UPDATE learning_analytics_preferences SET
    last_engagement_at = UTC_TIMESTAMP(3), updated_at = UTC_TIMESTAMP(3), enabled = 1
    WHERE enabled <> 1`);
  await pool.execute(`INSERT INTO learning_analytics_preferences
    (user_id, enabled, last_engagement_at, updated_at)
    SELECT u.id, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3) FROM users u
    LEFT JOIN learning_analytics_preferences p ON p.user_id = u.id WHERE p.user_id IS NULL
    ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)`);
}
function createMysqlAnalyticsStore(pool) {
  async function transaction(work) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
  async function context(where, value, point) {
    const [rows] = await pool.execute(
      `SELECT c.id AS course_id, c.slug AS course_slug, c.name AS course_name, n.node_id, n.title AS node_name FROM courses c
       JOIN course_map_nodes n ON n.course_id = c.id WHERE c.${where} = ? AND c.is_active = 1 AND n.node_id = ? LIMIT 1`,
      [value, point],
    );
    return rows[0] || null;
  }
  async function businessRows(userId, since) {
    try {
      const [rows] = await pool.execute(
        `SELECT a.user_id, a.course_id, c.slug AS course_slug, c.name AS course_name, ${SELFTEST_SQL} FROM learning_assessment_attempts a JOIN courses c ON c.id = a.course_id
         WHERE 1 = 1 ${userId ? 'AND a.user_id = ?' : ''} ${since ? 'AND a.created_at >= ?' : ''}
         GROUP BY a.user_id, a.course_id, c.slug, c.name`,
        [...(userId ? [userId] : []), ...(since ? [sqlDate(since)] : [])],
      );
      return rows;
    } catch (error) {
      if (error.code === 'ER_NO_SUCH_TABLE') return unavailableRows();
      throw error;
    }
  }
  return {
    async prune() {
      const [result] = await pool.execute(
        'DELETE FROM learning_analytics_events WHERE created_at < UTC_TIMESTAMP(3) - INTERVAL 180 DAY',
      );
      return Number(result.affectedRows);
    },
    context: (slug, point) => context('slug', slug, point),
    contextById: (courseId, point) => context('id', courseId, point),
    async canRead(user, current) {
      return Boolean(user?.id && current);
    },
    async preferences(userId) {
      await pool.execute(ENABLE_RECORDING_SQL, [userId]);
      const [rows] = await pool.execute(
        'SELECT enabled, CAST(updated_at AS CHAR) AS updated_at FROM learning_analytics_preferences WHERE user_id = ? LIMIT 1',
        [userId],
      );
      return preference(rows[0]);
    },
    async setPreferences(userId, enabled) {
      requireEnabled(enabled);
      return this.preferences(userId);
    },
    async record(userId, current, event) {
      const hash = fingerprint(current, event);
      return transaction(async (connection) => {
        await connection.execute(ENABLE_RECORDING_SQL, [userId]);
        const [settings] = await connection.execute(
          `SELECT enabled, browser_event_count,
          TIMESTAMPDIFF(MICROSECOND, browser_window_started_at, UTC_TIMESTAMP(3)) / 1000000 AS browser_window_seconds,
          GREATEST(0, TIMESTAMPDIFF(MICROSECOND, last_engagement_at, UTC_TIMESTAMP(3)) / 1000000) AS elapsed_seconds
          FROM learning_analytics_preferences WHERE user_id = ? FOR UPDATE`,
          [userId],
        );
        if (Number(settings[0]?.enabled) !== 1)
          throw new AnalyticsError(503, '必要过程记录策略尚未就绪，请稍后重试');
        const [existing] = await connection.execute(
          'SELECT payload_hash FROM learning_analytics_events WHERE user_id = ? AND request_key = ? LIMIT 1',
          [userId, event.requestKey],
        );
        if (existing[0]) {
          if (existing[0].payload_hash !== hash)
            throw new AnalyticsError(409, '这次提交标识已用于另一条过程记录');
          return { recorded: true, duplicate: true };
        }
        const windowSeconds = settings[0].browser_window_seconds;
        const newWindow = windowSeconds == null || Number(windowSeconds) >= QUOTA_WINDOW_SECONDS;
        if (
          event.source === 'browser' &&
          !newWindow &&
          Number(settings[0].browser_event_count) >= BROWSER_QUOTA
        )
          throw quotaError(QUOTA_WINDOW_SECONDS - Math.max(0, Number(windowSeconds)));
        const delta =
          event.type === 'engagement'
            ? Math.min(
                event.deltaSeconds,
                Math.max(0, Math.floor(Number(settings[0].elapsed_seconds) || 0)),
              )
            : 0;
        await connection.execute(
          `INSERT INTO learning_analytics_events
          (user_id, course_id, node_id, event_type, event_source, delta_seconds, metadata_json, request_key, payload_hash, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
          [
            userId,
            current.course_id,
            current.node_id,
            event.type,
            event.source,
            delta,
            JSON.stringify(event.metadata),
            event.requestKey,
            hash,
          ],
        );
        if (event.source === 'browser')
          await connection.execute(
            newWindow
              ? 'UPDATE learning_analytics_preferences SET browser_window_started_at = UTC_TIMESTAMP(3), browser_event_count = 1 WHERE user_id = ?'
              : 'UPDATE learning_analytics_preferences SET browser_event_count = browser_event_count + 1 WHERE user_id = ?',
            [userId],
          );
        if (event.type === 'engagement')
          await connection.execute(
            'UPDATE learning_analytics_preferences SET last_engagement_at = UTC_TIMESTAMP(3) WHERE user_id = ?',
            [userId],
          );
        return { recorded: true, duplicate: false, deltaSeconds: delta };
      });
    },
    async processRows(userId, since) {
      const [rows] = await pool.execute(
        `SELECT e.user_id, e.course_id, c.slug AS course_slug, c.name AS course_name, ${PROCESS_SQL}
        FROM learning_analytics_events e JOIN courses c ON c.id = e.course_id
        WHERE 1 = 1 ${userId ? 'AND e.user_id = ?' : ''} ${since ? 'AND e.created_at >= ?' : ''}
        GROUP BY e.user_id, e.course_id, c.slug, c.name`,
        [...(userId ? [userId] : []), ...(since ? [sqlDate(since)] : [])],
      );
      return rows;
    },
    businessRows,
    async activityRows(userId, since) {
      const [rows] = await pool.execute(
        `SELECT DATE_FORMAT(DATE_ADD(e.created_at, INTERVAL 8 HOUR), '%Y-%m-%d') AS date,
          SUM(e.event_type = 'navigation' AND JSON_UNQUOTE(JSON_EXTRACT(e.metadata_json, '$.action')) = 'visit') AS visits,
          SUM(e.delta_seconds) AS active_seconds
        FROM learning_analytics_events e WHERE 1 = 1
          ${userId ? 'AND e.user_id = ?' : ''} ${since ? 'AND e.created_at >= ?' : ''}
        GROUP BY date ORDER BY date ASC`,
        [...(userId ? [userId] : []), ...(since ? [sqlDate(since)] : [])],
      );
      return rows;
    },
    async journeyEventRows(userId, since) {
      const [rows] = await pool.execute(
        `SELECT e.id, e.user_id, e.course_id, e.node_id, n.title AS node_name, c.slug AS course_slug, c.name AS course_name,
          e.event_type, e.event_source, CAST(e.created_at AS CHAR) AS created_at,
          JSON_OBJECT('action', JSON_UNQUOTE(JSON_EXTRACT(e.metadata_json, '$.action')),
            'tool', JSON_UNQUOTE(JSON_EXTRACT(e.metadata_json, '$.tool')),
            'level', JSON_UNQUOTE(JSON_EXTRACT(e.metadata_json, '$.level')),
            'goal', JSON_UNQUOTE(JSON_EXTRACT(e.metadata_json, '$.goal')),
            'pathType', JSON_UNQUOTE(JSON_EXTRACT(e.metadata_json, '$.pathType')),
            'attemptId', JSON_UNQUOTE(JSON_EXTRACT(e.metadata_json, '$.attemptId')),
            'documentVersion', JSON_UNQUOTE(JSON_EXTRACT(e.metadata_json, '$.documentVersion')),
            'assessmentRole', JSON_UNQUOTE(JSON_EXTRACT(e.metadata_json, '$.assessmentRole'))) AS metadata_json
        FROM learning_analytics_events e JOIN courses c ON c.id = e.course_id
        LEFT JOIN course_map_nodes n ON n.course_id = e.course_id AND n.node_id = e.node_id
        WHERE e.event_type IN ('navigation', 'action', 'assessment')
          ${userId ? 'AND e.user_id = ?' : ''} ${since ? 'AND e.created_at >= ?' : ''}
        ORDER BY e.created_at ASC, e.id ASC`,
        [...(userId ? [userId] : []), ...(since ? [sqlDate(since)] : [])],
      );
      return rows;
    },
    async journeyAttemptRows(userId, since) {
      try {
        const [rows] = await pool.execute(
          `SELECT a.id, a.user_id, a.course_id, a.node_id, n.title AS node_name, c.slug AS course_slug, c.name AS course_name,
            a.question_id, a.document_version, a.question_version, a.is_official,
            a.status, a.verdict, CAST(a.created_at AS CHAR) AS created_at
          FROM learning_assessment_attempts a JOIN courses c ON c.id = a.course_id
          LEFT JOIN course_map_nodes n ON n.course_id = a.course_id AND n.node_id = a.node_id
          WHERE 1 = 1 ${userId ? 'AND a.user_id = ?' : ''} ${since ? 'AND a.created_at >= ?' : ''}
          ORDER BY a.created_at ASC, a.id ASC`,
          [...(userId ? [userId] : []), ...(since ? [sqlDate(since)] : [])],
        );
        return rows;
      } catch (error) {
        if (error.code === 'ER_NO_SUCH_TABLE') return unavailableRows();
        throw error;
      }
    },
    async assessmentEvidenceRows(since, userId = null) {
      try {
        const [rows] = await pool.execute(
          `SELECT g.user_id, g.course_id, c.slug AS course_slug, c.name AS course_name, g.graded_attempt_count,
          first_attempt.verdict AS first_verdict, last_attempt.verdict AS last_verdict
          FROM (
            SELECT a.user_id, a.course_id, a.node_id, a.question_id,
              a.document_version, BINARY a.question_version AS question_version, MIN(a.id) AS first_id,
              MAX(a.id) AS last_id, COUNT(*) AS graded_attempt_count
            FROM learning_assessment_attempts a
            WHERE a.is_official = 1 AND a.status = 'graded' AND a.verdict IN ('pass', 'fail')
              AND a.document_version <> '' AND a.question_version <> '' AND a.question_id <> ''
              ${userId ? 'AND a.user_id = ?' : ''}
              ${since ? 'AND a.created_at >= ?' : ''}
            GROUP BY a.user_id, a.course_id, a.node_id, a.question_id,
              a.document_version, BINARY a.question_version
          ) g
          JOIN learning_assessment_attempts first_attempt ON first_attempt.id = g.first_id
          JOIN learning_assessment_attempts last_attempt ON last_attempt.id = g.last_id
          JOIN courses c ON c.id = g.course_id`,
          [...(userId ? [userId] : []), ...(since ? [sqlDate(since)] : [])],
        );
        return rows;
      } catch (error) {
        if (error.code === 'ER_NO_SUCH_TABLE') return unavailableRows();
        throw error;
      }
    },
    async participationRows(since, userId = null) {
      const [rows] = await pool.execute(
        `SELECT e.user_id, 'tool' AS kind,
          JSON_UNQUOTE(JSON_EXTRACT(e.metadata_json, '$.tool')) AS value, COUNT(*) AS event_count
        FROM learning_analytics_events e
        WHERE e.event_type = 'navigation'
          AND JSON_UNQUOTE(JSON_EXTRACT(e.metadata_json, '$.action')) = 'tool_open'
          ${userId ? 'AND e.user_id = ?' : ''}
          ${since ? 'AND e.created_at >= ?' : ''}
        GROUP BY e.user_id, value
        UNION ALL
        SELECT e.user_id, 'action' AS kind,
          JSON_UNQUOTE(JSON_EXTRACT(e.metadata_json, '$.action')) AS value, COUNT(*) AS event_count
        FROM learning_analytics_events e WHERE e.event_type = 'action'
          ${userId ? 'AND e.user_id = ?' : ''}
          ${since ? 'AND e.created_at >= ?' : ''}
        GROUP BY e.user_id, value`,
        [
          ...(userId ? [userId] : []),
          ...(since ? [sqlDate(since)] : []),
          ...(userId ? [userId] : []),
          ...(since ? [sqlDate(since)] : []),
        ],
      );
      return rows;
    },
    async users() {
      const [rows] = await pool.execute(
        'SELECT u.id, u.username AS nickname, 1 AS enabled FROM users u ORDER BY u.id ASC',
      );
      return rows;
    },
    async exportRows(userId, before) {
      const [rows] = await pool.execute(
        `SELECT e.id, c.slug AS course_slug, e.node_id, e.event_type, e.event_source,
        e.delta_seconds, e.metadata_json, CAST(e.created_at AS CHAR) AS created_at FROM learning_analytics_events e JOIN courses c ON c.id = e.course_id
        WHERE e.user_id = ? ${before ? 'AND e.id < ?' : ''} ORDER BY e.id DESC LIMIT 501`,
        [userId, ...(before ? [before] : [])],
      );
      return rows;
    },
    async remove(userId) {
      return transaction(async (connection) => {
        await connection.execute(
          `INSERT INTO learning_analytics_preferences (user_id, enabled, last_engagement_at, updated_at)
          VALUES (?, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE enabled = 1,
          last_engagement_at = UTC_TIMESTAMP(3), updated_at = UTC_TIMESTAMP(3)`,
          [userId],
        );
        const [result] = await connection.execute(
          'DELETE FROM learning_analytics_events WHERE user_id = ?',
          [userId],
        );
        return Number(result.affectedRows);
      });
    },
  };
}

function createMemoryAnalyticsStore({
  contexts = [],
  users = [],
  businessAttempts = [],
  initialPreferences = [],
  clock = () => new Date(),
  browserQuotaMaxBuckets = 10000,
} = {}) {
  const rows = [];
  const preferences = new Map(initialPreferences.map((row) => [String(row.user_id), { ...row }]));
  const ensureEnabled = (userId) => {
    const key = String(userId);
    let settings = preferences.get(key);
    if (Number(settings?.enabled) !== 1) {
      const now = new Date(clock());
      settings = { ...settings, enabled: true, updated_at: now, last_engagement_at: now };
      preferences.set(key, settings);
    }
    return settings;
  };
  for (const user of users) ensureEnabled(user.id);
  for (const userId of preferences.keys()) ensureEnabled(userId);
  const browserBuckets = new Map();
  const maxBuckets =
    Number.isInteger(browserQuotaMaxBuckets) && browserQuotaMaxBuckets > 0
      ? Math.min(browserQuotaMaxBuckets, 10000)
      : 10000;
  let nextBucketSweep = 0;
  function consumeBrowserQuota(userId, now) {
    const timestamp = now.getTime();
    if (timestamp >= nextBucketSweep || browserBuckets.size >= maxBuckets) {
      for (const [key, bucket] of browserBuckets)
        if (bucket.expiresAt <= timestamp) browserBuckets.delete(key);
      nextBucketSweep = timestamp + QUOTA_WINDOW_SECONDS * 1000;
    }
    const key = String(userId);
    let bucket = browserBuckets.get(key);
    if (!bucket || bucket.expiresAt <= timestamp) {
      if (!bucket && browserBuckets.size >= maxBuckets) throw quotaError(QUOTA_WINDOW_SECONDS);
      bucket = { count: 0, expiresAt: timestamp + QUOTA_WINDOW_SECONDS * 1000 };
      browserBuckets.set(key, bucket);
    }
    if (bucket.count >= BROWSER_QUOTA) throw quotaError((bucket.expiresAt - timestamp) / 1000);
    bucket.count += 1;
  }
  let serial = 0;
  const isActive = (context) => context.is_active !== false && context.is_active !== 0;
  function group(entries, assessment) {
    const groups = new Map();
    entries.forEach((entry) => {
      const key = `${entry.user_id}:${entry.course_id}`;
      if (!groups.has(key))
        groups.set(key, {
          user_id: entry.user_id,
          course_id: entry.course_id,
          course_slug: entry.course_slug,
          course_name: entry.course_name,
          ...(assessment
            ? {
                attempts: 0,
                official_attempts: 0,
                passed: 0,
                failed: 0,
                pending_review: 0,
                practice_attempts: 0,
              }
            : {
                event_count: 0,
                visits: 0,
                active_seconds: 0,
                actions: 0,
                manual_marks: 0,
                assessment_events: 0,
              }),
        });
      const result = groups.get(key);
      if (assessment) {
        result.attempts += 1;
        result.official_attempts += entry.is_official ? 1 : 0;
        result.passed +=
          entry.is_official && entry.status === 'graded' && entry.verdict === 'pass' ? 1 : 0;
        result.failed +=
          entry.is_official && entry.status === 'graded' && entry.verdict === 'fail' ? 1 : 0;
        result.pending_review += entry.status === 'pending_review' ? 1 : 0;
        result.practice_attempts += entry.is_official ? 0 : 1;
      } else {
        result.event_count += 1;
        result.visits +=
          entry.event_type === 'navigation' && entry.metadata_json.action === 'visit' ? 1 : 0;
        result.active_seconds += entry.delta_seconds;
        result.actions += entry.event_type === 'action' ? 1 : 0;
        result.manual_marks +=
          entry.event_type === 'action' && entry.metadata_json.action === 'mark_learned' ? 1 : 0;
        result.assessment_events += entry.event_type === 'assessment' ? 1 : 0;
      }
    });
    return [...groups.values()];
  }
  const filter = (entries, userId, since) =>
    entries.filter(
      (entry) =>
        (!userId || String(entry.user_id) === String(userId)) &&
        (!since || new Date(entry.created_at) >= since),
    );
  return {
    rows,
    quotaSize: () => browserBuckets.size,
    contexts,
    businessAttempts,
    async prune() {
      const cutoff = new Date(clock()).getTime() - 180 * 86400000;
      let deleted = 0;
      for (let index = rows.length - 1; index >= 0; index -= 1) {
        if (new Date(rows[index].created_at).getTime() < cutoff) {
          rows.splice(index, 1);
          deleted += 1;
        }
      }
      return deleted;
    },
    async context(slug, point) {
      return (
        contexts.find(
          (current) =>
            (current.slug || current.course_slug) === slug &&
            current.node_id === point &&
            isActive(current),
        ) || null
      );
    },
    async contextById(courseId, point) {
      return (
        contexts.find(
          (current) =>
            String(current.course_id) === String(courseId) &&
            current.node_id === point &&
            isActive(current),
        ) || null
      );
    },
    async canRead(user, current) {
      return Boolean(
        user?.id &&
        current &&
        (!Array.isArray(current.allowedUserIds) ||
          current.allowedUserIds.some((id) => String(id) === String(user.id))),
      );
    },
    async preferences(userId) {
      return preference(ensureEnabled(userId));
    },
    async setPreferences(userId, enabled) {
      requireEnabled(enabled);
      return this.preferences(userId);
    },
    async record(userId, current, event) {
      const settings = ensureEnabled(userId);
      const hash = fingerprint(current, event);
      const previous = rows.find(
        (row) => String(row.user_id) === String(userId) && row.request_key === event.requestKey,
      );
      if (previous) {
        if (previous.payload_hash !== hash)
          throw new AnalyticsError(409, '这次提交标识已用于另一条过程记录');
        return { recorded: true, duplicate: true };
      }
      const now = new Date(clock());
      if (event.source === 'browser') consumeBrowserQuota(userId, now);
      const elapsed = Math.max(0, Math.floor((now - settings.last_engagement_at) / 1000));
      const delta = event.type === 'engagement' ? Math.min(event.deltaSeconds, elapsed) : 0;
      serial += 1;
      rows.push({
        id: String(serial),
        user_id: userId,
        course_id: current.course_id,
        course_slug: current.course_slug || current.slug,
        course_name: current.course_name || current.name || current.course_slug || current.slug,
        node_id: current.node_id,
        node_name: current.node_name || current.title || current.node_id,
        event_type: event.type,
        event_source: event.source,
        delta_seconds: delta,
        metadata_json: structuredClone(event.metadata),
        request_key: event.requestKey,
        payload_hash: hash,
        created_at: now,
      });
      if (event.type === 'engagement') settings.last_engagement_at = now;
      return { recorded: true, duplicate: false, deltaSeconds: delta };
    },
    async processRows(userId, since) {
      return group(filter(rows, userId, since), false);
    },
    async businessRows(userId, since) {
      return group(filter(businessAttempts, userId, since), true);
    },
    async activityRows(userId, since) {
      const days = new Map();
      for (const row of filter(rows, userId, since)) {
        const date = new Date(new Date(row.created_at).getTime() + 8 * 3600000)
          .toISOString()
          .slice(0, 10);
        if (!days.has(date)) days.set(date, { date, visits: 0, active_seconds: 0 });
        const current = days.get(date);
        if (row.event_type === 'navigation' && eventMetadata(row).action === 'visit')
          current.visits += 1;
        current.active_seconds += Number(row.delta_seconds || 0);
      }
      return [...days.values()];
    },
    async journeyEventRows(userId, since) {
      return filter(rows, userId, since).filter((row) =>
        ['navigation', 'action', 'assessment'].includes(row.event_type),
      );
    },
    async journeyAttemptRows(userId, since) {
      return filter(businessAttempts, userId, since).map((row) => ({
        id: row.id,
        user_id: row.user_id,
        course_id: row.course_id,
        node_id: row.node_id,
        node_name: (() => {
          const current = contexts.find(
            (entry) =>
              String(entry.course_id) === String(row.course_id) && entry.node_id === row.node_id,
          );
          return current?.node_name || current?.title || row.node_id;
        })(),
        course_slug: (() => {
          const current = contexts.find(
            (context) => String(context.course_id) === String(row.course_id),
          );
          return current?.slug || current?.course_slug || '';
        })(),
        course_name: (() => {
          const current = contexts.find(
            (context) => String(context.course_id) === String(row.course_id),
          );
          return (
            current?.course_name || current?.name || current?.slug || current?.course_slug || ''
          );
        })(),
        question_id: row.question_id,
        document_version: row.document_version,
        question_version: row.question_version,
        is_official: row.is_official,
        status: row.status,
        verdict: row.verdict,
        created_at: row.created_at,
      }));
    },
    async assessmentEvidenceRows(since, userId = null) {
      const groups = new Map();
      const entries = filter(businessAttempts, userId, since)
        .filter(
          (row) =>
            Number(row.is_official) === 1 &&
            row.status === 'graded' &&
            ['pass', 'fail'].includes(row.verdict) &&
            row.document_version &&
            row.question_version &&
            row.question_id,
        )
        .slice()
        .sort((left, right) => (BigInt(left.id) < BigInt(right.id) ? -1 : 1));
      entries.forEach((row) => {
        const key = JSON.stringify([
          String(row.user_id),
          String(row.course_id),
          row.node_id,
          row.question_id,
          row.document_version,
          row.question_version,
        ]);
        if (!groups.has(key))
          groups.set(key, {
            user_id: row.user_id,
            course_id: row.course_id,
            course_slug: (() => {
              const current = contexts.find(
                (item) => String(item.course_id) === String(row.course_id),
              );
              return current?.slug || current?.course_slug;
            })(),
            course_name: (() => {
              const current = contexts.find(
                (item) => String(item.course_id) === String(row.course_id),
              );
              return current?.course_name || current?.name || current?.slug || current?.course_slug;
            })(),
            first_verdict: row.verdict,
            last_verdict: row.verdict,
            graded_attempt_count: 0,
          });
        const sequence = groups.get(key);
        sequence.last_verdict = row.verdict;
        sequence.graded_attempt_count += 1;
      });
      return [...groups.values()];
    },
    async participationRows(since, userId = null) {
      const groups = new Map();
      filter(rows, userId, since).forEach((row) => {
        const tool = row.event_type === 'navigation' && row.metadata_json.action === 'tool_open';
        if (!tool && row.event_type !== 'action') return;
        const kind = tool ? 'tool' : 'action';
        const value = tool ? row.metadata_json.tool : row.metadata_json.action;
        const key = JSON.stringify([String(row.user_id), kind, value]);
        if (!groups.has(key))
          groups.set(key, { user_id: row.user_id, kind, value, event_count: 0 });
        groups.get(key).event_count += 1;
      });
      return [...groups.values()];
    },
    async users() {
      return users.map((user) => ({
        id: user.id,
        nickname: user.nickname || user.username || '',
        enabled: true,
      }));
    },
    async exportRows(userId, before) {
      return filter(rows, userId)
        .filter((row) => !before || BigInt(row.id) < BigInt(before))
        .slice()
        .reverse()
        .slice(0, 501);
    },
    async remove(userId) {
      const ownRows = rows.filter((row) => String(row.user_id) === String(userId));
      for (let index = rows.length - 1; index >= 0; index -= 1)
        if (String(rows[index].user_id) === String(userId)) rows.splice(index, 1);
      preferences.set(String(userId), {
        enabled: true,
        updated_at: new Date(clock()),
        last_engagement_at: new Date(clock()),
      });
      return ownRows.length;
    },
  };
}

async function recordAssessmentEvent(store, { user, context, attempt, reviewed = false }) {
  const ownerId = reviewed ? attempt?.userId : user?.id;
  if (
    !ID.test(String(ownerId || '')) ||
    !ID.test(String(attempt?.id || '')) ||
    !['graded', 'pending_review'].includes(attempt?.status) ||
    ![null, 'pass', 'fail', 'practice_only'].includes(attempt?.verdict) ||
    typeof attempt?.official !== 'boolean'
  )
    throw new AnalyticsError(400, '服务端自测事件缺少可信的归属或评测结果');
  const current = await store.contextById(context.course_id, context.node_id);
  if (!current) return { recorded: false, reason: 'unavailable' };
  let assessmentRole = null;
  if (['practice', 'selftest', 'exploration'].includes(attempt.assessmentRole)) {
    assessmentRole = 'practice';
    if (attempt.official) assessmentRole = 'selftest';
    else if (attempt.assessmentRole === 'exploration') assessmentRole = 'exploration';
  }
  const hash = crypto
    .createHash('sha256')
    .update(`assessment:${attempt.id}:${attempt.status}:${attempt.verdict}:${Boolean(reviewed)}`)
    .digest('hex');
  const requestKey = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  return store.record(ownerId, current, {
    requestKey,
    type: 'assessment',
    source: 'server',
    deltaSeconds: 0,
    metadata: {
      attemptId: String(attempt.id),
      status: attempt.status,
      verdict: attempt.verdict,
      official: attempt.official,
      reviewed: Boolean(reviewed),
      ...(typeof attempt.documentVersion === 'string' &&
      /^[a-f0-9]{64}$/.test(attempt.documentVersion)
        ? { documentVersion: attempt.documentVersion }
        : {}),
      ...(assessmentRole ? { assessmentRole } : {}),
    },
  });
}
function createLearningAnalyticsRouter({
  pool,
  requireAuth,
  requireAdmin,
  store = createMysqlAnalyticsStore(pool),
}) {
  const router = express.Router();
  function route(handler, admin = false) {
    return async (req, res) => {
      res.set('Cache-Control', 'private, no-store');
      try {
        if (admin && typeof requireAdmin !== 'function')
          throw new AnalyticsError(403, '需要管理员权限');
        const user = await (admin ? requireAdmin : requireAuth)(req, res);
        if (!user) return;
        await store.prune();
        await handler(req, res, user);
      } catch (error) {
        if (error.status === 429) res.set('Retry-After', String(error.retryAfterSeconds));
        if (!error.status)
          console.error('Learning analytics request failed:', error.code || error.name);
        res.status(error.status || 500).json({
          message: error.status ? error.message : '学习过程记录服务暂时不可用',
          ...(error.status === 429
            ? {
                code: 'learning_analytics_rate_limited',
                retryAfterSeconds: error.retryAfterSeconds,
              }
            : {}),
        });
      }
    };
  }
  router.get(
    '/preferences',
    route(async (req, res, user) => {
      res.json({ preferences: await store.preferences(user.id) });
    }),
  );
  router.put(
    '/preferences',
    route(async (req, res, user) => {
      allowedKeys(req.body, ['enabled']);
      if (typeof req.body.enabled !== 'boolean')
        throw new AnalyticsError(400, '记录策略字段必须为布尔值');
      if (req.body.enabled === false) {
        res.status(409).json({
          code: 'learning_recording_required',
          message: '平台默认记录必要学习过程；可导出或清空历史，清空后继续记录新过程。',
          preferences: await store.preferences(user.id),
        });
        return;
      }
      res.json({ preferences: await store.setPreferences(user.id, req.body.enabled) });
    }),
  );
  router.post(
    '/events',
    route(async (req, res, user) => {
      const event = validateClientEvent(req.body);
      const current = await store.context(event.courseSlug, event.nodeId);
      if (!current) throw new AnalyticsError(404, '课程或知识点不存在');
      if (!(await store.canRead(user, current)))
        throw new AnalyticsError(403, '没有访问该知识点的权限');
      const result = await store.record(user.id, current, event);
      res.status(result.recorded && !result.duplicate ? 201 : 200).json(result);
    }),
  );
  router.get(
    '/summary',
    route(async (req, res, user) => {
      const selected = windowStart(req.query.window);
      const [
        preferences,
        processRows,
        businessRows,
        journeyEvents,
        journeyAttempts,
        activityRows,
        evidenceRows,
        participationRows,
      ] = await Promise.all([
        store.preferences(user.id),
        store.processRows(user.id, selected.since),
        store.businessRows(user.id, selected.since),
        store.journeyEventRows(user.id, selected.since),
        store.journeyAttemptRows(user.id, selected.since),
        store.activityRows(user.id, selected.since),
        store.assessmentEvidenceRows(selected.since, user.id),
        store.participationRows(selected.since, user.id),
      ]);
      res.json({
        window: selected.window,
        period: { from: iso(selected.since), to: new Date().toISOString() },
        retentionDays: 180,
        preferences,
        process: {
          ...sumCounts(processRows, zeroProcess(), processCounts),
          courses: processRows.map((row) => ({
            courseId: String(row.course_id),
            courseSlug: row.course_slug,
            courseName: row.course_name || row.course_slug,
            ...processCounts(row),
          })),
        },
        selftest: selftestSummary(businessRows),
        effectiveness: learningEvidence(evidenceRows, businessRows, participationRows),
        journey: journeyEvidence(journeyEvents, journeyAttempts, { personal: true }),
        insights: personalInsights(journeyEvents, journeyAttempts),
        activity: learningActivity(activityRows, journeyAttempts),
        interpretation:
          '访问、活跃时间和手工标记是过程信息；自测提交结果包含重复作答及历史版本，均不等同于知识掌握或能力评价。',
      });
    }),
  );
  router.get(
    '/export',
    route(async (req, res, user) => {
      const before = req.query.before || '';
      if (typeof before !== 'string' || (before && !ID.test(before)))
        throw new AnalyticsError(400, '导出分页位置无效');
      const rows = await store.exportRows(user.id, before);
      res.json({
        schemaVersion: 1,
        scope: SCOPE,
        retentionDays: 180,
        preferences: await store.preferences(user.id),
        events: rows.slice(0, 500).map(toEvent),
        nextCursor: rows.length > 500 ? String(rows[499].id) : null,
      });
    }),
  );
  router.delete(
    '/events',
    route(async (req, res, user) => {
      const deleted = await store.remove(user.id);
      res.json({ ok: true, scope: SCOPE, deleted, preferences: await store.preferences(user.id) });
    }),
  );
  router.get(
    '/admin/overview',
    route(async (req, res) => {
      const selected = windowStart(req.query.window);
      const [
        processRows,
        businessRows,
        users,
        evidenceRows,
        participationRows,
        journeyEvents,
        journeyAttempts,
        activityRows,
      ] = await Promise.all([
        store.processRows(null, selected.since),
        store.businessRows(null, selected.since),
        store.users(),
        store.assessmentEvidenceRows(selected.since),
        store.participationRows(selected.since),
        store.journeyEventRows(null, selected.since),
        store.journeyAttemptRows(null, selected.since),
        store.activityRows(null, selected.since),
      ]);
      const activeUsers = new Set(processRows.map((row) => String(row.user_id)));
      const journey = journeyEvidence(journeyEvents, journeyAttempts);
      const courses = new Map();
      processRows.forEach((row) => {
        const key = String(row.course_id);
        if (!courses.has(key))
          courses.set(key, {
            courseId: key,
            courseSlug: row.course_slug,
            courseName: row.course_name || row.course_slug,
            ...zeroProcess(),
            users: new Set(),
          });
        const course = courses.get(key);
        course.users.add(String(row.user_id));
        const counts = processCounts(row);
        Object.keys(counts).forEach((name) => {
          course[name] += counts[name];
        });
      });
      res.json({
        window: selected.window,
        period: { from: iso(selected.since), to: new Date().toISOString() },
        retentionDays: 180,
        userCount: users.length,
        enabledUserCount: users.filter((user) => Boolean(user.enabled)).length,
        processUserCount: activeUsers.size,
        limitedSample: activeUsers.size < 5,
        process: sumCounts(processRows, zeroProcess(), processCounts),
        selftest: selftestSummary(businessRows),
        effectiveness: learningEvidence(evidenceRows, businessRows, participationRows),
        journey,
        diagnostics: analyticsDiagnostics(
          journeyEvents,
          journeyAttempts,
          users,
          journey,
          processRows,
        ),
        activity: learningActivity(activityRows, journeyAttempts),
        courses: [...courses.values()].map((course) => ({
          ...course,
          users: course.users.size,
          limitedSample: course.users.size < 5,
        })),
        users: users.map((user) => {
          const ownProcess = processRows.filter((row) => String(row.user_id) === String(user.id));
          const ownBusiness = businessRows.filter((row) => String(row.user_id) === String(user.id));
          return {
            id: String(user.id),
            nickname: user.nickname,
            enabled: Boolean(user.enabled),
            courseCount: new Set(
              [...ownProcess, ...ownBusiness].map((row) => String(row.course_id)),
            ).size,
            process: sumCounts(ownProcess, zeroProcess(), processCounts),
            selftest: {
              ...sumCounts(ownBusiness, zeroSelftest(), selftestCounts),
              assessmentDataStatus: assessmentDataStatus(businessRows),
            },
          };
        }),
        interpretation:
          '必要过程统计与个人自测提交结果分别计数，不做能力排名；小样本不代表整体学习情况，统计关联不代表平台因果效果。',
      });
    }, true),
  );
  return router;
}
module.exports = {
  AnalyticsError,
  createLearningAnalyticsRouter,
  ensureLearningAnalyticsTables,
  createMemoryAnalyticsStore,
  createMysqlAnalyticsStore,
  recordAssessmentEvent,
  validateClientEvent,
  windowStart,
  journeyEvidence,
  personalInsights,
  analyticsDiagnostics,
  learningActivity,
  RECORDING_POLICY,
};
