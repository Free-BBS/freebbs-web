/* global API_BASE_URL, callApi, escapeHtml, userState */
(() => {
  const content = document.getElementById('training-content');
  const announcement = document.getElementById('training-announcement');
  const params = new URLSearchParams(window.location.search);
  const applySlug = params.get('apply');
  const reviewSlug = params.get('review');
  const courseId = params.get('course');
  if (applySlug) content.dataset.view = 'application';
  else if (courseId) content.dataset.view = 'course';
  const phases = {
    upcoming: '报名即将开始',
    open: '报名中',
    closed: '报名已截止',
    published: '录取已发布',
  };
  const formatDate = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    year: 'numeric',
  });
  const escape = (value) => escapeHtml(String(value ?? ''));
  const date = (value) => formatDate.format(value);
  const button = (label, attributes = '') =>
    `<button type="button" class="training-button" ${attributes}>${label}</button>`;
  const submit = (label) =>
    `<button type="submit" class="training-button training-primary">${label}</button>`;
  const link = (label, path) =>
    `<a class="training-button" href="${escape(path)}">${escape(label)}</a>`;
  const route = (key, value) => `/training?${new URLSearchParams({ [key]: value })}`;
  const batchEndpoint = (slug) => `/batches/${encodeURIComponent(slug)}`;
  const courseEndpoint = `/courses/${encodeURIComponent(courseId || '')}`;
  const back = '<a class="training-back" href="/training">‹ 小班辅导</a>';
  const empty = (message) => `<p class="training-empty">${escape(message)}</p>`;
  const errorField = '<p class="training-error" role="alert" hidden></p>';

  function api(path, method, payload) {
    return callApi(`/training${path}`, { method, body: JSON.stringify(payload) });
  }

  function setPage(title, markup, intro = '', actions = '') {
    content.innerHTML =
      `<header class="training-heading"><div>` +
      `<h1>${escape(title)}</h1>${intro ? `<p>${escape(intro)}</p>` : ''}</div>${
        actions ? `<div class="training-actions">${actions}</div>` : ''
      }</header>${markup}`;
    document.title = `${title} · FREE-BBS`;
  }

  function tell(message) {
    announcement.textContent = message;
  }

  function showError(container, message) {
    const field = container.querySelector('.training-error');
    field.textContent = message;
    field.hidden = !message;
  }

  async function run(container, control, action) {
    if (control.disabled) return;
    control.disabled = true;
    const label = control.textContent;
    control.textContent = '处理中…';
    showError(container, '');
    try {
      await action();
    } catch (error) {
      showError(container, error.message);
    } finally {
      control.disabled = false;
      if (control.textContent === '处理中…') control.textContent = label;
    }
  }

  function bindForm(form, action) {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      run(form, event.submitter || form.querySelector('[type=submit]'), () =>
        action(new FormData(form)),
      );
    });
  }

  function dialog(title, markup, { className = '' } = {}) {
    const windowElement = document.createElement('dialog');
    windowElement.className = `training-dialog ${className}`;
    windowElement.setAttribute('aria-label', title);
    windowElement.innerHTML = `<h2>${escape(title)}</h2>${markup}`;
    windowElement.addEventListener('close', () => windowElement.remove(), { once: true });
    windowElement
      .querySelector('[data-close]')
      ?.addEventListener('click', () => windowElement.close());
    document.body.append(windowElement);
    windowElement.showModal();
    return windowElement;
  }

  function localDate(value) {
    if (value === null || value === undefined) return '';
    return new Date(value + 8 * 3600000).toISOString().slice(0, 16);
  }

  const toTimestamp = (value) => Date.parse(`${value}:00+08:00`);

  function courseFacts(course) {
    return `<dl class="training-facts">${[
      ['任课老师', course.teacher || '待定'],
      ['讲师', course.lecturers.join('、') || '待定'],
      [
        '上课时间',
        course.startsAt === null ? '待定' : `${date(course.startsAt)} 至 ${date(course.endsAt)}`,
      ],
      ['上课地点', course.location || '待定'],
    ]
      .map(([label, value]) => `<div><dt>${label}</dt><dd>${escape(value)}</dd></div>`)
      .join('')}</dl>`;
  }

  async function copyLink(slug, control) {
    const url = new URL(route('apply', slug), window.location.origin).href;
    try {
      await navigator.clipboard.writeText(url);
      control.textContent = '已复制';
      tell('报名链接已复制');
      setTimeout(() => {
        control.textContent = '复制报名链接';
      }, 1800);
    } catch {
      const copy = dialog(
        '报名链接',
        `<input class="training-input" readonly aria-label="报名链接" value="${escape(url)}" />` +
          `<div class="training-actions">${button('关闭', 'data-close')}</div>`,
      );
      copy.querySelector('input').select();
    }
  }

  async function renderDirectory() {
    const { access, batches } = await api('/');
    const actions =
      (access.minister ? button('新建报名批次', 'id="training-new"') : '') +
      (access.admin ? link('学培权限', '/training?people=1') : '');
    const markup = batches
      .map((batch) => {
        const application = batch.phase === 'open' ? '讲师报名' : '查看报名';
        const tools =
          link(application, route('apply', batch.slug)) +
          (access.minister ? button('复制报名链接', `data-copy="${escape(batch.slug)}"`) : '') +
          (access.minister && ['closed', 'published'].includes(batch.phase)
            ? link(
                batch.phase === 'published' ? '录取名单' : '审核与排班',
                route('review', batch.slug),
              )
            : '');
        const cards = batch.courses
          .map(
            (course) =>
              `<a class="training-card" href="${route('course', course.id)}"><h3>${escape(
                course.title,
              )}</h3>${courseFacts(course)}</a>`,
          )
          .join('');
        return (
          `<section class="training-batch"><header class="training-section-heading">` +
          `<div><p class="training-phase">${phases[batch.phase]}</p><h2>${escape(
            batch.title,
          )}</h2><p>${date(batch.opensAt)} 至 ${date(batch.closesAt)}（北京时间）</p></div>` +
          `<div class="training-actions">${tools}</div></header>${
            cards ? `<div class="training-grid">${cards}</div>` : ''
          }</section>`
        );
      })
      .join('');
    setPage(
      '小班辅导',
      (access.revoked ? empty('你的课程查看权限已暂停。') : '') +
        (markup || empty('暂无小班辅导批次。')),
      '',
      actions,
    );
    content.querySelector('#training-new')?.addEventListener('click', openBatchForm);
    content.querySelectorAll('[data-copy]').forEach((control) => {
      control.addEventListener('click', () => copyLink(control.dataset.copy, control));
    });
  }

  function openBatchForm() {
    const modal = dialog(
      '新建报名批次',
      `<form class="training-form">` +
        `<label>批次名称<input name="title" maxlength="100" required></label>` +
        `<div class="training-columns"><label>报名开始（北京时间）<input name="opensAt" type="datetime-local" required></label>` +
        `<label>报名截止（北京时间）<input name="closesAt" type="datetime-local" required></label></div>` +
        `<fieldset><legend>所需课堂</legend><div id="training-offered" class="training-stack"></div>${button(
          '添加课堂',
          'data-add',
        )}</fieldset>${errorField}<div class="training-actions">${button(
          '取消',
          'data-close',
        )}${submit('创建报名批次')}</div></form>`,
    );
    const form = modal.querySelector('form');
    const offered = form.querySelector('#training-offered');
    const add = form.querySelector('[data-add]');
    function addCourse() {
      const row = document.createElement('div');
      row.className = 'training-offered-row';
      row.innerHTML =
        `<label>科目<input name="courseTitle" maxlength="100" required></label>` +
        `<label>任课老师<input name="teacher" maxlength="100"></label>` +
        `<label>讲师名额<input name="capacity" type="number" min="1" max="20" value="1" required></label>${button(
          '移除',
          'data-remove',
        )}`;
      row.querySelector('[data-remove]').addEventListener('click', () => {
        if (offered.childElementCount > 1) row.remove();
        add.disabled = false;
      });
      offered.append(row);
      add.disabled = offered.childElementCount >= 40;
      return row;
    }
    addCourse();
    form.elements.opensAt.value = localDate(Date.now());
    add.addEventListener('click', () => addCourse().querySelector('input').focus());
    bindForm(form, async (values) => {
      const teachers = values.getAll('teacher');
      const capacities = values.getAll('capacity');
      await api('/batches', 'POST', {
        title: values.get('title'),
        opensAt: toTimestamp(values.get('opensAt')),
        closesAt: toTimestamp(values.get('closesAt')),
        courses: values.getAll('courseTitle').map((title, index) => ({
          title,
          teacher: teachers[index],
          capacity: Number(capacities[index]),
        })),
      });
      modal.close();
      await renderDirectory();
      tell('报名批次已创建');
    });
  }

  function paintSignature(canvas, strokes) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#19343b';
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    strokes.forEach((stroke) => {
      ctx.beginPath();
      stroke.forEach(([x, y], index) => {
        const point = [(x * canvas.width) / 1000, (y * canvas.height) / 1000];
        if (index) ctx.lineTo(...point);
        else ctx.moveTo(...point);
      });
      if (stroke.length === 1) {
        const [[x, y]] = stroke;
        ctx.arc((x * canvas.width) / 1000, (y * canvas.height) / 1000, 2, 0, Math.PI * 2);
        ctx.fill();
      } else ctx.stroke();
    });
  }

  function captureSignature(previous, onSave) {
    const modal = dialog(
      '手写签名',
      `<canvas class="training-canvas" width="1000" height="360" aria-label="手写签名区域"></canvas>${
        errorField
      }<div class="training-actions">${button('取消', 'data-close')}${button(
        '清除',
        'data-clear',
      )}${button('使用此签名', 'data-save')}</div>`,
      { className: 'training-signature' },
    );
    const canvas = modal.querySelector('canvas');
    const strokes = structuredClone(previous || []);
    let current = null;
    let pointer = null;
    const redraw = () => paintSignature(canvas, strokes);
    function record(event) {
      const rect = canvas.getBoundingClientRect();
      const rotated = matchMedia('(pointer: coarse) and (orientation: portrait)').matches;
      const x = rotated
        ? (event.clientY - rect.top) / rect.height
        : (event.clientX - rect.left) / rect.width;
      const y = rotated
        ? (rect.right - event.clientX) / rect.width
        : (event.clientY - rect.top) / rect.height;
      const point = [x, y].map((coordinate) =>
        Math.round(Math.max(0, Math.min(1, coordinate)) * 1000),
      );
      const last = current.at(-1);
      if (!last || last[0] !== point[0] || last[1] !== point[1]) current.push(point);
      redraw();
    }
    canvas.addEventListener('pointerdown', (event) => {
      if (pointer !== null || event.button !== 0) return;
      if (strokes.length >= 100 || strokes.flat().length >= 5000) return;
      pointer = event.pointerId;
      current = [];
      strokes.push(current);
      canvas.setPointerCapture(pointer);
      record(event);
    });
    canvas.addEventListener('pointermove', (event) => {
      if (event.pointerId === pointer && strokes.flat().length < 5000) record(event);
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((type) => {
      canvas.addEventListener(type, (event) => {
        if (event.pointerId === pointer) {
          current = null;
          pointer = null;
        }
      });
    });
    modal.querySelector('[data-clear]').addEventListener('click', () => {
      strokes.length = 0;
      redraw();
    });
    modal.querySelector('[data-save]').addEventListener('click', () => {
      if (
        !strokes.some(([first, ...rest]) =>
          rest.some(([x, y]) => Math.hypot(x - first[0], y - first[1]) >= 15),
        )
      ) {
        showError(modal, '请在签名区域完成手写签名');
        return;
      }
      modal.close();
      onSave(strokes);
    });
    redraw();
  }

  function showSignature(container, strokes) {
    const canvas = container.querySelector('canvas');
    paintSignature(canvas, strokes);
    canvas.hidden = false;
  }

  async function renderApplication() {
    const endpoint = batchEndpoint(applySlug);
    const batch = await api(endpoint);
    const { application } = batch;
    const intro = `${date(batch.opensAt)} 至 ${date(batch.closesAt)}（北京时间）`;
    let markup = '';
    if (application) {
      let status = '报名已提交。录取发布后可在这里查看结果。';
      if (batch.phase === 'published') {
        status = application.assignedCourse
          ? `你已被录取为「${application.assignedCourse}」的讲师。`
          : '本期报名未录取。';
      }
      setPage(`${batch.title} · 讲师报名`, empty(status), intro, back);
      return;
    }
    if (batch.phase !== 'open') {
      setPage(`${batch.title} · 讲师报名`, empty(phases[batch.phase]), intro, back);
      return;
    }
    markup =
      `<form class="training-form training-panel">` +
      `<fieldset><legend>报名课堂</legend><p>添加科目后使用「上移」「下移」调整志愿顺位。</p>` +
      `<div class="training-inline"><label class="visually-hidden" for="training-pick">选择报名科目</label>` +
      `<select id="training-pick"><option value="">选择科目</option>${batch.courses
        .map(({ id, title }) => `<option value="${id}">${escape(title)}</option>`)
        .join('')}<option value="custom">其他，请输入</option></select>${button(
        '添加志愿',
        'id="training-add-preference"',
      )}</div>` +
      `<div id="training-custom" hidden class="training-inline"><label class="visually-hidden" for="training-custom-title">自选科目</label>` +
      `<input id="training-custom-title" placeholder="输入科目名称" maxlength="100"></div>` +
      `<ol id="training-preferences" class="training-stack"></ol></fieldset>` +
      `<label>自我介绍<textarea name="introduction" rows="5" maxlength="5000" required ` +
      `placeholder="请说明你的报名原因和优势，包括但不限于成绩、辅导经验等"></textarea></label>` +
      `<fieldset><legend>是否乐学讲师</legend><p>本题仅用于确认补助发放方式，不作为报名审核参考。</p>` +
      `<div class="training-options"><label><input type="radio" name="lexue" value="yes" required>是</label>` +
      `<label><input type="radio" name="lexue" value="no" required>否</label></div></fieldset>` +
      `<fieldset><legend>签字确认</legend><p>我保证本次问卷为（${escape(
        batch.fullName,
      )}）本人填写，若被录取为讲师，如无特殊原因将听从电子系学生科协学培部对于讲授科目的安排。</p>` +
      `<canvas class="training-signature-preview" width="500" height="180" aria-label="签名预览" hidden></canvas>${button(
        '手写签名',
        'id="training-sign"',
      )}</fieldset>${errorField}<div class="training-actions">${submit('提交报名')}</div></form>`;
    setPage(`${batch.title} · 讲师报名`, markup, intro, back);
    const form = content.querySelector('form');
    const pick = form.querySelector('#training-pick');
    const custom = form.querySelector('#training-custom');
    const titleInput = custom.querySelector('input');
    const list = form.querySelector('ol');
    const preferences = [];
    let signed = null;

    function renderPreferences() {
      list.innerHTML = preferences
        .map(
          ({ title }, index) =>
            `<li class="training-preference"><strong>${index + 1}. ${escape(title)}</strong>` +
            `<div class="training-actions">${button(
              '上移',
              `data-change="-1" ${index === 0 ? 'disabled' : ''}`,
            )}${button(
              '下移',
              `data-change="1" ${index === preferences.length - 1 ? 'disabled' : ''}`,
            )}${button('移除', 'data-change="0"')}</div></li>`,
        )
        .join('');
    }
    pick.addEventListener('change', () => {
      custom.hidden = pick.value !== 'custom';
      if (!custom.hidden) titleInput.focus();
    });
    form.querySelector('#training-add-preference').addEventListener('click', () => {
      const item = batch.courses.find(({ id }) => String(id) === pick.value);
      const title = item?.title || (pick.value === 'custom' ? titleInput.value.trim() : '');
      if (!title) {
        showError(form, '请选择科目或输入自选科目名称');
        return;
      }
      const key = (value) => value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
      if (preferences.some((preference) => key(preference.title) === key(title))) {
        showError(form, '该科目已经添加');
        return;
      }
      if (preferences.length >= 20) {
        showError(form, '最多可填写 20 个志愿');
        return;
      }
      preferences.push({ title, value: item?.id || title });
      titleInput.value = '';
      showError(form, '');
      renderPreferences();
    });
    titleInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        form.querySelector('#training-add-preference').click();
      }
    });
    list.addEventListener('click', (event) => {
      const control = event.target.closest('[data-change]');
      if (!control) return;
      const index = Array.from(list.children).indexOf(control.closest('li'));
      const delta = Number(control.dataset.change);
      const [moved] = preferences.splice(index, 1);
      if (delta) preferences.splice(index + delta, 0, moved);
      renderPreferences();
      list.children[Math.min(index + delta, list.children.length - 1)]
        ?.querySelector('button:not(:disabled)')
        ?.focus();
    });
    const sign = form.querySelector('#training-sign');
    sign.addEventListener('click', () =>
      captureSignature(signed, (strokes) => {
        signed = strokes;
        showSignature(form, signed);
        sign.textContent = '重新签名';
      }),
    );
    bindForm(form, async (values) => {
      if (!preferences.length) throw new Error('请添加至少一个报名科目');
      if (!signed) throw new Error('请完成手写签名');
      await api(`${endpoint}/applications`, 'POST', {
        introduction: values.get('introduction'),
        isLexue: values.get('lexue') === 'yes',
        preferences: preferences.map(({ value }) => value),
        signature: signed,
      });
      await renderApplication();
      tell('讲师报名问卷填写成功');
    });
  }

  async function renderReview() {
    const endpoint = batchEndpoint(reviewSlug);
    const { batch, courses, applications, published } = await api(`${endpoint}/review`);
    const courseById = new Map(courses.map((course) => [course.id, course]));
    const applicationById = new Map(
      applications.map((application) => [application.id, application]),
    );
    const expanded = new Set(
      Array.from(content.querySelectorAll('details[open]'), (item) => item.id),
    );
    const disabled = published ? 'disabled' : '';
    const selected = (value, actual) => (value === actual ? 'selected' : '');
    const courseList = courses
      .map(
        (course) =>
          `<form class="training-inline training-review-row" data-course="${course.id}">` +
          `<strong>${escape(course.title)}${course.offered ? '' : '（自选）'}</strong>` +
          `<label>任课老师<input name="teacher" maxlength="100" value="${escape(course.teacher)}" ${
            disabled
          }></label>` +
          `<label>讲师名额<input name="capacity" type="number" min="${
            course.offered ? 1 : 0
          }" max="20" value="${course.capacity}" required ${disabled}></label>${
            published ? '' : submit('保存')
          }${errorField}</form>`,
      )
      .join('');
    const decisions = { accept: '保送', deny: '否决' };
    const applicationList = applications
      .map(
        (application) =>
          `<details class="training-applicant" id="application-${application.id}" ${
            expanded.has(`application-${application.id}`) ? 'open' : ''
          }><summary>` +
          `<strong>${escape(application.fullName)}</strong> <span>${escape(
            application.studentId,
          )}</span></summary>` +
          `<div class="training-applicant-body"><p>邮箱 ${escape(
            application.email || '未提供',
          )}</p>` +
          `<p class="training-preserve">${escape(application.introduction)}</p>${
            published ? `<p>乐学讲师 ${application.isLexue ? '是' : '否'}</p>` : ''
          }<canvas class="training-signature-preview" width="500" height="180" aria-label="报名签名"></canvas>` +
          `<ol class="training-stack">${application.preferences
            .map(
              ({ courseId: preference, decision }, index) =>
                `<li><form class="training-inline training-review-row" data-application="${
                  application.id
                }" data-preference="${preference}"><strong>${index + 1}. ${escape(
                  courseById.get(preference).title,
                )}</strong>${
                  published
                    ? `<span>${decisions[decision] || '常规排班'}</span>`
                    : `<label>审核决定<select name="decision">` +
                      `<option value="" ${selected(null, decision)}>按志愿排班</option>` +
                      `<option value="accept" ${selected('accept', decision)}>保送</option>` +
                      `<option value="deny" ${selected(
                        'deny',
                        decision,
                      )}>否决</option></select></label>${submit('保存')}`
                }${errorField}</form></li>`,
            )
            .join('')}</ol></div></details>`,
      )
      .join('');

    function resultMarkup(assignments) {
      const names = new Map();
      const placed = new Set();
      assignments.forEach(({ applicationId, courseId: assignedCourseId }) => {
        placed.add(applicationId);
        if (!names.has(assignedCourseId)) names.set(assignedCourseId, []);
        names.get(assignedCourseId).push(applicationById.get(applicationId).fullName);
      });
      const results = courses
        .filter(({ capacity }) => capacity > 0)
        .map(
          ({ id, title, capacity }) =>
            `<div><dt>${escape(title)}（${names.get(id)?.length || 0}/${
              capacity
            }）</dt><dd>${escape(names.get(id)?.join('、') || '暂无讲师')}</dd></div>`,
        )
        .join('');
      const unassigned = applications
        .filter(({ id }) => !placed.has(id))
        .map(({ fullName }) => fullName);
      return `${results ? `<dl class="training-results">${results}</dl>` : ''}<p>未分配 ${escape(
        unassigned.join('、') || '无',
      )}</p>`;
    }

    const schedule = `<section class="training-panel" id="training-schedule"><h2>录取名单</h2>${
      published
        ? `${resultMarkup(published.assignments)}<p>已由 ${escape(
            published.signature.fullName,
          )} 确认发布</p>` +
          `<canvas class="training-signature-preview" width="500" height="180" aria-label="录取确认签名"></canvas>`
        : `<div id="training-schedule-preview"></div><div class="training-actions">${button(
            '一键排班',
            'id="training-start"',
          )}${button('继续排班', 'id="training-continue" hidden')}${button(
            '签名并发布',
            'id="training-publish" hidden',
          )}</div>${errorField}`
    }</section>`;
    setPage(
      `${batch.title} · 审核与排班`,
      `<section class="training-panel"><h2>排班科目</h2>${
        published ? '' : '<p>自选科目设置至少一个名额后即可参与排班。</p>'
      }<div class="training-stack">${courseList}</div></section>` +
        `<section class="training-panel"><h2>报名名单（${applications.length}）</h2>` +
        `<div class="training-stack">${applicationList || empty('本期暂无报名。')}</div></section>${
          schedule
        }`,
      '',
      back,
    );
    applications.forEach((application) => {
      showSignature(content.querySelector(`#application-${application.id}`), application.signature);
    });
    const schedulePanel = content.querySelector('#training-schedule');
    if (published) {
      showSignature(schedulePanel, published.signature.strokes);
      return;
    }
    content.querySelectorAll('form[data-course]').forEach((form) =>
      bindForm(form, async (values) => {
        await api(`${endpoint}/courses/${form.dataset.course}`, 'PUT', {
          revision: batch.revision,
          teacher: values.get('teacher'),
          capacity: Number(values.get('capacity')),
        });
        await renderReview();
        tell('科目已保存');
      }),
    );
    content.querySelectorAll('form[data-application]').forEach((form) =>
      bindForm(form, async (values) => {
        await api(
          `${endpoint}/applications/${form.dataset.application}/preferences/${
            form.dataset.preference
          }`,
          'PUT',
          { revision: batch.revision, decision: values.get('decision') || null },
        );
        await renderReview();
        tell('审核决定已保存');
      }),
    );

    let choices = {};
    const start = schedulePanel.querySelector('#training-start');
    const resume = schedulePanel.querySelector('#training-continue');
    const publish = schedulePanel.querySelector('#training-publish');
    async function preview() {
      const result = await api(`${endpoint}/schedule`, 'POST', {
        revision: batch.revision,
        choices,
      });
      const panel = schedulePanel.querySelector('#training-schedule-preview');
      publish.hidden = Boolean(result.conflict);
      resume.hidden = !result.conflict;
      panel.innerHTML = result.conflict
        ? empty('有志愿冲突等待处理。')
        : resultMarkup(result.assignments);
      if (!result.conflict) {
        tell('排班已生成，等待签字发布');
        return;
      }

      const { key, courseId: conflictedCourse, rank, seats, candidateIds } = result.conflict;
      const modal = dialog(
        '处理志愿冲突',
        `<form class="training-form"><p>「${escape(courseById.get(conflictedCourse).title)}」有 ${
          candidateIds.length
        } 位第 ${rank} 志愿申请者，剩余 ${seats} 个名额。请选择 ${seats} 人。</p>` +
          `<div class="training-stack training-candidates">${candidateIds
            .map((candidateId) => {
              const candidate = applicationById.get(candidateId);
              return `<label><input type="${
                seats === 1 ? 'radio' : 'checkbox'
              }" name="candidate" value="${candidateId}"> ${escape(candidate.fullName)}（${escape(
                candidate.studentId,
              )}）</label>`;
            })
            .join('')}</div>${errorField}<div class="training-actions">${button(
            '稍后处理',
            'data-close',
          )}${submit('确认选择')}</div></form>`,
      );
      bindForm(modal.querySelector('form'), async (values) => {
        const chosen = values.getAll('candidate').map(Number);
        if (chosen.length !== seats) throw new Error(`请选择 ${seats} 人`);
        choices[key] = chosen;
        modal.close();
        await run(schedulePanel, resume, preview);
      });
    }

    start.addEventListener('click', () =>
      run(schedulePanel, start, () => {
        choices = {};
        publish.hidden = true;
        resume.hidden = true;
        schedulePanel.querySelector('#training-schedule-preview').replaceChildren();
        return preview();
      }),
    );
    resume.addEventListener('click', () => run(schedulePanel, resume, preview));
    publish.addEventListener('click', () =>
      captureSignature(null, (signature) =>
        run(schedulePanel, publish, async () => {
          await api(`${endpoint}/publish`, 'POST', {
            revision: batch.revision,
            choices,
            signature,
          });
          await renderReview();
          tell('录取名单已发布，已向录取讲师发送站内通知');
        }),
      ),
    );
  }

  function downloadMaterial(materialId, title) {
    const modal = dialog(
      '讲义下载须知',
      `<form class="training-form">` +
        `<p>讲义含有你的姓名和学号。禁止随意传播讲义，否则将取消你的查看权限。</p>${
          errorField
        }<div class="training-actions">${button('取消', 'data-close')}${submit(
          '我已知悉，下载讲义',
        )}</div></form>`,
    );
    bindForm(modal.querySelector('form'), async () => {
      const response = await fetch(
        `${API_BASE_URL}/training${courseEndpoint}/materials/${materialId}/download`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${userState.token}`,
          },
          body: JSON.stringify({ acknowledged: true }),
        },
      );
      if (!response.ok)
        throw new Error(
          (await response.json().catch(() => ({}))).message || '下载失败，请稍后重试',
        );
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${title.replace(/\.pdf$/i, '')}.pdf`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      modal.close();
    });
  }

  function openSessionForm(course) {
    const modal = dialog(
      '编辑上课安排',
      `<form class="training-form">${
        course.canEditTeacher
          ? `<label>任课老师<input name="teacher" value="${escape(
              course.teacher,
            )}" maxlength="100"></label>`
          : ''
      }<div class="training-columns"><label>上课时间（北京时间）<input name="startsAt" type="datetime-local" value="${localDate(
        course.startsAt,
      )}" required></label><label>下课时间（北京时间）<input name="endsAt" type="datetime-local" value="${localDate(
        course.endsAt,
      )}" required></label></div><label>上课地点<input name="location" maxlength="160" value="${escape(
        course.location,
      )}" required></label>${errorField}<div class="training-actions">${button(
        '取消',
        'data-close',
      )}${submit('保存上课安排')}</div></form>`,
    );
    bindForm(modal.querySelector('form'), async (values) => {
      await api(`${courseEndpoint}/session`, 'PUT', {
        teacher: values.get('teacher') ?? undefined,
        location: values.get('location'),
        startsAt: toTimestamp(values.get('startsAt')),
        endsAt: toTimestamp(values.get('endsAt')),
      });
      modal.close();
      await renderCourse();
      tell('上课安排已保存');
    });
  }

  function fileContent(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = () => reject(new Error('读取讲义失败'));
      reader.readAsDataURL(file);
    });
  }

  function openMaterialForm() {
    const modal = dialog(
      '添加课程资料',
      `<form class="training-form">` +
        `<label>资料类型<select name="kind"><option value="pdf">讲义</option><option value="replay">腾讯会议回放</option></select></label>` +
        `<label>资料名称<input name="title" maxlength="180" required></label>` +
        `<label data-pdf>选择文件（PDF、JPG、PNG，12 MB 以内）<input type="file" name="file" accept=".pdf,.jpg,.jpeg,.png" required></label>` +
        `<label data-replay hidden>腾讯会议回放链接<input name="replayUrl" type="url" maxlength="2048"></label>${
          errorField
        }<div class="training-actions">${button('取消', 'data-close')}${submit(
          '添加资料',
        )}</div></form>`,
    );
    const form = modal.querySelector('form');
    form.elements.kind.addEventListener('change', () => {
      const pdf = form.elements.kind.value === 'pdf';
      form.querySelector('[data-pdf]').hidden = !pdf;
      form.querySelector('[data-replay]').hidden = pdf;
      form.elements.file.required = pdf;
      form.elements.replayUrl.required = !pdf;
    });
    bindForm(form, async (values) => {
      const kind = values.get('kind');
      const title = values.get('title');
      const payload = { kind, title };
      if (kind === 'pdf') {
        const file = values.get('file');
        if (!file.size || file.size > 12 * 1024 * 1024) throw new Error('请选择 12 MB 以内的文件');
        payload.content = await fileContent(file);
      } else payload.replayUrl = values.get('replayUrl');
      await api(`${courseEndpoint}/materials`, 'POST', payload);
      modal.close();
      await renderCourse();
      tell('课程资料已添加');
    });
  }

  function removeMaterial(material) {
    const modal = dialog(
      '删除课程资料',
      `<form class="training-form"><p>删除「${escape(
        material.title,
      )}」后，课程主页将移除此资料。</p>${errorField}<div class="training-actions">${button(
        '取消',
        'data-close',
      )}${submit('删除资料')}</div></form>`,
    );
    bindForm(modal.querySelector('form'), async () => {
      await api(`${courseEndpoint}/materials/${material.id}`, 'DELETE');
      modal.close();
      await renderCourse();
      tell('课程资料已删除');
    });
  }

  function openFeedbackForm(course) {
    const fields = course.questions
      .map(
        (question, index) =>
          `<fieldset><legend>${escape(question)}</legend><div class="training-options">${[
            1, 2, 3, 4, 5,
          ]
            .map(
              (score) =>
                `<label><input type="radio" name="score${index}" value="${score}" required>${
                  score
                } 分</label>`,
            )
            .join('')}</div></fieldset>`,
      )
      .join('');
    const modal = dialog(
      '填写反馈问卷',
      `<form class="training-form">${
        fields
      }<label>其他建议和意见（选填）<textarea name="suggestion" maxlength="2000" rows="4"></textarea></label>${
        errorField
      }<div class="training-actions">${button('取消', 'data-close')}${submit(
        '提交反馈',
      )}</div></form>`,
    );
    bindForm(modal.querySelector('form'), async (values) => {
      await api(`${courseEndpoint}/feedback`, 'POST', {
        feedbackVersion: course.feedbackVersion,
        scores: course.questions.map((_, index) => Number(values.get(`score${index}`))),
        suggestion: values.get('suggestion'),
      });
      modal.close();
      await renderCourse();
      tell('反馈问卷已提交');
    });
  }

  function openFeedbackQuestions(course) {
    const modal = dialog(
      '设置反馈问卷',
      `<form class="training-form"><label>评分题（每行一道，均为 1–5 分）` +
        `<textarea name="questions" rows="7" maxlength="1500" required>${escape(
          course.questions.join('\n'),
        )}</textarea></label><p>问卷收到反馈后，评分题将锁定。</p>${
          errorField
        }<div class="training-actions">${button('取消', 'data-close')}${submit(
          '保存评分题',
        )}</div></form>`,
    );
    bindForm(modal.querySelector('form'), async (values) => {
      await api(`${courseEndpoint}/feedback/questions`, 'PUT', {
        feedbackVersion: course.feedbackVersion,
        questions: values
          .get('questions')
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
      });
      modal.close();
      await renderCourse();
      tell('反馈评分题已保存');
    });
  }

  async function openFeedbackStats() {
    const feedback = await api(`${courseEndpoint}/feedback`);
    const stats = feedback.statistics
      .map(
        ({ question, average, distribution }) =>
          `<section><h3>${escape(question)}</h3><p>${
            average === null ? '暂无评分' : `平均 ${average.toFixed(2)} 分`
          }</p><ul class="training-stats">${distribution
            .map(
              (count, index) =>
                `<li><span>${index + 1} 分</span><progress value="${count}" max="${Math.max(
                  1,
                  feedback.count,
                )}" aria-label="${index + 1} 分的人数"></progress><span>${count} 人</span></li>`,
            )
            .join('')}</ul></section>`,
      )
      .join('');
    const comments = feedback.suggestions
      .map((text) => `<li class="training-preserve">${escape(text)}</li>`)
      .join('');
    dialog(
      '反馈统计',
      `<div class="training-stack"><p>共收到 ${feedback.count} 份反馈</p>${
        stats
      }<h3>其他建议和意见</h3>${
        comments ? `<ul class="training-stack">${comments}</ul>` : empty('暂无留言。')
      }<div class="training-actions">${button('关闭', 'data-close')}</div></div>`,
    );
  }

  async function renderCourse() {
    const course = await api(courseEndpoint);
    const materials = course.materials
      .map((material) => {
        const action =
          material.kind === 'pdf'
            ? button('下载讲义', `data-download="${material.id}"`)
            : `<a class="training-button" href="${escape(
                material.replayUrl,
              )}" target="_blank" rel="noopener noreferrer">观看回放</a>`;
        return (
          `<li class="training-material"><div><strong>${escape(material.title)}</strong>` +
          `<small>${material.kind === 'pdf' ? 'PDF 讲义' : '腾讯会议回放'}</small></div>` +
          `<div class="training-actions">${action}${
            course.canEdit ? button('删除', `data-delete="${material.id}"`) : ''
          }</div></li>`
        );
      })
      .join('');
    const status = course.feedbackSubmitted ? '反馈已提交' : '反馈问卷将在下课后开放。';
    setPage(
      course.title,
      `<section class="training-panel" aria-label="上课安排">${courseFacts(course)}${
        course.canEdit
          ? `<div class="training-actions">${button(
              '编辑上课安排',
              'id="training-edit-session"',
            )}</div>`
          : ''
      }</section><section class="training-panel"><header class="training-section-heading"><h2>课程资料</h2>${
        course.canEdit ? button('添加资料', 'id="training-add-material"') : ''
      }</header>${
        materials
          ? `<ul class="training-stack training-materials">${materials}</ul>`
          : empty('暂无课程资料。')
      }</section><section class="training-panel" id="training-feedback"><h2>课程反馈</h2>${
        course.feedbackOpen && !course.feedbackSubmitted ? '' : `<p>${status}</p>`
      }<div class="training-actions">${
        course.feedbackOpen && !course.feedbackSubmitted
          ? button('填写反馈问卷', 'id="training-write-feedback"')
          : ''
      }${course.canEdit ? button('查看反馈统计', 'id="training-stats"') : ''}${
        course.canEditFeedback ? button('设置反馈问卷', 'id="training-edit-feedback"') : ''
      }</div>${errorField}</section>`,
      course.batchTitle,
      back,
    );
    content
      .querySelector('#training-edit-session')
      ?.addEventListener('click', () => openSessionForm(course));
    content.querySelector('#training-add-material')?.addEventListener('click', openMaterialForm);
    content
      .querySelector('#training-write-feedback')
      ?.addEventListener('click', () => openFeedbackForm(course));
    content
      .querySelector('#training-edit-feedback')
      ?.addEventListener('click', () => openFeedbackQuestions(course));
    const stats = content.querySelector('#training-stats');
    stats?.addEventListener('click', () =>
      run(content.querySelector('#training-feedback'), stats, openFeedbackStats),
    );
    course.materials.forEach((material) => {
      content
        .querySelector(`[data-download="${material.id}"]`)
        ?.addEventListener('click', () => downloadMaterial(material.id, material.title));
      content
        .querySelector(`[data-delete="${material.id}"]`)
        ?.addEventListener('click', () => removeMaterial(material));
    });
  }

  async function renderPeople(query = '') {
    const { users } = await api(`/people?${new URLSearchParams({ q: query })}`);
    const people = users
      .map(
        (user) =>
          `<form class="training-form training-person" data-user="${user.id}">` +
          `<div><h3>${escape(user.fullName)}</h3><p>${escape(user.username)} · ${escape(
            user.studentId,
          )}</p></div>${
            user.admin
              ? '<p>主站管理员</p>'
              : `<label>学培身份<select name="staffRole"><option value="">学生</option>` +
                `<option value="member" ${
                  user.staffRole === 'member' ? 'selected' : ''
                }>学培部部员</option>` +
                `<option value="minister" ${
                  user.staffRole === 'minister' ? 'selected' : ''
                }>学培部部长</option></select></label>` +
                `<label class="training-check"><input type="checkbox" name="revoked" ${
                  user.revoked ? 'checked' : ''
                }>暂停课程查看权限</label>${submit('保存权限')}`
          }${errorField}</form>`,
      )
      .join('');
    setPage(
      '学培权限',
      `<form id="training-people-search" class="training-panel training-form"><label>按姓名、用户名或学号搜索` +
        `<input name="q" type="search" value="${escape(query)}" maxlength="64"></label>` +
        `<div class="training-actions">${submit('搜索账号')}</div>${errorField}</form>` +
        `<section class="training-stack" aria-label="账号权限">${
          people || empty('暂无匹配账号。')
        }</section>`,
      '',
      back,
    );
    bindForm(content.querySelector('#training-people-search'), (values) =>
      renderPeople(values.get('q')),
    );
    content.querySelectorAll('[data-user]').forEach((form) => {
      if (!form.elements.staffRole) return;
      bindForm(form, async (values) => {
        await api(`/people/${form.dataset.user}`, 'PUT', {
          staffRole: values.get('staffRole') || null,
          revoked: values.get('revoked') === 'on',
        });
        tell('学培权限已保存');
        form.querySelector('[type=submit]').textContent = '已保存';
      });
      form.addEventListener('change', () => {
        form.querySelector('[type=submit]').textContent = '保存权限';
      });
    });
  }

  async function init() {
    if (applySlug) await renderApplication();
    else if (reviewSlug) await renderReview();
    else if (courseId) await renderCourse();
    else if (params.has('people')) await renderPeople();
    else await renderDirectory();
  }

  const initialToken = userState.token;
  function resetPage() {
    content.replaceChildren();
    document.querySelectorAll('.training-dialog').forEach((modal) => modal.remove());
    window.location.reload();
  }
  window.addEventListener('freebbs:session-change', (event) => {
    if (!event.detail.user && initialToken) resetPage();
  });
  window.addEventListener('storage', (event) => {
    if (event.key === 'free_bbs_auth_token' && event.newValue !== initialToken) resetPage();
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted && (localStorage.getItem('free_bbs_auth_token') || '') !== initialToken) {
      resetPage();
    }
  });

  init().catch((error) => {
    if (error.status === 401) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      setPage(
        '小班辅导',
        empty('登录后即可查看课程与报名。'),
        '',
        link('登录', `/login?next=${next}`),
      );
      return;
    }
    setPage('小班辅导', empty(error.message), '', back);
  });
})();
