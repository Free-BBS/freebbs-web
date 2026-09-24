import { describe, expect, it } from 'vitest';

import { SOCIAL_ORGANIZATIONS } from '@freebbs-development/contracts';
import { ROLE_PERMISSION_CATALOG } from './permission-catalog.js';

function grants(roleKey: keyof typeof ROLE_PERMISSION_CATALOG, action: string): boolean {
  return ROLE_PERMISSION_CATALOG[roleKey].some(
    (rule) =>
      (rule.resource === 'knowledge_entry' || rule.resource === '*') &&
      (rule.action === action ||
        rule.action === '*' ||
        (rule.action.endsWith('.*') && action.startsWith(rule.action.slice(0, -1)))),
  );
}

describe('social organization knowledge permissions', () => {
  it('lets every member maintain drafts and every director or lead publish', () => {
    for (const organization of SOCIAL_ORGANIZATIONS) {
      expect(grants(organization.roles.member, 'knowledge.create'), organization.name).toBe(true);
      expect(grants(organization.roles.director, 'knowledge.create'), organization.name).toBe(true);
      expect(grants(organization.roles.director, 'knowledge.publish'), organization.name).toBe(
        true,
      );
      expect(grants(organization.roles.lead, 'knowledge.publish'), organization.name).toBe(true);
    }
  });
});
