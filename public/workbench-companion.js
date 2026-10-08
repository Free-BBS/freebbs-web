(function install(root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.FreeBbsWorkbenchCompanion = value;
})(typeof window !== 'undefined' ? window : globalThis, () => {
  const messages = {
    welcome: [
      '从一件小事开始，也是在向前走。',
      '安排可以慢慢理清，不必一次做到完美。',
      '计划是来帮你的，也可以随着今天的状态调整。',
    ],
    late: [
      '时间不早了，如果事情可以等到明天，就给自己留一点休息吧。',
      '今天先到这里也可以。留点精力，明天再继续。',
    ],
    conflict: [
      '有两项安排撞在一起了。要不要看看哪一项更方便调整？',
      '时间冲突可以慢慢处理，不需要同时完成所有事。',
    ],
    deadline: [
      '有一项事情临近截止了。先做一个小步骤，或许会轻松一点。',
      '临近截止时，可以先确认最重要的一步，再给自己留个短休息。',
    ],
    busy: [
      '今天记录的安排比较满。要不要给自己留一小段不做事的时间？',
      '如果已经有些累了，可以先休息一下，再决定接下来做什么。',
      '事情一件件来就好，不必把每个空档都填满。',
    ],
    continuous: [
      '接下来有一段连续安排，要不要提前留点喝水、走动的时间？',
      '连续忙碌之后，休息也是计划的一部分。',
    ],
    free: [
      '今天还留着一些空白。可以做一点喜欢的事，也可以安心休息。',
      '空余时间不一定要用来赶进度，你也可以留给自己。',
      '想开始一点什么的话，我可以陪你找一段合适的时间。',
    ],
  };
  function selectTip(events, now = new Date(), index = 0, ready = true) {
    const shifted = new Date(now.getTime() + 8 * 3600000);
    const start =
      Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - 8 * 3600000;
    const end = start + 86400000;
    const items = (Array.isArray(events) ? events : []).filter(
      (item) => !['cancelled', 'completed'].includes(item.status),
    );
    const intervals = items
      .filter((item) => item.kind !== 'deadline')
      .map((item) => ({
        start: Math.max(start, Date.parse(item.startAt)),
        end: Math.min(end, Date.parse(item.endAt)),
      }))
      .filter(
        (item) => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start,
      )
      .sort((a, b) => a.start - b.start);
    let conflict = false;
    const merged = [];
    for (const item of intervals) {
      const last = merged.at(-1);
      if (last && item.start < last.end) conflict = true;
      if (last && item.start <= last.end + 15 * 60000) last.end = Math.max(last.end, item.end);
      else merged.push({ ...item });
    }
    const total = merged.reduce((sum, item) => sum + item.end - item.start, 0);
    const deadline = items.some(
      (item) =>
        item.kind === 'deadline' &&
        Date.parse(item.endAt) > now.getTime() &&
        Date.parse(item.endAt) - now.getTime() <= 86400000,
    );
    const continuous = merged.some(
      (item) => item.end > now.getTime() && item.end - item.start >= 120 * 60000,
    );
    const kind = !ready
      ? 'welcome'
      : shifted.getUTCHours() >= 22 || shifted.getUTCHours() < 6
        ? 'late'
        : conflict
          ? 'conflict'
          : deadline
            ? 'deadline'
            : total >= 360 * 60000
              ? 'busy'
              : continuous
                ? 'continuous'
                : 'free';
    const choices = messages[kind];
    return { kind, text: choices[Math.abs(index) % choices.length] };
  }
  function installBubbleControls({ document: doc, onHide, onShow, onPlan }) {
    const byId = (name) => doc.getElementById(`workbench-companion${name ? `-${name}` : ''}`);
    const companion = byId('');
    const bubble = byId('bubble');
    const avatar = byId('avatar');
    const collapse = byId('collapse');
    const hide = byId('hide');
    const show = byId('show');
    const plan = byId('plan');
    if (![companion, bubble, avatar, collapse, hide, show, plan].every(Boolean)) return undefined;

    function setOpen(value, returnFocus = false) {
      const open = Boolean(value && !companion.hidden);
      bubble.hidden = !open;
      avatar.setAttribute('aria-expanded', String(open));
      avatar.setAttribute('aria-label', `${open ? '收起' : '展开'} Max 小提示`);
      if (returnFocus) avatar.focus();
    }
    function setHidden(value) {
      companion.hidden = Boolean(value);
      show.hidden = !value;
      if (value) setOpen(false);
    }
    setOpen(false);
    avatar.addEventListener('click', () => setOpen(bubble.hidden));
    collapse.addEventListener('click', () => setOpen(false, true));
    bubble.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false, true);
      }
    });
    hide.addEventListener('click', () => {
      setOpen(false);
      onHide?.();
      setHidden(true);
      show.focus();
    });
    show.addEventListener('click', () => {
      onShow?.();
      setHidden(false);
      setOpen(false);
      avatar.focus();
    });
    plan.addEventListener('click', () => {
      setOpen(false, true);
      onPlan?.();
    });
    return { setOpen, setHidden };
  }
  return { selectTip, messages, installBubbleControls };
});
