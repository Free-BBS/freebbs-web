/* Existing course Markdown exercises, optional reviewed scoring, and private corrections. */
(() => {
  const viewLabels = { quick: '自测', mistakes: '订正', practice: '练习' };
  const difficultyLabels = { basic: '基础', standard: '标准', challenge: '挑战' };
  const roleLabels = { practice: '练习', selftest: '自测', exploration: '探索' };
  function questionRole(question) {
    if (roleLabels[question?.assessmentRole]) return question.assessmentRole;
    return question?.official ? 'selftest' : 'practice';
  }
  function recommendedDifficulty(preference) {
    if (!preference || typeof preference !== 'object') return '';
    if (['new', 'familiar'].includes(preference.level)) return 'basic';
    if (preference.level === 'basic') return 'standard';
    if (preference.level === 'advanced') return 'challenge';
    return '';
  }
  function selectQuestions(questions, view, filter = {}, latest = new Map()) {
    if (view === 'quick')
      return questions.filter(
        (question) => question.official && questionRole(question) === 'selftest',
      );
    if (view === 'mistakes')
      return questions.filter((question) => isMistake(latest.get(question.id) || {}));
    return questions.filter(
      (question) =>
        (filter.assessmentRole === 'exploration'
          ? questionRole(question) === 'exploration'
          : questionRole(question) !== 'exploration') &&
        (!difficultyLabels[filter.difficulty] || question.difficulty === filter.difficulty),
    );
  }
  const typeLabels = {
    single_choice: '单选',
    multiple_choice: '多选',
    numeric: '数值',
    short_answer: '简答',
  };
  function latestAttempts(attempts) {
    const latest = new Map();
    [...attempts]
      .sort((left, right) => {
        try {
          return BigInt(left.id) > BigInt(right.id) ? -1 : 1;
        } catch {
          return String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''));
        }
      })
      .forEach((attempt) => {
        if (!latest.has(attempt.questionId)) latest.set(attempt.questionId, attempt);
      });
    return latest;
  }
  function currentQuestionAttempts(attempts, questions, documentVersion) {
    const official = latestAttempts(attempts.filter((attempt) => attempt.official === true));
    const practice = latestAttempts(attempts.filter((attempt) => attempt.official === false));
    const current = new Map();
    questions.forEach((question) => {
      const attempt = (question.official ? official : practice).get(question.id);
      // Pick the newest record in its channel first; an incompatible newer version
      // must not resurrect an older record just because that older hash matches.
      if (
        attempt &&
        documentVersion &&
        attempt.documentVersion === documentVersion &&
        question.questionVersion &&
        attempt.questionVersion === question.questionVersion
      )
        current.set(question.id, attempt);
    });
    return current;
  }
  function isMistake(attempt) {
    return (
      attempt.status === 'graded' &&
      Number.isFinite(attempt.score) &&
      (attempt.verdict === 'fail' ||
        (attempt.verdict === 'practice_only' &&
          attempt.score < (attempt.passScore ?? attempt.maxScore)))
    );
  }
  function resultLabel(attempt, documentVersion, latestAttempt = null) {
    if (attempt.status === 'pending_review') return '待课程组复核';
    if (!attempt.official || attempt.verdict === 'practice_only')
      return `练习反馈 ${attempt.score} / ${attempt.maxScore} · 不计入正式测评`;
    if (attempt.documentVersion !== documentVersion)
      return `历史版本作答 ${attempt.score} / ${attempt.maxScore} · 请按当前版本重新自测`;
    if (
      attempt.verdict === 'fail' &&
      latestAttempt?.id !== attempt.id &&
      latestAttempt?.official &&
      latestAttempt.verdict === 'pass' &&
      latestAttempt.documentVersion === documentVersion &&
      latestAttempt.questionVersion === attempt.questionVersion
    )
      return `历史作答 · 已有订正记录 · ${attempt.score} / ${attempt.maxScore}`;
    return `${attempt.verdict === 'pass' ? '本题通过' : '本题尚未通过'} · ${attempt.score} / ${attempt.maxScore}`;
  }
  function legacyPractice(markdown) {
    const questions = [];
    const source = String(markdown || '')
      .replace(/\r\n?/g, '\n')
      .replace(
        /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*freebbs-quiz[^\n]*\n[\s\S]*?(?:\n[ \t]{0,3}(?:`{3,}|~{3,})[^\n]*(?=\n|$)|$)/gim,
        '',
      );
    const matches = [
      ...source.matchAll(/^(#{3,6})\s+题目\s+([A-Za-z0-9][A-Za-z0-9_.-]{0,119})\s*$/gm),
    ];
    matches.slice(0, 40).forEach((match) => {
      const body = source.slice(match.index + match[0].length).split(/^#{1,6}\s/m)[0];
      const prompt = body
        .replace(/<details\b[^>]*>[\s\S]*?<\/details>/gi, '')
        .split('\n')
        .filter((line) => !/^\s*(?:题型|目标|难度|来源与授权)\s*[:：]/.test(line))
        .join('\n')
        .trim();
      if (prompt)
        questions.push({
          id: match[2],
          type: 'short_answer',
          prompt: prompt.slice(0, 12000),
          source: body.match(/来源与授权\s*[:：]\s*([^\n]+)/)?.[1]?.trim() || '现有课程模板练习',
          official: false,
          assessmentRole: 'practice',
          reviewed: false,
          questionVersion: 'legacy-practice',
          scoring: { method: 'manual', maxScore: 1, passScore: 1 },
        });
    });
    return questions;
  }
  function createAssessmentController({ window: browser, document: dom, app }) {
    const page = dom.querySelector('[data-knowledge-page]') || dom.getElementById('knowledge-page');
    const list = dom.getElementById('learning-quiz-list');
    const status = dom.getElementById('learning-quiz-status');
    const results = dom.getElementById('learning-quiz-results');
    const tabs = dom.getElementById('learning-quiz-tabs');
    if (!page || !list || !status || !results || !tabs || !app) return null;
    const state = {
      course: null,
      node: null,
      view: 'quick',
      questions: [],
      practiceQuestions: [],
      attempts: [],
      documentVersion: '',
      questionVersion: null,
      canReview: false,
      generation: 0,
      ready: false,
      loading: false,
      loaded: false,
      stale: false,
      uid: '',
      token: '',
      drafts: new Map(),
      reviewAttempts: [],
      cursor: null,
      historyLoading: false,
      practiceFilter: { difficulty: '', assessmentRole: '' },
    };
    const element = (tag, value = '', className = '') => {
      const node = dom.createElement(tag);
      node.textContent = value;
      if (className) node.className = className;
      return node;
    };
    const loggedIn = () =>
      Boolean(app.userState?.isLoggedIn && app.userState?.token && !state.stale);
    const endpoint = () =>
      `/learning-assessments/${encodeURIComponent(state.course.slug)}/${encodeURIComponent(state.node.id)}`;
    const current = (generation, token) =>
      generation === state.generation && token === (app.userState?.token || '') && !state.stale;
    const markdown = (node, content) => {
      if (app.renderMarkdownContent) {
        node.innerHTML = app.renderMarkdownContent(String(content || ''));
        app.enhanceMarkdownContent?.(node, { interactiveCodeControls: false });
      } else node.textContent = String(content || '');
    };
    const snapshot = () => ({
      attempts: state.attempts.map((attempt) => ({ ...attempt })),
      questions: state.questions.map((question) => ({
        ...question,
      })),
      practiceQuestions: state.practiceQuestions.map((question) => ({ ...question })),
      documentVersion: state.documentVersion,
      loaded: state.loaded,
    });
    const announce = () => {
      if (!state.ready || !state.course || !state.node) return;
      const generation = state.generation;
      // Let all peer modules receive knowledge:loaded before sending its dependent event.
      Promise.resolve().then(() => {
        if (generation !== state.generation || !state.ready) return;
        page.dispatchEvent(
          new browser.CustomEvent('knowledge:assessment-updated', { detail: snapshot() }),
        );
      });
    };
    function renderAttempt(attempt) {
      const card = element('article', '', 'learning-record learning-quiz-result');
      card.dataset.attemptId = attempt.id;
      const latestAttempt = latestAttempts(
        state.attempts.filter((entry) => entry.official === attempt.official),
      ).get(attempt.questionId);
      const currentAttempt = currentQuestionAttempts(
        state.attempts,
        [...state.questions, ...state.practiceQuestions],
        state.documentVersion,
      ).get(attempt.questionId);
      card.append(
        element(
          'h4',
          `${attempt.questionId} · ${resultLabel(attempt, state.documentVersion, latestAttempt)}`,
        ),
      );
      const answer = Array.isArray(attempt.answer) ? attempt.answer.join('、') : attempt.answer;
      card.append(element('p', `我的作答：${answer}`, 'learning-caption'));
      card.append(element('p', attempt.feedback || '', 'learning-form-status'));
      if (attempt.gradingBasis)
        card.append(element('p', `判定依据：${attempt.gradingBasis}`, 'learning-caption'));
      if (attempt.referenceMarkdown) {
        const reference = element('details');
        reference.append(element('summary', '查看参考解析'));
        const body = element('div', '', 'discussion-markdown-body');
        markdown(body, attempt.referenceMarkdown);
        reference.append(body);
        card.append(reference);
      }
      const date = new Date(attempt.updatedAt || attempt.createdAt);
      const dateText = Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN') : '';
      card.append(
        element(
          'small',
          `题目版本 ${attempt.questionVersion || '未配置'}${dateText ? ` · ${dateText}` : ''}`,
          'learning-caption',
        ),
      );
      if (isMistake(attempt) && currentAttempt?.id === attempt.id) {
        const correct = element('button', '重新作答并订正', 'button button-ghost');
        correct.type = 'button';
        correct.addEventListener('click', () => {
          selectView('mistakes');
          list.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
        });
        card.append(correct);
      }
      return card;
    }
    function renderResults() {
      results.replaceChildren();
      if (!loggedIn()) {
        results.append(
          element('p', '登录后可保存自测作答、查看自己的错题并订正。', 'learning-caption'),
        );
        return;
      }
      if (!state.attempts.length)
        results.append(
          element(
            'p',
            state.loaded ? '还没有作答记录，按自己的节奏选一道题开始。' : '作答记录尚未加载。',
            'learning-caption',
          ),
        );
      state.attempts.forEach((attempt) => results.append(renderAttempt(attempt)));
      if (state.cursor) {
        const more = element(
          'button',
          state.historyLoading ? '正在加载更早作答…' : '加载更早的作答记录',
          'button button-ghost',
        );
        more.type = 'button';
        more.disabled = state.historyLoading;
        more.addEventListener('click', loadMoreAttempts);
        results.append(more);
      }
      if (state.canReview) {
        const reviewButton = element('button', '课程负责人：查看待复核作答', 'button button-ghost');
        reviewButton.type = 'button';
        reviewButton.addEventListener('click', loadReview);
        results.append(reviewButton);
        state.reviewAttempts.forEach((attempt) => {
          const card = renderAttempt(attempt);
          card.append(element('p', `复核账号 ${attempt.userId}`, 'learning-caption'));
          const form = element('form', '', 'learning-quiz-review-form');
          const scoreLabel = element('label', `复核分数（0–${attempt.maxScore}）`);
          const score = element('input');
          score.type = 'number';
          score.min = '0';
          score.max = String(attempt.maxScore);
          score.step = 'any';
          score.required = true;
          scoreLabel.append(score);
          const feedbackLabel = element('label', '复核说明与评分依据');
          const feedback = element('textarea');
          feedback.required = true;
          feedback.maxLength = 4000;
          feedback.rows = 3;
          feedbackLabel.append(feedback);
          const button = element('button', '确认人工复核', 'button button-primary');
          button.type = 'submit';
          const message = element('p', '', 'learning-form-status');
          message.setAttribute('role', 'status');
          form.append(scoreLabel, feedbackLabel, button, message);
          form.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (!form.reportValidity()) return;
            const { generation } = state;
            const token = app.userState?.token || '';
            button.disabled = true;
            try {
              await app.callApi(`${endpoint()}/attempts/${encodeURIComponent(attempt.id)}/review`, {
                method: 'PATCH',
                body: JSON.stringify({ score: Number(score.value), feedback: feedback.value }),
              });
              if (!current(generation, token)) return;
              state.reviewAttempts = state.reviewAttempts.filter((item) => item.id !== attempt.id);
              await refresh();
            } catch (error) {
              if (current(generation, token))
                message.textContent = error.message || '复核保存失败，当前输入保留。';
            } finally {
              if (current(generation, token)) button.disabled = false;
            }
          });
          card.append(form);
          results.append(card);
        });
      }
    }
    function questionForm(question, previous = null) {
      const card = element('article', '', 'learning-record learning-quiz-card');
      card.dataset.questionId = question.id;
      card.append(
        element(
          'h4',
          `${question.id} · ${typeLabels[question.type] || '练习'} · ${roleLabels[questionRole(question)]}${question.reviewed || question.official ? ' · 已审核' : ''}`,
        ),
      );
      if (question.difficulty)
        card.append(
          element(
            'small',
            `${difficultyLabels[question.difficulty] || '未分层'} · 教师估计`,
            'learning-caption',
          ),
        );
      if (question.learningObjective)
        card.append(element('p', question.learningObjective, 'learning-caption'));
      const prompt = element('div', '', 'discussion-markdown-body learning-quiz-prompt');
      markdown(prompt, question.prompt);
      card.append(prompt);
      card.append(
        element(
          'p',
          `来源：${question.source || '尚未配置'} · 版本：${question.questionVersion || '未配置'}`,
          'learning-caption',
        ),
      );
      const mode = state.view === 'practice' || !question.official ? 'practice' : 'selftest';
      const draftKey = `${mode}:${question.id}`;
      const draft = state.drafts.get(draftKey);
      const savedAnswer = draft?.answer ?? previous?.answer;
      const form = element('form', '', 'learning-quiz-form');
      const controls = [];
      if (question.options) {
        const group = element('fieldset');
        group.append(
          element(
            'legend',
            question.type === 'multiple_choice'
              ? '请选择全部符合题意的选项（完整匹配，无部分分）'
              : '请选择一个选项',
          ),
        );
        question.options.forEach((option) => {
          const label = element('label', '', 'learning-quiz-option');
          const input = element('input');
          input.type = question.type === 'multiple_choice' ? 'checkbox' : 'radio';
          input.name = `answer-${question.id}`;
          input.value = option.id;
          input.checked = Array.isArray(savedAnswer)
            ? savedAnswer.includes(option.id)
            : savedAnswer === option.id;
          if (question.type === 'single_choice') input.required = true;
          const optionText = element('span', '', 'discussion-markdown-body');
          markdown(optionText, `${option.id}. ${option.text}`);
          label.append(input, optionText);
          group.append(label);
          controls.push(input);
        });
        form.append(group);
      } else {
        const label = element(
          'label',
          question.type === 'numeric' ? '数值作答（仅数值，可用科学记数法）' : '我的作答',
        );
        const input = element(question.type === 'short_answer' ? 'textarea' : 'input');
        if (question.type === 'numeric') {
          input.type = 'text';
          input.inputMode = 'decimal';
          input.maxLength = 160;
        } else {
          input.rows = 4;
          input.maxLength = 8000;
        }
        input.required = true;
        input.value = typeof savedAnswer === 'string' ? savedAnswer : '';
        label.append(input);
        form.append(label);
        controls.push(input);
      }
      if (question.type === 'numeric')
        form.append(
          element(
            'p',
            `允许误差：绝对容差 ${question.scoring.absoluteTolerance}、相对容差 ${question.scoring.relativeTolerance}，取较大值。`,
            'learning-caption',
          ),
        );
      if (question.type === 'short_answer')
        form.append(
          element(
            'p',
            question.questionVersion === 'legacy-practice'
              ? '课程模板未配置正式评分规则，可在作答后对照参考解答。'
              : `满分 ${question.scoring.maxScore}，${mode === 'selftest' ? '通过标准' : '练习参考标准'} ${question.scoring.passScore} 分；由课程组按评分依据复核。${mode === 'practice' ? '本次不计入正式测评。' : ''}`,
            'learning-caption',
          ),
        );
      else
        form.append(
          element(
            'p',
            `满分 ${question.scoring.maxScore}，${mode === 'selftest' ? '正式通过标准' : '练习参考标准'} ${question.scoring.passScore} 分。${mode === 'practice' ? '当前为练习模式，不计入正式测评。' : ''}`,
            'learning-caption',
          ),
        );
      const submit = element(
        'button',
        previous ? '提交订正作答' : '提交作答',
        'button button-primary',
      );
      submit.type = 'submit';
      const message = element('p', '', 'learning-form-status');
      message.setAttribute('role', 'status');
      if (!loggedIn()) {
        submit.disabled = true;
        message.textContent = '可先思考题目，登录后提交并保存作答。';
      }
      form.append(submit, message);
      const getAnswer = () =>
        question.options
          ? question.type === 'multiple_choice'
            ? controls.filter((control) => control.checked).map((control) => control.value)
            : controls.find((control) => control.checked)?.value || ''
          : controls[0].value;
      form.addEventListener('input', () => {
        state.drafts.set(draftKey, { answer: getAnswer(), requestKey: null });
      });
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!loggedIn()) {
          message.textContent = '请登录后提交作答。';
          return;
        }
        if (!form.reportValidity()) return;
        const answer = getAnswer();
        if (Array.isArray(answer) && !answer.length) {
          message.textContent = '请选择至少一个选项。';
          return;
        }
        const { generation } = state;
        const token = app.userState?.token || '';
        const intent = state.drafts.get(draftKey) || { answer };
        if (!intent.requestKey) intent.requestKey = browser.crypto.randomUUID();
        state.drafts.set(draftKey, intent);
        submit.disabled = true;
        controls.forEach((control) => {
          control.disabled = true;
        });
        message.textContent = '正在保存作答并核对评分规则…';
        try {
          const payload = await app.callApi(`${endpoint()}/attempts`, {
            method: 'POST',
            body: JSON.stringify({
              questionId: question.id,
              answer,
              mode,
              requestKey: intent.requestKey,
              ...(state.documentVersion ? { expectedDocumentVersion: state.documentVersion } : {}),
              ...(previous ? { supersedesAttemptId: previous.id } : {}),
            }),
          });
          if (!current(generation, token)) return;
          state.attempts = [
            payload.attempt,
            ...state.attempts.filter((attempt) => attempt.id !== payload.attempt.id),
          ];
          state.documentVersion = payload.documentVersion || state.documentVersion;
          state.drafts.delete(draftKey);
          controls.forEach((control) => {
            if (question.options) control.checked = false;
            else control.value = '';
          });
          message.textContent =
            payload.attempt.status === 'pending_review'
              ? '作答已保存。'
              : `${resultLabel(payload.attempt, state.documentVersion)}。${payload.attempt.feedback || ''}`;
          renderResults();
          announce();
          if (state.view === 'mistakes') renderQuestions();
        } catch (error) {
          if (current(generation, token))
            message.textContent = `${error.message || '作答保存失败'}；输入已保留，可重试。`;
        } finally {
          if (current(generation, token)) {
            submit.disabled = false;
            controls.forEach((control) => {
              control.disabled = false;
            });
          }
        }
      });
      card.append(form);
      return card;
    }
    function renderQuestions() {
      tabs.querySelectorAll('[data-quiz-view]').forEach((tab) => {
        const selected = tab.dataset.quizView === state.view;
        tab.setAttribute('aria-pressed', String(selected));
        tab.classList.toggle('is-active', selected);
      });
      list.replaceChildren();
      renderPracticeFilters();
      const all = [...state.questions, ...state.practiceQuestions];
      const latest = currentQuestionAttempts(state.attempts, all, state.documentVersion);
      const questions = selectQuestions(all, state.view, state.practiceFilter, latest);
      if (!questions.length) {
        const empty =
          state.view === 'quick'
            ? loggedIn()
              ? '暂无正式自测题，可先做练习。'
              : '登录后可查看课程组发布的正式自测题；本文练习可直接阅读。'
            : state.view === 'mistakes'
              ? `当前已加载记录中暂时没有已判定的错题；待复核作答不会归入错题。${state.cursor ? '还可加载更早的作答记录。' : ''}`
              : state.practiceFilter.difficulty || state.practiceFilter.assessmentRole
                ? '这一组暂没有题目，可选择全部难度或返回练习。'
                : '暂无练习题，可先回看正文。';
        list.append(element('p', empty, 'learning-caption'));
      }
      questions.forEach((question) =>
        list.append(
          questionForm(question, state.view === 'mistakes' ? latest.get(question.id) : null),
        ),
      );
    }
    let practiceFilters = null;
    function renderPracticeFilters() {
      if (!practiceFilters) {
        practiceFilters = element('div', '', 'learning-quiz-filters');
        tabs.append(practiceFilters);
      }
      practiceFilters.hidden = state.view !== 'practice';
      practiceFilters.replaceChildren();
      if (practiceFilters.hidden) return;
      const label = element('label', '难度 ');
      const select = element('select');
      select.setAttribute('aria-label', '练习难度');
      for (const [value, title] of [['', '全部'], ...Object.entries(difficultyLabels)]) {
        const option = element('option', title);
        option.value = value;
        select.append(option);
      }
      select.value = state.practiceFilter.difficulty;
      select.addEventListener('change', () => {
        state.practiceFilter.difficulty = select.value;
        renderQuestions();
      });
      label.append(select);
      practiceFilters.append(label);
      const explore = element(
        'button',
        state.practiceFilter.assessmentRole === 'exploration' ? '返回练习' : '探索题',
        'button button-ghost',
      );
      explore.type = 'button';
      explore.setAttribute(
        'aria-pressed',
        String(state.practiceFilter.assessmentRole === 'exploration'),
      );
      explore.addEventListener('click', () => {
        state.practiceFilter.assessmentRole =
          state.practiceFilter.assessmentRole === 'exploration' ? '' : 'exploration';
        renderQuestions();
      });
      practiceFilters.append(explore);
      const recommended = recommendedDifficulty(
        browser.FreeBbsLearningStart?.currentPreference?.(),
      );
      if (
        recommended &&
        state.practiceFilter.assessmentRole !== 'exploration' &&
        [...state.questions, ...state.practiceQuestions].some(
          (question) =>
            questionRole(question) !== 'exploration' && question.difficulty === recommended,
        )
      ) {
        const suggestion = element(
          'button',
          `试试${difficultyLabels[recommended]}题`,
          'button button-ghost',
        );
        suggestion.type = 'button';
        suggestion.addEventListener('click', () => {
          state.practiceFilter.difficulty = recommended;
          renderQuestions();
        });
        practiceFilters.append(suggestion);
      }
    }
    function selectView(view, filter) {
      if (!viewLabels[view]) return;
      state.view = view;
      if (view === 'practice' && filter && typeof filter === 'object')
        state.practiceFilter = {
          difficulty: difficultyLabels[filter.difficulty] ? filter.difficulty : '',
          assessmentRole: filter.assessmentRole === 'exploration' ? 'exploration' : '',
        };
      renderQuestions();
    }
    async function loadReview() {
      if (!state.canReview || !loggedIn()) return;
      const { generation } = state;
      const token = app.userState?.token || '';
      try {
        const payload = await app.callApi(`${endpoint()}/attempts?review=pending`, {
          method: 'GET',
        });
        if (!current(generation, token)) return;
        state.reviewAttempts = payload.attempts || [];
        renderResults();
        if (!state.reviewAttempts.length) status.textContent = '当前知识点没有待复核作答。';
      } catch (error) {
        if (current(generation, token))
          status.textContent = error.message || '待复核作答加载失败。';
      }
    }
    async function loadMoreAttempts() {
      if (!state.cursor || state.historyLoading || !loggedIn()) return;
      const { generation } = state;
      const token = app.userState?.token || '';
      state.historyLoading = true;
      renderResults();
      try {
        const payload = await app.callApi(
          `${endpoint()}/attempts?before=${encodeURIComponent(state.cursor)}`,
          { method: 'GET' },
        );
        if (!current(generation, token)) return;
        const known = new Set(state.attempts.map((attempt) => attempt.id));
        state.attempts.push(
          ...(payload.attempts || []).filter((attempt) => !known.has(attempt.id)),
        );
        state.cursor = payload.nextCursor || null;
        renderQuestions();
        announce();
      } catch (error) {
        if (current(generation, token))
          status.textContent = error.message || '更早的作答加载失败，可重试。';
      } finally {
        if (current(generation, token)) {
          state.historyLoading = false;
          renderResults();
        }
      }
    }
    async function refresh() {
      if (!state.ready) return;
      const { generation } = state;
      const token = app.userState?.token || '';
      if (!loggedIn()) {
        status.textContent = '本文练习沿用课程模板；登录后可保存作答、查看私有错题与订正记录。';
        renderQuestions();
        renderResults();
        announce();
        return;
      }
      state.loading = true;
      status.textContent = '正在加载当前知识点题目与我的作答…';
      try {
        await app.sessionReady;
        if (!current(generation, token)) return;
        const [questions, attempts] = await Promise.all([
          app.callApi(`${endpoint()}/questions`, { method: 'GET' }),
          app.callApi(`${endpoint()}/attempts`, { method: 'GET' }),
        ]);
        if (!current(generation, token)) return;
        state.questions = questions.questions || [];
        state.practiceQuestions = questions.practiceQuestions || [];
        state.attempts = attempts.attempts || [];
        state.cursor = attempts.nextCursor || null;
        state.documentVersion = questions.documentVersion || attempts.documentVersion || '';
        state.questionVersion = questions.questionVersion;
        state.canReview = Boolean(questions.canReview);
        state.loaded = true;
        status.textContent = `${state.questions.length ? `课程组已审核 ${state.questions.length} 道自测题。` : '正式自测尚未开放。'}客观题按已发布规则判定，主观题待人工复核；${(questions.warnings || []).join(' ') || '作答与错题仅本人可见，待复核作答对本课程负责人开放。'}`;
        renderQuestions();
        renderResults();
        announce();
      } catch (error) {
        if (!current(generation, token)) return;
        status.textContent = `${error.message || '题目加载失败'}；本文练习仍可查看，请稍后重试。`;
        renderQuestions();
        renderResults();
      } finally {
        if (current(generation, token)) state.loading = false;
      }
    }
    function resetSession(stale = false) {
      state.generation += 1;
      state.stale = stale;
      state.uid = app.userState?.uid || '';
      state.token = app.userState?.token || '';
      state.attempts = [];
      state.reviewAttempts = [];
      state.questions = [];
      state.canReview = false;
      state.loaded = false;
      state.cursor = null;
      state.historyLoading = false;
      state.drafts.clear();
      state.practiceFilter = { difficulty: '', assessmentRole: '' };
      state.practiceQuestions = legacyPractice(
        state.node?.markdown || state.node?.sections?.knowledgeMarkdown || '',
      );
      state.documentVersion = state.node?.documentVersion || '';
      renderQuestions();
      renderResults();
      announce();
      if (state.ready) refresh();
    }
    page.addEventListener('knowledge:loaded', (event) => {
      if (!event.detail?.course || !event.detail?.node) return;
      state.course = event.detail.course;
      state.node = event.detail.node;
      state.ready = true;
      resetSession();
    });
    page.addEventListener('knowledge:document-saved', (event) => {
      if (event.detail?.node) {
        state.node = event.detail.node;
        resetSession();
      }
    });
    tabs
      .querySelectorAll('[data-quiz-view]')
      .forEach((button) =>
        button.addEventListener('click', () => selectView(button.dataset.quizView)),
      );
    browser.addEventListener('freebbs:session-change', () => {
      if (
        state.uid !== (app.userState?.uid || '') ||
        state.token !== (app.userState?.token || '') ||
        state.stale
      )
        resetSession();
    });
    browser.addEventListener('learning:start-change', () => renderPracticeFilters());
    browser.addEventListener('storage', (event) => {
      if (event.key === 'free_bbs_auth_token' || event.key === null) resetSession(true);
    });
    browser.addEventListener('pageshow', (event) => {
      if (event.persisted) resetSession(true);
    });
    return { refresh, selectView, getSnapshot: snapshot };
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      viewLabels,
      typeLabels,
      difficultyLabels,
      questionRole,
      recommendedDifficulty,
      selectQuestions,
      latestAttempts,
      currentQuestionAttempts,
      isMistake,
      resultLabel,
      legacyPractice,
      createAssessmentController,
    };
    return;
  }
  let controller = null;
  const api = {
    init() {
      controller ||= createAssessmentController({ window, document, app: window.freeBbsApp });
      return controller;
    },
    refresh: () => controller?.refresh(),
    selectView: (view, filter) => controller?.selectView(view, filter),
    getSnapshot: () =>
      controller?.getSnapshot() || {
        attempts: [],
        questions: [],
        practiceQuestions: [],
        documentVersion: '',
        loaded: false,
      },
  };
  window.FreeBbsLearningAssessment = api;
  api.init();
})();
