const engine = require('../public/circuit-engine');
const layout = require('../public/circuit-layout');

const FIXED_COMPONENT_IDS = ['V_IN', 'OUT', 'GND', 'VCC', 'VEE'];

function component(id, type, x, y, params = {}, rotation = 0) {
  return {
    id,
    type,
    x,
    y,
    rotation,
    params: { ...engine.catalog[type].defaults, ...params },
  };
}

function baseDocument({
  waveform = 'sine',
  amplitude = 2,
  frequency = 1000,
  dc = 0,
  duty = 0.5,
  periods = 6,
  samplesPerPeriod = 200,
} = {}) {
  return {
    version: 1,
    components: [
      component(
        'V_IN',
        'voltage',
        140,
        300,
        { dc, waveform, amplitude, frequency, phase: 0, duty, delay: 0 },
        90,
      ),
      component('OUT', 'oscilloscope', 860, 300, {}, 90),
      component('GND', 'ground', 500, 560),
      component('VCC', 'fixed_voltage', 360, 100, { dc: 12 }),
      component('VEE', 'fixed_voltage', 640, 540, { dc: -12 }, 180),
    ],
    wires: [
      {
        id: 'fixed_input_ground',
        from: { componentId: 'V_IN', pin: 1 },
        to: { componentId: 'GND', pin: 0 },
      },
      {
        id: 'fixed_output_ground',
        from: { componentId: 'OUT', pin: 1 },
        to: { componentId: 'GND', pin: 0 },
      },
    ],
    analysis: {
      type: 'transient',
      stop: periods / frequency,
      step: 1 / (frequency * samplesPerPeriod),
      initial: 'zero',
    },
  };
}

function assemble(document, components, connections) {
  document.components.push(...components);
  connections.forEach(([fromId, fromPin, toId, toPin], index) => {
    document.wires.push({
      id: `w${index + 1}`,
      from: { componentId: fromId, pin: fromPin },
      to: { componentId: toId, pin: toPin },
    });
  });
  return engine.validateDocument(
    layout.normalizeCircuitLayout(engine.validateDocument(document), {
      lockedComponentIds: FIXED_COMPONENT_IDS,
    }),
  );
}

function halfWaveRectifier() {
  return assemble(
    baseDocument({ amplitude: 3 }),
    [
      component('D1', 'diode', 420, 300),
      component('R1', 'resistor', 680, 410, { resistance: 2000 }, 90),
    ],
    [
      ['V_IN', 0, 'D1', 0],
      ['D1', 1, 'OUT', 0],
      ['OUT', 0, 'R1', 0],
      ['R1', 1, 'GND', 0],
    ],
  );
}

function peakDetector() {
  return assemble(
    baseDocument({ amplitude: 3, periods: 8 }),
    [
      component('D1', 'diode', 370, 300),
      component('C1', 'capacitor', 650, 390, { capacitance: 0.000001 }, 90),
      component('R1', 'resistor', 750, 430, { resistance: 10000 }, 90),
    ],
    [
      ['V_IN', 0, 'D1', 0],
      ['D1', 1, 'OUT', 0],
      ['OUT', 0, 'C1', 0],
      ['C1', 1, 'GND', 0],
      ['OUT', 0, 'R1', 0],
      ['R1', 1, 'GND', 0],
    ],
  );
}

function lowPass(input = {}) {
  return assemble(
    baseDocument(input),
    [
      component('R1', 'resistor', 410, 300, { resistance: 1000 }),
      component('C1', 'capacitor', 680, 410, { capacitance: input.capacitance || 1e-7 }, 90),
    ],
    [
      ['V_IN', 0, 'R1', 0],
      ['R1', 1, 'OUT', 0],
      ['OUT', 0, 'C1', 0],
      ['C1', 1, 'GND', 0],
    ],
  );
}

function highPass(input = {}) {
  return assemble(
    baseDocument(input),
    [
      component('C1', 'capacitor', 410, 300, { capacitance: input.capacitance || 1e-7 }),
      component('R1', 'resistor', 680, 410, { resistance: input.resistance || 1000 }, 90),
    ],
    [
      ['V_IN', 0, 'C1', 0],
      ['C1', 1, 'OUT', 0],
      ['OUT', 0, 'R1', 0],
      ['R1', 1, 'GND', 0],
    ],
  );
}

function symmetricLimiter() {
  return assemble(
    baseDocument({ amplitude: 4 }),
    [
      component('R1', 'resistor', 330, 300, { resistance: 1000 }),
      component('D1', 'diode', 570, 210, {}, 90),
      component('D2', 'diode', 570, 410, {}, 270),
    ],
    [
      ['V_IN', 0, 'R1', 0],
      ['R1', 1, 'OUT', 0],
      ['OUT', 0, 'D1', 0],
      ['D1', 1, 'GND', 0],
      ['GND', 0, 'D2', 0],
      ['D2', 1, 'OUT', 0],
    ],
  );
}

function sineToSquare() {
  return assemble(
    baseDocument(),
    [component('U1', 'opamp', 520, 300)],
    [
      ['V_IN', 0, 'U1', 0],
      ['GND', 0, 'U1', 1],
      ['U1', 2, 'OUT', 0],
    ],
  );
}

