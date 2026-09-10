(function circuitShortcuts(root) {
  const arrows = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  };

  function commandFor(event) {
    if (
      event.isComposing ||
      event.keyCode === 229 ||
      event.altKey ||
      event.getModifierState?.('AltGraph') ||
      typeof event.key !== 'string'
    )
      return null;
    const key = event.key.toLowerCase();
    if (event.ctrlKey || event.metaKey) {
      if (key === 'z') return { action: event.shiftKey ? 'redo' : 'undo', detail: {} };
      if (event.shiftKey) return null;
      if (key === 's') return { action: 'save', detail: {} };
      if (key === 'enter') return { action: 'run', detail: {} };
      if (key === 'd') return { action: 'duplicate', detail: {} };
      if (key === 'y' && event.ctrlKey && !event.metaKey) return { action: 'redo', detail: {} };
      return null;
    }
    if (Object.hasOwn(arrows, event.key)) {
      const [dx, dy] = arrows[event.key];
      const step = event.shiftKey ? 5 : 1;
      return { action: 'move', detail: { dx: dx * step, dy: dy * step } };
    }
    if (key === 'r') return { action: 'rotate', detail: { turns: event.shiftKey ? -1 : 1 } };
    if (key === '?' || (key === '/' && event.shiftKey)) return { action: 'help', detail: {} };
    if (event.shiftKey) return null;
    if (key === 'x' || key === 'y') return { action: 'mirror', detail: { axis: key } };
    const actions = {
      d: 'duplicate',
      delete: 'delete',
      backspace: 'delete',
      w: 'wire',
      escape: 'cancel',
      m: 'max',
    };
    return Object.hasOwn(actions, key) ? { action: actions[key], detail: {} } : null;
  }

  function eventElements(event) {
    const path = event.composedPath?.() || [event.target];
    return path.map((node) => (node?.nodeType === 3 ? node.parentElement : node)).filter(Boolean);
  }

  function isTyping(elements) {
    return elements.some((element) => {
      if (element.isContentEditable) return true;
      if (
        element.closest?.(
          'input,textarea,select,[role="textbox"],[role="combobox"],[role="spinbutton"]',
        )
      )
        return true;
      const editable = element.closest?.('[contenteditable]');
      return editable && editable.getAttribute('contenteditable') !== 'false';
    });
  }

  function create(options = {}) {
    const target = options.target || root.document;
    const isActive = options.isActive || (() => true);
    const dispatch = options.dispatch || (() => false);
    const { helpButton, helpDialog } = options;
    const closeButton = helpDialog?.querySelector('[data-circuit-shortcuts-close]');
    let bound = false;
    let previousFocus = null;

    function finishClosing() {
      if (helpDialog?.open) return;
      helpButton?.setAttribute('aria-expanded', 'false');
      const previous = previousFocus?.isConnected === false ? helpButton : previousFocus;
      previousFocus = null;
      if (previous?.isConnected !== false) previous?.focus?.({ preventScroll: true });
    }
    function openHelp() {
      if (!isActive() || !helpDialog || helpDialog.open) return false;
      previousFocus = target?.activeElement || root.document?.activeElement || helpButton;
      options.onHelpOpen?.();
      if (helpDialog.showModal) helpDialog.showModal();
      else helpDialog.setAttribute('open', '');
      helpButton?.setAttribute('aria-expanded', 'true');
      closeButton?.focus({ preventScroll: true });
      return true;
    }
    function closeHelp() {
      if (!helpDialog?.open) return false;
      if (helpDialog.close) helpDialog.close();
      else helpDialog.removeAttribute('open');
      finishClosing();
      return true;
    }
    function cancelHelp(event) {
      event.preventDefault();
      closeHelp();
    }
    function handleKeydown(event) {
      if (!isActive() || event.defaultPrevented) return false;
      const command = commandFor(event);
      if (!command) return false;
      if (helpDialog?.open) {
        event.preventDefault();
        return command.action === 'cancel' ? closeHelp() : true;
      }
      const elements = eventElements(event);
      if (command.action !== 'save' && isTyping(elements)) return false;
      // Wire point controls own their movement, removal and cancellation. Their
      // bubbling handlers normally preventDefault too; keep this boundary explicit.
      if (
        ['move', 'delete', 'cancel'].includes(command.action) &&
        elements.some((element) => element.closest?.('[data-wire-controls]'))
      )
        return false;
      // Suppress auto-repeat without letting a repeated Cmd+D or Cmd+S fall
      // through to the browser after the first editor command.
      if (event.repeat && command.action !== 'move') {
        event.preventDefault();
        return true;
      }
      const handled =
        command.action === 'help'
          ? openHelp()
          : dispatch(command.action, command.detail, event) !== false;
      if (handled) event.preventDefault();
      return handled;
    }
    function bind() {
      if (bound) return api;
      target?.addEventListener('keydown', handleKeydown);
      helpButton?.addEventListener('click', openHelp);
      closeButton?.addEventListener('click', closeHelp);
      helpDialog?.addEventListener('cancel', cancelHelp);
      helpDialog?.addEventListener('close', finishClosing);
      bound = true;
      return api;
    }
    function destroy() {
      closeHelp();
      if (!bound) return;
      target?.removeEventListener('keydown', handleKeydown);
      helpButton?.removeEventListener('click', openHelp);
      closeButton?.removeEventListener('click', closeHelp);
      helpDialog?.removeEventListener('cancel', cancelHelp);
      helpDialog?.removeEventListener('close', finishClosing);
      bound = false;
    }
    const api = { handleKeydown, openHelp, closeHelp, bind, destroy };
    return api;
  }

  const api = Object.freeze({ create, bind: (options) => create(options).bind() });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.FreeBbsCircuitShortcuts = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
