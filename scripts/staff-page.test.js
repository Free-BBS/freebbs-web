const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  normalizeStaffRoster,
  selectStaffMembers,
  countCourseGroup,
  partitionStaffMembers,
  createStaffCard,
  installStaffPhotoViewer,
  installStaffDirectory,
} = require('../public/staff');
const roster = require('../public/data/staff.json');

const PRODUCT_GROUP = '产品设计·总负责人';
const PRODUCT_NAMES = [
  '张亦驰',
  '周步星',
  '刘国豪',
  '王从一',
  '刘家赫',
  '张弛',
  '项思锐',
  '江玮陶',
  '王宇翀',
];

function element(tagName = 'div') {
  const attributes = new Map();
  const events = new Map();
  const classes = new Set();
  const node = {
    tagName,
    children: [],
    dataset: {},
    textContent: '',
    hidden: false,
    disabled: false,
    append(...children) {
      this.children.push(...children);
    },
    replaceChildren(...children) {
      this.children = children;
    },
    setAttribute(name, value) {
      attributes.set(name, value);
    },
    getAttribute(name) {
      return attributes.get(name);
    },
    addEventListener(name, handler) {
      events.set(name, handler);
    },
    trigger(name, event) {
      return events.get(name)?.(event);
    },
    focus() {
      this.focused = true;
    },
    classList: {
      add(name) {
        classes.add(name);
      },
      toggle(name, force) {
        if (force) classes.add(name);
        else classes.delete(name);
      },
      contains(name) {
        return classes.has(name);
      },
    },
  };
  Object.defineProperty(node, 'innerHTML', {
    set() {
      throw new Error('Public staff text must never become markup');
    },
  });
  return node;
}

function directoryDocument() {
  const ids = Object.fromEntries(
    [
      'staff-grid',
      'staff-status',
      'staff-date',
      'staff-retry',
      'staff-course-section',
      'staff-empty',
      'staff-photo-dialog',
      'staff-photo-name',
      'staff-photo-close',
      'staff-photo-image',
      'staff-photo-status',
    ].map((id) => [id, element()]),
  );
  ids['staff-course-section'].hidden = true;
  ids['staff-empty'].hidden = true;
  const dialog = ids['staff-photo-dialog'];
  dialog.open = false;
  dialog.showModal = () => {
    dialog.open = true;
  };
  dialog.close = () => {
    dialog.open = false;
    dialog.trigger('close');
  };
  dialog.getBoundingClientRect = () => ({ left: 20, right: 200, top: 20, bottom: 400 });
  const filters = [PRODUCT_GROUP, '课程部', '技术部', '战略部'].map((group) => {
    const button = element('button');
    button.dataset.staffGroup = group;
    return button;
  });
  const counts = filters.map((button) => {
    const count = element('span');
    count.dataset.staffCount = button.dataset.staffGroup;
    return count;
  });
  const courseFilters = ['数学组', '电路组', '信号组', '待确认'].map((group) => {
    const button = element('button');
    button.dataset.staffCourseGroup = group;
    return button;
  });
  const courseCounts = courseFilters.map((button) => {
    const count = element('span');
    count.dataset.staffCourseCount = button.dataset.staffCourseGroup;
    return count;
  });
  return {
    ids,
    filters,
    counts,
    courseFilters,
    courseCounts,
    createElement: element,
    getElementById: (id) => ids[id],
    querySelectorAll: (selector) =>
      ({
        '[data-staff-group]': filters,
        '[data-staff-count]': counts,
        '[data-staff-course-group]': courseFilters,
        '[data-staff-course-count]': courseCounts,
      })[selector] || [],
  };
}

function directoryCards(doc) {
  const cards = [];
  function visit(node) {
    if (node.tagName === 'article') cards.push(node);
    else node.children.forEach(visit);
  }
  visit(doc.ids['staff-grid']);
  return cards;
}

function cardNames(doc) {
  return directoryCards(doc).map((card) => card.children[1].children[0].textContent);
}

function groupedRoster() {
  return {
    sourceDate: '2026-10-01',
    members: [
      { name: '课程甲', groups: ['课程部', '技术部'], courseGroups: ['数学组', '电路组'] },
      { name: '课程乙', groups: ['课程部'], courseGroups: ['信号组'] },
      { name: '课程丙', groups: ['课程部'] },
      { name: '课程丁', groups: ['课程部', '战略部'], courseGroups: [] },
      { name: '技术甲', groups: ['技术部'] },
      { name: '部门未确认', groups: [] },
    ],
  };
}

