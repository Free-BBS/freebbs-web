import type {
  DevelopmentNotificationResult,
  DevelopmentRewardResult,
  SystemSettingsBootstrap,
  SystemSettingsNotificationHistory,
  SystemSettingsRewardHistory,
  SystemSettingsUser,
} from '@freebbs-development/contracts';
import { useRef, useState } from 'react';
import { ConfirmDialog } from '../../components/ConfirmDialog.js';
import type { ApiClient } from '../../core/api/client.js';

export function BatchSettings({
  kind,
  client,
  initial,
}: {
  kind: 'notification' | 'reward';
  client: Pick<ApiClient, 'request'>;
  initial: SystemSettingsBootstrap;
}) {
  const reward = kind === 'reward';
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [electric, setElectric] = useState('0');
  const [magnetic, setMagnetic] = useState('0');
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState(initial.users);
  const [selected, setSelected] = useState<SystemSettingsUser[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState<
    Array<SystemSettingsNotificationHistory | SystemSettingsRewardHistory>
  >(reward ? initial.rewards : initial.notifications);
  const requestId = useRef<string | null>(null);
  const submitting = useRef(false);
  async function search() {
    setSearching(true);
    setError('');
    try {
      setUsers(
        await client.request<SystemSettingsUser[]>(
          `/system-settings/users${query.trim() ? `?query=${encodeURIComponent(query.trim())}` : ''}`,
        ),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '收件人加载失败');
    } finally {
      setSearching(false);
    }
  }
  function preview() {
    if (submitting.current || searching) return;
    setError('');
    setMessage('');
    if (!title.trim() || !body.trim()) {
      setError(reward ? '请填写奖励标题和原因。' : '请填写通知标题和正文。');
      return;
    }
    if (!selected.length || selected.length > 100) {
      setError('请选择 1 至 100 位同学。');
      return;
    }
    if (
      reward &&
      (![electric, magnetic].every((value) => /^\d+$/.test(value) && Number(value) <= 1_000_000) ||
        Number(electric) + Number(magnetic) <= 0)
    ) {
      setError('电元和磁元须为 0 至 1000000 的整数，至少一项大于 0。');
      return;
    }
    setConfirming(true);
  }
  async function submit() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setLocked(true);
    setConfirming(false);
    setError('');
    requestId.current ??= crypto.randomUUID();
    const endpoint = reward ? '/system-settings/rewards' : '/system-settings/notifications';
    try {
      const payload = {
        requestId: requestId.current,
        title: title.trim(),
        recipientUids: selected.map(({ uid }) => uid),
        ...(reward
          ? { reason: body.trim(), electric: Number(electric), magnetic: Number(magnetic) }
          : { body: body.trim() }),
      };
      if (reward) {
        const result = await client.request<DevelopmentRewardResult>(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        setMessage(
          `${initial.rewardMode === 'demo' ? '演示奖励已记录' : '奖励已发放'}：${result.recipientCount} 位同学，合计 ${result.totalElectric} 电元 / ${result.totalMagnetic} 磁元；批次 ${result.batchId}${result.replayed ? '（已处理的批次，未重复发放）' : ''}`,
        );
      } else {
        const result = await client.request<DevelopmentNotificationResult>(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        setMessage(
          `已发送给 ${result.recipientCount} 位同学${result.replayed ? '（已处理的通知，未重复发送）' : ''}`,
        );
      }
      requestId.current = null;
      setTitle('');
      setBody('');
      setSelected([]);
      setLocked(false);
      window.dispatchEvent(new Event('freebbs-development-notifications-changed'));
      try {
        setHistory(
          await client.request<
            Array<SystemSettingsNotificationHistory | SystemSettingsRewardHistory>
          >(endpoint),
        );
      } catch {
        setError('提交已成功，历史记录刷新失败，请稍后重新进入页面查看。');
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '提交失败，请按原内容重试。');
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      className="settings-section settings-batch-section"
      aria-label={reward ? '奖励设置' : '通知设置'}
    >
      <header>
        <h3>{reward ? '批量奖励' : '发送发展端通知'}</h3>
        <p>
          {reward
            ? '核对收件人和每人金额，确认后提交奖励。'
            : '选择收件人，预览后发送到发展端通知收件箱。'}
        </p>
      </header>
      {reward ? (
        <p className="settings-provider-note">
          {initial.rewardMode === 'demo'
            ? '演示奖励：仅用于本地预览，不会修改真实钱包。'
            : initial.rewardMode === 'unavailable'
              ? '奖励服务暂不可用，提交时会返回失败，请保留草稿后重试。'
              : '奖励计入主站共用电元、磁元钱包。'}
        </p>
      ) : null}
      {message ? (
        <p className="development-settings-message" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="development-settings-message is-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="settings-compose-layout">
        <div className="settings-card">
          <fieldset className="settings-edit-fields" disabled={busy || locked}>
            <label>
              {reward ? '奖励标题' : '通知标题'}
              <input
                maxLength={80}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label>
              {reward ? '奖励原因' : '通知正文'}
              <textarea
                rows={6}
                maxLength={reward ? 1000 : 4000}
                value={body}
                onChange={(event) => setBody(event.target.value)}
              />
            </label>
            {reward ? (
              <div className="settings-currency-grid">
                <label>
                  每人电元
                  <input
                    type="number"
                    min={0}
                    max={1000000}
                    step={1}
                    value={electric}
                    onChange={(event) => setElectric(event.target.value)}
                  />
                </label>
                <label>
                  每人磁元
                  <input
                    type="number"
                    min={0}
                    max={1000000}
                    step={1}
                    value={magnetic}
                    onChange={(event) => setMagnetic(event.target.value)}
                  />
                </label>
              </div>
            ) : null}
          </fieldset>
        </div>
        <div className="settings-card settings-recipient-card">
          <h4>收件人</h4>
          <fieldset className="settings-edit-fields" disabled={busy || locked}>
            <div className="settings-recipient-search">
              <label>
                <span className="sr-only">搜索收件人</span>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="用户名、学号或 UID"
                />
              </label>
              <button type="button" disabled={searching} onClick={() => void search()}>
                查找
              </button>
            </div>
            <p>已选择 {selected.length} / 100 位同学</p>
            <div className="settings-recipient-list">
              {users.map((user) => (
                <label key={user.uid}>
                  <input
                    type="checkbox"
                    checked={selected.some(({ uid }) => uid === user.uid)}
                    disabled={
                      (user.canReceiveNotifications === false || selected.length >= 100) &&
                      !selected.some(({ uid }) => uid === user.uid)
                    }
                    onChange={(event) =>
                      setSelected((current) =>
                        event.target.checked
                          ? [...current, user]
                          : current.filter(({ uid }) => uid !== user.uid),
                      )
                    }
                  />
                  <span>
                    <strong>{user.username}</strong>
                    <small>
                      {user.displayName} · {user.studentId ?? '无学号'}
                    </small>
                    {user.canReceiveNotifications === false ? <small>未开放发展端</small> : null}
                  </span>
                </label>
              ))}
              {searching ? (
                <p role="status">正在查找…</p>
              ) : !users.length ? (
                <p>未找到同学。</p>
              ) : null}
            </div>
            {selected.length ? (
              <div className="settings-selected-recipients" aria-label="已选收件人">
                {selected.map((user) => (
                  <button
                    type="button"
                    className="secondary-button"
                    key={user.uid}
                    aria-label={`移除 ${user.username}`}
                    onClick={() =>
                      setSelected((current) => current.filter(({ uid }) => uid !== user.uid))
                    }
                  >
                    {user.displayName} ×
                  </button>
                ))}
              </div>
            ) : null}
          </fieldset>
        </div>
      </div>
      {locked && !busy ? (
        <p className="settings-provider-note">
          保留了原提交内容和请求编号，再次确认即可重试。新建一批后可重新编辑。
        </p>
      ) : null}
      <div className="settings-actions">
        {locked && !busy ? (
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              requestId.current = null;
              setLocked(false);
              setError('');
            }}
          >
            新建一批
          </button>
        ) : null}
        <button type="button" disabled={busy || searching} onClick={preview}>
          {busy ? '提交中…' : reward ? '核对奖励' : '预览通知'}
        </button>
      </div>
      <ConfirmDialog
        open={confirming}
        title={reward ? '确认发放奖励' : '确认发送通知'}
        confirmLabel={reward ? '确认发放' : '确认发送'}
        onClose={() => setConfirming(false)}
        onConfirm={() => void submit()}
      >
        <p>
          <strong>{title}</strong>
        </p>
        <p className="settings-preview-body">{body}</p>
        <p>
          {selected.length} 位同学：{selected.map(({ username }) => username).join('、')}
        </p>
        {reward ? (
          <>
            <p>
              每人 {Number(electric)} 电元 / {Number(magnetic)} 磁元
            </p>
            <p>
              合计 {Number(electric) * selected.length} 电元 / {Number(magnetic) * selected.length}{' '}
              磁元
            </p>
            {initial.rewardMode === 'demo' ? <p>本次为演示奖励，不计入真实钱包。</p> : null}
          </>
        ) : null}
      </ConfirmDialog>
      <section className="settings-history">
        <h3>{reward ? '奖励历史' : '已发送通知'}</h3>
        {!history.length ? (
          <p>暂无记录。</p>
        ) : (
          <ol>
            {history.map((record) => (
              <li key={record.id}>
                <strong>{record.title}</strong>
                <p>{'reason' in record ? record.reason : record.body}</p>
                <small>
                  {record.recipientCount} 位同学 ·{' '}
                  {'totalElectric' in record
                    ? `合计 ${record.totalElectric} 电元 / ${record.totalMagnetic} 磁元 · `
                    : ''}
                  {new Date(record.createdAt).toLocaleString('zh-CN')}
                </small>
                <details>
                  <summary>查看收件人</summary>
                  <p>
                    {record.recipients
                      .map((person) => `${person.username}（${person.studentId ?? person.uid}）`)
                      .join('、')}
                  </p>
                </details>
              </li>
            ))}
          </ol>
        )}
      </section>
    </section>
  );
}
