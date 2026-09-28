// Earned items are not shop products. Call only inside the account's transaction.
const FISHBONE_MASTER = Object.freeze({
  key: 'plate_fishbone_master',
  assetKey: 'plate_fishbone_master',
  name: '鱼骨达人',
  class: 'nameplate',
  source: 'achievement',
  description: '累计购买 10 个坚硬的鱼骨头，并拥有至少 3 个黄金鱼骨、10 个普通鱼骨后自动获得。',
  desc: '十次把不起眼的小东西带回家，草地终于记住了你的脚步。某天，那里还亮起了一点金色。',
  image: '/assets/icons/plate_fishbone_master.svg',
  isGift: false,
});

async function unlockFishboneMaster(tx, userId) {
  const state = await tx.readExtras(userId);
  if (
    state.assets?.[FISHBONE_MASTER.key] > 0 ||
    !(state.assets?.golden_fishbone >= 3) ||
    !(state.assets?.ordinary_fishbone >= 10)
  )
    return [];
  if ((await tx.purchaseCount(userId, 'fishbone')) < 10) return [];
  await tx.deliver(userId, FISHBONE_MASTER);
  await tx.notifyAchievement(userId, FISHBONE_MASTER);
  return [FISHBONE_MASTER.key];
}

const CIRCUIT_MASTER = Object.freeze({
  key: 'plate_circuit_master',
  assetKey: 'plate_circuit_master',
  name: '电路达人',
  class: 'nameplate',
  source: 'achievement',
  description: '通过电路闯关模式全部当前开放关卡后获得，以服务端当前题目版本的有效通关记录为准',
  desc: '从第一条连线到最后一束波形，让每一次探索在回路中相遇',
  image: '/assets/icons/plate_circuit_master.svg',
  isGift: false,
});

module.exports = { FISHBONE_MASTER, CIRCUIT_MASTER, unlockFishboneMaster };