test('public roster contains only approved fields and 34 unique members', () => {
  assert.deepEqual(Object.keys(roster).sort(), ['members', 'sourceDate']);
  assert.equal(roster.sourceDate, '2026-10-02');
  assert.equal(roster.members.length, 34);
  assert.equal(new Set(roster.members.map((member) => member.name)).size, 34);
  roster.members.forEach((member) => {
    assert.ok(
      Object.keys(member).every((key) =>
        [
          'groups',
          'courseGroups',
          'courseResponsibilities',
          'generalResponsibilities',
          'responsibilities',
          'introduction',
          'name',
          'photo',
        ].includes(key),
      ),
    );
    assert.ok(
      ['groups', 'introduction', 'name', 'photo'].every((key) => Object.hasOwn(member, key)),
    );
    assert.doesNotMatch(member.introduction, /【请输入文本】|wenjuan\.tsinghua\.edu\.cn/);
  });
  assert.equal(roster.members.filter((member) => member.photo).length, 34);
  assert.equal(new Set(roster.members.map((member) => member.photo)).size, 34);
  const zhang = roster.members.find((member) => member.name === '张亦驰');
  assert.equal(zhang.name, '张亦驰');
  assert.ok(zhang.groups.includes('课程部'));
  assert.equal(
    zhang.introduction,
    '苟利于民，不必法古；苟周于事，不必循俗。勠力同心，和衷共济；草木蔓发，春山在望。击鼓催征稳驭舟，奋楫扬帆启新程。',
  );
  assert.equal(zhang.photo, '/assets/staff/zhang-yichi.png');
  assert.equal(roster.members.find((member) => member.name === '周柏田').introduction, '');
  assert.match(
    roster.members.find((member) => member.name === '江玮陶').introduction,
    /www\.weitao-jiang\.cn/,
  );
  assert.match(
    roster.members.find((member) => member.name === '宋宣增').introduction,
    /linkedin\.com/,
  );
});

test('group filtering preserves cross-group members without inflating the total', () => {
  const { members } = normalizeStaffRoster(roster);
  assert.equal(selectStaffMembers(members).length, 34);
  for (const [group, expected] of [
    ['课程部', 20],
    ['技术部', 11],
    ['战略部', 7],
  ]) {
    const filtered = selectStaffMembers(members, group);
    assert.equal(filtered.length, expected);
    assert.equal(new Set(filtered.map((member) => member.name)).size, expected);
  }
  for (const group of ['课程部', '技术部']) {
    const names = selectStaffMembers(members, group).map((member) => member.name);
    assert.ok(names.includes('江玮陶'));
    assert.ok(names.includes('宋宣增'));
  }
  for (const group of ['战略部', '技术部']) {
    assert.ok(selectStaffMembers(members, group).some((member) => member.name === '王宇翀'));
  }
  for (const group of ['课程部', '战略部']) {
    assert.ok(selectStaffMembers(members, group).some((member) => member.name === '张弛'));
  }
});

test('published course groups and responsibilities follow the confirmed roster without guessing unassigned members', () => {
  const { members } = normalizeStaffRoster(roster);
  for (const [group, names] of [
    ['数学组', ['刘正韬', '周柏田', '郭东琦', '王渚僖', '罗昊东', '刘君锋', '李方时', '孟广轩']],
    ['电路组', ['江玮陶', '刘牧杨', '陈曦恺', '杨佳宜', '宋宣增', '林子昂']],
    ['信号组', ['陈禛兴', '张弛', '张宸瑞', '王禹博']],
    ['待确认', []],
  ]) {
    const groupMembers = members.filter(
      (member) => member.groups.includes('课程部') && member.courseGroups.includes(group),
    );
    assert.deepEqual(groupMembers.map((member) => member.name).sort(), [...names].sort());
    assert.equal(countCourseGroup(members, group), names.length);
  }
  assert.deepEqual(
    Object.fromEntries(
      members
        .filter((member) => member.courseResponsibilities.length)
        .map((member) => [member.name, member.courseResponsibilities]),
    ),
    {
      刘正韬: ['高等微积分课程负责人'],
      江玮陶: ['电子电路与系统基础课程负责人'],
      陈禛兴: ['信号与系统课程负责人'],
      宋宣增: ['数字逻辑与处理器课程负责人'],
    },
  );
});

test('course subgroups require course department membership and appear beside the department', () => {
  const input = {
    name: '测试成员',
    groups: ['课程部'],
    courseGroups: ['数学组'],
    introduction: '',
    photo: '',
  };
  const member = normalizeStaffRoster({ members: [input] }).members[0];
  const card = createStaffCard({ createElement: element }, member);
  const labels = card.children[1].children[1].children.map((node) => node.textContent);
  assert.deepEqual(labels, ['课程部·数学组']);
  assert.throws(
    () => normalizeStaffRoster({ members: [{ ...input, groups: ['技术部'] }] }),
    /课程部组别/,
  );
  assert.throws(
    () => normalizeStaffRoster({ members: [{ ...input, courseGroups: ['猜测的组别'] }] }),
    /课程部组别/,
  );
  assert.throws(
    () => normalizeStaffRoster({ members: [{ ...input, courseGroups: '数学组' }] }),
    /课程部组别/,
  );
  assert.deepEqual(
    normalizeStaffRoster({ members: [{ ...input, courseGroups: undefined }] }).members[0]
      .courseGroups,
    [],
  );
});

