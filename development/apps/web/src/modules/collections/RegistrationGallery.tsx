import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import type { CollectionField, UnifiedRegistration } from '@freebbs-development/contracts';
import { organizationById } from '@freebbs-development/contracts';
import { ApiError, createApiClient, type ApiClient } from '../../core/api/client.js';
import { formatCollectionDate, isRequired, numericRule } from './collection-utils.js';
import { loadRegistrationCatalog, sourceLabels } from './source-adapters.js';
import { LearningSurveyRegistration } from './LearningSurveyRegistration.js';
import { MediaCapture } from '../../components/MediaCapture.js';
import { VideoCoverEditor } from '../../components/VideoCoverEditor.js';
import {
  filterRegistrationsByOrganization,
  parseRegistrationOrganizations,
} from './registration-organization.js';

export interface RegistrationGalleryProps {
  client?: Pick<ApiClient, 'request'>;
  focusedItem?: UnifiedRegistration;
  embedded?: boolean;
}

export function FieldControl({
  field,
  value,
  onChange,
  onCover,
}: {
  field: CollectionField;
  value: unknown;
  onChange: (value: unknown) => void;
  onCover?: (file: File) => void;
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
      <div>
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
          required={isRequired(field) && !value}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []).slice(0, count);
            onChange(count > 1 ? files : (files[0] ?? null));
          }}
        />
        {field.kind === 'audio' || field.kind === 'video' ? (
          <MediaCapture kind={field.kind} onFile={(file) => onChange(count > 1 ? [file] : file)} />
        ) : null}
        {field.kind === 'video' &&
        (value instanceof File || (Array.isArray(value) && value[0] instanceof File)) ? (
          <VideoCoverEditor
            file={value instanceof File ? value : (value[0] as File)}
            onCover={onCover}
          />
        ) : null}
      </div>
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

function nativeAttempts(item: UnifiedRegistration) {
  if (item.source !== 'native_collection') return null;
  const { attemptsUsed, attemptLimit } = item;
  if (
    typeof attemptsUsed !== 'number' ||
    typeof attemptLimit !== 'number' ||
    !Number.isInteger(attemptsUsed) ||
    !Number.isInteger(attemptLimit) ||
    attemptsUsed < 0 ||
    attemptLimit < 1
  )
    return null;
  return { used: attemptsUsed, limit: attemptLimit };
}

function registrationComplete(item: UnifiedRegistration) {
  const attempts = nativeAttempts(item);
  return attempts ? attempts.used >= attempts.limit : item.registered;
}

