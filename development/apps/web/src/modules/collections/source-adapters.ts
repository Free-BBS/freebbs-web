import type { UnifiedRegistration } from '@freebbs-development/contracts';

import type { ApiClient } from '../../core/api/client.js';

interface LearningSurveyRecord {
  id?: string | number;
  title?: string;
  description?: string;
  intro?: string;
  deadline?: string | null;
  startAt?: string | null;
  opensAt?: string | null;
  closesAt?: string | null;
  requiresLogin?: boolean;
  status?: string;
  responseCount?: number;
}

function surveyArray(payload: unknown): LearningSurveyRecord[] {
  if (Array.isArray(payload)) return payload as LearningSurveyRecord[];
  if (payload && typeof payload === 'object') {
    const candidate = payload as { data?: unknown; surveys?: unknown; items?: unknown };
    if (Array.isArray(candidate.data)) return candidate.data as LearningSurveyRecord[];
    if (Array.isArray(candidate.surveys)) return candidate.surveys as LearningSurveyRecord[];
    if (Array.isArray(candidate.items)) return candidate.items as LearningSurveyRecord[];
  }
  return [];
}

function learningStatus(item: LearningSurveyRecord): UnifiedRegistration['status'] {
  if (item.status && ['closed', 'archived', 'ended', 'drawn', 'cancelled'].includes(item.status))
    return 'closed';
  const opensAt = item.opensAt ?? item.startAt;
  const closesAt = item.closesAt ?? item.deadline;
  if (closesAt && new Date(closesAt).getTime() <= Date.now()) return 'closed';
  if (opensAt && new Date(opensAt).getTime() > Date.now()) return 'upcoming';
  return 'open';
}

export function normalizeLearningSurveys(payload: unknown): UnifiedRegistration[] {
  return surveyArray(payload)
    .filter((item) => item.id !== undefined && item.title?.trim())
    .map((item) => ({
      id: String(item.id),
      source: 'learning_survey',
      activityStatus: item.status,
      title: item.title?.trim() ?? '',
      description: item.description?.trim() || item.intro?.trim() || '来自学习端的活动报名',
      organizer: '学习端活动报名',
      coverUrl: null,
      opensAt: item.opensAt ?? item.startAt ?? null,
      closesAt: item.closesAt ?? item.deadline ?? null,
      requiresLogin: item.requiresLogin === true,
      location: null,
      capacity: null,
      registrationCount: item.responseCount ?? null,
      registered: false,
      status: learningStatus(item),
    }));
}

export async function loadRegistrationCatalog(
  client: Pick<ApiClient, 'request'>,
  fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
  options: { includePast?: boolean } = {},
): Promise<{ items: UnifiedRegistration[]; unavailable: Array<'learning_survey'> }> {
  const nativeAndEvents = await client.request<UnifiedRegistration[]>(
    options.includePast
      ? '/collections/registrations?includePast=true'
      : '/collections/registrations',
  );
  type State = {
    source: UnifiedRegistration['source'];
    activityId: string;
    startsAt: string | null;
    endsAt: string | null;
    finished: boolean;
  };
  let states: State[] = [];
  try {
    const saved = await client.request<State[]>('/events/activity-states');
    if (Array.isArray(saved))
      states = saved.filter(
        (item) => typeof item.activityId === 'string' && typeof item.finished === 'boolean',
      );
  } catch {
    /* Older APIs still provide registration cards. */
  }
  function withActivityDates(items: UnifiedRegistration[]) {
    return items.map((item) => {
      const state = states.find((s) => s.source === item.source && s.activityId === item.id);
      if (state)
        return {
          ...item,
          startsAt: state.startsAt,
          endsAt: state.endsAt,
          activityStatus: state.finished ? 'finished' : item.activityStatus,
        };
      return item.source === 'native_collection' ? { ...item, startsAt: null, endsAt: null } : item;
    });
  }
  try {
    const learning: UnifiedRegistration[] = [];
    const visited = new Set<number>();
    let page = 0;
    for (let count = 0; count < 100; count += 1) {
      if (visited.has(page)) throw new Error('Learning survey pagination repeated');
      visited.add(page);
      const response = await fetcher(page === 0 ? '/api/surveys' : `/api/surveys?page=${page}`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`Learning surveys returned ${response.status}`);
      const payload: unknown = await response.json();
      learning.push(...normalizeLearningSurveys(payload));
      const nextPage =
        payload && typeof payload === 'object' && 'nextPage' in payload ? payload.nextPage : null;
      if (nextPage === null || nextPage === undefined) break;
      if (
        typeof nextPage !== 'number' ||
        !Number.isSafeInteger(nextPage) ||
        nextPage < 0 ||
        count === 99
      )
        throw new Error('Learning survey pagination invalid');
      page = nextPage;
    }
    return { items: withActivityDates([...nativeAndEvents, ...learning]), unavailable: [] };
  } catch {
    return { items: withActivityDates(nativeAndEvents), unavailable: ['learning_survey'] };
  }
}

export const sourceLabels = {
  learning_survey: '学习端报名',
  development_activity: '校园活动',
  native_collection: '萬事屋',
} as const;
