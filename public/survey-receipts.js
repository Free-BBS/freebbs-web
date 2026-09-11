/* A receipt is a private bearer credential. Never share it across browser identities. */
window.createSurveyReceiptStore = ({ local, session, crypto, getToken }) => {
  const key = 'freebbs_activity_receipts_v2';
  let token;
  let owner = null;
  let receipts = {};
  let revision = 0;
  function removeStored() {
    try {
      session.removeItem(key);
    } catch {
      /* Storage can be unavailable. */
    }
  }
  function persist() {
    if (!owner) return;
    try {
      session.setItem(key, JSON.stringify({ owner, receipts }));
    } catch {
      /* Keep memory only. */
    }
  }
  function clear() {
    revision += 1;
    receipts = {};
    owner = null;
    removeStored();
  }
  async function sync() {
    const nextToken = getToken();
    if (token !== undefined && token !== nextToken) clear();
    revision += 1;
    const pending = revision;
    token = nextToken;
    receipts = {};
    owner = null;
    // Legacy receipts have no trustworthy owner, so they must not be migrated.
    try {
      const legacy = [];
      for (let i = 0; i < local.length; i += 1) {
        const name = local.key(i);
        if (name?.startsWith('freebbs-survey-')) legacy.push(name);
      }
      legacy.forEach((name) => local.removeItem(name));
    } catch {
      /* Do not read legacy values even when removal is unavailable. */
    }
    let fingerprint = 'anonymous';
    if (nextToken) {
      if (!crypto?.subtle) fingerprint = null;
      else {
        try {
          const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(nextToken));
          fingerprint = Array.from(new Uint8Array(digest), (byte) =>
            byte.toString(16).padStart(2, '0'),
          ).join('');
        } catch {
          fingerprint = null;
        }
      }
    }
    if (pending !== revision || getToken() !== nextToken) return false;
    owner = fingerprint;
    try {
      const stored = JSON.parse(session.getItem(key) || 'null');
      if (
        owner &&
        stored?.owner === owner &&
        stored.receipts &&
        typeof stored.receipts === 'object' &&
        !Array.isArray(stored.receipts)
      ) {
        receipts = Object.fromEntries(
          Object.entries(stored.receipts).filter(
            ([, value]) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value),
          ),
        );
      } else removeStored();
    } catch {
      removeStored();
    }
    persist();
    return true;
  }
  function get(id) {
    return token === getToken() && Object.hasOwn(receipts, id) ? receipts[id] : '';
  }
  function set(id, receipt) {
    if (token !== getToken() || !/^[a-f0-9]{64}$/.test(receipt)) return false;
    receipts[id] = receipt;
    persist();
    return true;
  }
  return { sync, get, set, clear };
};
