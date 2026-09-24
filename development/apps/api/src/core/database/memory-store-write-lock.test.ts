import { expect, it } from 'vitest';

import { createMemoryStore } from './memory-store.js';

const scope = { type: 'public', id: '*' };

it('serializes an ordinary write with an open transaction without losing either write', async () => {
  const store = createMemoryStore({ seed: false });
  let releaseTransaction: () => void = () => {};
  let markTransactionReady: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    releaseTransaction = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    markTransactionReady = resolve;
  });
  const transaction = store.transaction(async (transactionStore) => {
    await transactionStore.announcements.create({
      title: 'inside transaction',
      body: 'must survive',
      status: 'published',
      ownerUid: 'demo-admin',
      scope,
    });
    markTransactionReady();
    await gate;
  });
  await ready;

  const ordinaryWrite = store.announcements.create({
    title: 'outside transaction',
    body: 'must also survive',
    status: 'published',
    ownerUid: 'demo-admin',
    scope,
  });
  await Promise.resolve();
  releaseTransaction();
  await Promise.all([transaction, ordinaryWrite]);

  expect((await store.announcements.list()).map(({ title }) => title).sort()).toEqual([
    'inside transaction',
    'outside transaction',
  ]);
});
