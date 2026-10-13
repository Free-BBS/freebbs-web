const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { COLORS } = require('../public/knowledge-annotations');

// Execute the real controls and focus helpers against a bounded DOM. The fake
// focus implementation intentionally refuses a DIV, hidden, or detached node.
function annotationFocusHarness() {
  const source = fs.readFileSync(require.resolve('../public/knowledge-annotations'), 'utf8');
  const elements = new Map();
  const listeners = new Map();
  const document = { activeElement: null };
  const element = (id, { parent = null, focusable = true, hidden = false, data = {} } = {}) => {
    const attributes = new Map();
    const node = {
      id,
      parentElement: parent,
      dataset: data,
      hidden,
      disabled: false,
      isConnected: true,
      box: { left: 20, right: 60, top: 120, bottom: 156, width: 40, height: 36 },
      css: { display: 'block', visibility: 'visible' },
      style: { setProperty() {} },
      getBoundingClientRect() {
        return this.box;
      },
      getAttribute(name) {
        return attributes.get(name);
      },
      setAttribute(name, value) {
        attributes.set(name, String(value));
      },
      contains(target) {
        for (let candidate = target; candidate; candidate = candidate.parentElement)
          if (candidate === this) return true;
        return false;
      },
      closest(selector) {
        if (selector === 'button') return focusable ? this : null;
        for (let candidate = this; candidate; candidate = candidate.parentElement) {
          if (selector === '[hidden],.hidden' && candidate.hidden) return candidate;
          if (
            selector === '#learning-annotation-toolbar' &&
            candidate.id === 'learning-annotation-toolbar'
          )
            return candidate;
        }
        return null;
      },
      focus(options) {
        if (!focusable || !this.isConnected || this.disabled || this.closest('[hidden],.hidden'))
          return;
        document.activeElement = this;
        this.lastFocus = options;
      },
      querySelectorAll() {
        return [];
      },
      querySelector() {
        return null;
      },
    };
    if (id) elements.set(id, node);
    return node;
  };
  const body = element('body', { focusable: false });
  document.activeElement = body;
  const toolbar = element('learning-annotation-toolbar', { focusable: false, parent: body });
  const notes = element('notes-opener', { parent: body });
  const commentButton = element('comment-button', {
    parent: toolbar,
    data: { annotationAction: 'comment' },
  });
  const correctionButton = element('correction-button', {
    parent: toolbar,
    data: { annotationAction: 'correction' },
  });
  const popover = element('learning-annotation-popover', {
    parent: body,
    focusable: false,
    hidden: true,
  });
  const commentField = element('comment-field', {
    parent: popover,
    focusable: false,
    hidden: true,
  });
  const comment = element('learning-annotation-comment', { parent: commentField });
  comment.value = '';
  const dismiss = element('dismiss-button', { parent: popover, data: { annotationUi: 'dismiss' } });
  const cancel = element('cancel-button', { parent: popover, data: { annotationUi: 'close' } });
  const outside = element('outside-input', { parent: body });
  const menus = [];
  const palettes = {};
  const colors = {};
  for (const type of ['highlight', 'underline']) {
    const menu = element(`${type}-toggle`, { parent: toolbar, data: { annotationMenu: type } });
    const palette = element(`${type}-palette`, { parent: toolbar, hidden: true, focusable: false });
    menu.setAttribute('aria-controls', palette.id);
    menu.setAttribute('aria-expanded', 'false');
    palettes[type] = palette;
    colors[type] = COLORS.map((color) =>
      element(`${type}-${color}`, {
        parent: palette,
        data: { annotationColor: color, annotationPalette: type },
      }),
    );
    colors[type].forEach((color) => color.setAttribute('aria-pressed', 'false'));
    colors[type][type === 'highlight' ? 0 : 2].setAttribute('aria-pressed', 'true');
    palette.querySelector = (selector) =>
      selector === '[aria-pressed="true"]'
        ? colors[type].find((color) => color.getAttribute('aria-pressed') === 'true')
        : colors[type][0];
    menus.push(menu);
  }
  toolbar.querySelectorAll = (selector) => {
    if (selector === '[data-annotation-menu]') return menus;
    const type = /data-annotation-palette="(highlight|underline)"/.exec(selector)?.[1];
    return type ? colors[type] : [];
  };
  toolbar.querySelector = (selector) => {
    if (selector === '[data-annotation-action="comment"]') return commentButton;
    if (selector === '[data-annotation-action="correction"]') return correctionButton;
    return null;
  };
  const state = {
    composeMode: 'comment',
    colors: { highlight: 'yellow', underline: 'blue' },
    selection: { quote: '当前知识点原文', blockId: 'body-p0', documentVersion: 'a'.repeat(64) },
    selectedEntry: null,
    saveDraft: null,
    popoverEntry: null,
    popoverTarget: null,
    popoverReturnTarget: null,
    pending: null,
  };
  document.addEventListener = (type, callback) => listeners.set(type, callback);
  const context = {
    state,
    document,
    annotationToolbar: toolbar,
    popover,
    commentField,
    COLORS,
    directory: { open: false },
    locationRequest: 0,
    byId: (id) => elements.get(id),
    root: { innerWidth: 390, innerHeight: 700, getComputedStyle: (node) => node.css },
    page: { querySelector: () => notes },
    showToolbar() {},
    act(action) {
      assert.ok(['comment', 'correction'].includes(action), 'focus UI never saves or sends');
      state.composeMode = action;
      context.api.openComment();
    },
  };
  const slice = (first, next) => {
    const start = source.indexOf(first);
    const end = source.indexOf(next, start);
    assert.ok(start >= 0 && end > start);
    return source.slice(start, end);
  };
  vm.runInNewContext(
    [
      slice('    function positionPopover(', '    function strip(container)'),
      slice(
        '    function closePalettes(',
        "    popover?.addEventListener('click', handleControls);",
      ),
      slice(
        "    document.addEventListener('keydown', (event) => {",
        '    function editorSnapshot(style)',
      ),
      'this.api = { handleControls, closePalettes, closePopover, showPopover, openComment, focusAnnotationTarget, positionPalette };',
    ].join('\n'),
    context,
  );
  const click = (target, detail = 1) => context.api.handleControls({ target, detail });
  const escape = () => {
    const event = {
      key: 'Escape',
      target: document.activeElement,
      defaultPrevented: false,
      stopped: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {
        this.stopped = true;
      },
    };
    listeners.get('keydown')(event);
    return event;
  };
  return {
    api: context.api,
    state,
    document,
    body,
    toolbar,
    notes,
    commentButton,
    correctionButton,
    popover,
    commentField,
    comment,
    dismiss,
    cancel,
    outside,
    menus,
    palettes,
    colors,
    click,
    escape,
    outsideClick: () => listeners.get('click')({ target: outside }),
  };
}

