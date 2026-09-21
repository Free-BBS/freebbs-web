(() => {
  function settingsProfileHref(user) {
    const uid = String(user?.uid || '').trim();
    if (!user?.isLoggedIn || !(/^u_?[a-z0-9]{6,32}$/i.test(uid) || /^20\d{8}$/.test(uid)))
      return '';
    return `/profile?uid=${encodeURIComponent(uid)}`;
  }

  function createSettingsProfileLink(win, doc, app) {
    const link = doc.getElementById('settings-profile-link');
    if (!link || !app) return null;
    let staleSession = false;
    function render() {
      const href = staleSession ? '' : settingsProfileHref(app.userState);
      link.hidden = !href;
      if (href) link.setAttribute('href', href);
      else link.removeAttribute('href');
    }
    win.addEventListener('freebbs:session-change', () => {
      staleSession = false;
      render();
    });
    win.addEventListener('storage', (event) => {
      if (event.key !== 'free_bbs_auth_token' && event.key !== null) return;
      staleSession = true;
      render();
    });
    link.addEventListener('click', (event) => {
      render();
      if (link.hidden) event.preventDefault();
    });
    app.sessionReady.then(render).catch(() => {
      staleSession = true;
      render();
    });
    return { render };
  }

  if (typeof module === 'object' && module.exports)
    module.exports = { settingsProfileHref, createSettingsProfileLink };
  else createSettingsProfileLink(window, document, window.freeBbsApp);
})();
