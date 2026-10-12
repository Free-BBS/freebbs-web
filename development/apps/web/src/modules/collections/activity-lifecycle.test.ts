import { describe, expect, it } from 'vitest';
import type { UnifiedRegistration } from '@freebbs-development/contracts';
import { activityState, sortActivities } from './activity-lifecycle.js';

const item = (patch: Partial<UnifiedRegistration>): UnifiedRegistration => ({
  id: 'one',
  source: 'development_activity',
  title: '活动',
  description: '',
  organizer: '',
  coverUrl: null,
  opensAt: null,
  closesAt: null,
  location: null,
  capacity: null,
  registrationCount: null,
  registered: false,
  status: 'open',
  ...patch,
});
describe('activity lifecycle', () => {
  it('keeps a registration deadline distinct from actual event completion', () => {
    expect(
      activityState(item({ status: 'closed', closesAt: '2020-01-01', endsAt: '2099-01-01' })),
    ).toEqual({ key: 'closed', label: '报名已截止' });
    expect(activityState(item({ endsAt: '2020-01-01' }))).toEqual({
      key: 'ended',
      label: '活动已结束',
    });
  });
  it('requires actual completion for learning surveys and native forms', () => {
    expect(
      activityState(item({ source: 'learning_survey', activityStatus: 'drawn', status: 'closed' }))
        .key,
    ).toBe('closed');
    expect(
      activityState(item({ source: 'learning_survey', closesAt: '2020-01-01', status: 'closed' }))
        .key,
    ).toBe('closed');
    expect(activityState(item({ source: 'native_collection', status: 'closed' })).key).toBe(
      'closed',
    );
    expect(
      activityState(
        item({ source: 'native_collection', activityStatus: 'finished', status: 'closed' }),
      ).key,
    ).toBe('ended');
  });
  it('shows upcoming openings and sorts recent dates first without mutating the catalog', () => {
    const catalog = [
      item({ id: 'old', startsAt: '2020-01-01' }),
      item({ id: 'new', opensAt: '2030-01-01', status: 'upcoming' }),
      item({ id: 'undated' }),
    ];
    expect(activityState(catalog[1]).key).toBe('upcoming');
    expect(sortActivities(catalog).map((x) => x.id)).toEqual(['new', 'old', 'undated']);
    expect(catalog[0].id).toBe('old');
  });
});
