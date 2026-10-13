import { resolve, isAbsolute } from 'node:path';
import type {
  AchievementAtlas,
  AtlasAchievement,
  GrowthActivity,
  MapEvidence,
  LearningAchievementEvidence,
  CollaborationSpace,
} from '@freebbs-development/contracts';
import { departmentById, MINIAPP_ACHIEVEMENT_IDS } from '@freebbs-development/contracts';
import type { DevelopmentStore } from '../../core/database/types.js';
import { featureStorage } from '../../core/database/feature-storage.js';
import { HttpError } from '../../core/errors/http-error.js';
import { readMapConnection } from '../map-bridge/router.js';
import { resolveMapTokenDigest } from '../map-bridge/credentials.js';
import { readActivityWorkspace } from '../events/workspace-storage.js';
import { archivedMapCatalog, atlasCatalog } from './atlas-catalog.js';
import { GROWTH_DOMAINS, growthAchievements } from './achievement-catalog.js';
import type { ImportedExperience } from '../connectors/router.js';

export type LearningAchievementProvider = (uid: string) => Promise<LearningAchievementEvidence>;
interface AtlasState {
  id: string;
  awards: Record<string, { earnedAt: string; source: string }>;
  showcaseIds: Array<string | null>;
  revision: number;
}
export interface AtlasOptions {
  store: DevelopmentStore;
  uploadDirectory?: string;
  nodeEnvironment?: string;
  environment?: NodeJS.ProcessEnv;
  learningAchievementProvider?: LearningAchievementProvider;
  now?: () => Date;
}
function domainFor(organization?: string | null) {
  return GROWTH_DOMAINS.find((item) => item.organization === organization)?.key ?? 'other';
}

