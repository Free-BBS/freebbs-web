// Isolated transaction model for unit tests and local previews; never connects to a database.
const { MAGNETIC_CHECKIN_START } = require('../../backend/economy-policy');

function createEconomyMemoryStore(
  accounts = [{ id: 1 }],
  { recordLedger = false, now = Date.now } = {},
) {
  let state = new Map(
    accounts.map((a) => [
      a.id,
      {
        electric: 10000,
        magnetic: 10000,
        heat: 0,
        assets: {},
        counts: {},
        expiresAtMs: 0,
        goldenNameExpiresAtMs: 0,
        goldenNameUses: [],
        purchases: [],
        equipped: {},
        adopted: false,
        lastFeedDay: '',
        fedUntilMs: 0,
        feedProgress: 0,
        woolReady: 0,
        woolStored: 0,
        lastShearDay: '',
        luckUntilMs: 0,
        rewards: {},
        profileActions: [],
        fortunes: {},
        ...a,
      },
    ]),
  );
  let queue = Promise.resolve();
  const laser = (id) => ({
    owned: (state.get(id)?.assets.laser || 0) > 0,
    expiresAtMs: state.get(id)?.expiresAtMs || 0,
  });
  const goldenName = (id) => ({
    expiresAtMs: state.get(id)?.goldenNameExpiresAtMs || 0,
  });
  const store = {
    failAt: '',
    account: (id = 1) => state.get(id),
    recordLedger(
      id,
      before,
      { sourceKey, title = '本地资产演示', reason = '仅限本地模拟账户' } = {},
    ) {
      const account = state.get(id);
      if (
        !recordLedger ||
        (account.electric === before.electric && account.magnetic === before.magnetic)
      )
        return;
      account.ledger ||= [];
      account.ledger.push({
        id: (account.ledger.at(-1)?.id || 0) + 1,
        electric_before: String(before.electric),
        electric_after: String(account.electric),
        magnetic_before: String(before.magnetic),
        magnetic_after: String(account.magnetic),
        source_key: sourceKey || null,
        title,
        reason,
        created_at: new Date(now()).toISOString(),
      });
    },
    async readExtras(id) {
      return structuredClone(state.get(id) || {});
    },
    async readPublicCosmetics(ids) {
      return Object.fromEntries(ids.map((id) => [id, { ...state.get(id)?.equipped }]));
    },
    async readCounts(id) {
      return { ...state.get(id)?.counts };
    },
    async readLaser(id) {
      return laser(id);
    },
    async readGoldenName(id) {
      return goldenName(id);
    },
    async readPublicLasers(ids) {
      return Object.fromEntries(
        ids.filter((id) => laser(id).owned).map((id) => [id, laser(id).expiresAtMs]),
      );
    },
    async readPublicGoldenNames(ids) {
      return Object.fromEntries(ids.map((id) => [id, goldenName(id).expiresAtMs]));
    },
    async readCollectibles(id, keys) {
      return keys.filter((key) => (state.get(id)?.assets[key] || 0) > 0);
    },
    async transaction(work) {
      const previous = queue;
      let release;
      queue = new Promise((resolve) => {
        release = resolve;
      });
      await previous;
      const snapshot = structuredClone(state);
      function fail(stage) {
        if (store.failAt === stage) throw new Error(`simulated ${stage}`);
      }
      try {
        const result = await work({
          readExtras: store.readExtras,
          async findProfileAction(id, key) {
            return state.get(id).profileActions.find((row) => row.key === key);
          },
          async readFortune(id, day) {
            return state.get(id).fortunes[day] ?? null;
          },
          async consumeFish(id) {
            fail('consume');
            if (!(state.get(id).assets.fish > 0)) return false;
            state.get(id).assets.fish -= 1;
            return true;
          },
          async consumeAsset(id, key) {
            fail('consume');
            if (!(state.get(id).assets[key] > 0)) return false;
            state.get(id).assets[key] -= 1;
            return true;
          },
          async credit(id, amount, currency, details) {
            fail('credit');
            const before = { ...state.get(id) };
            state.get(id)[currency] += amount;
            fail('ledger');
            store.recordLedger(id, before, details);
          },
          async creditWool(id, details) {
            fail('credit');
            const account = state.get(id);
            const before = { ...account };
            if (!Number.isSafeInteger(account.electric + 2) || account.electric < 0)
              throw new Error('Balance limit');
            account.electric += 2;
            fail('ledger');
            store.recordLedger(id, before, details);
            return {
              electric: String(account.electric),
              magnetic: String(account.magnetic),
              heat: String(account.heat),
            };
          },
          async consumeSaleAssets(id, key, quantity) {
            fail('consume');
            if (!(state.get(id).assets[key] >= quantity)) return false;
            state.get(id).assets[key] -= quantity;
            return true;
          },
          async saleAssetQuantity(id, key) {
            return String(state.get(id).assets[key] || 0);
          },
          async creditBoneSale(id, amount, details) {
            fail('credit');
            const account = state.get(id);
            const before = { ...account };
            if (!Number.isSafeInteger(account.magnetic + amount)) throw new Error('Balance limit');
            account.magnetic += amount;
            fail('ledger');
            store.recordLedger(id, before, details);
            return {
              electric: String(account.electric),
              magnetic: String(account.magnetic),
              heat: String(account.heat),
            };
          },
          async boostFortune(id, day) {
            const a = state.get(id);
            const before = { ...a };
            a.fortunes[day] = Math.max(a.fortunes[day] || 0, 70);
            if (day >= MAGNETIC_CHECKIN_START && a.checkins?.[day] && !a.rewards[`luck:${day}`]) {
              a.magnetic += 1;
              a.rewards[`luck:${day}`] = 1;
              a.checkins[day].rewardMagnetic = (a.checkins[day].rewardMagnetic || 0) + 1;
              fail('ledger');
              store.recordLedger(id, before, {
                sourceKey: `reward:luck:${day}`,
                title: '签到好运奖励',
                reason: `${day} 已签到，使用福袋达到好运条件，补发 1 磁元（每天最多一次）`,
              });
            }
          },
          async saveExtras(id, value) {
            fail('extras');
            Object.assign(state.get(id), {
              equipped: value.equipped,
              adopted: value.adopted,
              lastFeedDay: value.lastFeedDay,
              fedUntilMs: value.fedUntilMs,
              luckUntilMs: value.luckUntilMs,
              feedProgress: value.feedProgress,
              woolReady: value.woolReady,
              woolStored: value.woolStored,
              lastShearDay: value.lastShearDay,
            });
          },
          async recordProfileAction(id, key, fingerprint, receipt) {
            fail('profile_record');
            state.get(id).profileActions.push({ key, fingerprint, result: receipt });
          },
          async lockUser(id) {
            if (!state.has(id)) throw new Error('unknown account');
          },
          async findPurchase(id, key) {
            return state.get(id).purchases.find((r) => r.key === key);
          },
          async findGoldenNameUse(id, key) {
            return state.get(id).goldenNameUses.find((row) => row.key === key);
          },
          async purchaseCount(id, key) {
            return state.get(id).counts[key] || 0;
          },
          async readLaser(id) {
            return laser(id);
          },
          async readGoldenName(id) {
            return goldenName(id);
          },
          async setLaser(id, expiry) {
            fail('lease');
            state.get(id).expiresAtMs = expiry;
          },
          async setGoldenName(id, expiry) {
            fail('golden_name');
            state.get(id).goldenNameExpiresAtMs = expiry;
          },
          async debit(id, amount, currency, spending = true, details = {}) {
            fail(`debit_${currency}`);
            const account = state.get(id);
            const before = { ...account };
            if (account[currency] < amount) return false;
            account[currency] -= amount;
            if (spending) account.heat += amount;
            fail('ledger');
            store.recordLedger(id, before, details);
            return true;
          },
          async deliver(id, item) {
            fail('deliver');
            const account = state.get(id);
            account.assets[item.assetKey] = (account.assets[item.assetKey] || 0) + 1;
          },
          async record(id, key, counterKey, fingerprint, receipt) {
            fail('record');
            state.get(id).purchases.push({ key, counterKey, fingerprint, result: receipt });
          },
          async recordGoldenNameUse(id, key, fingerprint, receipt) {
            fail('golden_name_record');
            state.get(id).goldenNameUses.push({ key, fingerprint, result: receipt });
          },
          async advance(id, key, count) {
            fail('advance');
            state.get(id).counts[key] = count;
          },
        });
        fail('commit');
        return result;
      } catch (error) {
        state = snapshot;
        throw error;
      } finally {
        release();
      }
    },
  };
  return store;
}
module.exports = { createEconomyMemoryStore };
