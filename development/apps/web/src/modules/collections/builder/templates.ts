import type { CollectionField, CollectionSchema } from '@freebbs-development/contracts';
export interface CollectionTemplate {
  id: string;
  name: string;
  schema: CollectionSchema;
  departmentId?: string;
  ownerUid?: string;
}
function field(kind: CollectionField['kind'], label: string, required = true): CollectionField {
  return {
    id: `template-${kind}-${label}`,
    kind,
    label,
    helpText: '',
    options: [],
    rules: required ? [{ id: `required-${label}`, kind: 'required', value: true }] : [],
  };
}
function template(id: string, name: string, fields: CollectionField[]): CollectionTemplate {
  return {
    id,
    name,
    schema: {
      title: name,
      description: '请按要求填写，提交前核对信息。',
      fields,
      formRules: [
        { id: 'once', kind: 'attempt_limit', value: 1 },
        { id: 'audience', kind: 'audience', value: 'all' },
      ],
      outputs: [{ id: 'xlsx', kind: 'excel', label: 'Excel 结果', fileName: '收集结果.xlsx' }],
    },
  };
}
function upload(
  kind: 'video' | 'audio' | 'file' | 'image',
  label: string,
  types: string[],
  required = true,
) {
  const result = field(kind, label, required);
  result.rules.push(
    { id: `count-${label}`, kind: 'upload_count', value: 1 },
    { id: `types-${label}`, kind: 'file_types', value: types },
    { id: `size-${label}`, kind: 'file_size', value: 100 * 1024 * 1024 },
  );
  return result;
}
export const collectionTemplates: CollectionTemplate[] = [
  template('video', '视频作品收集', [
    field('identity', '基本信息', false),
    field('short_text', '作品名称'),
    upload('video', '作品视频', ['video/mp4', 'video/webm', 'video/quicktime']),
    upload('image', '封面', ['image/png', 'image/jpeg'], false),
    field('long_text', '作品说明', false),
  ]),
  template('audio', '音频作品收集', [
    field('identity', '基本信息', false),
    field('short_text', '作品名称'),
    upload('audio', '音频作品', ['audio/mpeg', 'audio/wav', 'audio/webm', 'audio/mp4']),
    field('long_text', '作品说明', false),
  ]),
  template('material', '部门材料收集', [
    field('identity', '基本信息', false),
    field('short_text', '材料标题'),
    upload('file', '材料文件', [
      'application/pdf',
      'application/zip',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ]),
    field('long_text', '备注', false),
  ]),
  template('timesurvey', '时间调研', [
    field('identity', '基本信息', false),
    {
      ...field('multiple_choice', '可参加时段'),
      options: ['周一晚间', '周三晚间', '周五晚间', '周末'],
    },
    field('datetime', '其他方便时间', false),
    field('long_text', '备注', false),
  ]),
  {
    ...template('public', '公开活动报名', [
      field('short_text', '姓名（自行填写）'),
      field('short_text', '联系方式'),
      field('long_text', '备注', false),
    ]),
    schema: {
      ...template('public', '公开活动报名', [
        field('short_text', '姓名（自行填写）'),
        field('short_text', '联系方式'),
        field('long_text', '备注', false),
      ]).schema,
      publicRegistration: true,
    },
  },
];
export function instantiateTemplate(source: CollectionSchema): CollectionSchema {
  const schema = structuredClone(source);
  schema.fields.forEach((field) => {
    field.id = crypto.randomUUID();
    field.rules.forEach((rule) => {
      rule.id = crypto.randomUUID();
    });
  });
  schema.formRules.forEach((rule) => {
    rule.id = crypto.randomUUID();
  });
  schema.outputs.forEach((output) => {
    output.id = crypto.randomUUID();
  });
  return schema;
}
