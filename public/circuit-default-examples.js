(() => {
  const engine =
    typeof module !== 'undefined' && module.exports
      ? require('./circuit-engine')
      : globalThis.FreeBbsCircuitEngine;

  function component(type, id, x, y, overrides = {}) {
    return {
      type,
      id,
      x,
      y,
      rotation: 0,
      params: { ...engine.catalog[type].defaults, ...overrides },
    };
  }

  function getDefaultExamples() {
    return ['divider', 'rc', 'diode'].map((name) => {
      const sourceParams =
        name === 'diode' ? { dc: 0, waveform: 'sine', amplitude: 2, frequency: 500 } : { dc: 5 };
      const loadType = { rc: 'capacitor', diode: 'diode', divider: 'resistor' }[name];
      const loadId = { rc: 'C1', diode: 'D1', divider: 'R2' }[name];
      const components = [
        component('voltage', 'V1', 210, 180, sourceParams),
        component('resistor', 'R1', 440, 180),
        component(loadType, loadId, 670, 180),
        component('ground', 'G1', 440, 430),
        component('voltmeter', 'VM1', 670, 360),
      ];
      const connections = [
        ['V1', 0, 'R1', 0],
        ['R1', 1, loadId, 0],
        [loadId, 1, 'G1', 0],
        ['V1', 1, 'G1', 0],
        ['VM1', 0, loadId, 0],
        ['VM1', 1, 'G1', 0],
      ];
      return {
        seedKey: `builtin-${name}-v1`,
        title: { divider: '电阻分压实验', rc: 'RC 充电响应', diode: '二极管伏安与整流' }[name],
        description: {
          divider: '5 V 电源与两个 1 kΩ 电阻，电压表测量输出电压。调整阻值后再次运行。',
          rc: '5 V 阶跃驱动 1 kΩ / 1 μF 电路，从零初始储能观察电容充电。',
          diode: '正弦电压驱动电阻与二极管，观察二极管电压和电流的非线性关系。',
        }[name],
        document: {
          version: 1,
          components,
          wires: connections.map(([fromId, fromPin, toId, toPin], index) => ({
            id: `w${index + 1}`,
            from: { componentId: fromId, pin: fromPin },
            to: { componentId: toId, pin: toPin },
          })),
          analysis:
            name === 'divider'
              ? { type: 'dc' }
              : { type: 'transient', stop: 0.01, step: 0.00002, initial: 'zero' },
        },
      };
    });
  }

  const exported = { getDefaultExamples };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  else globalThis.FreeBbsCircuitDefaultExamples = exported;
})();
