(() => {
  let activeDialog;
  const close = () => activeDialog?.close();
  function mount(root, post) {
    close();
    const form = root.querySelector('#discussion-comment-form');
    const reactions = root.querySelector('.discussion-detail-reactions');
    const toolbar = root.querySelector('.discussion-detail-toolbar');
    const share = document.createElement('button');
    share.type = 'button';
    share.className = 'post-share';
    share.textContent = '分享';
    share.addEventListener('click', async () => {
      const url = new URL('/discussion', location.origin);
      url.searchParams.set('post', post.id);
      try {
        if (navigator.share) await navigator.share({ title: post.title, url: url.href });
        else {
          await navigator.clipboard.writeText(url.href);
          share.textContent = '已复制';
        }
      } catch (error) {
        if (error.name !== 'AbortError') share.textContent = '分享失败，请重试';
      }
    });
    toolbar.append(share);
    const bar = document.createElement('div');
    bar.className = 'post-reading-actions';
    if (!post.isHidden && !post.isDeleted) {
      const write = document.createElement('button');
      write.type = 'button';
      write.className = 'post-write-comment';
      write.textContent = '写评论…';
      write.addEventListener('click', () => {
        if (!window.freeBbsApp.userState.isLoggedIn) {
          location.href = '/login?next=' + encodeURIComponent('/discussion?post=' + post.id);
          return;
        }
        if (!matchMedia('(max-width: 900px)').matches) {
          form.scrollIntoView({ block: 'center', behavior: 'smooth' });
          form.querySelector('textarea')?.focus({ preventScroll: true });
          return;
        }
        const placeholder = document.createComment('comment-form');
        form.before(placeholder);
        const dialog = document.createElement('dialog');
        dialog.className = 'post-comment-sheet';
        dialog.setAttribute('aria-label', '发表评论');
        const header = document.createElement('header');
        const title = document.createElement('strong');
        title.textContent = '发表评论';
        const dismiss = document.createElement('button');
        dismiss.type = 'button';
        dismiss.textContent = '关闭';
        dismiss.addEventListener('click', () => dialog.close());
        header.append(title, dismiss);
        const options = document.createElement('div');
        options.className = 'post-comment-tools';
        const preview = document.createElement('button');
        preview.type = 'button';
        preview.textContent = '预览';
        preview.setAttribute('aria-pressed', 'false');
        preview.addEventListener('click', () => {
          const showing = dialog.classList.toggle('show-preview');
          preview.setAttribute('aria-pressed', String(showing));
        });
        const mention = document.createElement('button');
        mention.type = 'button';
        mention.textContent = '@Max';
        mention.addEventListener('click', () => {
          const input = form.querySelector('textarea');
          input.setRangeText('@max ', input.selectionStart, input.selectionEnd, 'end');
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.focus();
        });
        options.append(mention, preview);
        form.querySelector('.discussion-compose-actions').before(options);
        dialog.append(header, form);
        root.append(dialog);
        activeDialog = dialog;
        const viewport = () => {
          const vv = visualViewport;
          dialog.style.bottom =
            Math.max(0, innerHeight - (vv?.height || innerHeight) - (vv?.offsetTop || 0)) + 'px';
          dialog.style.maxHeight = Math.max(160, (vv?.height || innerHeight) - 16) + 'px';
        };
        visualViewport?.addEventListener('resize', viewport);
        visualViewport?.addEventListener('scroll', viewport);
        viewport();
        dialog.addEventListener(
          'close',
          () => {
            options.remove();
            placeholder.replaceWith(form);
            visualViewport?.removeEventListener('resize', viewport);
            visualViewport?.removeEventListener('scroll', viewport);
            dialog.remove();
            if (activeDialog === dialog) activeDialog = null;
            write.focus({ preventScroll: true });
          },
          { once: true },
        );
        dialog.addEventListener('click', (event) => {
          if (event.target === dialog) dialog.close();
        });
        dialog.showModal();
        form.querySelector('textarea')?.focus({ preventScroll: true });
      });
      bar.append(write);
    }
    if (reactions) bar.append(reactions);
    root.querySelector('.discussion-post-surface').append(bar);
    form?.addEventListener('discussion:comment-published', () => {
      const count = reactions?.querySelector('.discussion-comment-count strong');
      if (count) count.textContent = String(Number(count.textContent || 0) + 1);
      close();
    });
    const count = reactions?.querySelector('.discussion-comment-count');
    if (count) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = count.className;
      button.innerHTML = count.innerHTML;
      button.setAttribute('aria-label', '查看评论');
      button.addEventListener('click', () =>
        root.querySelector('.discussion-comments').scrollIntoView({ behavior: 'smooth' }),
      );
      count.replaceWith(button);
    }
  }
  window.FreeBbsPostReader = { mount, close };
  window.addEventListener('freebbs:session-change', close);
  window.addEventListener('resize', () => {
    if (innerWidth > 900) close();
  });
})();
