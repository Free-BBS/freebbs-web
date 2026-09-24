import { expect, it } from 'vitest';

import { createMemoryStore } from './memory-store.js';

const scope = { type: 'public', id: '*' };

it('does not let an escaped transaction store mutate committed root state', async () => {
  const root = createMemoryStore({ seed: false });
  let committedId = '';
  const escaped = await root.transaction(async (transactionStore) => {
    const committed = await transactionStore.announcements.create({
      title: 'committed inside transaction',
      body: 'must remain in root',
      status: 'published',
      ownerUid: 'demo-admin',
      scope,
    });
    committedId = committed.id;
    return transactionStore;
  });

  await escaped.announcements.create({
    title: 'created after commit',
    body: 'must remain detached',
    status: 'published',
    ownerUid: 'demo-admin',
    scope,
  });
  await escaped.announcements.update(committedId, { status: 'archived' });
  await escaped.announcements.delete(committedId);

  expect(await root.announcements.list()).toMatchObject([
    { id: committedId, title: 'committed inside transaction', status: 'published' },
  ]);
});
