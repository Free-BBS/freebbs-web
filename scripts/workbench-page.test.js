const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'workbench.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const controller = fs.readFileSync(path.join(root, 'public', 'workbench.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'workbench.css'), 'utf8');

test('workbench only references installed local Markdown assets', () => {
  assert.match(html, /\/vendor\/marked\/lib\/marked\.umd\.js/);
  assert.doesNotMatch(html, /\/vendor\/dompurify\//);
});

test('workbench exposes semester-scoped Learn courses and notices', () => {
  assert.match(html, /id="workbench-campus-semester"/);
  assert.match(html, /id="workbench-campus-course-list"/);
  assert.match(html, /id="workbench-campus-notice-list"/);
  assert.match(controller, /\/workbench\/campus\/semesters/);
  assert.match(controller, /renderCampusSemester/);
});

test('workbench keeps accessible live regions for all personal summaries', () => {
  for (const id of [
    'workbench-priority-list',
    'workbench-notification-list',
    'workbench-schedule-list',
  ]) {
    assert.match(
      html,
      new RegExp(
        `id=["']${id}["'][\\s\\S]{0,180}aria-live=["']polite["'][\\s\\S]{0,120}aria-busy=["']false["']`,
      ),
    );
  }
});

test('workbench restores the signed-in economy shortcuts', () => {
  assert.match(html, /id="workbench-checkin-entry"[\s\S]{0,160}<span>每日签到<\/span>/);
  assert.match(html, /class="workbench-card workbench-card-button fortune-link hidden"/);
  assert.match(html, /id="workbench-electromagnetic-entry"[\s\S]{0,80}href="\/electromagnetic"/);
  assert.match(html, /id="workbench-inventory-entry"[\s\S]{0,80}href="\/inventory"/);
  assert.match(app, /fortuneLinks\.forEach\([\s\S]*openFortuneModal\(\)/);
  assert.match(css, /\.workbench-card\.hidden\s*\{[\s\S]*display:\s*none/);
  assert.match(css, /\.workbench-card-button\s*\{[\s\S]*text-align:\s*left/);
});

test('workbench loads real summaries only through the authenticated API wrapper', () => {
  assert.match(html, /data-workbench-controller="standalone"/);
  assert.match(app, /document\.body\.dataset\.workbenchController === 'standalone'/);
  assert.match(app, /callApi\('\/workbench\/summary', \{ method: 'GET' \}\)/);
  assert.match(app, /getWorkbenchOwnerKey\(\) !== ownerKey/);
  assert.match(app, /requestVersion !== workbenchDashboardState\.requestVersion/);
  assert.match(app, /error\.status === 401/);
  assert.doesNotMatch(app, /通知与事项接口接入后/);
  assert.doesNotMatch(app, /通知数据待接入/);
});

test('workbench exposes honest loading, empty, error and retry states', () => {
  assert.match(app, /正在读取你的个人工作台数据/);
  assert.match(app, /暂无重要事项/);
  assert.match(app, /暂无新通知/);
  assert.match(app, /本周暂无已确认日程/);
  assert.match(app, /暂时无法加载/);
  assert.match(app, /data-workbench-retry/);
  assert.match(css, /\.workbench-retry-action/);
});

test('workbench provides authenticated CRUD controls and conflict confirmation', () => {
  assert.match(html, /id="workbench-add-important"/);
  assert.match(html, /id="workbench-important-dialog"/);
  assert.match(html, /id="workbench-add-schedule"/);
  assert.match(html, /id="workbench-schedule-dialog"/);
  assert.match(html, /src="\/workbench\.js\?v=20260803-sync-closure-1"/);
  assert.match(controller, /\/workbench\/important-items/);
  assert.match(controller, /\/workbench\/schedule-items\/conflicts/);
  assert.match(controller, /\/confirm/);
  assert.match(controller, /payload\.version = Number/);
  assert.match(controller, /state\.conflictAcknowledgement/);
  assert.match(controller, /确认事项/u);
  assert.match(controller, /confirm-important/);
  assert.match(controller, /status: 'confirmed'/);
  assert.match(controller, /24 小时内截止/u);
  assert.match(controller, /不会自动占用时间表/u);
});

test('connector self-check targets the two primary portals without accepting arbitrary URLs', () => {
  assert.match(html, /网络学堂与信息门户/);
  assert.match(controller, /connectors\/primary-portals\/probe/);
  assert.match(controller, /connectors\/public-notices\/probe/);
  assert.match(controller, /connectors\/tsinghua-learn\/capabilities/);
  assert.match(controller, /等待校方批准的授权传输/);
  assert.match(html, /不会取得私有数据/);
  assert.match(html, /尚无真实同步记录/);
  assert.match(html, /私有数据同步尚未实现/);
  assert.match(html, /运行连通性与公开解析自检/);
  assert.doesNotMatch(controller, /认证后抓取核心就绪/);
  assert.match(controller, /portal\.safeguards\?\.credentialsSent === false/);
  assert.match(controller, /publicSource\?\.safeguards\?\.authenticationUsed === false/);
  assert.match(controller, /publicSource\.cached \? '缓存' : '实时'/);
  assert.match(css, /workbench-form-grid[\s\S]*grid-template-columns: 1fr/);
  assert.doesNotMatch(controller, /new URL\(.*sourceProbe/);
});
