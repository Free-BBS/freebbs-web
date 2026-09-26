import type {
  CollectionFieldKind,
  CollectionModuleDefinition,
  CollectionOutputKind,
  CollectionRuleKind,
} from '@freebbs-development/contracts';
import { fieldCatalog, outputCatalog, ruleCatalog } from './catalog.js';

export interface FieldLibraryProps {
  onAddField: (kind: CollectionFieldKind, template?: CollectionModuleDefinition) => void;
  onArmRule: (kind: CollectionRuleKind) => void;
  armedRule: CollectionRuleKind | null;
  onAddOutput: (kind: CollectionOutputKind) => void;
  customModules: CollectionModuleDefinition[];
  canManageLibrary: boolean;
  onCreateModule: () => void;
}

function dragPayload(event: React.DragEvent, payload: string) {
  event.dataTransfer.effectAllowed = 'copy';
  event.dataTransfer.setData('text/plain', payload);
}

export function FieldLibrary({
  onAddField,
  onArmRule,
  armedRule,
  onAddOutput,
  customModules,
  canManageLibrary,
  onCreateModule,
}: FieldLibraryProps) {
  return (
    <aside className="builder-library" aria-label="模块库">
      <header>
        <span>01</span>
        <div>
          <strong>模块库</strong>
          <p>选择模块，像拼装仪器一样组合表单</p>
        </div>
      </header>
      {canManageLibrary ? (
        <button className="builder-create-module" type="button" onClick={onCreateModule}>
          <span>＋</span>
          <div>
            <strong>创建新的模块</strong>
            <small>保存为模块库中的可复用部件</small>
          </div>
        </button>
      ) : null}
      <section>
        <h2>展示模块</h2>
        <div className="builder-part-list">
          {fieldCatalog.map((item) => (
            <button
              type="button"
              draggable
              key={item.kind}
              onDragStart={(event) => dragPayload(event, `field:${item.kind}`)}
              onClick={() => onAddField(item.kind)}
            >
              <span>{item.symbol}</span>
              <div>
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </div>
              <b>＋</b>
            </button>
          ))}
          {customModules.map((item) => (
            <button type="button" key={item.id} onClick={() => onAddField(item.fieldKind, item)}>
              <span>◇</span>
              <div>
                <strong>{item.name}</strong>
                <small>{item.description}</small>
              </div>
              <b>＋</b>
            </button>
          ))}
        </div>
      </section>
      <section>
        <h2>规则宝石</h2>
        <p className="builder-library-help">先选中一枚宝石，再点击画布中亮起的卡槽完成镶嵌。</p>
        <div className="builder-rule-parts">
          {ruleCatalog.map((item) => (
            <button
              type="button"
              draggable
              key={item.kind}
              className={armedRule === item.kind ? 'is-armed' : ''}
              aria-pressed={armedRule === item.kind}
              onDragStart={(event) => dragPayload(event, `rule:${item.kind}`)}
              onClick={() => onArmRule(item.kind)}
              title={item.description}
            >
              <span>{item.symbol}</span>
              <strong>{item.label}</strong>
              <small>{item.description}</small>
            </button>
          ))}
        </div>
      </section>
      <section>
        <h2>输出模块</h2>
        <p className="builder-library-help">把收集结果整理成文件，发布后可随时下载处理。</p>
        <div className="builder-output-parts">
          {outputCatalog.map((item) => (
            <button type="button" key={item.kind} onClick={() => onAddOutput(item.kind)}>
              <span>{item.symbol}</span>
              <div>
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </div>
            </button>
          ))}
        </div>
      </section>
    </aside>
  );
}