test('course subgroup selection intersects departments and keeps unconfirmed and cross-group members', () => {
  const { members } = normalizeStaffRoster(groupedRoster());
  assert.equal(selectStaffMembers(members).length, 6);
  assert.equal(selectStaffMembers(members, '课程部').length, 4);
  assert.deepEqual(
    selectStaffMembers(members, '课程部', '数学组').map((member) => member.name),
    ['课程甲'],
  );
  assert.deepEqual(
    selectStaffMembers(members, '课程部', '电路组').map((member) => member.name),
    ['课程甲'],
  );
  assert.deepEqual(
    selectStaffMembers(members, '课程部', '信号组').map((member) => member.name),
    ['课程乙'],
  );
  assert.deepEqual(
    selectStaffMembers(members, '课程部', '待确认').map((member) => member.name),
    ['课程丙', '课程丁'],
  );
  assert.deepEqual(
    selectStaffMembers(members, '技术部', '数学组').map((member) => member.name),
    ['课程甲', '技术甲'],
  );
  const duplicated = normalizeStaffRoster({
    members: [{ name: '跨组', groups: ['课程部'], courseGroups: ['数学组', '电路组', '数学组'] }],
  }).members;
  assert.deepEqual(duplicated[0].courseGroups, ['数学组', '电路组']);
  assert.equal(selectStaffMembers(duplicated, '课程部', '数学组').length, 1);
});

test('course responsibility labels stay plain text, deduplicate and require course membership', () => {
  const responsibility = '<img src=x onerror=alert(1)>课程负责人';
  const input = {
    name: '负责人',
    groups: ['课程部', '技术部'],
    courseResponsibilities: [responsibility, ` ${responsibility} `, '第二课程负责人'],
  };
  const member = normalizeStaffRoster({ members: [input] }).members[0];
  assert.deepEqual(member.courseResponsibilities, [responsibility, '第二课程负责人']);
  const card = createStaffCard({ createElement: element }, member);
  const labels = card.children[1].children[2];
  assert.equal(labels.tagName, 'ul');
  assert.equal(labels.className, 'staff-person-responsibilities');
  assert.equal(labels.children[0].tagName, 'li');
  assert.equal(labels.children[0].textContent, responsibility);
  assert.equal(labels.children[0].children.length, 0);
  assert.equal(labels.children[1].textContent, '第二课程负责人');
  assert.throws(
    () => normalizeStaffRoster({ members: [{ ...input, groups: ['技术部'] }] }),
    /课程负责人/,
  );
  for (const invalid of ['课程负责人', [null], [23], ['   ']]) {
    assert.throws(
      () => normalizeStaffRoster({ members: [{ ...input, courseResponsibilities: invalid }] }),
      /课程负责人/,
    );
  }
  assert.deepEqual(
    normalizeStaffRoster({ members: [{ ...input, courseResponsibilities: undefined }] }).members[0]
      .courseResponsibilities,
    [],
  );
  const nonCourseCard = createStaffCard(
    { createElement: element },
    { ...member, groups: ['技术部'] },
  );
  assert.equal(nonCourseCard.children[1].children.length, 2);
});

test('general responsibilities accept only confirmed role titles and render each role safely', () => {
  const input = {
    name: '多岗负责人',
    groups: ['课程部'],
    generalResponsibilities: ['产品设计总负责人', '课程总负责人', '产品设计总负责人'],
  };
  const member = normalizeStaffRoster({ members: [input] }).members[0];
  assert.deepEqual(member.generalResponsibilities, ['产品设计总负责人', '课程总负责人']);
  const card = createStaffCard({ createElement: element }, member);
  const labels = card.children[1].children[2];
  assert.equal(labels.tagName, 'ul');
  assert.equal(labels.className, 'staff-person-general-responsibilities');
  assert.deepEqual(
    labels.children.map((node) => node.textContent),
    ['产品设计总负责人', '课程总负责人'],
  );
  for (const invalid of ['课程总负责人', [null], ['臆造总负责人'], ['<img src=x>']]) {
    assert.throws(
      () => normalizeStaffRoster({ members: [{ ...input, generalResponsibilities: invalid }] }),
      /总负责人/,
    );
  }
  const unsafeText = '<img src=x onerror=alert(1)>负责人';
  const textCard = createStaffCard(
    { createElement: element },
    { ...member, generalResponsibilities: [unsafeText] },
  );
  const textLabel = textCard.children[1].children[2].children[0];
  assert.equal(textLabel.textContent, unsafeText);
  assert.equal(textLabel.children.length, 0);
});

