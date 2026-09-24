import { KIND_LABELS, type DiscoveryConfig, type DiscoveryKind } from './site-config.js';

export interface Preferences {
  kinds: DiscoveryKind[];
  interests: string[];
  days: 7 | 30 | 90;
  explore: boolean;
}
export interface Candidate {
  key: string;
  kind: DiscoveryKind;
  title: string;
  summary: string;
  searchText: string;
  href: string;
  startsAt?: string;
  endsAt?: string;
}
interface SourceRecord {
  id: string;
  status: string;
  title?: string;
  name?: string;
  description?: string;
  summary?: string;
  body?: string;
  category?: string;
  tags?: string[];
  audience?: string;
  startsAt?: string | null;
  endsAt?: string | null;
  location?: string;
}
export interface Sources {
  activities: SourceRecord[];
  knowledge: SourceRecord[];
}
export const preferenceKey = (uid: string) => `free_bbs_discovery:v1:${encodeURIComponent(uid)}`;
export function normalizePreferences(value: unknown): Preferences {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const kinds = Array.isArray(raw.kinds)
    ? [
        ...new Set(
          raw.kinds.filter(
            (kind): kind is DiscoveryKind =>
              typeof kind === 'string' && Object.hasOwn(KIND_LABELS, kind),
          ),
        ),
      ]
    : [];
  const interests = Array.isArray(raw.interests)
    ? [
        ...new Set(
          raw.interests
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim().slice(0, 24))
            .filter(Boolean),
        ),
      ].slice(0, 8)
    : [];
  return {
    kinds: kinds.length ? kinds : ['activity', 'knowledge'],
    interests,
    days: raw.days === 7 || raw.days === 90 ? raw.days : 30,
    explore: typeof raw.explore === 'boolean' ? raw.explore : true,
  };
}
export function readPreferences(uid: string): Preferences {
  try {
    return normalizePreferences(JSON.parse(localStorage.getItem(preferenceKey(uid)) ?? 'null'));
  } catch {
    return normalizePreferences(null);
  }
}
export function savePreferences(uid: string, preferences: Preferences): boolean {
  try {
    localStorage.setItem(preferenceKey(uid), JSON.stringify(preferences));
    return true;
  } catch {
    return false;
  }
}
export function localDay(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
function summary(value: string): string {
  const chars = Array.from(value.replace(/\s+/g, ' ').trim());
  return chars.length > 100 ? `${chars.slice(0, 100).join('')}…` : chars.join('');
}
export function buildCandidates(sources: Sources, now: Date, config: DiscoveryConfig): Candidate[] {
  if (!config.enabled) return [];
  const entries: Candidate[] = [];
  function add(record: SourceRecord, kind: DiscoveryKind, href: string) {
    const title = (record.title ?? record.name ?? '').trim();
    if (!title || !record.id) return;
    entries.push({
      key: `${kind}:${record.id}`,
      kind,
      title,
      summary: summary(record.summary || record.description || record.body || ''),
      searchText: [
        title,
        record.description,
        record.summary,
        record.body,
        record.category,
        ...(record.tags ?? []),
        record.location,
      ]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase(),
      href,
      ...(record.startsAt ? { startsAt: record.startsAt } : {}),
      ...(record.endsAt ? { endsAt: record.endsAt } : {}),
    });
  }
  for (const record of sources.activities) {
    if (record.status !== 'published') continue;
    if (record.startsAt && !Number.isFinite(Date.parse(record.startsAt))) continue;
    if (record.endsAt && !Number.isFinite(Date.parse(record.endsAt))) continue;
    const expiry = record.endsAt ?? record.startsAt;
    if (expiry && Date.parse(expiry) <= now.getTime()) continue;
    add(record, 'activity', `/events/${encodeURIComponent(record.id)}`);
  }
  for (const record of sources.knowledge)
    if (record.status === 'published' && (record.audience ?? 'general') === 'general')
      add(record, 'knowledge', `/knowledge/${encodeURIComponent(record.id)}`);
  return entries.filter(
    (entry) => config.allowedKinds.includes(entry.kind) && !config.excludedKeys.includes(entry.key),
  );
}
function hash(value: string): number {
  let result = 2166136261;
  for (const char of value) {
    result ^= char.codePointAt(0) ?? 0;
    result = Math.imul(result, 16777619);
  }
  // Final avalanche avoids correlation between adjacent content IDs.
  result ^= result >>> 16;
  result = Math.imul(result, 0x85ebca6b);
  result ^= result >>> 13;
  result = Math.imul(result, 0xc2b2ae35);
  result ^= result >>> 16;
  return (result >>> 0) + 1;
}
export function matchedInterests(candidate: Candidate, preferences: Preferences): string[] {
  return preferences.interests.filter((interest) =>
    candidate.searchText.toLocaleLowerCase().includes(interest.toLocaleLowerCase()),
  );
}
export function dailyDeck(
  candidates: Candidate[],
  preferences: Preferences,
  uid: string,
  now: Date,
): Candidate[] {
  const seed = `${uid}:${localDay(now)}:${JSON.stringify(preferences)}`;
  return candidates
    .filter((candidate) => {
      if (!preferences.kinds.includes(candidate.kind)) return false;
      if (candidate.kind === 'activity') {
        const expiry = candidate.endsAt ?? candidate.startsAt;
        if (expiry && Date.parse(expiry) <= now.getTime()) return false;
        if (
          candidate.startsAt &&
          Date.parse(candidate.startsAt) > now.getTime() + preferences.days * 86400000
        )
          return false;
      }
      return (
        preferences.explore ||
        preferences.interests.length === 0 ||
        matchedInterests(candidate, preferences).length > 0
      );
    })
    .map((candidate) => ({
      candidate,
      score:
        -Math.log(hash(`${seed}:${candidate.key}`) / 4294967297) /
        (1 + 4 * matchedInterests(candidate, preferences).length),
    }))
    .sort((a, b) => a.score - b.score || a.candidate.key.localeCompare(b.candidate.key))
    .map(({ candidate }) => candidate);
}
