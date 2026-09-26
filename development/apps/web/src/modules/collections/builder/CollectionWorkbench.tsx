import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import type {
  CollectionField,
  CollectionFieldKind,
  CollectionFormSummary,
  CollectionRule,
  CollectionRuleKind,
  CollectionSchema,
  CollectionsDashboardPayload,
} from '@freebbs-development/contracts';
import { ApiError, createApiClient, type ApiClient } from '../../../core/api/client.js';
import { emptyCollectionSchema } from '../collection-utils.js';
import { FieldLibrary } from './FieldLibrary.js';
import { FormCanvas } from './FormCanvas.js';
import { InspectorPanel } from './InspectorPanel.js';
import {
  addField,
  attachRule,
  detachRule,
  moveField,
  removeField,
  updateField,
  updateRule,
  validateSchema,
  type BuilderSelection,
} from './model.js';

export function CollectionWorkbench({ client }: { client?: Pick<ApiClient, 'request'> }) {
  const fallback = useMemo(createApiClient, []);
  const api = client ?? fallback;
  const { collectionId } = useParams();
  const [schema, setSchema] = useState<CollectionSchema>(structuredClone(emptyCollectionSchema));
  const [selection, setSelection] = useState<BuilderSelection>({ type: 'form' });
  const [formId, setFormId] = useState<string | null>(
    collectionId && collectionId !== 'new' ? collectionId : null,
  );
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<'save' | 'publish' | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      api.request<CollectionsDashboardPayload>('/collections/dashboard'),
      formId
        ? api.request<CollectionFormSummary>(`/collections/forms/${encodeURIComponent(formId)}`)
        : Promise.resolve(null),
    ]).then(
      ([dashboard, form]) => {
        if (!active) return;
        setAllowed(dashboard.canCreate);
        if (form?.schema) setSchema(form.schema);
      },
      () => {
        if (active) setAllowed(false);
      },
    );
    return () => {
      active = false;
    };
  }, [api, formId]);

  function add(kind: CollectionFieldKind, index?: number) {
    setSchema((current) => addField(current, kind, index));
  }
  function addRule(kind: CollectionRuleKind, fieldId?: string) {
    setSchema((current) => attachRule(current, kind, fieldId));
  }
  function changeField(field: CollectionField) {
    setSchema((current) => updateField(current, field.id, field));
  }
  function changeRule(rule: CollectionRule, fieldId?: string) {
    setSchema((current) => updateRule(current, rule.id, rule.value, fieldId));
  }

  async function save(publish: boolean) {
    const errors = validateSchema(schema);
    if (errors.length > 0) {
      setMessage(errors[0] ?? '请检查表单');
      return;
    }
    setBusy(publish ? 'publish' : 'save');
    setMessage(null);
    try {
      let activeId = formId;
      if (!activeId) {
        const created = await api.request<CollectionFormSummary>('/collections/forms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: schema.title, description: schema.description, schema }),
        });
        activeId = created.id;
        setFormId(created.id);
        window.history.replaceState(null, '', `/development/collections/workbench/${created.id}`);
      } else {
        await api.request(`/collections/forms/${encodeURIComponent(activeId)}/draft`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: schema.title, description: schema.description, schema }),
        });
      }
      if (publish) {
        await api.request(`/collections/forms/${encodeURIComponent(activeId)}/publish`, {
          method: 'POST',
        });
        setMessage('表单已经发布，现在会出现在报名入口。');
      } else setMessage('草稿已经保存。');
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : '保存失败，请稍后重试。');
    } finally {
      setBusy(null);
    }
  }

  if (allowed === null)
    return (
      <main className="collections-page collections-subpage">
        <p className="collections-empty">正在接通工作台…</p>
      </main>
    );
  if (!allowed)
    return (
      <main className="collections-page collections-subpage">
        <div className="collections-empty">
          <strong>当前身份没有创建入口</strong>
          <p>表单工作台仅向社工组织成员开放。</p>
          <Link to="/collections">返回萬事集</Link>
        </div>
      </main>
    );

  return (
    <main className="collection-workbench-page">
      <header className="builder-topbar">
        <div>
          <Link to="/collections">← 萬事集</Link>
          <span>FORM LAB / 表单仿真工作台</span>
          <strong>{schema.title}</strong>
        </div>
        <div>
          {message ? <p role="status">{message}</p> : null}
          <button type="button" onClick={() => void save(false)} disabled={busy !== null}>
            {busy === 'save' ? '保存中…' : '保存草稿'}
          </button>
          <button
            className="is-primary"
            type="button"
            onClick={() => void save(true)}
            disabled={busy !== null}
          >
            {busy === 'publish' ? '发布中…' : '检查并发布'}
          </button>
        </div>
      </header>
      <div className="builder-layout">
        <FieldLibrary onAddField={add} onAddFormRule={(kind) => addRule(kind)} />
        <FormCanvas
          schema={schema}
          selection={selection}
          onSelect={setSelection}
          onAddField={add}
          onMoveField={(id, index) => setSchema((current) => moveField(current, id, index))}
          onAttachRule={addRule}
        />
        <InspectorPanel
          schema={schema}
          selection={selection}
          onSchemaChange={setSchema}
          onFieldChange={changeField}
          onRuleChange={changeRule}
          onDeleteField={(id) => {
            setSchema((current) => removeField(current, id));
            setSelection({ type: 'form' });
          }}
          onDeleteRule={(id, fieldId) => {
            setSchema((current) => detachRule(current, id, fieldId));
            setSelection(fieldId ? { type: 'field', id: fieldId } : { type: 'form' });
          }}
        />
      </div>
      <div className="builder-live-region" aria-live="polite">
        {message}
      </div>
    </main>
  );
}