test('ordinary responsibilities validate string arrays, deduplicate and display as safe text before the introduction', () => {
  const responsibility = '<img src=x onerror=alert(1)>宣传推广负责人';
  const input = {
    name: '职责成员',
    groups: ['战略部'],
    introduction: '原有介绍',
    responsibilities: [` ${responsibility} `, responsibility, '其他职责'],
  };
  const member = normalizeStaffRoster({ members: [input] }).members[0];
  assert.deepEqual(member.responsibilities, [responsibility, '其他职责']);
  const card = createStaffCard({ createElement: element }, member);
  const [name, groups, roles, introduction] = card.children[1].children;
  assert.equal(name.textContent, input.name);
  assert.equal(groups.children[0].textContent, '战略部');
  assert.equal(roles.tagName, 'ul');
  assert.equal(roles.className, 'staff-person-responsibilities');
  assert.deepEqual(
    roles.children.map((node) => node.textContent),
    [responsibility, '其他职责'],
  );
  assert.equal(roles.children[0].children.length, 0);
  assert.equal(introduction.textContent, input.introduction);
  for (const invalid of ['宣传推广负责人', null, [null], [23], [''], ['   ']]) {
    assert.throws(
      () => normalizeStaffRoster({ members: [{ ...input, responsibilities: invalid }] }),
      /成员职责/,
    );
  }
  assert.deepEqual(
    normalizeStaffRoster({ members: [{ ...input, responsibilities: undefined }] }).members[0]
      .responsibilities,
    [],
  );
  assert.equal(selectStaffMembers([member], PRODUCT_GROUP).length, 0);
});

test('Shi Hao keeps strategic placement and displays promotion responsibility without joining product leaders', async () => {
  const { members } = normalizeStaffRoster(roster);
  const staffWithResponsibilities = members.filter((member) => member.responsibilities.length);
  assert.deepEqual(
    staffWithResponsibilities.map((member) => member.name),
    ['时豪'],
  );
  assert.deepEqual(staffWithResponsibilities[0].responsibilities, ['宣传推广负责人']);
  assert.deepEqual(staffWithResponsibilities[0].generalResponsibilities, []);
  assert.deepEqual(
    selectStaffMembers(members, PRODUCT_GROUP).map((member) => member.name),
    PRODUCT_NAMES,
  );
  const doc = directoryDocument();
  await installStaffDirectory({
    document: doc,
    fetch: async () => ({ ok: true, json: async () => roster }),
  });
  doc.filters[3].trigger('click');
  assert.deepEqual(cardNames(doc), [
    '刘国豪',
    '张弛',
    '项思锐',
    '王宇翀',
    '时豪',
    '杨咏',
    '秦琢言',
  ]);
  const card = directoryCards(doc).find(
    (node) => node.children[1].children[0].textContent === '时豪',
  );
  const roles = card.children[1].children.find(
    (node) => node.className === 'staff-person-responsibilities',
  );
  assert.deepEqual(
    roles.children.map((node) => node.textContent),
    ['宣传推广负责人'],
  );
  assert.equal(
    card.children[1].children.at(-1).textContent,
    staffWithResponsibilities[0].introduction,
  );
});

test('department sections prioritize matching general leaders then course leaders without duplicate people', () => {
  const { members } = normalizeStaffRoster({
    members: [
      { name: '课程成员', groups: ['课程部'] },
      { name: '课程负责人', groups: ['课程部'], courseResponsibilities: ['某课程负责人'] },
      {
        name: '开发负责人',
        groups: ['课程部', '技术部'],
        generalResponsibilities: ['开发总负责人'],
      },
      {
        name: '课程总一',
        groups: ['课程部'],
        generalResponsibilities: ['课程总负责人', '产品设计总负责人'],
        courseResponsibilities: ['兼任课程负责人'],
      },
      { name: '课程总二', groups: ['课程部'], generalResponsibilities: ['课程总负责人'] },
      { name: '技术总', groups: ['技术部'], generalResponsibilities: ['技术总负责人'] },
    ],
  });
  const sections = partitionStaffMembers(selectStaffMembers(members, '课程部'), '课程部');
  assert.deepEqual(
    sections.map((section) => [section.title, section.members.map((member) => member.name)]),
    [
      ['总负责人', ['课程总一', '课程总二']],
      ['课程负责人', ['课程负责人']],
      ['成员', ['开发负责人', '课程成员']],
    ],
  );
  assert.equal(new Set(sections.flatMap((section) => section.members)).size, 5);
  const technical = partitionStaffMembers(selectStaffMembers(members, '技术部'), '技术部');
  assert.deepEqual(
    technical.map((section) => [section.title, section.members.map((member) => member.name)]),
    [
      ['总负责人', ['技术总']],
      ['成员', ['开发负责人']],
    ],
  );
  const product = selectStaffMembers(members, PRODUCT_GROUP);
  assert.deepEqual(
    product.map((member) => member.name),
    ['开发负责人', '课程总一', '课程总二', '技术总'],
  );
  assert.equal(partitionStaffMembers(product, PRODUCT_GROUP).length, 1);
});

