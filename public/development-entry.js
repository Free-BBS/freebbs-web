(function exposeDevelopmentEntry(root) {
  async function checkDevelopmentAccess({
    token,
    fetchImplementation,
    navigate,
    reportStatus = () => undefined,
  }) {
    if (!token || !token.trim()) return false;
    reportStatus('checking');
    try {
      const response = await fetchImplementation('/api/development/v1/me', {
        method: 'GET',
        cache: 'no-store',
        headers: { Authorization: `Bearer ${token.trim()}` },
      });
      if (!response.ok) {
        reportStatus(response.status >= 500 ? 'unavailable' : 'denied');
        return false;
      }
      navigate('/development/');
      return true;
    } catch {
      reportStatus('unavailable');
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
      reportStatus: (state) => {
        const status = window.document.getElementById('development-access-status');
        if (!status) return;
        const messages = {
          checking: '正在确认发展端访问权限…',
          unavailable: '发展端暂时无法连接，请稍后刷新重试。',
        };
        status.hidden = state === 'denied';
        status.dataset.state = state;
        status.textContent = messages[state] || '';
      },
    });
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { checkDevelopmentAccess };
  } else {
    Reflect.set(root, 'checkDevelopmentAccess', checkDevelopmentAccess);
  }
})(typeof globalThis === 'undefined' ? this : globalThis);
