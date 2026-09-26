import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import type { CollectionField, UnifiedRegistration } from '@freebbs-development/contracts';
import { ApiError, createApiClient, type ApiClient } from '../../core/api/client.js';
import { formatCollectionDate, isRequired, numericRule } from './collection-utils.js';
import { loadRegistrationCatalog, sourceLabels } from './source-adapters.js';

export interface RegistrationGalleryProps {
  client?: Pick<ApiClient, 'request'>;
}

function FieldControl({
  field,
  value,
  onChange,
}: {
  field: CollectionField;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const id = `collection-field-${field.id}`;
  if (field.kind === 'instructions')
    return (
      <div className="collection-instructions">
        <strong>{field.label}</strong>
        <p>{field.helpText}</p>
      </div>
    );
  if (field.kind === 'identity')
    return (
      <div className="collection-identity-field">
        <span>✓</span>
        <div>
          <strong>{field.label}</strong>
          <p>{field.helpText}</p>
        </div>
      </div>
    );
  if (field.kind === 'long_text')
    return (
      <textarea
        id={id}
        value={String(value ?? '')}
        onChange={(event) => onChange(event.target.value)}
        rows={4}
        required={isRequired(field)}
      />
    );
  if (field.kind === 'single_choice')
    return (
      <div className="collection-choice-list">
        {field.options.map((option) => (
          <label key={option}>
            <input
              type="radio"
              name={id}
              value={option}
              checked={value === option}
              onChange={() => onChange(option)}
            />
            {option}
          </label>
        ))}
      </div>
    );
  if (field.kind === 'multiple_choice') {
    const selected = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div className="collection-choice-list">
        {field.options.map((option) => (
          <label key={option}>
            <input
              type="checkbox"
              checked={selected.includes(option)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...selected, option]
                    : selected.filter((item) => item !== option),
                )
              }
            />
            {option}
          </label>
        ))}
      </div>
    );
  }
  if (['file', 'image', 'video', 'audio'].includes(field.kind)) {
    const count = numericRule(field, 'upload_count') ?? 1;
    return (
      <input
        id={id}
        type="file"
        multiple={count > 1}
        accept={
          field.kind === 'image'
            ? 'image/*'
            : field.kind === 'video'
              ? 'video/*'
              : field.kind === 'audio'
                ? 'audio/*'
                : undefined
        }
        required={isRequired(field)}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []).slice(0, count);
          onChange(count > 1 ? files : (files[0] ?? null));
        }}
      />
    );
  }
  return (
    <input
      id={id}
      type={field.kind === 'datetime' ? 'datetime-local' : 'text'}
      value={String(value ?? '')}
      onChange={(event) => onChange(event.target.value)}
      required={isRequired(field)}
    />
  );
}

