(() => {
  let active;
  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-action="reward-post-author"]');
    const app = window.freeBbsApp;
    if (!trigger || !app?.userState.isAdmin || active) return;
    const owner = app.userState.uid,
      token = app.userState.token,
      id = trigger.dataset.postId;
    const key = 'free_bbs_post_reward:' + owner + ':' + id;
    const dialog = document.createElement('dialog');
    dialog.className = 'post-reward-dialog';
    dialog.setAttribute('aria-label', '奖励帖子作者');
    dialog.innerHTML =
      '<form><header><h2>奖励作者</h2><button type="button" data-close aria-label="关闭奖励">×</button></header><p class="post-reward-target"></p><div class="post-reward-amounts"><label>电元<input name="electric" type="number" min="0" max="1000000" step="1" value="5" required></label><label>磁元<input name="magnetic" type="number" min="0" max="1000000" step="1" value="0" required></label></div><label>奖励原因<textarea name="reason" maxlength="800" rows="3" placeholder="例如：感谢分享详细的实验过程" required></textarea></label><p role="status" data-status></p><footer><button type="submit">确认发放</button></footer></form>';
    dialog.querySelector('.post-reward-target').textContent =
      '奖励《' +
      (document.getElementById('discussion-detail-title')?.textContent || '当前帖子') +
      '》的作者；匿名帖也会准确发给原作者。';
    const form = dialog.querySelector('form'),
      status = dialog.querySelector('[data-status]'),
      submit = form.querySelector('[type="submit"]');
    let pending = null,
      busy = false;
    const lock = () => {
      for (const field of form.querySelectorAll('input,textarea'))
        field.readOnly = Boolean(pending);
    };
    try {
      pending = JSON.parse(sessionStorage.getItem(key) || 'null');
    } catch {}
    if (pending) {
      for (const name of ['electric', 'magnetic', 'reason'])
        form.elements[name].value = pending[name];
      status.textContent = '存在待确认的发放请求，重试会核对原请求，不会重复加币。';
      lock();
    }
    const current = () =>
      app.userState.isAdmin &&
      app.userState.uid === owner &&
      app.userState.token === token &&
      localStorage.getItem('free_bbs_auth_token') === token;
    const close = () => {
      if (!busy) dialog.close();
    };
    form.querySelector('[data-close]').addEventListener('click', close);
    dialog.addEventListener('cancel', (e) => {
      if (busy) e.preventDefault();
    });
    dialog.addEventListener('close', () => {
      dialog.remove();
      active = null;
      trigger.focus({ preventScroll: true });
    });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (busy || !current()) return;
      if (!pending) {
        const electric = Number(form.elements.electric.value),
          magnetic = Number(form.elements.magnetic.value),
          reason = form.elements.reason.value.trim();
        if (
          ![electric, magnetic].every((n) => Number.isSafeInteger(n) && n >= 0 && n <= 1000000) ||
          (!electric && !magnetic) ||
          !reason
        ) {
          status.textContent = '请填写正整数奖励数量和原因。';
          return;
        }
        pending = { requestId: crypto.randomUUID(), electric, magnetic, reason };
        try {
          sessionStorage.setItem(key, JSON.stringify(pending));
        } catch {
          pending = null;
          status.textContent = '无法保存发放请求，请允许浏览器存储后重试。';
          return;
        }
      }
      busy = true;
      submit.disabled = true;
      lock();
      status.textContent = '正在发放…';
      try {
        const result = await app.callApi(
          '/admin/discussion/posts/' + encodeURIComponent(id) + '/reward',
          { method: 'POST', body: JSON.stringify(pending) },
        );
        if (!current()) return;
        sessionStorage.removeItem(key);
        status.textContent =
          (result.replayed ? '已确认此前发放成功' : '发放成功') +
          '：' +
          result.electric +
          ' 电元、' +
          result.magnetic +
          ' 磁元。已记录流水并通知作者。';
        submit.hidden = true;
      } catch (error) {
        if (!current()) return;
        status.textContent = error.message + '；可重试同一请求，或到系统设置的奖励记录核对。';
        submit.textContent = '重试并核对';
        if ([400, 404].includes(error.status)) {
          pending = null;
          sessionStorage.removeItem(key);
          lock();
          submit.textContent = '确认发放';
        }
      } finally {
        busy = false;
        submit.disabled = false;
      }
    });
    active = dialog;
    document.body.append(dialog);
    dialog.showModal();
  });
  window.addEventListener('freebbs:session-change', () => active?.close());
})();
