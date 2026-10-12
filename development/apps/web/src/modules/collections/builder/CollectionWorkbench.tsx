import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import type {
  CollectionField,
  CollectionFieldKind,
  CollectionFormSummary,
  CollectionModuleDefinition,
  CollectionOutput,
  CollectionOutputKind,
  CollectionRule,
  CollectionRuleKind,
  CollectionSchema,
  CollectionsDashboardPayload,
} from '@freebbs-development/contracts';
import { DEPARTMENT_DIRECTORY, departmentsForRoles } from '@freebbs-development/contracts';
import { ApiError, createApiClient, type ApiClient } from '../../../core/api/client.js';
import { useOptionalAuth } from '../../../core/auth/AuthProvider.js';
import { emptyCollectionSchema } from '../collection-utils.js';
import { FieldLibrary } from './FieldLibrary.js';
import { FormCanvas } from './FormCanvas.js';
import { InspectorPanel } from './InspectorPanel.js';
import { collectionTemplates, instantiateTemplate, type CollectionTemplate } from './templates.js';
import '../completion.css';
import {
  addField,
  addOutput,
  attachRule,
  detachRule,
  moveField,
  removeField,
  removeOutput,
  updateField,
  updateOutput,
  updateRule,
  validateSchema,
  type BuilderSelection,
} from './model.js';

function canMaintainModuleLibrary(roles: readonly string[]): boolean {
  return roles.some(
    (role) =>
      role === 'platform.admin' ||
      role === 'platform.super_admin' ||
      role.startsWith('counselor.') ||
      role === 'student_union.executive_president' ||
      role === 'student_union.presidium' ||
      /(?:lead|director|leader|deputy_secretary|chair|vice_chair|minister|consultant)$/.test(role),
  );
}

