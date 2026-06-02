const mysql = require("mysql2/promise");
const config = require("./config");

const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  ...(config.db.socketPath ? { socketPath: config.db.socketPath } : {}),
  connectTimeout: Number(process.env.MYSQL_CONNECT_TIMEOUT || 10000),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

async function verifyDatabaseConnection(timeoutMs = Number(process.env.MYSQL_STARTUP_TIMEOUT || 5000)) {
  let timer;

  try {
    await Promise.race([
      pool.query("SELECT 1 AS ok"),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`MySQL connection timed out after ${timeoutMs}ms`)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

module.exports = pool;
module.exports.verifyDatabaseConnection = verifyDatabaseConnection;
