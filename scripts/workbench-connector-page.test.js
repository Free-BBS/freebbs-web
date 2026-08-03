const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'workbench.html'), 'utf8');
const appController = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const backendServer = fs.readFileSync(path.join(root, 'backend', 'server.js'), 'utf8');
const controller = fs.readFileSync(path.join(root, 'public', 'workbench-connectors.js'), 'utf8');
const workbenchController = fs.readFileSync(path.join(root, 'public', 'workbench.js'), 'utf8');
const stylesheet = fs.readFileSync(path.join(root, 'public', 'workbench-connectors.css'), 'utf8');
const fingerprintWrapper = fs.readFileSync(
  path.join(root, 'public', 'tsinghua-cas-fingerprint.js'),
  'utf8',
);

test('workbench exposes a distinct campus account status card', () => {
  assert.match(html, /id="workbench-campus-state"/);
  assert.match(html, /id="workbench-campus-connect"/);
  assert.match(html, /id="workbench-campus-sync"/);
  assert.match(html, /id="workbench-campus-disconnect"/);
  assert.match(html, /src="\/workbench-connectors\.js\?v=20260803-cas-fix-3"/);
  assert.match(html, /src="\/app\.js\?v=20260803-cas-fix-3"/);
  assert.match(html, /href="\/workbench-connectors\.css"/);
  const fingerprintVendorIndex = html.indexOf('src="/assets/vendor/fingerprint2-1.5.1.min.js"');
  const fingerprintWrapperIndex = html.indexOf('src="/tsinghua-cas-fingerprint.js"');
  const connectorControllerIndex = html.indexOf('src="/workbench-connectors.js');
  assert.ok(fingerprintVendorIndex >= 0);
  assert.ok(fingerprintVendorIndex < fingerprintWrapperIndex);
  assert.ok(fingerprintWrapperIndex < connectorControllerIndex);
  assert.match(stylesheet, /workbench-campus-card/);
  assert.match(stylesheet, /\.workbench-campus-card\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;/s);
  assert.match(
    stylesheet,
    /@media\s*\(max-width:\s*980px\)[\s\S]*?\.workbench-campus-card\s*\{[^}]*grid-template-columns:\s*1fr;/,
  );
});

