/* Declarative, bounded draft operations shared by the browser and AI endpoint. */
(function circuitAIActionsModule(root) {
  const engine =
    typeof module !== 'undefined' && module.exports
      ? require('./circuit-engine')
      : root.FreeBbsCircuitEngine;
  const actionFields = Object.freeze({
    highlight_components: ['componentIds'],
    show_traces: ['traceIds'],
    set_parameter: ['componentId', 'parameter', 'value'],
    set_analysis: ['analysis'],
    add_component: ['component'],
    connect: ['from', 'to', 'points'],
    transform_component: ['componentId', 'rotation', 'mirrorX', 'mirrorY'],
    move_component: ['componentId', 'x', 'y'],
    delete_component: ['componentId'],
    run_simulation: [],
  });
  const analysisFields = {
    dc: ['type'],
    transient: ['type', 'stop', 'step', 'initial'],
    sweep: ['type', 'componentId', 'parameter', 'start', 'stop', 'points'],
    ac: ['type', 'start', 'stop', 'points', 'scale'],
  };
  const componentFields = ['id', 'type', 'x', 'y', 'rotation', 'mirrorX', 'mirrorY', 'params'];
  const nonEditing = new Set(['highlight_components', 'show_traces', 'run_simulation']);
  const maxActions = 12;

  function assertSafeJson(value) {
    let count = 0;
    function visit(current, depth) {
      count += 1;
      if (depth > 12 || count > 50000) throw new Error('AI 数据过大或嵌套过深。');
      if (current === null || typeof current === 'boolean') return;
      if (typeof current === 'string') {
        if (current.length > 100000) throw new Error('AI 数据中的文本过长。');
        return;
      }
      if (typeof current === 'number' && Number.isFinite(current)) return;
      if (
        !current ||
        typeof current !== 'object' ||
        (!Array.isArray(current) &&
          Object.getPrototypeOf(current) !== Object.prototype &&
          Object.getPrototypeOf(current) !== null)
      )
        throw new Error('AI 数据必须是普通 JSON。');
      for (const [key, child] of Object.entries(current)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key))
          throw new Error('AI 数据含不允许的字段。');
        visit(child, depth + 1);
      }
    }
    visit(value, 0);
  }

  function assertFields(value, fields, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error(`${label}必须是 JSON 对象。`);
    if (Object.keys(value).some((key) => !fields.includes(key)))
      throw new Error(`${label}含不支持的字段。`);
  }

  function assertAnalysis(analysis) {
    assertFields(analysis, analysisFields[analysis?.type] || [], '分析设置');
    if (!Object.hasOwn(analysisFields, analysis.type)) throw new Error('分析类型无效。');
  }

  function assertComponent(component) {
    assertFields(component, componentFields, '元件');
    if (!Object.hasOwn(engine.catalog, component.type)) throw new Error('元件类型无效。');
    if (component.params !== undefined)
      assertFields(
        component.params,
        Object.keys(engine.catalog[component.type].defaults),
        '元件参数',
      );
    for (const key of ['mirrorX', 'mirrorY']) {
      if (component[key] !== undefined && typeof component[key] !== 'boolean')
        throw new Error('元件镜像设置必须为布尔值。');
    }
    if (component.rotation !== undefined && ![0, 90, 180, 270].includes(component.rotation))
      throw new Error('元件旋转角度必须是 0/90/180/270。');
    for (const key of ['x', 'y']) {
      if (component[key] !== undefined && typeof component[key] !== 'number')
        throw new Error('元件坐标必须为数值。');
    }
  }

  function assertPoints(points) {
    if (points === undefined) return;
    if (!Array.isArray(points) || points.length > 32) throw new Error('导线最多允许 32 个拐点。');
    points.forEach((point) => assertFields(point, ['x', 'y'], '导线拐点'));
  }

  function validateEditorDocument(document) {
    assertSafeJson(document);
    assertFields(document, ['version', 'components', 'wires', 'analysis', 'display'], '电路文档');
    if (!Array.isArray(document.components) || !Array.isArray(document.wires))
      throw new Error('电路文档缺少元件或导线列表。');
    document.components.forEach(assertComponent);
    document.wires.forEach((wire) => {
      assertFields(wire, ['id', 'from', 'to', 'points'], '导线');
      assertFields(wire.from, ['componentId', 'pin'], '导线端点');
      assertFields(wire.to, ['componentId', 'pin'], '导线端点');
      assertPoints(wire.points);
    });
    if (document.analysis !== undefined) assertAnalysis(document.analysis);
    return engine.validateDocument(document);
  }

  function isEditingAction(action) {
    return Boolean(
      action && Object.hasOwn(actionFields, action.type) && !nonEditing.has(action.type),
    );
  }

  function idList(value, label) {
    if (!Array.isArray(value) || value.length > 80 || value.some((id) => typeof id !== 'string'))
      throw new Error(`${label}必须是最多 80 项的 ID 列表。`);
    if (new Set(value).size !== value.length) throw new Error(`${label}不能包含重复项。`);
  }

  function processActions(actions, document, availableTraceIds) {
    assertSafeJson(actions);
    if (!Array.isArray(actions) || actions.length > maxActions)
      throw new Error(`每次最多提出 ${maxActions} 项电路操作。`);
    if (JSON.stringify(actions).length > 32000) throw new Error('AI 操作数据过大。');
    let draft = validateEditorDocument(document);
    const clonedActions = JSON.parse(JSON.stringify(actions));
    const allowedTraces = availableTraceIds === null ? null : new Set(availableTraceIds);
    for (const action of clonedActions) {
      if (!action || typeof action.type !== 'string' || !Object.hasOwn(actionFields, action.type))
        throw new Error('AI 提出了不支持的操作。');
      assertFields(action, ['type', ...actionFields[action.type]], 'AI 操作');
      const componentList = draft.components;
      const findComponent = (id) => {
        const component = componentList.find((item) => item.id === id);
        if (!component) throw new Error(`元件 ${String(id).slice(0, 40)} 不存在。`);
        return component;
      };
      switch (action.type) {
        case 'highlight_components':
          idList(action.componentIds, '高亮元件');
          action.componentIds.forEach(findComponent);
          break;
        case 'show_traces':
          idList(action.traceIds, '波形');
          action.traceIds.forEach((id) => {
            const componentId = engine.traceComponentId(id);
            const component = componentId && findComponent(componentId);
            if (
              !component ||
              !engine.validTraceId(id, componentList) ||
              (allowedTraces && !allowedTraces.has(id))
            )
              throw new Error(`波形 ${id.slice(0, 48)} 不存在，请先运行仿真。`);
          });
          break;
        case 'set_parameter': {
          const component = findComponent(action.componentId);
          if (
            typeof action.parameter !== 'string' ||
            !Object.hasOwn(engine.catalog[component.type].defaults, action.parameter) ||
            action.value === undefined
          )
            throw new Error('AI 提出了不存在的元件参数。');
          component.params[action.parameter] = action.value;
          break;
        }
        case 'set_analysis':
          assertAnalysis(action.analysis);
          draft.analysis = action.analysis;
          break;
        case 'add_component':
          assertComponent(action.component);
          if (!['x', 'y'].every((key) => typeof action.component[key] === 'number'))
            throw new Error('新增元件必须指定画布坐标。');
          draft.components.push(action.component);
          break;
        case 'connect': {
          assertFields(action.from, ['componentId', 'pin'], '导线端点');
          assertFields(action.to, ['componentId', 'pin'], '导线端点');
          assertPoints(action.points);
          const samePin = (left, right) =>
            left.componentId === right.componentId && left.pin === right.pin;
          if (
            draft.wires.some(
              (wire) =>
                (samePin(wire.from, action.from) && samePin(wire.to, action.to)) ||
                (samePin(wire.from, action.to) && samePin(wire.to, action.from)),
            )
          )
            throw new Error('这两个引脚已经由导线相连。');
          let number = 1;
          const wireIds = new Set(draft.wires.map((wire) => wire.id));
          while (wireIds.has(`w${number}`)) number += 1;
          draft.wires.push({
            id: `w${number}`,
            from: action.from,
            to: action.to,
            ...(action.points === undefined ? {} : { points: action.points }),
          });
          break;
        }
        case 'transform_component': {
          const component = findComponent(action.componentId);
          if (!['rotation', 'mirrorX', 'mirrorY'].some((key) => action[key] !== undefined))
            throw new Error('元件变换缺少旋转或镜像设置。');
          for (const key of ['rotation', 'mirrorX', 'mirrorY']) {
            if (action[key] !== undefined) component[key] = action[key];
          }
          assertComponent(component);
          break;
        }
        case 'move_component': {
          const component = findComponent(action.componentId);
          if (typeof action.x !== 'number' || typeof action.y !== 'number')
            throw new Error('移动元件必须指定画布坐标。');
          component.x = action.x;
          component.y = action.y;
          break;
        }
        case 'delete_component':
          findComponent(action.componentId);
          draft.components = draft.components.filter(
            (component) => component.id !== action.componentId,
          );
          draft.wires = draft.wires.filter(
            (wire) =>
              wire.from.componentId !== action.componentId &&
              wire.to.componentId !== action.componentId,
          );
          break;
        default:
          break;
      }
      // Validate every step so an invalid operation cannot be hidden by a later overwrite.
      if (isEditingAction(action)) draft = validateEditorDocument(draft);
    }
    // Display operations are carried out after the edit batch, so their targets must survive it.
    for (const action of clonedActions) {
      const targets =
        action.type === 'highlight_components'
          ? action.componentIds
          : action.type === 'show_traces'
            ? action.traceIds.map((id) => engine.traceComponentId(id))
            : [];
      if (targets.some((id) => !draft.components.some((component) => component.id === id)))
        throw new Error('高亮或波形目标已被本次操作删除。');
    }
    if (
      clonedActions.some((action) => action.type === 'show_traces' && action.traceIds.length) &&
      clonedActions.some(
        (action) =>
          isEditingAction(action) &&
          !['move_component', 'transform_component'].includes(action.type),
      ) &&
      !clonedActions.some((action) => action.type === 'run_simulation')
    )
      throw new Error('修改电路后查看波形需要在同一批操作中运行仿真。');
    return { actions: clonedActions, document: draft };
  }

  function validateActions(actions, document, availableTraceIds = []) {
    return processActions(actions, document, availableTraceIds).actions;
  }

  function applyActions(document, actions) {
    // The caller checks real trace availability with validateActions before execution.
    return processActions(actions, document, null).document;
  }

  const parameterLabels = {
    resistance: ['电阻', 'Ω'],
    capacitance: ['电容', 'F'],
    inductance: ['电感', 'H'],
    dc: ['直流偏置', 'V / A'],
    waveform: ['波形', ''],
    amplitude: ['振幅', 'V / A'],
    frequency: ['频率', 'Hz'],
    phase: ['相位', '°'],
    duty: ['占空比', ''],
    delay: ['延迟', 's'],
    acAmplitude: ['交流小信号振幅', 'V / A'],
    gain: ['增益', ''],
    control: ['控制电流元件', ''],
    is: ['反向饱和电流', 'A'],
    n: ['理想因子', ''],
    beta: ['正向电流增益', ''],
    betaReverse: ['反向电流增益', ''],
    thermalVoltage: ['热电压', 'V'],
    kp: ['跨导系数', 'A/V²'],
    w: ['沟道宽度', 'm'],
    l: ['沟道长度', 'm'],
    vto: ['阈值电压', 'V'],
    lambda: ['沟道长度调制系数', '1/V'],
    polarity: ['极性', ''],
    railPositive: ['正电源限幅', 'V'],
    railNegative: ['负电源限幅', 'V'],
    expression: ['伏安表达式', ''],
    k: ['伏安系数 k', ''],
  };

  function describeParameter(parameter, value, componentType) {
    const [label, defaultUnit] = parameterLabels[parameter] || [parameter, ''];
    let unit = defaultUnit;
    if (unit === 'V / A' && ['voltage', 'current'].includes(componentType))
      unit = componentType === 'current' ? 'A' : 'V';
    const display = {
      dc: '直流',
      sine: '正弦',
      pulse: '脉冲',
      npn: 'NPN',
      pnp: 'PNP',
      n: 'N 沟道',
      p: 'P 沟道',
    };
    const formatted =
      ['waveform', 'polarity'].includes(parameter) &&
      typeof value === 'string' &&
      Object.hasOwn(display, value)
        ? display[value]
        : String(value);
    return `${label} ${formatted}${unit ? ` ${unit}` : ''}`;
  }

  function describeAnalysis(analysis) {
    if (analysis.type === 'dc') return '直流工作点';
    if (analysis.type === 'transient')
      return `瞬态：时长 ${analysis.stop ?? 0.01} s，步长 ${analysis.step ?? 0.00001} s，${analysis.initial === 'operating-point' ? '从直流工作点开始' : '零初始状态'}`;
    if (analysis.type === 'ac')
      return `交流扫描：${analysis.start ?? 10}–${analysis.stop ?? 100000} Hz，${analysis.points ?? 101} 点，${analysis.scale === 'linear' ? '线性' : '对数'}刻度`;
    return `参数扫描：${analysis.componentId} 的${parameterLabels[analysis.parameter]?.[0] || analysis.parameter}从 ${analysis.start ?? 0} 到 ${analysis.stop ?? 5}，${analysis.points ?? 101} 点`;
  }

  function describeAction(action) {
    switch (action.type) {
      case 'highlight_components':
        return action.componentIds.length
          ? `高亮元件 ${action.componentIds.join('、')}`
          : '清除元件高亮';
      case 'show_traces':
        return action.traceIds.length
          ? `显示波形 ${action.traceIds.map((id) => `${id.slice(2)} ${id.startsWith('V:') ? '电压' : '电流'}`).join('、')}`
          : '隐藏波形';
      case 'set_parameter':
        return `设置 ${action.componentId} 的${describeParameter(action.parameter, action.value)}`;
      case 'set_analysis':
        return `切换分析为${describeAnalysis(action.analysis)}`;
      case 'add_component':
        return `添加${engine.catalog[action.component.type].label} ${action.component.id}，位置 (${action.component.x}, ${action.component.y})，旋转 ${action.component.rotation ?? 0}°${action.component.mirrorX ? '，水平镜像' : ''}${action.component.mirrorY ? '，垂直镜像' : ''}${Object.entries(
          { ...engine.catalog[action.component.type].defaults, ...action.component.params },
        )
          .map(([key, value]) => `，${describeParameter(key, value, action.component.type)}`)
          .join('')}`;
      case 'connect':
        return `连接 ${action.from.componentId}:${action.from.pin} → ${action.to.componentId}:${action.to.pin}${action.points ? `，${action.points.length} 个拐点` : ''}`;
      case 'transform_component':
        return `变换 ${action.componentId}：${['rotation', 'mirrorX', 'mirrorY']
          .filter((key) => action[key] !== undefined)
          .map(
            (key) =>
              `${{ rotation: '角度', mirrorX: '水平镜像', mirrorY: '垂直镜像' }[key]} ${key === 'rotation' ? `${action[key]}°` : action[key] ? '开启' : '关闭'}`,
          )
          .join('，')}`;
      case 'move_component':
        return `移动 ${action.componentId} 到 (${action.x}, ${action.y})`;
      case 'delete_component':
        return `删除 ${action.componentId} 及连接到它的导线`;
      case 'run_simulation':
        return '运行当前电路仿真';
      default:
        return '不支持的电路操作';
    }
  }

  const api = {
    maxActions,
    validateActions,
    applyActions,
    describeAction,
    isEditingAction,
    validateEditorDocument,
    assertSafeJson,
    assertFields,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CircuitAIActions = api;
})(typeof window !== 'undefined' ? window : globalThis);
