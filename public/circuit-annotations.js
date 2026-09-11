/* Saved waveform annotations refer to simulation samples, never screen coordinates. */
(function circuitAnnotationsModule(root) {
  const identifier = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
  const traceIdentifier =
    /^(?:[VI]:[A-Za-z][A-Za-z0-9_-]{0,39}(?::P2)?|V:[A-Za-z][A-Za-z0-9_-]{0,39}:CH2|M:M[1-8])$/;
  const analysisIdentifier =
    /^(?:dc|transient|ac|sweep:[A-Za-z][A-Za-z0-9_-]{0,39}:[A-Za-z][A-Za-z0-9_]{0,39})$/;
  const fields = ['id', 'traceId', 'at', 'text', 'mode', 'axis', 'xTraceId', 'analysisKey'];
  const isArray = (value) => Array.isArray(value) || ArrayBuffer.isView(value);

  function analysisKey(analysis) {
    if (!analysis || typeof analysis !== 'object') return null;
    if (['dc', 'transient', 'ac'].includes(analysis.type)) return analysis.type;
    if (analysis.type !== 'sweep') return null;
    const key = `sweep:${analysis.componentId}:${analysis.parameter}`;
    return analysisIdentifier.test(key) ? key : null;
  }

  // Keep this lightweight browser guard aligned with engine.normalizeAnnotation's
  // storage contract without requiring the simulation engine in a chart-only page.
  function validAnnotation(value) {
    return Boolean(
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).every((key) => fields.includes(key) || key === 'marker') &&
      fields.every((key) => Object.hasOwn(value, key)) &&
      typeof value.id === 'string' &&
      identifier.test(value.id) &&
      typeof value.traceId === 'string' &&
      traceIdentifier.test(value.traceId) &&
      Number.isFinite(value.at) &&
      Math.abs(value.at) <= 1e15 &&
      typeof value.text === 'string' &&
      value.text.length <= 160 &&
      (!Object.hasOwn(value, 'marker') ||
        ['point', 'vertical', 'horizontal'].includes(value.marker)) &&
      ['xt', 'xy'].includes(value.mode) &&
      ['value', 'phase'].includes(value.axis) &&
      typeof value.analysisKey === 'string' &&
      analysisIdentifier.test(value.analysisKey) &&
      (value.mode === 'xt'
        ? value.xTraceId === null
        : value.axis === 'value' &&
          typeof value.xTraceId === 'string' &&
          traceIdentifier.test(value.xTraceId)) &&
      (value.axis !== 'phase' || (value.mode === 'xt' && value.analysisKey === 'ac')),
    );
  }

  function nearestIndex(values, target) {
    const last = values.length - 1;
    if (
      last < 0 ||
      !Number.isFinite(values[0]) ||
      !Number.isFinite(values[last]) ||
      target < Math.min(values[0], values[last]) ||
      target > Math.max(values[0], values[last])
    )
      return -1;
    const direction = values[last] < values[0] ? -1 : 1;
    let low = 0;
    let high = last;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (!Number.isFinite(values[middle])) return -1;
      if (values[middle] * direction < target * direction) low = middle + 1;
      else high = middle;
    }
    if (!Number.isFinite(values[low])) return -1;
    if (low > 0 && Math.abs(values[low - 1] - target) <= Math.abs(values[low] - target))
      return low - 1;
    return low;
  }

  function resolve(annotation, result, display = {}) {
    if (!validAnnotation(annotation)) return { error: '标记格式不正确。' };
    if (!result || !isArray(result.x) || !Array.isArray(result.traces) || !result.x.length)
      return { error: '等待仿真结果后显示标记。' };
    if (analysisKey(result.analysis) !== annotation.analysisKey)
      return { error: '分析类型或扫描目标已改变，标记暂时隐藏。' };
    const mode = display.mode === 'xy' ? 'xy' : 'xt';
    if (annotation.mode !== mode) return { error: '切换回原图像模式后显示此标记。' };
    if (
      mode === 'xy' &&
      (annotation.traceId !== display.xyY || annotation.xTraceId !== display.xyX)
    )
      return { error: 'X–Y 横纵轴曲线已改变，标记暂时隐藏。' };
    if (
      mode === 'xt' &&
      Array.isArray(display.traceIds) &&
      !display.traceIds.includes(annotation.traceId)
    )
      return { error: '显示此标记的曲线后可查看标记。' };
    if (annotation.axis === 'phase' && !display.phase) return { error: '开启相位图后显示此标记。' };
    const trace = result.traces.find((item) => item.id === annotation.traceId);
    const xTrace =
      mode === 'xy' ? result.traces.find((item) => item.id === annotation.xTraceId) : null;
    if (!trace || (mode === 'xy' && !xTrace))
      return { error: '标记对应的曲线不存在，可能已删除元件或数学曲线。' };
    const index = nearestIndex(result.x, annotation.at);
    if (index < 0) return { error: '标记坐标不在当前仿真范围内。' };
    const values = annotation.axis === 'phase' ? trace.phase : trace.values;
    const x = mode === 'xy' ? xTrace.values?.[index] : result.x[index];
    const y = values?.[index];
    if (!Number.isFinite(x) || !Number.isFinite(y))
      return { error: '该采样点无有效数值，标记暂时隐藏。' };
    const ranges = display.ranges || {};
    const marker = annotation.marker || 'point';
    if (
      (marker !== 'horizontal' &&
        ((Number.isFinite(ranges.xMin) && x < ranges.xMin) ||
          (Number.isFinite(ranges.xMax) && x > ranges.xMax))) ||
      (marker !== 'vertical' &&
        ((Number.isFinite(ranges.yMin) && y < ranges.yMin) ||
          (Number.isFinite(ranges.yMax) && y > ranges.yMax)))
    )
      return { error: '标记位于当前坐标显示范围之外。' };
    return {
      index,
      at: result.x[index],
      x,
      y,
      xUnit: mode === 'xy' ? xTrace.unit || '' : result.xUnit || '',
      yUnit: annotation.axis === 'phase' ? '°' : trace.unit || '',
      trace,
      ...(xTrace ? { xTrace } : {}),
    };
  }

  function create(result, display, options = {}) {
    const existing = display.annotations || [];
    const ids = new Set(existing.map((item) => item.id));
    let number = 1;
    while (ids.has(`A${number}`)) number += 1;
    const id = options.id ?? `A${number}`;
    if (existing.length >= 32 && !ids.has(id)) throw new Error('每张图像最多设置 32 个波形标记。');
    const mode = display.mode === 'xy' ? 'xy' : 'xt';
    const annotation = {
      id,
      traceId: options.traceId ?? (mode === 'xy' ? display.xyY : display.traceIds?.[0]),
      at: options.at,
      text: options.text ?? '',
      mode,
      axis: options.axis ?? 'value',
      xTraceId: mode === 'xy' ? display.xyX : null,
      analysisKey: analysisKey(result?.analysis),
      ...(options.marker === undefined ? {} : { marker: options.marker }),
    };
    const point = resolve(annotation, result, display);
    if (point.error) throw new Error(point.error);
    return { ...annotation, at: point.at };
  }

  const api = Object.freeze({ analysisKey, resolve, create });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.FreeBbsCircuitAnnotations = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
