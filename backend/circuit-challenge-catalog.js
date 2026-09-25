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

function negativeHalfWaveRectifier() {
  return assemble(
    baseDocument({ amplitude: 3 }),
    [
      component('D1', 'diode', 420, 300, {}, 180),
      component('R1', 'resistor', 680, 410, { resistance: 2000 }, 90),
    ],
    [
      ['V_IN', 0, 'D1', 1],
      ['D1', 0, 'OUT', 0],
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

function doubleLowPass() {
  return assemble(
    baseDocument({ waveform: 'pulse', amplitude: 2, dc: -1, periods: 8 }),
    [
      component('R1', 'resistor', 330, 300, { resistance: 1000 }),
      component('C1', 'capacitor', 460, 400, { capacitance: 2.2e-7 }, 90),
      component('R2', 'resistor', 600, 300, { resistance: 1000 }),
      component('C2', 'capacitor', 730, 400, { capacitance: 2.2e-7 }, 90),
    ],
    [
      ['V_IN', 0, 'R1', 0],
      ['R1', 1, 'R2', 0],
      ['R1', 1, 'C1', 0],
      ['C1', 1, 'GND', 0],
      ['R2', 1, 'OUT', 0],
      ['OUT', 0, 'C2', 0],
      ['C2', 1, 'GND', 0],
    ],
  );
}

function rlFilter({ highPass = false } = {}) {
  const seriesType = highPass ? 'resistor' : 'inductor';
  const shuntType = highPass ? 'inductor' : 'resistor';
  return assemble(
    baseDocument(),
    [
      component('X1', seriesType, 420, 300, highPass ? { resistance: 1000 } : { inductance: 0.1 }),
      component('X2', shuntType, 680, 410, highPass ? { inductance: 0.1 } : { resistance: 1000 }, 90),
    ],
    [
      ['V_IN', 0, 'X1', 0],
      ['X1', 1, 'OUT', 0],
      ['OUT', 0, 'X2', 0],
      ['X2', 1, 'GND', 0],
    ],
  );
}

function rlcBandPass() {
  return assemble(
    baseDocument({ periods: 10 }),
    [
      component('C1', 'capacitor', 360, 300, { capacitance: 2.533e-7 }),
      component('L1', 'inductor', 540, 300, { inductance: 0.1 }),
      component('R1', 'resistor', 720, 410, { resistance: 120 }, 90),
    ],
    [
      ['V_IN', 0, 'C1', 0],
      ['C1', 1, 'L1', 0],
      ['L1', 1, 'OUT', 0],
      ['OUT', 0, 'R1', 0],
      ['R1', 1, 'GND', 0],
    ],
  );
}

function rlcNotch() {
  return assemble(
    baseDocument({ periods: 10 }),
    [
      component('L1', 'inductor', 430, 240, { inductance: 0.1 }),
      component('C1', 'capacitor', 430, 360, { capacitance: 2.533e-7 }),
      component('R1', 'resistor', 700, 410, { resistance: 1000 }, 90),
    ],
    [
      ['V_IN', 0, 'L1', 0],
      ['L1', 1, 'OUT', 0],
      ['V_IN', 0, 'C1', 0],
      ['C1', 1, 'OUT', 0],
      ['OUT', 0, 'R1', 0],
      ['R1', 1, 'GND', 0],
    ],
  );
}

function diodeClamper() {
  return assemble(
    baseDocument({ amplitude: 3, periods: 8 }),
    [
      component('C1', 'capacitor', 380, 300, { capacitance: 0.000001 }),
      component('D1', 'diode', 600, 410, {}, 270),
      component('R1', 'resistor', 740, 410, { resistance: 10000 }, 90),
    ],
    [
      ['V_IN', 0, 'C1', 0],
      ['C1', 1, 'OUT', 0],
      ['GND', 0, 'D1', 0],
      ['D1', 1, 'OUT', 0],
      ['OUT', 0, 'R1', 0],
      ['R1', 1, 'GND', 0],
    ],
  );
}

function opampFollower() {
  return assemble(
    baseDocument(),
    [component('U1', 'opamp', 520, 300)],
    [
      ['V_IN', 0, 'U1', 0],
      ['U1', 2, 'U1', 1],
      ['U1', 2, 'OUT', 0],
    ],
  );
}

function opampInverting({ gain = 1 } = {}) {
  return assemble(
    baseDocument({ amplitude: gain > 1 ? 1.5 : 2 }),
    [
      component('R1', 'resistor', 360, 350, { resistance: 1000 }),
      component('R2', 'resistor', 610, 430, { resistance: 1000 * gain }),
      component('U1', 'opamp', 590, 280),
    ],
    [
      ['V_IN', 0, 'R1', 0],
      ['R1', 1, 'U1', 1],
      ['U1', 2, 'R2', 0],
      ['R2', 1, 'U1', 1],
      ['GND', 0, 'U1', 0],
      ['U1', 2, 'OUT', 0],
    ],
  );
}

function opampNonInverting() {
  return assemble(
    baseDocument({ amplitude: 1.5 }),
    [
      component('R1', 'resistor', 470, 430, { resistance: 1000 }, 90),
      component('R2', 'resistor', 650, 420, { resistance: 1000 }),
      component('U1', 'opamp', 570, 280),
    ],
    [
      ['V_IN', 0, 'U1', 0],
      ['GND', 0, 'R1', 0],
      ['R1', 1, 'U1', 1],
      ['U1', 2, 'R2', 0],
      ['R2', 1, 'U1', 1],
      ['U1', 2, 'OUT', 0],
    ],
  );
}

function transistorInverter(type) {
  const isMosfet = type === 'mosfet';
  return assemble(
    baseDocument({ waveform: 'pulse', amplitude: isMosfet ? 5 : 0.8, dc: 0, periods: 8 }),
    [
      component('R1', 'resistor', 370, 350, { resistance: isMosfet ? 1000 : 20000 }),
      component('R2', 'resistor', 670, 190, { resistance: isMosfet ? 2000 : 10000 }, 90),
      component('Q1', type, 600, 350),
    ],
    [
      ['V_IN', 0, 'R1', 0],
      ['R1', 1, 'Q1', 1],
      ['VCC', 0, 'R2', 0],
      ['R2', 1, 'Q1', 0],
      ['Q1', 0, 'OUT', 0],
      ['Q1', 2, 'GND', 0],
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
      revision: 2,
      title: '第七关',
      description: '半波整流：只保留正半周，并用负载电阻为输出提供回路。',
      tolerance: 0.06,
      rewardElectric: 2,
      document: halfWaveRectifier(),
    },
    {
      key: 'peak-detector-v1',
      revision: 2,
      title: '第八关',
      description: '峰值检波：把正弦波的峰值捕获并缓慢保持，观察二极管压降与 RC 放电。',
      tolerance: 0.08,
      rewardElectric: 3,
      document: peakDetector(),
    },
    {
      key: 'rc-low-pass-v1',
      revision: 2,
      title: '第九关',
      description: 'RC 低通滤波：衰减输入中的快速变化，得到幅度降低且相位滞后的正弦输出。',
      tolerance: 0.06,
      rewardElectric: 2,
      document: lowPass(),
    },
    {
      key: 'rc-high-pass-v1',
      revision: 2,
      title: '第十关',
      description: 'RC 高通滤波：隔断缓慢变化，让高频分量通过并形成相位超前。',
      tolerance: 0.06,
      rewardElectric: 2,
      document: highPass(),
    },
    {
      key: 'square-integrator-v1',
      revision: 2,
      title: '第十一关',
      description: '方波积分整形：用 RC 低通网络把对称方波的陡峭边沿变成平滑的充放电曲线。',
      tolerance: 0.08,
      rewardElectric: 3,
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
      revision: 2,
      title: '第十二关',
      description: '方波微分整形：用 RC 高通网络把方波的上升沿和下降沿转换成正负脉冲。',
      tolerance: 0.08,
      rewardElectric: 3,
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
      revision: 2,
      title: '第十三关',
      description: '对称限幅整形：把正弦波的正负峰值对称削平，同时保留过零附近的形状。',
      tolerance: 0.08,
      rewardElectric: 3,
      document: symmetricLimiter(),
    },
    {
      key: 'sine-to-square-v1',
      revision: 2,
      title: '第十四关',
      description: '正弦转方波：利用运放的高增益与输出限幅，把正弦输入整形成对称方波。',
      tolerance: 0.08,
      rewardElectric: 4,
      document: sineToSquare(),
    },
    {
      key: 'frequency-doubler-v1',
      revision: 2,
      title: '第十五关',
      description: '二倍频·全波整流：让每个输入周期产生两个相同的正向峰值，输出基波频率变为输入的两倍。',
      tolerance: 0.09,
      rewardElectric: 5,
      document: frequencyDoubler(),
    },
    {
      key: 'frequency-tripler-v1',
      revision: 2,
      title: '第十六关',
      description: '三倍频·三次谐波选择：先把正弦整形成方波，再用串联谐振网络选出 3 kHz 三次谐波。',
      tolerance: 0.12,
      rewardElectric: 6,
      document: frequencyTripler(),
    },
    {
      key: 'negative-half-wave-rectifier-v1',
      title: '第十七关',
      description: '负半波整流：翻转二极管方向，只保留输入正弦波的负半周。',
      tolerance: 0.06,
      rewardElectric: 2,
      document: negativeHalfWaveRectifier(),
    },
    {
      key: 'diode-clamper-v1',
      title: '第十八关',
      description: '二极管钳位：利用电容储能和二极管导通，把交流波形整体平移到新的直流电平。',
      tolerance: 0.1,
      rewardElectric: 4,
      document: diodeClamper(),
    },
    {
      key: 'double-rc-smoothing-v1',
      title: '第十九关',
      description: '二阶 RC 平滑：级联两节 RC 低通，把方波进一步平滑并衰减高次谐波。',
      tolerance: 0.09,
      rewardElectric: 4,
      document: doubleLowPass(),
    },
    {
      key: 'rl-low-pass-v1',
      title: '第二十关',
      description: 'RL 低通滤波：利用电感阻碍快速电流变化，得到幅度衰减且相位滞后的输出。',
      tolerance: 0.07,
      rewardElectric: 3,
      document: rlFilter(),
    },
    {
      key: 'rl-high-pass-v1',
      title: '第二十一关',
      description: 'RL 高通滤波：取电感两端电压，让较高频率的变化更容易出现在输出。',
      tolerance: 0.07,
      rewardElectric: 3,
      document: rlFilter({ highPass: true }),
    },
    {
      key: 'rlc-band-pass-v1',
      title: '第二十二关',
      description: 'RLC 谐振选频：让串联 LC 在 1 kHz 附近谐振，从输入中选出目标频率。',
      tolerance: 0.09,
      rewardElectric: 4,
      document: rlcBandPass(),
    },
    {
      key: 'rlc-notch-v1',
      title: '第二十三关',
      description: 'RLC 陷波：用并联 LC 在 1 kHz 附近形成高阻，显著压低该频率的输出。',
      tolerance: 0.1,
      rewardElectric: 4,
      document: rlcNotch(),
    },
    {
      key: 'opamp-follower-v1',
      title: '第二十四关',
      description: '运放电压跟随器：构成单位增益负反馈，让输出跟随输入波形。',
      tolerance: 0.05,
      rewardElectric: 2,
      document: opampFollower(),
    },
    {
      key: 'opamp-inverter-v1',
      title: '第二十五关',
      description: '反相放大器：用等值输入与反馈电阻实现增益为 −1 的反相输出。',
      tolerance: 0.06,
      rewardElectric: 3,
      document: opampInverting(),
    },
    {
      key: 'opamp-inverter-gain2-v1',
      title: '第二十六关',
      description: '反相二倍放大：调整反馈电阻比例，得到幅度翻倍、相位反转的输出。',
      tolerance: 0.07,
      rewardElectric: 4,
      document: opampInverting({ gain: 2 }),
    },
    {
      key: 'opamp-noninverting-gain2-v1',
      title: '第二十七关',
      description: '同相二倍放大：用同相负反馈网络得到与输入同相、幅度约为两倍的输出。',
      tolerance: 0.07,
      rewardElectric: 4,
      document: opampNonInverting(),
    },
    {
      key: 'bjt-inverter-v1',
      title: '第二十八关',
      description: 'BJT 方波反相器：让三极管在截止与导通之间切换，把输入方波反相。',
      tolerance: 0.1,
      rewardElectric: 5,
      document: transistorInverter('bjt'),
    },
    {
      key: 'mos-inverter-v1',
      title: '第二十九关',
      description: 'MOS 方波反相器：利用 NMOS 的开关特性，把低电平变高电平、高电平变低电平。',
      tolerance: 0.1,
      rewardElectric: 5,
      document: transistorInverter('mosfet'),
    },
  ];
}

function legacyCircuitChallengeUpdates() {
  return [
    { key: 'legacy-level-1-v2', matchTitle: '第一关', title: '第一关', rewardElectric: 0 },
    { key: 'legacy-level-2-v2', matchTitle: '第二关', title: '第二关', rewardElectric: 1 },
    { key: 'legacy-level-3-v2', matchTitle: '第三关', title: '第三关', rewardElectric: 1 },
    { key: 'legacy-level-4-v2', matchTitle: '第四关', title: '第四关', rewardElectric: 2 },
    { key: 'legacy-level-5-v2', matchTitle: '第五关', title: '第五关', rewardElectric: 2 },
    { key: 'legacy-level-6-v2', matchTitle: '第六关', title: '第六关', rewardElectric: 4 },
  ];
}

module.exports = { circuitChallengeCatalog, legacyCircuitChallengeUpdates };
