const nodemailer = require("nodemailer");
const config = require("./config");

function getTransporter() {
  if (!config.mail.host || !config.mail.pass || !config.mail.user || !config.mail.from) {
    return null;
  }

  return nodemailer.createTransport({
    host: config.mail.host,
    port: config.mail.port,
    secure: config.mail.port === 465,
    auth: {
      user: config.mail.user,
      pass: config.mail.pass
    }
  });
}

async function sendVerificationCode(email, code) {
  const transporter = getTransporter();

  if (!transporter) {
    const missing = [];

    if (!config.mail.host) missing.push("BOTMAIL_SMTP");
    if (!config.mail.pass) missing.push("BOTMAIL_PASS");
    if (!config.mail.user) missing.push("BOTMAIL_USER");
    if (!config.mail.from) missing.push("BOTMAIL_FROM");

    throw new Error(`邮件服务未配置完整，缺少：${missing.join(", ")}`);
  }

  await transporter.sendMail({
    from: config.mail.from,
    to: email,
    subject: "FREE-BBS 注册验证码",
    text: [
      "欢迎注册 FREE-BBS。",
      `你的邮箱验证码是：${code}`,
      "验证码 10 分钟内有效。"
    ].join("\n"),
    html: `
      <div style="font-family:Arial,'Noto Sans SC',sans-serif;color:#41403C;">
        <h2 style="color:#AA210F;">FREE-BBS 注册验证码</h2>
        <p>欢迎注册 FREE-BBS。</p>
        <p>你的邮箱验证码是：</p>
        <p style="font-size:28px;font-weight:700;letter-spacing:0.2em;color:#AA210F;">${code}</p>
        <p>验证码 10 分钟内有效。</p>
      </div>
    `
  });
}

module.exports = {
  sendVerificationCode
};
