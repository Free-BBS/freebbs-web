import {
  identityLabels,
  toggleIdentitySelection,
  type DevelopmentIdentitySection,
  type RoleKey,
} from '@freebbs-development/contracts';
import { useState } from 'react';

export function IdentitySection({
  section,
  roles,
  onRolesChange,
  labelsForRoles = identityLabels,
  readonly = false,
}: {
  section: DevelopmentIdentitySection;
  roles: RoleKey[];
  onRolesChange: (roles: RoleKey[]) => void;
  labelsForRoles?: (roles: readonly RoleKey[]) => string[];
  readonly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selectedRoles = new Set(roles);
  const sectionRoleKeys = section.groups.flatMap(({ options }) =>
    options.map(({ roleKey }) => roleKey),
  );
  const selectedInSection = sectionRoleKeys.filter((roleKey) => selectedRoles.has(roleKey));

  function toggle(groupIndex: number, roleKey: RoleKey) {
    if (readonly) return;
    const group = section.groups[groupIndex];
    if (!group) return;
    onRolesChange(toggleIdentitySelection(roles, roleKey));
  }

  return (
    <section className="identity-section" data-section-id={section.id}>
      <button
        type="button"
        className="identity-section-summary"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{section.label}</span>
        <small>
          {selectedInSection.length
            ? `已选 ${selectedInSection.length} 项 · ${labelsForRoles(selectedInSection).join('、')}`
            : '尚未选择'}
        </small>
      </button>
      {open ? (
        <div className="identity-section-groups">
          {section.groups.map((group, groupIndex) => (
            <section
              className="identity-group"
              key={group.id}
              aria-labelledby={`${group.id}-label`}
            >
              <h4 id={`${group.id}-label`}>{group.label}</h4>
              <div className="identity-option-row">
                {group.options.map((identity) => {
                  const selected = selectedRoles.has(identity.roleKey);
                  return (
                    <button
                      key={identity.roleKey}
                      type="button"
                      aria-label={`${group.label}：${identity.label}`}
                      aria-pressed={selected}
                      disabled={readonly}
                      onClick={() => toggle(groupIndex, identity.roleKey)}
                    >
                      {identity.label}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      ) : null}
    </section>
  );
}
