import type {
  AtlasAchievement,
  GrowthActivity,
  LearningAchievementEvidence,
} from '@freebbs-development/contracts';
import { growthAchievements } from './achievement-catalog.js';

export const MAP_BADGES = [
  ['first_arrival', '初来乍到', '首次点亮活动'],
  ['builder', '建设者', '点亮三个活动'],
  ['season_complete', '季节全勤', '点亮一个季节的全部有效活动'],
  ['erudite', '博闻强识', '点亮五个活动'],
  ['pioneer_call', '开拓先声', '收藏地图诞生纪念'],
  ['autumn_trilogy', '秋日三章', '完成秋季地图收藏'],
  ['winter_starlight', '冬夜星河', '点亮学生节的星光'],
  ['four_seasons_traveler', '四时旅人', '收藏四季地图'],
  ['arts_debut', '弦歌初鸣', '点亮 FREE 之夜'],
  ['sports_debut', '逐风初跃', '收藏体育活动纪念'],
  ['liaison_debut', '星桥初连', '点亮名企微体验'],
  ['rights_debut', '守望初光', '收藏权益活动纪念'],
] as const;

interface CatalogInput {
  verified: GrowthActivity[];
  learning: LearningAchievementEvidence | null;
  posts: number;
  festival: number;
  organized: number;
  recaps: number;
  organizedRecaps: number;
  mapAvailable: boolean;
  mapLandmarks: number;
  mapNight: boolean;
  mapPioneer: boolean;
}

