import { describe, expect, it } from 'vitest';
import {
  filterRegistrationsByOrganization,
  parseRegistrationOrganizations,
} from './registration-organization.js';
import type { UnifiedRegistration } from '@freebbs-development/contracts';

describe('explicit registration organization filtering', () => {
  const items = [
    { id: 'art', organizationId: 'arts_center', organizer: '文艺中心' },
    { id: 'science', organizationId: 'sast', organizer: '科协' },
    { id: 'learning', organizer: '文艺中心' },
  ] as UnifiedRegistration[];
  it('accepts only the existing organization identifiers and deduplicates them', () => {
    expect(parseRegistrationOrganizations('arts_center,invalid,sast,arts_center')).toEqual([
      'arts_center',
      'sast',
    ]);
  });
  it('never guesses organization ownership from titles or labels', () => {
    expect(filterRegistrationsByOrganization(items, ['arts_center']).map(({ id }) => id)).toEqual([
      'art',
    ]);
    expect(filterRegistrationsByOrganization(items, [])).toEqual(items);
  });
});
