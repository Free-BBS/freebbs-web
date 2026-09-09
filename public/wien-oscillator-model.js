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

  const model = Object.freeze({ validParameters, evaluate });
  if (typeof module === 'object' && module.exports) module.exports = model;
  else Object.assign(root, { freeBbsWienModel: model });
})(typeof window === 'undefined' ? globalThis : window);
