import nodemailer from 'nodemailer';
import { HttpError } from '../../core/errors/http-error.js';
export interface ConnectorMessage {
  channel: 'email' | 'webhook';
  title: string;
  text: string;
  recipients: string[];
}
interface Mail {
  from: string;
  to: string[];
  subject: string;
  text: string;
}
interface Transports {
  sendMail?: (mail: Mail) => Promise<{ accepted?: unknown[]; rejected?: unknown[] }>;
  fetch?: typeof fetch;
}
export function connectorStatus(environment: NodeJS.ProcessEnv) {
  return [
    {
      id: 'email',
      label: '反馈邮件',
      configured: Boolean(
        environment.DEVELOPMENT_SMTP_HOST &&
        environment.DEVELOPMENT_SMTP_USER &&
        environment.DEVELOPMENT_SMTP_PASSWORD &&
        environment.DEVELOPMENT_MAIL_FROM &&
        environment.DEVELOPMENT_MAIL_RECIPIENTS,
      ),
      requirement: 'SMTP连接、发件人和允许的收件公邮',
    },
    {
      id: 'webhook',
      label: '通知机器人',
      configured: Boolean(environment.DEVELOPMENT_NOTIFICATION_WEBHOOK_URL),
      requirement: '服务器端通知Webhook地址',
    },
    {
      id: 'map',
      label: 'Free BBS Map经历接入',
      configured: Boolean(environment.DEVELOPMENT_MAP_INGEST_TOKEN),
      requirement: 'Map服务端接入令牌和用户标识映射',
    },
    {
      id: 'feed',
      label: '栏目文章更新',
      configured: Boolean(
        environment.DEVELOPMENT_ARTICLE_FEED_URL && environment.DEVELOPMENT_FEED_OWNER_UID,
      ),
      requirement: '授权文章供稿接口与发布账号；每天20:00更新',
    },
    {
      id: 'cloud',
      label: '云盘文件转存',
      configured: Boolean(environment.DEVELOPMENT_CLOUD_ADAPTER_URL),
      requirement: '已授权的云盘适配接口',
    },
    {
      id: 'publication',
      label: '推送转存',
      configured: Boolean(environment.DEVELOPMENT_PUBLICATION_ADAPTER_URL),
      requirement: '已授权的秀米／公众号适配接口',
    },
  ];
}
function configuredUrl(value: string | undefined) {
  if (!value) throw new HttpError(503, 'connector_not_configured', '连接尚未配置');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new HttpError(503, 'connector_invalid', '连接地址须使用HTTPS');
  return url;
}
/** Destination comes solely from server configuration, never from a submitted URL. */
export async function postAdapter(
  environment: NodeJS.ProcessEnv,
  key: string,
  payload: unknown,
  fetcher = fetch,
) {
  const url = configuredUrl(environment[key]);
  let response: Response;
  try {
    response = await fetcher(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(environment.DEVELOPMENT_ADAPTER_TOKEN
          ? { Authorization: `Bearer ${environment.DEVELOPMENT_ADAPTER_TOKEN}` }
          : {}),
      },
      body: JSON.stringify(payload),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new HttpError(502, 'connector_unavailable', '连接服务暂时不可用');
  }
  if (!response.ok) throw new HttpError(502, 'connector_rejected', '连接服务未接受请求');
  await response.body?.cancel();
}
export async function dispatchMessage(
  environment: NodeJS.ProcessEnv,
  message: ConnectorMessage,
  transports: Transports = {},
) {
  if (message.channel === 'webhook') {
    await postAdapter(
      environment,
      'DEVELOPMENT_NOTIFICATION_WEBHOOK_URL',
      { title: message.title, text: message.text, recipientUids: message.recipients },
      transports.fetch,
    );
    return;
  }
  if (!connectorStatus(environment).find((entry) => entry.id === 'email')?.configured)
    throw new HttpError(503, 'connector_not_configured', '邮件连接尚未配置');
  const allowed = new Set(
    environment
      .DEVELOPMENT_MAIL_RECIPIENTS!.split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  if (
    !message.recipients.length ||
    message.recipients.some((value) => !allowed.has(value.toLowerCase()))
  )
    throw new HttpError(400, 'recipient_not_allowed', '收件人不在服务器允许名单中');
  const smtp = nodemailer.createTransport({
    host: environment.DEVELOPMENT_SMTP_HOST,
    port: Number(environment.DEVELOPMENT_SMTP_PORT ?? 465),
    secure: (environment.DEVELOPMENT_SMTP_PORT ?? '465') === '465',
    requireTLS: true,
    auth: { user: environment.DEVELOPMENT_SMTP_USER, pass: environment.DEVELOPMENT_SMTP_PASSWORD },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  const transport = transports.sendMail ?? ((mail: Mail) => smtp.sendMail(mail));
  try {
    const result = await transport({
      from: environment.DEVELOPMENT_MAIL_FROM!,
      to: message.recipients,
      subject: message.title,
      text: message.text,
    });
    if (result.rejected?.length || !result.accepted?.length) throw new Error('Mail not accepted');
  } catch {
    throw new HttpError(502, 'mail_not_accepted', '邮件服务未接受全部收件人，请检查发送记录后再试');
  }
}
