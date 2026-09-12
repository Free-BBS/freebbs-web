/* Numerical teaching models; see docs/circuit-contract.md and the ngspice manual. */
/* eslint-disable no-param-reassign */
(function circuitEngineModule(root) {
  const limits = Object.freeze({ maxTransientPoints: 100001, maxSweepPoints: 2000 });
  const sourceDefaults = {
    dc: 5,
    waveform: 'dc',
    amplitude: 1,
    frequency: 1000,
    phase: 0,
    duty: 0.5,
    delay: 0,
    acAmplitude: 1,
  };
  const twoPins = ['正', '负'];
  const powerRails = ['vcc', 'vdd', 'vss', 'vee'];
  const netSymbols = ['ground', 'junction', ...powerRails];
  const catalog = {
    ground: { label: '参考地', pins: ['地'], defaults: {} },
    junction: { label: '连接点', pins: ['连接点'], defaults: {} },
    ...Object.fromEntries(
      powerRails.map((type) => [
        type,
        { label: type.toUpperCase(), pins: [type.toUpperCase()], defaults: {} },
      ]),
    ),
    fixed_voltage: { label: '固定电平', pins: ['电平'], defaults: { dc: 5 } },
    resistor: { label: '电阻', pins: twoPins, defaults: { resistance: 1000 } },
    capacitor: { label: '电容', pins: twoPins, defaults: { capacitance: 0.000001 } },
    inductor: { label: '电感', pins: twoPins, defaults: { inductance: 0.001 } },
    voltage: { label: '电压源', pins: twoPins, defaults: { ...sourceDefaults } },
    current: {
      label: '电流源',
      pins: twoPins,
      defaults: { ...sourceDefaults, dc: 0.001, amplitude: 0.001, acAmplitude: 0.001 },
    },
    vcvs: {
      label: '压控电压源',
      pins: ['输出正', '输出负', '控制正', '控制负'],
      defaults: { gain: 2 },
    },
    vccs: {
      label: '压控电流源',
      pins: ['输出正', '输出负', '控制正', '控制负'],
      defaults: { gain: 0.001 },
    },
    ccvs: { label: '流控电压源', pins: twoPins, defaults: { gain: 1000, control: '' } },
    cccs: { label: '流控电流源', pins: twoPins, defaults: { gain: 2, control: '' } },
    diode: {
      label: '二极管',
      pins: ['阳极', '阴极'],
      defaults: { is: 1e-12, n: 1, thermalVoltage: 0.02585 },
    },
    bjt: {
      label: 'BJT',
      pins: ['集电极 C', '基极 B', '发射极 E'],
      defaults: { polarity: 'npn', is: 1e-14, beta: 100, betaReverse: 1, thermalVoltage: 0.02585 },
    },
    mosfet: {
      label: 'MOS',
      pins: ['漏极 D', '栅极 G', '源极 S'],
      defaults: { polarity: 'n', kp: 0.0001, w: 0.00001, l: 0.000001, vto: 1, lambda: 0.02 },
    },
    opamp: {
      label: '运算放大器',
      pins: ['正输入', '负输入', '输出'],
      defaults: { gain: 100000, railPositive: 12, railNegative: -12 },
    },
    nonlinear: {
      label: '自定义伏安元件',
      pins: twoPins,
      defaults: { expression: 'i=k*u^3', k: 0.001 },
    },
    voltmeter: { label: '电压表', pins: twoPins, defaults: {} },
    ammeter: { label: '电流表', pins: twoPins, defaults: {} },
    oscilloscope: { label: '示波器', pins: twoPins, defaults: {} },
    oscilloscope2: {
      label: '双通道示波器',
      pins: ['CH1 正', 'CH1 负', 'CH2 正', 'CH2 负'],
      defaults: {},
    },
    twoport: {
      label: '二端口网络',
      pins: ['P1 正', 'P1 负', 'P2 正', 'P2 负'],
      defaults: {
        parameterSet: 'Z',
        m11: 1000,
        m12: 0,
        m21: 0,
        m22: 1000,
        i11: 0,
        i12: 0,
        i21: 0,
        i22: 0,
      },
    },
  };
  const positiveParameters = new Set([
    'resistance',
    'capacitance',
    'inductance',
    'is',
    'n',
    'beta',
    'betaReverse',
    'thermalVoltage',
    'kp',
    'w',
    'l',
  ]);
  const functions = {
    abs: [1, Math.abs],
    sqrt: [1, Math.sqrt],
    exp: [1, Math.exp],
    log: [1, Math.log],
    ln: [1, Math.log],
    sin: [1, Math.sin],
    cos: [1, Math.cos],
    tan: [1, Math.tan],
    tanh: [1, Math.tanh],
    min: [2, Math.min],
    max: [2, Math.max],
    pow: [2, (base, exponent) => base ** exponent],
  };
  const finite = (value, label) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e15)
      throw new Error(`${label}必须是有限数值，绝对值不能超过 10¹⁵。`);
    return value;
  };
  function parseExpression(expression) {
    if (typeof expression !== 'string' || expression.length > 256)
      throw new Error('伏安公式须为不超过 256 个字符的数学表达式。');
    const input = expression.trim().replace(/^i\s*=\s*/i, '');
    const tokens = [];
    const pattern =
      /\s*(?:(\d+(?:\.\d*)?|\.\d+)([eE][+-]?\d+)?|([a-zA-Z_][a-zA-Z_0-9]*)|([+\-*/^(),]))/y;
    let cursor = 0;
    while (cursor < input.length) {
      if (!input.slice(cursor).trim()) break;
      pattern.lastIndex = cursor;
      const match = pattern.exec(input);
      if (!match) throw new Error('伏安公式含非法字符；仅支持 u、k 和数学运算，不执行代码。');
      if (match[1])
        tokens.push({
          type: 'number',
          value: finite(Number(match[1] + (match[2] || '')), '公式常数'),
        });
      else if (match[3]) tokens.push({ type: 'name', value: match[3] });
      else tokens.push({ type: match[4] });
      cursor = pattern.lastIndex;
      if (tokens.length > 128) throw new Error('伏安公式过于复杂，最多 128 个符号。');
    }
    let position = 0;
    let depth = 0;
    const peek = () => tokens[position]?.type;
    const take = (type) => {
      if (peek() !== type) throw new Error(`伏安公式语法错误：缺少 ${type}。`);
      const token = tokens[position];
      position += 1;
      return token;
    };
    function atom() {
      depth += 1;
      if (depth > 24) throw new Error('伏安公式嵌套不能超过 24 层。');
      let node;
      if (peek() === 'number') node = { op: 'constant', value: take('number').value };
      else if (peek() === '(') {
        take('(');
        node = addition();
        take(')');
      } else if (peek() === 'name') {
        const name = take('name').value;
        if (['u', 'k'].includes(name)) node = { op: name };
        else if (name === 'pi' || name === 'e')
          node = { op: 'constant', value: name === 'pi' ? Math.PI : Math.E };
        else {
          if (!Object.hasOwn(functions, name))
            throw new Error(`伏安公式不支持“${name}”；只能引用 u、k 和允许的数学函数。`);
          take('(');
          const args = [addition()];
          if (functions[name][0] === 2) {
            take(',');
            args.push(addition());
          }
          take(')');
          node = { op: 'function', name, args };
        }
      } else throw new Error('伏安公式语法错误，请输入如 i=k*u^3 的表达式。');
      depth -= 1;
      return node;
    }
    function power() {
      const node = atom();
      if (peek() === '^') {
        take('^');
        return { op: '^', left: node, right: unary() };
      }
      return node;
    }
    function unary() {
      if (peek() === '+' || peek() === '-') {
        const op = tokens[position].type;
        position += 1;
        return { op: 'unary', sign: op === '-' ? -1 : 1, value: unary() };
      }
      return power();
    }
    function multiplication() {
      let node = unary();
      while (peek() === '*' || peek() === '/') {
        const op = tokens[position].type;
        position += 1;
        node = { op, left: node, right: unary() };
      }
      return node;
    }
    function addition() {
      let node = multiplication();
      while (peek() === '+' || peek() === '-') {
        const op = tokens[position].type;
        position += 1;
        node = { op, left: node, right: multiplication() };
      }
      return node;
    }
    const tree = addition();
    if (position !== tokens.length) throw new Error('伏安公式含多余字符或缺少运算符。');
    function evaluate(node, u, k) {
      if (node.op === 'constant') return node.value;
      if (node.op === 'u') return u;
      if (node.op === 'k') return k;
      if (node.op === 'unary') return node.sign * evaluate(node.value, u, k);
      if (node.op === 'function')
        return functions[node.name][1](...node.args.map((arg) => evaluate(arg, u, k)));
      const left = evaluate(node.left, u, k);
      const right = evaluate(node.right, u, k);
      if (node.op === '+') return left + right;
      if (node.op === '-') return left - right;
      if (node.op === '*') return left * right;
      if (node.op === '/') return left / right;
      return left ** right;
    }
    return (u, k) =>
      finite(evaluate(tree, u, k), '伏安公式计算结果（请检查定义域、除零或数值溢出）');
  }
  const validId = (value) =>
    typeof value === 'string' &&
    /^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(value) &&
    !/[^A-Za-z0-9_-]/.test(value);
  function validateParameters(component) {
    const entry = catalog[component.type];
    const supplied = component.params ?? {};
    if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied))
      throw new Error(`${component.id} 的参数格式不正确。`);
    for (const key of Object.keys(supplied))
      if (!Object.hasOwn(entry.defaults, key))
        throw new Error(`${component.id} 不支持参数 ${key}。`);
    const params = { ...entry.defaults, ...supplied };
    for (const [key, value] of Object.entries(params)) {
      if (typeof entry.defaults[key] === 'number') {
        finite(value, `${component.id}.${key}`);
        if (positiveParameters.has(key) && value <= 0)
          throw new Error(`${component.id}.${key} 必须大于 0。`);
        if (['frequency', 'delay', 'lambda', 'acAmplitude'].includes(key) && value < 0)
          throw new Error(`${component.id}.${key} 不能小于 0。`);
        if (key === 'duty' && params.waveform === 'pulse' && (value <= 0 || value >= 1))
          throw new Error(`${component.id}.duty 必须在 0 与 1 之间。`);
      } else if (typeof value !== 'string') throw new Error(`${component.id}.${key} 必须是文本。`);
    }
    if (component.type === 'twoport' && !['Z', 'Y', 'H', 'G', 'ABCD'].includes(params.parameterSet))
      throw new Error('二端口参数类型只能为 Z、Y、H、G 或 ABCD。');
    if (params.waveform && !['dc', 'sine', 'pulse'].includes(params.waveform))
      throw new Error(`${component.id} 不支持此波形。`);
    if (params.waveform && params.waveform !== 'dc' && params.frequency <= 0)
      throw new Error(`${component.id} 的周期波形频率必须大于 0。`);
    if (component.type === 'bjt' && !['npn', 'pnp'].includes(params.polarity))
      throw new Error('BJT 极性只能为 npn 或 pnp。');
    if (component.type === 'mosfet' && !['n', 'p'].includes(params.polarity))
      throw new Error('MOS 极性只能为 n 或 p。');
    if (
      component.type === 'opamp' &&
      (params.gain <= 0 || params.railNegative >= params.railPositive)
    )
      throw new Error('运放增益必须大于 0，负电源限幅必须小于正电源限幅。');
    if (component.type === 'nonlinear') parseExpression(params.expression);
    if (params.control !== undefined && params.control !== '' && !validId(params.control))
      throw new Error('控制电流必须填写电压源或电流表的元件 ID。');
    return params;
  }
  function normalizeAnalysis(options, components) {
    if (!options || typeof options !== 'object' || Array.isArray(options))
      throw new Error('分析设置格式不正确。');
    const type = options.type || 'dc';
    if (type === 'dc') return { type };
    if (type === 'transient') {
      const stop = finite(options.stop ?? 0.01, '结束时间');
      const step = finite(options.step ?? 0.00001, '时间步长');
      const initial = options.initial || 'zero';
      if (stop <= 0 || step <= 0 || step > stop)
        throw new Error('瞬态结束时间和步长必须大于 0，步长不能超过结束时间。');
      if (Math.ceil(stop / step - 1e-10) + 1 > limits.maxTransientPoints)
        throw new Error(
          `瞬态最多 ${limits.maxTransientPoints} 个采样点；请增大步长或缩短仿真时间。`,
        );
      if (!['zero', 'operating-point'].includes(initial))
        throw new Error('瞬态初值必须为 zero 或 operating-point。');
      return { type, stop, step, initial };
    }
    if (!['sweep', 'ac'].includes(type))
      throw new Error('分析类型只支持 dc、transient、sweep 或 ac。');
    const start = finite(options.start ?? (type === 'ac' ? 10 : 0), '扫描起点');
    const stop = finite(options.stop ?? (type === 'ac' ? 100000 : 5), '扫描终点');
    const points = options.points ?? 101;
    if (!Number.isInteger(points) || points < 2 || points > limits.maxSweepPoints)
      throw new Error(`扫描点数必须为 2 至 ${limits.maxSweepPoints} 的整数。`);
    if (type === 'ac') {
      const scale = options.scale || 'log';
      if (start <= 0 || stop <= start || !['log', 'linear'].includes(scale))
        throw new Error('频率扫描须满足 0 < 起点 < 终点，刻度为 log 或 linear。');
      return { type, start, stop, points, scale };
    }
    if (typeof options.componentId !== 'string' || typeof options.parameter !== 'string')
      throw new Error('请选择要扫描的元件及其数值参数。');
    const component = components.find((item) => item.id === options.componentId);
    if (
      !component ||
      !Object.hasOwn(component.params, options.parameter) ||
      typeof component.params[options.parameter] !== 'number'
    )
      throw new Error('扫描目标不存在或不是可扫描的数值参数。');
    validateParameters({
      ...component,
      params: { ...component.params, [options.parameter]: start },
    });
    validateParameters({
      ...component,
      params: { ...component.params, [options.parameter]: stop },
    });
    if (start === stop) throw new Error('扫描起点与终点不能相同。');
    return { type, componentId: component.id, parameter: options.parameter, start, stop, points };
  }
  const physicalTracePattern = /^(V|I):([A-Za-z][A-Za-z0-9_-]{0,39})(?::(CH2|P2))?$/;
  function traceComponentId(id) {
    return typeof id === 'string' ? physicalTracePattern.exec(id)?.[2] || null : null;
  }
  function traceDescriptors(component) {
    if (
      !component ||
      !Object.hasOwn(catalog, component.type) ||
      netSymbols.includes(component.type)
    )
      return [];
    const port = { twoport: ' P1', oscilloscope2: ' CH1' }[component.type] || '';
    const descriptors = ['V', 'I'].map((kind) => ({
      id: `${kind}:${component.id}`,
      label: `${component.id}${port} ${kind === 'V' ? '电压' : '电流'}`,
      unit: kind === 'V' ? 'V' : 'A',
    }));
    if (component.type === 'oscilloscope2')
      descriptors.push({
        id: `V:${component.id}:CH2`,
        label: `${component.id} CH2 电压`,
        unit: 'V',
      });
    if (component.type === 'twoport') {
      descriptors.push({ id: `V:${component.id}:P2`, label: `${component.id} P2 电压`, unit: 'V' });
      descriptors.push({ id: `I:${component.id}:P2`, label: `${component.id} P2 电流`, unit: 'A' });
    }
    return descriptors;
  }
  function validTraceId(id, components) {
    if (typeof id !== 'string') return false;
    if (/^M:M[1-8]$/.test(id)) return true;
    const match = physicalTracePattern.exec(id);
    if (!match || (match[1] === 'I' && match[3] === 'CH2')) return false;
    if (!components) return true;
    const component = components.find((item) => item.id === match[2]);
    return traceDescriptors(component).some((trace) => trace.id === id);
  }
  function normalizeAnnotation(value) {
    const fields = ['id', 'traceId', 'at', 'text', 'mode', 'axis', 'xTraceId', 'analysisKey'];
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).some((key) => !fields.includes(key) && key !== 'marker') ||
      fields.some((key) => !Object.hasOwn(value, key))
    )
      throw new Error('波形标记格式不正确或含有不支持的字段。');
    if (typeof value.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(value.id))
      throw new Error('波形标记 ID 必须以字母开头，且最多 40 个字符。');
    if (!validTraceId(value.traceId)) throw new Error('波形标记曲线 ID 不正确。');
    const at = finite(value.at, '波形标记坐标');
    if (typeof value.text !== 'string' || value.text.length > 160)
      throw new Error('波形标记注释最多 160 个字符。');
    if (
      Object.hasOwn(value, 'marker') &&
      !['point', 'vertical', 'horizontal'].includes(value.marker)
    )
      throw new Error('波形标记样式须为点、竖线或横线。');
    if (!['xt', 'xy'].includes(value.mode) || !['value', 'phase'].includes(value.axis))
      throw new Error('波形标记的模式或坐标类型不正确。');
    if (
      typeof value.analysisKey !== 'string' ||
      !/^(?:dc|transient|ac|sweep:[A-Za-z][A-Za-z0-9_-]{0,39}:[A-Za-z][A-Za-z0-9_]{0,39})$/.test(
        value.analysisKey,
      )
    )
      throw new Error('波形标记的分析类型不正确。');
    if (
      (value.mode === 'xt' && value.xTraceId !== null) ||
      (value.mode === 'xy' && (value.axis !== 'value' || !validTraceId(value.xTraceId))) ||
      (value.axis === 'phase' && (value.mode !== 'xt' || value.analysisKey !== 'ac'))
    )
      throw new Error('X–Y 标记需要横轴曲线；相位标记仅支持交流 X–T 图像。');
    return {
      id: value.id,
      traceId: value.traceId,
      at,
      text: value.text,
      mode: value.mode,
      axis: value.axis,
      xTraceId: value.xTraceId,
      analysisKey: value.analysisKey,
      ...(Object.hasOwn(value, 'marker') ? { marker: value.marker } : {}),
    };
  }
  function normalizeDisplay(value = {}) {
    function object(item, fields, label) {
      if (
        !item ||
        typeof item !== 'object' ||
        Array.isArray(item) ||
        Object.keys(item).some((key) => !fields.includes(key))
      )
        throw new Error(`${label}格式不正确或含有不支持的字段。`);
    }
    object(
      value,
      [
        'version',
        'mode',
        'traceIds',
        'ch1',
        'ch2',
        'xyX',
        'xyY',
        'math',
        'phase',
        'ranges',
        'annotations',
      ],
      '图像设置',
    );
    if (value.version !== undefined && value.version !== 1)
      throw new Error('图像设置版本必须为 1。');
    const mode = value.mode ?? 'xt';
    if (!['xt', 'xy'].includes(mode)) throw new Error('图像模式只能为 xt 或 xy。');
    const traceIds = value.traceIds ?? [];
    if (
      !Array.isArray(traceIds) ||
      traceIds.length > 32 ||
      traceIds.some((id) => !validTraceId(id)) ||
      new Set(traceIds).size !== traceIds.length
    )
      throw new Error('图像曲线列表必须包含至多 32 个不重复的有效曲线 ID。');
    const channels = {};
    for (const key of ['ch1', 'ch2', 'xyX', 'xyY']) {
      const id = value[key] ?? null;
      if (id !== null && !validTraceId(id)) throw new Error(`${key} 曲线 ID 不正确。`);
      channels[key] = id;
    }
    const suppliedMath = value.math ?? [];
    if (!Array.isArray(suppliedMath) || suppliedMath.length > 8)
      throw new Error('最多设置 8 条数学曲线。');
    const mathIds = new Set();
    const math = suppliedMath.map((item) => {
      object(item, ['id', 'label', 'expression', 'unit'], '数学曲线');
      if (typeof item.id !== 'string' || !/^M[1-8]$/.test(item.id) || mathIds.has(item.id))
        throw new Error('数学曲线 ID 必须是 M1 至 M8 且不可重复。');
      mathIds.add(item.id);
      if (
        typeof item.expression !== 'string' ||
        !item.expression.trim() ||
        item.expression.length > 160
      )
        throw new Error('数学表达式必须为 1 至 160 个字符。');
      const label = item.label ?? item.id;
      const unit = item.unit ?? '';
      if (
        typeof label !== 'string' ||
        label.length > 40 ||
        typeof unit !== 'string' ||
        unit.length > 12
      )
        throw new Error('数学曲线名称最多 40 字符，单位最多 12 字符。');
      return { id: item.id, label, expression: item.expression, unit };
    });
    const phase = value.phase ?? false;
    if (typeof phase !== 'boolean') throw new Error('相位显示设置必须为布尔值。');
    const suppliedRanges = value.ranges ?? {};
    object(suppliedRanges, ['xMin', 'xMax', 'yMin', 'yMax'], '坐标范围');
    const ranges = {};
    for (const key of ['xMin', 'xMax', 'yMin', 'yMax'])
      ranges[key] = suppliedRanges[key] == null ? null : finite(suppliedRanges[key], key);
    for (const axis of ['x', 'y'])
      if (
        ranges[`${axis}Min`] !== null &&
        ranges[`${axis}Max`] !== null &&
        ranges[`${axis}Min`] >= ranges[`${axis}Max`]
      )
        throw new Error('坐标范围下限必须小于上限。');
    const annotations = {};
    if (value.annotations !== undefined) {
      if (!Array.isArray(value.annotations) || value.annotations.length > 32)
        throw new Error('每张图像最多设置 32 个波形标记。');
      annotations.annotations = value.annotations.map(normalizeAnnotation);
      if (new Set(annotations.annotations.map((item) => item.id)).size !== value.annotations.length)
        throw new Error('波形标记 ID 不可重复。');
    }
    return {
      version: 1,
      mode,
      traceIds: [...traceIds],
      ...channels,
      math,
      phase,
      ranges,
      ...annotations,
    };
  }
  function validateDocument(document) {
    if (
      !document ||
      typeof document !== 'object' ||
      Array.isArray(document) ||
      document.version !== 1
    )
      throw new Error('电路文档必须采用 version: 1 格式。');
    if (!Array.isArray(document.components) || !Array.isArray(document.wires))
      throw new Error('电路文档缺少元件或导线列表。');
    if (document.components.length > 80 || document.wires.length > 200)
      throw new Error('每个电路最多 80 个元件、200 条导线。');
    const ids = new Set();
    const components = document.components.map((component) => {
      if (
        !component ||
        typeof component !== 'object' ||
        !validId(component.id) ||
        ids.has(component.id)
      )
        throw new Error(
          '元件 ID 必须唯一，以英文字母开头，仅包含英文字母、数字、下划线和连字符，最长 40 字符。',
        );
      if (typeof component.type !== 'string' || !Object.hasOwn(catalog, component.type))
        throw new Error(`未知元件类型：${String(component.type).slice(0, 40)}。`);
      ids.add(component.id);
      const x = finite(component.x ?? 0, '元件横坐标');
      const y = finite(component.y ?? 0, '元件纵坐标');
      const rotation = component.rotation ?? 0;
      if (Math.abs(x) > 100000 || Math.abs(y) > 100000 || ![0, 90, 180, 270].includes(rotation))
        throw new Error('元件坐标超出画布范围，或旋转角度不是 0/90/180/270。');
      const mirrors = {};
      for (const axis of ['mirrorX', 'mirrorY']) {
        if (!Object.hasOwn(component, axis)) continue;
        if (typeof component[axis] !== 'boolean') throw new Error('元件镜像设置必须为布尔值。');
        mirrors[axis] = component[axis];
      }
      return {
        id: component.id,
        type: component.type,
        x,
        y,
        rotation,
        ...mirrors,
        params: validateParameters(component),
      };
    });
    const componentById = new Map(components.map((component) => [component.id, component]));
    const wireIds = new Set();
    function endpoint(value) {
      const component =
        value && typeof value.componentId === 'string' && componentById.get(value.componentId);
      if (
        !component ||
        !Number.isInteger(value.pin) ||
        value.pin < 0 ||
        value.pin >= catalog[component.type].pins.length
      )
        throw new Error('导线连接了不存在的元件或引脚。');
      return { componentId: component.id, pin: value.pin };
    }
    const wires = document.wires.map((wire) => {
      if (!wire || !validId(wire.id) || wireIds.has(wire.id))
        throw new Error('导线 ID 必须唯一且为有效标识符。');
      wireIds.add(wire.id);
      const from = endpoint(wire.from);
      const to = endpoint(wire.to);
      if (from.componentId === to.componentId && from.pin === to.pin)
        throw new Error('导线两端不能是同一个引脚。');
      let points;
      if (wire.points !== undefined) {
        if (!Array.isArray(wire.points) || wire.points.length > 32)
          throw new Error('每条导线最多包含 32 个中间拐点，points 必须为数组。');
        points = wire.points.map((point) => {
          if (!point || typeof point !== 'object' || Array.isArray(point))
            throw new Error('导线拐点必须包含数值坐标 x 和 y。');
          const x = finite(point.x, '导线拐点横坐标');
          const y = finite(point.y, '导线拐点纵坐标');
          if (Math.abs(x) > 100000 || Math.abs(y) > 100000)
            throw new Error('导线拐点坐标超出画布范围。');
          return { x, y };
        });
      }
      return { id: wire.id, from, to, ...(points === undefined ? {} : { points }) };
    });
    return {
      version: 1,
      components,
      wires,
      analysis: normalizeAnalysis(document.analysis || { type: 'dc' }, components),
      ...(document.display === undefined ? {} : { display: normalizeDisplay(document.display) }),
    };
  }
  function normalizedSourceAdvice(document, analysis) {
    const sources = document.components.filter(
      ({ type, params }) =>
        ['voltage', 'current'].includes(type) &&
        ['sine', 'pulse'].includes(params.waveform) &&
        params.amplitude !== 0,
    );
    const warnings = [];
    if (!sources.length) return { warnings, suggestedAnalysis: null };
    const concise = (number) => Number(number.toPrecision(4));
    const fastestPeriod = 1 / Math.max(...sources.map(({ params }) => params.frequency));
    const requiredStep = Math.min(
      ...sources.map(({ params }) =>
        Math.min(
          1 / (100 * params.frequency),
          params.waveform === 'pulse'
            ? Math.min(params.duty, 1 - params.duty) / (10 * params.frequency)
            : Infinity,
        ),
      ),
    );
    const lastDelay = Math.max(...sources.map(({ params }) => params.delay));
    if (['dc', 'sweep'].includes(analysis.type))
      warnings.push(
        `${sources.map(({ id }) => id).join('、')} 设置了周期波形，但当前为直流${analysis.type === 'sweep' ? '扫描' : '工作点'}分析，只使用电源的直流偏置；请使用瞬态分析查看随时间变化的波形。`,
      );
    if (analysis.type === 'transient') {
      for (const { id, params } of sources) {
        const samples = 1 / (params.frequency * analysis.step);
        if (samples < 100 * (1 - 1e-12))
          warnings.push(
            `${id} 的 ${concise(params.frequency)} Hz 波形每周期仅 ${concise(samples)} 个采样点，可能混叠成直线或失真；建议每周期至少 100 点，步长不超过 ${concise(1 / (100 * params.frequency))} s。`,
          );
        if (
          params.waveform === 'pulse' &&
          samples * Math.min(params.duty, 1 - params.duty) < 10 * (1 - 1e-12)
        )
          warnings.push(
            `${id} 的脉冲高电平或低电平过窄，当前步长可能漏掉脉冲；建议每段至少 10 个采样点。`,
          );
        if (params.delay >= analysis.stop)
          warnings.push(`${id} 的启动延迟不小于仿真截止时间，当前窗口无法观察周期波形。`);
        else if (analysis.stop - params.delay < (1 / params.frequency) * (1 - 1e-12))
          warnings.push(`${id} 在当前窗口内不足一个完整周期，请延长截止时间。`);
      }
    }
    const initial = analysis.type === 'transient' ? analysis.initial : 'zero';
    let step = requiredStep;
    const pointCount = (stop) => Math.ceil(stop / step - 1e-10) + 1;
    let stop;
    if (
      analysis.type === 'transient' &&
      analysis.stop - lastDelay >= fastestPeriod * (1 - 1e-12) &&
      pointCount(analysis.stop) <= limits.maxTransientPoints
    ) {
      stop = analysis.stop;
      step = Math.min(analysis.step, requiredStep);
    } else {
      const maximumStop = step * (limits.maxTransientPoints - 1);
      if (maximumStop - lastDelay < fastestPeriod * (1 - 1e-12)) {
        warnings.push(
          `无法在 ${limits.maxTransientPoints} 个采样点内兼顾电源延迟和所需采样密度；请缩短启动延迟或降低最高频率后再设置瞬态分析。`,
        );
        return { warnings, suggestedAnalysis: null };
      }
      stop = Math.min(lastDelay + 10 * fastestPeriod, maximumStop);
    }
    const incomplete = sources.filter(
      ({ params }) => stop - params.delay < (1 / params.frequency) * (1 - 1e-12),
    );
    if (incomplete.length)
      warnings.push(
        `建议窗口按最快电源设置，${incomplete.map(({ id }) => id).join('、')} 的较慢波形仍不足一个完整周期；如需观察这些电源，请在采样点上限内延长截止时间。`,
      );
    return {
      warnings,
      suggestedAnalysis: normalizeAnalysis(
        { type: 'transient', stop, step, initial },
        document.components,
      ),
    };
  }
  function sourceAnalysisAdvice(input, options) {
    const document = validateDocument(input);
    const analysis = normalizeAnalysis(options || document.analysis, document.components);
    return normalizedSourceAdvice(document, analysis);
  }
  function playbackFrameStep(input, result, { duration = 8000, frameInterval = 50 } = {}) {
    const document = validateDocument(input);
    if (!result || result.analysis?.type !== 'transient' || !result.x?.length) return 1;
    if (
      !Number.isFinite(duration) ||
      duration <= 0 ||
      !Number.isFinite(frameInterval) ||
      frameInterval < 0
    )
      throw new Error('回放时长必须大于 0，帧间隔必须为非负有限数值。');
    const samples = (result.x.length * frameInterval) / duration;
    const frequencies = document.components
      .filter(
        ({ type, params }) =>
          ['voltage', 'current'].includes(type) &&
          ['sine', 'pulse'].includes(params.waveform) &&
          params.amplitude !== 0,
      )
      .map(({ params }) => params.frequency);
    if (!frequencies.length) return samples;
    return Math.min(
      samples,
      Math.max(1, Math.floor(1 / (20 * Math.max(...frequencies) * result.analysis.step))),
    );
  }
  function netsFor(document) {
    const parent = new Map();
    const key = (endpoint) => `${endpoint.componentId}:${endpoint.pin}`;
    document.components.forEach((component) =>
      catalog[component.type].pins.forEach((_, index) =>
        parent.set(`${component.id}:${index}`, `${component.id}:${index}`),
      ),
    );
    function find(pin) {
      let result = pin;
      while (parent.get(result) !== result) result = parent.get(result);
      let current = pin;
      while (parent.get(current) !== current) {
        const next = parent.get(current);
        parent.set(current, result);
        current = next;
      }
      return result;
    }
    const join = (a, b) => parent.set(find(a), find(b));
    document.wires.forEach((wire) => join(key(wire.from), key(wire.to)));
    // Rail names identify global nets; their names do not prescribe a voltage.
    for (const type of powerRails) {
      const rails = document.components.filter((component) => component.type === type);
      rails.slice(1).forEach((component) => join(`${component.id}:0`, `${rails[0].id}:0`));
    }
    const grounds = document.components.filter((component) => component.type === 'ground');
    grounds.slice(1).forEach((component) => join(`${component.id}:0`, `${grounds[0].id}:0`));
    const groundRoot = grounds.length ? find(`${grounds[0].id}:0`) : null;
    const names = new Map();
    if (groundRoot) names.set(groundRoot, '0');
    const pinNets = {};
    let next = 1;
    for (const pin of parent.keys()) {
      const representative = find(pin);
      if (!names.has(representative)) {
        names.set(representative, `n${next}`);
        next += 1;
      }
      pinNets[pin] = names.get(representative);
    }
    return { pinNets, nets: [...names.values()], ground: '0' };
  }
  function buildNets(document) {
    return netsFor(validateDocument(document));
  }

  const branchTypes = new Set([
    'voltage',
    'ammeter',
    'capacitor',
    'inductor',
    'vcvs',
    'ccvs',
    'opamp',
  ]);
  const nonlinearTypes = new Set(['diode', 'bjt', 'mosfet', 'nonlinear']);
  function compile(document) {
    if (
      !document.components.some((component) => ['ground', 'fixed_voltage'].includes(component.type))
    )
      throw new Error('电路缺少参考地；请放置参考地并连接电源或公共节点。');
    if (!document.components.some((component) => !netSymbols.includes(component.type)))
      throw new Error('请先添加元件并连接电路。');
    const nets = netsFor(document);
    const electricalComponents = document.components.filter(
      (component) => !netSymbols.includes(component.type),
    );
    const electricalNets = new Set(
      electricalComponents.flatMap((component) =>
        catalog[component.type].pins.map((_, pin) => nets.pinNets[`${component.id}:${pin}`]),
      ),
    );
    const unknownNets = nets.nets.filter((net) => net !== '0' && electricalNets.has(net));
    const indices = new Map(unknownNets.map((net, index) => [net, index]));
    let dimension = unknownNets.length;
    const components = electricalComponents.map((component) => {
      const pins = catalog[component.type].pins.map(
        (_, pin) => indices.get(nets.pinNets[`${component.id}:${pin}`]) ?? -1,
      );
      // A fixed level is an ideal DC source whose return is the implicit reference.
      const compiled =
        component.type === 'fixed_voltage'
          ? {
              ...component,
              type: 'voltage',
              pins: [...pins, -1],
              params: { ...sourceDefaults, ...component.params, acAmplitude: 0 },
              branch: -1,
            }
          : { ...component, pins, branch: -1 };
      if (branchTypes.has(compiled.type) || component.type === 'twoport') {
        compiled.branch = dimension;
        dimension += component.type === 'twoport' ? 2 : 1;
      }
      if (component.type === 'nonlinear')
        compiled.expression = parseExpression(component.params.expression);
      return compiled;
    });
    const byId = new Map(components.map((component) => [component.id, component]));
    components.forEach((component) => {
      if (component.type === 'cccs' || component.type === 'ccvs') {
        const control = byId.get(component.params.control);
        if (!control || !['voltage', 'ammeter'].includes(control.type))
          throw new Error(`${component.id} 的控制电流须选择已有电压源或串联电流表的 ID。`);
        component.controlBranch = control.branch;
      }
    });
    if (dimension > 120) throw new Error('电路包含超过 120 个待求节点/支路，建议拆分为较小电路。');
    return {
      components,
      dimension,
      nets,
      unknownNets,
      nonlinear: components.some(
        (component) => nonlinearTypes.has(component.type) || component.type === 'opamp',
      ),
    };
  }
  const voltageAt = (solution, pin) => (pin < 0 ? 0 : solution[pin]);
  function sourceValue(params, context) {
    if (context.kind === 'dc') return params.dc * (context.sourceScale ?? 1);
    const time = context.time - params.delay;
    if (params.waveform === 'dc' || time < 0) return params.dc;
    const cycle = time * params.frequency + params.phase / 360;
    if (params.waveform === 'sine')
      return params.dc + params.amplitude * Math.sin(2 * Math.PI * cycle);
    return params.dc + (cycle - Math.floor(cycle) < params.duty ? params.amplitude : 0);
  }
  function shockleyCurrent(saturationCurrent, exponent) {
    // Evaluate the actual Shockley law, including large but finite forward
    // currents. Log-domain multiplication avoids exp(exponent) overflowing
    // before multiplication by a very small saturation current.
    if (exponent > 40) return Math.exp(Math.log(saturationCurrent) + exponent) - saturationCurrent;
    return saturationCurrent * Math.expm1(exponent);
  }
  function terminalCurrents(component, voltages) {
    const p = component.params;
    if (component.type === 'diode') {
      const current = shockleyCurrent(p.is, (voltages[0] - voltages[1]) / (p.n * p.thermalVoltage));
      return [current, -current];
    }
    if (component.type === 'nonlinear') {
      const current = component.expression(voltages[0] - voltages[1], p.k);
      return [current, -current];
    }
    if (component.type === 'bjt') {
      const sign = p.polarity === 'pnp' ? -1 : 1;
      const forward = shockleyCurrent(
        p.is,
        (sign * (voltages[1] - voltages[2])) / p.thermalVoltage,
      );
      const reverse = shockleyCurrent(
        p.is,
        (sign * (voltages[1] - voltages[0])) / p.thermalVoltage,
      );
      const collector = sign * (forward - reverse * (1 + 1 / p.betaReverse));
      const base = sign * (forward / p.beta + reverse / p.betaReverse);
      return [collector, base, -collector - base];
    }
    if (component.type === 'mosfet') {
      const sign = p.polarity === 'p' ? -1 : 1;
      const reversed = sign * (voltages[0] - voltages[2]) < 0;
      const source = reversed ? voltages[0] : voltages[2];
      const drain = reversed ? voltages[2] : voltages[0];
      const vds = sign * (drain - source);
      const vgs = sign * (voltages[1] - source);
      const threshold = p.polarity === 'p' ? Math.abs(p.vto) : p.vto;
      const overdrive = vgs - threshold;
      let current = 0;
      if (overdrive > 0)
        current =
          ((p.kp * p.w) / p.l) *
          (vds < overdrive ? overdrive * vds - (vds * vds) / 2 : (overdrive * overdrive) / 2) *
          (1 + p.lambda * vds);
      current *= sign * (reversed ? -1 : 1);
      return [current, 0, -current];
    }
    throw new Error(`无法计算 ${component.id} 的非线性模型。`);
  }
  function deviceLinearization(component, voltages) {
    const currents = terminalCurrents(component, voltages);
    const derivatives = voltages.map((value, pin) => {
      const step = 1e-6 * Math.max(1, Math.abs(value));
      const plus = [...voltages];
      plus[pin] += step;
      const minus = [...voltages];
      minus[pin] -= step;
      let a;
      let b;
      try {
        a = terminalCurrents(component, plus);
      } catch {
        a = null;
      }
      try {
        b = terminalCurrents(component, minus);
      } catch {
        b = null;
      }
      if (!a && !b)
        throw new Error(`${component.id} 的伏安公式在工作点附近没有有效定义域，无法线性化。`);
      return currents.map((current, terminal) => {
        if (a && b) return (a[terminal] - b[terminal]) / (2 * step);
        return a ? (a[terminal] - current) / step : (current - b[terminal]) / step;
      });
    });
    return { currents, derivatives };
  }
  // Both currents enter their positive port terminals. ABCD uses [V2, -I2].
  // Definitions: Analog Devices, university/courses/alm1k/circuits1/alm-cir-two-port-network.
  // Stamp the two defining equations directly, so singular conversion matrices remain usable.
  function twoportRows(params, imaginary = false) {
    const prefix = imaginary ? 'i' : 'm';
    const [a, b, c, d] = ['11', '12', '21', '22'].map((key) => params[`${prefix}${key}`]);
    const one = imaginary ? 0 : 1;
    if (params.parameterSet === 'Z')
      return [
        [one, 0, -a, -b],
        [0, one, -c, -d],
      ];
    if (params.parameterSet === 'Y')
      return [
        [-a, -b, one, 0],
        [-c, -d, 0, one],
      ];
    if (params.parameterSet === 'H')
      return [
        [one, -b, -a, 0],
        [0, -d, -c, one],
      ];
    if (params.parameterSet === 'G')
      return [
        [-a, 0, one, -b],
        [-c, one, 0, -d],
      ];
    return [
      [one, -a, 0, b],
      [0, -c, one, d],
    ];
  }
  function stampTwoport(component, add, imaginary = false) {
    const { branch, pins } = component;
    twoportRows(component.params, imaginary).forEach((coefficients, index) => {
      const row = branch + index;
      add(row, pins[0], coefficients[0]);
      add(row, pins[1], -coefficients[0]);
      add(row, pins[2], coefficients[1]);
      add(row, pins[3], -coefficients[1]);
      add(row, branch, coefficients[2]);
      add(row, branch + 1, coefficients[3]);
    });
  }
  function assemble(system, solution, context) {
    const n = system.dimension;
    const matrix = new Float64Array(n * n);
    const residual = new Float64Array(n);
    const tolerance = new Float64Array(n).fill(1e-10);
    const add = (row, column, value) => {
      if (row >= 0 && column >= 0) matrix[row * n + column] += value;
    };
    const inject = (pin, value) => {
      if (pin >= 0) residual[pin] += value;
    };
    const v = (pin) => voltageAt(solution, pin);
    function conductance(a, b, value) {
      const current = value * (v(a) - v(b));
      inject(a, current);
      inject(b, -current);
      add(a, a, value);
      add(a, b, -value);
      add(b, a, -value);
      add(b, b, value);
    }
    for (const component of system.components) {
      const { type, pins, params: p, branch } = component;
      const [a, b] = pins;
      if (type === 'twoport') {
        [0, 1].forEach((port) => {
          const currentIndex = branch + port;
          inject(pins[2 * port], solution[currentIndex]);
          inject(pins[2 * port + 1], -solution[currentIndex]);
          add(pins[2 * port], currentIndex, 1);
          add(pins[2 * port + 1], currentIndex, -1);
        });
        stampTwoport(component, (row, column, coefficient) => {
          add(row, column, coefficient);
          if (column >= 0) residual[row] += coefficient * solution[column];
        });
        tolerance[branch] = ['Y', 'G'].includes(p.parameterSet) ? 1e-10 : 1e-8;
        tolerance[branch + 1] = ['Y', 'H', 'ABCD'].includes(p.parameterSet) ? 1e-10 : 1e-8;
        continue;
      }
      if (type === 'resistor') conductance(a, b, 1 / p.resistance);
      else if (type === 'current') {
        const current = sourceValue(p, context);
        inject(a, current);
        inject(b, -current);
      } else if (type === 'vccs') {
        const current = p.gain * (v(pins[2]) - v(pins[3]));
        inject(a, current);
        inject(b, -current);
        add(a, pins[2], p.gain);
        add(a, pins[3], -p.gain);
        add(b, pins[2], -p.gain);
        add(b, pins[3], p.gain);
      } else if (type === 'cccs') {
        const current = p.gain * solution[component.controlBranch];
        inject(a, current);
        inject(b, -current);
        add(a, component.controlBranch, p.gain);
        add(b, component.controlBranch, -p.gain);
      } else if (nonlinearTypes.has(type)) {
        const model = deviceLinearization(component, pins.map(v));
        pins.forEach((pin, terminal) => {
          inject(pin, model.currents[terminal]);
          pins.forEach((controlPin, control) =>
            add(pin, controlPin, model.derivatives[control][terminal]),
          );
        });
      }
      if (branch < 0) continue;
      const outputA = type === 'opamp' ? pins[2] : a;
      const outputB = type === 'opamp' ? -1 : b;
      inject(outputA, solution[branch]);
      inject(outputB, -solution[branch]);
      add(outputA, branch, 1);
      add(outputB, branch, -1);
      tolerance[branch] = 1e-8;
      if (type === 'capacitor') {
        if (context.kind === 'initial') {
          residual[branch] = v(a) - v(b);
          add(branch, a, 1);
          add(branch, b, -1);
        } else if (context.kind === 'transient') {
          const g = p.capacitance / context.step;
          const priorVoltage = voltageAt(context.previous, a) - voltageAt(context.previous, b);
          residual[branch] = solution[branch] - g * (v(a) - v(b) - priorVoltage);
          add(branch, branch, 1);
          add(branch, a, -g);
          add(branch, b, g);
          tolerance[branch] = 1e-10;
        } else {
          residual[branch] = solution[branch];
          add(branch, branch, 1);
          tolerance[branch] = 1e-10;
        }
      } else if (type === 'inductor' && context.kind === 'initial') {
        residual[branch] = solution[branch];
        add(branch, branch, 1);
        tolerance[branch] = 1e-10;
      } else {
        residual[branch] = v(outputA) - v(outputB);
        add(branch, outputA, 1);
        add(branch, outputB, -1);
        if (type === 'voltage') residual[branch] -= sourceValue(p, context);
        else if (type === 'vcvs') {
          residual[branch] -= p.gain * (v(pins[2]) - v(pins[3]));
          add(branch, pins[2], -p.gain);
          add(branch, pins[3], p.gain);
        } else if (type === 'ccvs') {
          residual[branch] -= p.gain * solution[component.controlBranch];
          add(branch, component.controlBranch, -p.gain);
        } else if (type === 'inductor' && context.kind === 'transient') {
          const resistance = p.inductance / context.step;
          residual[branch] -= resistance * (solution[branch] - context.previous[branch]);
          add(branch, branch, -resistance);
        } else if (type === 'opamp') {
          const idealOutput = p.gain * (v(a) - v(b));
          residual[branch] -= Math.max(p.railNegative, Math.min(p.railPositive, idealOutput));
          if (idealOutput > p.railNegative && idealOutput < p.railPositive) {
            add(branch, a, -p.gain);
            add(branch, b, p.gain);
          }
        }
      }
    }
    if (context.startupConductance) {
      // Temporary shunts make an all-off transistor initial Jacobian solvable.
      // They are used only to find an initial guess, never in a returned result.
      for (let pin = 0; pin < system.unknownNets.length; pin += 1)
        conductance(pin, -1, context.startupConductance);
    }
    if (
      matrix.some((value) => !Number.isFinite(value)) ||
      residual.some((value) => !Number.isFinite(value))
    )
      throw new Error('模型计算溢出；请检查元件参数、公式和电源幅度。');
    return { matrix, residual, tolerance };
  }
  function solveReal(input, rhs) {
    const n = rhs.length;
    const a = new Float64Array(input);
    const b = new Float64Array(rhs);
    for (let row = 0; row < n; row += 1) {
      let scale = 0;
      for (let col = 0; col < n; col += 1) scale = Math.max(scale, Math.abs(a[row * n + col]));
      if (!scale)
        throw new Error('电路无法求解：存在浮空节点、未连接的控制端，或理想电源/电感回路冲突。');
      for (let col = 0; col < n; col += 1) a[row * n + col] /= scale;
      b[row] /= scale;
    }
    for (let pivot = 0; pivot < n; pivot += 1) {
      let best = pivot;
      for (let row = pivot + 1; row < n; row += 1)
        if (Math.abs(a[row * n + pivot]) > Math.abs(a[best * n + pivot])) best = row;
      if (Math.abs(a[best * n + pivot]) < 1e-14)
        throw new Error(
          '电路矩阵奇异：请检查浮空节点、理想电压源并联及电感回路；必要时添加实际串联/并联电阻。',
        );
      if (best !== pivot) {
        for (let col = pivot; col < n; col += 1) {
          const value = a[pivot * n + col];
          a[pivot * n + col] = a[best * n + col];
          a[best * n + col] = value;
        }
        const value = b[pivot];
        b[pivot] = b[best];
        b[best] = value;
      }
      for (let row = pivot + 1; row < n; row += 1) {
        const factor = a[row * n + pivot] / a[pivot * n + pivot];
        if (!factor) continue;
        a[row * n + pivot] = 0;
        for (let col = pivot + 1; col < n; col += 1)
          a[row * n + col] -= factor * a[pivot * n + col];
        b[row] -= factor * b[pivot];
      }
    }
    const result = new Float64Array(n);
    for (let row = n - 1; row >= 0; row -= 1) {
      let value = b[row];
      for (let col = row + 1; col < n; col += 1) value -= a[row * n + col] * result[col];
      result[row] = value / a[row * n + row];
      finite(result[row], '求解结果（可能存在浮空节点或不合理参数）');
    }
    return result;
  }
  const merit = (assembled, excludedRows) =>
    assembled.residual.reduce(
      (maximum, value, index) =>
        excludedRows?.has(index)
          ? maximum
          : Math.max(maximum, Math.abs(value) / assembled.tolerance[index]),
      0,
    );
  function seedKnownVoltages(system, context, solution) {
    // Independent ideal sources connected to reference ground (possibly through
    // other ideal sources) determine these voltages exactly. Starting them at
    // that value avoids damping an already known voltage while trying to fit
    // an exponential device's otherwise freely adjustable source current.
    const known = new Map([[-1, 0]]);
    const sources = system.components.filter((component) => component.type === 'voltage');
    for (let pass = 0; pass < sources.length; pass += 1) {
      let changed = false;
      for (const component of sources) {
        const [a, b] = component.pins;
        const voltage = sourceValue(component.params, context);
        if (known.has(a) && !known.has(b)) {
          known.set(b, known.get(a) - voltage);
          changed = true;
        } else if (known.has(b) && !known.has(a)) {
          known.set(a, known.get(b) + voltage);
          changed = true;
        }
      }
      if (!changed) break;
    }
    for (const [pin, voltage] of known) if (pin >= 0) solution[pin] = voltage;
    return known;
  }
  function newton(system, context, initial) {
    let solution = new Float64Array(initial || system.dimension);
    const knownVoltages = seedKnownVoltages(system, context, solution);
    for (let iteration = 0; iteration < 100; iteration += 1) {
      const assembled = assemble(system, solution, context);
      // Factor even an apparently satisfied first state: a zero-source floating
      // network is not a valid solution merely because its residual is zero.
      const delta = solveReal(
        assembled.matrix,
        assembled.residual.map((value) => -value),
      );
      const currentMerit = merit(assembled);
      // Current through an independent ideal voltage source is a free unknown.
      // Its KCL row must converge in the final solution, but should not prevent
      // a trial junction-voltage update: that source current can be corrected
      // directly on the following Newton step.
      const currentSearchMerit = merit(assembled, knownVoltages);
      // A small KCL residual alone can hide a large voltage error in a
      // high-impedance circuit. Require both the equations and the proposed
      // voltage/current correction to have converged, without adding gmin.
      const currentSolution = solution;
      const updateConverged = delta.every((change, index) => {
        const absoluteTolerance = index < system.unknownNets.length ? 1e-8 : 1e-12;
        return Math.abs(change) <= absoluteTolerance + 1e-8 * Math.abs(currentSolution[index]);
      });
      if (currentMerit <= 1 && updateConverged) return solution;
      let damping = 1;
      if (system.nonlinear) {
        for (const component of system.components) {
          let pairs = [];
          let maximum = 0.15;
          if (component.type === 'diode') pairs = [[0, 1]];
          if (component.type === 'bjt')
            pairs = [
              [1, 0],
              [1, 2],
            ];
          if (component.type === 'nonlinear') {
            pairs = [[0, 1]];
            maximum = 0.5;
          }
          for (const [a, b] of pairs) {
            const change = Math.abs(
              voltageAt(delta, component.pins[a]) - voltageAt(delta, component.pins[b]),
            );
            if (change > maximum) damping = Math.min(damping, maximum / change);
          }
        }
      }
      let accepted = false;
      for (let attempt = 0; attempt < 18; attempt += 1) {
        const trialDamping = damping;
        const candidate = solution.map((value, index) => value + trialDamping * delta[index]);
        try {
          const nextMerit = merit(assemble(system, candidate, context), knownVoltages);
          if (nextMerit <= 1 || nextMerit < currentSearchMerit * (1 - 1e-5 * damping)) {
            solution = candidate;
            accepted = true;
            break;
          }
        } catch {
          /* A trial outside a formula's domain is retried at a shorter step. */
        }
        damping /= 2;
      }
      if (!accepted)
        throw new Error(
          '非线性迭代未收敛；请检查接线、公式定义域及参数，或减小电源幅度/瞬态步长。',
        );
    }
    throw new Error('超过 100 次非线性迭代仍未收敛；请检查元件偏置、公式或减小时间步长。');
  }
  function solvePoint(system, context, initial) {
    try {
      return newton(system, context, initial);
    } catch (original) {
      if (!system.nonlinear || context.kind !== 'dc') throw original;
      try {
        let solution = newton(system, { ...context, sourceScale: 0 });
        for (let step = 1; step <= 20; step += 1)
          solution = newton(system, { ...context, sourceScale: step / 20 }, solution);
        return solution;
      } catch {
        try {
          // Source stepping alone cannot start a current-fed MOS network: at
          // zero bias every channel is off, including when all sources are zero.
          // Remove the temporary conductances progressively, then solve the
          // unmodified equations again. Floating circuits must still fail there.
          let solution = newton(system, { ...context, startupConductance: 1e-3 });
          let exponent = -3;
          let step = 1;
          for (let attempt = 0; exponent > -12 && attempt < 64; attempt += 1) {
            const next = Math.max(-12, exponent - step);
            try {
              solution = newton(system, { ...context, startupConductance: 10 ** next }, solution);
              exponent = next;
              step = Math.min(1, step * 1.5);
            } catch (error) {
              // Region transitions can need smaller continuation steps even
              // though nearby points all have a valid operating point.
              step /= 2;
              if (step < 1 / 1024) throw error;
            }
          }
          if (exponent > -12) throw original;
          return newton(system, context, solution);
        } catch {
          throw original;
        }
      }
    }
  }
  function voltagePair(component) {
    if (component.type === 'opamp') return [component.pins[2], -1];
    if (['bjt', 'mosfet'].includes(component.type)) return [component.pins[0], component.pins[2]];
    return component.pins.slice(0, 2);
  }
  function componentCurrent(component, solution, context) {
    if (component.branch >= 0) return solution[component.branch];
    const v = (pin) => voltageAt(solution, pin);
    const { pins, params: p, type } = component;
    if (type === 'resistor') return (v(pins[0]) - v(pins[1])) / p.resistance;
    if (type === 'current') return sourceValue(p, context);
    if (type === 'vccs') return p.gain * (v(pins[2]) - v(pins[3]));
    if (type === 'cccs') return p.gain * solution[component.controlBranch];
    if (nonlinearTypes.has(type)) return terminalCurrents(component, pins.map(v))[0];
    return 0;
  }
  function frameFor(system, solution, context) {
    const voltages = { 0: 0 };
    system.unknownNets.forEach((net, index) => {
      voltages[net] = finite(solution[index], '节点电压');
    });
    const currents = {};
    system.components.forEach((component) => {
      currents[component.id] = finite(
        componentCurrent(component, solution, context),
        `${component.id} 电流`,
      );
      if (component.type === 'twoport')
        currents[`${component.id}:P2`] = finite(
          solution[component.branch + 1],
          `${component.id} P2 电流`,
        );
    });
    return { voltages, currents };
  }
  function emptyResult(system, analysis) {
    const labels = {
      dc: ['工作点', ''],
      transient: ['时间', 's'],
      sweep: [`${analysis.componentId}.${analysis.parameter}`, ''],
      ac: ['频率', 'Hz'],
    };
    const [xLabel, xUnit] = labels[analysis.type];
    const traces = system.components.flatMap((component) =>
      traceDescriptors(component).map((descriptor) => ({
        ...descriptor,
        values: [],
        ...(analysis.type === 'ac' ? { phase: [] } : {}),
      })),
    );
    return { analysis, x: [], xLabel, xUnit, traces, frames: [], warnings: [] };
  }
  function appendTimeResult(result, system, solution, context, x) {
    result.x.push(x);
    result.frames.push(frameFor(system, solution, context));
    let traceIndex = 0;
    function nextTrace() {
      const trace = result.traces[traceIndex];
      traceIndex += 1;
      return trace;
    }
    system.components.forEach((component) => {
      const [a, b] = voltagePair(component);
      nextTrace().values.push(
        finite(voltageAt(solution, a) - voltageAt(solution, b), `${component.id} 电压`),
      );
      nextTrace().values.push(result.frames.at(-1).currents[component.id]);
      if (['twoport', 'oscilloscope2'].includes(component.type)) {
        nextTrace().values.push(
          finite(
            voltageAt(solution, component.pins[2]) - voltageAt(solution, component.pins[3]),
            `${component.id} 第二通道电压`,
          ),
        );
        if (component.type === 'twoport')
          nextTrace().values.push(result.frames.at(-1).currents[`${component.id}:P2`]);
      }
    });
  }

  function sourcePhasor(params) {
    const angle = (params.phase * Math.PI) / 180;
    return [params.acAmplitude * Math.cos(angle), params.acAmplitude * Math.sin(angle)];
  }
  function solveComplex(realInput, imaginaryInput, realRhs, imaginaryRhs) {
    const n = realRhs.length;
    const re = new Float64Array(realInput);
    const im = new Float64Array(imaginaryInput);
    const br = new Float64Array(realRhs);
    const bi = new Float64Array(imaginaryRhs);
    for (let row = 0; row < n; row += 1) {
      let scale = 0;
      for (let col = 0; col < n; col += 1)
        scale = Math.max(scale, Math.hypot(re[row * n + col], im[row * n + col]));
      if (!scale) throw new Error('频率扫描矩阵奇异，请检查浮空节点与理想元件回路。');
      for (let col = 0; col < n; col += 1) {
        re[row * n + col] /= scale;
        im[row * n + col] /= scale;
      }
      br[row] /= scale;
      bi[row] /= scale;
    }
    for (let pivot = 0; pivot < n; pivot += 1) {
      let best = pivot;
      for (let row = pivot + 1; row < n; row += 1)
        if (
          Math.hypot(re[row * n + pivot], im[row * n + pivot]) >
          Math.hypot(re[best * n + pivot], im[best * n + pivot])
        )
          best = row;
      if (Math.hypot(re[best * n + pivot], im[best * n + pivot]) < 1e-14)
        throw new Error('频率扫描矩阵奇异，请检查浮空节点、理想元件回路或共振点的阻尼。');
      if (best !== pivot) {
        for (const array of [re, im])
          for (let col = pivot; col < n; col += 1) {
            const value = array[pivot * n + col];
            array[pivot * n + col] = array[best * n + col];
            array[best * n + col] = value;
          }
        for (const array of [br, bi]) {
          const value = array[pivot];
          array[pivot] = array[best];
          array[best] = value;
        }
      }
      const pr = re[pivot * n + pivot];
      const pi = im[pivot * n + pivot];
      const denominator = pr * pr + pi * pi;
      for (let row = pivot + 1; row < n; row += 1) {
        const ar = re[row * n + pivot];
        const ai = im[row * n + pivot];
        if (!ar && !ai) continue;
        const fr = (ar * pr + ai * pi) / denominator;
        const fi = (ai * pr - ar * pi) / denominator;
        re[row * n + pivot] = 0;
        im[row * n + pivot] = 0;
        for (let col = pivot + 1; col < n; col += 1) {
          re[row * n + col] -= fr * re[pivot * n + col] - fi * im[pivot * n + col];
          im[row * n + col] -= fr * im[pivot * n + col] + fi * re[pivot * n + col];
        }
        br[row] -= fr * br[pivot] - fi * bi[pivot];
        bi[row] -= fr * bi[pivot] + fi * br[pivot];
      }
    }
    const xr = new Float64Array(n);
    const xi = new Float64Array(n);
    for (let row = n - 1; row >= 0; row -= 1) {
      let vr = br[row];
      let vi = bi[row];
      for (let col = row + 1; col < n; col += 1) {
        vr -= re[row * n + col] * xr[col] - im[row * n + col] * xi[col];
        vi -= re[row * n + col] * xi[col] + im[row * n + col] * xr[col];
      }
      const ar = re[row * n + row];
      const ai = im[row * n + row];
      const denominator = ar * ar + ai * ai;
      xr[row] = finite((vr * ar + vi * ai) / denominator, '交流实部');
      xi[row] = finite((vi * ar - vr * ai) / denominator, '交流虚部');
    }
    return { real: xr, imaginary: xi };
  }
  function acPoint(system, operatingPoint, frequency) {
    const n = system.dimension;
    const omega = 2 * Math.PI * frequency;
    const re = assemble(system, operatingPoint, { kind: 'dc' }).matrix;
    const im = new Float64Array(n * n);
    const br = new Float64Array(n);
    const bi = new Float64Array(n);
    function addRhs(index, value, sign) {
      if (index >= 0) {
        br[index] += sign * value[0];
        bi[index] += sign * value[1];
      }
    }
    for (const component of system.components) {
      const { branch, pins, params: p, type } = component;
      if (type === 'voltage') addRhs(branch, sourcePhasor(p), 1);
      if (type === 'current') {
        const phasor = sourcePhasor(p);
        addRhs(pins[0], phasor, -1);
        addRhs(pins[1], phasor, 1);
      }
      if (type === 'capacitor') {
        if (pins[0] >= 0) im[branch * n + pins[0]] -= omega * p.capacitance;
        if (pins[1] >= 0) im[branch * n + pins[1]] += omega * p.capacitance;
      }
      if (type === 'inductor') im[branch * n + branch] -= omega * p.inductance;
      if (type === 'twoport')
        stampTwoport(
          component,
          (row, column, value) => {
            if (column >= 0) im[row * n + column] += value;
          },
          true,
        );
    }
    return solveComplex(re, im, br, bi);
  }
  function acCurrent(component, solution, operatingPoint) {
    const real = (pin) => voltageAt(solution.real, pin);
    const imaginary = (pin) => voltageAt(solution.imaginary, pin);
    const { params: p, pins, type, branch } = component;
    if (branch >= 0) return [real(branch), imaginary(branch)];
    if (type === 'current') return sourcePhasor(p);
    if (type === 'resistor')
      return [
        (real(pins[0]) - real(pins[1])) / p.resistance,
        (imaginary(pins[0]) - imaginary(pins[1])) / p.resistance,
      ];
    if (type === 'vccs')
      return [
        p.gain * (real(pins[2]) - real(pins[3])),
        p.gain * (imaginary(pins[2]) - imaginary(pins[3])),
      ];
    if (type === 'cccs')
      return [p.gain * real(component.controlBranch), p.gain * imaginary(component.controlBranch)];
    if (nonlinearTypes.has(type)) {
      const linear = deviceLinearization(
        component,
        pins.map((pin) => voltageAt(operatingPoint, pin)),
      );
      return pins.reduce(
        (total, pin, index) => [
          total[0] + linear.derivatives[index][0] * real(pin),
          total[1] + linear.derivatives[index][0] * imaginary(pin),
        ],
        [0, 0],
      );
    }
    return [0, 0];
  }
  function appendAcResult(result, system, solution, operatingPoint, frequency) {
    result.x.push(frequency);
    function append(trace, phasor) {
      const magnitude = finite(Math.hypot(...phasor), '交流幅值');
      trace.values.push(magnitude);
      trace.phase.push(magnitude < 1e-30 ? 0 : (Math.atan2(phasor[1], phasor[0]) * 180) / Math.PI);
    }
    let traceIndex = 0;
    function nextTrace() {
      const trace = result.traces[traceIndex];
      traceIndex += 1;
      return trace;
    }
    system.components.forEach((component) => {
      const [a, b] = voltagePair(component);
      append(nextTrace(), [
        voltageAt(solution.real, a) - voltageAt(solution.real, b),
        voltageAt(solution.imaginary, a) - voltageAt(solution.imaginary, b),
      ]);
      append(nextTrace(), acCurrent(component, solution, operatingPoint));
      if (['twoport', 'oscilloscope2'].includes(component.type)) {
        append(nextTrace(), [
          voltageAt(solution.real, component.pins[2]) - voltageAt(solution.real, component.pins[3]),
          voltageAt(solution.imaginary, component.pins[2]) -
            voltageAt(solution.imaginary, component.pins[3]),
        ]);
        if (component.type === 'twoport')
          append(nextTrace(), [
            solution.real[component.branch + 1],
            solution.imaginary[component.branch + 1],
          ]);
      }
    });
  }

  function simulate(input, options) {
    const document = validateDocument(input);
    const analysis = normalizeAnalysis(options || document.analysis, document.components);
    const system = compile(document);
    const complexTwoport = system.components.some(
      (component) =>
        component.type === 'twoport' &&
        ['i11', 'i12', 'i21', 'i22'].some((key) => component.params[key] !== 0),
    );
    if (complexTwoport && analysis.type !== 'ac')
      throw new Error('复数二端口矩阵仅定义交流相量关系，请使用 AC 分析，或将矩阵虚部设为 0。');
    if (
      analysis.type === 'sweep' &&
      system.components.find((component) => component.id === analysis.componentId)?.type ===
        'twoport' &&
      ['i11', 'i12', 'i21', 'i22'].includes(analysis.parameter)
    )
      throw new Error('直流参数扫描不能扫描二端口矩阵虚部，请选择实部参数或 AC 分析。');
    if (complexTwoport && system.nonlinear)
      throw new Error(
        '复数二端口未定义直流偏置，暂不能与晶体管、二极管、非线性元件或限幅运放共同进行 AC 分析；请使用实数矩阵或独立线性小信号电路。',
      );
    const traceCount = system.components.reduce(
      (count, component) => count + traceDescriptors(component).length,
      0,
    );
    const points =
      analysis.type === 'transient'
        ? Math.ceil(analysis.stop / analysis.step - 1e-10) + 1
        : analysis.points || 1;
    if (points * system.dimension ** 3 * (analysis.type === 'ac' ? 4 : 1) > 6e8)
      throw new Error('计算量超过浏览器仿真限额；请减少扫描点数或简化电路。');
    const resultScalars =
      points * (1 + traceCount * (analysis.type === 'ac' ? 2 : 1)) +
      (analysis.type === 'ac' ? 1 : points) *
        (system.unknownNets.length +
          1 +
          system.components.length +
          system.components.filter((component) => component.type === 'twoport').length);
    if (resultScalars > 8e6)
      throw new Error('结果数据量超过浏览器仿真限额；请减少采样点或元件数量。');
    const result = emptyResult(system, analysis);
    result.warnings.push('教学模型：不包含晶体管寄生电容、击穿、温度漂移及完整工艺 SPICE 参数。');
    result.warnings.push(...normalizedSourceAdvice(document, analysis).warnings);
    if (analysis.type === 'dc') {
      const context = { kind: 'dc' };
      appendTimeResult(result, system, solvePoint(system, context), context, 0);
    } else if (analysis.type === 'transient') {
      const firstContext = {
        kind: analysis.initial === 'operating-point' ? 'dc' : 'initial',
        time: 0,
      };
      let solution = solvePoint(system, firstContext);
      appendTimeResult(result, system, solution, firstContext, 0);
      for (let index = 1; index < points; index += 1) {
        const time = Math.min(index * analysis.step, analysis.stop);
        const step = time - result.x.at(-1);
        const context = { kind: 'transient', time, step, previous: solution };
        try {
          solution = solvePoint(system, context, solution);
        } catch (error) {
          throw new Error(`t=${time.toPrecision(6)} s：${error.message}`);
        }
        appendTimeResult(result, system, solution, context, time);
      }
      result.warnings.push(
        '瞬态采用后向欧拉法，较大步长会产生数值阻尼；建议每个周期至少取 100 点，并比较减半步长后的结果。',
      );
    } else if (analysis.type === 'sweep') {
      const component = system.components.find((item) => item.id === analysis.componentId);
      let solution;
      for (let index = 0; index < points; index += 1) {
        const value = analysis.start + ((analysis.stop - analysis.start) * index) / (points - 1);
        component.params[analysis.parameter] = value;
        const context = { kind: 'dc' };
        try {
          solution = solvePoint(system, context, solution);
        } catch (error) {
          throw new Error(
            `${component.id}.${analysis.parameter}=${value.toPrecision(6)}：${error.message}`,
          );
        }
        appendTimeResult(result, system, solution, context, value);
      }
    } else {
      // A frequency-independent complex matrix has no defined DC equivalent. In a
      // wholly linear circuit its AC Jacobian does not require an operating point.
      const operatingPoint = complexTwoport
        ? new Float64Array(system.dimension)
        : solvePoint(system, { kind: 'dc' });
      if (!complexTwoport) result.frames.push(frameFor(system, operatingPoint, { kind: 'dc' }));
      else
        result.warnings.push(
          '复数二端口按频率无关的相量矩阵求解；未定义直流工作点，因此不显示直流仪表读数。',
        );
      for (let index = 0; index < points; index += 1) {
        const ratio = index / (points - 1);
        const frequency =
          analysis.scale === 'log'
            ? analysis.start * (analysis.stop / analysis.start) ** ratio
            : analysis.start + (analysis.stop - analysis.start) * ratio;
        try {
          appendAcResult(
            result,
            system,
            acPoint(system, operatingPoint, frequency),
            operatingPoint,
            frequency,
          );
        } catch (error) {
          throw new Error(`f=${frequency.toPrecision(6)} Hz：${error.message}`);
        }
      }
      result.warnings.push(
        'AC 为直流工作点附近的小信号线性化，采用电源 acAmplitude 和 phase；幅值为峰值，phase 单位为度。',
      );
    }
    return result;
  }

  const exported = {
    catalog,
    powerRails,
    netSymbols,
    limits,
    validateDocument,
    normalizeDisplay,
    normalizeAnnotation,
    traceDescriptors,
    traceComponentId,
    validTraceId,
    sourceAnalysisAdvice,
    playbackFrameStep,
    buildNets,
    simulate,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  root.FreeBbsCircuitEngine = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this);
