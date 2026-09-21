const fs = require('node:fs');
const path = require('node:path');
const { FISHBONE_MASTER, unlockFishboneMaster } = require('./economy-achievements');
const {
  beijingDay,
  effectiveFortune,
  feedUntil,
  luckExpiry,
  MAGNETIC_CHECKIN_START,
} = require('./economy-policy');

const COSMETICS = Object.freeze({
  frame_orbit: { slot: 'frame', name: '环流轨道' },
  frame_aurora: { slot: 'frame', name: '极光回路' },
  plate_maxwell: { slot: 'nameplate', name: '麦克斯韦亲传' },
  plate_observer: { slot: 'nameplate', name: 'BBS见习观察员' },
  [FISHBONE_MASTER.key]: { slot: 'nameplate', name: FISHBONE_MASTER.name, source: 'achievement' },
  card_blueprint: { slot: 'card', name: '未完成的蓝图' },
  card_twilight: { slot: 'card', name: '暮色实验室' },
});
const WOOL_FEEDS = 5;
const WOOL_ELECTRIC_REWARD = 2;
const MAX_WOOL = 4294967295;
function ranchWool(state = {}) {
  const count = (value, max) =>
    Number.isSafeInteger(Number(value)) && Number(value) >= 0 && Number(value) <= max
      ? Number(value)
      : 0;
  return {
    feedProgress: count(state.feedProgress, WOOL_FEEDS - 1),
    woolReady: count(state.woolReady, MAX_WOOL),
    woolStored: count(state.woolStored, MAX_WOOL),
  };
}
function shearWindow(state, now) {
  const day = beijingDay(now);
  const shearedToday = state.lastShearDay === day;
  return {
    shearedToday,
    nextShearAtMs: shearedToday ? Date.parse(`${day}T00:00:00+08:00`) + 86400000 : 0,
  };
}
class ProfileExtrasError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
function cosmeticsFrom(state = {}) {
  return Object.fromEntries(
    Object.entries(state.equipped || {}).filter(([slot, key]) => COSMETICS[key]?.slot === slot),
  );
}
function publicPresentation(state = {}, now = Date.now()) {
  return {
    cosmetics: cosmeticsFrom(state),
    ranch: {
      adopted: Boolean(state.adopted || state.assets?.max_pet > 0),
      bones: Math.max(0, Number(state.assets?.ordinary_fishbone || 0)),
      hardBones: Math.max(0, Number(state.assets?.fishbone || 0)),
      goldenBones: Math.max(0, Number(state.assets?.golden_fishbone || 0)),
      fedUntilMs: Number(state.fedUntilMs || 0),
      serverNowMs: now,
      hungry: Number(state.fedUntilMs || 0) <= now,
      ...ranchWool(state),
      ...shearWindow(state, now),
    },
  };
}
function createProfileExtras(store, { now = Date.now } = {}) {
  return {
    async publicProfile(id) {
      return publicPresentation(await store.readExtras(id), now());
    },
    async ownState(id) {
      let state = await store.readExtras(id);
      // Reconcile accounts that met the condition before this achievement was introduced.
      // Recheck under the same account lock; concurrent reads cannot award twice.
      if (
        !(state.assets?.[FISHBONE_MASTER.key] > 0) &&
        state.assets?.golden_fishbone >= 3 &&
        state.assets?.ordinary_fishbone >= 10 &&
        (await store.readCounts(id)).fishbone >= 10
      ) {
        await store.transaction(async (tx) => {
          await tx.lockUser(id);
          await unlockFishboneMaster(tx, id);
        });
        state = await store.readExtras(id);
      }
      return {
        ...publicPresentation(state, now()),
        luckUntilMs: Number(state.luckUntilMs || 0),
        owned: Object.keys(COSMETICS).filter((key) => Number(state.assets?.[key] || 0) > 0),
        fish: Math.max(0, Number(state.assets?.fish || 0)),
        rubberRod: Number(state.assets?.rubber_rod || 0) > 0,
      };
    },
    async act({ userId, action, slot, itemKey = '', requestKey }) {
      if (
        !['equip', 'adopt', 'feed', 'shear', 'rub_wool', 'use_bag', 'convert'].includes(action) ||
        !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(requestKey || '')
      )
        throw new ProfileExtrasError('请刷新后重试');
      if (
        action === 'equip' &&
        (!['frame', 'nameplate', 'card'].includes(slot) ||
          (itemKey !== '' && COSMETICS[itemKey]?.slot !== slot))
      )
        throw new ProfileExtrasError('不支持的装扮');
      if (
        action === 'convert' &&
        !['electric_to_magnetic', 'magnetic_to_electric'].includes(itemKey)
      )
        throw new ProfileExtrasError('无效转换方向');
      const fingerprint = JSON.stringify({
        action,
        ...(['equip', 'convert'].includes(action) ? { slot: slot || '', itemKey } : {}),
      });
      return store.transaction(async (tx) => {
        // Same user lock as purchases; fish decrement is guarded against concurrent gifts.
        await tx.lockUser(userId);
        const previous = await tx.findProfileAction(userId, requestKey);
        if (previous) {
          if (previous.fingerprint !== fingerprint)
            throw new ProfileExtrasError('操作编号已使用', 409);
          return { ...previous.result, replayed: true };
        }
        const state = await tx.readExtras(userId);
        Object.assign(state, ranchWool(state));
        let result = { action };
        if (action === 'equip') {
          if (itemKey && !(state.assets[itemKey] > 0))
            throw new ProfileExtrasError(
              COSMETICS[itemKey]?.source === 'achievement'
                ? '尚未解锁这个成就铭牌'
                : '请先在商城购买这件装扮',
              403,
            );
          state.equipped = { ...cosmeticsFrom(state), [slot]: itemKey };
          result.itemKey = itemKey;
        } else if (action === 'adopt') {
          if (!(state.assets.max_pet > 0)) throw new ProfileExtrasError('请先在商店购买 Max');
          state.adopted = true;
        } else if (action === 'convert') {
          if (!(await tx.consumeAsset(userId, 'differential_converter')))
            throw new ProfileExtrasError('请先购买微分器：4 电元或 4 磁元');
          const from = itemKey === 'electric_to_magnetic' ? 'electric' : 'magnetic';
          if (!(await tx.debit(userId, 10, from, false)))
            throw new ProfileExtrasError('转换本金不足，需要 10 个');
          await tx.credit(userId, 10, from === 'electric' ? 'magnetic' : 'electric');
          result.direction = itemKey;
        } else if (action === 'use_bag') {
          if (Number(state.luckUntilMs) > now())
            throw new ProfileExtrasError('福袋仍在生效，未消耗新的福袋');
          if (!(await tx.consumeAsset(userId, 'fortune_bag')))
            throw new ProfileExtrasError('仓库中没有福袋');
          state.luckUntilMs = luckExpiry(now());
          await tx.boostFortune(userId, beijingDay(now()));
          result.luckUntilMs = state.luckUntilMs;
        } else if (action === 'shear' || action === 'rub_wool') {
          if (!state.adopted && !(state.assets.max_pet > 0))
            throw new ProfileExtrasError('请先在商店购买 Max');
          if (action === 'shear') {
            const shearDay = beijingDay(now());
            if (state.lastShearDay === shearDay)
              throw new ProfileExtrasError('Max 被薅秃了，明天再来吧。');
            if (state.woolReady < 1)
              throw new ProfileExtrasError('还没有待剪的羊毛，每成功喂食 5 条小鱼长出 1 份');
            if (state.woolStored >= MAX_WOOL)
              throw new ProfileExtrasError('已剪羊毛数量达到上限，请先摩擦发电', 409);
            state.woolReady -= 1;
            state.woolStored += 1;
            state.lastShearDay = shearDay;
          } else {
            if (!(state.assets.rubber_rod > 0))
              throw new ProfileExtrasError('请先在商城购买橡胶棒（7 磁元，可重复使用）');
            if (state.woolStored < 1) throw new ProfileExtrasError('请先剪取 1 份羊毛');
            state.woolStored -= 1;
            result.electricReward = WOOL_ELECTRIC_REWARD;
            result.balance = await tx.creditWool(userId, {
              sourceKey: `ranch-wool:${requestKey}`,
              title: '羊毛摩擦发电',
              reason: '用橡胶棒摩擦 1 份羊毛，收入 2 电元；橡胶棒可重复使用',
            });
          }
          result = { ...result, wool: 1, ...ranchWool(state), ...shearWindow(state, now()) };
        } else {
          if (!state.adopted && !(state.assets.max_pet > 0))
            throw new ProfileExtrasError('请先在商店购买 Max');
          if (!(state.assets.fish > 0))
            throw new ProfileExtrasError('仓库里没有鱼了，可以先去商城看看');
          const fedAt = now();
          const day = beijingDay(fedAt);
          const fortune = effectiveFortune(
            await tx.readFortune(userId, day),
            state.luckUntilMs,
            fedAt,
          );
          if (fortune === null) throw new ProfileExtrasError('请先在今日运势中抽取今天的运势');
          let nextFeed;
          try {
            nextFeed = feedUntil(state.fedUntilMs, fedAt);
          } catch (error) {
            throw new ProfileExtrasError(error.message);
          }
          if (state.feedProgress === WOOL_FEEDS - 1 && state.woolReady >= MAX_WOOL)
            throw new ProfileExtrasError('待剪羊毛数量达到上限，请先剪取', 409);
          // A daily receipt is independent of ordinary feeds and current bone holdings.
          // The account lock, delivery and receipt share one transaction.
          const goldenDayKey = `golden-bone:${day}`;
          const golden =
            Number(fortune) >= 90 && !(await tx.findProfileAction(userId, goldenDayKey));
          if (!(await tx.consumeFish(userId)))
            throw new ProfileExtrasError('鱼的数量已变化，请刷新');
          const key = golden ? 'golden_fishbone' : 'ordinary_fishbone';
          await tx.deliver(userId, {
            assetKey: key,
            name: golden ? '黄金鱼骨' : '普通鱼骨',
            class: 'decoration',
            image: '/assets/icons/fishbone.svg',
            isGift: !golden,
          });
          if (golden)
            await tx.recordProfileAction(userId, goldenDayKey, 'daily-golden-bone', {
              action: 'golden_bone',
              day,
            });
          state.lastFeedDay = day;
          state.adopted = true;
          state.fedUntilMs = nextFeed;
          state.feedProgress += 1;
          const woolGrown = state.feedProgress === WOOL_FEEDS ? 1 : 0;
          if (woolGrown) {
            state.feedProgress = 0;
            state.woolReady += 1;
          }
          result = { ...result, bone: key, woolGrown, ...ranchWool(state) };
        }
        await tx.saveExtras(userId, state);
        if (action === 'feed') result.unlocked = await unlockFishboneMaster(tx, userId);
        await tx.recordProfileAction(userId, requestKey, fingerprint, result);
        return result;
      });
    },
  };
}
const parseJson = (value) => (typeof value === 'string' ? JSON.parse(value) : value || {});
async function readExtras(connection, id) {
  const [rows] = await connection.execute(
    'SELECT equipped_json, adopted, last_feed_day FROM user_profile_extras WHERE user_id = ?',
    [id],
  );
  const [assets] = await connection.execute(
    'SELECT asset_key, quantity FROM user_assets WHERE user_id = ? AND quantity > 0',
    [id],
  );
  const [policyRows] = await connection.execute(
    'SELECT fed_until_ms, luck_until_ms FROM economy_account_state WHERE user_id = ?',
    [id],
  );
  const [woolRows] = await connection.execute(
    'SELECT feed_progress, wool_ready, wool_stored, last_shear_day FROM user_ranch_wool WHERE user_id = ?',
    [id],
  );
  return {
    feedProgress: Number(woolRows[0]?.feed_progress || 0),
    woolReady: Number(woolRows[0]?.wool_ready || 0),
    woolStored: Number(woolRows[0]?.wool_stored || 0),
    lastShearDay: woolRows[0]?.last_shear_day || '',
    fedUntilMs: Number(policyRows[0]?.fed_until_ms || 0),
    luckUntilMs: Number(policyRows[0]?.luck_until_ms || 0),
    equipped: parseJson(rows[0]?.equipped_json),
    adopted: Boolean(rows[0]?.adopted),
    lastFeedDay: rows[0]?.last_feed_day || '',
    assets: Object.fromEntries(assets.map((a) => [a.asset_key, Number(a.quantity)])),
  };
}
async function readPublicCosmetics(connection, ids) {
  if (!ids.length) return {};
  const [rows] = await connection.execute(
    `SELECT user_id, equipped_json FROM user_profile_extras
     WHERE user_id IN (${ids.map(() => '?').join(',')})`,
    ids,
  );
  return Object.fromEntries(
    rows.map((row) => [row.user_id, cosmeticsFrom({ equipped: parseJson(row.equipped_json) })]),
  );
}
function mysqlProfileMethods(connection) {
  return {
    readExtras: (id) => readExtras(connection, id),
    async findProfileAction(id, key) {
      const [rows] = await connection.execute(
        'SELECT fingerprint, result_json FROM user_profile_actions WHERE user_id = ? AND request_key = ?',
        [id, key],
      );
      return rows[0]
        ? { fingerprint: rows[0].fingerprint, result: parseJson(rows[0].result_json) }
        : null;
    },
    async readFortune(id, day) {
      const [rows] = await connection.execute(
        'SELECT score FROM user_fortunes WHERE user_id = ? AND fortune_date = ?',
        [id, day],
      );
      return rows[0] ? Number(rows[0].score) : null;
    },
    async consumeFish(id) {
      const [result] = await connection.execute(
        "UPDATE user_assets SET quantity = quantity - 1 WHERE user_id = ? AND asset_key = 'fish' AND quantity > 0",
        [id],
      );
      return result.affectedRows === 1;
    },
    async consumeAsset(id, key) {
      const [result] = await connection.execute(
        'UPDATE user_assets SET quantity = quantity - 1 WHERE user_id = ? AND asset_key = ? AND quantity > 0',
        [id, key],
      );
      return result.affectedRows === 1;
    },
    async credit(id, amount, currency) {
      const col = currency === 'electric' ? 'electrons' : 'manetrons';
      await connection.execute(`UPDATE users SET ${col} = ${col} + ? WHERE id = ?`, [amount, id]);
    },
    async creditWool(id, { sourceKey, title, reason }) {
      // Keep the real balance trigger as the sole creator of ledger snapshots.
      // The account row lock serializes this watermark, credit and annotation.
      const [before] = await connection.execute(
        'SELECT COALESCE(MAX(id), 0) AS last_id FROM wallet_ledger WHERE user_id = ?',
        [id],
      );
      const [credited] = await connection.execute(
        'UPDATE users SET electrons = electrons + ? WHERE id = ? AND electrons >= 0 AND electrons <= ?',
        [WOOL_ELECTRIC_REWARD, id, Number.MAX_SAFE_INTEGER - WOOL_ELECTRIC_REWARD],
      );
      if (credited.affectedRows !== 1)
        throw new ProfileExtrasError('账户余额超出安全范围，本次未消耗羊毛', 409);
      const [annotated] = await connection.execute(
        'UPDATE wallet_ledger SET source_key = ?, title = ?, reason = ? WHERE user_id = ? AND id > ? ORDER BY id DESC LIMIT 1',
        [sourceKey, title, reason, id, before[0].last_id],
      );
      if (annotated.affectedRows !== 1) throw new Error('Wool credit ledger entry missing');
      const [rows] = await connection.execute(
        'SELECT CAST(electrons AS CHAR) AS electric, CAST(manetrons AS CHAR) AS magnetic, CAST(heat AS CHAR) AS heat FROM users WHERE id = ?',
        [id],
      );
      return rows[0];
    },
    async boostFortune(id, day) {
      await connection.execute(
        'INSERT INTO user_fortunes (user_id, fortune_date, score) VALUES (?, ?, 70) ON DUPLICATE KEY UPDATE score = GREATEST(score, 70)',
        [id, day],
      );
      const { awardMagnetic } = require('./economy-rewards');
      const [checkins] = await connection.execute(
        'SELECT user_id FROM user_checkins WHERE user_id = ? AND checkin_date = ?',
        [id, day],
      );
      if (checkins.length && day >= MAGNETIC_CHECKIN_START)
        await awardMagnetic(connection, id, `luck:${day}`, 1, day);
    },
    async saveExtras(id, state) {
      await connection.execute(
        'INSERT INTO economy_account_state (user_id, fed_until_ms, luck_until_ms) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE fed_until_ms = VALUES(fed_until_ms), luck_until_ms = VALUES(luck_until_ms)',
        [id, state.fedUntilMs || 0, state.luckUntilMs || 0],
      );
      await connection.execute(
        `INSERT INTO user_profile_extras (user_id, equipped_json, adopted, last_feed_day, revision)
         VALUES (?, ?, ?, ?, 1) ON DUPLICATE KEY UPDATE equipped_json = VALUES(equipped_json),
         adopted = VALUES(adopted), last_feed_day = VALUES(last_feed_day), revision = revision + 1`,
        [id, JSON.stringify(cosmeticsFrom(state)), state.adopted ? 1 : 0, state.lastFeedDay || ''],
      );
      const wool = ranchWool(state);
      await connection.execute(
        `INSERT INTO user_ranch_wool (user_id, feed_progress, wool_ready, wool_stored, last_shear_day)
         VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE feed_progress = VALUES(feed_progress),
         wool_ready = VALUES(wool_ready), wool_stored = VALUES(wool_stored),
         last_shear_day = VALUES(last_shear_day)`,
        [id, wool.feedProgress, wool.woolReady, wool.woolStored, state.lastShearDay || ''],
      );
    },
    async recordProfileAction(id, key, fingerprint, result) {
      await connection.execute(
        'INSERT INTO user_profile_actions (user_id, request_key, fingerprint, result_json) VALUES (?, ?, ?, ?)',
        [id, key, fingerprint, JSON.stringify(result)],
      );
    },
  };
}
async function ensureProfileExtrasTables(pool) {
  for (const migration of ['038_profile_extras.sql', '044_ranch_wool.sql']) {
    const sql = fs.readFileSync(path.join(__dirname, '../database/migrations', migration), 'utf8');
    for (const statement of sql
      .replace(/^\s*--.*$/gm, '')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean))
      await pool.query(statement);
  }
}
module.exports = {
  COSMETICS,
  WOOL_FEEDS,
  WOOL_ELECTRIC_REWARD,
  ProfileExtrasError,
  beijingDay,
  cosmeticsFrom,
  publicPresentation,
  createProfileExtras,
  readExtras,
  readPublicCosmetics,
  mysqlProfileMethods,
  ensureProfileExtrasTables,
};
