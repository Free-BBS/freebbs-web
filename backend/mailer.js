const nodemailer = require('nodemailer');
const config = require('./config');

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
      pass: config.mail.pass,
    },
  });
}

async function sendVerificationCode(email, code) {
  const transporter = getTransporter();

  if (!transporter) {
    const missing = [];

    if (!config.mail.host) missing.push('BOTMAIL_SMTP');
    if (!config.mail.pass) missing.push('BOTMAIL_PASS');
    if (!config.mail.user) missing.push('BOTMAIL_USER');
    if (!config.mail.from) missing.push('BOTMAIL_FROM');

    throw new Error(`邮件服务未配置完整，缺少：${missing.join(', ')}`);
  }

  await transporter.sendMail({
    from: config.mail.from,
    to: email,
    subject: 'FREE-BBS 注册验证码',
    text: ['欢迎注册 FREE-BBS。', `你的邮箱验证码是：${code}`, '验证码 10 分钟内有效。'].join('\n'),
    html: renderVerificationEmail(code),
  });
}

function renderVerificationEmail(code) {
  const safeCode = String(code).replace(/[^0-9A-Za-z-]/g, '');
  return `<!doctype html><html><body style="margin:0;background:#edf2f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;color:#071317"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:36px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:auto"><tr><td style="padding:0 4px 20px;color:#075d68;font-size:13px;font-weight:700;letter-spacing:.12em">FREE-BBS · 邮箱验证</td></tr><tr><td style="padding:34px;border:1px solid #dce5e7;border-radius:20px;background:#f9fbfb"><h1 style="margin:0 0 12px;font-size:26px;line-height:1.3;letter-spacing:-.02em">验证你的邮箱</h1><p style="margin:0 0 24px;color:#506268;line-height:1.75">欢迎来到 FREE-BBS。请在注册页面输入下面的验证码：</p><div style="padding:22px;border:1px solid #c9dadc;border-radius:14px;background:#ffffff;color:#075d68;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:32px;font-weight:750;letter-spacing:.22em;text-align:center">${safeCode}</div><p style="margin:20px 0 0;color:#718388;font-size:13px;line-height:1.7">验证码 10 分钟内有效。如果不是你发起的操作，可以忽略这封邮件。</p></td></tr><tr><td style="padding:20px 4px;color:#7a8b90;font-size:12px;line-height:1.7">FREE-BBS · 电子系学生自主学习平台</td></tr></table></td></tr></table></body></html>`;
}

module.exports = {
  sendVerificationCode,
  renderVerificationEmail,
};
