(() => {
  let cleanup = () => {};
  let ownerUid = '';
  function attach(element, controller, uid) {
    cleanup();
    ownerUid = uid || '';
    if (!element || !controller || !uid || !document.body.classList.contains('ranch-page')) return;
    let state;
    let offset = 0;
    let stream;
    let frame;
    let stopped = false;
    let arrived = 0;
    function tick() {
      frame = null;
      if (stopped || document.hidden || !state || !element.isConnected) return;
      const index = state.sheep.findIndex((sheep) => sheep.uid === uid);
      if (index >= 0)
        controller.syncFrame(
          window.FreeBbsRanchWorld.positionFor(
            state.sheep[index],
            index,
            state.sheep,
            Math.min(Date.now(), arrived + 5000) + offset,
            state.events,
          ),
        );
      frame = requestAnimationFrame(tick);
    }
    function connect() {
      stream?.close();
      stream = null;
      if (stopped || document.hidden) return;
      const base = window.freeBbsApp?.apiBaseUrl || window.FREEBBS_API_BASE || '/api';
      stream = new EventSource(`${base}/ranch-world/stream`);
      stream.addEventListener('world', (event) => {
        try {
          const result = JSON.parse(event.data);
          if (!Array.isArray(result.sheep) || (state && result.revision < state.revision)) return;
          state = result;
          offset = result.serverNowMs - Date.now();
          arrived = Date.now();
          const sheep = state.sheep.find((item) => item.uid === uid);
          if (sheep) window.FreeBbsRanchDesign?.apply(element, sheep.design);
          if (!frame) tick();
        } catch {
          /* Keep the last shared frame until reconnection. */
        }
      });
    }
    const visibility = () => {
      if (document.hidden) {
        stream?.close();
        stream = null;
        cancelAnimationFrame(frame);
        frame = null;
      } else connect();
    };
    const hide = () => {
      stream?.close();
      stream = null;
      cancelAnimationFrame(frame);
      frame = null;
    };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', connect);
    cleanup = () => {
      stopped = true;
      hide();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', connect);
    };
    connect();
  }
  async function interact(kind) {
    await window.freeBbsApp?.sessionReady;
    const message = document.getElementById('profile-extras-message');
    if (!window.freeBbsApp?.userState?.isLoggedIn) {
      if (message) message.textContent = '登录后才能与 Max 互动。';
      return;
    }
    try {
      await window.freeBbsApp.callApi('/ranch-world/actions', {
        method: 'POST',
        body: JSON.stringify({ kind, actor: ownerUid }),
      });
      if (message) message.textContent = 'Max 收到啦，大家都能看见这次互动。';
    } catch (error) {
      if (message) message.textContent = error.message || '同步失败，请重试';
    }
  }
  window.FreeBbsRanchSharedView = { attach, interact, detach: () => cleanup() };
})();