test('only ordinary course and technical members sort by Chinese pinyin while leaders and other columns keep their order', () => {
  const { members } = normalizeStaffRoster({
    members: [
      {
        name: '张总',
        groups: ['课程部', '技术部', '战略部'],
        generalResponsibilities: ['课程总负责人', '技术总负责人', '战略总负责人'],
      },
      {
        name: '陈总',
        groups: ['课程部', '技术部', '战略部'],
        generalResponsibilities: ['课程总负责人', '技术总负责人', '战略总负责人'],
      },
      { name: '王负责人', groups: ['课程部'], courseResponsibilities: ['第一课程负责人'] },
      { name: '李负责人', groups: ['课程部'], courseResponsibilities: ['第二课程负责人'] },
      ...['张一', '王青', '李飞', '陈洪'].map((name) => ({
        name,
        groups: ['课程部', '技术部', '战略部'],
      })),
    ],
  });
  const originalNames = members.map((member) => member.name);
  for (const group of ['课程部', '技术部']) {
    const sections = partitionStaffMembers(selectStaffMembers(members, group), group);
    assert.deepEqual(
      sections.find((section) => section.key === 'members').members.map((member) => member.name),
      ['陈洪', '李飞', '王青', '张一'],
    );
    assert.deepEqual(
      sections[0].members.map((member) => member.name),
      ['张总', '陈总'],
    );
    if (group === '课程部') {
      assert.deepEqual(
        sections[1].members.map((member) => member.name),
        ['王负责人', '李负责人'],
      );
    }
  }
  const strategic = partitionStaffMembers(selectStaffMembers(members, '战略部'), '战略部');
  assert.deepEqual(
    strategic[1].members.map((member) => member.name),
    ['张一', '王青', '李飞', '陈洪'],
  );
  assert.deepEqual(
    partitionStaffMembers(selectStaffMembers(members, PRODUCT_GROUP), PRODUCT_GROUP)[0].members.map(
      (member) => member.name,
    ),
    ['张总', '陈总'],
  );
  assert.deepEqual(
    members.map((member) => member.name),
    originalNames,
  );
});

test('course subgroup views retain general leaders but button counts and pending assignments exclude them', async () => {
  const data = {
    members: [
      { name: '总一', groups: ['课程部'], generalResponsibilities: ['课程总负责人'] },
      { name: '总二', groups: ['课程部'], generalResponsibilities: ['课程总负责人'] },
      {
        name: '跨组成员',
        groups: ['课程部', '技术部'],
        courseGroups: ['数学组', '电路组'],
      },
      { name: '信号成员', groups: ['课程部'], courseGroups: ['信号组'] },
    ],
  };
  const { members } = normalizeStaffRoster(data);
  assert.equal(countCourseGroup(members, ''), 4);
  assert.equal(countCourseGroup(members, '数学组'), 1);
  assert.equal(countCourseGroup(members, '待确认'), 0);
  assert.equal(
    countCourseGroup([{ ...members[0], courseGroups: ['数学组'] }, members[2]], '数学组'),
    1,
  );
  assert.deepEqual(
    selectStaffMembers(members, '课程部', '数学组').map((member) => member.name),
    ['总一', '总二', '跨组成员'],
  );
  const crossCard = createStaffCard({ createElement: element }, members[2]);
  assert.deepEqual(
    crossCard.children[1].children[1].children.map((node) => node.textContent),
    ['课程部·数学组', '课程部·电路组', '技术部'],
  );
  const leaderCard = createStaffCard({ createElement: element }, members[0]);
  assert.deepEqual(
    leaderCard.children[1].children[1].children.map((node) => node.textContent),
    ['课程部'],
  );
  const doc = directoryDocument();
  await installStaffDirectory({
    document: doc,
    fetch: async () => ({ ok: true, json: async () => data }),
  });
  assert.equal(doc.courseFilters[3].hidden, true);
  doc.filters[1].trigger('click');
  doc.courseFilters[0].trigger('click');
  assert.deepEqual(cardNames(doc), ['总一', '总二', '跨组成员']);
  assert.equal(doc.ids['staff-status'].hidden, true);
  assert.equal(doc.ids['staff-status'].textContent, '');
  assert.equal(new Set(cardNames(doc)).size, 3);
});

test('invalid duplicate entries fail visibly and photo sources stay local', () => {
  const member = {
    name: '测试成员',
    groups: [],
    introduction: '',
    photo: 'https://other.invalid/a.png',
  };
  assert.equal(normalizeStaffRoster({ members: [member] }).members[0].photo, '');
  assert.throws(() => normalizeStaffRoster({ members: [member, member] }), /成员信息/);
  assert.throws(
    () => normalizeStaffRoster({ members: [{ ...member, groups: ['臆造职位'] }] }),
    /部门/,
  );
  assert.throws(() => normalizeStaffRoster({ members: [] }), /不完整/);
  for (const photo of [
    '/assets/staff/../secret.png',
    '//other.invalid/a.png',
    '/assets/staff/a.svg',
  ]) {
    assert.equal(normalizeStaffRoster({ members: [{ ...member, photo }] }).members[0].photo, '');
  }
});

test('public names and introductions render as text and empty introductions add no placeholder', () => {
  const doc = { createElement: element };
  const introduction = '<img src=x onerror=alert(1)> www.example.com';
  const card = createStaffCard(doc, {
    name: '<script>name</script>',
    groups: ['技术部'],
    introduction,
    photo: '',
  });
  const copy = card.children[1];
  assert.equal(copy.children[0].textContent, '<script>name</script>');
  assert.equal(copy.children[2].tagName, 'p');
  assert.equal(copy.children[2].textContent, introduction);
  assert.equal(copy.children[2].children.length, 0);
  const blank = createStaffCard(doc, { name: '张亦驰', groups: [], introduction: '', photo: '' });
  assert.equal(blank.children[1].children.length, 1);
});

