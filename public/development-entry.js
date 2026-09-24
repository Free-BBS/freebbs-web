(function exposeDevelopmentEntry(root) {
  async function checkDevelopmentAccess({ token, fetchImplementation, navigate }) {
    if (!token || !token.trim()) return false;
    try {
      const response = await fetchImplementation('/api/development/v1/me', {
        method: 'GET',
        cache: 'no-store',
        headers: { Authorization: `Bearer ${token.trim()}` },
      });
      if (!response.ok) return false;
      navigate('/development/');
      return true;
    } catch {
      return false;
    }
  }

  if (typeof window !== 'undefined' && window.location.pathname === '/development') {
    let token = '';
    try {
      token = window.localStorage.getItem('free_bbs_auth_token') || '';
    } catch {
      token = '';
    }
    checkDevelopmentAccess({
      token,
      fetchImplementation: window.fetch.bind(window),
      navigate: (url) => window.location.assign(url),
    });
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { checkDevelopmentAccess };
  } else {
    Reflect.set(root, 'checkDevelopmentAccess', checkDevelopmentAccess);
  }
})(typeof globalThis === 'undefined' ? this : globalThis);
