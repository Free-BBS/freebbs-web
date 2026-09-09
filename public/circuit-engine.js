/* Numerical teaching models; see docs/circuit-contract.md and the ngspice manual. */
/* eslint-disable no-param-reassign */
(function circuitEngineModule(root) {
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
  const catalog = {
    ground: { label: '参考地', pins: ['地'], defaults: {} },
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
        if (key === 'duty' && (value <= 0 || value >= 1))
          throw new Error(`${component.id}.duty 必须在 0 与 1 之间。`);
      } else if (typeof value !== 'string') throw new Error(`${component.id}.${key} 必须是文本。`);
    }
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
      if (Math.ceil(stop / step - 1e-10) + 1 > 2000)
        throw new Error('瞬态最多 2000 个采样点；请增大步长或缩短仿真时间。');
      if (!['zero', 'operating-point'].includes(initial))
        throw new Error('瞬态初值必须为 zero 或 operating-point。');
      return { type, stop, step, initial };
    }
    if (!['sweep', 'ac'].includes(type))
      throw new Error('分析类型只支持 dc、transient、sweep 或 ac。');
    const start = finite(options.start ?? (type === 'ac' ? 10 : 0), '扫描起点');
    const stop = finite(options.stop ?? (type === 'ac' ? 100000 : 5), '扫描终点');
    const points = options.points ?? 101;
    if (!Number.isInteger(points) || points < 2 || points > 2000)
      throw new Error('扫描点数必须为 2 至 2000 的整数。');
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
      return {
        id: component.id,
        type: component.type,
        x,
        y,
        rotation,
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
      return { id: wire.id, from, to };
    });
    return {
      version: 1,
      components,
      wires,
      analysis: normalizeAnalysis(document.analysis || { type: 'dc' }, components),
    };
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
    if (!document.components.some((component) => component.type === 'ground'))
      throw new Error('电路缺少参考地；请放置参考地并连接电源或公共节点。');
    if (!document.components.some((component) => component.type !== 'ground'))
      throw new Error('请先添加元件并连接电路。');
    const nets = netsFor(document);
    const unknownNets = nets.nets.filter((net) => net !== '0');
    const indices = new Map(unknownNets.map((net, index) => [net, index]));
    let dimension = unknownNets.length;
    const components = document.components
      .filter((component) => component.type !== 'ground')
      .map((component) => {
        const pins = catalog[component.type].pins.map(
          (_, pin) => indices.get(nets.pinNets[`${component.id}:${pin}`]) ?? -1,
        );
        const compiled = { ...component, pins, branch: -1 };
        if (branchTypes.has(component.type)) {
          compiled.branch = dimension;
          dimension += 1;
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
        throw original;
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
      ['V', 'I'].map((kind) => ({
        id: `${kind}:${component.id}`,
        label: `${component.id} ${kind === 'V' ? '电压' : '电流'}`,
        unit: kind === 'V' ? 'V' : 'A',
        values: [],
        ...(analysis.type === 'ac' ? { phase: [] } : {}),
      })),
    );
    return { analysis, x: [], xLabel, xUnit, traces, frames: [], warnings: [] };
  }
  function appendTimeResult(result, system, solution, context, x) {
    result.x.push(x);
    result.frames.push(frameFor(system, solution, context));
    system.components.forEach((component, index) => {
      const [a, b] = voltagePair(component);
      result.traces[2 * index].values.push(
        finite(voltageAt(solution, a) - voltageAt(solution, b), `${component.id} 电压`),
      );
      result.traces[2 * index + 1].values.push(result.frames.at(-1).currents[component.id]);
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
    system.components.forEach((component, index) => {
      const [a, b] = voltagePair(component);
      append(result.traces[2 * index], [
        voltageAt(solution.real, a) - voltageAt(solution.real, b),
        voltageAt(solution.imaginary, a) - voltageAt(solution.imaginary, b),
      ]);
      append(result.traces[2 * index + 1], acCurrent(component, solution, operatingPoint));
    });
  }
  function simulate(input, options) {
    const document = validateDocument(input);
    const analysis = normalizeAnalysis(options || document.analysis, document.components);
    const system = compile(document);
    const points =
      analysis.type === 'transient'
        ? Math.ceil(analysis.stop / analysis.step - 1e-10) + 1
        : analysis.points || 1;
    if (points * system.dimension ** 3 * (analysis.type === 'ac' ? 4 : 1) > 6e8)
      throw new Error('计算量超过浏览器仿真限额；请减少扫描点数或简化电路。');
    const result = emptyResult(system, analysis);
    result.warnings.push('教学模型：不包含晶体管寄生电容、击穿、温度漂移及完整工艺 SPICE 参数。');
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
      const operatingPoint = solvePoint(system, { kind: 'dc' });
      result.frames.push(frameFor(system, operatingPoint, { kind: 'dc' }));
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

  const exported = { catalog, validateDocument, buildNets, simulate };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  root.FreeBbsCircuitEngine = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this);
