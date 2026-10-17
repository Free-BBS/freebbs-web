(() => {
  'use strict';
  document.documentElement.classList.add('js');
  const header = document.querySelector('.site-header');
  const menuButton = document.querySelector('.menu-toggle');
  const nav = document.querySelector('#navigation');
  const setMenu = (open) => {
    header.classList.toggle('menu-open', open);
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.setAttribute('aria-label', open ? '关闭导航' : '打开导航');
  };
  menuButton.addEventListener('click', () => setMenu(menuButton.getAttribute('aria-expanded') !== 'true'));
  nav.addEventListener('click', (event) => { if (event.target.closest('a')) setMenu(false); });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && header.classList.contains('menu-open')) { setMenu(false); menuButton.focus(); }
  });
  const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 35);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  window.matchMedia('(min-width: 761px)').addEventListener('change', (event) => { if (event.matches) setMenu(false); });

  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const panels = [...document.querySelectorAll('.practice-panel')];
  const selectTab = (tab) => {
    tabs.forEach((item) => {
      const active = item === tab;
      item.setAttribute('aria-selected', String(active));
      item.tabIndex = active ? 0 : -1;
    });
    panels.forEach((panel) => { panel.hidden = panel.id !== tab.getAttribute('aria-controls'); });
  };
  document.querySelector('.practice-tabs').hidden = false;
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', (event) => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next !== undefined) { event.preventDefault(); selectTab(tabs[next]); tabs[next].focus(); }
    });
  });
  selectTab(tabs[0]);

  const activities = [...document.querySelectorAll('.activity')];
  const activityImage = document.querySelector('#activity-image');
  const activityGallery = document.querySelector('#activity-gallery');
  const activityPhoto = document.querySelector('.activity-photo');
  const lifeLayout = document.querySelector('.life-layout');
  const mobileLayout = window.matchMedia('(max-width: 760px)');
  const syncActivity = () => {
    const active = activities.find((activity) => activity.open);
    if (active) {
      const showGallery = active.dataset.gallery === 'interest';
      activityImage.hidden = showGallery;
      activityGallery.hidden = !showGallery;
      if (!showGallery) {
        const source = `assets/${active.dataset.image}.webp`;
        if (activityImage.getAttribute('src') !== source) activityImage.src = source;
        activityImage.alt = active.dataset.alt;
      }
    }
    const destination = mobileLayout.matches && active ? active : lifeLayout;
    activityPhoto.hidden = mobileLayout.matches && !active;
    if (activityPhoto.parentElement !== destination) destination.append(activityPhoto);
  };
  activities.forEach((activity) => {
    activity.addEventListener('toggle', () => {
      if (activity.open) activities.forEach((other) => { if (other !== activity) other.open = false; });
      syncActivity();
    });
  });
  mobileLayout.addEventListener('change', syncActivity);
  syncActivity();

  const dialog = document.querySelector('.photo-dialog');
  const dialogImage = document.querySelector('#dialog-image');
  const dialogTitle = document.querySelector('#photo-dialog-title');
  const stage = document.querySelector('.photo-stage');
  const canvas = document.querySelector('.photo-canvas');
  const galleryControls = document.querySelector('.dialog-gallery-controls');
  const zoomOut = document.querySelector('.dialog-zoom-out');
  const zoomIn = document.querySelector('.dialog-zoom-in');
  const closeButton = document.querySelector('.dialog-close');
  const galleryButtons = [...activityGallery.querySelectorAll('.photo-button')];
  let returnFocus;
  let photos = [];
  let photoIndex = 0;
  let zoom = 1;
  let fittedWidth = 1;
  let fittedHeight = 1;
  let imageRequest = 0;
  const pointers = new Map();
  let drag;
  let pinch;

  const setZoom = (value, anchor) => {
    const stageBox = stage.getBoundingClientRect();
    const imageBox = dialogImage.getBoundingClientRect();
    const point = anchor || { x: stage.clientWidth / 2, y: stage.clientHeight / 2 };
    const focusX = imageBox.width ? (stageBox.left + point.x - imageBox.left) / imageBox.width : .5;
    const focusY = imageBox.height ? (stageBox.top + point.y - imageBox.top) / imageBox.height : .5;
    zoom = Math.min(4, Math.max(1, value));
    const width = fittedWidth * zoom;
    const height = fittedHeight * zoom;
    const canvasWidth = Math.max(stage.clientWidth, width + 24);
    const canvasHeight = Math.max(stage.clientHeight, height + 24);
    canvas.style.width = zoom === 1 ? '100%' : `${canvasWidth}px`;
    canvas.style.height = zoom === 1 ? '100%' : `${canvasHeight}px`;
    dialogImage.style.width = `${width}px`;
    dialogImage.style.height = `${height}px`;
    stage.classList.toggle('is-zoomed', zoom > 1);
    zoomOut.disabled = zoom <= 1;
    zoomIn.disabled = zoom >= 4;
    if (zoom === 1) {
      stage.scrollLeft = 0;
      stage.scrollTop = 0;
    } else {
      stage.scrollLeft = (canvasWidth - width) / 2 + Math.min(1, Math.max(0, focusX)) * width - point.x;
      stage.scrollTop = (canvasHeight - height) / 2 + Math.min(1, Math.max(0, focusY)) * height - point.y;
    }
  };
  const fitImage = () => {
    if (!dialog.open || !dialogImage.naturalWidth) return;
    const box = stage.getBoundingClientRect();
    const fit = Math.min(1, Math.max(1, box.width - 24) / dialogImage.naturalWidth, Math.max(1, box.height - 24) / dialogImage.naturalHeight);
    fittedWidth = dialogImage.naturalWidth * fit;
    fittedHeight = dialogImage.naturalHeight * fit;
    setZoom(zoom);
  };
  dialogImage.addEventListener('load', fitImage);
  const showPhoto = () => {
    const button = photos[photoIndex];
    const thumbnail = button.querySelector('img');
    const request = ++imageRequest;
    zoom = 1;
    pointers.clear();
    drag = pinch = undefined;
    stage.classList.remove('is-dragging');
    dialogImage.alt = thumbnail.alt;
    dialogTitle.textContent = button.dataset.title + (photos.length > 1 ? ` · ${photoIndex + 1} / ${photos.length}` : '');
    // Show the existing preview immediately; request the original only when opened.
    dialogImage.src = thumbnail.currentSrc || thumbnail.src;
    if (dialogImage.complete) fitImage();
    const original = new Image();
    original.onload = () => {
      if (request === imageRequest && dialog.open) dialogImage.src = original.src;
    };
    original.src = `assets/${button.dataset.photo}.webp`;
  };
  const changePhoto = (direction) => {
    if (photos.length < 2) return;
    photoIndex = (photoIndex + direction + photos.length) % photos.length;
    showPhoto();
  };
  document.querySelectorAll('.photo-button').forEach((button) => {
    button.addEventListener('click', () => {
      returnFocus = button;
      photos = galleryButtons.includes(button) ? galleryButtons : [button];
      photoIndex = photos.indexOf(button);
      galleryControls.hidden = photos.length < 2;
      dialog.showModal();
      showPhoto();
      closeButton.focus({ preventScroll: true });
    });
  });
  closeButton.addEventListener('click', () => dialog.close());
  document.querySelector('.dialog-prev').addEventListener('click', () => changePhoto(-1));
  document.querySelector('.dialog-next').addEventListener('click', () => changePhoto(1));
  zoomOut.addEventListener('click', () => setZoom(zoom / 1.5));
  zoomIn.addEventListener('click', () => setZoom(zoom * 1.5));
  document.querySelector('.dialog-zoom-reset').addEventListener('click', () => setZoom(1));
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft' && photos.length > 1) { event.preventDefault(); changePhoto(-1); }
    if (event.key === 'ArrowRight' && photos.length > 1) { event.preventDefault(); changePhoto(1); }
    if (event.key === '+' || event.key === '=') { event.preventDefault(); setZoom(zoom * 1.5); }
    if (event.key === '-') { event.preventDefault(); setZoom(zoom / 1.5); }
    if (event.key === '0') { event.preventDefault(); setZoom(1); }
  });
  const localPoint = (event) => {
    const box = stage.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };
  const startDrag = (point, canSwipe = true) => {
    drag = { ...point, left: stage.scrollLeft, top: stage.scrollTop, canSwipe };
  };
  stage.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    stage.setPointerCapture(event.pointerId);
    const point = localPoint(event);
    pointers.set(event.pointerId, point);
    if (pointers.size === 1) startDrag(point);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), zoom };
      drag = undefined;
    }
    stage.classList.toggle('is-dragging', zoom > 1);
  });
  stage.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId)) return;
    const point = localPoint(event);
    pointers.set(event.pointerId, point);
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      setZoom(pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y) / pinch.distance, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    } else if (pointers.size === 1 && drag && zoom > 1) {
      stage.scrollLeft = drag.left - (point.x - drag.x);
      stage.scrollTop = drag.top - (point.y - drag.y);
    }
  });
  const endPointer = (event) => {
    const point = localPoint(event);
    if (event.type === 'pointerup' && pointers.size === 1 && drag?.canSwipe && zoom === 1) {
      const dx = point.x - drag.x;
      const dy = point.y - drag.y;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) changePhoto(dx < 0 ? 1 : -1);
    }
    pointers.delete(event.pointerId);
    pinch = undefined;
    if (pointers.size === 1) startDrag([...pointers.values()][0], false);
    else drag = undefined;
    if (!pointers.size) stage.classList.remove('is-dragging');
  };
  stage.addEventListener('pointerup', endPointer);
  stage.addEventListener('pointercancel', endPointer);
  stage.addEventListener('dblclick', (event) => setZoom(zoom > 1 ? 1 : 2, localPoint(event)));
  stage.addEventListener('wheel', (event) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    setZoom(zoom * Math.exp(-event.deltaY * .01), localPoint(event));
  }, { passive: false });
  window.addEventListener('resize', fitImage);
  dialog.addEventListener('click', (event) => {
    const box = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) dialog.close();
  });
  dialog.addEventListener('close', () => {
    imageRequest++;
    pointers.clear();
    drag = pinch = undefined;
    stage.classList.remove('is-dragging');
    returnFocus?.focus({ preventScroll: true });
  });

  const navLinks = [...nav.querySelectorAll('a')];
  const sectionObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      navLinks.forEach((link) => {
        if (link.hash === `#${entry.target.id}`) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      });
    });
  }, { rootMargin: '-20% 0px -60% 0px', threshold: 0 });
  document.querySelectorAll('main > section[id]').forEach((section) => sectionObserver.observe(section));
})();
