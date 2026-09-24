# Information Hub Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the split announcement/consultation screens with a refined unified feed that supports official posts, public feedback, private consultations, threaded replies, supplements, likes, filters, and strict server-side privacy.

**Architecture:** Keep announcements, consultations, and proposals as separate persisted domains. Add feed metadata to the existing records, add normalized reply and like records, and assemble a viewer-aware discriminated union in `InformationService`. Replace the large page with focused feed, composer, detail, filter, and status components while preserving the old HTTP endpoints and redirecting old web routes into the new hub.

**Tech Stack:** TypeScript, React 18, React Router 6, Express 5, Zod, Vitest, Testing Library, MySQL 8 migrations, Playwright.

## Global Constraints

- Public feedback supports replies, submitter supplements, and likes.
- Private consultations are visible only to the submitter and authorized consultation staff and carry an explicit lock treatment.
- Official posts and feedback share one chronological feed; official posts use a restrained gold-brown accent.
- A consultation may change from public to private only while it has no replies; private to public requires explicit confirmation in the UI.
- Status values remain `open`, `in_progress`, `resolved`, and `closed`; announcement values remain `draft`, `published`, and `archived`.
- Proposals stay on their existing pages and routes.
- Both light and dark themes must be supported with no horizontal overflow at 360 px.
- Existing announcement and consultation API routes remain compatible.

---

### Task 1: Shared information contracts

**Files:**

- Create: `packages/contracts/src/information.ts`
- Create: `packages/contracts/src/information.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**

- Produces: `InformationVisibility`, `InformationTargetType`, `InformationReplyKind`, `InformationFeedFilter`, `InformationFeedItem`, and `InformationReply`.
- `InformationFeedItem` is a discriminated union on `kind: 'announcement' | 'consultation'` and exposes `likeCount`, `replyCount`, and `likedByViewer` without exposing private records to unauthorized viewers.

- [ ] **Step 1: Write the failing contract test**

```ts
import { describe, expect, it } from 'vitest';
import type { InformationFeedItem, InformationReply } from './information.js';

