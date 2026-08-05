const { CampusConnectorError } = require('./errors');

const DIRECT_CAS_STAGES = Object.freeze([
  'input_validation',
  'learn_entry',
  'cas_form_fetch',
  'cas_form_parse',
  'credential_encrypt',
  'credential_submit',
  'session_verify',
  'grant_issue',
  'connection_store',
  'internal',
]);
const DIRECT_CAS_STAGE_SET = new Set(DIRECT_CAS_STAGES);

const DIRECT_CAS_ERRORS = Object.freeze({
  cas_configuration_invalid: Object.freeze({
    message: '清华认证客户端配置无效。',
    status: 500,
    stage: 'internal',
  }),
  cas_credentials_invalid: Object.freeze({
    message: '请输入有效的清华账号和密码。',
    status: 400,
    stage: 'input_validation',
  }),
  cas_credentials_rejected: Object.freeze({
    message: '清华账号或密码不正确。',
    status: 401,
    stage: 'credential_submit',
  }),
  cas_dependency_unavailable: Object.freeze({
    message: '清华认证加密组件暂时不可用。',
    status: 503,
    stage: 'credential_encrypt',
  }),
  cas_interactive_verification_required: Object.freeze({
    message: '本次登录需要在清华认证页面完成验证码或二次验证。',
    status: 409,
    stage: 'credential_submit',
  }),
  cas_login_unverified: Object.freeze({
    message: '清华认证会话未通过网络学堂验证。',
    status: 401,
    stage: 'session_verify',
  }),
  cas_network_error: Object.freeze({
    message: '暂时无法访问清华认证服务。',
    status: 502,
    stage: 'internal',
  }),
  cas_redirect_blocked: Object.freeze({
    message: '清华认证跳转被安全策略阻止。',
    status: 502,
    stage: 'internal',
  }),
  cas_redirect_limit: Object.freeze({
    message: '清华认证跳转次数异常。',
    status: 502,
    stage: 'internal',
  }),
  cas_response_too_large: Object.freeze({
    message: '清华认证响应超过安全上限。',
    status: 502,
    stage: 'internal',
  }),
  cas_schema_changed: Object.freeze({
    message: '清华认证页面结构已变化。',
    status: 502,
    stage: 'cas_form_parse',
  }),
  cas_target_blocked: Object.freeze({
    message: '清华认证目标不在固定白名单内。',
    status: 502,
    stage: 'internal',
  }),
  cas_timeout: Object.freeze({
    message: '访问清华认证服务超时。',
    status: 504,
    stage: 'internal',
  }),
  cas_upstream_rejected: Object.freeze({
    message: '清华认证服务未接受本次请求。',
    status: 502,
    stage: 'internal',
  }),
  cas_cookie_limit_exceeded: Object.freeze({
    message: '清华认证会话数据超过安全上限。',
    status: 502,
    stage: 'internal',
  }),
  cas_identity_response_unrecognized: Object.freeze({
    message: '清华认证返回了未识别的登录结果。',
    status: 502,
    stage: 'credential_submit',
  }),
  cas_response_invalid: Object.freeze({
    message: '清华认证返回了无效响应。',
    status: 502,
    stage: 'internal',
  }),
  cas_redirect_location_missing: Object.freeze({
    message: '清华认证跳转响应缺少目标。',
    status: 502,
    stage: 'internal',
  }),
  cas_encryption_failed: Object.freeze({
    message: '清华登录凭据加密未能完成。',
    status: 503,
    stage: 'credential_encrypt',
  }),
  cas_encryption_output_invalid: Object.freeze({
    message: '清华登录凭据加密结果无效。',
    status: 503,
    stage: 'credential_encrypt',
  }),
  cas_grant_too_large: Object.freeze({
    message: '网络学堂会话数据超过安全上限。',
    status: 502,
    stage: 'grant_issue',
  }),
  cas_internal_error: Object.freeze({
    message: '清华认证客户端内部错误。',
    status: 500,
    stage: 'internal',
  }),
});

function normalizeDirectCasStage(value, fallback = 'internal') {
  const stage = typeof value === 'string' ? value : '';
  if (DIRECT_CAS_STAGE_SET.has(stage)) return stage;
  return DIRECT_CAS_STAGE_SET.has(fallback) ? fallback : 'internal';
}

function readDirectCasStage(error) {
  const stage = typeof error?.stage === 'string' ? error.stage : '';
  return DIRECT_CAS_STAGE_SET.has(stage) ? stage : null;
}

function attachDirectCasStage(error, stage, fallback = 'internal') {
  if (!error || (typeof error !== 'object' && typeof error !== 'function')) return error;
  const safeStage = normalizeDirectCasStage(stage, fallback);
  Object.defineProperty(error, 'stage', {
    configurable: true,
    enumerable: false,
    value: safeStage,
    writable: false,
  });
  return error;
}

function isDirectCasErrorCode(value) {
  return typeof value === 'string' && Object.hasOwn(DIRECT_CAS_ERRORS, value);
}

function createDirectCasError(code, stage) {
  const safeCode = isDirectCasErrorCode(code) ? code : 'cas_internal_error';
  const definition = DIRECT_CAS_ERRORS[safeCode];
  const error = new CampusConnectorError(safeCode, definition.message, {
    status: definition.status,
  });
  return attachDirectCasStage(error, stage, definition.stage);
}

module.exports = {
  DIRECT_CAS_ERRORS,
  DIRECT_CAS_STAGES,
  attachDirectCasStage,
  createDirectCasError,
  isDirectCasErrorCode,
  normalizeDirectCasStage,
  readDirectCasStage,
};