export function atlasCatalog(input: CatalogInput): AtlasAchievement[] {
  const badges: AtlasAchievement[] = growthAchievements(input.verified).map((badge) => ({
    id: badge.id,
    title: badge.title,
    description: badge.description.replaceAll('已结束且未取消的活动报名记录', '已核验活动参与记录'),
    family: 'campus',
    icon: badge.icon ?? 'sprout',
    unlocked: badge.unlocked,
    progress: badge.progress,
    target: badge.target,
    available: true,
    source: '核验打卡 · FreeBBS Map 活动点亮',
  }));
  function add(
    id: string,
    title: string,
    description: string,
    family: AtlasAchievement['family'],
    icon: string,
    progress: number,
    target: number,
    source: string,
    available = true,
    awarded = false,
  ) {
    badges.push({
      id,
      title,
      description,
      family,
      icon,
      progress,
      target,
      source,
      available,
      unlocked: awarded || (available && progress >= target),
    });
  }
  const learning = input.learning;
  for (const days of [1, 7, 30])
    add(
      `learning-checkin-${days}`,
      ({ 1: '今日开篇', 7: '日积月累', 30: '三十日拾光' } as Record<number, string>)[days],
      `完成 ${days} 个不同日期的平台每日签到，学习端与发展端共用，不要求连续。`,
      'daily',
      'calendar',
      learning?.checkinDays ?? 0,
      days,
      '平台每日签到，学习端与发展端共用',
      !!learning,
    );
  add(
    'learning-circuit-first',
    '回路初亮',
    '通过一个当前题目版本有效的电路关卡。',
    'learning',
    'spark',
    learning?.circuitCleared ?? 0,
    1,
    '学习端电路实验室',
    !!learning,
  );
  add(
    'learning-circuit-5',
    '波形追光者',
    '通过五个当前题目版本有效的电路关卡。',
    'learning',
    'orbit',
    learning?.circuitCleared ?? 0,
    5,
    '学习端电路实验室',
    !!learning,
  );
  add(
    'plate_circuit_master',
    '电路达人',
    '通过全部当前开放电路关卡；已获得的原有铭牌继续有效。',
    'learning',
    'trophy',
    learning?.circuitCleared ?? 0,
    Math.max(1, learning?.circuitTotal ?? 0),
    '学习端电路实验室与成就铭牌',
    !!learning &&
      (learning.circuitTotal > 0 || learning.ownedAchievementIds.includes('plate_circuit_master')),
    learning?.ownedAchievementIds.includes('plate_circuit_master'),
  );
  add(
    'creation-first-post',
    '初次发声',
    '在無界广场发布一篇有效的日常或许愿原创内容。',
    'creation',
    'spark',
    input.posts,
    1,
    '無界广场有效原创内容',
  );
  add(
    'creation-three-posts',
    '灵感来信',
    '在無界广场发布三篇有效原创内容。',
    'creation',
    'trail',
    input.posts,
    3,
    '無界广场有效原创内容',
  );
  add(
    'creation-stage',
    '舞台来信',
    '一份电子系春晚投稿通过审核，无需选择公开展示。',
    'creation',
    'arts',
    input.festival,
    1,
    '审核通过的本人春晚投稿',
  );
  add(
    'plate_fishbone_master',
    '鱼骨达人',
    '已获得学习端鱼骨达人铭牌；保留原有收藏条件与权益。',
    'creation',
    'trophy',
    learning?.ownedAchievementIds.includes('plate_fishbone_master') ? 1 : 0,
    1,
    '学习端已有成就铭牌',
    !!learning,
  );
  for (const count of [1, 3, 10])
    add(
      `contribution-events-${count}`,
      ({ 1: '相遇发起人', 3: '校园召集人', 10: '相遇收藏家' } as Record<number, string>)[count],
      `本人发起并发布 ${count} 场有效活动，草稿与审核中活动不计入。`,
      'contribution',
      'flag',
      input.organized,
      count,
      '网页本人已发布活动',
    );
  add(
    'contribution-recap',
    '幕后拾光',
    '为一场已结束的活动留下有效复盘。',
    'contribution',
    'calendar',
    input.recaps,
    1,
    '已结束活动的本人复盘',
  );
  add(
    'cross-learning-campus',
    '知行相遇',
    '通过一个当前有效电路关卡，并核验参加一场校园活动。',
    'learning',
    'compass',
    Number((learning?.circuitCleared ?? 0) > 0) + Number(input.verified.length > 0),
    2,
    '学习端有效电路通关 · 核验活动参与',
    !!learning,
  );
  add(
    'cross-stage-expression',
    '舞台与纸页',
    '本人春晚投稿通过审核，并在無界广场发布有效原创日常或许愿内容。',
    'creation',
    'arts',
    Number(input.festival > 0) + Number(input.posts > 0),
    2,
    '本人审核通过的春晚投稿 · 無界广场有效原创内容',
  );
  add(
    'cross-organizer-recap',
    '相遇有回响',
    '本人发起并发布一场有效活动，在该活动结束后留下有效复盘。',
    'contribution',
    'trail',
    input.organizedRecaps,
    1,
    '本人已发布活动 · 同一活动结束后的本人复盘',
  );
  add(
    'map-landmarks-3',
    '地标寻踪',
    '真实点亮三个不同的普通地标；同一地标跨时段重复点亮只计一次。',
    'map',
    'compass',
    input.mapLandmarks,
    3,
    'FreeBBS Map 真实普通地标点亮',
    input.mapAvailable,
  );
  add(
    'map-night',
    '夜色拾光',
    '在北京时间 20:00 至次日 06:00 前真实点亮一个地图点位。',
    'map',
    'moon',
    Number(input.mapNight),
    1,
    'FreeBBS Map 真实点亮时间（北京时间）',
    input.mapAvailable,
  );
  add(
    'pioneer_call',
    '开端',
    '真实点亮名为「开端」的地图特殊纪念点。',
    'map',
    'flag',
    Number(input.mapPioneer),
    1,
    'FreeBBS Map 开端特殊纪念点',
    input.mapAvailable,
  );
  return badges;
}

/** Metadata only: retired badges can be restored from existing ownership, never new rules. */
export function archivedMapCatalog(owned: ReadonlySet<string>): AtlasAchievement[] {
  return MAP_BADGES.filter(([id]) => id !== 'pioneer_call' && owned.has(id)).map(
    ([id, title, description]) => {
      const target = id === 'builder' ? 3 : id === 'erudite' ? 5 : 1;
      return {
        id,
        title,
        description: `${description}。已获得的往期地图收藏继续保留。`,
        family: 'map',
        icon: id.includes('season') ? 'calendar' : 'compass',
        progress: target,
        target,
        source: 'FreeBBS Map 往期已获得徽章',
        available: true,
        unlocked: true,
      };
    },
  );
}