export function RegistrationGallery({
  client,
  focusedItem,
  embedded = false,
}: RegistrationGalleryProps) {
  const defaultClient = useMemo(createApiClient, []);
  const api = client ?? defaultClient;
  const [search] = useSearchParams();
  const includePast = search.get('includePast') === 'true';
  const focus = focusedItem ? `${focusedItem.source}:${focusedItem.id}` : search.get('focus');
  const [items, setItems] = useState<UnifiedRegistration[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [learningUnavailable, setLearningUnavailable] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(search.get('focus'));
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const organizationIds = parseRegistrationOrganizations(search.get('organization'));
  const visibleItems = focusedItem
    ? items
    : filterRegistrationsByOrganization(items, organizationIds);
  const allRegistrationsSearch = new URLSearchParams(search);
  allRegistrationsSearch.delete('organization');

  useEffect(() => {
    if (focusedItem) {
      setItems([focusedItem]);
      setState('ready');
      setLearningUnavailable(false);
      return;
    }
    let active = true;
    setState('loading');
    loadRegistrationCatalog(api as ApiClient, globalThis.fetch.bind(globalThis), {
      includePast,
    }).then(
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
  }, [api, includePast, focusedItem]);

  useEffect(() => {
    setExpanded(focus);
    setAnswers({});
    setFeedback(null);
  }, [focus]);

  async function submit(item: UnifiedRegistration) {
    if (item.status !== 'open' || registrationComplete(item) || busy) return;
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
            body.append('formId', item.id);
            body.append('fieldId', fieldId);
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
            ? {
                ...entry,
                registered: true,
                registrationCount: (entry.registrationCount ?? 0) + 1,
                ...(nativeAttempts(entry) ? { attemptsUsed: nativeAttempts(entry)!.used + 1 } : {}),
              }
            : entry,
        ),
      );
      setFeedback('报名已经收好，可以在“我的报名”中查看。');
      setAnswers({});
    } catch (error) {
      setFeedback(error instanceof ApiError ? error.message : '提交失败，请稍后重试。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`collections-page collections-subpage${embedded ? ' is-embedded' : ''}`}>
      {!embedded ? (
        <header className="collections-subpage-heading">
          <div>
            <Link to="/collections">← 返回萬事屋</Link>
            <p>REGISTRATION HALL</p>
            <h1>报名入口</h1>
            <span>展开卡片，在原地读完信息并完成报名。</span>
          </div>
          <Link className="collections-wallet compact" to="/collections/mine">
            我的报名
          </Link>
        </header>
      ) : null}
      {learningUnavailable ? (
        <div className="collections-inline-note">
          学习端报名源暂时没有连接，其余报名仍可正常使用。
        </div>
      ) : null}
      {!embedded && organizationIds.length ? (
        <div className="registration-organization-filter">
          <span>
            组织报名 · {organizationIds.map((id) => organizationById(id).name).join('、')}
          </span>
          <span>{visibleItems.length} 项</span>
          <Link
            to={`/collections/registrations${allRegistrationsSearch.size ? `?${allRegistrationsSearch}` : ''}`}
          >
            查看全部报名
          </Link>
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
        {state === 'ready' && visibleItems.length === 0 ? (
          <p className="collections-empty">
            这里还没有可展示的报名。可以查看全部报名，或稍后再来。
          </p>
        ) : null}
        {visibleItems.map((item) => {
          const key = `${item.source}:${item.id}`;
          const open = expanded === key;
          const attempts = nativeAttempts(item);
          const complete = registrationComplete(item);
          return (
            <article className={`registration-card${open ? ' is-open' : ''}`} key={key}>
              {!embedded ? (
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
                    {open ? '收起详情' : item.status === 'closed' ? '查看详情' : '展开并报名'}{' '}
                    <b aria-hidden="true">⌄</b>
                  </span>
                </button>
              ) : null}
              {open ? (
                <div className="registration-card-detail">
                  {item.source === 'learning_survey' ? (
                    <LearningSurveyRegistration surveyId={item.id} />
                  ) : (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        void submit(item);
                      }}
                    >
                      <fieldset
                        disabled={item.status !== 'open' || complete || busy}
                        style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}
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
                              onCover={
                                item.schema?.fields.some(
                                  (candidate) =>
                                    candidate.kind === 'image' && candidate.label.includes('封面'),
                                )
                                  ? (file) => {
                                      const cover = item.schema!.fields.find(
                                        (candidate) =>
                                          candidate.kind === 'image' &&
                                          candidate.label.includes('封面'),
                                      )!;
                                      setAnswers((current) => ({
                                        ...current,
                                        [cover.id]:
                                          (numericRule(cover, 'upload_count') ?? 1) > 1
                                            ? [file]
                                            : file,
                                      }));
                                    }
                                  : undefined
                              }
                            />
                          </label>
                        ))}
                      </fieldset>
                      {!item.schema ? <p>确认报名后，活动负责人会通过站内信息联系你。</p> : null}
                      {attempts ? (
                        <p className="collection-attempt-count" role="status">
                          已提交 {attempts.used} / {attempts.limit} 次
                        </p>
                      ) : null}
                      <button
                        className="collections-primary-action"
                        type="submit"
                        disabled={busy || item.status !== 'open' || complete}
                      >
                        {item.status === 'closed'
                          ? '报名已截止'
                          : item.status === 'upcoming'
                            ? '报名尚未开放'
                            : complete
                              ? attempts
                                ? '已达提交上限'
                                : '已报名'
                              : busy
                                ? '正在提交…'
                                : attempts && attempts.used > 0
                                  ? '再次提交'
                                  : '确认报名'}
                      </button>
                    </form>
                  )}
                </div>
              ) : null}
            </article>
          );
        })}
      </section>
    </div>
  );
}
