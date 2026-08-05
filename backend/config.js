const os = require('os');
const path = require('path');

function detectLocalIp() {
  const interfaces = os.networkInterfaces();

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        return entry.address;
      }
    }
  }

  return '127.0.0.1';
}

const localIp = detectLocalIp();

function readBooleanEnvironmentVariable(name, defaultValue = false) {
  const rawValue = process.env[name];

  if (rawValue === undefined) {
    return defaultValue;
  }

  return ['1', 'true', 'yes', 'on'].includes(rawValue.trim().toLowerCase());
}

module.exports = {
  apiHost: process.env.API_HOST || '127.0.0.1',
  apiPort: Number(process.env.API_PORT || 3001),
  publicWebUrl: process.env.PUBLIC_WEB_URL || 'http://127.0.0.1:3000',
  db: {
    host: process.env.BACKEND_IP || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'free_bbs',
    ...(process.env.MYSQL_SOCKET ? { socketPath: process.env.MYSQL_SOCKET } : {}),
  },
  authSecret: process.env.AUTH_SECRET || 'free-bbs-dev-secret',
  agentBaseUrl: process.env.AGENT_URL || 'http://127.0.0.1:5001',
  agentServiceToken: process.env.AGENT_SERVICE_TOKEN || '',
  agentSettingsRequired: readBooleanEnvironmentVariable('AGENT_SETTINGS_REQUIRED'),
  agentSettingsSocket:
    process.env.AGENT_SETTINGS_SOCKET || path.join(os.tmpdir(), 'free-bbs-agent-config.sock'),
  settingsEncryptionKey: process.env.SETTINGS_ENCRYPTION_KEY || '',
  llmBaseUrl: process.env.LLM_BASE_URL || 'https://cloud.infini-ai.com/maas/v1',
  llmModel: process.env.LLM_MODEL || 'glm-5.1',
  courseMaterialsRoot: process.env.COURSE_MATERIALS_ROOT || '',
  courseMaterialsAllowedRoot: process.env.COURSE_MATERIALS_ALLOWED_ROOT || '',
  sandboxBaseUrl: process.env.SANDBOX_URL || 'http://127.0.0.1:8000',
  sandboxOutputDir:
    process.env.SANDBOX_OUTPUT_DIR || path.join(__dirname, '..', '..', 'sandbox', 'outputs'),
  uploadDir: process.env.UPLOAD_DIR || path.join(__dirname, '..', 'database', 'uploads'),
  mail: {
    host: process.env.BOTMAIL_SMTP || '',
    port: Number(process.env.BOTMAIL_SMTP_PORT || 465),
    user: process.env.BOTMAIL_USER || process.env.BOTMAIL_FROM || '',
    pass: process.env.BOTMAIL_PASS || '',
    from: process.env.BOTMAIL_FROM || process.env.BOTMAIL_USER || '',
  },
};
