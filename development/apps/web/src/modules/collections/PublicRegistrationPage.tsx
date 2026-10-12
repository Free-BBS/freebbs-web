import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import type { CollectionSchema } from '@freebbs-development/contracts';
import { FieldControl } from './RegistrationGallery.js';
import { isRequired, numericRule } from './collection-utils.js';
import './completion.css';
import { useMainSiteTheme } from '../../core/theme/useMainSiteTheme.js';

interface PublicForm {
  id: string;
  title: string;
  description: string;
  schema: CollectionSchema;
  status: 'open' | 'upcoming' | 'closed';
  capacity: number | null;
  responseCount: number;
}
interface Receipt {
  receiptToken?: string;
  id?: string;
  submittedAt: string;
  answers?: Record<string, unknown>;
}
export function PublicRegistrationPage({ fetcher }: { fetcher?: typeof fetch }) {
  useMainSiteTheme();
  const { collectionId } = useParams();
  const [search, setSearch] = useSearchParams();
  const api = useMemo(() => fetcher ?? globalThis.fetch.bind(globalThis), [fetcher]);
  const [form, setForm] = useState<PublicForm>();
  const [receipt, setReceipt] = useState<Receipt>();
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await api(`/api/development/v1/collections/public${path}`, {
      ...init,
      credentials: 'omit',
    });
    const envelope = (await response.json()) as { data: T & { error?: { message?: string } } };
    if (!response.ok) throw new Error(envelope.data?.error?.message ?? '公开表单暂不可用');
    return envelope.data;
  }
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setForm(undefined);
    setReceipt(undefined);
    setAnswers({});
    const receiptToken = search.get('receipt');
    const task = receiptToken
      ? request<Receipt>(`/receipts/${encodeURIComponent(receiptToken)}`)
      : request<PublicForm>(`/forms/${encodeURIComponent(collectionId ?? '')}`);
    task
      .then(
        (data) => {
          if (active) {
            if (receiptToken) setReceipt(data as Receipt);
            else setForm(data as PublicForm);
          }
        },
        (cause) => {
          if (active) setError(cause instanceof Error ? cause.message : '公开表单暂不可用');
        },
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, collectionId, search]);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form || busy) return;
    setBusy(true);
    setError('');
    try {
      const key = `freebbs-public-session:${form.id}`;
      let sessionToken: string | undefined;
      try {
        const saved = JSON.parse(sessionStorage.getItem(key) ?? 'null') as {
          sessionToken: string;
          expiresAt: string;
        } | null;
        if (saved && Date.parse(saved.expiresAt) > Date.now()) sessionToken = saved.sessionToken;
      } catch {
        /* Storage may be disabled. */
      }
      if (!sessionToken) {
        const session = await request<{ sessionToken: string; expiresAt: string }>(
          `/forms/${encodeURIComponent(form.id)}/session`,
          { method: 'POST' },
        );
        sessionToken = session.sessionToken;
        try {
          sessionStorage.setItem(key, JSON.stringify(session));
        } catch {
          /* The current submission still has its session. */
        }
      }
      const submittedAnswers = { ...answers };
      for (const [fieldId, value] of Object.entries(submittedAnswers)) {
        const files =
          value instanceof File
            ? [value]
            : Array.isArray(value) && value.every((item) => item instanceof File)
              ? (value as File[])
              : [];
        if (!files.length) continue;
        const uploaded = [];
        for (const file of files) {
          const body = new FormData();
          body.append('fieldId', fieldId);
          body.append('file', file);
          uploaded.push(
            await request(`/forms/${encodeURIComponent(form.id)}/assets`, {
              method: 'POST',
              headers: { 'X-Collection-Session': sessionToken },
              body,
            }),
          );
        }
        submittedAnswers[fieldId] = value instanceof File ? uploaded[0] : uploaded;
        // Keep canonical uploaded references when a later validation failure needs a retry.
        setAnswers((current) => ({ ...current, [fieldId]: submittedAnswers[fieldId] }));
      }
      const result = await request<Receipt>(`/forms/${encodeURIComponent(form.id)}/responses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken, answers: submittedAnswers }),
      });
      setReceipt(result);
      try {
        sessionStorage.removeItem(key);
      } catch {
        /* optional browser storage */
      }
      if (result.receiptToken) setSearch({ receipt: result.receiptToken }, { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '提交失败，请稍后重试');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="collection-public-page">
      <header>
        <span>萬事屋 · 公开填写</span>
        <h1>{form?.title ?? (receipt ? '提交回执' : '公开报名')}</h1>
        <p>访客填写的姓名和联系方式为自行提供，未经学校身份认证。</p>
      </header>
      {loading ? (
        <p role="status">正在读取表单…</p>
      ) : receipt ? (
        <section>
          <h2>提交成功</h2>
          <p>提交时间：{new Date(receipt.submittedAt).toLocaleString('zh-CN')}</p>
          <p>请保存本页回执链接。持有链接的人可以查看本次提交和附件。</p>
          {receipt.answers &&
            Object.entries(receipt.answers).map(([key, value]) => (
              <div key={key}>
                {Array.isArray(value) ? (
                  value.map((item, index) => <ReceiptValue key={index} value={item} />)
                ) : (
                  <ReceiptValue value={value} />
                )}
              </div>
            ))}
        </section>
      ) : form ? (
        <form onSubmit={(event) => void submit(event)}>
          <p>{form.description}</p>
          {form.capacity !== null ? (
            <p>
              已提交 {form.responseCount} / {form.capacity}
            </p>
          ) : null}
          <fieldset disabled={busy || form.status !== 'open'}>
            {form.schema.fields.map((field) => (
              <div className="collection-public-field" key={field.id}>
                <label htmlFor={`collection-field-${field.id}`}>
                  {field.label}
                  {isRequired(field) ? '（必填）' : ''}
                </label>
                {field.helpText && <small>{field.helpText}</small>}
                <FieldControl
                  field={field}
                  value={answers[field.id]}
                  onChange={(value) => setAnswers((current) => ({ ...current, [field.id]: value }))}
                  onCover={
                    form.schema.fields.some(
                      (item) => item.kind === 'image' && item.label.includes('封面'),
                    )
                      ? (file) => {
                          const cover = form.schema.fields.find(
                            (item) => item.kind === 'image' && item.label.includes('封面'),
                          )!;
                          setAnswers((current) => ({
                            ...current,
                            [cover.id]:
                              (numericRule(cover, 'upload_count') ?? 1) > 1 ? [file] : file,
                          }));
                        }
                      : undefined
                  }
                />
              </div>
            ))}
          </fieldset>
          <button
            type="submit"
            disabled={
              busy ||
              form.status !== 'open' ||
              (form.capacity !== null && form.responseCount >= form.capacity)
            }
          >
            {busy
              ? '提交中…'
              : form.status === 'closed'
                ? '报名已截止'
                : form.status === 'upcoming'
                  ? '报名尚未开放'
                  : '提交公开报名'}
          </button>
        </form>
      ) : null}
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
function ReceiptValue({ value }: { value: unknown }) {
  if (value && typeof value === 'object' && 'url' in value && 'name' in value)
    return (
      <a href={String(value.url)} rel="noreferrer" download>
        {String(value.name)}
      </a>
    );
  return <p>{typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')}</p>;
}
