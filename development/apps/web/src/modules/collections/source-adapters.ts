import type { UnifiedRegistration } from '@freebbs-development/contracts';

import type { ApiClient } from '../../core/api/client.js';

interface LearningSurveyRecord {
  id?: string | number;
  title?: string;
  description?: string;
  intro?: string;
  deadline?: string | null;
  startAt?: string | null;
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
  if (item.status && ['closed', 'archived', 'ended'].includes(item.status)) return 'closed';
  if (item.startAt && new Date(item.startAt) > new Date()) return 'upcoming';
  if (item.deadline && new Date(item.deadline) < new Date()) return 'closed';
  return 'open';
}

export function normalizeLearningSurveys(payload: unknown): UnifiedRegistration[] {
  return surveyArray(payload)
    .filter((item) => item.id !== undefined && item.title?.trim())
    .map((item) => ({
      id: String(item.id),
      source: 'learning_survey',
      title: item.title?.trim() ?? '',
      description: item.description?.trim() || item.intro?.trim() || '来自学习端的活动报名',
      organizer: '学习端活动报名',
      coverUrl: null,
      opensAt: item.startAt ?? null,
      closesAt: item.deadline ?? null,
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
): Promise<{ items: UnifiedRegistration[]; unavailable: Array<'learning_survey'> }> {
  const nativeAndEvents = await client.request<UnifiedRegistration[]>('/collections/registrations');
  try {
    const response = await fetcher('/api/surveys', {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Learning surveys returned ${response.status}`);
    const learning = normalizeLearningSurveys(await response.json());
    return { items: [...nativeAndEvents, ...learning], unavailable: [] };
  } catch {
    return { items: nativeAndEvents, unavailable: ['learning_survey'] };
  }
}

export const sourceLabels = {
  learning_survey: '学习端报名',
  development_activity: '無活动',
  native_collection: '萬事集',
} as const;
