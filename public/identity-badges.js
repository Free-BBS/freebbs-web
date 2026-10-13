(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FreeBbsIdentityBadges = api;
})(typeof window === 'undefined' ? globalThis : window, () => {
  const escape = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (char) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[char],
    );

  function badges(person) {
    if (!person || person.isAnonymous || person.isDeleted) return [];
    const teacherBadge = (Array.isArray(person.identityBadges) ? person.identityBadges : []).find(
      (badge) => badge.type === 'teacher' && (!badge.status || badge.status === 'approved'),
    );
    const teacherLabel = String(teacherBadge?.label || '').trim() || '教师';
    const result =
      person.role === 'teacher'
        ? [{ type: 'teacher', label: teacherLabel, title: `教师账号 · ${teacherLabel}` }]
        : [];
    const seen = new Set();
    for (const certificate of Array.isArray(person.certifications) ? person.certifications : []) {
      if (certificate.status && certificate.status !== 'approved') continue;
      const { type } = certificate;
      if (!['education', 'company', 'teacher'].includes(type)) continue;
      const slot = type === 'education' ? certificate.education : type;
      if (type === 'education' && !['undergraduate', 'master', 'doctor'].includes(slot)) continue;
      const label = String(certificate.label || '').trim();
      if (!label || seen.has(slot)) continue;
      seen.add(slot);
      if (type === 'teacher' && result[0]?.type === 'teacher') result.shift();
      result.push({
        type,
        label,
        title: [
          '已认证',
          label,
          type === 'teacher' ? certificate.institution : '',
          certificate.className,
        ]
          .filter(Boolean)
          .join(' · '),
      });
    }
    return result;
  }

  function markup(person) {
    const values = badges(person);
    return values.length
      ? `<span class="identity-badges" aria-label="身份信息">${values.map((badge) => `<span class="identity-badge identity-badge-${badge.type}" title="${escape(badge.title)}">${escape(badge.label)}</span>`).join('')}</span>`
      : '';
  }

  function mount(anchor, person) {
    if (!anchor) return;
    let container = anchor.parentElement.querySelector('[data-profile-identities]');
    if (!container) {
      container = anchor.ownerDocument.createElement('div');
      container.dataset.profileIdentities = '';
      anchor.after(container);
    }
    container.innerHTML = markup(person);
    container.hidden = !container.textContent;
  }

  return { badges, markup, mount };
});
