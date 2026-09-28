(function (root) {
  // Coordinates come from the actual avatars, not the height of an individual reply.
  // A parent's one continuous stem spans all of its visible direct children.
  function pathsForBranch(parent, children) {
    const start = parent.bottom + 3;
    const x = parent.x;
    const direct = children.filter((child) => child.top > parent.bottom);
    if (!direct.length) return [`M ${x} ${start} V ${parent.toggleY}`];
    // Beyond the indentation cap, keep the reading width. The explicit parent link
    // carries the relationship; stop the stem before the next same-column avatar.
    if (direct[0].left <= x) return [`M ${x} ${start} V ${direct[0].top - 3}`];
    const last = direct.at(-1);
    const radius = Math.min(10, Math.max(2, last.left - x));
    return [
      `M ${x} ${start} V ${last.y - radius} Q ${x} ${last.y} ${x + radius} ${last.y} H ${last.left}`,
      ...direct.slice(0, -1).map((child) => {
        const r = Math.min(10, Math.max(2, child.left - x));
        return `M ${x} ${child.y - r} Q ${x} ${child.y} ${x + r} ${child.y} H ${child.left}`;
      }),
    ];
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { pathsForBranch };
  if (!root?.document) return;
  const document = root.document;
  const ns = 'http://www.w3.org/2000/svg';
  let list = null;
  let frame = 0;
  const observer = new ResizeObserver(schedule);
  function schedule() {
    if (!frame) frame = root.requestAnimationFrame(draw);
  }
  function draw() {
    frame = 0;
    if (!list?.isConnected) {
      observer.disconnect();
      list = null;
      return;
    }
    list.querySelectorAll('.discussion-thread-group').forEach((group) => {
      const bounds = group.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const nodes = [...group.querySelectorAll('.discussion-comment:not([hidden])')].map(
        (article) => {
          const avatar = (
            article.querySelector('.discussion-comment-author-link .discussion-post-avatar') ||
            article.querySelector('.discussion-comment-author-link')
          ).getBoundingClientRect();
          const row = article.querySelector('.discussion-comment-tools').getBoundingClientRect();
          const box = article.getBoundingClientRect();
          const toggle = article.querySelector('.discussion-comment-thread-toggle');
          const x = avatar.left + avatar.width / 2;
          const toggleY = row.top + row.height / 2;
          if (toggle) {
            toggle.style.left = `${x - box.left}px`;
            toggle.style.top = `${toggleY - box.top}px`;
          }
          return {
            id: article.dataset.commentId,
            parentId: article.dataset.parentCommentId,
            x: x - bounds.left,
            left: avatar.left - bounds.left,
            y: avatar.top + avatar.height / 2 - bounds.top,
            top: avatar.top - bounds.top,
            bottom: avatar.bottom - bounds.top,
            toggleY: toggleY - bounds.top,
            toggle,
          };
        },
      );
      let svg = group.querySelector(':scope > .discussion-thread-guides');
      if (!svg) {
        svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('class', 'discussion-thread-guides');
        svg.setAttribute('aria-hidden', 'true');
        group.prepend(svg);
      }
      svg.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`);
      const fragment = document.createDocumentFragment();
      const childrenByParent = new Map();
      nodes.forEach((node) => {
        if (!childrenByParent.has(node.parentId)) childrenByParent.set(node.parentId, []);
        childrenByParent.get(node.parentId).push(node);
      });
      nodes
        .filter((node) => node.toggle)
        .forEach((parent) => {
          const children = childrenByParent.get(parent.id) || [];
          const branch = document.createElementNS(ns, 'g');
          branch.dataset.threadOwner = parent.id;
          pathsForBranch(parent, children).forEach((d) => {
            const path = document.createElementNS(ns, 'path');
            path.setAttribute('d', d);
            path.setAttribute('class', 'discussion-thread-path');
            branch.append(path);
            // A larger invisible hit stroke is mouse-only; touch uses the +/- button
            // so dragging/selecting comment text never collapses a branch accidentally.
            if (children.length) {
              const hit = path.cloneNode();
              hit.setAttribute('class', 'discussion-thread-hit');
              hit.dataset.action = 'toggle-comment-thread';
              hit.dataset.threadRoot = parent.id;
              branch.append(hit);
            }
          });
          fragment.append(branch);
        });
      svg.replaceChildren(fragment);
    });
  }
  function refresh(target) {
    observer.disconnect();
    list = target;
    if (list) {
      observer.observe(list);
      list.querySelectorAll('.discussion-comment').forEach((node) => observer.observe(node));
    }
    schedule();
  }
  root.addEventListener('resize', schedule);
  document.fonts?.addEventListener('loadingdone', schedule);
  root.FreeBbsDiscussionThreads = { refresh, schedule };
})(typeof window !== 'undefined' ? window : null);
