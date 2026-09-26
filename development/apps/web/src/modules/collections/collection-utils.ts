import type {
  CollectionField,
  CollectionRule,
  CollectionSchema,
} from '@freebbs-development/contracts';

export const emptyCollectionSchema: CollectionSchema = {
  title: '未命名收集',
  description: '写下一句清楚的说明，让填写者知道为什么需要这些信息。',
  fields: [
    {
      id: 'identity-default',
      kind: 'identity',
      label: '基本信息',
      helpText: '姓名和学号会从登录状态自动带入',
      options: [],
      rules: [{ id: 'identity-required', kind: 'required', value: true }],
    },
  ],
  formRules: [{ id: 'attempt-default', kind: 'attempt_limit', value: 1 }],
};

export function isRequired(field: CollectionField): boolean {
  return field.rules.some((rule) => rule.kind === 'required' && rule.value === true);
}

export function numericRule(field: CollectionField, kind: CollectionRule['kind']): number | null {
  const value = field.rules.find((rule) => rule.kind === kind)?.value;
  return typeof value === 'number' ? value : null;
}

export function formatCollectionDate(value: string | null): string {
  if (!value) return '长期开放';
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}
