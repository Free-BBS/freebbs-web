import { useEffect, useId, useRef, useState } from 'react';
import { AUTH_TOKEN_STORAGE_KEY } from '../../core/api/client.js';
import { formatCollectionDate } from './collection-utils.js';

interface SurveyQuestion {
  id: string;
  label: string;
  type: 'text' | 'textarea' | 'single' | 'multiple';
  required: boolean;
  options: string[];
}
interface Survey {
  title: string;
  description?: string;
  questions: SurveyQuestion[];
  opensAt: string;
  closesAt: string;
  status?: string;
  requiresLogin?: boolean;
}
interface SurveyResult {
  result: 'pending' | 'won' | 'lost' | 'cancelled';
  drawnAt?: string;
}
export interface LearningSurveyRegistrationProps {
  surveyId: string;
  fetcher?: typeof fetch;
}
const RECEIPTS_KEY = 'freebbs_activity_receipts_v2';
const RECEIPT_PATTERN = /^[a-f0-9]{64}$/;
const resultLabels = {
  pending: '报名已收到，尚未抽签，请在截止后再来查询。',
  won: '恭喜，你已中签！请留意管理员后续联系。',
  lost: '本期未中签，感谢参与，欢迎报名下一期。',
  cancelled: '本期报名已取消。',
};
function authToken() {
  try {
    return localStorage.getItem(AUTH_TOKEN_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}
function clearStoredReceipts() {
  try {
    sessionStorage.removeItem(RECEIPTS_KEY);
  } catch {
    /* Private memory still clears. */
  }
}
async function receiptOwner(token: string): Promise<string | null> {
  if (!token) return 'anonymous';
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
      '',
    );
  } catch {
    return null;
  }
}
function storedReceipts(owner: string | null): Record<string, string> {
  try {
    const stored = JSON.parse(sessionStorage.getItem(RECEIPTS_KEY) || 'null');
    if (
      owner &&
      stored?.owner === owner &&
      stored.receipts &&
      typeof stored.receipts === 'object' &&
      !Array.isArray(stored.receipts)
    )
      return Object.fromEntries(
        Object.entries(stored.receipts).filter(
          (entry): entry is [string, string] =>
            typeof entry[1] === 'string' && RECEIPT_PATTERN.test(entry[1]),
        ),
      );
    clearStoredReceipts();
  } catch {
    clearStoredReceipts();
  }
  return {};
}

export function LearningSurveyRegistration(props: LearningSurveyRegistrationProps) {
  const [token, setToken] = useState(authToken);
  const [identityVersion, setIdentityVersion] = useState(0);
  useEffect(() => {
    function changed() {
      const next = authToken();
      if (next === token) return;
      clearStoredReceipts();
      setToken(next);
      setIdentityVersion((version) => version + 1);
    }
    function storageChanged(event: StorageEvent) {
      if (event.key === AUTH_TOKEN_STORAGE_KEY || event.key === null) changed();
    }
    window.addEventListener('freebbs:session-change', changed);
    window.addEventListener('storage', storageChanged);
    window.addEventListener('focus', changed);
    return () => {
      window.removeEventListener('freebbs:session-change', changed);
      window.removeEventListener('storage', storageChanged);
      window.removeEventListener('focus', changed);
    };
  }, [token]);
  return (
    <SurveyRegistrationView
      key={`${props.surveyId}:${identityVersion}:${token}`}
      {...props}
      token={token}
    />
  );
}

