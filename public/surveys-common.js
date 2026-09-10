window.SurveyUI = (() => {
  const base = '/api';
  window.FREEBBS_API_BASE = base;
  async function api(path, method = 'GET', body = undefined) {
    const headers = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem('free_bbs_auth_token');
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${base}${path}`, {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.message || '请求失败');
      error.status = response.status;
      throw error;
    }
    return data;
  }
  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function message(text) {
    document.getElementById('message').textContent = text;
  }
  function date(value) {
    return new Date(value).toLocaleString('zh-CN');
  }
  function status(s) {
    if (s.status === 'draft') return '草稿';
    if (s.status === 'cancelled') return '已取消';
    if (s.status === 'drawn') return '已抽签';
    if (Date.now() < new Date(s.opensAt)) return '即将开放';
    return Date.now() >= new Date(s.closesAt) ? '报名结束 · 待抽签' : '报名中';
  }
  function download(name, content, type = 'text/plain;charset=utf-8') {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = el('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return { api, el, message, date, status, download };
})();
