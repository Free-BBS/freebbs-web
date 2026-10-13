import { describe, expect, it, vi } from 'vitest';
import { dispatchMessage, connectorStatus } from './transport.js';
describe('configured connector transport', () => {
  it('does not report delivery when configuration is absent', async () => {
    const send = vi.fn();
    await expect(
      dispatchMessage(
        {},
        { channel: 'email', title: '反馈', text: '完成', recipients: ['report@example.org'] },
        { sendMail: send },
      ),
    ).rejects.toThrow(/未配置/);
    expect(send).not.toHaveBeenCalled();
    expect(connectorStatus({}).every((item) => !item.configured)).toBe(true);
  });
  it('uses server allowlisted email recipients and a mock transport', async () => {
    const sendMail = vi.fn().mockResolvedValue({ accepted: ['report@example.org'] });
    const env = {
      DEVELOPMENT_SMTP_HOST: 'smtp.example.org',
      DEVELOPMENT_SMTP_USER: 'account',
      DEVELOPMENT_SMTP_PASSWORD: 'secret',
      DEVELOPMENT_MAIL_FROM: 'sender@example.org',
      DEVELOPMENT_MAIL_RECIPIENTS: 'report@example.org',
    };
    await expect(
      dispatchMessage(
        env,
        { channel: 'email', title: '反馈', text: '完成', recipients: ['outsider@example.org'] },
        { sendMail },
      ),
    ).rejects.toThrow(/允许/);
    await dispatchMessage(
      env,
      { channel: 'email', title: '反馈', text: '完成', recipients: ['report@example.org'] },
      { sendMail },
    );
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: ['report@example.org'], subject: '反馈', text: '完成' }),
    );
  });
});