export function CollectionWorkbench({ client }: { client?: Pick<ApiClient, 'request'> }) {
  const auth = useOptionalAuth();
  const fallback = useMemo(createApiClient, []);
  const api = client ?? fallback;
  const { collectionId } = useParams();
  const roles = auth?.user?.roles ?? [];
  const publisherDepartments = roles.includes('platform.super_admin')
    ? [...DEPARTMENT_DIRECTORY]
    : departmentsForRoles(roles);
  const [schema, setSchema] = useState<CollectionSchema>(structuredClone(emptyCollectionSchema));
  const [selection, setSelection] = useState<BuilderSelection>({ type: 'form' });
  const [formId, setFormId] = useState<string | null>(
    collectionId && collectionId !== 'new' ? collectionId : null,
  );
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [canCreate, setCanCreate] = useState(false);
  const [armedRule, setArmedRule] = useState<CollectionRuleKind | null>(null);
  const [moduleDialogOpen, setModuleDialogOpen] = useState(false);
  const [customModules, setCustomModules] = useState<CollectionModuleDefinition[]>([]);
  const [busy, setBusy] = useState<'save' | 'publish' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [savedTemplates, setSavedTemplates] = useState<CollectionTemplate[]>([]);
  const [templateChoice, setTemplateChoice] = useState('');
  const [pendingTemplate, setPendingTemplate] = useState<CollectionTemplate | null>(null);
  const [templateName, setTemplateName] = useState('');
  const savedSchema = useRef(JSON.stringify(emptyCollectionSchema));
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([
      api.request<CollectionsDashboardPayload>('/collections/dashboard'),
      api.request<CollectionModuleDefinition[]>('/collections/module-definitions'),
      formId
        ? api.request<CollectionFormSummary>(`/collections/forms/${encodeURIComponent(formId)}`)
        : Promise.resolve(null),
    ]).then(
      ([dashboard, modules, form]) => {
        if (!active) return;
        const roles = auth?.user?.roles ?? [];
        const managesLibrary = canMaintainModuleLibrary(roles);
        setCanCreate(dashboard.canCreate || form?.canManage === true);
        setAllowed(form ? form.canManage : dashboard.canCreate || managesLibrary);
        setCustomModules(modules);
        if (form?.schema) {
          const loaded = { ...form.schema, outputs: form.schema.outputs ?? [] };
          setSchema(loaded);
          savedSchema.current = JSON.stringify(loaded);
        } else if (!formId && publisherDepartments.length === 1)
          setSchema((current) => ({
            ...current,
            publisherDepartmentId: publisherDepartments[0]!.id,
          }));
      },
      () => {
        if (active) setAllowed(false);
      },
    );
    return () => {
      active = false;
    };
  }, [api, auth?.user?.roles, formId]);
  useEffect(() => {
    let active = true;
    api.request<CollectionTemplate[]>('/collections/templates').then(
      (items) => {
        if (active && Array.isArray(items)) setSavedTemplates(items);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [api]);

  function applyTemplate(template: CollectionTemplate) {
    const next = instantiateTemplate(template.schema);
    if (schema.publisherDepartmentId) next.publisherDepartmentId = schema.publisherDepartmentId;
    setSchema(next);
    setSelection({ type: 'form' });
    setPendingTemplate(null);
    setTemplateChoice('');
    setMessage('模板已载入，检查内容后保存草稿。');
  }
  function chooseTemplate(id: string) {
    setTemplateChoice(id);
    const template = [...collectionTemplates, ...savedTemplates].find((item) => item.id === id);
    if (!template) return;
    if (JSON.stringify(schema) !== savedSchema.current) setPendingTemplate(template);
    else applyTemplate(template);
  }
  async function saveTemplate() {
    if (!templateName.trim() || busy) return;
    setBusy('save');
    try {
      const saved = await api.request<CollectionTemplate>('/collections/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: templateName.trim(), schema }),
      });
      setSavedTemplates((items) => [...items, saved]);
      setTemplateName('');
      setMessage('模板已保存，可供所属部门下次复用。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '模板保存失败');
    } finally {
      setBusy(null);
    }
  }

  const canManageLibrary = canMaintainModuleLibrary(roles);

  function add(kind: CollectionFieldKind, index?: number, template?: CollectionModuleDefinition) {
    const inserted = addField(schema, kind, index);
    const targetIndex = index === undefined ? inserted.fields.length - 1 : index;
    const target = inserted.fields[targetIndex];
    const next =
      template && target
        ? updateField(inserted, target.id, {
            label: template.defaultLabel,
            helpText: template.description,
          })
        : inserted;
    setSchema(next);
    if (target) setSelection({ type: 'field', id: target.id });
  }
  function addRule(kind: CollectionRuleKind, fieldId?: string) {
    const next = attachRule(schema, kind, fieldId);
    setSchema(next);
    const attached = (
      fieldId ? next.fields.find((field) => field.id === fieldId)?.rules : next.formRules
    )?.find((rule) => rule.kind === kind);
    if (attached) setSelection({ type: 'rule', id: attached.id, ...(fieldId ? { fieldId } : {}) });
    setArmedRule(null);
  }
  async function createCustomModule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const definition = {
      name: String(data.get('name') ?? '').trim(),
      description: String(data.get('description') ?? '').trim(),
      defaultLabel: String(data.get('defaultLabel') ?? '').trim(),
      fieldKind: String(data.get('fieldKind') ?? 'short_text') as CollectionFieldKind,
    };
    if (!definition.name || !definition.defaultLabel) return;
    try {
      const created = await api.request<CollectionModuleDefinition>(
        '/collections/module-definitions',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(definition),
        },
      );
      setCustomModules((current) => [...current, created]);
      setModuleDialogOpen(false);
      setMessage('新模块已经加入共享模块库。');
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : '模块创建失败。');
    }
  }

  async function downloadOutput(output: CollectionOutput) {
    if (!formId || !('download' in api)) return;
    try {
      const blob = await (api as Pick<ApiClient, 'download'>).download(
        `/collections/forms/${encodeURIComponent(formId)}/exports/${encodeURIComponent(output.id)}`,
      );
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = output.fileName;
      anchor.click();
      URL.revokeObjectURL(href);
      setMessage('结果文件已经生成。');
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : '结果文件生成失败。');
    }
  }
  function changeField(field: CollectionField) {
    setSchema((current) => updateField(current, field.id, field));
  }
  function changeRule(rule: CollectionRule, fieldId?: string) {
    setSchema((current) => updateRule(current, rule.id, rule.value, fieldId));
  }

  async function save(publish: boolean) {
    if (!formId && publisherDepartments.length > 1 && !schema.publisherDepartmentId) {
      setMessage('请选择发布部门。');
      return;
    }
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
        if (!live.current) return;
        activeId = created.id;
        setFormId(created.id);
        window.history.replaceState(null, '', `/development/collections/workbench/${created.id}`);
      } else {
        await api.request(`/collections/forms/${encodeURIComponent(activeId)}/draft`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: schema.title, description: schema.description, schema }),
        });
        if (!live.current) return;
      }
      if (publish) {
        await api.request(`/collections/forms/${encodeURIComponent(activeId)}/publish`, {
          method: 'POST',
        });
        if (!live.current) return;
        setMessage('表单已经发布，现在会出现在报名入口。');
      } else setMessage('草稿已经保存。');
      savedSchema.current = JSON.stringify(schema);
    } catch (error) {
      if (live.current)
        setMessage(error instanceof ApiError ? error.message : '保存失败，请稍后重试。');
    } finally {
      if (live.current) setBusy(null);
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
          <Link to="/collections">返回萬事屋</Link>
        </div>
      </main>
    );

  return (
    <main className="collection-workbench-page">
      <header className="builder-topbar">
        <div>
          <Link to="/collections">← 萬事屋</Link>
          <span>FORM LAB / 表单仿真工作台</span>
          <strong>{schema.title}</strong>
        </div>
        <div>
          {message ? <p role="status">{message}</p> : null}
          <button
            type="button"
            onClick={() => void save(false)}
            disabled={busy !== null || !canCreate}
          >
            {busy === 'save' ? '保存中…' : '保存草稿'}
          </button>
          <button
            className="is-primary"
            type="button"
            onClick={() => void save(true)}
            disabled={busy !== null || !canCreate}
          >
            {busy === 'publish' ? '发布中…' : '检查并发布'}
          </button>
        </div>
      </header>
      <div className="collection-template-toolbar">
        <label>
          复用部门模板{' '}
          <select value={templateChoice} onChange={(event) => chooseTemplate(event.target.value)}>
            <option value="">选择模板</option>
            <optgroup label="常用模板">
              {collectionTemplates.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="部门已保存">
              {savedTemplates.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <input
          aria-label="新模板名称"
          value={templateName}
          onChange={(event) => setTemplateName(event.target.value)}
          placeholder="模板名称"
        />
        <button
          type="button"
          disabled={!canCreate || busy !== null || !templateName.trim()}
          onClick={() => void saveTemplate()}
        >
          保存为部门模板
        </button>
        {formId && (
          <Link to={`/collections/results/${encodeURIComponent(formId)}`}>结果与名单</Link>
        )}
        {formId && schema.publicRegistration && (
          <Link
            to={`/collections/public/${encodeURIComponent(formId)}`}
            target="_blank"
            rel="noreferrer"
          >
            公开填写链接（发布后可用）
          </Link>
        )}
      </div>
      {pendingTemplate && (
        <div className="builder-module-dialog-backdrop">
          <section
            className="builder-module-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="template-confirm-title"
          >
            <h2 id="template-confirm-title">替换未保存的内容？</h2>
            <p>载入“{pendingTemplate.name}”会替换当前表单。请先保存需要保留的草稿。</p>
            <button
              type="button"
              onClick={() => {
                setPendingTemplate(null);
                setTemplateChoice('');
              }}
            >
              保留当前内容
            </button>
            <button type="button" onClick={() => applyTemplate(pendingTemplate)}>
              确认载入模板
            </button>
          </section>
        </div>
      )}
      <div className="builder-layout">
        <FieldLibrary
          onAddField={(kind, template) => add(kind, undefined, template)}
          onArmRule={(kind) => setArmedRule((current) => (current === kind ? null : kind))}
          armedRule={armedRule}
          onAddOutput={(kind: CollectionOutputKind) => {
            const next = addOutput(schema, kind);
            setSchema(next);
            const output = next.outputs.at(-1);
            if (output) setSelection({ type: 'output', id: output.id });
          }}
          customModules={customModules}
          canManageLibrary={canManageLibrary}
          onCreateModule={() => setModuleDialogOpen(true)}
        />
        <FormCanvas
          schema={schema}
          selection={selection}
          onSelect={setSelection}
          onAddField={(kind, index) => add(kind, index)}
          onMoveField={(id, index) => setSchema((current) => moveField(current, id, index))}
          onAttachRule={addRule}
          armedRule={armedRule}
        />
        <InspectorPanel
          schema={schema}
          selection={selection}
          publisherDepartments={publisherDepartments}
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
          onOutputChange={(output) =>
            setSchema((current) => updateOutput(current, output.id, output))
          }
          onDeleteOutput={(id) => {
            setSchema((current) => removeOutput(current, id));
            setSelection({ type: 'form' });
          }}
          onDownloadOutput={formId ? (output) => void downloadOutput(output) : undefined}
        />
      </div>
      {moduleDialogOpen ? (
        <div className="builder-module-dialog-backdrop" role="presentation">
          <form className="builder-module-dialog" onSubmit={createCustomModule}>
            <header>
              <div>
                <span>MODULE STUDIO</span>
                <h2>创建新的模块</h2>
              </div>
              <button type="button" aria-label="关闭" onClick={() => setModuleDialogOpen(false)}>
                ×
              </button>
            </header>
            <label>
              模块名称
              <input name="name" required placeholder="例如：视频作品信息" />
            </label>
            <label>
              基础类型
              <select name="fieldKind" defaultValue="short_text">
                {[
                  ['short_text', '单行文字'],
                  ['long_text', '多行文字'],
                  ['single_choice', '单项选择'],
                  ['multiple_choice', '多项选择'],
                  ['file', '文件上传'],
                  ['image', '图片上传'],
                  ['video', '视频上传'],
                  ['audio', '音频上传'],
                  ['datetime', '日期时间'],
                ].map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              默认问题
              <input name="defaultLabel" required placeholder="填写者会看到的标题" />
            </label>
            <label>
              使用说明
              <textarea name="description" rows={3} placeholder="说明这个模块适合收集什么" />
            </label>
            <footer>
              <button type="button" onClick={() => setModuleDialogOpen(false)}>
                取消
              </button>
              <button className="is-primary" type="submit">
                保存到模块库
              </button>
            </footer>
          </form>
        </div>
      ) : null}
      <div className="builder-live-region" aria-live="polite">
        {message}
      </div>
    </main>
  );
}
