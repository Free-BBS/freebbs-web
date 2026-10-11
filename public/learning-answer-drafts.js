/* Unsubmitted answers only; authoritative assessment records remain on the server. */
(function exposeAnswerDrafts(root) {
  const BASE = 'free_bbs_learning_answer_drafts_v1';
  const OWNER = `${BASE}:owner`;
  const MAX_AGE = 24 * 60 * 60 * 1000;
  const MAX_ENTRIES = 128;
  const HASH = /^[a-f0-9]{64}$/;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  function contextKey(context) {
    if (
      !context ||
      !/^[a-z0-9][a-z0-9-]{0,119}$/.test(context.courseSlug || '') ||
      !/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/.test(context.nodeId || '') ||
      context.nodeId.length > 64 ||
      !HASH.test(context.documentVersion || '') ||
      typeof context.questionVersion !== 'string' ||
      !context.questionVersion ||
      context.questionVersion.length > 64 ||
      !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/.test(context.questionId || '') ||
      !['practice', 'selftest'].includes(context.mode)
    )
      return null;
    return JSON.stringify([
      context.courseSlug,
      context.nodeId,
      context.documentVersion,
      context.questionVersion,
      context.questionId,
      context.mode,
    ]);
  }
  function safeDraft(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const { answer } = value;
    if (!(
      (typeof answer === 'string' && answer.trim() && answer.length <= 8000) ||
      (Array.isArray(answer) &&
        answer.length > 0 &&
        answer.length <= 12 &&
        answer.every((id) => typeof id === 'string' && /^[A-Za-z0-9_.-]{1,24}$/.test(id)))
    ))
      return null;
    if (value.requestKey && (typeof value.requestKey !== 'string' || !UUID.test(value.requestKey)))
      return null;
    if (
      value.supersedesAttemptId != null &&
      (typeof value.supersedesAttemptId !== 'string' ||
        !/^[1-9]\d{0,18}$/.test(value.supersedesAttemptId))
    )
      return null;
    return {
      answer: Array.isArray(answer) ? [...answer] : answer,
      requestKey: value.requestKey || null,
      ...(value.requestKey ? { supersedesAttemptId: value.supersedesAttemptId || null } : {}),
    };
  }
  function createDraftStore({ storage, crypto, digest, now = () => Date.now() } = {}) {
    let owner = '';
    let identity = '';
    let epoch = 0;
    let available = Boolean(storage && (digest || crypto?.subtle));
    const hash =
      digest ||
      (async (value) => {
        const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
        return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join(
          '',
        );
      });
    function access(callback, fallback) {
      if (!available) return fallback;
      try {
        return callback();
      } catch {
        available = false;
        return fallback;
      }
    }
    function entries() {
      return access(() => {
        const raw = storage.getItem(`${BASE}:${owner}`);
        if (!raw || raw.length > 1200000) return {};
        const saved = JSON.parse(raw);
        if (
          saved?.schemaVersion !== 1 ||
          !saved.entries ||
          typeof saved.entries !== 'object' ||
          Array.isArray(saved.entries)
        )
          return {};
        const current = Object.create(null);
        for (const [key, value] of Object.entries(saved.entries)) {
          const clean = safeDraft(value);
          if (
            clean &&
            Number.isFinite(value.savedAt) &&
            value.savedAt <= now() &&
            now() - value.savedAt < MAX_AGE &&
            Object.keys(current).length < MAX_ENTRIES
          )
            current[key] = { ...clean, savedAt: value.savedAt };
        }
        if (Object.keys(current).length !== Object.keys(saved.entries).length)
          storage.setItem(
            `${BASE}:${owner}`,
            JSON.stringify({ schemaVersion: 1, entries: current }),
          );
        return current;
      }, {});
    }
    function write(values) {
      return access(() => {
        storage.setItem(`${BASE}:${owner}`, JSON.stringify({ schemaVersion: 1, entries: values }));
        return true;
      }, false);
    }
    return {
      async bind(uid, token) {
        if (!available || typeof uid !== 'string' || !uid || typeof token !== 'string' || !token)
          return false;
        const signature = JSON.stringify([uid, token]);
        if (owner && identity === signature) return true;
        epoch += 1;
        const pending = epoch;
        let next;
        try {
          next = await hash(signature);
        } catch {
          if (pending === epoch) available = false;
          return false;
        }
        if (pending !== epoch || !available || !HASH.test(next)) return false;
        const bound = access(() => {
          const prior = storage.getItem(OWNER);
          if (HASH.test(prior || '') && prior !== next) storage.removeItem(`${BASE}:${prior}`);
          storage.setItem(OWNER, next);
          return true;
        }, false);
        if (!bound) return false;
        owner = next;
        identity = signature;
        return true;
      },
      read(context) {
        const key = contextKey(context);
        if (!owner || !available || !key) return null;
        const value = entries()[key];
        return value ? safeDraft(value) : null;
      },
      save(context, value) {
        const key = contextKey(context);
        if (!owner || !available || !key) return false;
        const values = entries();
        const clean = safeDraft(value);
        if (clean) values[key] = { ...clean, savedAt: now() };
        else delete values[key];
        const ordered = Object.entries(values)
          .reverse()
          .sort((left, right) => right[1].savedAt - left[1].savedAt);
        return write(Object.fromEntries(ordered.slice(0, MAX_ENTRIES)));
      },
      remove(context) {
        return this.save(context, null);
      },
      clear() {
        epoch += 1;
        access(() => {
          const prior = owner || storage.getItem(OWNER);
          if (HASH.test(prior || '')) storage.removeItem(`${BASE}:${prior}`);
          storage.removeItem(OWNER);
        });
        owner = '';
        identity = '';
      },
    };
  }
  const api = { createDraftStore, contextKey, safeDraft, MAX_AGE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FreeBbsLearningAnswerDrafts = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
