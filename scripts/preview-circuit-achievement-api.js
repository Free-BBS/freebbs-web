// Loopback memory-only fixture: three completed demo levels, no production scores.
const { circuitChallengeCatalog } = require('../backend/circuit-challenge-catalog');
const { readChallengeInput, starterDocument } = require('../backend/circuit-challenges');
const { CIRCUIT_MASTER } = require('../backend/economy-achievements');

function createCircuitAchievementPreviewApi() {
  const challenges = circuitChallengeCatalog()
    .slice(0, 3)
    .map((seed, index) => {
      const data = readChallengeInput({
        title: seed.title,
        description: seed.description,
        document: seed.document,
        tolerance: seed.tolerance,
        rewardElectric: 0,
      });
      const input = data.document.components.find((item) => item.id === 'V_IN').params;
      return {
        id: index + 1,
        title: `模拟已通关 · ${index + 1}`,
        description: '本地演示：已有完整通关记录，再次进入时补发铭牌，不对应真实成绩',
        revision: 1,
        tolerance: data.tolerance,
        rewardElectric: 0,
        isActive: true,
        completed: true,
        locked: false,
        input,
        document: starterDocument(data.document),
        target: data.target,
      };
    });
  const progress = { cleared: 3, completedCount: 3, total: 3, nextChallengeId: null };
  return async ({ route, method, store }) => {
    if (!route.startsWith('/api/circuit-challenges')) return null;
    const result = (body, status = 200) => ({ body, status });
    if (method !== 'GET')
      return result({ message: '本地仅演示旧通关记录补发，不提交真实成绩' }, 403);
    if (route === '/api/circuit-challenges') {
      const unlocked = await store.transaction(async (tx) => {
        if (store.account().assets[CIRCUIT_MASTER.key]) return [];
        await tx.deliver(1, CIRCUIT_MASTER);
        await tx.notifyAchievement(1, CIRCUIT_MASTER);
        return [CIRCUIT_MASTER.key];
      });
      return result({ challenges, progress, unlocked, canManage: false });
    }
    if (route.endsWith('/leaderboard')) return result({ leaderboard: [], me: null });
    const challenge = challenges.find((item) => route === `/api/circuit-challenges/${item.id}`);
    return challenge
      ? result({ challenge, progress, canManage: false })
      : result({ message: '没有该演示关卡' }, 404);
  };
}
module.exports = { createCircuitAchievementPreviewApi };
