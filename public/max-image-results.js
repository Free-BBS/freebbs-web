((root) => {
  const imageRequestPattern =
    /(?:生成|画|绘制|创作|设计|做)(?:一|1)?(?:张|幅|个)?[\s\S]{0,80}(?:图片|图像|插画|海报|封面|头像|壁纸|卡通|漫画)|(?:generate|draw|create|design)[\s\S]{0,80}(?:image|picture|illustration|poster|wallpaper)/i;
  const negatedPattern =
    /(?:不要|别|无需|不用|不需要)[^。！？\n]{0,16}(?:生成|画|绘制|图片|图像)|(?:do not|don't|no need to)[^.!?\n]{0,24}(?:generate|draw|image)/i;

  function isRequest(text) {
    const value = String(text || '').trim();
    return Boolean(value && imageRequestPattern.test(value) && !negatedPattern.test(value));
  }

  function statusCopy(message) {
    const value = String(message || 'Max 已收到描述，正在生成画面…');
    if (/保存|整理/.test(value)) {
      return { title: '图片已经生成', detail: value, step: 3 };
    }
    if (/阅读|分析/.test(value)) {
      return { title: '正在理解你的描述', detail: value, step: 1 };
    }
    return {
      title: '正在生成图片',
      detail: 'Max 已开始绘制。通常需要 20–60 秒，可以离开页面，完成后会保存在对话里。',
      step: 2,
    };
  }

  function showProgress(article, message) {
    const bubble = article?.querySelector?.('.aichat-bubble');
    if (!bubble || article?.dataset?.markdown) return;
    const copy = statusCopy(message);
    article.classList.add('is-image-generation');
    article.setAttribute('aria-busy', 'true');
    bubble.innerHTML = `
      <section class="max-image-generation-status" role="status" aria-live="polite">
        <span class="max-image-generation-mark" aria-hidden="true"><i></i></span>
        <span class="max-image-generation-copy">
          <strong>${copy.title}</strong>
          <span>${copy.detail}</span>
        </span>
        <span class="max-image-generation-track" data-step="${copy.step}" aria-hidden="true">
          <i></i><i></i><i></i>
        </span>
        <span class="max-image-generation-steps" aria-hidden="true">
          <small>理解描述</small><small>生成画面</small><small>保存结果</small>
        </span>
      </section>`;
  }

  function buildResultFrame(image) {
    const figure = document.createElement('figure');
    figure.className = 'max-generated-image';
    const caption = document.createElement('figcaption');
    const state = document.createElement('span');
    state.className = 'max-generated-image-state';
    state.textContent = '图片已生成';
    const actions = document.createElement('span');
    actions.className = 'max-generated-image-actions';
    const open = document.createElement('a');
    open.href = image.currentSrc || image.src;
    open.target = '_blank';
    open.rel = 'noopener';
    open.textContent = '查看原图';
    const download = document.createElement('a');
    download.href = image.currentSrc || image.src;
    download.download = '';
    download.textContent = '下载';
    actions.append(open, download);
    caption.append(state, actions);
    image.loading = 'eager';
    image.decoding = 'async';
    figure.append(image, caption);
    return figure;
  }

  function decorate(article) {
    if (!article) return 0;
    article.classList.remove('is-image-generation');
    article.removeAttribute('aria-busy');
    const bubble = article.querySelector?.('.aichat-bubble, .discussion-markdown-body');
    if (!bubble) return 0;
    const images = [...bubble.querySelectorAll('img')].filter((image) => {
      try {
        return new URL(
          image.getAttribute('src') || '',
          root.location?.origin || 'https://free-bbs.cn',
        ).pathname.startsWith('/uploads/max-image-');
      } catch {
        return false;
      }
    });
    images.forEach((image) => {
      if (image.closest('.max-generated-image')) return;
      const parent = image.parentElement;
      const placeholder = document.createElement('span');
      image.replaceWith(placeholder);
      const figure = buildResultFrame(image);
      if (
        parent?.tagName === 'P' &&
        parent.textContent.trim() === '' &&
        parent.children.length === 1
      ) {
        parent.replaceWith(figure);
      } else {
        placeholder.replaceWith(figure);
      }
    });
    return images.length;
  }

  function finish(article, result = {}) {
    const count = decorate(article);
    if (result.image_generation?.status === 'completed' && count === 0) {
      const bubble = article?.querySelector?.('.aichat-bubble');
      bubble?.insertAdjacentHTML(
        'beforeend',
        '<p class="max-generated-image-missing" role="alert">图片已经生成，但当前页面未能显示。请刷新对话重试。</p>',
      );
    }
    return count;
  }

  const api = { decorate, finish, isRequest, showProgress, statusCopy };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FreeBbsMaxImageResults = api;
})(typeof window === 'object' ? window : globalThis);
