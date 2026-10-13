import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../core/auth/AuthProvider.js';
import { isBusinessAdmin } from '../../core/permissions/Can.js';
import '../../styles/collaboration.css';
interface Status {
  id: string;
  label: string;
  configured: boolean;
  requirement: string;
}
interface Job {
  id: string;
  title: string;
  text: string;
  channel: 'email' | 'webhook';
  recipients: string[];
  status: 'draft' | 'sending' | 'sent' | 'failed';
  revision: number;
  error: string;
}
export function DevelopmentSettingsPage() {
  const { client, user } = useAuth();
  const [status, setStatus] = useState<Status[]>();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [channel, setChannel] = useState('email');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [recipients, setRecipients] = useState('');
  const [reviewing, setReviewing] = useState<Job>();
  const [transfer, setTransfer] = useState({
    kind: 'cloud',
    title: '',
    sourceUrl: '',
    destination: '',
    note: '',
  });
  const [notice, setNotice] = useState('');
  async function reload() {
    try {
      const [next, history] = await Promise.all([
        client.request<Status[]>('/connectors/status'),
        client.request<Job[]>('/connectors/jobs'),
      ]);
      setStatus(next);
      setJobs(history);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法读取连接设置');
    }
  }
  useEffect(() => {
    void reload();
  }, [client]);
  async function draft(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await client.request('/connectors/jobs', {
        method: 'POST',
        body: JSON.stringify({
          channel,
          title,
          text,
          recipients: recipients
            .split(/[,，\n]/)
            .map((value) => value.trim())
            .filter(Boolean),
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      setTitle('');
      setText('');
      setNotice('已保存为通知草稿，尚未发送。');
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }
  async function send() {
    if (!reviewing) return;
    setBusy(true);
    setError('');
    try {
      await client.request(`/connectors/jobs/${reviewing.id}/send`, {
        method: 'POST',
        body: JSON.stringify({ revision: reviewing.revision }),
        headers: { 'Content-Type': 'application/json' },
      });
      setNotice('连接服务已接受通知；实际送达以接收平台为准。');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '发送失败');
    } finally {
      setReviewing(undefined);
      await reload();
      setBusy(false);
    }
  }
  async function submitTransfer(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { kind, ...data } = transfer;
      await client.request(`/connectors/transfer/${kind}`, {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
      });
      setNotice('转存服务已接受请求，请在目标平台确认结果。');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '转存失败');
    } finally {
      setBusy(false);
    }
  }
  async function syncFeed() {
    setBusy(true);
    setError('');
    try {
      const result = await client.request<{ imported: number }>('/connectors/feed/sync', {
        method: 'POST',
      });
      setNotice(`本次更新 ${result.imported} 篇文章，已放入内容橱窗。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '更新失败');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="collaboration-page">
      <header className="collaboration-heading">
        <div>
          <Link to="/settings">← 设置</Link>
          <h1>发展端设置</h1>
          <p>管理外部连接与消息发送。</p>
          {user && isBusinessAdmin(user) && !user.previewing ? (
            <Link to="/system-settings">管理社工身份</Link>
          ) : null}
        </div>
      </header>
      {error && (
        <p role="alert" className="collaboration-alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!status && !error && <p>正在读取设置…</p>}
      <section className="collaboration-card-grid" aria-label="外部连接">
        {status?.map((item) => (
          <article className="collaboration-card" key={item.id}>
            <span>{item.configured ? '已配置' : '待接入'}</span>
            <h2>{item.label}</h2>
            <p>{item.requirement}</p>
            <small>
              {item.configured
                ? '已具备连接配置，实际联调结果请查看对应平台。'
                : '请由维护人员配置连接信息；密钥保存在服务器，页面不会显示。'}
            </small>
            {item.id === 'feed' && (
              <button
                type="button"
                disabled={busy || !item.configured}
                onClick={() => void syncFeed()}
              >
                立即更新栏目
              </button>
            )}
          </article>
        ))}
      </section>
      {status && (
        <>
          <form onSubmit={(e) => void draft(e)} className="collaboration-editor">
            <h2>准备通知</h2>
            <p>先保存草稿、核对内容与对象，再确认发送。邮件只支持已配置的收件公邮。</p>
            <div className="collaboration-form-grid">
              <label>
                发送方式
                <select value={channel} onChange={(e) => setChannel(e.target.value)}>
                  <option value="email">反馈邮件</option>
                  <option value="webhook">通知机器人</option>
                </select>
              </label>
              <label>
                标题
                <input
                  required
                  maxLength={160}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label className="wide">
                接收对象
                <input
                  required
                  value={recipients}
                  onChange={(e) => setRecipients(e.target.value)}
                  placeholder={
                    channel === 'email'
                      ? '公邮地址，多个地址用逗号分隔'
                      : '用户标识，多个标识用逗号分隔'
                  }
                />
              </label>
              <label className="wide">
                正文
                <textarea
                  required
                  maxLength={10000}
                  rows={5}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              </label>
            </div>
            <button type="submit" disabled={busy}>
              保存通知草稿
            </button>
          </form>
          <section className="collaboration-records">
            <h2>通知记录</h2>
            {jobs.map((job) => (
              <article key={job.id} className="collaboration-card">
                <h3>{job.title}</h3>
                <p>{job.recipients.join('、')}</p>
                <span>
                  {job.status === 'draft'
                    ? '草稿'
                    : job.status === 'sending'
                      ? '发送处理中'
                      : job.status === 'sent'
                        ? '服务已接受'
                        : '发送失败'}
                </span>
                {job.error && <p>{job.error}</p>}
                {job.status === 'draft' && (
                  <button
                    type="button"
                    disabled={busy || !status.find((item) => item.id === job.channel)?.configured}
                    onClick={() => setReviewing(job)}
                  >
                    核对并发送
                  </button>
                )}
              </article>
            ))}
            {!jobs.length && <p>还没有通知记录。</p>}
          </section>
          {reviewing && (
            <section className="collaboration-editor" aria-label="核对通知">
              <h2>确认发送这条通知</h2>
              <h3>{reviewing.title}</h3>
              <p>{reviewing.recipients.join('、')}</p>
              <p style={{ whiteSpace: 'pre-wrap' }}>{reviewing.text}</p>
              <button
                className="collaboration-primary"
                disabled={busy}
                type="button"
                onClick={() => void send()}
              >
                确认发送
              </button>
              <button type="button" disabled={busy} onClick={() => setReviewing(undefined)}>
                返回草稿
              </button>
            </section>
          )}
          <form className="collaboration-editor" onSubmit={(e) => void submitTransfer(e)}>
            <h2>素材转存</h2>
            <p>将已完成审核的公开素材链接转存到授权的目标账号；未接入时会明确提示。</p>
            <div className="collaboration-form-grid">
              <label>
                目标
                <select
                  value={transfer.kind}
                  onChange={(e) => setTransfer({ ...transfer, kind: e.target.value })}
                >
                  <option value="cloud">云盘</option>
                  <option value="publication">秀米／公众号</option>
                </select>
              </label>
              <label>
                素材标题
                <input
                  required
                  value={transfer.title}
                  onChange={(e) => setTransfer({ ...transfer, title: e.target.value })}
                />
              </label>
              <label>
                素材HTTPS链接
                <input
                  required
                  type="url"
                  value={transfer.sourceUrl}
                  onChange={(e) => setTransfer({ ...transfer, sourceUrl: e.target.value })}
                />
              </label>
              <label>
                目标位置
                <input
                  required
                  value={transfer.destination}
                  onChange={(e) => setTransfer({ ...transfer, destination: e.target.value })}
                  placeholder="由平台维护人员提供"
                />
              </label>
            </div>
            <button
              type="submit"
              disabled={busy || !status.find((item) => item.id === transfer.kind)?.configured}
            >
              提交转存
            </button>
          </form>
        </>
      )}
    </main>
  );
}