test('keyboard-opened independent palettes focus current color and Enter returns to matching menu', () => {
  for (const [index, type] of ['highlight', 'underline'].entries()) {
    const h = annotationFocusHarness();
    const other = type === 'highlight' ? 'underline' : 'highlight';
    const oldOther = h.state.colors[other];
    h.menus[index].focus();
    h.click(h.menus[index], 0);
    assert.equal(h.document.activeElement.dataset.annotationColor, h.state.colors[type]);
    const color = h.colors[type].find((node) => node.dataset.annotationColor === 'purple');
    color.focus();
    h.click(color, 0); // A native button's Enter activation emits click with detail 0.
    assert.equal(h.state.colors[type], 'purple');
    assert.equal(h.state.colors[other], oldOther, 'the other tool keeps its own color');
    assert.equal(h.document.activeElement, h.menus[index]);
    assert.equal(h.palettes[type].hidden, true);
    assert.equal(h.menus[index].getAttribute('aria-expanded'), 'false');
    assert.equal(h.state.saveDraft, null, 'choosing color is not a save');
  }
});

test('palette Escape restores its visible menu without dismissing an underlying comment editor', () => {
  const h = annotationFocusHarness();
  h.click(h.commentButton, 0);
  h.comment.value = '未保存的批注';
  h.click(h.menus[1], 0);
  const event = h.escape();
  assert.equal(h.document.activeElement, h.menus[1]);
  assert.equal(h.palettes.underline.hidden, true);
  assert.equal(h.popover.hidden, false);
  assert.equal(h.comment.value, '未保存的批注');
  assert.ok(
    event.defaultPrevented && event.stopped,
    'handled Escape does not close another page tool',
  );
});

test('fresh comment and correction Escape return to their real buttons and retain exact drafts', () => {
  for (const kind of ['comment', 'correction']) {
    const h = annotationFocusHarness();
    const button = kind === 'comment' ? h.commentButton : h.correctionButton;
    h.click(button, 0);
    assert.equal(h.document.activeElement, h.comment);
    const draft = { key: 'pending-own-write', signature: 'private-current-anchor' };
    const anchor = h.state.selection;
    h.state.saveDraft = draft;
    h.comment.value = '带有🙂与空格的完整草稿 ';
    const event = h.escape();
    assert.equal(h.popover.hidden, true);
    assert.equal(
      h.document.activeElement,
      button,
      'focus must not fall on BODY or a non-focusable toolbar DIV',
    );
    assert.equal(button.lastFocus.preventScroll, true);
    assert.equal(h.state.saveDraft, draft);
    assert.equal(h.state.selection, anchor);
    assert.equal(h.comment.value, '带有🙂与空格的完整草稿 ');
    assert.ok(event.defaultPrevented && event.stopped);
    h.click(button, 0);
    assert.equal(h.comment.value, '带有🙂与空格的完整草稿 ', 'reopen resumes the same draft');
  }
});

