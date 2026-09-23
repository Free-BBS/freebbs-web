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

test('workbench keeps economy shortcuts visible and usable before sign-in', () => {
  assert.match(html, /class="workbench-economy-section"/);
  assert.match(html, /id="workbench-checkin-entry"[\s\S]{0,400}<span>每日签到<\/span>/);
  assert.match(html, /class="workbench-card workbench-card-button fortune-link"/);
  assert.match(html, /id="workbench-electromagnetic-entry"[\s\S]{0,200}href="\/electromagnetic"/);
  assert.match(html, /id="workbench-inventory-entry"[\s\S]{0,200}href="\/inventory"/);
  assert.match(html, /data-workbench-economy-entry/);
  assert.doesNotMatch(html, /workbench-(?:checkin|electromagnetic|inventory)-entry[^>]*hidden/);
  assert.match(app, /fortuneLinks\.forEach\([\s\S]*openFortuneModal\(\)/);
  assert.match(app, /!userState\.isLoggedIn[\s\S]{0,80}openModal\('login'\)/);
  assert.match(app, /!link\.hasAttribute\('data-workbench-economy-entry'\)/);
  assert.match(app, /closest\('\.electromagnetic-link, \.inventory-link'\)/);
  assert.match(css, /\.workbench-card\.hidden\s*\{[\s\S]*display:\s*none/);
  assert.match(css, /\.workbench-card-button\s*\{[\s\S]*text-align:\s*left/);
  assert.match(css, /\.workbench-economy-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(3/);
  assert.match(
    css,
    /\.workbench-economy-section \[data-workbench-economy-entry\][\s\S]*display:\s*grid\s*!important/,
  );
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
  assert.match(html, /src="\/workbench\.js\?v=20260924-schedule-notes-1"/);
  assert.match(controller, /\/workbench\/important-items/);
  assert.match(controller, /\/workbench\/schedule-items\/conflicts/);
  assert.match(controller, /\/confirm/);
  assert.match(controller, /payload\.version = Number/);
  assert.match(controller, /state\.conflictAcknowledgement/);
  assert.match(controller, /确认事项/u);
  assert.match(controller, /confirm-important/);
  assert.match(controller, /status: 'confirmed'/);
  assert.match(controller, /24 小时内截止/u);
  assert.match(controller, /同步后的课程作业截止时间会自动显示在对应日期/u);
  assert.match(controller, /DDL · 截止提醒/u);
});

test('workbench provides a navigable seven-day schedule and review-before-save AI planning', () => {
  assert.doesNotMatch(html, /继续学习/u);
  assert.doesNotMatch(html, /workbench-continue/);
  for (const id of [
    'workbench-week-grid',
    'workbench-week-previous',
    'workbench-week-today',
    'workbench-week-next',
    'workbench-view-toggle',
    'workbench-agent-form',
    'workbench-agent-preview',
    'workbench-agent-confirm',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(controller, /function renderWeekGrid\(/);
  assert.match(controller, /\/workbench\/schedule-planner\/preview/);
  assert.match(controller, /\/workbench\/schedule-planner\/confirm/);
  assert.match(css, /\.workbench-week-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(7/);
  assert.match(css, /body\.theme-light\.workbench-page/);
});

test('manual and AI plans share one optional location/notes field without changing homework controls', () => {
  assert.match(html, /地点\/备注（选填）<\/span>[\s\S]{0,180}id="workbench-schedule-description"/);
  assert.doesNotMatch(html, /workbench-schedule-location|name="location"/);
  assert.match(controller, /notesInput\.className = 'workbench-proposal-description'/);
  assert.match(controller, /notesInput\.maxLength = 4000/);
  assert.match(
    controller,
    /description: card\.querySelector\('\.workbench-proposal-description'\)\.value\.trim\(\)/,
  );
  assert.match(controller, /notes\.textContent = entry\.item\.description/);
  assert.match(
    controller,
    /if \(item\.homeworkReference\)[\s\S]*?'toggle-homework-completion'[\s\S]*?else \{[\s\S]*?'edit-schedule'/,
  );
});

test('workbench separates plan and notifications while reusing the live publication inbox', () => {
  assert.match(html, /id="workbench-plan-panel"/);
  assert.match(html, /id="workbench-notifications-panel"[^>]*hidden/);
  assert.match(html, /id="workbench-notifications-tab"/);
  assert.match(html, /class="workbench-persistent-column"/);
  assert.doesNotMatch(html, /workbench-agent-shortcut/);
  assert.match(html, /data-notice-view="all"/);
  assert.match(html, /data-notice-view="recommended"/);
  assert.match(html, /data-notice-view="discussion"/);
  assert.match(controller, /app\.callApi\('\/notifications\?limit=50'/);
  assert.match(controller, /read-community-notification/);
  assert.match(controller, /state\.communityNotifications/);
  assert.match(controller, /window\.addEventListener\('popstate'/);
  assert.match(css, /\.workbench-view-panel\[hidden\]\s*\{\s*display:\s*none/);
});

test('display-hour preferences are uid-scoped, change only layout and keep complete list access', () => {
  assert.match(html, /workbench-hours\.js\?v=/);
  assert.match(html, /id="workbench-hours-start"/);
  assert.match(html, /id="workbench-hours-end"/);
  assert.match(html, /按账号保存在本浏览器/);
  assert.match(controller, /hoursModel\.saveHours\(hoursStorage\(\), getUser\(\)\.uid, hours\)/);
  assert.match(
    controller,
    /hoursModel\.readHours\(hoursStorage\(\), ownerKey \? getUser\(\)\.uid : null\)/,
  );
  assert.match(controller, /window\.addEventListener\('freebbs:session-change', syncSession\)/);
  assert.match(controller, /hoursModel\.layoutDay/);
  assert.doesNotMatch(controller, /state\.scheduleItems\.slice/);
  assert.match(controller, /结束时间必须严格晚于开始时间/);
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
