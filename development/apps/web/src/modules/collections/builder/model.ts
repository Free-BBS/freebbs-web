import type {
  CollectionField,
  CollectionFieldKind,
  CollectionRule,
  CollectionRuleKind,
  CollectionSchema,
} from '@freebbs-development/contracts';

export type BuilderSelection =
  { type: 'form' } | { type: 'field'; id: string } | { type: 'rule'; fieldId?: string; id: string };

const formRuleKinds = new Set<CollectionRuleKind>([
  'audience',
  'attempt_limit',
  'schedule',
  'capacity',
]);
const uploadRuleKinds = new Set<CollectionRuleKind>([
  'required',
  'upload_count',
  'file_types',
  'file_size',
  'title_pattern',
]);
const inputRuleKinds = new Set<CollectionRuleKind>(['required', 'title_pattern']);

function uniqueId(prefix: string): string {
  const random =
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`;
}

export function createField(kind: CollectionFieldKind): CollectionField {
  const labels: Record<CollectionFieldKind, string> = {
    instructions: '一段说明',
    identity: '基本信息',
    short_text: '简短回答',
    long_text: '详细回答',
    single_choice: '请选择一项',
    multiple_choice: '请选择适用项',
    datetime: '选择日期和时间',
    file: '上传文件',
    image: '上传图片',
    video: '上传视频',
    audio: '上传音频',
  };
  return {
    id: uniqueId('field'),
    kind,
    label: labels[kind],
    helpText: '',
    options: ['single_choice', 'multiple_choice'].includes(kind) ? ['选项一', '选项二'] : [],
    rules: [],
  };
}

export function defaultRule(kind: CollectionRuleKind): CollectionRule {
  const defaults: Record<CollectionRuleKind, CollectionRule['value']> = {
    audience: 'all',
    required: true,
    attempt_limit: 1,
    upload_count: 1,
    file_types: [],
    file_size: 10485760,
    title_pattern: '^[^<>]{1,50}$',
    schedule: { start: '', end: '' },
    capacity: 100,
  };
  return { id: uniqueId('rule'), kind, value: defaults[kind] };
}

export function acceptsRule(
  target: 'form' | CollectionFieldKind,
  kind: CollectionRuleKind,
): boolean {
  if (target === 'form') return formRuleKinds.has(kind);
  if (['file', 'image', 'video', 'audio'].includes(target)) return uploadRuleKinds.has(kind);
  if (
    [
      'short_text',
      'long_text',
      'single_choice',
      'multiple_choice',
      'datetime',
      'identity',
    ].includes(target)
  )
    return inputRuleKinds.has(kind);
  return false;
}

export function addField(
  schema: CollectionSchema,
  kind: CollectionFieldKind,
  index = schema.fields.length,
): CollectionSchema {
  const fields = [...schema.fields];
  fields.splice(Math.max(0, Math.min(index, fields.length)), 0, createField(kind));
  return { ...schema, fields };
}

export function moveField(
  schema: CollectionSchema,
  fieldId: string,
  targetIndex: number,
): CollectionSchema {
  const from = schema.fields.findIndex((field) => field.id === fieldId);
  if (from < 0) return schema;
  const fields = [...schema.fields];
  const [field] = fields.splice(from, 1);
  if (!field) return schema;
  fields.splice(Math.max(0, Math.min(targetIndex, fields.length)), 0, field);
  return { ...schema, fields };
}

export function updateField(
  schema: CollectionSchema,
  fieldId: string,
  patch: Partial<CollectionField>,
): CollectionSchema {
  return {
    ...schema,
    fields: schema.fields.map((field) =>
      field.id === fieldId ? { ...field, ...patch, id: field.id } : field,
    ),
  };
}

export function removeField(schema: CollectionSchema, fieldId: string): CollectionSchema {
  return { ...schema, fields: schema.fields.filter((field) => field.id !== fieldId) };
}

export function attachRule(
  schema: CollectionSchema,
  kind: CollectionRuleKind,
  fieldId?: string,
): CollectionSchema {
  if (!fieldId) {
    if (!acceptsRule('form', kind) || schema.formRules.some((rule) => rule.kind === kind))
      return schema;
    return { ...schema, formRules: [...schema.formRules, defaultRule(kind)] };
  }
  const field = schema.fields.find((item) => item.id === fieldId);
  if (!field || !acceptsRule(field.kind, kind) || field.rules.some((rule) => rule.kind === kind))
    return schema;
  return updateField(schema, fieldId, { rules: [...field.rules, defaultRule(kind)] });
}

export function detachRule(
  schema: CollectionSchema,
  ruleId: string,
  fieldId?: string,
): CollectionSchema {
  if (!fieldId)
    return { ...schema, formRules: schema.formRules.filter((rule) => rule.id !== ruleId) };
  const field = schema.fields.find((item) => item.id === fieldId);
  if (!field) return schema;
  return updateField(schema, fieldId, { rules: field.rules.filter((rule) => rule.id !== ruleId) });
}

export function updateRule(
  schema: CollectionSchema,
  ruleId: string,
  value: CollectionRule['value'],
  fieldId?: string,
): CollectionSchema {
  if (!fieldId)
    return {
      ...schema,
      formRules: schema.formRules.map((rule) => (rule.id === ruleId ? { ...rule, value } : rule)),
    };
  const field = schema.fields.find((item) => item.id === fieldId);
  if (!field) return schema;
  return updateField(schema, fieldId, {
    rules: field.rules.map((rule) => (rule.id === ruleId ? { ...rule, value } : rule)),
  });
}

export function validateSchema(schema: CollectionSchema): string[] {
  const errors: string[] = [];
  if (!schema.title.trim()) errors.push('请填写表单名称');
  if (schema.fields.length === 0) errors.push('至少添加一个展示模块');
  if (new Set(schema.fields.map((field) => field.id)).size !== schema.fields.length)
    errors.push('展示模块标识重复');
  for (const field of schema.fields) {
    if (!field.label.trim()) errors.push('所有展示模块都需要名称');
    if (
      ['single_choice', 'multiple_choice'].includes(field.kind) &&
      field.options.filter(Boolean).length < 2
    )
      errors.push(`“${field.label}”至少需要两个选项`);
  }
  return [...new Set(errors)];
}