test('X preserves a dirty draft while explicit Cancel alone discards its content and save intent', () => {
  const h = annotationFocusHarness();
  h.click(h.commentButton);
  h.comment.value = '还未保存';
  const selected = { id: 'own-entry', revision: 4 };
  const draft = { key: 'draft-key', signature: 'CAS-intent' };
  h.state.selectedEntry = selected;
  h.state.saveDraft = draft;
  h.click(h.dismiss);
  assert.equal(h.document.activeElement, h.commentButton);
  assert.equal(h.comment.value, '还未保存');
  assert.equal(h.state.selectedEntry, selected);
  assert.equal(h.state.saveDraft, draft);
  h.click(h.commentButton);
  h.click(h.cancel);
  assert.equal(h.document.activeElement, h.commentButton);
  assert.equal(h.comment.value, '');
  assert.equal(h.state.selectedEntry, null);
  assert.equal(h.state.saveDraft, null);
});

test('outside pointer closes palettes without stealing an outside control focus or erasing a draft', () => {
  const h = annotationFocusHarness();
  h.click(h.commentButton);
  h.comment.value = '仍在写';
  h.click(h.menus[0], 1);
  h.outside.focus();
  h.outsideClick();
  assert.equal(h.palettes.highlight.hidden, true);
  assert.equal(h.document.activeElement, h.outside);
  assert.equal(h.popover.hidden, false);
  assert.equal(h.comment.value, '仍在写');
});

test('Escape with no annotation layer open is not consumed and cannot refocus a stale opener', () => {
  const h = annotationFocusHarness();
  h.state.popoverReturnTarget = h.commentButton;
  h.outside.focus();
  const event = h.escape();
  assert.equal(h.document.activeElement, h.outside);
  assert.equal(event.defaultPrevented, false);
  assert.equal(event.stopped, false);
});

test('hidden detached disabled offscreen and non-focusable return targets fall back to a visible tool', () => {
  for (const invalid of ['hidden', 'detached', 'disabled', 'offscreen', 'div']) {
    const h = annotationFocusHarness();
    h.click(h.correctionButton);
    const marker = invalid === 'div' ? h.toolbar : h.outside;
    if (invalid === 'hidden') marker.hidden = true;
    if (invalid === 'detached') marker.isConnected = false;
    if (invalid === 'disabled') marker.disabled = true;
    if (invalid === 'offscreen')
      marker.box = { left: 20, right: 60, top: 710, bottom: 750, width: 40, height: 40 };
    h.state.popoverReturnTarget = marker;
    h.escape();
    assert.equal(h.document.activeElement, h.correctionButton, invalid);
  }
});

test('when the toolbar is hidden, dismissal returns to its visible notes entry instead of BODY', () => {
  const h = annotationFocusHarness();
  h.click(h.commentButton);
  h.toolbar.hidden = true;
  h.escape();
  assert.equal(h.document.activeElement, h.notes);
  assert.equal(h.popover.hidden, true);
});

test('a bottom-edge palette flips above its menu and stays inside the visual viewport', () => {
  const h = annotationFocusHarness();
  const palette = h.palettes.underline;
  const menu = h.menus[1];
  palette.hidden = false;
  palette.box = { left: 260, right: 420, top: 690, bottom: 742, width: 160, height: 52 };
  palette.offsetLeft = 0;
  palette.offsetTop = 44;
  menu.box = { left: 300, right: 324, top: 644, bottom: 680, width: 24, height: 36 };
  h.api.positionPalette(palette, menu);
  assert.equal(palette.style.left, '-38px');
  assert.equal(palette.style.top, '-62px');
  const projectedLeft = palette.box.left + Number.parseFloat(palette.style.left);
  const projectedTop = palette.box.top + Number.parseFloat(palette.style.top) - palette.offsetTop;
  assert.ok(projectedLeft >= 8 && projectedLeft + palette.box.width <= 382);
  assert.equal(projectedTop + palette.box.height, menu.box.top - 8);
  assert.equal(h.state.saveDraft, null, 'positioning does not create a save intent');
});
