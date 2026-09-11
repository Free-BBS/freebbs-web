(function circuitHistoryModule(root) {
  // History is local to one editor document, never part of a shared circuit.
  function create({ limit = 60, mergeWindow = 800, now = () => Date.now() } = {}) {
    let entries = [];
    let index = -1;
    let lastGroup = null;
    let lastTime = 0;
    const clearGroup = () => {
      lastGroup = null;
      lastTime = 0;
    };
    function reset(snapshot) {
      entries = [JSON.stringify(snapshot)];
      index = 0;
      clearGroup();
    }
    function record(snapshot, { group = null } = {}) {
      const serialized = JSON.stringify(snapshot);
      if (index < 0) {
        reset(snapshot);
        return false;
      }
      if (entries[index] === serialized) return false;
      const time = now();
      const merge =
        group !== null && group === lastGroup && time - lastTime <= mergeWindow && index > 0;
      entries = entries.slice(0, index + 1);
      if (merge) entries[index] = serialized;
      else {
        entries.push(serialized);
        if (entries.length > limit + 1) entries.shift();
        index = entries.length - 1;
      }
      lastGroup = group;
      lastTime = time;
      return true;
    }
    function travel(direction) {
      const next = index + direction;
      if (next < 0 || next >= entries.length) return null;
      index = next;
      clearGroup();
      return JSON.parse(entries[index]);
    }
    return {
      reset,
      record,
      undo: () => travel(-1),
      redo: () => travel(1),
      canUndo: () => index > 0,
      canRedo: () => index >= 0 && index < entries.length - 1,
      breakGroup: clearGroup,
      synchronize(snapshot) {
        if (index < 0) reset(snapshot);
        else entries[index] = JSON.stringify(snapshot);
        clearGroup();
      },
    };
  }

  function electricalKey(document) {
    return JSON.stringify({
      components: document.components.map(({ id, type, params }) => ({ id, type, params })),
      wires: document.wires.map(({ from, to }) => ({ from, to })),
      analysis: document.analysis,
    });
  }

  const api = { create, electricalKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FreeBbsCircuitHistory = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
