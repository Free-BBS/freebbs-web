// Rules shared by production transactions and isolated regression previews.
const DAY_MS = 86400000;
const MAX_FOOD_MS = 30 * DAY_MS;
const FORTUNE_GOOD = 70;
const FORTUNE_GOLD = 90;
const MAGNETIC_CHECKIN_START = '2026-09-16';
function checkinReward(streak, score, day) {
  const count = Math.max(1, Math.floor(Number(streak) || 1));
  const active = day >= MAGNETIC_CHECKIN_START;
  return {
    rewardElectrons: active ? 0 : Math.min(count, 5),
    rewardMagnetic: active ? Math.min(count, 3) : 0,
    luckBonus: active && Number(score) >= FORTUNE_GOOD ? 1 : 0,
  };
}
const beijingDay = (ms = Date.now()) => new Date(ms + 8 * 3600000).toISOString().slice(0, 10);
const luckExpiry = (ms) => Date.parse(`${beijingDay(ms)}T00:00:00+08:00`) + 7 * DAY_MS;
const effectiveFortune = (score, until, now) =>
  score == null ? null : Math.max(Number(score), until > now ? FORTUNE_GOOD : 0);
function feedUntil(current, now) {
  const next = Math.max(Number(current) || 0, now) + DAY_MS;
  if (next - now > MAX_FOOD_MS) throw new Error('剩余饱腹容量不足一天，请稍后再喂；小鱼未消耗');
  return next;
}
module.exports = {
  MAGNETIC_CHECKIN_START,
  checkinReward,
  DAY_MS,
  MAX_FOOD_MS,
  FORTUNE_GOOD,
  FORTUNE_GOLD,
  beijingDay,
  luckExpiry,
  effectiveFortune,
  feedUntil,
};
