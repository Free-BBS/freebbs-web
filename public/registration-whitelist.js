(() => {
  function initRegistrationWhitelist({ apiBaseUrl, getToken }) {
    const host = document.getElementById('admin-users-content');
    if (!host || document.getElementById('registration-whitelist-panel')) return;
    const section = document.createElement('section');
    section.className = 'settings-shell registration-whitelist-panel';
    section.id = 'registration-whitelist-panel';
    section.setAttribute('aria-label', '注册白名单管理');
    section.innerHTML = `
      <details class="whitelist-details">
        <summary><span>注册白名单</span><span class="whitelist-count" data-whitelist-count>正在加载</span></summary>
        <div class="whitelist-content">
          <p class="whitelist-help">仅允许白名单内的身份注册。同一行填写的字段必须全部匹配，留空的字段不限制，每行至少填写一项。每条身份仅可注册一次。</p>
          <form class="whitelist-upload-form">
            <label class="whitelist-file-label">Excel 白名单
              <input type="file" name="file" accept=".xlsx" required aria-label="选择 Excel 注册白名单" />
            </label>
            <label>导入方式
              <select name="mode" aria-label="白名单导入方式">
                <option value="append">追加到现有白名单</option>
                <option value="replace">替换当前全部白名单</option>
              </select>
            </label>
            <button type="submit" class="admin-button">上传白名单</button>
            <button type="button" class="admin-button admin-button-secondary" data-whitelist-template>下载 Excel 模板</button>
          </form>
          <p class="whitelist-help" data-whitelist-mode-help>支持 .xlsx 文件，最多 10,000 行、5 MB。导入错误时整份文件均不会生效。</p>
          <p class="whitelist-message" role="status" aria-live="polite"></p>
          <form class="whitelist-search-form" role="search">
            <input type="search" name="search" placeholder="搜索学号、姓名或邮箱" aria-label="搜索白名单" />
            <button class="admin-button admin-button-secondary" type="submit">搜索</button>
          </form>
          <div class="whitelist-table-scroll" tabindex="0" aria-label="白名单记录">
            <table class="whitelist-table">
              <thead><tr><th scope="col">学号</th><th scope="col">姓名</th><th scope="col">邮箱</th><th scope="col">状态</th><th scope="col">操作</th></tr></thead>
              <tbody></tbody>
            </table>
          </div>
          <div class="whitelist-pagination">
            <button type="button" class="admin-button admin-button-secondary" data-whitelist-prev>上一页</button>
            <span data-whitelist-page></span>
            <button type="button" class="admin-button admin-button-secondary" data-whitelist-next>下一页</button>
          </div>
        </div>
      </details>`;
    host.prepend(section);
    const message = section.querySelector('.whitelist-message');
    const uploadForm = section.querySelector('.whitelist-upload-form');
    const searchForm = section.querySelector('.whitelist-search-form');
    let page = 1;
    let query = '';
    let loadGeneration = 0;
    const endpoint = `${apiBaseUrl.replace(/\/$/, '')}/admin/registration-whitelist`;

    function showMessage(text, failed = false) {
      message.textContent = text;
      message.classList.toggle('is-error', failed);
    }

    async function request(suffix = '', options = {}) {
      const response = await fetch(`${endpoint}${suffix}`, {
        ...options,
        headers: { Authorization: `Bearer ${getToken()}`, ...options.headers },
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const errors = (payload.errors || []).map(
          (error) => `第 ${error.row} 行：${error.message}`,
        );
        throw new Error([payload.message || '白名单操作失败', ...errors].join('\n'));
      }
      return response;
    }

    async function load() {
      loadGeneration += 1;
      const generation = loadGeneration;
      try {
        const response = await request(`?page=${page}&search=${encodeURIComponent(query)}`);
        const payload = await response.json();
        if (generation !== loadGeneration) return;
        const totalPages = Math.max(1, Math.ceil(payload.total / payload.pageSize));
        if (page > totalPages) {
          page = totalPages;
          await load();
          return;
        }
        section.querySelector('[data-whitelist-count]').textContent =
          `${payload.stats.total} 条 · ${payload.stats.total - payload.stats.claimed} 条可注册`;
        section.querySelector('[data-whitelist-page]').textContent =
          `第 ${page} / ${totalPages} 页`;
        section.querySelector('[data-whitelist-prev]').disabled = page <= 1;
        section.querySelector('[data-whitelist-next]').disabled = page >= totalPages;
        const body = section.querySelector('tbody');
        body.replaceChildren();
        payload.entries.forEach((entry) => {
          const row = document.createElement('tr');
          [
            entry.studentId || '不限',
            entry.fullName || '不限',
            entry.email || '不限',
            entry.claimed ? '已注册' : '可注册',
          ].forEach((value) => {
            const cell = document.createElement('td');
            cell.textContent = value;
            row.append(cell);
          });
          const action = document.createElement('td');
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'admin-button admin-button-secondary';
          button.textContent = '移除';
          button.setAttribute(
            'aria-label',
            `移除白名单 ${entry.studentId || entry.fullName || entry.email}`,
          );
          button.addEventListener('click', async () => {
            button.disabled = true;
            try {
              await request(`/${entry.id}`, { method: 'DELETE' });
              showMessage('白名单记录已移除，已有账户不受影响。');
              await load();
            } catch (error) {
              showMessage(error.message, true);
              button.disabled = false;
            }
          });
          action.append(button);
          row.append(action);
          body.append(row);
        });
        if (!payload.entries.length) {
          const row = document.createElement('tr');
          const cell = document.createElement('td');
          cell.colSpan = 5;
          cell.className = 'whitelist-empty';
          cell.textContent = query
            ? '没有匹配的白名单记录'
            : '白名单为空，当前不允许新用户注册。请上传填写好的模板。';
          row.append(cell);
          body.append(row);
        }
      } catch (error) {
        showMessage(error.message, true);
      }
    }

    uploadForm.elements.mode.addEventListener('change', () => {
      section.querySelector('[data-whitelist-mode-help]').textContent =
        uploadForm.elements.mode.value === 'replace'
          ? '替换后，仅本次文件中的身份可注册。已有账户和已使用的注册记录会保留。'
          : '支持 .xlsx 文件，最多 10,000 行、5 MB。导入错误时整份文件均不会生效。';
    });
    uploadForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const file = uploadForm.elements.file.files[0];
      if (!file || !/\.xlsx$/i.test(file.name) || file.size > 5 * 1024 * 1024) {
        showMessage('请选择不超过 5 MB 的 .xlsx 文件。', true);
        return;
      }
      const button = uploadForm.querySelector('[type="submit"]');
      button.disabled = true;
      showMessage('正在校验并导入白名单…');
      try {
        const response = await request(`/import?mode=${uploadForm.elements.mode.value}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          },
          body: file,
        });
        const result = await response.json();
        showMessage(
          `已导入 ${result.imported} 条白名单${result.duplicates ? `，忽略 ${result.duplicates} 条重复记录` : ''}。`,
        );
        uploadForm.elements.file.value = '';
        page = 1;
        await load();
      } catch (error) {
        showMessage(error.message, true);
      } finally {
        button.disabled = false;
      }
    });
    section.querySelector('[data-whitelist-template]').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const response = await request('/template');
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement('a');
        link.href = url;
        link.download = 'registration-whitelist-template.xlsx';
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (error) {
        showMessage(error.message, true);
      } finally {
        button.disabled = false;
      }
    });
    searchForm.addEventListener('submit', (event) => {
      event.preventDefault();
      page = 1;
      query = searchForm.elements.search.value.trim();
      load();
    });
    section.querySelector('[data-whitelist-prev]').addEventListener('click', () => {
      page -= 1;
      load();
    });
    section.querySelector('[data-whitelist-next]').addEventListener('click', () => {
      page += 1;
      load();
    });
    load();
  }
  window.initRegistrationWhitelist = initRegistrationWhitelist;
})();
