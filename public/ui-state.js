// Presentation only: callers own requests, permissions and data. No retries run automatically.
(() => {
  const states = new Set(['loading', 'empty', 'error', 'ready']);

  function set(container, kind) {
    if (!states.has(kind)) throw new TypeError('Unknown UI state');
    if (!container) return;
    container.dataset.uiState = kind;
    container.setAttribute('aria-busy', String(kind === 'loading'));
  }

  function create(doc, { kind, title, message, eyebrow, action, tag = 'div' }) {
    if (!['loading', 'empty', 'error'].includes(kind)) throw new TypeError('Invalid message state');
    if (!['div', 'li', 'article'].includes(tag)) throw new TypeError('Invalid state element');
    const node = doc.createElement(tag);
    node.className = 'ui-state';
    node.dataset.uiState = kind;
    node.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    node.setAttribute('aria-atomic', 'true');
    for (const [className, value, element] of [
      ['ui-state-eyebrow', eyebrow, 'span'],
      ['ui-state-title', title, 'strong'],
      ['ui-state-message', message, 'p'],
    ]) {
      if (!value) continue;
      const child = doc.createElement(element);
      child.className = className;
      child.textContent = value;
      node.append(child);
    }
    if (action?.label) {
      // State links are local navigation; arbitrary HTML, URLs and event attributes are not accepted.
      if (
        action.href &&
        (!/^\/(?!\/)/.test(action.href) ||
          [...action.href].some((character) => character === '\\' || character.charCodeAt(0) < 32))
      )
        throw new TypeError('State actions require a local URL');
      const button = doc.createElement(action.href ? 'a' : 'button');
      button.className = 'bbs-action';
      button.dataset.actionTone = 'secondary';
      button.textContent = action.label;
      if (action.href) button.setAttribute('href', action.href);
      else button.setAttribute('type', 'button');
      if (action.key) button.dataset.action = action.key;
      if (typeof action.onClick === 'function') button.addEventListener('click', action.onClick);
      node.append(button);
    }
    return node;
  }

  function render(container, options) {
    if (!container) return null;
    const { kind, content } = options;
    if (kind === 'ready') throw new TypeError('Use set() when rendering real data');
    if (!['loading', 'empty', 'error'].includes(kind)) throw new TypeError('Invalid message state');
    // An existing layout can supply its trusted DOM node without duplicating state semantics.
    const node = content || create(container.ownerDocument, options);
    node.dataset.uiState = kind;
    node.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    node.setAttribute('aria-atomic', 'true');
    set(container, kind);
    container.replaceChildren(node);
    return node;
  }

  const api = Object.freeze({ set, create, render });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.freeBbsUiState = api;
})();
