/* Bounded execution loop: every decision receives the actual current editor state. */
(function circuitAgentModule(root) {
  const protocol =
    typeof module !== 'undefined' && module.exports
      ? require('./circuit-ai-actions')
      : root.CircuitAIActions;
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const terminalCodes = new Set(['AGENT_STOPPED', 'AGENT_STALE']);

  function stable(value) {
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    if (value && typeof value === 'object')
      return `{${Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
        .join(',')}}`;
    return JSON.stringify(value);
  }

  function contentOf(snapshot) {
    return stable({
      document: snapshot.document,
      selection: snapshot.selection,
      simulation: snapshot.simulation,
      simulationError: snapshot.simulationError,
      isWiring: snapshot.isWiring,
    });
  }

  function sameIdentity(first, second) {
    return ['cid', 'generation', 'canEdit'].every((key) => first[key] === second[key]);
  }

  function sameSnapshot(first, second) {
    return (
      sameIdentity(first, second) &&
      first.editVersion === second.editVersion &&
      contentOf(first) === contentOf(second)
    );
  }

  function interrupted(reason, code = 'AGENT_STOPPED') {
    return Object.assign(new Error(reason), { code });
  }

  function abortable(promise, signal) {
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason || interrupted('已停止自主执行。'));
      if (signal.aborted) {
        // Attach a rejection handler even when the operation has already been cancelled.
        Promise.resolve(promise).catch(() => {});
        abort();
        return;
      }
      signal.addEventListener('abort', abort, { once: true });
      Promise.resolve(promise).then(
        (value) => {
          signal.removeEventListener('abort', abort);
          if (signal.aborted) abort();
          else resolve(value);
        },
        (error) => {
          signal.removeEventListener('abort', abort);
          reject(signal.aborted ? signal.reason : error);
        },
      );
    });
  }

  function resultSummary(snapshot) {
    const { simulation } = snapshot;
    return {
      components: snapshot.document?.components?.length || 0,
      wires: snapshot.document?.wires?.length || 0,
      analysis: snapshot.document?.analysis,
      display: snapshot.document?.display,
      simulationError: snapshot.simulationError,
      simulation: simulation
        ? {
            analysis: simulation.analysis,
            sampleCount: simulation.sampleCount,
            warnings: simulation.warnings,
            traces: simulation.traces?.slice(0, 8).map((trace) => ({
              id: trace.id,
              min: trace.min,
              max: trace.max,
              latest: trace.latest,
            })),
          }
        : null,
    };
  }

  function create({
    getSnapshot,
    beginRun,
    endRun,
    executeActions,
    requestStep,
    onEvent = () => {},
    maxSteps = 12,
    timeoutMs = 600000,
  }) {
    [getSnapshot, beginRun, endRun, executeActions, requestStep].forEach((callback) => {
      if (typeof callback !== 'function') throw new Error('自主执行缺少编辑器接口。');
    });
    const stepLimit = Math.max(1, Math.min(12, Math.floor(Number(maxSteps) || 12)));
    const timeLimit = Math.max(1, Math.min(600000, Number(timeoutMs) || 600000));
    let active = null;

    function emit(event) {
      // A presentation callback must never cause an already executed action to be retried.
      try {
        onEvent(clone(event));
      } catch {
        // The execution state remains authoritative when the view is no longer mounted.
      }
    }

    function stop(reason = '已停止自主执行。') {
      if (active && !active.controller.signal.aborted)
        active.controller.abort(interrupted(String(reason).slice(0, 500)));
    }

    async function run(question, { history = [] } = {}) {
      if (active) throw new Error('Max 已在执行一个任务，请先停止当前任务。');
      if (typeof question !== 'string' || !question.trim()) throw new Error('请先输入任务。');
      const originalHistory = clone(history)
        .filter((message) => ['user', 'assistant'].includes(message.role))
        .slice(-8)
        .map((message) => ({
          role: message.role,
          content: String(message.content).slice(0, 4000),
        }));
      const context = {
        controller: new AbortController(),
        runId: null,
        ended: false,
        ending: null,
      };
      active = context;
      const { signal } = context.controller;
      const observations = [];
      const noOps = new Map();
      let snapshot;
      let step = 0;
      let answer = '';
      let failures = 0;
      let status = 'complete';
      let reason = 'Max 已完成本轮自主执行。';
      const timer = setTimeout(() => {
        context.controller.abort(interrupted('自主执行已达到 10 分钟时限。', 'AGENT_TIMEOUT'));
      }, timeLimit);

      function guard() {
        if (signal.aborted) throw signal.reason;
      }

      function read() {
        return clone(getSnapshot());
      }

      function checkCurrent() {
        guard();
        const current = read();
        if (!sameSnapshot(snapshot, current))
          throw interrupted(
            '电路或图像已在执行期间改变，Max 已停止，请根据当前画布重新发起任务。',
            'AGENT_STALE',
          );
        return current;
      }

      function observe(outcome, summary) {
        const observation = { step, status: outcome, summary: String(summary).slice(0, 4000) };
        observations.push(observation);
        emit({ type: 'observation', ...observation });
      }

      function close() {
        if (context.runId === null || context.ending) return context.ending;
        try {
          context.ending = Promise.resolve(endRun(context.runId)).catch(() => {});
        } catch {
          context.ending = Promise.resolve();
        }
        return context.ending;
      }

      try {
        const opening = Promise.resolve()
          .then(() => {
            guard();
            return beginRun();
          })
          .then((opened) => {
            if (!opened || opened.runId == null || !opened.snapshot)
              throw new Error('编辑器未能开始自主执行。');
            context.runId = opened.runId;
            // A delayed lease is released even if cancellation won the race.
            if (context.ended) close();
            return opened;
          });
        const opened = await abortable(opening, signal);
        context.runId = opened.runId;
        snapshot = clone(opened.snapshot);
        guard();
        for (step = 1; step <= stepLimit; step += 1) {
          snapshot = checkCurrent();
          emit({ type: 'step', step, maxSteps: stepLimit });
          let response;
          let attemptedActions;
          try {
            guard();
            const payload = {
              question: question.trim(),
              history: clone(originalHistory),
              document: clone(snapshot.document),
              selection: clone(snapshot.selection || {}),
              simulation: clone(snapshot.simulation || null),
              agent: {
                step,
                canEdit: snapshot.canEdit === true,
                observations: clone(observations),
              },
            };
            const requestStepNumber = step;
            let progressOpen = true;
            let progressCheckedAt = -Infinity;
            const onProgress = (progress) => {
              if (!progressOpen || context.ended || signal.aborted) return;
              try {
                // Stream tokens need not repeatedly serialize the same waveform snapshot.
                // The final response always performs a full check before any action executes.
                if (Date.now() - progressCheckedAt >= 250) {
                  checkCurrent();
                  progressCheckedAt = Date.now();
                }
              } catch (error) {
                context.controller.abort(error);
                return;
              }
              if (progress?.type === 'answer' && typeof progress.answer === 'string')
                emit({ type: 'progress', step: requestStepNumber, answer: progress.answer });
              else if (progress?.type === 'status')
                emit({
                  type: 'progress',
                  step: requestStepNumber,
                  phase: progress.phase,
                  message: String(progress.message || ''),
                });
            };
            try {
              response = await abortable(
                Promise.resolve().then(() => {
                  guard();
                  return requestStep(payload, { signal, onProgress });
                }),
                signal,
              );
            } finally {
              progressOpen = false;
            }
            checkCurrent();
            if (!response || typeof response !== 'object')
              throw new Error('Max 返回了无效的操作结果。');
            answer = String(response.answer || '').trim();
            if (answer) emit({ type: 'answer', step, answer });
            attemptedActions = response.actions;
            if (response.actionWarning) throw new Error(String(response.actionWarning));
            const proposed = response.actions === undefined ? [] : response.actions;
            if (!Array.isArray(proposed)) throw new Error('Max 操作必须是一个数组。');
            if (response.done !== undefined && typeof response.done !== 'boolean')
              throw new Error('自主操作的完成状态必须为布尔值。');
            if (response.done === true && proposed.length)
              throw new Error('已完成的回答不能同时要求执行操作，请先执行并读取结果后结束。');
            if (!proposed.length) {
              if (response.done !== true)
                throw new Error(
                  '尚未确认任务完成，也未提供可执行操作。请返回下一步 actions；只有读取结果并完成任务后才能返回 done: true。',
                );
              if (typeof response.answer !== 'string' || !answer)
                throw new Error('任务完成时必须提供非空的结果说明，不能返回空回答。');
              break;
            }
            const actions = protocol.validateActions(
              clone(proposed),
              snapshot.document,
              (snapshot.simulation?.traces || []).map((trace) => trace.id),
            );
            if (!snapshot.canEdit && actions.some(protocol.isEditingAction))
              throw new Error(
                '当前电路为只读，不能自动修改参数、电路或图像。请先复制为自己的电路。',
              );
            const before = snapshot;
            emit({ type: 'actions', step, actions });
            checkCurrent();
            let executed;
            try {
              executed = await abortable(
                Promise.resolve().then(() => {
                  checkCurrent();
                  return executeActions(clone(actions), {
                    runId: context.runId,
                    expectedVersion: before.editVersion,
                    signal,
                  });
                }),
                signal,
              );
            } catch (error) {
              guard();
              if (terminalCodes.has(error.code) || error.name === 'AbortError') throw error;
              const current = read();
              if (!sameIdentity(before, current))
                throw interrupted('当前电路或编辑权限已改变，Max 已停止。', 'AGENT_STALE');
              snapshot = current;
              throw error;
            }
            guard();
            const current = read();
            if (!sameIdentity(before, current) || (executed && !sameSnapshot(executed, current)))
              throw interrupted('操作完成时画布已改变，Max 已停止。', 'AGENT_STALE');
            snapshot = current;
            failures = 0;
            const changed = contentOf(before) !== contentOf(snapshot);
            const actionText = JSON.stringify(actions).slice(0, 2200);
            observe(
              'success',
              `操作：${actionText}\n执行成功；${changed ? '状态已更新' : '状态与执行前相同'}。当前结果：${JSON.stringify(resultSummary(snapshot)).slice(0, 1700)}`,
            );
            if (changed) noOps.clear();
            else {
              const key = `${stable(actions)}:${contentOf(snapshot)}`;
              noOps.set(key, (noOps.get(key) || 0) + 1);
              if (noOps.get(key) >= 2) {
                status = 'limit';
                reason = '相同操作重复执行后没有产生新结果，Max 已停止。';
                break;
              }
            }
          } catch (error) {
            guard();
            if (terminalCodes.has(error.code) || error.name === 'AbortError') throw error;
            checkCurrent();
            failures += 1;
            observe(
              'error',
              `本轮操作未完成：${String(error.message || error).slice(0, 1500)}。${snapshot.simulationError ? `当前仿真错误：${String(snapshot.simulationError).slice(0, 400)}。` : ''}${Array.isArray(attemptedActions) ? `尝试的操作：${JSON.stringify(attemptedActions).slice(0, 1800)}。` : ''}下一步请依据当前画布与仿真结果纠正操作。`,
            );
            if (failures >= 3) {
              status = 'error';
              reason = '连续 3 轮未能完成操作，Max 已停止。可查看执行记录后调整任务。';
              break;
            }
          }
        }
        if (step > stepLimit) {
          step = stepLimit;
          status = 'limit';
          reason = `自主执行已达到 ${stepLimit} 轮上限。当前草稿与执行结果已保留。`;
        }
      } catch (error) {
        const code = signal.aborted ? signal.reason?.code : error.code;
        status = 'error';
        if (code === 'AGENT_TIMEOUT') status = 'timeout';
        else if (code === 'AGENT_STALE') status = 'stale';
        else if (code === 'AGENT_STOPPED' || error.name === 'AbortError') status = 'stopped';
        reason = String(
          (signal.aborted ? signal.reason?.message : error.message) || '自主执行已停止。',
        ).slice(0, 1000);
      } finally {
        clearTimeout(timer);
        context.ended = true;
        const ending = close();
        if (ending) {
          try {
            await abortable(ending, signal);
          } catch {
            // Cancellation already triggered the bridge cleanup; do not wait on a stale view.
          }
        }
        if (active === context) active = null;
      }
      try {
        snapshot = read();
      } catch {
        // A disposed editor may no longer expose a snapshot after cancellation.
      }
      const result = { type: 'finish', step, status, reason, answer, observations, snapshot };
      emit(result);
      return result;
    }

    return { run, stop, isRunning: () => active !== null };
  }

  const api = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FreeBbsCircuitAgent = api;
})(typeof window !== 'undefined' ? window : globalThis);