function SurveyRegistrationView({
  surveyId,
  fetcher = globalThis.fetch,
  token,
}: LearningSurveyRegistrationProps & { token: string }) {
  const prefix = useId();
  const [survey, setSurvey] = useState<Survey | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const [contact, setContact] = useState('');
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [receipt, setReceipt] = useState('');
  const [lookupReceipt, setLookupReceipt] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState<SurveyResult | null>(null);
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const pendingReceipt = useRef('');
  const owner = useRef<string | null>(null);
  const active = useRef(true);
  const submitting = useRef(false);
  const [clock, setClock] = useState(Date.now());
  const current = () => active.current && authToken() === token;
  const base = `/api/surveys/${encodeURIComponent(surveyId)}`;

  async function request<T>(suffix = '', body?: unknown): Promise<T> {
    const headers = new Headers({ Accept: 'application/json' });
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    const response = await fetcher(`${base}${suffix}`, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'include',
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error('服务返回了无法读取的内容，请稍后重试。');
    }
    if (!response.ok)
      throw new Error(
        typeof payload.error === 'string'
          ? payload.error
          : typeof payload.message === 'string'
            ? payload.message
            : payload.error?.message || '请求失败，请稍后重试。',
      );
    return payload as T;
  }

  useEffect(() => {
    active.current = true;
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    void (async () => {
      try {
        const [data, fingerprint] = await Promise.all([
          request<{ survey: Survey }>(),
          receiptOwner(token),
        ]);
        if (cancelled || !current()) return;
        if (
          !data.survey ||
          !Array.isArray(data.survey.questions) ||
          data.survey.questions.some(
            (question) => !['text', 'textarea', 'single', 'multiple'].includes(question.type),
          )
        )
          throw new Error('报名表格式已变更，请联系活动负责人。');
        owner.current = fingerprint;
        const saved = storedReceipts(fingerprint)[surveyId] || '';
        pendingReceipt.current = saved;
        setReceipt(saved);
        setLookupReceipt(saved);
        setSurvey(data.survey);
        setLoading(false);
        if (saved) {
          try {
            const savedResult = await request<SurveyResult>('/result', { receipt: saved });
            if (!savedResult || !Object.hasOwn(resultLabels, savedResult.result))
              throw new Error('查询结果暂时无法读取，请重试。');
            if (!cancelled && current()) {
              setSubmitted(true);
              setResult(savedResult);
            }
          } catch {
            /* A receipt saved before a lost request must remain retryable. */
          }
        }
      } catch (error) {
        if (!cancelled && current()) {
          setLoadError(error instanceof Error ? error.message : '报名表暂时无法加载。');
          setLoading(false);
        }
      }
    })();
    const timer = window.setInterval(() => setClock(Date.now()), 30000);
    return () => {
      cancelled = true;
      active.current = false;
      window.clearInterval(timer);
    };
    // Each load uses this survey and browser identity; drafts survive explicit load retries.
  }, [surveyId, fetcher, token, reload]);

  const closed =
    !!survey &&
    (['closed', 'archived', 'ended', 'drawn', 'cancelled'].includes(survey.status || '') ||
      new Date(survey.closesAt).getTime() <= clock);
  const upcoming = !!survey && !closed && new Date(survey.opensAt).getTime() > clock;
  const requiresLogin = !!survey?.requiresLogin && !token;

  async function submit() {
    if (
      !survey ||
      closed ||
      upcoming ||
      submitted ||
      requiresLogin ||
      submitting.current ||
      !current()
    )
      return;
    setFeedback('');
    if (
      !contact.trim() ||
      contact.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.trim())
    ) {
      setFeedback('请填写有效的联系邮箱。');
      return;
    }
    const values: Record<string, string | string[]> = {};
    for (const question of survey.questions) {
      const value = answers[question.id] ?? (question.type === 'multiple' ? [] : '');
      if (question.required && (Array.isArray(value) ? !value.length : !value.trim())) {
        setFeedback(`请填写：${question.label}`);
        return;
      }
      values[question.id] = value;
    }
    submitting.current = true;
    setBusy(true);
    try {
      const secret =
        pendingReceipt.current ||
        Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
          byte.toString(16).padStart(2, '0'),
        ).join('');
      pendingReceipt.current = secret;
      if (owner.current) {
        try {
          sessionStorage.setItem(
            RECEIPTS_KEY,
            JSON.stringify({
              owner: owner.current,
              receipts: { ...storedReceipts(owner.current), [surveyId]: secret },
            }),
          );
        } catch {
          /* Keep the same secret in memory across retries when storage is blocked. */
        }
      }
      setReceipt(secret);
      setLookupReceipt(secret);
      await request('/entries', { contact: contact.trim(), answers: values, receipt: secret });
      if (current()) {
        setSubmitted(true);
        setResult({ result: 'pending' });
        setContact('');
        setAnswers({});
      }
    } catch (error) {
      if (current())
        setFeedback(
          `${error instanceof Error ? error.message : '提交失败。'} 你的填写内容已保留，可重试。`,
        );
    } finally {
      submitting.current = false;
      if (current()) setBusy(false);
    }
  }
  async function lookup() {
    if (submitting.current || !current()) return;
    const secret = lookupReceipt.trim();
    if (!RECEIPT_PATTERN.test(secret)) {
      setFeedback('请填写 64 位小写字母与数字组成的报名回执。');
      return;
    }
    setBusy(true);
    setFeedback('');
    submitting.current = true;
    try {
      const data = await request<SurveyResult>('/result', { receipt: secret });
      if (current()) {
        if (!data || !Object.hasOwn(resultLabels, data.result))
          throw new Error('查询结果暂时无法读取，请重试。');
        setResult(data);
      }
    } catch (error) {
      if (current()) setFeedback(error instanceof Error ? error.message : '查询失败，请重试。');
    } finally {
      submitting.current = false;
      if (current()) setBusy(false);
    }
  }
  function downloadReceipt() {
    if (!current()) return;
    const url = URL.createObjectURL(
      new Blob([`活动：${survey?.title || surveyId}\n回执：${receipt}\n请勿向他人分享回执。`], {
        type: 'text/plain;charset=utf-8',
      }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'FREE-BBS-报名回执.txt';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function copyReceipt() {
    if (!current()) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(receipt);
      if (current()) setFeedback('回执已复制。');
    } catch {
      if (current()) setFeedback('复制失败，请手动复制或下载回执。');
    }
  }

  return (
    <section className="learning-registration" aria-label="学习端活动报名">
      {loading ? <p role="status">正在读取报名表…</p> : null}
      {loadError ? (
        <div role="alert">
          <p>{loadError}</p>
          <button type="button" onClick={() => setReload((value) => value + 1)}>
            重新加载报名表
          </button>
        </div>
      ) : null}
      {survey && !loading ? (
        <>
          <div className="learning-registration-heading">
            <span>{survey.requiresLogin ? '登录后报名' : '免登录报名'}</span>
            <h3>{survey.title}</h3>
            <p>{survey.description}</p>
            <small>
              开放 {formatCollectionDate(survey.opensAt)} · 截止{' '}
              {formatCollectionDate(survey.closesAt)}
            </small>
          </div>
          {submitted ? (
            <h4>报名成功，感谢参与！</h4>
          ) : closed ? (
            <p className="learning-registration-state">报名已截止</p>
          ) : upcoming ? (
            <p className="learning-registration-state">报名尚未开放</p>
          ) : requiresLogin ? (
            <div className="learning-registration-state">
              <p>本活动需要登录后报名</p>
              <a
                href={`/login?next=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`}
              >
                登录后继续报名 →
              </a>
            </div>
          ) : (
            <form
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <p className="learning-registration-privacy">
                联系邮箱和回答仅活动管理员可见。每期每个邮箱限报一次，带 * 的题目为必填。
              </p>
              <fieldset disabled={busy} className="learning-registration-fields">
                <label className="learning-registration-field" htmlFor={`${prefix}-contact`}>
                  <span>联系邮箱 *</span>
                  <input
                    id={`${prefix}-contact`}
                    type="email"
                    autoComplete="email"
                    maxLength={254}
                    required
                    value={contact}
                    onChange={(event) => setContact(event.target.value)}
                  />
                </label>
                {survey.questions.map((question) => (
                  <fieldset key={question.id} className="learning-registration-question">
                    <legend>
                      {question.label} {question.required ? '*' : '（选填）'}
                    </legend>
                    {question.type === 'single' || question.type === 'multiple' ? (
                      <div className="learning-registration-choices">
                        {question.options.map((option) => (
                          <label key={option}>
                            <input
                              type={question.type === 'single' ? 'radio' : 'checkbox'}
                              name={`${prefix}-${question.id}`}
                              checked={
                                question.type === 'single'
                                  ? answers[question.id] === option
                                  : Array.isArray(answers[question.id]) &&
                                    answers[question.id].includes(option)
                              }
                              required={question.type === 'single' && question.required}
                              onChange={(event) =>
                                setAnswers((previous) => {
                                  const selected = Array.isArray(previous[question.id])
                                    ? (previous[question.id] as string[])
                                    : [];
                                  return {
                                    ...previous,
                                    [question.id]:
                                      question.type === 'single'
                                        ? option
                                        : event.target.checked
                                          ? [...selected, option]
                                          : selected.filter((value) => value !== option),
                                  };
                                })
                              }
                            />
                            <span>{option}</span>
                          </label>
                        ))}
                        {question.type === 'single' && !question.required ? (
                          <button
                            type="button"
                            onClick={() =>
                              setAnswers((previous) => ({ ...previous, [question.id]: '' }))
                            }
                          >
                            清除选择
                          </button>
                        ) : null}
                      </div>
                    ) : question.type === 'textarea' ? (
                      <textarea
                        aria-label={question.label}
                        required={question.required}
                        maxLength={5000}
                        rows={4}
                        value={String(answers[question.id] || '')}
                        onChange={(event) =>
                          setAnswers((previous) => ({
                            ...previous,
                            [question.id]: event.target.value,
                          }))
                        }
                      />
                    ) : (
                      <input
                        aria-label={question.label}
                        type="text"
                        required={question.required}
                        maxLength={5000}
                        value={String(answers[question.id] || '')}
                        onChange={(event) =>
                          setAnswers((previous) => ({
                            ...previous,
                            [question.id]: event.target.value,
                          }))
                        }
                      />
                    )}
                  </fieldset>
                ))}
              </fieldset>
              <button type="submit" className="collections-primary-action" disabled={busy}>
                {busy ? '正在提交…' : '提交报名'}
              </button>
            </form>
          )}
          {receipt ? (
            <div className="learning-registration-receipt">
              <h4>你的报名回执</h4>
              <p>
                请妥善保存，用它查询抽签结果。登录、退出或切换账号后，本页将清除回执，请勿向他人分享。
              </p>
              {!submitted ? <p>此回执已为本次提交保留；提交失败时，请沿用当前表单重试。</p> : null}
              <code>{receipt}</code>
              <div className="learning-registration-actions">
                <button type="button" onClick={() => void copyReceipt()}>
                  复制回执
                </button>
                <button type="button" onClick={downloadReceipt}>
                  下载报名回执
                </button>
              </div>
            </div>
          ) : null}
          <form
            className="learning-registration-lookup"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void lookup();
            }}
          >
            <h4>查询我的抽签结果</h4>
            <label htmlFor={`${prefix}-receipt`}>报名回执</label>
            <input
              id={`${prefix}-receipt`}
              type="text"
              autoComplete="off"
              spellCheck={false}
              maxLength={64}
              value={lookupReceipt}
              onChange={(event) => setLookupReceipt(event.target.value)}
            />
            <button type="submit" disabled={busy}>
              {busy ? '请稍候…' : '查询抽签结果'}
            </button>
          </form>
          {result ? (
            <div className="learning-registration-result" role="status">
              <p>{resultLabels[result.result]}</p>
              {result.drawnAt ? (
                <small>抽签时间：{formatCollectionDate(result.drawnAt)}</small>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
      {feedback ? (
        <p role="status" className="learning-registration-feedback">
          {feedback}
        </p>
      ) : null}
    </section>
  );
}
