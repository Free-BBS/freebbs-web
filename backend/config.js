const os = require("os");
const path = require("path");

function detectLocalIp() {
  const interfaces = os.networkInterfaces();

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) {
        return entry.address;
      }
    }
  }

  return "127.0.0.1";
}

const localIp = detectLocalIp();

module.exports = {
  apiHost: process.env.API_HOST || "127.0.0.1",
  apiPort: Number(process.env.API_PORT || 3001),
  db: {
    host: process.env.BACKEND_IP || localIp,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || "root",
    password: process.env.MYSQL_PASSWORD || "",
    database: process.env.MYSQL_DATABASE || "free_bbs"
  },
  authSecret: process.env.AUTH_SECRET || "free-bbs-dev-secret",
  agentBaseUrl: process.env.AGENT_URL || "http://127.0.0.1:5001",
  uploadDir: process.env.UPLOAD_DIR || path.join(__dirname, "..", "database", "uploads"),
  mail: {
    host: process.env.BOTMAIL_SMTP || "",
    port: Number(process.env.BOTMAIL_SMTP_PORT || 465),
    user: process.env.BOTMAIL_USER || process.env.BOTMAIL_FROM || "",
    pass: process.env.BOTMAIL_PASS || "",
    from: process.env.BOTMAIL_FROM || process.env.BOTMAIL_USER || ""
  }
};