export function createAtlasService(options: AtlasOptions) {
  const directory = options.uploadDirectory ?? resolve('.data/collection-uploads');
  const state = featureStorage<AtlasState>(directory, 'achievement-atlas');
  const now = options.now ?? (() => new Date());
  function requireStorage() {
    if (
      options.nodeEnvironment === 'production' &&
      (!options.uploadDirectory || !isAbsolute(options.uploadDirectory))
    )
      throw new HttpError(503, 'storage_not_configured', '成长档案存储尚未配置');
  }
  async function evaluate(uid: string) {
    const at = now();
    const validDate = (value: string | null | undefined) =>
      !!value && Number.isFinite(Date.parse(value)) && Date.parse(value) <= at.getTime();
    const { store } = options;
    const [registrations, allActivities, forms, responses, spaces, mapRecords, posts, submissions] =
      await Promise.all([
        store.activityRegistrations.list({ query: uid }),
        store.activities.list(),
        store.collectionForms.list(),
        store.collectionResponses.list({ query: uid }),
        featureStorage<CollaborationSpace>(directory, 'collaboration').list(),
        featureStorage<MapEvidence>(directory, 'map-evidence').list(),
        store.communityPosts.list(),
        store.festivalSubmissions.list(),
      ]);
    const registrationEvents: GrowthActivity[] = [];
    let organized = 0;
    let recaps = 0;
    let organizedRecaps = 0;
    const registeredIds = new Set(
      registrations
        .filter((r) => r.participantUid === uid && r.status === 'registered')
        .map((r) => r.activityId),
    );
    for (const activity of allActivities) {
      if (!['published', 'finished', 'archived'].includes(activity.status)) continue;
      if (activity.ownerUid === uid) organized++;
      const workspace = await readActivityWorkspace(directory, 'development_activity', activity.id);
      const endsAt = workspace.schedule?.endsAt ?? activity.endsAt ?? null;
      const ended =
        workspace.schedule?.finished ||
        ['finished', 'archived'].includes(activity.status) ||
        validDate(endsAt);
      if (!ended) continue;
      if (registeredIds.has(activity.id))
        registrationEvents.push({
          id: activity.id,
          title: activity.title,
          endsAt,
          domain: domainFor(activity.organizationId),
          status: 'finished',
          source: 'registration',
        });
      const ownRecaps = workspace.recaps.filter(
        (r) => r.authorUid === uid && r.blocks.length > 0,
      ).length;
      recaps += ownRecaps;
      if (activity.ownerUid === uid && ownRecaps > 0) organizedRecaps++;
    }
    const respondedIds = new Set(
      responses
        .filter((r) => r.respondentUid === uid && r.status === 'submitted')
        .map((r) => r.formId),
    );
    for (const form of forms) {
      if (form.status === 'draft') continue;
      if (form.ownerUid === uid) organized++;
      const workspace = await readActivityWorkspace(directory, 'native_collection', form.id);
      const endsAt = workspace.schedule?.endsAt ?? null;
      if (!(workspace.schedule?.finished || validDate(endsAt))) continue;
      if (respondedIds.has(form.id))
        registrationEvents.push({
          id: `collection:${form.id}`,
          title: form.title,
          endsAt,
          domain: domainFor(form.organizationId),
          status: 'finished',
          source: 'registration',
        });
      const ownRecaps = workspace.recaps.filter(
        (r) => r.authorUid === uid && r.blocks.length > 0,
      ).length;
      recaps += ownRecaps;
      if (form.ownerUid === uid && ownRecaps > 0) organizedRecaps++;
    }
    const verifiedEvents = new Map<string, GrowthActivity>();
    for (const space of spaces.filter((s) => s.kind === 'attendance' && s.status !== 'draft')) {
      for (const entry of space.entries.filter(
        (e) => e.uid === uid && e.reviewStatus === 'approved' && validDate(e.updatedAt),
      )) {
        const id = `attendance:${space.id}:${entry.id}`;
        verifiedEvents.set(id, {
          id,
          title: space.title,
          endsAt: entry.updatedAt,
          domain: space.teamId
            ? 'sports'
            : domainFor(departmentById(space.departmentId ?? '')?.organizationId),
          status: 'verified',
          source: 'verified_attendance',
        });
      }
    }
    const maps = mapRecords.filter((r) => r.uid === uid && validDate(r.occurredAt));
    const mapBadgeIds = new Set(maps.flatMap((r) => r.mapBadgeIds ?? []));
    const explorations = new Set<string>();
    const landmarks = new Set<string>();
    for (const item of maps) {
      const key = item.activityId ?? `map:${item.periodId}:${item.landmarkId}`;
      if (item.type !== 'activity') {
        explorations.add(`${item.periodId}:${item.landmarkId}`);
        if (item.type === 'landmark') landmarks.add(item.landmarkId);
        continue;
      }
      verifiedEvents.set(key, {
        id: key,
        title: item.title,
        endsAt: item.occurredAt,
        domain: item.domain,
        status: 'verified',
        source: 'map',
      });
    }
    let learning: LearningAchievementEvidence | null = null;
    let learningStatus: AchievementAtlas['sources']['learning'] = 'not_configured';
    if (options.learningAchievementProvider) {
      try {
        const evidence = await options.learningAchievementProvider(uid);
        if (
          ![evidence.checkinDays, evidence.circuitCleared, evidence.circuitTotal].every(
            (n) => Number.isSafeInteger(n) && n >= 0,
          ) ||
          evidence.circuitCleared > evidence.circuitTotal ||
          !Array.isArray(evidence.ownedAchievementIds)
        )
          throw new Error('Invalid learning evidence');
        learning = evidence;
        learningStatus = 'ready';
      } catch {
        learningStatus = 'unavailable';
      }
    }
    const environment = options.environment ?? process.env;
    const configured =
      Boolean(resolveMapTokenDigest(environment)) &&
      ((options.nodeEnvironment ?? environment.NODE_ENV) !== 'production' ||
        Boolean(options.uploadDirectory && isAbsolute(options.uploadDirectory)));
    const connection = await readMapConnection(directory, uid, configured);
    const achievements = atlasCatalog({
      verified: [...verifiedEvents.values()],
      learning,
      posts: posts.filter(
        (p) =>
          p.ownerUid === uid && p.status === 'active' && (p.kind === 'daily' || p.kind === 'wish'),
      ).length,
      festival: submissions.filter((s) => s.ownerUid === uid && s.status === 'approved').length,
      organized,
      recaps,
      organizedRecaps,
      mapAvailable: configured || maps.length > 0,
      mapLandmarks: landmarks.size,
      mapNight: maps.some((item) => {
        const hour = (new Date(item.occurredAt).getUTCHours() + 8) % 24;
        return hour >= 20 || hour < 6;
      }),
      mapPioneer: maps.some((item) => item.type === 'special' && item.title.trim() === '开端'),
    });
    const legacyMap = (
      await featureStorage<ImportedExperience>(directory, 'map-experiences').list()
    )
      .filter((r) => r.uid === uid && validDate(r.occurredAt))
      .map((r): GrowthActivity => ({
        id: r.id,
        title: r.title,
        endsAt: r.occurredAt,
        domain: r.domain,
        status: 'verified',
        source: 'map',
      }));
    // Only genuine older Map imports can seed missing legacy awards. Registrations
    // are counted separately and cannot create a new verified-participation award.
    const legacyAwards = growthAchievements(legacyMap).filter((b) => b.unlocked);
    return {
      achievements,
      archivedAchievements: archivedMapCatalog(mapBadgeIds),
      legacyAwards,
      connection,
      counts: {
        registration: registrationEvents.length,
        verifiedActivity: verifiedEvents.size,
        mapExploration: explorations.size,
      },
      learningStatus,
      at: at.toISOString(),
    };
  }
  function applyAwards(achievements: AtlasAchievement[], current: AtlasState) {
    return achievements.map((badge) => {
      const award = current.awards[badge.id];
      return award
        ? {
            ...badge,
            unlocked: true,
            earnedAt: award.earnedAt,
            source: badge.family === 'daily' ? badge.source : award.source,
          }
        : badge;
    });
  }
  async function result(
    uid: string,
    ids?: Array<string | null>,
    revision?: number,
  ): Promise<AchievementAtlas> {
    requireStorage();
    const data = await evaluate(uid);
    const saved = await state.change(uid, (previous) => {
      const current = previous ?? { id: uid, awards: {}, showcaseIds: [], revision: 0 };
      if (!previous)
        for (const badge of data.legacyAwards)
          current.awards[badge.id] = {
            earnedAt: data.at,
            source: '旧版成长档案 · Map 核验记录',
          };
      for (const badge of [...data.achievements, ...data.archivedAchievements])
        if (badge.unlocked && !current.awards[badge.id])
          current.awards[badge.id] = { earnedAt: data.at, source: badge.source };
      if (ids !== undefined) {
        if (revision !== current.revision)
          throw new HttpError(
            409,
            'showcase_revision_conflict',
            '陈列已在另一端更新，请刷新后重试',
          );
        const actual = ids.filter((id): id is string => id !== null);
        if (
          ids.length > 6 ||
          new Set(actual).size !== actual.length ||
          actual.some(
            (id) =>
              !current.awards[id] ||
              ![
                ...data.achievements,
                ...archivedMapCatalog(new Set(Object.keys(current.awards))),
              ].some((badge) => badge.id === id),
          )
        )
          throw new HttpError(400, 'invalid_showcase', '只能陈列至多六枚已获得的不同徽章');
        current.showcaseIds = ids;
        current.revision++;
      }
      return { record: current, result: current };
    });
    const achievements = applyAwards(data.achievements, saved);
    const archivedAchievements = applyAwards(
      archivedMapCatalog(new Set(Object.keys(saved.awards))),
      saved,
    );
    const ownedMetadata = new Map(
      [...achievements, ...archivedAchievements].map((badge) => [badge.id, badge]),
    );
    return {
      version: 1,
      uid,
      achievements,
      archivedAchievements,
      showcaseAchievements: saved.showcaseIds
        .filter((id): id is string => id !== null)
        .map((id) => ownedMetadata.get(id))
        .filter((badge): badge is AtlasAchievement => !!badge && badge.unlocked),
      showcaseIds: saved.showcaseIds,
      showcaseRevision: saved.revision,
      map: data.connection,
      counts: data.counts,
      sources: { learning: data.learningStatus },
      updatedAt: data.at,
    };
  }
  function miniappAtlas(atlas: AchievementAtlas): AchievementAtlas {
    const badges = new Map(atlas.achievements.map((badge) => [badge.id, badge]));
    return {
      ...atlas,
      achievements: MINIAPP_ACHIEVEMENT_IDS.map((id) => badges.get(id)).filter(
        (badge): badge is AtlasAchievement => !!badge,
      ),
    };
  }
  return {
    getAtlas: (uid: string) => result(uid),
    saveShowcase: (uid: string, ids: Array<string | null>, revision: number) =>
      result(uid, ids, revision),
    getMiniappAtlas: async (uid: string) => miniappAtlas(await result(uid)),
    saveMiniappShowcase: async (uid: string, ids: Array<string | null>, revision: number) =>
      miniappAtlas(await result(uid, ids, revision)),
  };
}
