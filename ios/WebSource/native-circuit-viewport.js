// Native phone camera, adapted from public/circuit-viewport.js. Keep symbol scale uniform.
((root) => {
  if (root.FreeBbsCircuitViewport?.nativeCamera) return;
  const clampZoom = (value) => Math.max(0.25, Math.min(4, value));
  // Keep the schematic point under the pointer stationary while zooming.
  function zoomAt(view, factor, point, baseWidth = 1000) {
    const zoom = clampZoom((baseWidth / view[2]) * factor);
    const ratio = baseWidth / zoom / view[2];
    return [
      point.x - (point.x - view[0]) * ratio,
      point.y - (point.y - view[1]) * ratio,
      view[2] * ratio,
      view[3] * ratio,
    ];
  }
  function create(stage, controls) {
    let baseWidth = 640 * ((stage.clientWidth || window.innerWidth || 1000) / (stage.clientHeight || window.innerHeight || 640));
    let view = [500 - baseWidth / 2, 0, baseWidth, 640];
    let previousIDs = new Set();
    let initialized = false;
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
      if (svg) {
        svg.setAttribute('viewBox', view.join(' '));
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        for (const background of svg.querySelectorAll('[data-native-grid]')) {
          background.setAttribute('x', view[0]); background.setAttribute('y', view[1]);
          background.setAttribute('width', view[2]); background.setAttribute('height', view[3]);
        }
      }
      controls.value.textContent = `${Math.round((baseWidth / view[2]) * 100)}%`;
      controls.out.disabled = view[2] >= baseWidth * 4;
      controls.in.disabled = view[2] <= baseWidth / 4;
    }
    function zoom(factor, point = { x: view[0] + view[2] / 2, y: view[1] + view[3] / 2 }) {
      view = zoomAt(view, factor, point, baseWidth);
      update();
    }
    controls.in.addEventListener('click', () => zoom(1.25));
    controls.out.addEventListener('click', () => zoom(0.8));
    controls.reset.addEventListener('click', () => {
      const centerX=view[0]+view[2]/2, centerY=view[1]+view[3]/2;
      view = [centerX - baseWidth / 2, centerY - 320, baseWidth, 640];
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
            ? zoomAt(gesture.view, distance(entries) / gesture.distance, gesture.point, baseWidth)
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
    function fit() {
      if (!svg) return;
      const parts = [...svg.querySelectorAll('[data-component-id]')];
      if (!parts.length) return;
      const boxes = parts.map(part => part.getBBox());
      // getBBox is local to a transformed component group; use its SVG CTM.
      const bounds = parts.map((part, index) => {
        const box = boxes[index], matrix = svg.getCTM().inverse().multiply(part.getCTM());
        return [[box.x,box.y],[box.x+box.width,box.y+box.height]].map(([x,y]) => {
          const point = svg.createSVGPoint(); point.x=x;point.y=y;
          return point.matrixTransform(matrix);
        });
      }).flat();
      const left = Math.min(...bounds.map(p=>p.x)), right = Math.max(...bounds.map(p=>p.x));
      const top = Math.min(...bounds.map(p=>p.y)), bottom = Math.max(...bounds.map(p=>p.y));
      const height = Math.max(320, bottom-top+120, (right-left+120) * stage.clientHeight / stage.clientWidth);
      const width = height * stage.clientWidth / stage.clientHeight;
      view = [(left+right-width)/2,(top+bottom-height)/2,width,height];update();
    }
    new ResizeObserver(() => {
      if (!stage.clientWidth || !stage.clientHeight) return;
      const zoom = baseWidth / view[2];
      const x = view[0]+view[2]/2, y = view[1]+view[3]/2;
      baseWidth = 640 * stage.clientWidth / stage.clientHeight;
      view = [x-baseWidth/zoom/2,y-640/zoom/2,baseWidth/zoom,640/zoom];update();
    }).observe(stage);
    stage.addEventListener('freebbs-native-fit', fit);
    return {
      attach() {
        svg = stage.querySelector('svg');
        if (!svg) return;
        svg.style.touchAction = 'none';
        // Extend the paper grid with the camera, including above/below the original desktop artboard.
        const ns='http://www.w3.org/2000/svg';
        const defs=document.createElementNS(ns,'defs'), pattern=document.createElementNS(ns,'pattern');
        pattern.id='native-circuit-grid';pattern.setAttribute('width','20');pattern.setAttribute('height','20');pattern.setAttribute('patternUnits','userSpaceOnUse');
        const path=document.createElementNS(ns,'path');path.setAttribute('d','M 20 0 H 0 V 20');path.setAttribute('fill','none');path.setAttribute('stroke','var(--circuit-grid)');path.setAttribute('stroke-width','0.7');path.setAttribute('opacity','0.4');pattern.append(path);defs.append(pattern);
        const background=svg.querySelector('rect');
        const grid=svg.querySelector('[data-grid-size]');
        if (background && grid) {
          background.setAttribute('data-native-grid','');background.setAttribute('fill','var(--circuit-surface)');
          grid.replaceWith(defs);
          const paper=document.createElementNS(ns,'rect');paper.setAttribute('data-native-grid','');paper.setAttribute('fill','url(#native-circuit-grid)');paper.style.pointerEvents='none';background.after(paper);
        }
        const parts=[...svg.querySelectorAll('[data-component-id]')];
        const fresh=parts.filter(part=>!previousIDs.has(part.dataset.componentId));
        update();
        if (!initialized && parts.length) { fit(); initialized=true; }
        else if (fresh.length) {
          const part=fresh[fresh.length-1], matrix=svg.getCTM().inverse().multiply(part.getCTM()), box=part.getBBox();
          const point=svg.createSVGPoint();point.x=box.x+box.width/2;point.y=box.y+box.height/2;
          const center=point.matrixTransform(matrix);
          // Bring a new offscreen part into view without resetting the user's zoom.
          if (center.x<view[0]+40 || center.x>view[0]+view[2]-40 || center.y<view[1]+40 || center.y>view[1]+view[3]-80) {
            view[0]=center.x-view[2]/2;view[1]=center.y-view[3]/2;update();
          }
        }
        previousIDs=new Set(parts.map(part=>part.dataset.componentId));
      },
    };
  }
  const api = { create, zoomAt, nativeCamera: true };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else Object.defineProperty(root, 'FreeBbsCircuitViewport', {value:api,writable:false,configurable:false});
})(typeof window === 'object' ? window : globalThis);