export function RegistrationGallery({ client }: RegistrationGalleryProps) {
  const defaultClient = useMemo(createApiClient, []);
  const api = client ?? defaultClient;
  const [search] = useSearchParams();
  const [items, setItems] = useState<UnifiedRegistration[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [learningUnavailable, setLearningUnavailable] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(search.get('focus'));
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    loadRegistrationCatalog(api as ApiClient).then(
      (result) => {
        if (active) {
          setItems(result.items);
          setLearningUnavailable(result.unavailable.length > 0);
          setState('ready');
        }
      },
      () => {
        if (active) setState('error');
      },
    );
    return () => {
      active = false;
    };
  }, [api]);

  async function submit(item: UnifiedRegistration) {
    setBusy(true);
    setFeedback(null);
    try {
      if (item.source === 'development_activity') {
        await api.request(`/events/activities/${encodeURIComponent(item.id)}/registrations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
      } else if (item.source === 'native_collection') {
        const submittedAnswers = { ...answers };
        for (const [fieldId, value] of Object.entries(submittedAnswers)) {
          const files =
            value instanceof File
              ? [value]
              : Array.isArray(value) && value.every((entry) => entry instanceof File)
                ? (value as File[])
                : [];
          if (files.length === 0) continue;
          const uploaded = [];
          for (const file of files) {
            const body = new FormData();
            body.append('file', file);
            uploaded.push(await api.request('/collections/assets', { method: 'POST', body }));
          }
          submittedAnswers[fieldId] = value instanceof File ? uploaded[0] : uploaded;
        }
        await api.request(`/collections/forms/${encodeURIComponent(item.id)}/responses`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answers: submittedAnswers }),
        });
      }
      setItems((current) =>
        current.map((entry) =>
          entry.id === item.id && entry.source === item.source
            ? { ...entry, registered: true, registrationCount: (entry.registrationCount ?? 0) + 1 }
            : entry,
        ),
      );
      setFeedback('报名已经收好，可以在“我的报名”中查看。');
    } catch (error) {
      setFeedback(error instanceof ApiError ? error.message : '提交失败，请稍后重试。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="collections-page collections-subpage">
      <header className="collections-subpage-heading">
        <div>
          <Link to="/collections">← 返回萬事集</Link>
          <p>REGISTRATION HALL</p>
          <h1>报名入口</h1>
          <span>展开卡片，在原地读完信息并完成报名。</span>
        </div>
        <Link className="collections-wallet compact" to="/collections/mine">
          我的报名
        </Link>
      </header>
      {learningUnavailable ? (
        <div className="collections-inline-note">
          学习端报名源暂时没有连接，其余报名仍可正常使用。
        </div>
      ) : null}
      {feedback ? (
        <div className="collections-feedback" role="status">
          {feedback}
        </div>
      ) : null}
      {state === 'loading' ? <p className="collections-empty">正在整理报名卡片…</p> : null}
      {state === 'error' ? (
        <p className="collections-empty">报名入口暂时无法加载，请稍后重试。</p>
      ) : null}
      <section className="registration-grid" aria-label="全部报名">
        {items.map((item) => {
          const key = `${item.source}:${item.id}`;
          const open = expanded === key;
          return (
            <article className={`registration-card${open ? ' is-open' : ''}`} key={key}>
              <button
                className="registration-card-summary"
                type="button"
                aria-expanded={open}
                onClick={() => {
                  setExpanded(open ? null : key);
                  setAnswers({});
                  setFeedback(null);
                }}
              >
                <span className={`registration-status is-${item.status}`}>
                  {item.status === 'open'
                    ? '开放中'
                    : item.status === 'upcoming'
                      ? '即将开放'
                      : '已截止'}
                </span>
                <span className="collections-source">{sourceLabels[item.source]}</span>
                <strong>{item.title}</strong>
                <p>{item.description}</p>
                <dl>
                  <div>
                    <dt>发起</dt>
                    <dd>{item.organizer}</dd>
                  </div>
                  <div>
                    <dt>截止</dt>
                    <dd>{formatCollectionDate(item.closesAt)}</dd>
                  </div>
                  {item.location ? (
                    <div>
                      <dt>地点</dt>
                      <dd>{item.location}</dd>
                    </div>
                  ) : null}
                </dl>
                <span className="registration-expand-label">
                  {open ? '收起详情' : '展开并报名'} <b aria-hidden="true">⌄</b>
                </span>
              </button>
              {open ? (
                <div className="registration-card-detail">
                  {item.source === 'learning_survey' ? (
                    <div className="registration-external">
                      <p>这项报名沿用学习端的原有表单与填写记录。</p>
                      <a href={`/surveys?id=${encodeURIComponent(item.id)}`}>
                        前往学习端完成报名 ↗
                      </a>
                    </div>
                  ) : (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        void submit(item);
                      }}
                    >
                      {item.schema?.fields.map((field) => (
                        <label
                          className="collection-field"
                          key={field.id}
                          htmlFor={`collection-field-${field.id}`}
                        >
                          <span>
                            {field.label}
                            {isRequired(field) ? <em>必填</em> : null}
                          </span>
                          {field.helpText && field.kind !== 'identity' ? (
                            <small>{field.helpText}</small>
                          ) : null}
                          <FieldControl
                            field={field}
                            value={answers[field.id]}
                            onChange={(value) =>
                              setAnswers((current) => ({ ...current, [field.id]: value }))
                            }
                          />
                        </label>
                      ))}
                      {!item.schema ? <p>确认报名后，活动负责人会通过站内信息联系你。</p> : null}
                      <button
                        className="collections-primary-action"
                        type="submit"
                        disabled={busy || item.status !== 'open' || item.registered}
                      >
                        {item.registered ? '已报名' : busy ? '正在提交…' : '确认报名'}
                      </button>
                    </form>
                  )}
                </div>
              ) : null}
            </article>
          );
        })}
      </section>
    </main>
  );
}
