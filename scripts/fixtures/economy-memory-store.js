// Isolated transaction model for unit tests and local previews; never connects to a database.
const { MAGNETIC_CHECKIN_START } = require('../../backend/economy-policy');
function createEconomyMemoryStore(accounts = [{ id: 1 }]) {
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
        purchases: [],
        equipped: {},
        adopted: false,
        lastFeedDay: '',
        fedUntilMs: 0,
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
  const store = {
    failAt: '',
    account: (id = 1) => state.get(id),
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
    async readPublicLasers(ids) {
      return Object.fromEntries(
        ids.filter((id) => laser(id).owned).map((id) => [id, laser(id).expiresAtMs]),
      );
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
          async credit(id, amount, currency) {
            fail('credit');
            state.get(id)[currency] += amount;
          },
          async boostFortune(id, day) {
            const a = state.get(id);
            a.fortunes[day] = Math.max(a.fortunes[day] || 0, 70);
            if (day >= MAGNETIC_CHECKIN_START && a.checkins?.[day] && !a.rewards['luck:' + day]) {
              a.magnetic += 1;
              a.rewards['luck:' + day] = 1;
              a.checkins[day].rewardMagnetic = (a.checkins[day].rewardMagnetic || 0) + 1;
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
          async purchaseCount(id, key) {
            return state.get(id).counts[key] || 0;
          },
          async readLaser(id) {
            return laser(id);
          },
          async setLaser(id, expiry) {
            fail('lease');
            state.get(id).expiresAtMs = expiry;
          },
          async debit(id, amount, currency, spending = true) {
            fail(`debit_${currency}`);
            const account = state.get(id);
            if (account[currency] < amount) return false;
            account[currency] -= amount;
            if (spending) account.heat += amount;
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
