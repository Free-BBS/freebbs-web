(function exposeWienModel(root) {
  const fields = ['rgOhms', 'rOhms', 'cFarads', 'rfMinOhms', 'rfMaxOhms', 'rfInitialOhms', 'qMin'];

  function validParameters(parameters) {
    return Boolean(
      parameters &&
      fields.every(
        (field) => typeof parameters[field] === 'number' && Number.isFinite(parameters[field]),
      ) &&
      parameters.rgOhms > 0 &&
      parameters.rOhms > 0 &&
      parameters.cFarads > 0 &&
      parameters.qMin > 0.5 &&
      parameters.rfMinOhms >= 0 &&
      parameters.rfMaxOhms > parameters.rfMinOhms &&
      parameters.rfMaxOhms < 4 * parameters.rgOhms &&
      parameters.rfInitialOhms >= parameters.rfMinOhms &&
      parameters.rfInitialOhms <= parameters.rfMaxOhms,
    );
  }

  // Equal-R/equal-C Wien bridge, ideal noninverting amplifier:
  // (sRC)^2 + (3-A)sRC + 1 = 0, A = 1 + Rf/Rg.
  // This exercise defines startup |Q| from the absolute real part of the poles;
  // it is NOT the passive bridge's Q, nor a steady-state distortion metric.
  function evaluate(parameters, resistanceOhms) {
    if (!validParameters(parameters) || !Number.isFinite(resistanceOhms)) {
      throw new TypeError('Invalid Wien oscillator parameters or resistance');
    }
    const { rgOhms, rOhms, cFarads, qMin, rfMinOhms, rfMaxOhms } = parameters;
    const gain = 1 + resistanceOhms / rgOhms;
    const omega0 = 1 / (rOhms * cFarads);
    const growthRate = ((gain - 3) * omega0) / 2;
    const starts = resistanceOhms > 2 * rgOhms && resistanceOhms < 4 * rgOhms;
    return {
      gain,
      loopGain: gain / 3,
      q: 1 / Math.abs(3 - gain),
      frequencyHz: omega0 / (2 * Math.PI),
      growthRate,
      starts,
      // Compare in resistance space: reciprocal roundoff must not admit Q == qMin.
      satisfies:
        starts &&
        resistanceOhms >= rfMinOhms &&
        resistanceOhms <= rfMaxOhms &&
        resistanceOhms < (2 + 1 / qMin) * rgOhms,
    };
  }

  // Small-signal startup response with v(0) = 1 and dv/dt(0) = 0.
  // Use dimensionless time omega0*t to avoid large intermediate frequencies.
  // One normalization for the entire trace preserves its growth/decay envelope;
  // this ideal linear model does not simulate supply rails or gain stabilization.
  function sampleTransient(parameters, resistanceOhms) {
    const result = evaluate(parameters, resistanceOhms);
    if (resistanceOhms < parameters.rfMinOhms || resistanceOhms > parameters.rfMaxOhms) {
      throw new TypeError('Resistance is outside the Wien rheostat range');
    }
    const durationSeconds = 6 / result.frequencyHz;
    const intervals = 360;
    if (!Number.isFinite(durationSeconds) || durationSeconds / intervals <= 0) {
      throw new TypeError('Wien oscillator time scale is not representable');
    }
    const sigma = (result.gain - 3) / 2;
    const discriminant = 1 - sigma * sigma;
    const points = [];
    let maximum = 0;
    for (let index = 0; index <= intervals; index += 1) {
      const phase = (index / intervals) * 12 * Math.PI;
      let value;
      if (discriminant > 0) {
        const dampedFrequency = Math.sqrt(discriminant);
        value =
          Math.exp(sigma * phase) *
          (Math.cos(dampedFrequency * phase) -
            (sigma / dampedFrequency) * Math.sin(dampedFrequency * phase));
      } else if (discriminant === 0) {
        value = Math.exp(sigma * phase) * (1 - sigma * phase);
      } else {
        const separation = Math.sqrt(-discriminant);
        value =
          ((1 - sigma / separation) * Math.exp((sigma + separation) * phase) +
            (1 + sigma / separation) * Math.exp((sigma - separation) * phase)) /
          2;
      }
      if (!Number.isFinite(value)) {
        throw new TypeError('Wien oscillator transient is not representable');
      }
      maximum = Math.max(maximum, Math.abs(value));
      points.push({ timeSeconds: (index / intervals) * durationSeconds, value });
    }
    for (const point of points) point.value /= maximum;
    return { durationSeconds, points, normalized: true };
  }

  const model = Object.freeze({ validParameters, evaluate, sampleTransient });
  if (typeof module === 'object' && module.exports) module.exports = model;
  else Object.assign(root, { freeBbsWienModel: model });
})(typeof window === 'undefined' ? globalThis : window);
