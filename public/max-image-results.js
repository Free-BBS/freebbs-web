((root) => {
  const imageRequestPattern =
    /(?:生成|画|绘制|创作|设计|做)(?:一|1)?(?:张|幅|个)?[\s\S]{0,80}(?:图片|图像|插画|海报|封面|头像|壁纸|卡通|漫画)|(?:generate|draw|create|design)[\s\S]{0,80}(?:image|picture|illustration|poster|wallpaper)/i;
  const negatedPattern =
    /(?:不要|别|无需|不用|不需要)[^。！？\n]{0,16}(?:生成|画|绘制|图片|图像)|(?:do not|don't|no need to)[^.!?\n]{0,24}(?:generate|draw|image)/i;

  function isRequest(text) {
    const value = String(text || '').trim();
    return Boolean(value && imageRequestPattern.test(value) && !negatedPattern.test(value));
  }

  function isGenerationPhase(phase) {
    return ['image_generating', 'saving_image', 'image_ready'].includes(phase);
  }

  function statusCopy(message) {
    const value = String(message || 'Max 已收到描述，正在生成画面…');
    if (/保存|整理/.test(value)) {
      return { title: '图片已经生成', detail: value, step: 3 };
    }
    if (/阅读|分析/.test(value)) {
      return { title: '正在理解你的描述', detail: value, step: 1 };
    }
    if (/思考|输入|排队/.test(value)) {
      return {
        title: 'Max 正在构思',
        detail: 'Max 正在理解你的描述。准备好画面后，会在这里显示生成进度。',
        step: 1,
      };
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
    const existing = bubble.querySelector('.max-image-generation-status');
    if (existing) {
      existing.querySelector('.max-image-generation-copy strong').textContent = copy.title;
      existing.querySelector('.max-image-generation-copy > span').textContent = copy.detail;
      existing.querySelector('.max-image-generation-track').dataset.step = String(copy.step);
      return;
    }
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
      </section>
      <section class="max-image-placeholder" tabindex="0" aria-label="图片生成中，可玩俄罗斯方块">
        <button type="button" class="max-image-placeholder-activate">
          <span class="max-image-placeholder-squares" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
          <strong>图片生成中</strong>
          <span>点这里玩一局俄罗斯方块</span>
          <small>生成完成后，图片会出现在这个位置</small>
        </button>
        <div class="max-tetris-game" hidden>
          <div class="max-tetris-heading">
            <span>等待画面的小游戏</span>
            <span>得分 <b data-tetris-score>0</b>　消行 <b data-tetris-lines>0</b></span>
          </div>
          <div class="max-tetris-layout">
            <canvas width="240" height="384" role="img" aria-label="俄罗斯方块游戏区域"></canvas>
            <div class="max-tetris-side">
              <p data-tetris-message>← → 移动 · ↑ 旋转 · ↓ 加速 · 空格落下</p>
              <button type="button" data-tetris-action="pause">暂停</button>
              <div class="max-tetris-controls" aria-label="触屏游戏控制">
                <button type="button" data-tetris-action="left" aria-label="左移">←</button>
                <button type="button" data-tetris-action="rotate" aria-label="旋转">↻</button>
                <button type="button" data-tetris-action="right" aria-label="右移">→</button>
                <button type="button" data-tetris-action="down" aria-label="下移">↓</button>
                <button type="button" data-tetris-action="drop" aria-label="直接落下">落下</button>
              </div>
              <small>图片完成时，游戏会自动结束并显示作品。</small>
            </div>
          </div>
        </div>
      </section>`;
    root.FreeBbsMaxTetris?.mount(bubble.querySelector('.max-image-placeholder'));
  }

  function buildResultFrame(image) {
    const figure = document.createElement('figure');
    figure.className = 'max-generated-image';
    const caption = document.createElement('figcaption');
    const state = document.createElement('span');
    state.className = 'max-generated-image-state';
    state.dataset.state = 'loading';
    state.textContent = '正在加载图片';
    const actions = document.createElement('span');
    actions.className = 'max-generated-image-actions';
    const error = document.createElement('p');
    error.className = 'max-generated-image-load-error';
    error.hidden = true;
    error.setAttribute('role', 'alert');
    error.textContent = '图片文件未能加载，可能是生成或保存失败。';
    const open = document.createElement('a');
    open.href = image.currentSrc || image.src;
    open.target = '_blank';
    open.rel = 'noopener';
    open.textContent = '查看原图';
    const download = document.createElement('a');
    download.href = image.currentSrc || image.src;
    download.download = '';
    download.textContent = '下载';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'max-generated-image-retry';
    retry.textContent = '重新加载';
    const originalSource = image.currentSrc || image.src;
    let automaticallyRetried = false;

    const markReady = () => {
      figure.classList.remove('is-image-unavailable');
      error.hidden = true;
      state.dataset.state = 'ready';
      state.textContent = '图片已生成';
      actions.replaceChildren(open, download);
    };
    const markUnavailable = () => {
      if (!automaticallyRetried) {
        automaticallyRetried = true;
        reload();
        return;
      }
      figure.classList.add('is-image-unavailable');
      error.hidden = false;
      state.dataset.state = 'error';
      state.textContent = '图片未能加载';
      actions.replaceChildren(retry);
    };
    const reload = () => {
      figure.classList.remove('is-image-unavailable');
      error.hidden = true;
      state.dataset.state = 'loading';
      state.textContent = '正在重新加载';
      actions.replaceChildren();
      const url = new URL(originalSource, root.location?.origin || 'https://free-bbs.cn');
      url.searchParams.set('reload', String(Date.now()));
      image.src = url.href;
    };
    image.addEventListener('load', markReady);
    image.addEventListener('error', markUnavailable);
    retry.addEventListener('click', () => {
      automaticallyRetried = true;
      reload();
    });
    actions.append(open, download);
    caption.append(state, actions);
    image.loading = 'eager';
    image.decoding = 'async';
    figure.append(image, error, caption);
    // An image may already have completed before its Markdown is decorated.
    if (image.complete) {
      if (image.naturalWidth > 0) markReady();
      else markUnavailable();
    }
    return figure;
  }

  function decorate(article) {
    if (!article) return 0;
    root.FreeBbsMaxTetris?.dispose(article);
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

  const api = { decorate, finish, isGenerationPhase, isRequest, showProgress, statusCopy };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FreeBbsMaxImageResults = api;
})(typeof window === 'object' ? window : globalThis);