test('long introductions display their complete original text immediately without disclosure controls', () => {
  const introduction = '完整介绍文字'.repeat(20);
  const card = createStaffCard(
    { createElement: element },
    { name: '成员', groups: [], introduction, photo: '' },
  );
  const [heading, paragraph] = card.children[1].children;
  assert.equal(heading.textContent, '成员');
  assert.equal(paragraph.textContent, introduction);
  assert.equal(card.children[1].children.length, 2);
  assert.equal(paragraph.classList.contains('is-collapsible'), false);
});

test('a missing photo falls back to the member name', () => {
  const card = createStaffCard(
    { createElement: element },
    { name: '成员', groups: [], introduction: '', photo: '/assets/staff/a.png' },
  );
  const [fallback, photo] = card.children[0].children;
  photo.trigger('load');
  assert.equal(fallback.hidden, true);
  photo.trigger('error');
  assert.equal(photo.hidden, true);
  assert.equal(fallback.hidden, false);
});

test('a loaded photo opens its original local image and close restores focus to the same member', () => {
  const doc = directoryDocument();
  const member = {
    name: '成员',
    groups: [],
    introduction: '',
    photo: '/assets/staff/member.png',
  };
  const card = createStaffCard(doc, member, 'h2', installStaffPhotoViewer(doc));
  const avatar = card.children[0];
  const [fallback, image] = avatar.children;
  assert.equal(avatar.tagName, 'button');
  assert.equal(avatar.getAttribute('aria-haspopup'), 'dialog');
  avatar.trigger('click');
  assert.equal(doc.ids['staff-photo-dialog'].open, false);
  image.trigger('load');
  assert.equal(avatar.disabled, false);
  assert.equal(fallback.hidden, true);
  assert.equal(image.width, 88);
  assert.equal(image.height, 116);
  avatar.trigger('click');
  assert.equal(doc.ids['staff-photo-dialog'].open, true);
  assert.equal(doc.ids['staff-photo-name'].textContent, member.name);
  assert.equal(doc.ids['staff-photo-image'].src, image.src);
  assert.equal(doc.ids['staff-photo-image'].alt, '成员的照片');
  assert.equal(doc.ids['staff-photo-close'].focused, true);
  doc.ids['staff-photo-close'].trigger('click');
  assert.equal(doc.ids['staff-photo-dialog'].open, false);
  assert.equal(avatar.focused, true);
  image.trigger('error');
  avatar.trigger('click');
  assert.equal(avatar.disabled, true);
  assert.equal(fallback.hidden, false);
  assert.equal(doc.ids['staff-photo-dialog'].open, false);
});