function frequencyDoubler() {
  return assemble(
    baseDocument({ periods: 8, samplesPerPeriod: 200 }),
    [
      component('U1', 'opamp', 450, 420),
      component('R1', 'resistor', 330, 350, { resistance: 1000 }),
      component('R2', 'resistor', 560, 450, { resistance: 1000 }),
      component('D1', 'diode', 560, 220),
      component('D2', 'diode', 650, 350),
      component('R3', 'resistor', 760, 430, { resistance: 2000 }, 90),
    ],
    [
      ['V_IN', 0, 'R1', 0],
      ['R1', 1, 'U1', 1],
      ['U1', 2, 'R2', 0],
      ['R2', 1, 'U1', 1],
      ['GND', 0, 'U1', 0],
      ['V_IN', 0, 'D1', 0],
      ['D1', 1, 'OUT', 0],
      ['U1', 2, 'D2', 0],
      ['D2', 1, 'OUT', 0],
      ['OUT', 0, 'R3', 0],
      ['R3', 1, 'GND', 0],
    ],
  );
}

function frequencyTripler() {
  return assemble(
    baseDocument({ periods: 12, samplesPerPeriod: 200 }),
    [
      component('U1', 'opamp', 350, 300),
      component('C1', 'capacitor', 550, 300, { capacitance: 2.814477323398272e-7 }),
      component('L1', 'inductor', 690, 300, { inductance: 0.01 }),
      component('R1', 'resistor', 780, 430, { resistance: 5 }, 90),
    ],
    [
      ['V_IN', 0, 'U1', 0],
      ['GND', 0, 'U1', 1],
      ['U1', 2, 'C1', 0],
      ['C1', 1, 'L1', 0],
      ['L1', 1, 'OUT', 0],
      ['OUT', 0, 'R1', 0],
      ['R1', 1, 'GND', 0],
    ],
  );
}

function circuitChallengeCatalog() {
  return [
    {
      key: 'half-wave-rectifier-v1',
      title: '半波整流',
      description: '只保留正半周，并用负载电阻为输出提供回路。',
      tolerance: 0.06,
      rewardElectric: 8,
      document: halfWaveRectifier(),
    },
    {
      key: 'peak-detector-v1',
      title: '峰值检波',
      description: '把正弦波的峰值捕获并缓慢保持，观察二极管压降与 RC 放电。',
      tolerance: 0.08,
      rewardElectric: 12,
      document: peakDetector(),
    },
    {
      key: 'rc-low-pass-v1',
      title: 'RC 低通滤波',
      description: '衰减输入中的快速变化，得到幅度降低且相位滞后的正弦输出。',
      tolerance: 0.06,
      rewardElectric: 10,
      document: lowPass(),
    },
    {
      key: 'rc-high-pass-v1',
      title: 'RC 高通滤波',
      description: '隔断缓慢变化，让高频分量通过并形成相位超前。',
      tolerance: 0.06,
      rewardElectric: 10,
      document: highPass(),
    },
    {
      key: 'square-integrator-v1',
      title: '方波积分整形',
      description: '用 RC 低通网络把对称方波的陡峭边沿变成平滑的充放电曲线。',
      tolerance: 0.08,
      rewardElectric: 14,
      document: lowPass({
        waveform: 'pulse',
        amplitude: 2,
        dc: -1,
        duty: 0.5,
        capacitance: 4.7e-7,
        periods: 8,
      }),
    },
    {
      key: 'square-differentiator-v1',
      title: '方波微分整形',
      description: '用 RC 高通网络把方波的上升沿和下降沿转换成正负脉冲。',
      tolerance: 0.08,
      rewardElectric: 14,
      document: highPass({
        waveform: 'pulse',
        amplitude: 2,
        dc: -1,
        duty: 0.5,
        capacitance: 4.7e-8,
        resistance: 1000,
        periods: 8,
      }),
    },
    {
      key: 'symmetric-limiter-v1',
      title: '对称限幅整形',
      description: '把正弦波的正负峰值对称削平，同时保留过零附近的形状。',
      tolerance: 0.08,
      rewardElectric: 16,
      document: symmetricLimiter(),
    },
    {
      key: 'sine-to-square-v1',
      title: '正弦转方波',
      description: '利用运放的高增益与输出限幅，把正弦输入整形成对称方波。',
      tolerance: 0.08,
      rewardElectric: 18,
      document: sineToSquare(),
    },
    {
      key: 'frequency-doubler-v1',
      title: '二倍频 · 全波整流',
      description: '让每个输入周期产生两个相同的正向峰值，输出的基波频率变为输入的两倍。',
      tolerance: 0.09,
      rewardElectric: 24,
      document: frequencyDoubler(),
    },
    {
      key: 'frequency-tripler-v1',
      title: '三倍频 · 三次谐波选择',
      description: '先把正弦整形成富含奇次谐波的方波，再用串联谐振网络选出 3 kHz 三次谐波。',
      tolerance: 0.12,
      rewardElectric: 32,
      document: frequencyTripler(),
    },
  ];
}

module.exports = { circuitChallengeCatalog };
