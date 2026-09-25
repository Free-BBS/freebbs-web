import { describe, expect, it } from 'vitest';

import { DEMO_USER_IDS } from './client.js';

describe('demo preview identities', () => {
  it('exposes the complete representative identity matrix', () => {
    expect(DEMO_USER_IDS).toEqual([
      'demo-student',
      'demo-admin',
      'demo-arts-member',
      'demo-arts-director',
      'demo-arts-lead',
      'demo-sports-member',
      'demo-sports-director',
      'demo-sports-lead',
      'demo-liaison-member',
      'demo-liaison-director',
      'demo-liaison-lead',
      'demo-rights-member',
      'demo-rights-director',
      'demo-rights-lead',
      'demo-captain',
      'demo-tuanwei-lead',
    ]);
  });
});
