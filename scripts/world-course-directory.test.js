const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'public/world.js'), 'utf8').replace(/\r\n/g, '\n');
const html = fs.readFileSync(path.join(root, 'public/world.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/world-course-directory.css'), 'utf8');
const worldsLiteral = script
  .slice(
    script.indexOf('const studyWorlds = ') + 20,
    script.indexOf('\n\nconst HIDDEN_ORBIT_SLOTS'),
  )
  .replace(/;\s*$/, '');
const worlds = JSON.parse(JSON.stringify(vm.runInNewContext(`(${worldsLiteral})`)));
const renderer = script.slice(
  script.indexOf('function courseHref('),
  script.indexOf('function discussionHref('),
);

function harness(studyWorlds, missing = false) {
  const createElement = (tag) => ({
    tag,
    children: [],
    dataset: {},
    hidden: true,
    append(...children) {
      this.children.push(...children);
    },
    replaceChildren(...children) {
      this.children = children;
    },
  });
  const elements = missing
    ? {}
    : { courseDirectory: createElement('nav'), courseDirectoryList: createElement('ul') };
  const context = vm.createContext({
    studyWorlds,
    elements,
    document: { createElement },
    encodeURIComponent,
  });
  vm.runInContext(`${renderer}\nrenderWorldCourseDirectory();`, context);
  return { elements, context };
}

test('direct course directory reuses only the three actually open course destinations', () => {
  const { elements } = harness(worlds);
  assert.equal(elements.courseDirectory.hidden, false);
  const links = elements.courseDirectoryList.children.map((item) => item.children[0]);
  assert.deepEqual(
    links.map((link) => link.href),
    ['/course?course=math', '/course?course=circuits', '/course?course=signals'],
  );
  assert.deepEqual(
    links.map((link) => link.textContent),
    ['高等微积分', '电子电路与系统基础', '信号与系统'],
  );
  assert.ok(links.every((link) => link.tag === 'a'));
  assert.ok(links.every((link) => !link.onclick && !link.target));
});

test('coming, malformed, empty, duplicate and external destinations cannot become direct links', () => {
  const input = [
    { status: 'coming', courses: [{ slug: 'future', name: '未来课程' }] },
    {
      status: 'active',
      courses: [
        null,
        { slug: 'https://outside.test', name: '外部' },
        { slug: '//outside', name: '外部' },
        { slug: 'math', name: '  微积分  ' },
        { slug: 'math', name: '重复' },
        { slug: 'empty', name: '  ' },
      ],
    },
    { status: 'active', courses: null },
  ];
  const before = JSON.stringify(input);
  const { elements, context } = harness(input);
  assert.equal(
    JSON.stringify(input),
    before,
    'Page rendering does not change the source catalogue',
  );
  assert.equal(elements.courseDirectoryList.children.length, 1);
  assert.equal(elements.courseDirectoryList.children[0].children[0].textContent, '微积分');
  vm.runInContext('renderWorldCourseDirectory()', context);
  assert.equal(elements.courseDirectoryList.children.length, 1, 'Rerender is idempotent');
});

test('empty catalogue and older markup are safe without new authentication or record writes', () => {
  assert.equal(harness([]).elements.courseDirectory.hidden, true);
  assert.doesNotThrow(() => harness(worlds, true));
  assert.doesNotMatch(renderer, /fetch\(|localStorage|sessionStorage|dispatchEvent|\.innerHTML/);
});

test('directory is a discoverable keyboard-native route while all existing orbit hooks remain', () => {
  assert.match(
    html,
    /class="world-course-directory"[\s\S]*?aria-labelledby="world-course-directory-title"/,
  );
  assert.match(html, />直接选课程</);
  assert.match(html, /id="world-course-directory-list"/);
  assert.match(html, /world-course-directory\.css\?v=20261016-direct-courses-1/);
  assert.match(html, /world\.js\?v=20261016-direct-courses-1/);
  assert.match(script, /updateOrbitState\(\);\s*renderWorldCourseDirectory\(\);\s*$/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /overflow-wrap:\s*anywhere/);
  assert.doesNotMatch(css, /position:\s*(?:fixed|absolute)/);
});
