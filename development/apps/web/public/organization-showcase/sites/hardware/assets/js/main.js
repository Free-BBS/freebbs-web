const members = [
  [
    "滕明慧",
    "硬件部氛围超棒，不用害怕从零上手。从原理图设计到实物调试，在动手实践里收获成长。期待热爱硬件的你来和我们一起探索！"
  ],
  [
    "张文骞",
    "想和学长学姐、技术大佬们畅聊硬件，在交流中碰撞灵感吗？想从硬件小白一步步成长为硬件大神吗？想亲手参与一场场精彩硬件赛事的策划与筹办吗？欢迎加入电子系硬件部！在这里，一起探索硬件的无限可能！"
  ],
  [
    "郑悠键",
    "硬件部是一个既能学到知识、锻炼动手能力，又充满温暖与活力的地方。在这里，不仅能体验从理论到实践的乐趣，还能认识一群志同道合、热情有趣的伙伴。期待更多学弟学妹加入硬件部，一起探索电子的魅力！"
  ],
  [
    "张行言",
    "在硬件部，你可以协助举办各种与硬件相关的赛事，可以见到与你兴趣相似的同学，在合作与交流中获得快乐、提升自身能力。你还可以在部会上与同学们一起聊天，了解各种有趣的事情。欢迎大家加入电子系学生科协硬件部。"
  ],
  [
    "任逸旸",
    "在硬件部可不止能和各路大佬交流学习硬件知识，还有学长的经验分享让你少走弯路。你更可以参与比赛筹划与举办，为电子系课程体系添砖加瓦。硬件部欢迎各位同学的加入！"
  ],
  [
    "梅楚天",
    "来硬件部，能在实际工作中学到很多知识和技能，还能薅各种羊毛（），欢迎学弟学妹们积极报名！"
  ]
];
const grid = document.querySelector('#voices-grid');
for (const [index, [name, quote]] of members.entries()) {
  const article = document.createElement('article');
  article.className = 'quote';
  article.setAttribute('aria-labelledby', `member-${index}`);
  article.innerHTML = `<div class="quote-card-header"><div class="quote-person"><span class="avatar" aria-hidden="true">${name[0]}</span><div><h3 id="member-${index}">${name}</h3></div></div><span class="quote-mark" aria-hidden="true">“</span></div><blockquote>${quote}</blockquote><div class="quote-card-footer" aria-hidden="true"><span class="card-circuit"><i></i><i></i><i></i></span></div>`;
  grid.append(article);
}
const lightbox = document.querySelector('#lightbox');
document.querySelectorAll('.photo-button').forEach(link => {
  link.addEventListener('click', event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || typeof lightbox.showModal !== 'function') return;
    event.preventDefault();
    lightbox.querySelector('img').src = link.href;
    lightbox.querySelector('img').alt = link.dataset.caption;
    lightbox.querySelector('p').textContent = link.dataset.caption;
    lightbox.showModal();
    document.body.classList.add('modal-open');
  });
});
lightbox.querySelector('button').addEventListener('click', () => lightbox.close());
lightbox.addEventListener('click', event => { if (event.target === lightbox) { const r = lightbox.getBoundingClientRect(); if(event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) lightbox.close(); } });
lightbox.addEventListener('close', () => document.body.classList.remove('modal-open'));
const video = document.querySelector('video');
const videoStatus = document.querySelector('.video-status');
video.addEventListener('error', () => { videoStatus.hidden = false; videoStatus.textContent = '视频暂时无法加载，请刷新页面重试，或下载完整视频观看。'; });

const copyStatus = document.querySelector('#copy-status');
copyStatus.textContent = '';
copyStatus.hidden = true;
let copyNoticeTimer;
function fallbackCopy(value) {
  const input = document.createElement('textarea');
  input.value = value;
  input.setAttribute('readonly', '');
  input.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  document.body.append(input);
  input.select();
  try { return document.execCommand('copy'); }
  finally { input.remove(); }
}
document.querySelectorAll('.contact-card').forEach(button => {
  let resetTimer;
  button.addEventListener('click', async () => {
    const email = button.dataset.email;
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(email);
        copied = true;
      }
    } catch { /* Local pages and denied permissions use the fallback below. */ }
    if (!copied) {
      try { copied = fallbackCopy(email); } catch { copied = false; }
    }
    button.focus({preventScroll:true});
    clearTimeout(resetTimer);
    clearTimeout(copyNoticeTimer);
    button.classList.toggle('copied', copied);
    button.querySelector('.copy-label').textContent = copied ? '已复制' : '复制';
    if (copied) {
      copyStatus.textContent = `已复制邮箱：${email}`;
    } else {
      const range = document.createRange();
      range.selectNodeContents(button.querySelector('.contact-email'));
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      copyStatus.textContent = '无法自动复制，邮箱已选中，请手动复制。';
    }
    copyStatus.hidden = false;
    resetTimer = setTimeout(() => {
      button.classList.remove('copied');
      button.querySelector('.copy-label').textContent = '复制';
    }, 2500);
    copyNoticeTimer = setTimeout(() => { copyStatus.hidden = true; copyStatus.textContent = ''; }, copied ? 3500 : 6500);
  });
});
