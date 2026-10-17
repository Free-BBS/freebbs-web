/* Ephemeral learner-directed workflow. No storage, grades, completion or network effects. */
(function exposeLearningWorkflow(root) {
  const SESSION_VERSION = 1;
  const GOALS = Object.freeze(['concepts', 'practice', 'review', 'explore']);
  const LEVELS = Object.freeze(['new', 'familiar', 'basic', 'advanced']);
  const MODULES = Object.freeze([
    'overview',
    'origin',
    'read',
    'worked-example',
    'retrieve',
    'practice',
    'repair',
    'transfer',
    'explore',
    'reflect',
    'revisit',
  ]);
  const PHASES = Object.freeze({
    concepts: ['path'],
    practice: ['path'],
    review: ['recall', 'repair', 'check'],
    explore: ['question', 'investigate'],
  });
  const OUTCOMES = Object.freeze(['unknown', 'gap', 'clear']);
  const object = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  const member = (values, value) => typeof value === 'string' && values.includes(value);
  function questionText(value) {
    if (typeof value !== 'string') return '';
    let result = '';
    for (const character of value.trim()) {
      const code = character.codePointAt(0);
      if ((code < 32 && ![9, 10, 13].includes(code)) || code === 127) continue;
      // Match textarea maxlength and server bounds without cutting a surrogate pair.
      if (result.length + character.length > 1000) break;
      result += character;
    }
    return result.trim();
  }
  function createSession(value) {
    if (!object(value) || !member(GOALS, value.goal) || !member(LEVELS, value.level)) return null;
    const { goal, level } = value;
    let moduleId = 'explore';
    if (goal === 'review') moduleId = 'retrieve';
    else if (goal === 'concepts') moduleId = level === 'new' ? 'overview' : 'retrieve';
    else if (goal === 'practice') {
      moduleId = 'practice';
      if (level === 'new') moduleId = 'worked-example';
      else if (level === 'familiar') moduleId = 'retrieve';
    }
    return {
      schemaVersion: SESSION_VERSION,
      goal,
      level,
      phase: PHASES[goal][0],
      moduleId,
      outcome: 'unknown',
    };
  }
  function normalizeSession(value) {
    if (
      !object(value) ||
      value.schemaVersion !== SESSION_VERSION ||
      !member(GOALS, value.goal) ||
      !member(LEVELS, value.level) ||
      !member([...PHASES[value.goal], 'finished'], value.phase) ||
      !member(MODULES, value.moduleId) ||
      !member(OUTCOMES, value.outcome)
    )
      return null;
    // The result is a whitelist, never a generic copy of caller-controlled data.
    const result = {
      schemaVersion: SESSION_VERSION,
      goal: value.goal,
      level: value.level,
      phase: value.phase,
      moduleId: value.moduleId,
      outcome: value.goal === 'review' ? value.outcome : 'unknown',
    };
    const question = value.goal === 'explore' ? questionText(value.question) : '';
    if (question) result.question = question;
    if (value.phase === 'finished')
      result.resumePhase = member(PHASES[value.goal], value.resumePhase)
        ? value.resumePhase
        : PHASES[value.goal][0];
    return result;
  }
  function reduceSession(value, action) {
    const session = normalizeSession(value);
    if (!session || !object(action) || typeof action.type !== 'string') return session;
    if (action.type === 'resume') {
      if (session.phase !== 'finished') return session;
      const { resumePhase, ...next } = session;
      return { ...next, phase: resumePhase };
    }
    if (action.type === 'finish' || (action.type === 'review-clear' && session.goal === 'review')) {
      const next = { ...session, phase: 'finished' };
      next.resumePhase = session.phase === 'finished' ? session.resumePhase : session.phase;
      if (action.type === 'review-clear') next.outcome = 'clear';
      return next;
    }
    // A finished session stays finished until the learner explicitly resumes it.
    if (session.phase === 'finished') return session;
    if (session.goal === 'review' && action.type === 'review-gap')
      return { ...session, phase: 'repair', moduleId: 'repair', outcome: 'gap' };
    if (session.goal === 'review' && action.type === 'review-check')
      return {
        ...session,
        phase: 'check',
        moduleId: session.level === 'advanced' ? 'transfer' : 'practice',
      };
    if (session.goal === 'explore' && action.type === 'set-question') {
      if (typeof action.question !== 'string') return session;
      const next = { ...session };
      delete next.question;
      const question = questionText(action.question);
      return {
        ...next,
        phase: 'investigate',
        moduleId: 'explore',
        ...(question ? { question } : {}),
      };
    }
    if (action.type === 'choose-module' && member(MODULES, action.moduleId)) {
      let { phase } = session;
      if (session.goal === 'explore') phase = 'investigate';
      else if (session.goal === 'review') {
        if (action.moduleId === 'retrieve') phase = 'recall';
        else if (['practice', 'transfer'].includes(action.moduleId)) phase = 'check';
        else if (
          ['repair', 'read', 'worked-example', 'origin', 'overview'].includes(action.moduleId)
        )
          phase = 'repair';
      }
      // Choosing a lookup alone is not evidence that the learner has a gap.
      return { ...session, phase, moduleId: action.moduleId };
    }
    return session;
  }
  function stepContext(value) {
    const session = normalizeSession(value);
    if (!session) return null;
    const { goal, level, moduleId, phase, outcome, question } = session;
    return { goal, level, moduleId, phase, outcome, ...(question ? { question } : {}) };
  }
  const api = { SESSION_VERSION, createSession, reduceSession, normalizeSession, stepContext };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, { FreeBbsLearningWorkflow: api });
})(typeof window !== 'undefined' ? window : globalThis);
