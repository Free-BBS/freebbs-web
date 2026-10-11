/* Unsent questions stay in this tab; they are never learning evidence or an AI request. */
(function exposeChatDrafts(root) {
  const BASE = 'free_bbs_learning_chat_drafts_v1';
  const OWNER = `${BASE}:owner`;
  const MAX_AGE = 24 * 60 * 60 * 1000;
  const MAX_ENTRIES = 32;
  const HASH = /^[a-f0-9]{64}$/;

  function contextKey(context) {
    if (
      !context ||
      !/^[a-z0-9][a-z0-9-]{0,119}$/.test(context.courseSlug || '') ||
      !/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/.test(context.nodeId || '') ||
      context.nodeId.length > 64 ||
      !HASH.test(context.documentVersion || '') ||
      (context.originDocumentVersion && !HASH.test(context.originDocumentVersion))
    )
      return null;
    return JSON.stringify([
      context.courseSlug,
      context.nodeId,
      context.documentVersion,
      context.originDocumentVersion || '',
    ]);
  }

  function safeDraft(value) {
    if (!value || typeof value.text !== 'string' || !value.text.trim() || value.text.length > 4000)
      return null;
    return { text: value.text };
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
        if (!raw || raw.length > 180000) return {};
        const saved = JSON.parse(raw);
        if (saved?.schemaVersion !== 1 || !saved.entries || Array.isArray(saved.entries)) return {};
        const current = Object.create(null);
        for (const [key, value] of Object.entries(saved.entries)) {
          const draft = safeDraft(value);
          if (
            draft &&
            Number.isFinite(value.savedAt) &&
            value.savedAt <= now() &&
            now() - value.savedAt < MAX_AGE
          )
            current[key] = { ...draft, savedAt: value.savedAt };
        }
        return current;
      }, {});
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
        if (pending !== epoch || !available || !HASH.test(next || '')) return false;
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
        return safeDraft(entries()[key]);
      },
      save(context, value) {
        const key = contextKey(context);
        if (!owner || !available || !key) return false;
        const values = entries();
        if (!available) return false;
        const draft = safeDraft(value);
        if (draft) values[key] = { ...draft, savedAt: now() };
        else delete values[key];
        const ordered = Object.entries(values)
          .reverse()
          .sort((left, right) => right[1].savedAt - left[1].savedAt);
        return access(() => {
          storage.setItem(
            `${BASE}:${owner}`,
            JSON.stringify({
              schemaVersion: 1,
              entries: Object.fromEntries(ordered.slice(0, MAX_ENTRIES)),
            }),
          );
          return true;
        }, false);
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
  const api = { createDraftStore, contextKey, safeDraft, MAX_AGE, MAX_ENTRIES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FreeBbsLearningChatDrafts = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
