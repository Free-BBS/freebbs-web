/* Local learning markers belong to one stable user ID, never to an authentication token. */
(function exposeLearningProgress(root) {
  function dictionary(value) {
    return (
      value !== null &&
      typeof value === 'object' &&
      Object.prototype.toString.call(value) === '[object Object]'
    );
  }

  function scopedKey(base, userState) {
    if (typeof base !== 'string' || !base.trim() || base.length > 200) return null;
    if (userState == null) return `${base}:guest`;
    if (!dictionary(userState)) return null;
    if (userState.isLoggedIn === false) return `${base}:guest`;
    if (userState.isLoggedIn !== true) return null;
    const { uid } = userState;
    let owner = '';
    if (typeof uid === 'string') owner = uid.trim();
    else if (Number.isSafeInteger(uid) && uid > 0) owner = String(uid);
    if (!owner || owner.length > 160) return null;
    try {
      return `${base}:user:${encodeURIComponent(owner)}`;
    } catch {
      return null;
    }
  }

  function read(storage, base, userState) {
    try {
      const key = scopedKey(base, userState);
      if (!key || typeof storage?.getItem !== 'function') return {};
      const value = JSON.parse(storage.getItem(key));
      return dictionary(value) ? value : {};
    } catch {
      return {};
    }
  }

  function write(storage, base, userState, data) {
    const key = scopedKey(base, userState);
    if (!key) throw new TypeError('学习进度尚未确认账号归属，请稍后再试');
    if (!dictionary(data)) throw new TypeError('学习进度必须是对象');
    if (typeof storage?.setItem !== 'function') throw new TypeError('本地学习进度存储不可用');
    const serialized = JSON.stringify(data);
    if (!dictionary(JSON.parse(serialized))) throw new TypeError('学习进度必须序列化为对象');
    storage.setItem(key, serialized);
    return data;
  }

  const api = { scopedKey, read, write };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else if (root) Object.assign(root, { FreeBbsLearningProgress: api });
})(typeof globalThis !== 'undefined' ? globalThis : this);