describe('information contracts', () => {
  it('represents feed cards and replies without optional discriminator fields', () => {
    const item: InformationFeedItem = {
      kind: 'consultation',
      id: 'c-1',
      title: '场地反馈',
      body: '希望延长开放时间',
      status: 'open',
      visibility: 'public',
      requesterUid: 'u-1',
      assigneeUid: null,
      dueAt: null,
      scope: { type: 'user', id: 'u-1' },
      createdAt: '2026-09-24T00:00:00.000Z',
      updatedAt: '2026-09-24T00:00:00.000Z',
      likeCount: 2,
      replyCount: 1,
      likedByViewer: true,
      canReply: true,
      canManage: false,
    };
    const reply: InformationReply = {
      id: 'r-1',
      targetType: 'consultation',
      targetId: 'c-1',
      authorUid: 'u-1',
      kind: 'supplement',
      body: '补充说明',
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
    expect([item.kind, reply.kind]).toEqual(['consultation', 'supplement']);
  });
});
```

- [ ] **Step 2: Run `npx vitest run packages/contracts/src/information.test.ts`**

Expected: FAIL because `./information.js` does not exist.

- [ ] **Step 3: Implement and export the contracts**

```ts
export type InformationVisibility = 'public' | 'private';
export type InformationTargetType = 'announcement' | 'consultation';
export type InformationReplyKind = 'reply' | 'supplement';
export type InformationFeedFilter =
  'all' | 'official' | 'public_feedback' | 'mine' | 'in_progress' | 'resolved';
```

Add exact common fields from the test, announcement fields `ownerUid`, `pinned`, and consultation fields `requesterUid`, `assigneeUid`, `dueAt`, `visibility`; export them from `index.ts`.

- [ ] **Step 4: Run `npx vitest run packages/contracts/src/information.test.ts`**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/information.ts packages/contracts/src/information.test.ts packages/contracts/src/index.ts
git commit -m "feat: add information hub contracts"
```

### Task 2: Persistence for visibility, replies, likes, and pinning

**Files:**

- Create: `database/migrations/013_information_feed.sql`
- Modify: `apps/api/src/core/database/types.ts`
- Modify: `apps/api/src/core/database/memory-store.ts`
- Modify: `apps/api/src/core/database/mysql-store.ts`
- Modify: `apps/api/src/core/database/migration-smoke.test.ts`
- Test: `apps/api/src/core/database/business-workflow-store.contract.test.ts`

**Interfaces:**

- Produces: `InformationReplyRecord`, `InformationLikeRecord`, `DevelopmentStore.informationReplies`, and `DevelopmentStore.informationLikes`.
- Extends: `AnnouncementRecord.pinned: boolean` and `ConsultationRecord.visibility: InformationVisibility`.

- [ ] **Step 1: Add failing store and migration assertions**

```ts
const reply = await store.informationReplies.create({
  targetType: 'consultation',
  targetId: consultation.id,
  authorUid: 'demo-student',
  kind: 'reply',
  body: '我也遇到了',
  status: 'visible',
  ownerUid: 'demo-student',
  scope: { type: 'public', id: '*' },
});
const like = await store.informationLikes.create({
  targetType: 'consultation',
  targetId: consultation.id,
  userUid: 'demo-student',
  status: 'active',
  ownerUid: 'demo-student',
  scope: { type: 'public', id: '*' },
});
expect(reply.targetId).toBe(consultation.id);
expect(like.userUid).toBe('demo-student');
```

Assert the migration contains `visibility`, `is_pinned`, `information_replies`, a unique like key over target/user, and indexes over target type/id.

- [ ] **Step 2: Run `npx vitest run apps/api/src/core/database/business-workflow-store.contract.test.ts apps/api/src/core/database/migration-smoke.test.ts`**

Expected: FAIL because the new repositories and migration do not exist.

- [ ] **Step 3: Add the migration and repository records**

```sql
ALTER TABLE announcements ADD COLUMN is_pinned BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE consultations ADD COLUMN visibility ENUM('public','private') NOT NULL DEFAULT 'private';
CREATE TABLE information_replies (..., target_type VARCHAR(32) NOT NULL, target_id VARCHAR(64) NOT NULL,
  author_uid VARCHAR(128) NOT NULL, reply_kind ENUM('reply','supplement') NOT NULL, body TEXT NOT NULL, ...);
CREATE TABLE information_likes (..., target_type VARCHAR(32) NOT NULL, target_id VARCHAR(64) NOT NULL,
  user_uid VARCHAR(128) NOT NULL, ..., UNIQUE KEY uq_information_like (target_type, target_id, user_uid));
```

Map `is_pinned` to `pinned`, `visibility`, `target_type`, `target_id`, `author_uid`, `reply_kind`, and `user_uid` in the MySQL definitions. Add both collections to empty/demo memory state and both store builders.

- [ ] **Step 4: Run the two database tests again**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add database/migrations/013_information_feed.sql apps/api/src/core/database/types.ts apps/api/src/core/database/memory-store.ts apps/api/src/core/database/mysql-store.ts apps/api/src/core/database/migration-smoke.test.ts apps/api/src/core/database/business-workflow-store.contract.test.ts
git commit -m "feat: persist information feed interactions"
```

### Task 3: Viewer-aware unified feed and visibility rules

**Files:**

- Modify: `apps/api/src/modules/information/service.ts`
- Modify: `apps/api/src/modules/information/router.ts`
- Modify: `apps/api/src/modules/information/router.test.ts`

**Interfaces:**

- Produces: `InformationService.listFeed(actor, filter): Promise<InformationFeedItem[]>` and `GET /information/feed?filter=...`.
- Changes: `ConsultationInput` accepts `visibility`; `ConsultationPatch` accepts `visibility` subject to transition rules.
- Security rule: private consultation records return 404 to anyone except requester or actors authorized for `information.consultation.read` or `.triage` on that record scope.

- [ ] **Step 1: Add failing API privacy and feed tests**

```ts
await request(app)
  .post('/api/development/v1/information/consultations')
  .set(studentHeaders)
  .send({ title: '公开反馈', body: '正文', visibility: 'public' })
  .expect(201);
await request(app)
  .post('/api/development/v1/information/consultations')
  .set(otherStudentHeaders)
  .send({ title: '私密咨询', body: '秘密', visibility: 'private' })
  .expect(201);
const feed = await request(app)
  .get('/api/development/v1/information/feed?filter=all')
  .set(studentHeaders)
  .expect(200);
expect(JSON.stringify(feed.body)).toContain('公开反馈');
expect(JSON.stringify(feed.body)).not.toContain('私密咨询');
```

Also assert official drafts/archives are hidden from ordinary users, pinned announcements sort first, public feedback is visible to signed-in users, and `mine`, `in_progress`, and `resolved` filters return the documented subsets.

- [ ] **Step 2: Run `npx vitest run apps/api/src/modules/information/router.test.ts`**

Expected: FAIL with 404 for `/information/feed` and strict-body rejection of `visibility`.

- [ ] **Step 3: Implement feed assembly and visibility changes**

```ts
async listFeed(actor: AuthorizationContext, filter: InformationFeedFilter) {
  const [announcements, consultations, replies, likes] = await Promise.all([...]);
  return [...visibleAnnouncements, ...visibleConsultations]
    .filter(item => feedFilterMatches(item, filter, actor.uid))
    .map(item => decorateCounts(item, replies, likes, actor))
    .sort(comparePinnedThenNewest);
}
```

Parse `filter` with Zod, authenticate the route, and extend consultation create/patch schemas with `visibility`. Reject public→private with `409 visibility_locked` after the first reply; allow private→public only from the requester.

- [ ] **Step 4: Run the information router tests**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/information/service.ts apps/api/src/modules/information/router.ts apps/api/src/modules/information/router.test.ts
git commit -m "feat: add private-safe information feed"
```

### Task 4: Replies, supplements, likes, and detail API

**Files:**

- Modify: `apps/api/src/modules/information/service.ts`
- Modify: `apps/api/src/modules/information/router.ts`
- Create: `apps/api/src/modules/information/interactions.test.ts`

**Interfaces:**

- Produces: `GET /information/feed/:kind/:id`, `GET|POST /information/feed/:kind/:id/replies`, and `PUT|DELETE /information/feed/:kind/:id/like`.
- Reply body: `{ kind: 'reply' | 'supplement', body: string }`; only the consultation requester may create `supplement`.
- Like routes are idempotent; private consultations reject likes and never expose counts.

- [ ] **Step 1: Write failing interaction tests**

```ts
await request(app)
  .post(`/api/development/v1/information/feed/consultation/${id}/replies`)
  .set(studentHeaders)
  .send({ kind: 'supplement', body: '新的时间信息' })
  .expect(201);
await request(app)
  .put(`/api/development/v1/information/feed/consultation/${id}/like`)
  .set(otherStudentHeaders)
  .expect(200);
const detail = await request(app)
  .get(`/api/development/v1/information/feed/consultation/${id}`)
  .set(studentHeaders)
  .expect(200);
expect(detail.body.data).toMatchObject({ likeCount: 1, replyCount: 1 });
```

Add denial tests for unauthorized private detail/replies, non-owner supplements, likes on private records, duplicate likes, deleting a missing like, and replies to draft/archived announcements.

- [ ] **Step 2: Run `npx vitest run apps/api/src/modules/information/interactions.test.ts`**

Expected: FAIL because the routes do not exist.

- [ ] **Step 3: Implement interaction methods and routes**

Use `getVisibleTarget(actor, kind, id)` before every read or mutation. Store public-reply scope as `{ type: 'public', id: '*' }` and private-reply scope as the consultation scope. Create likes transactionally after checking for an existing `(targetType,targetId,userUid)` record; delete the actor's matching like only.

- [ ] **Step 4: Run information module tests**

Run: `npx vitest run apps/api/src/modules/information`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/information/service.ts apps/api/src/modules/information/router.ts apps/api/src/modules/information/interactions.test.ts
git commit -m "feat: add information replies and likes"
```

### Task 5: Unified feed page structure

**Files:**

- Create: `apps/web/src/modules/information/InformationHubPage.tsx`
- Create: `apps/web/src/modules/information/InformationFeed.tsx`
- Create: `apps/web/src/modules/information/InformationFeedCard.tsx`
- Create: `apps/web/src/modules/information/InformationFilters.tsx`
- Create: `apps/web/src/modules/information/InformationStatusRail.tsx`
- Create: `apps/web/src/modules/information/InformationHubPage.test.tsx`
- Modify: `apps/web/src/modules/information/InformationLayout.tsx`
- Modify: `apps/web/src/app/router.tsx`
- Modify: `apps/web/src/app/router.test.tsx`

**Interfaces:**

- `InformationHubPage({ client, user })` owns loading, filter selection, feed refresh, and composer state.
- `InformationFeedCard` receives one `InformationFeedItem` and callbacks `onOpen` and `onToggleLike`.
- Old `/information/announcements`, `/consultations`, and `/triage` routes redirect to `/information` with compatible query filters.

- [ ] **Step 1: Write failing component and router tests**

```tsx
render(<InformationHubPage client={client} user={student} />);
expect(await screen.findByRole('heading', { name: '信息与咨询' })).toBeInTheDocument();
expect(screen.getByRole('button', { name: '提交反馈' })).toBeInTheDocument();
expect(screen.getByRole('tab', { name: '官方发布' })).toBeInTheDocument();
expect(screen.getByText('仅你与负责人可见')).toBeInTheDocument();
```

Assert announcements and public feedback are mixed by API order, private cards show a lock and omit public counts, official cards expose a gold-accent hook, and the status rail reports open/in-progress/resolved totals.

- [ ] **Step 2: Run `npx vitest run apps/web/src/modules/information/InformationHubPage.test.tsx apps/web/src/app/router.test.tsx`**

Expected: FAIL because the hub components do not exist.

- [ ] **Step 3: Build the accessible hub skeleton**

Render a compact header, primary actions, `role="tablist"` filters, a semantic feed list, and an `aside` status rail. Use text labels `官方发布`, `公开反馈`, `私密咨询`, and `仅你与负责人可见`; do not render reply/like counts on private cards.

- [ ] **Step 4: Run the component/router tests again**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/modules/information/InformationHubPage.tsx apps/web/src/modules/information/InformationFeed.tsx apps/web/src/modules/information/InformationFeedCard.tsx apps/web/src/modules/information/InformationFilters.tsx apps/web/src/modules/information/InformationStatusRail.tsx apps/web/src/modules/information/InformationHubPage.test.tsx apps/web/src/modules/information/InformationLayout.tsx apps/web/src/app/router.tsx apps/web/src/app/router.test.tsx
git commit -m "feat: add unified information hub"
```

### Task 6: Composer and detail interactions

**Files:**

- Create: `apps/web/src/modules/information/InformationComposer.tsx`
- Create: `apps/web/src/modules/information/InformationDetailDialog.tsx`
- Create: `apps/web/src/modules/information/InformationComposer.test.tsx`
- Create: `apps/web/src/modules/information/InformationDetailDialog.test.tsx`
- Modify: `apps/web/src/modules/information/InformationHubPage.tsx`

**Interfaces:**

- `InformationComposer` supports `mode: 'feedback' | 'announcement'`, visibility choice for feedback, and announcement scope/status controls for authorized users.
- `InformationDetailDialog` loads target detail and replies, posts replies/supplements, updates allowed status fields, and confirms private→public changes.

- [ ] **Step 1: Write failing interaction tests**

```tsx
await user.click(screen.getByRole('button', { name: '提交反馈' }));
await user.click(screen.getByRole('radio', { name: '公开反馈' }));
await user.type(screen.getByLabelText('标题'), '场地开放建议');
await user.type(screen.getByLabelText('内容'), '希望延长到晚上十点');
await user.click(screen.getByRole('button', { name: '发布反馈' }));
expect(request).toHaveBeenCalledWith(
  '/information/consultations',
  expect.objectContaining({
    method: 'POST',
    body: expect.stringContaining('"visibility":"public"'),
  }),
);
```

Also test private default, announcement button permission gating, reply, requester supplement, optimistic like rollback on API error, public→private disabled after replies, private→public confirmation, and focus restoration when dialogs close.

- [ ] **Step 2: Run the two new component tests**

Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement dialogs and mutations**

Use native `<dialog>` semantics through an accessible overlay with `role="dialog"`, labelled headings, Escape close, and focus restoration. Apply optimistic state only to likes; wait for server responses before adding posts, replies, supplements, or state changes.

- [ ] **Step 4: Run all web information tests**

Run: `npx vitest run apps/web/src/modules/information`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/modules/information/InformationComposer.tsx apps/web/src/modules/information/InformationDetailDialog.tsx apps/web/src/modules/information/InformationComposer.test.tsx apps/web/src/modules/information/InformationDetailDialog.test.tsx apps/web/src/modules/information/InformationHubPage.tsx
git commit -m "feat: add information compose and discussion flows"
```

### Task 7: Refined light/dark responsive visual system

**Files:**

- Create: `apps/web/src/styles/information.css`
- Create: `apps/web/src/styles/information-style-contract.test.ts`
- Modify: `apps/web/src/main.tsx`
- Modify: `tests/e2e/responsive.spec.ts`

**Interfaces:**

- Produces CSS hooks `.information-hub`, `.information-card`, `.information-card--official`, `.information-card--private`, `.information-status-rail`, `.information-dialog`.
- Uses existing theme tokens; adds local `--info-paper`, `--info-border`, `--info-gold`, and `--info-gold-soft` custom properties scoped to `.information-hub`.

- [ ] **Step 1: Add failing style contract and overflow assertions**

```ts
expect(css).toMatch(/\.information-card--official[\s\S]*var\(--info-gold\)/);
expect(css).toMatch(/@media \(max-width: 760px\)/);
expect(css).toMatch(/overflow-wrap:\s*anywhere/);
```

In Playwright, visit `/development/information` at 360×800 and assert `document.documentElement.scrollWidth <= innerWidth`, then repeat in dark mode.

- [ ] **Step 2: Run `npx vitest run apps/web/src/styles/information-style-contract.test.ts`**

Expected: FAIL because `information.css` does not exist.

- [ ] **Step 3: Implement the visual system**

Use a 1240 px constrained shell, `minmax(0, 1fr) 18rem` desktop columns, 16–18 px radii, quiet one-pixel borders, short shadows, restrained gold-brown official accents, and a single-column mobile layout. Set `min-width: 0`, `max-width: 100%`, and `overflow-wrap: anywhere` on feed/card content; stack the status rail above the feed below 760 px. Import the stylesheet after shared theme styles.

- [ ] **Step 4: Run style, web information, and responsive tests**

Run: `npx vitest run apps/web/src/styles/information-style-contract.test.ts apps/web/src/modules/information && npx playwright test tests/e2e/responsive.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/styles/information.css apps/web/src/styles/information-style-contract.test.ts apps/web/src/main.tsx tests/e2e/responsive.spec.ts
git commit -m "style: refine information hub"
```

### Task 8: End-to-end compatibility and release verification

**Files:**

- Modify: `tests/e2e/information.spec.ts`
- Modify: `docs/technical_design.md`
- Modify: `docs/handoff.md`

**Interfaces:**

- Verifies all preceding interfaces through the real UI and API.
- Documents the migration, privacy boundary, routes, and staff moderation capabilities.

- [ ] **Step 1: Replace the split-page E2E flow with the unified flow**

Cover an ordinary user creating a public feedback post and a private consultation, another user seeing only the public post, public replies/likes, requester supplements, authorized triage/status changes, official draft/publish/pin/archive, filter behavior, and direct private detail denial.

- [ ] **Step 2: Run `npx playwright test tests/e2e/information.spec.ts`**

Expected: PASS with the local API and web preview.

- [ ] **Step 3: Document operations and privacy**

Record migration `013_information_feed.sql`, explain that privacy is enforced in `InformationService` before serialization, list the feed/detail/reply/like endpoints, and state that old announcement/consultation/triage web URLs redirect into feed filters.

- [ ] **Step 4: Run full verification**

Run: `npm run check`

Expected: lint, formatting, typecheck, unit tests, operations tests, workflow tests, and production builds all pass.

- [ ] **Step 5: Review the live page**

Open `/development/information` in light and dark modes at desktop and 360 px widths. Confirm mixed cards, dialogs, private lock treatment, filters, status rail, keyboard focus, and zero overflow.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/information.spec.ts docs/technical_design.md docs/handoff.md
git commit -m "test: verify unified information hub"
```
