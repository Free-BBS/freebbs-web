import type {
  CollectionField,
  CollectionFieldKind,
  CollectionRuleKind,
  CollectionSchema,
} from '@freebbs-development/contracts';
import type { BuilderSelection } from './model.js';
import { acceptsRule } from './model.js';

const fieldSymbols: Record<CollectionFieldKind, string> = {
  instructions: 'Aa',
  identity: 'ID',
  short_text: '一',
  long_text: '≡',
  single_choice: '◉',
  multiple_choice: '☑',
  datetime: '◷',
  file: '↥',
  image: '▧',
  video: '▶',
  audio: '◖',
};
const ruleLabels: Record<CollectionRuleKind, string> = {
  audience: '可见范围',
  required: '必填',
  attempt_limit: '提交次数',
  upload_count: '文件数量',
  file_types: '文件格式',
  file_size: '文件大小',
  title_pattern: '标题审核',
  schedule: '开放时间',
  capacity: '名额上限',
};

function payload(event: React.DragEvent): string {
  return event.dataTransfer.getData('text/plain');
}

export interface FormCanvasProps {
  schema: CollectionSchema;
  selection: BuilderSelection;
  onSelect: (selection: BuilderSelection) => void;
  onAddField: (kind: CollectionFieldKind, index?: number) => void;
  onMoveField: (id: string, index: number) => void;
  onAttachRule: (kind: CollectionRuleKind, fieldId?: string) => void;
}

function RuleSlot({
  field,
  onAttach,
}: {
  field?: CollectionField;
  onAttach: (kind: CollectionRuleKind) => void;
}) {
  return (
    <div
      className="builder-rule-slot"
      onDragOver={(event) => {
        const [type, kind] = payload(event).split(':');
        if (
          type === 'rule' &&
          kind &&
          acceptsRule(field?.kind ?? 'form', kind as CollectionRuleKind)
        ) {
          event.preventDefault();
          event.currentTarget.dataset.magnet = 'true';
        }
      }}
      onDragLeave={(event) => {
        delete event.currentTarget.dataset.magnet;
      }}
      onDrop={(event) => {
        event.preventDefault();
        delete event.currentTarget.dataset.magnet;
        const [type, kind] = payload(event).split(':');
        if (type === 'rule' && kind) onAttach(kind as CollectionRuleKind);
      }}
    >
      <span>⌁</span>
      <small>拖入规则零件</small>
    </div>
  );
}

function FieldPreview({ field }: { field: CollectionField }) {
  if (field.kind === 'instructions')
    return (
      <p className="builder-preview-copy">{field.helpText || '这是一段给填写者看的说明文字。'}</p>
    );
  if (field.kind === 'identity')
    return (
      <div className="builder-preview-identity">
        <span>姓名</span>
        <b>从登录状态自动填写</b>
        <span>学号</span>
        <b>从登录状态自动填写</b>
      </div>
    );
  if (['single_choice', 'multiple_choice'].includes(field.kind))
    return (
      <div className="builder-preview-options">
        {field.options.map((option, index) => (
          <span key={`${option}-${index}`}>
            <i>{field.kind === 'single_choice' ? '○' : '□'}</i>
            {option}
          </span>
        ))}
      </div>
    );
  if (['file', 'image', 'video', 'audio'].includes(field.kind))
    return (
      <div className="builder-preview-upload">
        <span>↥</span>
        <b>
          选择或拖入
          {field.kind === 'image'
            ? '图片'
            : field.kind === 'video'
              ? '视频'
              : field.kind === 'audio'
                ? '音频'
                : '文件'}
        </b>
      </div>
    );
  return (
    <div className={`builder-preview-input is-${field.kind}`}>
      {field.kind === 'datetime' ? '年 / 月 / 日　时 : 分' : field.helpText || '填写内容'}
    </div>
  );
}

export function FormCanvas({
  schema,
  selection,
  onSelect,
  onAddField,
  onMoveField,
  onAttachRule,
}: FormCanvasProps) {
  return (
    <section className="builder-canvas" aria-label="表单仿真画布">
      <header>
        <span>02</span>
        <div>
          <strong>仿真画布</strong>
          <p>填写者看到的顺序就是这里的顺序</p>
        </div>
        <b>实时预览</b>
      </header>
      <div className="builder-form-simulator">
        <button
          type="button"
          className={`builder-form-heading${selection.type === 'form' ? ' is-selected' : ''}`}
          onClick={() => onSelect({ type: 'form' })}
        >
          <span>萬事集 · 新收集</span>
          <h1>{schema.title}</h1>
          <p>{schema.description}</p>
          <div className="builder-rule-chips">
            {schema.formRules.map((rule) => (
              <i key={rule.id}>{ruleLabels[rule.kind]}</i>
            ))}
          </div>
        </button>
        <RuleSlot onAttach={(kind) => onAttachRule(kind)} />
        {schema.fields.map((field, index) => (
          <article
            key={field.id}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', `existing:${field.id}`);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const [type, value] = payload(event).split(':');
              if (type === 'field' && value) onAddField(value as CollectionFieldKind, index);
              if (type === 'existing' && value) onMoveField(value, index);
            }}
            className={`builder-field-card${selection.type === 'field' && selection.id === field.id ? ' is-selected' : ''}`}
          >
            <button type="button" onClick={() => onSelect({ type: 'field', id: field.id })}>
              <span className="builder-field-grip" aria-hidden="true">
                ⠿
              </span>
              <span className="builder-field-symbol">{fieldSymbols[field.kind]}</span>
              <div>
                <h2>{field.label}</h2>
                {field.helpText ? <p>{field.helpText}</p> : null}
                <FieldPreview field={field} />
              </div>
            </button>
            <div className="builder-field-rules">
              {field.rules.map((rule) => (
                <button
                  type="button"
                  key={rule.id}
                  onClick={() => onSelect({ type: 'rule', fieldId: field.id, id: rule.id })}
                >
                  {ruleLabels[rule.kind]}
                </button>
              ))}
              <RuleSlot field={field} onAttach={(kind) => onAttachRule(kind, field.id)} />
            </div>
          </article>
        ))}
        <div
          className="builder-canvas-end"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const [type, value] = payload(event).split(':');
            if (type === 'field' && value) onAddField(value as CollectionFieldKind);
            if (type === 'existing' && value) onMoveField(value, schema.fields.length);
          }}
        >
          <span>＋</span>把下一个展示模块放在这里
        </div>
      </div>
    </section>
  );
}
