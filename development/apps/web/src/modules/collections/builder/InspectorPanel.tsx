import type {
  CollectionField,
  CollectionRule,
  CollectionSchema,
} from '@freebbs-development/contracts';
import type { BuilderSelection } from './model.js';

const kindNames: Record<CollectionRule['kind'], string> = {
  audience: '可见范围',
  required: '必填设置',
  attempt_limit: '提交次数',
  upload_count: '文件数量',
  file_types: '文件格式',
  file_size: '文件大小',
  title_pattern: '标题审核',
  schedule: '开放时间',
  capacity: '名额上限',
};

export interface InspectorPanelProps {
  schema: CollectionSchema;
  selection: BuilderSelection;
  onSchemaChange: (schema: CollectionSchema) => void;
  onFieldChange: (field: CollectionField) => void;
  onRuleChange: (rule: CollectionRule, fieldId?: string) => void;
  onDeleteField: (id: string) => void;
  onDeleteRule: (id: string, fieldId?: string) => void;
}

export function InspectorPanel({
  schema,
  selection,
  onSchemaChange,
  onFieldChange,
  onRuleChange,
  onDeleteField,
  onDeleteRule,
}: InspectorPanelProps) {
  const field =
    selection.type === 'field' ? schema.fields.find((item) => item.id === selection.id) : undefined;
  const rule =
    selection.type === 'rule'
      ? (selection.fieldId
          ? schema.fields.find((item) => item.id === selection.fieldId)?.rules
          : schema.formRules
        )?.find((item) => item.id === selection.id)
      : undefined;
  return (
    <aside className="builder-inspector" aria-label="属性编辑器">
      <header>
        <span>03</span>
        <div>
          <strong>属性编辑器</strong>
          <p>选中模块或零件后在这里调整</p>
        </div>
      </header>
      {selection.type === 'form' ? (
        <div className="builder-inspector-form">
          <label>
            表单名称
            <input
              value={schema.title}
              onChange={(event) => onSchemaChange({ ...schema, title: event.target.value })}
            />
          </label>
          <label>
            开场说明
            <textarea
              rows={5}
              value={schema.description}
              onChange={(event) => onSchemaChange({ ...schema, description: event.target.value })}
            />
          </label>
          <div className="builder-inspector-tip">
            <span>⌁</span>
            <p>
              <strong>表单级卡槽</strong>可见范围、开放时间、提交次数和名额上限会作用于整张表单。
            </p>
          </div>
        </div>
      ) : null}
      {field ? (
        <div className="builder-inspector-form">
          <p className="builder-selection-label">展示模块 · {field.kind}</p>
          <label>
            问题名称
            <input
              value={field.label}
              onChange={(event) => onFieldChange({ ...field, label: event.target.value })}
            />
          </label>
          <label>
            补充说明
            <textarea
              rows={3}
              value={field.helpText}
              onChange={(event) => onFieldChange({ ...field, helpText: event.target.value })}
            />
          </label>
          {['single_choice', 'multiple_choice'].includes(field.kind) ? (
            <label>
              选项（每行一项）
              <textarea
                rows={6}
                value={field.options.join('\n')}
                onChange={(event) =>
                  onFieldChange({ ...field, options: event.target.value.split('\n') })
                }
              />
            </label>
          ) : null}
          <button className="builder-delete" type="button" onClick={() => onDeleteField(field.id)}>
            删除这个模块
          </button>
        </div>
      ) : null}
      {rule ? (
        <div className="builder-inspector-form">
          <p className="builder-selection-label">规则零件</p>
          <h2>{kindNames[rule.kind]}</h2>
          {typeof rule.value === 'boolean' ? (
            <label className="builder-toggle">
              <input
                type="checkbox"
                checked={rule.value}
                onChange={(event) =>
                  onRuleChange(
                    { ...rule, value: event.target.checked },
                    selection.type === 'rule' ? selection.fieldId : undefined,
                  )
                }
              />
              启用
            </label>
          ) : typeof rule.value === 'number' ? (
            <label>
              数值
              <input
                type="number"
                min="1"
                value={rule.value}
                onChange={(event) =>
                  onRuleChange(
                    { ...rule, value: Number(event.target.value) },
                    selection.type === 'rule' ? selection.fieldId : undefined,
                  )
                }
              />
            </label>
          ) : Array.isArray(rule.value) ? (
            <label>
              允许值（每行一项）
              <textarea
                rows={6}
                value={rule.value.join('\n')}
                onChange={(event) =>
                  onRuleChange(
                    { ...rule, value: event.target.value.split('\n').filter(Boolean) },
                    selection.type === 'rule' ? selection.fieldId : undefined,
                  )
                }
              />
            </label>
          ) : typeof rule.value === 'string' ? (
            <label>
              规则值
              <input
                value={rule.value}
                onChange={(event) =>
                  onRuleChange(
                    { ...rule, value: event.target.value },
                    selection.type === 'rule' ? selection.fieldId : undefined,
                  )
                }
              />
            </label>
          ) : (
            <p>开放与截止时间将在发布设置中填写。</p>
          )}
          <button
            className="builder-delete"
            type="button"
            onClick={() =>
              onDeleteRule(rule.id, selection.type === 'rule' ? selection.fieldId : undefined)
            }
          >
            移除这个零件
          </button>
        </div>
      ) : null}
    </aside>
  );
}
