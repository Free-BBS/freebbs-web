((root) => {
  const clampZoom = (value) => Math.max(0.25, Math.min(4, value));
  // Keep the schematic point under the pointer stationary while zooming.
  function zoomAt(view, factor, point) {
    const zoom = clampZoom((1000 / view[2]) * factor);
    const ratio = 1000 / zoom / view[2];
    return [
      point.x - (point.x - view[0]) * ratio,
      point.y - (point.y - view[1]) * ratio,
      1000 / zoom,
      640 / zoom,
    ];
  }
  function create(stage, controls) {
    let view = [0, 0, 1000, 640];
    let svg;
    let pan = false;
    let expanded = false;
    let bodyOverflow;
    let gesture = null;
    let suppressClick = false;
    const pointers = new Map();
    const pointAt = (event) => {
      const point = svg.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      return point.matrixTransform(svg.getScreenCTM().inverse());
    };
    function update() {
      svg?.setAttribute('viewBox', view.join(' '));
      controls.value.textContent = `${Math.round((1000 / view[2]) * 100)}%`;
      controls.out.disabled = view[2] >= 4000;
      controls.in.disabled = view[2] <= 250;
    }
    function zoom(factor, point = { x: view[0] + view[2] / 2, y: view[1] + view[3] / 2 }) {
      view = zoomAt(view, factor, point);
      update();
    }
    controls.in.addEventListener('click', () => zoom(1.25));
    controls.out.addEventListener('click', () => zoom(0.8));
    controls.reset.addEventListener('click', () => {
      view = [0, 0, 1000, 640];
      update();
    });
    controls.pan.addEventListener('click', () => {
      pan = !pan;
      controls.pan.setAttribute('aria-pressed', String(pan));
      stage.classList.toggle('is-panning', pan);
    });
    const panel = stage.closest('.circuit-canvas-panel');
    function expand(value) {
      expanded = value;
      if (expanded) bodyOverflow = document.body.style.overflow;
      document.body.style.overflow = expanded ? 'hidden' : bodyOverflow;
      panel.classList.toggle('is-expanded', expanded);
      controls.expand.setAttribute('aria-pressed', String(expanded));
      controls.expand.title = expanded ? '收起画布区域' : '展开画布区域';
      controls.expand.setAttribute('aria-label', controls.expand.title);
    }
    controls.expand.addEventListener('click', () => expand(!expanded));
    document.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Escape' && expanded) {
          expand(false);
          event.preventDefault();
          event.stopImmediatePropagation();
          controls.expand.focus();
        }
      },
      true,
    );
    stage.addEventListener(
      'wheel',
      (event) => {
        if (!svg || (!event.ctrlKey && !event.metaKey)) return;
        event.preventDefault();
        zoom(Math.exp(-event.deltaY * 0.005), pointAt(event));
      },
      { passive: false },
    );
    const stop = (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const midpoint = (entries) => ({
      clientX: entries.reduce((sum, entry) => sum + entry.clientX, 0) / entries.length,
      clientY: entries.reduce((sum, entry) => sum + entry.clientY, 0) / entries.length,
    });
    const distance = (entries) =>
      entries.length < 2
        ? 0
        : Math.hypot(
            entries[0].clientX - entries[1].clientX,
            entries[0].clientY - entries[1].clientY,
          );
    stage.addEventListener(
      'pointerdown',
      (event) => {
        if (!svg || (event.button !== 0 && event.button !== 1)) return;
        if (!pointers.size) suppressClick = false;
        pointers.set(event.pointerId, {
          clientX: event.clientX,
          clientY: event.clientY,
          target: event.target,
        });
        if (!pan && event.button !== 1 && pointers.size < 2) return;
        // Cancel any single-finger edit before taking over a two-finger gesture.
        if (!gesture) {
          for (const [id, entry] of pointers) {
            if (id === event.pointerId) continue;
            entry.target.dispatchEvent(
              new PointerEvent('pointercancel', { bubbles: true, pointerId: id }),
            );
          }
        }
        const entries = [...pointers.values()];
        gesture = {
          point: pointAt(midpoint(entries)),
          distance: distance(entries),
          view: [...view],
        };
        for (const id of pointers.keys()) stage.setPointerCapture(id);
        suppressClick = true;
        stop(event);
      },
      true,
    );
    stage.addEventListener(
      'pointermove',
      (event) => {
        if (!pointers.has(event.pointerId)) return;
        Object.assign(pointers.get(event.pointerId), {
          clientX: event.clientX,
          clientY: event.clientY,
        });
        if (!gesture) return;
        const entries = [...pointers.values()];
        view =
          gesture.distance > 0
            ? zoomAt(gesture.view, distance(entries) / gesture.distance, gesture.point)
            : [...gesture.view];
        update();
        const current = pointAt(midpoint(entries));
        view[0] += gesture.point.x - current.x;
        view[1] += gesture.point.y - current.y;
        update();
        stop(event);
      },
      true,
    );
    function end(event) {
      // Synthetic cancellation above must reach the renderer without ending the gesture.
      if (event.type === 'pointercancel' && !event.isTrusted) return;
      pointers.delete(event.pointerId);
      if (!gesture) return;
      if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
      if (pointers.size) {
        const entries = [...pointers.values()];
        gesture = {
          point: pointAt(midpoint(entries)),
          distance: distance(entries),
          view: [...view],
        };
      } else gesture = null;
      stop(event);
    }
    stage.addEventListener('pointerup', end, true);
    stage.addEventListener('pointercancel', end, true);
    stage.addEventListener(
      'click',
      (event) => {
        if (suppressClick || pan) stop(event);
      },
      true,
    );
    return {
      attach() {
        svg = stage.querySelector('svg');
        if (svg) svg.style.touchAction = 'none';
        update();
      },
    };
  }
  const api = { create, zoomAt };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FreeBbsCircuitViewport = api;
})(typeof window === 'object' ? window : globalThis);
