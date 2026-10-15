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
  function mergeCurrentAttempts(existing, incoming = []) {
    // Keep one candidate per question/channel, including incompatible versions.
    // Filtering versions here would revive an older result after a document rollback.
    const records = new Map();
    [...existing, ...incoming].forEach((attempt) =>
      records.set(JSON.stringify([attempt.questionId, attempt.official, attempt.id]), attempt),
    );
    const entries = [...records.values()];
    return [true, false].flatMap((official) => [
      ...latestAttempts(entries.filter((attempt) => attempt.official === official)).values(),
    ]);
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
  const recordedVersion = (value) => typeof value === 'string' && Boolean(value.trim());
  const recordedScore = (value) => Number.isFinite(value) && value >= 0;
  function resultLabel(attempt, documentVersion, latestAttempt = null, questionVersion = null) {
    if (attempt.status === 'pending_review') {
      if (
        (recordedVersion(attempt.documentVersion) &&
          recordedVersion(documentVersion) &&
          attempt.documentVersion !== documentVersion) ||
        (recordedVersion(attempt.questionVersion) &&
          recordedVersion(questionVersion) &&
          attempt.questionVersion !== questionVersion)
      )
        return '历史版本待复核，结果不计本版';
      if (!recordedVersion(attempt.documentVersion) || !recordedVersion(attempt.questionVersion))
        return '待课程组复核 · 提交时版本未完整记录';
      return '待课程组复核';
    }
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
      currentAttempts: [],
      currentAttemptsComplete: false,
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
      draftViews: new Map(),
      submittedDrafts: new Set(),
      sessionKnown: false,
      reviewAttempts: [],
      reviewDrafts: new Map(),
      reviewCards: new Map(),
      reviewCursor: null,
      reviewLoading: false,
      reviewLoaded: false,
      reviewMessage: '',
      reviewEpoch: 0,
      reviewedIds: new Set(),
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
    const reviewScope = () =>
      JSON.stringify([
        state.course?.slug,
        state.node?.id,
        state.documentVersion,
        state.questionVersion,
        app.userState?.uid || '',
      ]);
    const reviewKeyFor = (attempt) =>
      `${attempt.id}:${attempt.revision || attempt.updatedAt || attempt.createdAt || ''}`;
    function resetReviewQueue(keepDrafts = false) {
      state.reviewEpoch += 1;
      state.reviewAttempts = [];
      state.reviewCursor = null;
      state.reviewLoading = false;
      state.reviewLoaded = false;
      state.reviewMessage = '';
      state.reviewedIds.clear();
      for (const entry of state.reviewCards.values()) entry.disable();
      state.reviewCards.clear();
      if (!keepDrafts) state.reviewDrafts.clear();
    }
    function revokeReviewAccess(error) {
      if (![401, 403].includes(Number(error?.status))) return false;
      resetReviewQueue();
      state.canReview = false;
      status.textContent =
        Number(error.status) === 401
          ? '登录状态已失效，待复核内容与未提交复核输入已清除，请重新登录。'
          : '课程复核权限已变化，待复核内容与未提交复核输入已清除。';
      renderResults();
      return true;
    }
    let draftStore = null;
    try {
      draftStore = browser.FreeBbsLearningAnswerDrafts?.createDraftStore({
        storage: browser.sessionStorage,
        crypto: browser.crypto,
      });
    } catch {
      /* Restricted storage or crypto leaves the existing in-memory drafts usable. */
    }
    const draftContext = (question, mode) => ({
      courseSlug: state.course?.slug,
      nodeId: state.node?.id,
      documentVersion: state.documentVersion,
      questionVersion: question.questionVersion,
      questionId: question.id,
      mode,
    });
    const draftKeyFor = (question, mode) => JSON.stringify(draftContext(question, mode));
    const persistDraft = (question, mode, value) => {
      if (state.loaded) draftStore?.save(draftContext(question, mode), value);
    };
    async function restoreSavedDrafts(generation, token) {
      if (!state.loaded || !loggedIn() || !draftStore) return;
      const bound = await draftStore.bind(state.uid, token);
      if (!bound || !current(generation, token) || !state.loaded) return;
      for (const question of [...state.questions, ...state.practiceQuestions])
        for (const mode of question.official ? ['selftest', 'practice'] : ['practice']) {
          const key = draftKeyFor(question, mode);
          if (state.drafts.has(key)) {
            persistDraft(question, mode, state.drafts.get(key));
            continue;
          }
          if (state.submittedDrafts.has(key)) {
            draftStore.remove(draftContext(question, mode));
            continue;
          }
          const saved = draftStore.read(draftContext(question, mode));
          if (!saved) continue;
          const value = { ...saved, restored: true };
          state.drafts.set(key, value);
          state.draftViews.get(key)?.(value);
        }
    }
    const markdown = (node, content) => {
      if (app.renderMarkdownContent) {
        node.innerHTML = app.renderMarkdownContent(String(content || ''));
        app.enhanceMarkdownContent?.(node, { interactiveCodeControls: false });
      } else node.textContent = String(content || '');
    };
    const snapshot = () => ({
      view: state.view,
      attempts: state.attempts.map((attempt) => ({ ...attempt })),
      currentAttempts: state.currentAttempts.map((attempt) => ({ ...attempt })),
      currentAttemptsComplete: state.currentAttemptsComplete,
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
    function renderAttempt(attempt, forReview = false) {
      const card = element('details', '', 'learning-record learning-quiz-result');
      card.open = forReview;
      card.dataset.attemptId = attempt.id;
      const latestAttempt = latestAttempts(
        state.currentAttempts.filter((entry) => entry.official === attempt.official),
      ).get(attempt.questionId);
      const currentAttempt = currentQuestionAttempts(
        state.currentAttempts,
        [...state.questions, ...state.practiceQuestions],
        state.documentVersion,
      ).get(attempt.questionId);
      const questionVersion =
        [...state.questions, ...state.practiceQuestions].find(
          (question) =>
            question.id === attempt.questionId && question.official === attempt.official,
        )?.questionVersion || (attempt.official ? state.questionVersion : null);
      card.append(
        element(
          'summary',
          `${attempt.questionId} · ${resultLabel(attempt, state.documentVersion, latestAttempt, questionVersion)}`,
        ),
      );
      const answer = Array.isArray(attempt.answer) ? attempt.answer.join('、') : attempt.answer;
      card.append(
        element('p', `${forReview ? '学生作答' : '我的作答'}：${answer}`, 'learning-caption'),
      );
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
          `提交时题目版本 ${recordedVersion(attempt.questionVersion) ? attempt.questionVersion : '未记录'}${dateText ? ` · ${dateText}` : ''}`,
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
      const nextChildren = [];
      const nextReviewKeys = new Set();
      if (!loggedIn()) {
        state.reviewCards.clear();
        results.replaceChildren(
          element('p', '登录后可保存自测作答、查看自己的错题并订正。', 'learning-caption'),
        );
        return;
      }
      if (!state.attempts.length)
        nextChildren.push(
          element(
            'p',
            state.loaded ? '还没有作答记录，按自己的节奏选一道题开始。' : '作答记录尚未加载。',
            'learning-caption',
          ),
        );
      state.attempts.forEach((attempt) => nextChildren.push(renderAttempt(attempt)));
      if (state.cursor) {
        const more = element(
          'button',
          state.historyLoading ? '正在加载更早作答…' : '加载更早的作答记录',
          'button button-ghost',
        );
        more.type = 'button';
        more.disabled = state.historyLoading;
        more.addEventListener('click', loadMoreAttempts);
        nextChildren.push(more);
      }
      if (state.canReview) {
        const reviewButton = element(
          'button',
          state.reviewLoading && !state.reviewLoaded
            ? '正在加载待复核作答…'
            : state.reviewLoaded
              ? '课程负责人：刷新待复核队列'
              : '课程负责人：查看待复核作答',
          'button button-ghost',
        );
        reviewButton.type = 'button';
        reviewButton.disabled = state.reviewLoading;
        reviewButton.addEventListener('click', () => loadReview());
        nextChildren.push(reviewButton);
        if (state.reviewLoaded)
          nextChildren.push(
            element(
              'p',
              `已加载待复核 ${state.reviewAttempts.length} 份。${state.reviewCursor ? (state.reviewMessage ? '更多作答尚未完成加载，可重试。' : '还有更多待复核作答。') : '本次队列已加载完毕，可刷新查看新作答。'}`,
              'learning-caption learning-quiz-review-count',
            ),
          );
        if (state.reviewMessage) {
          const queueMessage = element('p', state.reviewMessage, 'learning-form-status');
          queueMessage.setAttribute('role', 'status');
          nextChildren.push(queueMessage);
        }
        state.reviewAttempts.forEach((attempt) => {
          const reviewKey = reviewKeyFor(attempt);
          const scope = reviewScope();
          const reviewGeneration = state.generation;
          const reviewToken = app.userState?.token || '';
          const reviewEpoch = state.reviewEpoch;
          nextReviewKeys.add(reviewKey);
          const cached = state.reviewCards.get(reviewKey);
          if (
            cached &&
            cached.generation === reviewGeneration &&
            cached.token === reviewToken &&
            cached.epoch === reviewEpoch &&
            cached.scope === scope
          ) {
            // Keep the original live controls, caret and native IME composition.
            // Restoring only their strings after detaching is not editing continuity.
            nextChildren.push(cached.card);
            return;
          }
          cached?.disable();
          const card = renderAttempt(attempt, true);
          card.append(element('p', `复核账号 ${attempt.userId}`, 'learning-caption'));
          card.append(
            element(
              'p',
              `提交时评分：满分 ${recordedScore(attempt.maxScore) ? attempt.maxScore : '未记录'} · 通过阈值 ${recordedScore(attempt.passScore) ? attempt.passScore : '未记录'}`,
              'learning-caption learning-quiz-review-scoring',
            ),
          );
          const recordedQuestion = attempt.questionSnapshot;
          if (attempt.snapshotAvailability === 'available' && recordedQuestion?.prompt) {
            card.append(
              element(
                'h4',
                `作答时题目 · 版本 ${recordedVersion(recordedQuestion.questionVersion) ? recordedQuestion.questionVersion : '未记录'}`,
              ),
            );
            const recordedPrompt = element(
              'div',
              '',
              'discussion-markdown-body learning-quiz-review-prompt',
            );
            markdown(recordedPrompt, recordedQuestion.prompt);
            card.append(recordedPrompt);
            if (Array.isArray(recordedQuestion.options)) {
              const options = element('ul', '', 'learning-quiz-review-options');
              for (const option of recordedQuestion.options) {
                const item = element('li', '', 'discussion-markdown-body');
                markdown(item, `${option.id}. ${option.text}`);
                options.append(item);
              }
              card.append(options);
            }
            if (recordedQuestion.learningObjective)
              card.append(element('p', recordedQuestion.learningObjective, 'learning-caption'));
            if (recordedQuestion.source)
              card.append(element('p', `题目来源：${recordedQuestion.source}`, 'learning-caption'));
          } else
            card.append(
              element('p', '原作答题干快照缺失，请核对课程组存档后复核。', 'learning-form-status'),
            );
          const previousDraft = state.reviewDrafts.get(reviewKey);
          const currentReview = () =>
            current(reviewGeneration, reviewToken) &&
            reviewEpoch === state.reviewEpoch &&
            scope === reviewScope() &&
            state.canReview &&
            loggedIn() &&
            state.reviewAttempts.some((record) => reviewKeyFor(record) === reviewKey);
          const form = element('form', '', 'learning-quiz-review-form');
          const scoreLabel = element(
            'label',
            recordedScore(attempt.maxScore)
              ? `复核分数（0–${attempt.maxScore}）`
              : '复核分数（提交时满分未记录，请核对存档）',
          );
          const score = element('input');
          score.type = 'number';
          score.min = '0';
          if (recordedScore(attempt.maxScore)) score.max = String(attempt.maxScore);
          score.step = 'any';
          score.required = true;
          score.value = previousDraft?.score ?? '';
          scoreLabel.append(score);
          const feedbackLabel = element('label', '复核说明与评分依据');
          const feedback = element('textarea');
          feedback.required = true;
          feedback.maxLength = 4000;
          feedback.rows = 3;
          feedback.value = previousDraft?.feedback ?? '';
          feedbackLabel.append(feedback);
          const button = element('button', '确认人工复核', 'button button-primary');
          button.type = 'submit';
          const message = element('p', '', 'learning-form-status');
          message.setAttribute('role', 'status');
          form.append(scoreLabel, feedbackLabel, button, message);
          const preserveReviewDraft = () => {
            if (currentReview())
              state.reviewDrafts.set(reviewKey, { score: score.value, feedback: feedback.value });
          };
          form.addEventListener('input', preserveReviewDraft);
          form.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (!currentReview() || button.disabled || !form.reportValidity()) return;
            preserveReviewDraft();
            const submittedReview = { score: Number(score.value), feedback: feedback.value };
            score.disabled = true;
            feedback.disabled = true;
            button.disabled = true;
            message.textContent = '正在提交本次复核，评分与说明暂时锁定；其他作答仍可继续编辑。';
            try {
              await app.callApi(`${endpoint()}/attempts/${encodeURIComponent(attempt.id)}/review`, {
                method: 'PATCH',
                body: JSON.stringify(submittedReview),
              });
              if (!currentReview()) return;
              state.reviewedIds.add(String(attempt.id));
              state.reviewAttempts = state.reviewAttempts.filter((item) => item.id !== attempt.id);
              state.reviewDrafts.delete(reviewKey);
              state.reviewCards.delete(reviewKey);
              await refresh();
            } catch (error) {
              if (currentReview() && !revokeReviewAccess(error))
                message.textContent = error.message || '复核保存失败，当前输入保留。';
            } finally {
              if (currentReview()) {
                score.disabled = false;
                feedback.disabled = false;
                button.disabled = false;
              }
            }
          });
          card.append(form);
          state.reviewCards.set(reviewKey, {
            card,
            generation: reviewGeneration,
            token: reviewToken,
            epoch: reviewEpoch,
            scope,
            disable: () => {
              score.disabled = true;
              feedback.disabled = true;
              button.disabled = true;
            },
          });
          nextChildren.push(card);
        });
        if (state.reviewCursor) {
          const moreReview = element(
            'button',
            state.reviewLoading
              ? '正在加载更多待复核作答…'
              : state.reviewMessage
                ? '重试加载更多待复核作答'
                : '加载更多待复核作答',
            'button button-ghost learning-quiz-review-more',
          );
          moreReview.type = 'button';
          moreReview.disabled = state.reviewLoading;
          moreReview.addEventListener('click', () => loadReview(true));
          nextChildren.push(moreReview);
        }
      }
      for (const key of state.reviewCards.keys())
        if (!nextReviewKeys.has(key)) {
          state.reviewCards.get(key).disable();
          state.reviewCards.delete(key);
        }
      // Remove obsolete history/status/A nodes, then insert new siblings around
      // retained review cards. Unchanged pending rows keep their relative order,
      // so insertBefore never removes and reinserts B's live editing subtree.
      const retained = new Set(nextChildren);
      for (const child of [...results.children]) if (!retained.has(child)) child.remove();
      let reference = results.firstElementChild;
      for (const child of nextChildren) {
        if (child === reference) reference = reference.nextElementSibling;
        else results.insertBefore(child, reference);
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
      const metadata = element('details', '', 'learning-quiz-info');
      metadata.append(element('summary', '题目目标、来源与评分规则'));
      if (question.difficulty)
        metadata.append(
          element(
            'small',
            `${difficultyLabels[question.difficulty] || '未分层'} · 教师估计`,
            'learning-caption',
          ),
        );
      if (question.learningObjective)
        metadata.append(element('p', question.learningObjective, 'learning-caption'));
      const prompt = element('div', '', 'discussion-markdown-body learning-quiz-prompt');
      markdown(prompt, question.prompt);
      card.append(prompt);
      metadata.append(
        element(
          'p',
          `来源：${question.source || '尚未配置'} · 版本：${question.questionVersion || '未配置'}`,
          'learning-caption',
        ),
      );
      const mode = state.view === 'practice' || !question.official ? 'practice' : 'selftest';
      const formContext = draftContext(question, mode);
      const draftKey = draftKeyFor(question, mode);
      const draft = state.drafts.get(draftKey);
      const savedAnswer = draft?.answer;
      const form = element('form', '', 'learning-quiz-form');
      const controls = [];
      if (question.options) {
        const group = element('fieldset');
        group.append(
          element(
            'legend',
            question.type === 'multiple_choice' ? '请选择全部符合题意的选项' : '请选择一个选项',
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
        metadata.append(
          element(
            'p',
            `允许误差：绝对容差 ${question.scoring.absoluteTolerance}、相对容差 ${question.scoring.relativeTolerance}，取较大值。`,
            'learning-caption',
          ),
        );
      if (question.type === 'short_answer')
        metadata.append(
          element(
            'p',
            question.questionVersion === 'legacy-practice'
              ? '课程模板未配置正式评分规则，可在作答后对照参考解答。'
              : `满分 ${question.scoring.maxScore}，${mode === 'selftest' ? '通过标准' : '练习参考标准'} ${question.scoring.passScore} 分；由课程组按评分依据复核。${mode === 'practice' ? '本次不计入正式测评。' : ''}`,
            'learning-caption',
          ),
        );
      else
        metadata.append(
          element(
            'p',
            `满分 ${question.scoring.maxScore}，${mode === 'selftest' ? '正式通过标准' : '练习参考标准'} ${question.scoring.passScore} 分。${mode === 'practice' ? '当前为练习模式，不计入正式测评。' : ''}`,
            'learning-caption',
          ),
        );
      if (question.type === 'multiple_choice')
        metadata.append(element('p', '漏选或多选得 0 分，不设部分分。', 'learning-caption'));
      card.append(metadata);
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
      const help = element(
        'button',
        '请 Max 看看我的思路',
        'button button-ghost learning-quiz-ask-max',
      );
      help.type = 'button';
      help.disabled = !loggedIn();
      const helpGeneration = state.generation;
      const helpToken = app.userState?.token || '';
      const currentForm = () => {
        if (!current(helpGeneration, helpToken)) return false;
        if (!state.loaded) return true;
        const activeQuestion = [...state.questions, ...state.practiceQuestions].find(
          (entry) => entry.id === question.id && entry.official === question.official,
        );
        return Boolean(activeQuestion && draftKeyFor(activeQuestion, mode) === draftKey);
      };
      const focusTask = () => {
        if (!currentForm()) return;
        page.dispatchEvent(
          new browser.CustomEvent('knowledge:task-focus', {
            detail: { tool: 'feedback', quizView: state.view, questionId: question.id },
          }),
        );
      };
      form.addEventListener('focusin', focusTask);
      help.addEventListener('click', () => {
        if (!loggedIn() || !currentForm()) return;
        const answer = getAnswer();
        const response = question.options
          ? question.options
              .filter((option) =>
                Array.isArray(answer) ? answer.includes(option.id) : answer === option.id,
              )
              .map((option) => `${option.id}. ${option.text}`)
              .join('\n')
          : String(answer || '').trim();
        const helpPrompt = response
          ? `我在做题 ${question.id}。\n我的思路或作答：\n${response.slice(0, 3000)}${response.length > 3000 ? '\n（作答节选，可在发送前修改）' : ''}\n请帮我检查思路和条件，给一个下一步提示，先不要直接给完整答案。`
          : `我在做题 ${question.id}，还没开始作答。请给我一个起步提示，帮助我找出需要的条件，先不要直接给完整答案。`;
        focusTask();
        page.dispatchEvent(
          new browser.CustomEvent('knowledge:open-interaction', {
            detail: { tab: 'max', prompt: helpPrompt },
          }),
        );
        message.textContent = '已放到 Max 输入框，可编辑后发送。';
      });
      form.append(help);
      const applyRestoredDraft = (value) => {
        controls.forEach((control) => {
          if (question.options)
            control.checked = Array.isArray(value.answer)
              ? value.answer.includes(control.value)
              : value.answer === control.value;
          else control.value = typeof value.answer === 'string' ? value.answer : '';
        });
        message.textContent = value.requestKey
          ? '已恢复未提交作答，可核对后重试。'
          : '已恢复未提交作答，可继续编辑。';
      };
      state.draftViews.set(draftKey, applyRestoredDraft);
      if (draft?.restored) applyRestoredDraft(draft);
      form.addEventListener('input', () => {
        if (!currentForm()) return;
        const value = { answer: getAnswer(), requestKey: null };
        state.drafts.set(draftKey, value);
        persistDraft(question, mode, value);
        if (message.textContent.startsWith('已恢复未提交作答')) message.textContent = '';
      });
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!loggedIn()) {
          message.textContent = '请登录后提交作答。';
          return;
        }
        if (!currentForm()) {
          message.textContent = '题目或学习会话已更新，请使用当前题目作答。';
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
        const saved = state.drafts.get(draftKey);
        const intent =
          saved && JSON.stringify(saved.answer) === JSON.stringify(answer) ? saved : { answer };
        if (!intent.requestKey) {
          intent.requestKey = browser.crypto.randomUUID();
          intent.supersedesAttemptId = previous?.id || null;
        }
        state.drafts.set(draftKey, intent);
        const submissionContext = formContext;
        persistDraft(question, mode, intent);
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
              answer: intent.answer,
              mode,
              requestKey: intent.requestKey,
              ...(formContext.documentVersion
                ? { expectedDocumentVersion: formContext.documentVersion }
                : {}),
              ...(intent.supersedesAttemptId
                ? { supersedesAttemptId: intent.supersedesAttemptId }
                : {}),
            }),
          });
          if (!current(generation, token)) return;
          state.attempts = [
            payload.attempt,
            ...state.attempts.filter((attempt) => attempt.id !== payload.attempt.id),
          ];
          state.currentAttempts = mergeCurrentAttempts(state.currentAttempts, [payload.attempt]);
          state.documentVersion = payload.documentVersion || state.documentVersion;
          if (state.drafts.get(draftKey) === intent) {
            state.drafts.delete(draftKey);
            state.submittedDrafts.add(draftKey);
            draftStore?.remove(submissionContext);
          } else draftStore?.save(submissionContext, state.drafts.get(draftKey));
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
      state.draftViews.clear();
      renderPracticeFilters();
      const all = [...state.questions, ...state.practiceQuestions];
      const latest = currentQuestionAttempts(state.currentAttempts, all, state.documentVersion);
      const questions = selectQuestions(all, state.view, state.practiceFilter, latest);
      if (!questions.length) {
        const empty =
          state.view === 'quick'
            ? loggedIn()
              ? '暂无正式自测题，可先做练习。'
              : '登录后可查看课程组发布的正式自测题；本文练习可直接阅读。'
            : state.view === 'mistakes'
              ? state.currentAttemptsComplete
                ? '当前题库暂时没有已判定的错题；待复核和旧版本作答不会归入当前错题。'
                : `当前已加载记录中暂时没有已判定的错题；待复核作答不会归入错题。${state.cursor ? '还可加载更早的作答记录。' : ''}`
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
    async function loadReview(append = false) {
      if (!state.canReview || !loggedIn() || state.reviewLoading || (append && !state.reviewCursor))
        return;
      const { generation } = state;
      const token = app.userState?.token || '';
      const epoch = state.reviewEpoch;
      const scope = reviewScope();
      const cursor = append ? state.reviewCursor : null;
      const currentQueue = () =>
        current(generation, token) && epoch === state.reviewEpoch && scope === reviewScope();
      state.reviewLoading = true;
      state.reviewMessage = '';
      renderResults();
      try {
        const payload = await app.callApi(
          `${endpoint()}/attempts?review=pending${cursor ? `&before=${encodeURIComponent(cursor)}` : ''}`,
          { method: 'GET' },
        );
        if (!currentQueue()) return;
        if (
          !Array.isArray(payload?.attempts) ||
          payload.attempts.some(
            (attempt) =>
              !attempt ||
              typeof attempt !== 'object' ||
              Array.isArray(attempt) ||
              !['string', 'number'].includes(typeof attempt.id) ||
              !String(attempt.id).trim() ||
              (typeof attempt.id === 'number' && !Number.isFinite(attempt.id)) ||
              typeof attempt.questionId !== 'string' ||
              !attempt.questionId.trim() ||
              !['string', 'number'].includes(typeof attempt.userId) ||
              !String(attempt.userId).trim() ||
              (typeof attempt.userId === 'number' && !Number.isFinite(attempt.userId)) ||
              attempt.status !== 'pending_review' ||
              !Number.isFinite(attempt.maxScore) ||
              attempt.maxScore < 0,
          )
        )
          throw new Error('待复核响应格式不完整，未替换已加载队列');
        const nextCursor = payload.nextCursor ?? null;
        if (nextCursor !== null && (typeof nextCursor !== 'string' || !nextCursor.trim()))
          throw new Error('待复核分页游标格式无效');
        if (append && nextCursor === cursor) throw new Error('待复核分页未前进，未替换已加载队列');
        if (payload.documentVersion && payload.documentVersion !== state.documentVersion) {
          state.reviewMessage = '课程内容版本已更新，请刷新题目后重新加载待复核队列。';
          return;
        }
        const records = new Map(
          (append ? state.reviewAttempts : []).map((attempt) => [String(attempt.id), attempt]),
        );
        for (const attempt of payload.attempts || [])
          if (!state.reviewedIds.has(String(attempt.id))) records.set(String(attempt.id), attempt);
        state.reviewAttempts = [...records.values()];
        state.reviewCursor = nextCursor;
        state.reviewLoaded = true;
        if (!state.reviewAttempts.length) state.reviewMessage = '当前知识点没有待复核作答。';
      } catch (error) {
        if (currentQueue() && !revokeReviewAccess(error))
          state.reviewMessage = `${error.message || '待复核作答加载失败'}；已加载作答和复核输入保留，可重试。`;
      } finally {
        if (currentQueue()) {
          state.reviewLoading = false;
          renderResults();
        }
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
        // Compatibility for an older server without the latest-state field.
        // An authoritative current summary never depends on historical paging.
        if (!state.currentAttemptsComplete)
          state.currentAttempts = mergeCurrentAttempts(
            state.currentAttempts,
            payload.attempts || [],
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
        const nextVersion = questions.documentVersion || attempts.documentVersion || '';
        if (
          state.loaded &&
          (state.documentVersion !== nextVersion ||
            state.questionVersion !== questions.questionVersion ||
            state.canReview !== Boolean(questions.canReview))
        )
          resetReviewQueue(state.canReview && Boolean(questions.canReview));
        state.questions = questions.questions || [];
        state.practiceQuestions = questions.practiceQuestions || [];
        state.attempts = attempts.attempts || [];
        // An empty authoritative summary is meaningful; only absent legacy fields
        // fall back to the bounded history that the learner explicitly loaded.
        state.currentAttemptsComplete = Array.isArray(attempts.currentAttempts);
        state.currentAttempts = mergeCurrentAttempts(
          state.currentAttemptsComplete ? attempts.currentAttempts : state.attempts,
        );
        state.cursor = attempts.nextCursor || null;
        state.documentVersion = nextVersion;
        state.questionVersion = questions.questionVersion;
        state.canReview = Boolean(questions.canReview);
        state.loaded = true;
        status.textContent = `${state.questions.length ? `课程组已审核 ${state.questions.length} 道自测题。` : '正式自测尚未开放。'}客观题按已发布规则判定，主观题待人工复核；${(questions.warnings || []).join(' ') || '作答与错题仅本人可见，待复核作答对本课程负责人开放。'}`;
        renderQuestions();
        renderResults();
        announce();
        restoreSavedDrafts(generation, token);
      } catch (error) {
        if (!current(generation, token)) return;
        if (!revokeReviewAccess(error))
          status.textContent = `${error.message || '题目加载失败'}；本文练习仍可查看，请稍后重试。`;
        renderQuestions();
        renderResults();
      } finally {
        if (current(generation, token)) state.loading = false;
      }
    }
    function resetSession(stale = false) {
      if (
        stale ||
        (state.sessionKnown &&
          (state.uid !== (app.userState?.uid || '') ||
            state.token !== (app.userState?.token || '')))
      )
        draftStore?.clear();
      state.sessionKnown = true;
      state.generation += 1;
      state.stale = stale;
      state.uid = app.userState?.uid || '';
      state.token = app.userState?.token || '';
      state.attempts = [];
      state.currentAttempts = [];
      state.currentAttemptsComplete = false;
      resetReviewQueue();
      state.questions = [];
      state.canReview = false;
      state.loaded = false;
      state.cursor = null;
      state.historyLoading = false;
      state.drafts.clear();
      state.submittedDrafts.clear();
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
    browser.addEventListener('beforeunload', (event) => {
      if (
        state.stale ||
        ![...state.drafts.values()].some((draft) =>
          Array.isArray(draft.answer) ? draft.answer.length : String(draft.answer || '').trim(),
        )
      )
        return;
      event.preventDefault();
      event.returnValue = '';
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
      mergeCurrentAttempts,
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
        currentAttempts: [],
        currentAttemptsComplete: false,
        questions: [],
        practiceQuestions: [],
        documentVersion: '',
        loaded: false,
      },
  };
  window.FreeBbsLearningAssessment = api;
  api.init();
})();
