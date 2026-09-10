/* Shared waveform mathematics. Expressions are parsed, never executed as JavaScript. */
(function circuitPlotModule(root) {
  const limits = Object.freeze({ expression: 160, nodes: 96, depth: 32, rows: 8, work: 25000000 });
  const functions = new Set([
    'abs',
    'sqrt',
    'sin',
    'cos',
    'exp',
    'log',
    'ln',
    'min',
    'max',
    'pow',
    'diff',
    'derivative',
    'integral',
  ]);
  const calculus = new Set(['diff', 'derivative', 'integral']);
  const isArray = (value) => Array.isArray(value) || ArrayBuffer.isView(value);
  const invalid = () => [NaN, NaN];

  function compileExpression(expression) {
    if (
      typeof expression !== 'string' ||
      !expression.trim() ||
      expression.length > limits.expression
    )
      throw new Error(`数学表达式须为 1–${limits.expression} 个字符。`);
    const input = expression.trim();
    const tokens = [];
    const pattern =
      /\s*(?:(\d+(?:\.\d*)?|\.\d+)([eE][+-]?\d+)?|([A-Za-z][A-Za-z0-9]*)|([+\-*/^(),]))/y;
    let cursor = 0;
    while (cursor < input.length) {
      pattern.lastIndex = cursor;
      const match = pattern.exec(input);
      if (!match) throw new Error('表达式含非法字符；仅支持通道、数字和数学函数。');
      cursor = pattern.lastIndex;
      if (match[1]) {
        const value = Number(match[1] + (match[2] || ''));
        if (!Number.isFinite(value)) throw new Error('表达式中的常数必须为有限数值。');
        tokens.push({ type: 'number', value });
      } else if (match[3]) tokens.push({ type: 'name', value: match[3] });
      else tokens.push({ type: match[4] });
    }
    let position = 0;
    let operations = 0;
    const dependencies = new Set();
    const calculusNodes = [];
    const peek = (type) => tokens[position]?.type === type;
    function node(value, depth) {
      operations += 1;
      if (operations > limits.nodes || depth > limits.depth)
        throw new Error('表达式过于复杂，请拆成多条数学曲线。');
      return Object.freeze(value);
    }
    function expect(type) {
      if (!peek(type)) throw new Error(`表达式缺少 ${type}。`);
      position += 1;
    }
    function primary(depth) {
      if (depth > limits.depth) throw new Error('表达式嵌套过深。');
      const token = tokens[position];
      if (!token) throw new Error('表达式不完整。');
      position += 1;
      if (token.type === 'number') return node({ type: 'number', value: token.value }, depth);
      if (token.type === '(') {
        const value = sum(depth + 1);
        expect(')');
        return value;
      }
      if (token.type !== 'name') throw new Error('表达式需要数字、通道或括号。');
      const name = token.value.toLowerCase();
      if (peek('(')) {
        if (!functions.has(name)) throw new Error(`不支持函数 ${token.value}。`);
        position += 1;
        const args = [sum(depth + 1)];
        while (peek(',')) {
          position += 1;
          args.push(sum(depth + 1));
        }
        expect(')');
        const arity = ['min', 'max', 'pow'].includes(name) ? 2 : 1;
        if (args.length !== arity) throw new Error(`${name} 需要 ${arity} 个参数。`);
        const call = node({ type: 'call', name, args: Object.freeze(args) }, depth);
        if (calculus.has(name)) calculusNodes.push(call);
        return call;
      }
      if (name === 'pi' || name === 'e')
        return node({ type: 'number', value: name === 'pi' ? Math.PI : Math.E }, depth);
      const variable = token.value.toUpperCase();
      if (!/^(CH[12]|M[1-8])$/.test(variable))
        throw new Error(`未知通道 ${token.value}；可使用 CH1、CH2 和前面的数学曲线 M1–M8。`);
      dependencies.add(variable);
      return node({ type: 'variable', name: variable }, depth);
    }
    function power(depth) {
      const left = primary(depth);
      if (!peek('^')) return left;
      position += 1;
      return node({ type: 'binary', operator: '^', left, right: unary(depth + 1) }, depth);
    }
    function unary(depth) {
      if (depth > limits.depth) throw new Error('表达式嵌套过深。');
      if (peek('+') || peek('-')) {
        const operator = tokens[position].type;
        position += 1;
        return node({ type: 'unary', operator, argument: unary(depth + 1) }, depth);
      }
      return power(depth);
    }
    function product(depth) {
      let value = unary(depth);
      while (peek('*') || peek('/')) {
        const operator = tokens[position].type;
        position += 1;
        value = node({ type: 'binary', operator, left: value, right: unary(depth) }, depth);
      }
      return value;
    }
    function sum(depth) {
      let value = product(depth);
      while (peek('+') || peek('-')) {
        const operator = tokens[position].type;
        position += 1;
        value = node({ type: 'binary', operator, left: value, right: product(depth) }, depth);
      }
      return value;
    }
    const ast = sum(0);
    if (position !== tokens.length) throw new Error('表达式中有多余内容，乘法请写 *。');
    return Object.freeze({
      ast,
      dependencies: Object.freeze([...dependencies]),
      operations,
      usesCalculus: calculusNodes.length > 0,
      calculusNodes: Object.freeze(calculusNodes),
      evaluate(variables = {}) {
        if (calculusNodes.length) throw new Error('微分和积分需要瞬态波形及其时间轴。');
        const value = evaluateReal(ast, (name) => {
          if (!Object.hasOwn(variables, name)) throw new Error(`缺少通道 ${name}。`);
          return variables[name];
        });
        return Number.isFinite(value) ? value : NaN;
      },
    });
  }

  function evaluateReal(node, variable, cached) {
    if (node.type === 'number') return node.value;
    if (node.type === 'variable') {
      const value = variable(node.name);
      return Number.isFinite(value) ? value : NaN;
    }
    if (node.type === 'unary') {
      const value = evaluateReal(node.argument, variable, cached);
      return node.operator === '-' ? -value : value;
    }
    if (node.type === 'binary') {
      const left = evaluateReal(node.left, variable, cached);
      const right = evaluateReal(node.right, variable, cached);
      if (!Number.isFinite(left) || !Number.isFinite(right)) return NaN;
      switch (node.operator) {
        case '+':
          return left + right;
        case '-':
          return left - right;
        case '*':
          return left * right;
        case '/':
          return right === 0 ? NaN : left / right;
        default:
          return left ** right;
      }
    }
    if (calculus.has(node.name)) return cached(node);
    const args = node.args.map((argument) => evaluateReal(argument, variable, cached));
    if (args.some((value) => !Number.isFinite(value))) return NaN;
    return Math[node.name === 'ln' ? 'log' : node.name](...args);
  }

  function multiply([a, b], [c, d]) {
    return [a * c - b * d, a * d + b * c];
  }
  function divide([a, b], [c, d]) {
    if (c === 0 && d === 0) return invalid();
    if (Math.abs(c) >= Math.abs(d)) {
      const ratio = d / c;
      const denominator = c + d * ratio;
      return [(a + b * ratio) / denominator, (b - a * ratio) / denominator];
    }
    const ratio = c / d;
    const denominator = d + c * ratio;
    return [(a * ratio + b) / denominator, (b * ratio - a) / denominator];
  }
  function complexExp([a, b]) {
    return [Math.exp(a) * Math.cos(b), Math.exp(a) * Math.sin(b)];
  }
  function complexLog([a, b]) {
    return [Math.log(Math.hypot(a, b)), Math.atan2(b, a)];
  }
  function complexPower(base, exponent) {
    if (base[0] === 0 && base[1] === 0) {
      if (exponent[1] !== 0 || exponent[0] < 0) return invalid();
      return [exponent[0] === 0 ? 1 : 0, 0];
    }
    return complexExp(multiply(exponent, complexLog(base)));
  }
  function evaluateComplex(node, variable) {
    if (node.type === 'number') return [node.value, 0];
    if (node.type === 'variable') return variable(node.name);
    if (node.type === 'unary') {
      const value = evaluateComplex(node.argument, variable);
      return node.operator === '-' ? [-value[0], -value[1]] : value;
    }
    if (node.type === 'binary') {
      const left = evaluateComplex(node.left, variable);
      const right = evaluateComplex(node.right, variable);
      if (![...left, ...right].every(Number.isFinite)) return invalid();
      switch (node.operator) {
        case '+':
          return [left[0] + right[0], left[1] + right[1]];
        case '-':
          return [left[0] - right[0], left[1] - right[1]];
        case '*':
          return multiply(left, right);
        case '/':
          return divide(left, right);
        default:
          return complexPower(left, right);
      }
    }
    const values = node.args.map((argument) => evaluateComplex(argument, variable));
    if (values.some((value) => !value.every(Number.isFinite))) return invalid();
    const [[a, b]] = values;
    switch (node.name) {
      case 'abs':
        return [Math.hypot(a, b), 0];
      case 'sqrt':
        return complexPower(values[0], [0.5, 0]);
      case 'exp':
        return complexExp(values[0]);
      case 'log':
      case 'ln':
        return complexLog(values[0]);
      case 'sin':
        return [Math.sin(a) * Math.cosh(b), Math.cos(a) * Math.sinh(b)];
      case 'cos':
        return [Math.cos(a) * Math.cosh(b), -Math.sin(a) * Math.sinh(b)];
      case 'pow':
        return complexPower(values[0], values[1]);
      default:
        return invalid();
    }
  }

  function joinUnit(left, right, operator) {
    if (operator === '+' || operator === '-') {
      if (left === right) return left;
      if (left === '1') return right;
      if (right === '1') return left;
      return '?';
    }
    if (operator === '/' && left === right) return '1';
    if (right === '1') return left;
    if (left === '1' && operator === '*') return right;
    return operator === '*' ? `${left}·${right}` : `${left}/${right}`;
  }
  function inferUnit(node, variables) {
    if (node.type === 'number') return '1';
    if (node.type === 'variable') return variables[node.name]?.unit || '1';
    if (node.type === 'unary') return inferUnit(node.argument, variables);
    if (node.type === 'binary') {
      const left = inferUnit(node.left, variables);
      if (node.operator === '^')
        return left === '1'
          ? '1'
          : `(${left})^${node.right.type === 'number' ? node.right.value : '?'}`;
      return joinUnit(left, inferUnit(node.right, variables), node.operator);
    }
    const unit = inferUnit(node.args[0], variables);
    if (node.name === 'integral') return joinUnit(unit, 's', '*');
    if (node.name === 'diff' || node.name === 'derivative') return joinUnit(unit, 's', '/');
    if (node.name === 'sqrt') return unit === '1' ? '1' : `√(${unit})`;
    if (node.name === 'pow')
      return unit === '1'
        ? '1'
        : `(${unit})^${node.args[1].type === 'number' ? node.args[1].value : '?'}`;
    if (['abs', 'min', 'max'].includes(node.name)) return unit;
    return '1';
  }

  function differentiate(values, x) {
    const result = new Float64Array(values.length);
    if (values.length < 2) return result.fill(NaN);
    if (values.length === 2) {
      result.fill((values[1] - values[0]) / (x[1] - x[0]));
      return result;
    }
    for (let index = 0; index < values.length; index += 1) {
      const start = Math.max(0, Math.min(values.length - 3, index - 1));
      const at = x[index];
      const a = x[start];
      const b = x[start + 1];
      const c = x[start + 2];
      result[index] =
        (values[start] * (at - b + (at - c))) / ((a - b) * (a - c)) +
        (values[start + 1] * (at - a + (at - c))) / ((b - a) * (b - c)) +
        (values[start + 2] * (at - a + (at - b))) / ((c - a) * (c - b));
    }
    return result;
  }
  function integrate(values, x) {
    const result = new Float64Array(values.length);
    if (values.length && !Number.isFinite(values[0])) result[0] = NaN;
    for (let index = 1; index < values.length; index += 1)
      result[index] =
        result[index - 1] + ((values[index - 1] + values[index]) * (x[index] - x[index - 1])) / 2;
    return result;
  }
  function containsFunction(node, names) {
    if (node.type === 'call')
      return (
        names.has(node.name) || node.args.some((argument) => containsFunction(argument, names))
      );
    if (node.type === 'binary')
      return containsFunction(node.left, names) || containsFunction(node.right, names);
    return node.type === 'unary' && containsFunction(node.argument, names);
  }

  function resolveDisplay(baseResult, document = {}) {
    const saved = document.display || {};
    const traces = (baseResult?.traces || []).filter((trace) => !trace.id.startsWith('M:'));
    const instruments = new Map(
      (document.components || []).map((component) => [component.id, component.type]),
    );
    let preferred = traces
      .filter((trace) => {
        const [kind, id] = trace.id.split(':');
        const type = instruments.get(id);
        return (
          kind === (type === 'ammeter' ? 'I' : 'V') &&
          ['voltmeter', 'ammeter', 'oscilloscope', 'oscilloscope2'].includes(type)
        );
      })
      .map((trace) => trace.id);
    if (!preferred.length)
      preferred = traces
        .filter((trace) => trace.id.startsWith('V:'))
        .slice(0, 3)
        .map((trace) => trace.id);
    if (!preferred.length) preferred = traces.slice(0, 3).map((trace) => trace.id);
    const ch1 = saved.ch1 || preferred[0] || null;
    const ch2 = saved.ch2 || preferred[1] || preferred[0] || null;
    const ranges = {};
    for (const key of ['xMin', 'xMax', 'yMin', 'yMax'])
      ranges[key] = Number.isFinite(saved.ranges?.[key]) ? saved.ranges[key] : null;
    return {
      version: 1,
      mode: saved.mode === 'xy' ? 'xy' : 'xt',
      traceIds: Array.isArray(saved.traceIds) ? [...saved.traceIds] : preferred.slice(0, 32),
      ch1,
      ch2,
      xyX: saved.xyX || ch1,
      xyY: saved.xyY || ch2,
      math: Array.isArray(saved.math) ? saved.math.map((row) => ({ ...row })) : [],
      phase: saved.phase === true,
      ranges,
    };
  }

  function buildResult(baseResult, display = {}) {
    const warnings = [];
    if (!baseResult || !isArray(baseResult.x) || !Array.isArray(baseResult.traces))
      return { result: baseResult, warnings: ['尚无可计算的仿真波形。'] };
    const traces = baseResult.traces.filter((trace) => !trace.id.startsWith('M:'));
    const physical = new Map(traces.map((trace) => [trace.id, trace]));
    const variables = Object.create(null);
    variables.CH1 = physical.get(display.ch1);
    variables.CH2 = physical.get(display.ch2);
    for (const [name, id] of [
      ['CH1', display.ch1],
      ['CH2', display.ch2],
    ])
      if (id && !physical.has(id)) warnings.push(`${name} 引用的通道 ${id} 不存在，请重新选择。`);
    const rows = Array.isArray(display.math) ? display.math : [];
    if (rows.length > limits.rows)
      warnings.push(`最多显示 ${limits.rows} 条数学曲线，多余曲线未计算。`);
    const seen = new Set();
    const count = baseResult.x.length;
    const ac = baseResult.analysis?.type === 'ac';
    let work = 0;
    rows.slice(0, limits.rows).forEach((row, position) => {
      const id = row?.id || `M${position + 1}`;
      try {
        if (!/^M[1-8]$/.test(id) || seen.has(id))
          throw new Error('数学曲线编号须为不重复的 M1–M8。');
        seen.add(id);
        const compiled = compileExpression(row.expression);
        for (const name of compiled.dependencies) {
          if (!variables[name]) throw new Error(`缺少 ${name}，或引用了自身、后面的数学曲线。`);
          if (!isArray(variables[name].values) || variables[name].values.length !== count)
            throw new Error(`${name} 与当前仿真的采样数量不一致。`);
          if (ac && (!isArray(variables[name].phase) || variables[name].phase.length !== count))
            throw new Error(`${name} 缺少交流相位，无法进行相量运算。`);
        }
        if (compiled.usesCalculus && baseResult.analysis?.type !== 'transient')
          throw new Error('微分和积分仅支持瞬态分析的时间轴。');
        if (ac && containsFunction(compiled.ast, new Set(['min', 'max'])))
          throw new Error('交流相量没有大小顺序，min / max 仅支持实数波形。');
        if (
          compiled.usesCalculus &&
          baseResult.x.some(
            (value, index) =>
              !Number.isFinite(value) || (index > 0 && value <= baseResult.x[index - 1]),
          )
        )
          throw new Error('微分和积分要求时间轴为严格递增的有限数值。');
        const rowWork = compiled.operations * count;
        if (work + rowWork > limits.work)
          throw new Error('数学运算量过大，请简化表达式或减少仿真采样点。');
        work += rowWork;
        const cached = new Map();
        for (const call of compiled.calculusNodes) {
          const values = Float64Array.from(baseResult.x, (_, index) =>
            evaluateReal(
              call.args[0],
              (name) => variables[name].values[index],
              (node) => cached.get(node)[index],
            ),
          );
          cached.set(
            call,
            call.name === 'integral'
              ? integrate(values, baseResult.x)
              : differentiate(values, baseResult.x),
          );
        }
        let gaps = 0;
        const values = [];
        const phase = [];
        for (let index = 0; index < count; index += 1) {
          if (ac) {
            const phasor = evaluateComplex(compiled.ast, (name) => {
              const trace = variables[name];
              if (!Number.isFinite(trace.values[index]) || !Number.isFinite(trace.phase[index]))
                return invalid();
              const angle = (trace.phase[index] * Math.PI) / 180;
              return [trace.values[index] * Math.cos(angle), trace.values[index] * Math.sin(angle)];
            });
            const magnitude = Math.hypot(...phasor);
            const valid = Number.isFinite(magnitude);
            const angle = magnitude === 0 ? 0 : (Math.atan2(phasor[1], phasor[0]) * 180) / Math.PI;
            values.push(valid ? magnitude : NaN);
            phase.push(valid ? angle : NaN);
            if (!valid) gaps += 1;
          } else {
            const value = evaluateReal(
              compiled.ast,
              (name) => variables[name].values[index],
              (node) => cached.get(node)[index],
            );
            values.push(Number.isFinite(value) ? value : NaN);
            if (!Number.isFinite(value)) gaps += 1;
          }
        }
        const unit =
          typeof row.unit === 'string' && row.unit.trim()
            ? row.unit.trim()
            : inferUnit(compiled.ast, variables);
        const trace = {
          id: `M:${id}`,
          label:
            typeof row.label === 'string' && row.label.trim() && row.label.trim() !== id
              ? `${id} ${row.label.trim().slice(0, 60)}`
              : `${id} ${row.expression}`,
          unit: unit.slice(0, 32),
          values,
          ...(ac ? { phase } : {}),
          expression: row.expression,
        };
        variables[id] = trace;
        traces.push(trace);
        if (gaps)
          warnings.push(
            `${id} 有 ${gaps} 个无效采样点（除零、超出定义域或数值溢出），已显示为断点。`,
          );
      } catch (error) {
        warnings.push(`${id}：${error.message}`);
      }
    });
    const available = new Set(traces.map((trace) => trace.id));
    for (const id of new Set([
      ...(display.traceIds || []),
      ...(display.mode === 'xy' ? [display.xyX, display.xyY] : []),
    ]))
      if (id && !available.has(id)) warnings.push(`显示通道 ${id} 不存在或未能计算。`);
    return {
      result: { ...baseResult, traces, warnings: [...(baseResult.warnings || []), ...warnings] },
      warnings,
    };
  }

  const api = Object.freeze({ limits, compileExpression, resolveDisplay, buildResult });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FreeBbsCircuitPlot = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
