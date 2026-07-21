(() => {
  const markedApi = window.marked || globalThis.marked;
  const katexApi = window.katex || globalThis.katex;

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function renderLatex(source, displayMode) {
    const tex = String(source || '').trim();

    if (!tex) {
      return '';
    }

    if (!katexApi || typeof katexApi.renderToString !== 'function') {
      return `<code class="math-fallback">${escapeHtml(tex)}</code>`;
    }

    try {
      return katexApi.renderToString(tex, {
        displayMode,
        output: 'htmlAndMathml',
        strict: 'ignore',
        throwOnError: false,
        trust: false,
      });
    } catch {
      return `<code class="math-fallback">${escapeHtml(tex)}</code>`;
    }
  }

  function stash(source, pattern, store) {
    return source.replace(pattern, (match) => {
      const key = `@@DEMO_STASH_${store.length}@@`;
      store.push({
        key,
        value: match,
      });
      return key;
    });
  }

  function restore(source, store) {
    return store.reduce((result, item) => result.replace(item.key, item.value), source);
  }

  function renderMath(source) {
    return source
      .replace(
        /\$\$[ \t]*\n?([\s\S]+?)\n?\$\$/g,
        (_match, tex) => `\n<div class="math-block">${renderLatex(tex, true)}</div>\n`,
      )
      .replace(
        /\\\[[ \t]*\n?([\s\S]+?)\n?\\\]/g,
        (_match, tex) => `\n<div class="math-block">${renderLatex(tex, true)}</div>\n`,
      )
      .replace(
        /\\\(((?:\\.|[^\\\n])+?)\\\)/g,
        (_match, tex) => `<span class="math-inline">${renderLatex(tex, false)}</span>`,
      )
      .replace(
        /\$(?!\$)((?:\\.|[^\n$\\])+?)\$/g,
        (_match, tex) => `<span class="math-inline">${renderLatex(tex, false)}</span>`,
      );
  }

  function configureMarked() {
    if (!markedApi || typeof markedApi.parse !== 'function') {
      return false;
    }

    markedApi.setOptions({
      breaks: false,
      gfm: true,
    });

    return true;
  }

  const isConfigured = configureMarked();

  function render(markdown) {
    if (!isConfigured) {
      return `<pre class="markdown-fallback">${escapeHtml(markdown)}</pre>`;
    }

    const codeStore = [];
    const rawMarkdown = String(markdown || '').trim();
    const protectedMarkdown = stash(
      stash(rawMarkdown, /(```[\s\S]*?```|~~~[\s\S]*?~~~)/g, codeStore),
      /`[^`\n]+`/g,
      codeStore,
    );
    const mathRenderedMarkdown = renderMath(protectedMarkdown);
    const restoredMarkdown = restore(mathRenderedMarkdown, codeStore);

    return markedApi.parse(restoredMarkdown);
  }

  window.DEMO_MARKDOWN_RENDERER = {
    render,
    renderLatex,
  };
})();
