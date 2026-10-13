(function () {
  // Existing composers call this before upload/submission. It checks the login
  // acknowledgement without opening another dialog or manufacturing acceptance.
  async function confirm({ callApi, isCurrent }) {
    const status = await callApi('/privacy-policy/status');
    if (!isCurrent()) throw new Error('登录状态或当前内容已变化，请重新提交。');
    if (status?.accepted !== true || typeof status.version !== 'string' || !status.version)
      throw new Error('请先登录并确认隐私政策，内容已保留。');
    return status.version;
  }
  window.FreeBbsModerationNotice = { confirm };
})();
