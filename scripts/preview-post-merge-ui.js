// Isolated UI acceptance environment. No production API or database connections.
const { createEconomyPreview } = require('./preview-economy');
const { beijingDay } = require('../backend/economy-policy');

const { server, store } = createEconomyPreview({
  showcase: true,
  extraPages: {
    '/workbench': 'workbench.html',
    '/aichat': 'aichat.html',
    '/world': 'world.html',
  },
});
const account = store.account();
account.assets.laser = 1;
account.expiresAtMs = Date.now() + 86400000;
const yesterday = beijingDay(Date.now() - 86400000);
account.fortunes[beijingDay()] = 1;
account.checkins[yesterday] = {
  date: yesterday,
  streak: 1,
  rewardElectrons: yesterday < '2026-09-16' ? 1 : 0,
  rewardMagnetic: yesterday >= '2026-09-16' ? 1 : 0,
  fortuneScore: 1,
};
server.listen(Number(process.env.UI_PREVIEW_PORT || 3116), '127.0.0.1', () => {
  console.log(`UI preview: http://127.0.0.1:${server.address().port}/discussion`);
  console.log('Memory-only demo. Check-in starts at day 2; Max chat and campus services are not connected.');
});
