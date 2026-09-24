import type { KeyboardEvent } from 'react';

export const ADMIN_SECTIONS = [
  { id: 'access', label: '访问与身份' },
  { id: 'subjects', label: '用户与授权' },
  { id: 'roles', label: '角色与权限' },
  { id: 'tags', label: 'Tag 定义' },
  { id: 'modules', label: '模块与负责人' },
  { id: 'business', label: '业务数据入口' },
  { id: 'audit', label: '审计日志' },
  { id: 'system', label: '系统状态' },
] as const;

export type AdminSectionId = (typeof ADMIN_SECTIONS)[number]['id'];

export function AdminSectionNav({
  active,
  onChange,
}: {
  active: AdminSectionId;
  onChange: (id: AdminSectionId) => void;
}) {
  function move(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? ADMIN_SECTIONS.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + ADMIN_SECTIONS.length) %
            ADMIN_SECTIONS.length;
    const item = ADMIN_SECTIONS[next];
    if (item) onChange(item.id);
    requestAnimationFrame(() => {
      document.getElementById(`admin-tab-${item?.id}`)?.focus();
    });
  }

  return (
    <nav className="admin-tab-nav" aria-label="治理管理分区">
      <div role="tablist" aria-label="治理管理">
        {ADMIN_SECTIONS.map((section, index) => (
          <button
            key={section.id}
            id={`admin-tab-${section.id}`}
            role="tab"
            type="button"
            aria-selected={active === section.id}
            aria-controls={`admin-panel-${section.id}`}
            tabIndex={active === section.id ? 0 : -1}
            onClick={() => onChange(section.id)}
            onKeyDown={(event) => move(event, index)}
          >
            {section.label}
          </button>
        ))}
      </div>
    </nav>
  );
}
