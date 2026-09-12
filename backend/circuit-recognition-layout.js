// Keep the recognition entry point backed by the same layout used in the editor.
const { normalizeCircuitLayout } = require('../public/circuit-layout');

module.exports = { normalizeRecognizedCircuitLayout: normalizeCircuitLayout };
