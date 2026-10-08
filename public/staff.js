/* Public introductions stay plain text, including any websites supplied by a member. */
(() => {
  const PRODUCT_GROUP = '产品设计·总负责人';
  const GROUPS = [PRODUCT_GROUP, '课程部', '技术部', '战略部'];
  const COURSE_GROUPS = ['数学组', '电路组', '信号组'];
  const NAME_COLLATOR = new Intl.Collator('zh-Hans-CN-u-co-pinyin');
  const GENERAL_RESPONSIBILITIES = [
    '产品设计总负责人',
    '课程总负责人',
    '技术总负责人',
    '战略总负责人',
    '开发总负责人',
    '发展端总负责人',
  ];
  const DEPARTMENT_LEADERS = {
    课程部: '课程总负责人',
    技术部: '技术总负责人',
    战略部: '战略总负责人',
  };

  function normalizeStaffRoster(data) {
    if (!data || !Array.isArray(data.members) || data.members.length === 0)
      throw new Error('名录数据不完整');
    const names = new Set();
    const members = data.members.map((member) => {
      const name = typeof member?.name === 'string' ? member.name.trim() : '';
      if (!name || names.has(name) || !Array.isArray(member.groups))
        throw new Error('名录成员信息不完整');
      names.add(name);
      const groups = [...new Set(member.groups)];
      if (groups.some((group) => !GROUPS.includes(group))) throw new Error('部门信息无效');
      const courseGroups = member.courseGroups === undefined ? [] : member.courseGroups;
      if (
        !Array.isArray(courseGroups) ||
        courseGroups.some((group) => !COURSE_GROUPS.includes(group)) ||
        (courseGroups.length && !groups.includes('课程部'))
      )
        throw new Error('课程部组别信息无效');
      const courseResponsibilities =
        member.courseResponsibilities === undefined ? [] : member.courseResponsibilities;
      if (
        !Array.isArray(courseResponsibilities) ||
        courseResponsibilities.some(
          (responsibility) => typeof responsibility !== 'string' || !responsibility.trim(),
        ) ||
        (courseResponsibilities.length && !groups.includes('课程部'))
      )
        throw new Error('课程负责人信息无效');
      const generalResponsibilities =
        member.generalResponsibilities === undefined ? [] : member.generalResponsibilities;
      if (
        !Array.isArray(generalResponsibilities) ||
        generalResponsibilities.some(
          (responsibility) => !GENERAL_RESPONSIBILITIES.includes(responsibility),
        )
      )
        throw new Error('总负责人信息无效');
      const responsibilities = member.responsibilities === undefined ? [] : member.responsibilities;
      if (
        !Array.isArray(responsibilities) ||
        responsibilities.some(
          (responsibility) => typeof responsibility !== 'string' || !responsibility.trim(),
        )
      )
        throw new Error('成员职责信息无效');
      const introduction = typeof member.introduction === 'string' ? member.introduction : '';
      const photo =
        typeof member.photo === 'string' &&
        /^\/assets\/staff\/[a-z0-9_-]+\.(?:png|jpe?g|webp)$/i.test(member.photo)
          ? member.photo
          : '';
      const photoThumbnail =
        typeof member.photoThumbnail === 'string' &&
        /^\/assets\/staff\/[a-z0-9_-]+\.(?:png|jpe?g|webp)$/i.test(member.photoThumbnail)
          ? member.photoThumbnail
          : photo;
      return {
        name,
        groups,
        courseGroups: [...new Set(courseGroups)],
        courseResponsibilities: [
          ...new Set(courseResponsibilities.map((responsibility) => responsibility.trim())),
        ],
        generalResponsibilities: [...new Set(generalResponsibilities)],
        responsibilities: [
          ...new Set(responsibilities.map((responsibility) => responsibility.trim())),
        ],
        introduction: introduction.trim() === '【请输入文本】' ? '' : introduction,
        photo,
        photoThumbnail,
      };
    });
    const sourceDate = /^\d{4}-\d{2}-\d{2}$/.test(data.sourceDate || '') ? data.sourceDate : '';
    return { sourceDate, members };
  }

  function isDepartmentLeader(member, group) {
    return Boolean(member.generalResponsibilities?.includes(DEPARTMENT_LEADERS[group]));
  }

  function selectStaffMembers(members, group = '', courseGroup = '') {
    if (group === PRODUCT_GROUP) {
      return members.filter((member) => member.generalResponsibilities?.length);
    }
    const departmentMembers = group
      ? members.filter((member) => member.groups.includes(group))
      : members;
    if (group !== '课程部' || !courseGroup) return departmentMembers;
    return departmentMembers.filter((member) =>
      courseGroup === '待确认'
        ? isDepartmentLeader(member, '课程部') || !member.courseGroups?.length
        : isDepartmentLeader(member, '课程部') || member.courseGroups?.includes(courseGroup),
    );
  }

  function countCourseGroup(members, courseGroup) {
    const courseMembers = selectStaffMembers(members, '课程部');
    if (!courseGroup) return courseMembers.length;
    if (courseGroup === '待确认')
      return courseMembers.filter(
        (member) => !member.courseGroups?.length && !isDepartmentLeader(member, '课程部'),
      ).length;
    return courseMembers.filter(
      (member) =>
        !isDepartmentLeader(member, '课程部') && member.courseGroups?.includes(courseGroup),
    ).length;
  }

  function partitionStaffMembers(members, group = '') {
    if (group === PRODUCT_GROUP) return [{ key: 'product', title: '', members }];
    const sections = [
      { key: 'leaders', title: '总负责人', members: [] },
      { key: 'course-leaders', title: '课程负责人', members: [] },
      { key: 'members', title: '成员', members: [] },
    ];
    members.forEach((member) => {
      if (group ? isDepartmentLeader(member, group) : member.generalResponsibilities?.length) {
        sections[0].members.push(member);
      } else if (
        (!group || group === '课程部') &&
        member.groups.includes('课程部') &&
        member.courseResponsibilities?.length
      ) {
        sections[1].members.push(member);
      } else {
        sections[2].members.push(member);
      }
    });
    if (group === '课程部' || group === '技术部') {
      sections[2].members.sort((left, right) => NAME_COLLATOR.compare(left.name, right.name));
    }
    return sections.filter((section) => section.members.length);
  }

  function createStaffCard(doc, member, headingTag = 'h3', openPhoto = null) {
    const card = doc.createElement('article');
    card.className = 'staff-person';
    const avatar = doc.createElement(member.photo ? 'button' : 'div');
    avatar.className = 'staff-avatar';
    const fallback = doc.createElement('span');
    fallback.textContent = member.name;
    fallback.setAttribute('aria-hidden', 'true');
    avatar.append(fallback);
    if (member.photo) {
      avatar.type = 'button';
      avatar.disabled = true;
      avatar.setAttribute('aria-label', `放大查看${member.name}的照片`);
      avatar.setAttribute('aria-haspopup', 'dialog');
      avatar.addEventListener('click', () => {
        if (!avatar.disabled) openPhoto?.(member, avatar);
      });
      const photo = doc.createElement('img');
      photo.src = member.photoThumbnail || member.photo;
      photo.alt = '';
      photo.loading = 'lazy';
      photo.decoding = 'async';
      photo.width = 88;
      photo.height = 116;
      photo.addEventListener('load', () => {
        fallback.hidden = true;
        avatar.disabled = !openPhoto;
      });
      photo.addEventListener('error', () => {
        photo.hidden = true;
        fallback.hidden = false;
        avatar.disabled = true;
      });
      avatar.append(photo);
    }
    const copy = doc.createElement('div');
    copy.className = 'staff-person-copy';
    const heading = doc.createElement(headingTag);
    heading.className = 'staff-person-name';
    heading.textContent = member.name;
    copy.append(heading);
    const displayGroups = member.groups.filter((group) => group !== PRODUCT_GROUP);
    if (displayGroups.length) {
      const groups = doc.createElement('div');
      groups.className = 'staff-person-groups';
      const labels = displayGroups.flatMap((group) =>
        group === '课程部' && member.courseGroups?.length
          ? member.courseGroups.map((courseGroup) => `${group}·${courseGroup}`)
          : [group],
      );
      labels.forEach((group) => {
        const label = doc.createElement('span');
        label.textContent = group;
        groups.append(label);
      });
      copy.append(groups);
    }
    if (member.generalResponsibilities?.length) {
      const responsibilities = doc.createElement('ul');
      responsibilities.className = 'staff-person-general-responsibilities';
      member.generalResponsibilities.forEach((responsibility) => {
        const label = doc.createElement('li');
        label.textContent = responsibility;
        responsibilities.append(label);
      });
      copy.append(responsibilities);
    }
    if (member.groups.includes('课程部') && member.courseResponsibilities?.length) {
      const responsibilities = doc.createElement('ul');
      responsibilities.className = 'staff-person-responsibilities';
      member.courseResponsibilities.forEach((responsibility) => {
        const label = doc.createElement('li');
        label.textContent = responsibility;
        responsibilities.append(label);
      });
      copy.append(responsibilities);
    }
    if (member.responsibilities?.length) {
      const responsibilities = doc.createElement('ul');
      responsibilities.className = 'staff-person-responsibilities';
      member.responsibilities.forEach((responsibility) => {
        const label = doc.createElement('li');
        label.textContent = responsibility;
        responsibilities.append(label);
      });
      copy.append(responsibilities);
    }
    if (member.introduction) {
      const introduction = doc.createElement('p');
      introduction.className = 'staff-person-introduction';
      introduction.textContent = member.introduction;
      copy.append(introduction);
    }
    card.append(avatar, copy);
    return card;
  }

  function installStaffPhotoViewer(doc) {
    const dialog = doc.getElementById('staff-photo-dialog');
    const name = doc.getElementById('staff-photo-name');
    const close = doc.getElementById('staff-photo-close');
    const image = doc.getElementById('staff-photo-image');
    const status = doc.getElementById('staff-photo-status');
    if (!dialog || !name || !close || !image || !status) return undefined;
    let trigger;
    close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      dialog.close();
    });
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      )
        dialog.close();
    });
    dialog.addEventListener('close', () => {
      if (trigger?.isConnected !== false) trigger?.focus();
    });
    image.addEventListener('error', () => {
      if (!dialog.open) return;
      image.hidden = true;
      status.textContent = `${name.textContent}的照片暂时无法显示，请关闭后重试。`;
      status.hidden = false;
    });
    return (member, source) => {
      if (!/^\/assets\/staff\/[a-z0-9_-]+\.(?:png|jpe?g|webp)$/i.test(member.photo || '')) return;
      trigger = source;
      name.textContent = member.name;
      image.alt = `${member.name}的照片`;
      image.decoding = 'async';
      image.hidden = false;
      status.hidden = true;
      status.textContent = '';
      image.src = member.photo;
      if (!dialog.open) dialog.showModal();
      close.focus();
    };
  }

  async function installStaffDirectory({ document: doc, fetch: request }) {
    const grid = doc.getElementById('staff-grid');
    const status = doc.getElementById('staff-status');
    const date = doc.getElementById('staff-date');
    const retry = doc.getElementById('staff-retry');
    const courseSection = doc.getElementById('staff-course-section');
    const empty = doc.getElementById('staff-empty');
    if (!grid || !status || !date || !retry || !courseSection || !empty) return;
    const filters = [...doc.querySelectorAll('[data-staff-group]')];
    const courseFilters = [...doc.querySelectorAll('[data-staff-course-group]')];
    const openPhoto = installStaffPhotoViewer(doc);
    let members = [];
    let selected = PRODUCT_GROUP;
    let selectedCourseGroup = '';

    function render() {
      const visible = selectStaffMembers(members, selected, selectedCourseGroup);
      const sections = partitionStaffMembers(visible, selected).map((section) => {
        const container = doc.createElement('section');
        container.className = `staff-section${section.key === 'product' ? ' staff-section--flat' : ''}`;
        container.dataset.staffSection = section.key;
        if (section.title) {
          const heading = doc.createElement('h2');
          heading.className = 'staff-section-title';
          heading.textContent = section.title;
          container.append(heading);
        } else {
          container.setAttribute('aria-label', PRODUCT_GROUP);
        }
        const cards = doc.createElement('div');
        cards.className = 'staff-section-grid';
        cards.append(
          ...section.members.map((member) =>
            createStaffCard(doc, member, section.title ? 'h3' : 'h2', openPhoto),
          ),
        );
        container.append(cards);
        return container;
      });
      grid.replaceChildren(...sections);
      status.textContent = '';
      status.hidden = true;
      courseSection.hidden = selected !== '课程部';
      const unconfirmed = countCourseGroup(members, '待确认');
      const groupCount = countCourseGroup(members, selectedCourseGroup);
      empty.hidden = visible.length > 0 && (!selectedCourseGroup || groupCount > 0);
      empty.textContent =
        selected === '课程部' && selectedCourseGroup && selectedCourseGroup !== '待确认'
          ? `${selectedCourseGroup}暂无已确认成员，未确认组别的伙伴可在“待确认”中查看。`
          : '当前分组暂无成员。';
      filters.forEach((button) => {
        button.setAttribute('aria-pressed', String(button.dataset.staffGroup === selected));
      });
      for (const button of courseFilters) {
        if (button.dataset.staffCourseGroup === '待确认') button.hidden = unconfirmed === 0;
        button.setAttribute(
          'aria-pressed',
          String(button.dataset.staffCourseGroup === selectedCourseGroup),
        );
      }
    }

    filters.forEach((button) => {
      button.addEventListener('click', () => {
        selected = button.dataset.staffGroup;
        selectedCourseGroup = selected === '课程部' ? '数学组' : '';
        render();
      });
    });
    courseFilters.forEach((button) => {
      button.addEventListener('click', () => {
        if (selected !== '课程部') return;
        selectedCourseGroup = button.dataset.staffCourseGroup;
        render();
      });
    });

    async function load() {
      retry.hidden = true;
      grid.setAttribute('aria-busy', 'true');
      status.textContent = '正在加载名录…';
      status.hidden = false;
      for (const button of [...filters, ...courseFilters]) {
        button.disabled = true;
      }
      try {
        const response = await request('/data/staff.json', { credentials: 'same-origin' });
        if (!response.ok) throw new Error('名录加载失败');
        const roster = normalizeStaffRoster(await response.json());
        members = roster.members;
        date.textContent = roster.sourceDate
          ? `名录更新于 ${roster.sourceDate.replaceAll('-', '.')}`
          : '';
        for (const count of doc.querySelectorAll('[data-staff-count]')) {
          count.textContent = String(selectStaffMembers(members, count.dataset.staffCount).length);
        }
        for (const count of doc.querySelectorAll('[data-staff-course-count]')) {
          count.textContent = String(countCourseGroup(members, count.dataset.staffCourseCount));
        }
        render();
        for (const button of [...filters, ...courseFilters]) {
          button.disabled = false;
        }
      } catch {
        status.textContent = '名录暂时加载失败，请稍后重试。';
        status.hidden = false;
        retry.hidden = false;
      } finally {
        grid.setAttribute('aria-busy', 'false');
      }
    }

    retry.addEventListener('click', load);
    await load();
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      normalizeStaffRoster,
      selectStaffMembers,
      countCourseGroup,
      partitionStaffMembers,
      createStaffCard,
      installStaffPhotoViewer,
      installStaffDirectory,
    };
  } else {
    installStaffDirectory({ document, fetch: window.fetch.bind(window) });
  }
})();
