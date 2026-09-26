import type { CollectionFieldKind, CollectionRuleKind } from '@freebbs-development/contracts';
import { fieldCatalog, ruleCatalog } from './catalog.js';

export interface FieldLibraryProps {
  onAddField: (kind: CollectionFieldKind) => void;
  onAddFormRule: (kind: CollectionRuleKind) => void;
}

function dragPayload(event: React.DragEvent, payload: string) {
  event.dataTransfer.effectAllowed = 'copy';
  event.dataTransfer.setData('text/plain', payload);
}

export function FieldLibrary({ onAddField, onAddFormRule }: FieldLibraryProps) {
  return (
    <aside className="builder-library" aria-label="模块库">
      <header>
        <span>01</span>
        <div>
          <strong>模块库</strong>
          <p>点击添加，或拖进中间画布</p>
        </div>
      </header>
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
        </div>
      </section>
      <section>
        <h2>规则零件</h2>
        <p className="builder-library-help">拖到相容的卡槽；表单级规则也可点击添加。</p>
        <div className="builder-rule-parts">
          {ruleCatalog.map((item) => (
            <button
              type="button"
              draggable
              key={item.kind}
              onDragStart={(event) => dragPayload(event, `rule:${item.kind}`)}
              onClick={() => onAddFormRule(item.kind)}
              title={item.description}
            >
              <span>{item.symbol}</span>
              {item.label}
            </button>
          ))}
        </div>
      </section>
    </aside>
  );
}