test('campus account UI gates direct login on declared safeguards and never asks for cookies or targets', () => {
  assert.match(controller, /connectors\/tsinghua\/status/);
  assert.match(controller, /connectors\/tsinghua\/authorization-attempts/);
  assert.match(controller, /connectors\/tsinghua\/direct-login/);
  assert.match(controller, /connectors\/tsinghua\/sync-runs/);
  assert.match(controller, /connectors\/tsinghua\/connection/);
  assert.match(html, /id="workbench-campus-login-dialog"/);
  assert.match(html, /id="workbench-campus-login-password"[\s\S]*?type="password"/i);
  assert.match(html, /id="workbench-campus-login-consent"[\s\S]*?required/i);
  assert.match(html, /密码不会写入数据库、文件、日志或响应/u);
  assert.match(html, /会话 Cookie\s+使用独立密钥加密保存/u);
  assert.match(html, /页面不会读取或保存 Cookie/u);
  assert.match(html, /生成一次性兼容设备指纹，仅用于本次认证，不存储/u);
  assert.doesNotMatch(html, /name="(?:cookie|targetUrl|authorization)"/i);
  assert.doesNotMatch(controller, /document\.cookie/);
  assert.doesNotMatch(controller, /localStorage|sessionStorage/);
  assert.doesNotMatch(fingerprintWrapper, /localStorage|sessionStorage|indexedDB|document\.cookie/);
  assert.match(controller, /acceptsPasswordFromBrowser === true/);
  assert.match(controller, /acceptsCookieFromBrowser === false/);
  assert.match(controller, /storesPassword === false/);
  assert.match(controller, /sessionCookiesEncryptedAtRest === true/);
  assert.match(controller, /hasRequiredDirectCasSafeguards\(currentConnector\)/);
  assert.match(
    controller,
    /async function submitDirectLogin[\s\S]*?hasRequiredDirectCasSafeguards\(currentConnector\)/,
  );
  assert.match(controller, /!directCasSafeguardsReady/);
  const submitStart = controller.indexOf('async function submitDirectLogin');
  const submitEnd = controller.indexOf('\n  async function pollRun', submitStart);
  assert.ok(submitStart >= 0 && submitEnd > submitStart);
  const directLoginSubmission = controller.slice(submitStart, submitEnd);
  const consentGate = directLoginSubmission.indexOf('!elements.loginConsent?.checked');
  const fingerprintGeneration = directLoginSubmission.indexOf('fingerprintGenerator.generate()');
  const directLoginRequest = directLoginSubmission.indexOf(
    "app.callApi('/workbench/connectors/tsinghua/direct-login'",
  );
  assert.ok(
    consentGate >= 0 &&
      consentGate < fingerprintGeneration &&
      fingerprintGeneration < directLoginRequest,
    'fingerprint generation must happen only after consent and before credential submission',
  );
  assert.match(
    directLoginSubmission,
    /JSON\.stringify\(\{ username, password, fingerprint, consent: true \}\)/,
  );
  assert.match(directLoginSubmission, /\^\[0-9a-f\]\{32\}\$/);
  assert.match(directLoginSubmission, /catch\s*\{[\s\S]*?账号和密码未提交。[\s\S]*?return;/u);
  assert.match(directLoginSubmission, /finally\s*\{[\s\S]*?fingerprint = '';/);
  assert.doesNotMatch(
    directLoginSubmission,
    /(?:setDirectLoginStatus|setMessage)\(\s*fingerprint\b|(?:textContent|innerHTML)\s*=\s*fingerprint\b/,
  );
  assert.doesNotMatch(directLoginSubmission, /setDirectLoginStatus\(error\.message/);
  assert.match(controller, /function directLoginFailureMessage\(error\)/);
  assert.match(controller, /cas_credentials_rejected:/);
  assert.match(controller, /cas_identity_response_unrecognized:/);
  assert.match(
    directLoginSubmission,
    /setDirectLoginStatus\(directLoginFailureMessage\(error\), 'failed'\)/,
  );
  assert.match(controller, /诊断码：\$\{code\}/u);
  assert.match(controller, /error\?\.stage/);
  assert.match(controller, /阶段：\$\{stage\}/u);
  assert.match(
    controller,
    /const loginRequest = app\.callApi[\s\S]*?loginPassword\.value = ''[\s\S]*?await loginRequest;/,
  );
  assert.match(controller, /window\.isSecureContext/);
  assert.match(appController, /credentials:\s*['"]include['"]/);
  const connectorMount = backendServer.indexOf("'/api/workbench/connectors/tsinghua'");
  const jsonParserMount = backendServer.indexOf('app.use(express.json');
  assert.ok(connectorMount >= 0 && connectorMount < jsonParserMount);
});

test('UI labels connector modes and incomplete safeguards honestly', () => {
  assert.match(controller, /校方授权接入尚未配置/u);
  assert.match(controller, /开发模拟模式只用于验证状态机/u);
  assert.match(controller, /首次真实同步尚未完成/u);
  assert.match(html, /信息门户目前仅支持认证边界探测/u);
  assert.match(controller, /直接连接安全配置不完整/u);
  assert.match(controller, /正式授权模式不接收清华密码或浏览器 Cookie/u);
  assert.match(controller, /history\.replaceState/);
});

test('terminal sync refreshes workbench data and theme changes do not restart status', () => {
  assert.match(controller, /dispatchEvent\(new CustomEvent\('freebbs:workbench-refresh'\)\)/);
  assert.match(workbenchController, /addEventListener\('freebbs:workbench-refresh'/);
  assert.match(controller, /ownerKey === observedOwnerKey/);
  assert.match(
    stylesheet,
    /@media\s*\(max-width:\s*620px\)[\s\S]*?\.workbench-campus-heading\s*\{[^}]*grid-template-columns:\s*1fr;/,
  );
});

test('connector status helpers remain available at controller scope', () => {
  const setMessageStart = controller.indexOf('function setMessage');
  const setMessageAssignment = controller.indexOf('elements.message.textContent', setMessageStart);
  const syncFailureStart = controller.indexOf('function syncFailureMessage');
  const renderStatusStart = controller.indexOf('function renderStatus');

  assert.ok(setMessageStart >= 0);
  assert.ok(setMessageAssignment > setMessageStart);
  assert.ok(syncFailureStart > setMessageAssignment);
  assert.ok(renderStatusStart > syncFailureStart);
  assert.match(controller.slice(renderStatusStart), /syncFailureMessage\(run\.errorCode\)/);
  assert.match(
    controller.slice(renderStatusStart),
    /else if \(sync\.latestRun\)[\s\S]*?else \{\s*setMessage\(''\);\s*\}/,
  );
});