test('photo viewer supports Escape and outside clicks while inside image clicks keep it open', () => {
  const doc = directoryDocument();
  const open = installStaffPhotoViewer(doc);
  const source = element('button');
  const member = { name: '成员', photo: '/assets/staff/member.jpg' };
  const dialog = doc.ids['staff-photo-dialog'];
  open(member, source);
  let prevented = false;
  dialog.trigger('cancel', {
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(dialog.open, false);
  assert.equal(source.focused, true);
  open(member, source);
  dialog.trigger('click', { target: dialog, clientX: 100, clientY: 100 });
  assert.equal(dialog.open, true);
  dialog.trigger('click', { target: doc.ids['staff-photo-image'], clientX: 0, clientY: 0 });
  assert.equal(dialog.open, true);
  source.focused = false;
  dialog.trigger('click', { target: dialog, clientX: 0, clientY: 0 });
  assert.equal(dialog.open, false);
  assert.equal(source.focused, true);
});

test('photo viewer errors identify the current person and never replace their image with another photo', () => {
  const doc = directoryDocument();
  const open = installStaffPhotoViewer(doc);
  const first = { name: '<img src=x>甲', photo: '/assets/staff/a.png' };
  const second = { name: '乙', photo: '/assets/staff/b.jpg' };
  const image = doc.ids['staff-photo-image'];
  const status = doc.ids['staff-photo-status'];
  const dialog = doc.ids['staff-photo-dialog'];
  open(first, element('button'));
  image.trigger('error');
  assert.equal(image.src, first.photo);
  assert.equal(image.hidden, true);
  assert.equal(status.hidden, false);
  assert.equal(status.textContent, '<img src=x>甲的照片暂时无法显示，请关闭后重试。');
  assert.equal(doc.ids['staff-photo-name'].textContent, first.name);
  assert.equal(doc.ids['staff-photo-name'].children.length, 0);
  dialog.close();
  open(second, element('button'));
  assert.equal(image.src, second.photo);
  assert.equal(image.hidden, false);
  assert.equal(status.hidden, true);
  assert.equal(status.textContent, '');
  dialog.close();
  for (const photo of ['https://invalid.example/a.png', '/assets/staff/../a.png', '/a.svg']) {
    open({ ...first, photo }, element('button'));
    assert.equal(dialog.open, false);
    assert.equal(image.src, second.photo);
  }
});

test('directory opens the nine product leaders and provides four columns with three confirmed course groups', async () => {
  const doc = directoryDocument();
  await installStaffDirectory({
    document: doc,
    fetch: async (url) => {
      assert.equal(url, '/data/staff.json');
      return { ok: true, json: async () => roster };
    },
  });
  assert.deepEqual(cardNames(doc), PRODUCT_NAMES);
  assert.equal(doc.ids['staff-status'].hidden, true);
  assert.equal(doc.ids['staff-status'].textContent, '');
  assert.equal(doc.ids['staff-date'].textContent, '名录更新于 2026.10.02');
  assert.equal(doc.ids['staff-course-section'].hidden, true);
  assert.equal(doc.ids['staff-empty'].hidden, true);
  assert.deepEqual(
    doc.counts.map((count) => count.textContent),
    ['9', '20', '11', '7'],
  );
  assert.deepEqual(
    doc.courseCounts.map((count) => count.textContent),
    ['8', '6', '4', '0'],
  );
  assert.equal(doc.courseFilters[3].hidden, true);
  doc.filters[2].trigger('click');
  assert.equal(directoryCards(doc).length, 11);
  assert.equal(doc.filters[2].getAttribute('aria-pressed'), 'true');
  assert.equal(doc.filters[0].getAttribute('aria-pressed'), 'false');
  doc.filters[1].trigger('click');
  assert.equal(directoryCards(doc).length, 10);
  assert.equal(new Set(cardNames(doc)).size, 10);
  assert.equal(doc.courseFilters[0].getAttribute('aria-pressed'), 'true');
  assert.equal(doc.ids['staff-status'].hidden, true);
  assert.deepEqual(
    doc.ids['staff-grid'].children.map((section) => section.dataset.staffSection),
    ['leaders', 'course-leaders', 'members'],
  );
  doc.courseFilters[1].trigger('click');
  assert.equal(directoryCards(doc).length, 8);
  assert.equal(new Set(cardNames(doc)).size, 8);
  assert.ok(cardNames(doc).includes('宋宣增'));
  assert.ok(cardNames(doc).includes('林子昂'));
  doc.courseFilters[2].trigger('click');
  assert.equal(directoryCards(doc).length, 6);
  assert.equal(new Set(cardNames(doc)).size, 6);
  doc.filters[0].trigger('click');
  assert.deepEqual(cardNames(doc), PRODUCT_NAMES);
});

test('two-level buttons switch groups, show cross-membership and reset subgroups on department changes', async () => {
  const doc = directoryDocument();
  await installStaffDirectory({
    document: doc,
    fetch: async () => ({ ok: true, json: async () => groupedRoster() }),
  });
  doc.filters[1].trigger('click');
  assert.equal(doc.ids['staff-course-section'].hidden, false);
  assert.equal(directoryCards(doc).length, 1);
  assert.deepEqual(
    doc.courseCounts.map((count) => count.textContent),
    ['1', '1', '1', '2'],
  );
  assert.equal(doc.courseFilters[0].getAttribute('aria-pressed'), 'true');
  doc.courseFilters[0].trigger('click');
  assert.equal(doc.ids['staff-status'].hidden, true);
  assert.deepEqual(cardNames(doc), ['课程甲']);
  assert.equal(doc.courseFilters[0].getAttribute('aria-pressed'), 'true');
  assert.equal(doc.courseFilters[1].getAttribute('aria-pressed'), 'false');
  doc.courseFilters[1].trigger('click');
  assert.equal(directoryCards(doc).length, 1);
  assert.deepEqual(cardNames(doc), ['课程甲']);
  doc.courseFilters[3].trigger('click');
  assert.equal(directoryCards(doc).length, 2);
  assert.equal(doc.ids['staff-status'].hidden, true);
  doc.filters[2].trigger('click');
  assert.equal(doc.ids['staff-course-section'].hidden, true);
  assert.equal(directoryCards(doc).length, 2);
  assert.ok(doc.courseFilters.every((button) => button.getAttribute('aria-pressed') === 'false'));
  doc.courseFilters[1].trigger('click');
  assert.equal(doc.ids['staff-status'].hidden, true);
  doc.filters[1].trigger('click');
  assert.equal(directoryCards(doc).length, 1);
  assert.equal(doc.ids['staff-status'].hidden, true);
  assert.equal(doc.courseFilters[0].getAttribute('aria-pressed'), 'true');
});

test('unassigned course members remain visible while empty confirmed groups explain how to find them', async () => {
  const doc = directoryDocument();
  const data = {
    members: [
      { name: '待分组甲', groups: ['课程部'] },
      { name: '待分组乙', groups: ['课程部', '技术部'], courseGroups: [] },
    ],
  };
  await installStaffDirectory({
    document: doc,
    fetch: async () => ({ ok: true, json: async () => data }),
  });
  doc.filters[1].trigger('click');
  assert.equal(directoryCards(doc).length, 0);
  assert.deepEqual(
    doc.courseCounts.map((count) => count.textContent),
    ['0', '0', '0', '2'],
  );
  for (const button of doc.courseFilters.slice(0, 3)) {
    button.trigger('click');
    assert.equal(directoryCards(doc).length, 0);
    assert.equal(doc.ids['staff-empty'].hidden, false);
    assert.match(doc.ids['staff-empty'].textContent, /暂无已确认成员.*待确认/);
  }
  assert.equal(doc.courseFilters[3].hidden, false);
  doc.courseFilters[3].trigger('click');
  assert.equal(directoryCards(doc).length, 2);
  assert.equal(doc.ids['staff-empty'].hidden, true);
  doc.courseFilters[0].trigger('click');
  assert.equal(directoryCards(doc).length, 0);
  doc.courseFilters[3].trigger('click');
  assert.equal(directoryCards(doc).length, 2);
});

test('failed data load exposes retry and successfully recovers', async () => {
  const doc = directoryDocument();
  let attempts = 0;
  await installStaffDirectory({
    document: doc,
    fetch: async () => {
      attempts += 1;
      return { ok: attempts > 1, json: async () => roster };
    },
  });
  assert.equal(doc.ids['staff-retry'].hidden, false);
  assert.equal(doc.ids['staff-status'].hidden, false);
  assert.equal(doc.ids['staff-status'].textContent, '名录暂时加载失败，请稍后重试。');
  assert.equal(doc.ids['staff-grid'].getAttribute('aria-busy'), 'false');
  assert.ok([...doc.filters, ...doc.courseFilters].every((button) => button.disabled));
  await doc.ids['staff-retry'].trigger('click');
  assert.equal(doc.ids['staff-retry'].hidden, true);
  assert.equal(doc.ids['staff-status'].hidden, true);
  assert.deepEqual(cardNames(doc), PRODUCT_NAMES);
  assert.ok([...doc.filters, ...doc.courseFilters].every((button) => !button.disabled));
});

test('loading and retry failures remain visible and successful directory rendering removes only the status copy', async () => {
  const doc = directoryDocument();
  const requests = [];
  const loading = installStaffDirectory({
    document: doc,
    fetch: () =>
      new Promise((resolve) => {
        requests.push(resolve);
      }),
  });
  assert.equal(doc.ids['staff-status'].hidden, false);
  assert.equal(doc.ids['staff-status'].textContent, '正在加载名录…');
  assert.equal(doc.ids['staff-grid'].getAttribute('aria-busy'), 'true');
  requests[0]({ ok: false });
  await loading;
  assert.equal(doc.ids['staff-status'].hidden, false);
  assert.match(doc.ids['staff-status'].textContent, /加载失败/);
  const retrying = doc.ids['staff-retry'].trigger('click');
  assert.equal(doc.ids['staff-status'].hidden, false);
  assert.equal(doc.ids['staff-status'].textContent, '正在加载名录…');
  requests[1]({ ok: true, json: async () => roster });
  await retrying;
  assert.equal(doc.ids['staff-status'].hidden, true);
  assert.equal(doc.ids['staff-status'].textContent, '');
  assert.deepEqual(cardNames(doc), PRODUCT_NAMES);
  assert.deepEqual(
    doc.counts.map((count) => count.textContent),
    ['9', '20', '11', '7'],
  );
});

test('staff entry retains shared shell and every local asset exists', () => {
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'public/staff.html'), 'utf8');
  assert.doesNotMatch(html, /建设中|暂未开放|development-construction/);
  assert.match(html, /class="mobile-nav"/);
  assert.match(html, /id="user-panel"/);
  assert.match(html, /src="\/app\.js"/);
  assert.match(html, /href="\/staff\.css"/);
  assert.match(html, /src="\/staff\.js"/);
  assert.match(html, /id="staff-course-section" hidden/);
  assert.match(html, /role="group" aria-label="按课程部组别查看"/);
  for (const group of ['数学组', '电路组', '信号组', '待确认']) {
    assert.ok(html.includes(`data-staff-course-group="${group}"`));
  }
  assert.doesNotMatch(html, /data-staff-(?:course-)?group=""/);
  assert.match(html, /<dialog class="staff-photo-dialog"/);
  assert.match(html, /aria-labelledby="staff-photo-name"/);
  assert.match(html, /id="staff-empty" hidden/);
  for (const match of html.matchAll(/(?:src|href)="(\/(?:assets\/[^" ]+|[\w-]+\.(?:js|css)))"/g)) {
    assert.ok(fs.existsSync(path.join(root, 'public', match[1])), match[1]);
  }
  for (const member of normalizeStaffRoster(roster).members) {
    assert.ok(member.photo, `${member.name} photo`);
    assert.ok(fs.existsSync(path.join(root, 'public', member.photo)), member.photo);
  }
  const photo = fs.readFileSync(path.join(root, 'public/assets/staff/zhang-yichi.png'));
  assert.equal(photo.readUInt32BE(16), 162);
  assert.equal(photo.readUInt32BE(20), 214);
});
