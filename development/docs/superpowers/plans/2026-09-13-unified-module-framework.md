# Unified Module Framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing development platform into a concise, readable, maintainable multi-module product, align it with the main site's learning-area visual language, and replace liaison resources with a reviewed real-problem bounty community.

**Architecture:** Keep the React/Vite SPA, Express API, shared contracts, authorization engine, and dual memory/MySQL store. Add a small shared presentation layer, split only complex modules into nested routes, extend existing records additively, and introduce liaison problem aggregates as new repositories. Preserve the current permission model and status-transition pattern; finance behavior and super-admin governance remain unchanged.

**Tech Stack:** React 18, React Router 6, TypeScript, Express 5, Zod, MySQL 8, Vitest, Testing Library, Playwright, CSS custom properties.

## Global Constraints

- Preserve `/development` as the SPA basename and `/development/api/v1` as the deployed API prefix.
- Keep `/development/dashboard` as the authenticated landing route, but do not add a dashboard item to sidebar or mobile navigation.
- Keep administration visible and routable only for `platform.super_admin`; denied `/admin` navigation returns to `/dashboard`.
- Do not broaden finance visibility or workflow. Only adopt shared layout components and styles there.
- Use additive migrations only. Do not drop or rename existing tables or columns.
- Keep public liaison responses free of internal contact notes and review-only metadata.
- Continue supporting memory and MySQL stores with identical repository behavior.
- Every mutation must preserve authorization, exact-scope checks, transition validation, audit events, and stable error envelopes.
- Run focused tests after each step and the complete `npm run check` before integration.
- Use Node `>=20.19.0`; on this workstation use the discovered Node 24 binary when the system Node is too old.

---

### Task 1: Establish the shared presentation layer

**Files:**

- Create: `apps/web/src/components/ModulePageHeader.tsx`
- Create: `apps/web/src/components/FilterBar.tsx`
- Create: `apps/web/src/components/AsyncState.tsx`
- Create: `apps/web/src/components/ResponsiveRecordList.tsx`
- Create: `apps/web/src/components/EditorDrawer.tsx`
- Create: `apps/web/src/components/ConfirmDialog.tsx`
- Create: `apps/web/src/components/PermissionActions.tsx`
- Create: `apps/web/src/components/DetailSection.tsx`
- Modify: `apps/web/src/components/StatusBadge.tsx`
- Modify: `apps/web/src/components/Components.test.tsx`
- Modify: `apps/web/src/styles/tokens.css`
- Modify: `apps/web/src/styles/theme.css`
- Modify: `apps/web/src/styles/shell.css`
- Modify: `apps/web/src/styles/components.css`
- Modify: `apps/web/src/app/AppShell.tsx`
- Test: `apps/web/src/app/AppShell.test.tsx`
- Test: `apps/web/src/styles/theme-contract.test.ts`

- [ ] **Step 1: Add failing component-contract tests**

Cover accessible heading hierarchy, optional English kicker, filter labels, loading/empty/error states, responsive list semantics, drawer/dialog labelling, permission-hidden actions, and detail sections. Add a shell assertion that navigation contains no `工作台` link while the brand still links to `/dashboard`.

```tsx
render(
  <ModulePageHeader
    kicker="KNOWLEDGE BASE"
    title="经验库"
    description="把经验写清楚，也让后来者找得到。"
    actions={<button>新建条目</button>}
  />,
);
expect(screen.getByRole('heading', { level: 2, name: '经验库' })).toBeInTheDocument();
expect(screen.getByText('KNOWLEDGE BASE')).toBeInTheDocument();
```

- [ ] **Step 2: Prove the tests fail for missing components**

Run: `npm test -- apps/web/src/components/Components.test.tsx apps/web/src/app/AppShell.test.tsx`

Expected: FAIL because the new shared components do not exist and the old shell/component contracts differ.

- [ ] **Step 3: Implement the component APIs**

Keep the primitives data-agnostic. `ResponsiveRecordList<T>` owns loading/empty/error/success presentation but receives record rendering; `PermissionActions` returns `null` when denied; drawers and dialogs restore focus on close.

```ts
export interface ResponsiveRecordListProps<T> {
  ariaLabel: string;
  records: readonly T[];
  state: 'loading' | 'ready' | 'error';
  errorMessage?: string;
  emptyTitle: string;
  emptyDescription?: string;
  getKey: (record: T) => string;
  renderRecord: (record: T) => ReactNode;
}
```

- [ ] **Step 4: Align visual tokens with the learning-area style**

Use shallow gray-white surfaces, dark teal primary actions, low-saturation borders, restrained shadows, 12–18 px radii, compact typography, and one-column mobile flow. Retain dark mode but keep both themes within the same semantic token contract. Do not add decorative backgrounds or animation-heavy interactions.

- [ ] **Step 5: Run focused verification**

Run: `npm test -- apps/web/src/components/Components.test.tsx apps/web/src/app/AppShell.test.tsx apps/web/src/styles/theme-contract.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components apps/web/src/styles apps/web/src/app/AppShell.tsx apps/web/src/app/AppShell.test.tsx
git commit -m "feat: establish shared module presentation layer"
```

---

### Task 2: Add nested module routing without breaking legacy URLs

**Files:**

- Modify: `apps/web/src/app/router.tsx`
- Modify: `apps/web/src/app/AppShell.tsx`
- Modify: `apps/web/src/app/module-manifests.ts`
- Modify: `apps/web/src/app/AppShell.test.tsx`
- Create: `apps/web/src/app/router.test.tsx`
- Create: `apps/web/src/modules/information/InformationLayout.tsx`
- Create: `apps/web/src/modules/information/AnnouncementsPage.tsx`
- Create: `apps/web/src/modules/information/ConsultationsPage.tsx`
- Create: `apps/web/src/modules/information/TriagePage.tsx`
- Create: `apps/web/src/modules/sports/SportsTeamDetailPage.tsx`
- Create: `apps/web/src/modules/liaison/ProblemDetailPage.tsx`

- [ ] **Step 1: Add failing route tests**

Assert these route contracts:

```text
/information                    -> /information/announcements
/information/announcements      -> announcements
/information/consultations      -> consultations
/information/triage             -> triage
/information/proposals          -> proposal pool
/information/proposals/:id      -> proposal detail
/events/:activityId             -> activity detail
/sports/:teamId                 -> team detail
/liaison/problems/:problemId    -> problem community
/clubs                          -> /interest-groups
unknown or unauthorized /admin  -> /dashboard
```

- [ ] **Step 2: Prove the route test fails**

Run: `npm test -- apps/web/src/app/router.test.tsx apps/web/src/app/AppShell.test.tsx`

Expected: FAIL because information, sports, and liaison detail routes are not registered.

- [ ] **Step 3: Register route adapters and stable redirects**

Use route wrapper components to obtain auth and params. Keep the top-level manifest route at `/information` so the shell marks every nested information path active. Change the liaison description to describe real-problem collaboration rather than a contact directory.

```tsx
{ path: 'information', element: <Navigate to="/information/announcements" replace /> },
{ path: 'information/announcements', element: <AnnouncementsRoute /> },
{ path: 'information/consultations', element: <ConsultationsRoute /> },
{ path: 'information/triage', element: <TriageRoute /> },
{ path: 'information/proposals', element: <ProposalPoolRoute /> },
{ path: 'information/proposals/:proposalId', element: <ProposalDetailRoute /> },
{ path: 'liaison/problems/:problemId', element: <ProblemDetailRoute /> },
{ path: 'sports/:teamId', element: <SportsTeamDetailRoute /> },
```

- [ ] **Step 4: Make navigation active for nested routes**

Remove `end` from module links or compute active state from the manifest prefix, while ensuring `/information` cannot match unrelated paths. Keep mobile navigation keyboard accessible.

- [ ] **Step 5: Run focused verification**

Run: `npm test -- apps/web/src/app/router.test.tsx apps/web/src/app/AppShell.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app apps/web/src/modules/information apps/web/src/modules/sports/SportsTeamDetailPage.tsx apps/web/src/modules/liaison/ProblemDetailPage.tsx
git commit -m "feat: add focused module routes"
```

---

### Task 3: Extend existing content records additively

**Files:**

- Create: `database/migrations/008_module_readability_fields.sql`
- Modify: `database/seeds/001_demo.sql`
- Modify: `apps/api/src/core/database/types.ts`
- Modify: `apps/api/src/core/database/memory-store.ts`
- Modify: `apps/api/src/core/database/mysql-store.ts`
- Modify: `apps/api/src/core/database/platform-content-schema.test.ts`
- Create: `apps/api/src/core/database/module-readability-migration.test.ts`
- Modify: `apps/api/src/modules/knowledge/router.ts`
- Modify: `apps/api/src/modules/knowledge/service.ts`
- Modify: `apps/api/src/modules/information/router.ts`
- Modify: `apps/api/src/modules/information/service.ts`
- Modify: `apps/api/src/modules/information/proposal-service.ts`
- Modify: `apps/api/src/modules/clubs/router.ts`
- Modify: `apps/api/src/modules/clubs/service.ts`
- Modify: `apps/api/src/modules/events/router.ts`
- Modify: `apps/api/src/modules/events/service.ts`
- Modify: `apps/api/src/modules/sports/router.ts`
- Modify: `apps/api/src/modules/sports/service.ts`

- [ ] **Step 1: Add failing migration and adapter tests**

Assert the following optional or defaulted fields round-trip in memory and MySQL mappings:

```ts
interface KnowledgeEntryRecord {
  category: string;
  tags: string[];
  summary: string;
  maintainedAt: string | null;
  maintainerUid: string | null;
}
interface ConsultationRecord {
  dueAt: string | null;
}
interface ProposalRecord {
  dueAt: string | null;
}
interface ClubRecord {
  category: string;
  contactName: string;
  publicContact: string;
}
interface ActivityRecord {
  registrationDeadline: string | null;
  capacity: number | null;
  contact: string;
}
interface SportsTeamRecord {
  season: string;
  trainingSchedule: string;
}
```

Persist tags as JSON in MySQL and as `string[]` in application types. Reject invalid timestamps, non-positive capacity, overlong strings, and malformed tags at the router boundary.

- [ ] **Step 2: Prove the new contract fails**

Run: `npm test -- apps/api/src/core/database/platform-content-schema.test.ts apps/api/src/core/database/module-readability-migration.test.ts`

Expected: FAIL because migration 008 and mappings do not exist.

- [ ] **Step 3: Add migration 008 and deterministic demo values**

All new columns must be additive. Use non-null defaults only where legacy records need them; nullable timestamps remain nullable.

```sql
ALTER TABLE knowledge_entries
  ADD COLUMN category VARCHAR(80) NOT NULL DEFAULT 'general',
  ADD COLUMN tags JSON NOT NULL,
  ADD COLUMN summary VARCHAR(500) NOT NULL DEFAULT '',
  ADD COLUMN maintained_at DATETIME(3) NULL,
  ADD COLUMN maintainer_uid VARCHAR(128) NULL;
```

Apply equivalent additions to consultations, proposals, clubs, activities, and sports teams. Update demo seed statements with readable October-preview data.

- [ ] **Step 4: Update store codecs and service/router schemas**

Keep existing clients compatible by making create-schema additions optional with defaults. PATCH schemas allow fields but never status. List query schemas expose search and the filters needed by their module pages.

- [ ] **Step 5: Run API and storage verification**

Run: `npm test -- apps/api/src/core/database apps/api/src/modules/knowledge apps/api/src/modules/information apps/api/src/modules/clubs apps/api/src/modules/events apps/api/src/modules/sports`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add database apps/api/src/core/database apps/api/src/modules/knowledge apps/api/src/modules/information apps/api/src/modules/clubs apps/api/src/modules/events apps/api/src/modules/sports
git commit -m "feat: add module readability fields"
```

---

### Task 4: Rebuild experience library and interest groups on the shared shell

**Files:**

- Modify: `apps/web/src/modules/knowledge/KnowledgePage.tsx`
- Modify: `apps/web/src/modules/knowledge/KnowledgePage.test.tsx`
- Modify: `apps/web/src/modules/knowledge/KnowledgeAudience.test.tsx`
- Modify: `apps/web/src/modules/clubs/ClubsPage.tsx`
- Modify: `apps/web/src/modules/clubs/ClubsPage.test.tsx`
- Modify: `apps/web/src/modules/clubs/InterestGroupsPage.test.tsx`
- Modify: `tests/e2e/knowledge.spec.ts`
- Modify: `tests/e2e/clubs.spec.ts`

- [ ] **Step 1: Write failing user-flow tests**

For knowledge, assert General is visible to every authenticated student, the social-organization area is absent for ordinary students, search matches title/summary/tag/body, and maintainers can edit metadata through a drawer. For interest groups, assert public cards show category/contact/related activity, anyone can browse activities, and liaison-authorized users alone see maintenance actions.

- [ ] **Step 2: Prove the flows fail**

Run: `npm test -- apps/web/src/modules/knowledge apps/web/src/modules/clubs`

Expected: FAIL against the existing large single-page forms and missing metadata.

- [ ] **Step 3: Implement the two concise module pages**

Compose `ModulePageHeader`, `FilterBar`, `ResponsiveRecordList`, `StatusBadge`, and `EditorDrawer`. Keep one primary action per page. Put secondary metadata in a compact second line and avoid dashboard-like metric cards.

- [ ] **Step 4: Preserve authorization-driven visibility**

Do not infer maintenance capability from labels or organization names. Use the existing policy/tag context and server 403 responses. Never render the social-organization filter for users who cannot read that audience.

- [ ] **Step 5: Run component and E2E verification**

Run: `npm test -- apps/web/src/modules/knowledge apps/web/src/modules/clubs`

Run after local stack is available: `npx playwright test tests/e2e/knowledge.spec.ts tests/e2e/clubs.spec.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/modules/knowledge apps/web/src/modules/clubs tests/e2e/knowledge.spec.ts tests/e2e/clubs.spec.ts
git commit -m "feat: simplify knowledge and interest group modules"
```

---

### Task 5: Split information and consultation into focused views

**Files:**

- Modify: `apps/web/src/modules/information/InformationLayout.tsx`
- Modify: `apps/web/src/modules/information/AnnouncementsPage.tsx`
- Modify: `apps/web/src/modules/information/ConsultationsPage.tsx`
- Modify: `apps/web/src/modules/information/TriagePage.tsx`
- Modify: `apps/web/src/modules/information/ProposalPool.tsx`
- Create: `apps/web/src/modules/information/ProposalDetailPage.tsx`
- Replace or reduce: `apps/web/src/modules/information/InformationPage.tsx`
- Modify: `apps/web/src/modules/information/InformationPage.test.tsx`
- Modify: `apps/web/src/modules/information/ProposalPool.test.tsx`
- Create: `apps/web/src/modules/information/ProposalDetailPage.test.tsx`
- Modify: `tests/e2e/information.spec.ts`

- [ ] **Step 1: Add failing route-level feature tests**

Assert public announcements, student consultation submission, owner-only consultation visibility, rights-development triage with assignee/due date, public proposal progress, and maintenance-only internal notes. The proposal detail response must never expose `internalNote` to ordinary students.

- [ ] **Step 2: Prove the tests fail**

Run: `npm test -- apps/web/src/modules/information`

Expected: FAIL because all views are currently combined and proposal details are not routed.

- [ ] **Step 3: Implement compact subnavigation and pages**

Use URL routes as the source of truth instead of local tab state. Hide the triage link unless the user has consultation triage or proposal management capability. Each list item links to a readable detail view; maintenance controls live in a right-side drawer.

- [ ] **Step 4: Keep public and internal fields structurally separated**

Use the existing `PublicProposal` and `MaintenanceProposal` distinction. Do not cast the public response to the maintenance type. Display a human-readable progress timeline assembled from status, `publicProgress`, assignee, and due date.

- [ ] **Step 5: Verify information flows**

Run: `npm test -- apps/web/src/modules/information apps/api/src/modules/information`

Run after local stack is available: `npx playwright test tests/e2e/information.spec.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/modules/information tests/e2e/information.spec.ts
git commit -m "feat: organize information and consultation workflows"
```

---

### Task 6: Make activity list and detail pages readable and complete

**Files:**

- Modify: `apps/web/src/modules/events/EventsPage.tsx`
- Modify: `apps/web/src/modules/events/ActivityDetailPage.tsx`
- Modify: `apps/web/src/modules/events/EventsPage.test.tsx`
- Modify: `apps/web/src/modules/events/ActivityDetailPage.test.tsx`
- Modify: `apps/web/src/styles/activity.css`
- Modify: `tests/e2e/events.spec.ts`

- [ ] **Step 1: Add failing activity presentation tests**

Require list cards to show start/end time, location, concise summary, registration deadline/capacity/contact, standing-activity marker, and detail link. Require details to show ordered milestones, completion progress, fixtures for competitions such as 马约翰杯, registration state, and scoped maintenance controls.

- [ ] **Step 2: Prove the tests fail**

Run: `npm test -- apps/web/src/modules/events`

Expected: FAIL because the existing list lacks the complete approved metadata and shared shell.

- [ ] **Step 3: Recompose list and detail views**

Use the existing milestones and fixtures endpoints. Calculate progress from completed visible milestones; if no milestones exist, show “尚未发布流程” rather than `0%`. Sort by `displayOrder`, then `occursAt`. Use localized absolute dates and never reinterpret calendar dates in browser local time.

- [ ] **Step 4: Keep editing contextual**

Create/edit activity in a drawer. Manage milestones and fixtures inside the detail page. Organization selection is limited to organizations returned by the actor's authorized context.

- [ ] **Step 5: Verify event flows**

Run: `npm test -- apps/web/src/modules/events apps/api/src/modules/events`

Run after local stack is available: `npx playwright test tests/e2e/events.spec.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/modules/events apps/web/src/styles/activity.css tests/e2e/events.spec.ts
git commit -m "feat: deepen activity timelines and competition previews"
```

---

### Task 7: Split sports directory from team operations

**Files:**

- Modify: `apps/web/src/modules/sports/SportsPage.tsx`
- Modify: `apps/web/src/modules/sports/SportsTeamDetailPage.tsx`
- Modify: `apps/web/src/modules/sports/SportsPage.test.tsx`
- Create: `apps/web/src/modules/sports/SportsTeamDetailPage.test.tsx`
- Modify: `tests/e2e/sports.spec.ts`

- [ ] **Step 1: Add failing directory/detail tests**

Assert the directory shows name, season, schedule, summary, status, and detail link. Assert the team page shows roster, captain controls, check-ins, and CSV preview/import. CSV accepts exactly `姓名,学号`, reports per-row validation, and does not mutate until confirmation.

- [ ] **Step 2: Prove the tests fail**

Run: `npm test -- apps/web/src/modules/sports`

Expected: FAIL because directory and operations currently share one oversized page.

- [ ] **Step 3: Move team operations to the detail route**

Keep data fetching in each route-level component. Reuse the existing roster preview/import endpoints and captain-scoped permissions. The list page must not fetch member/check-in data for every team.

- [ ] **Step 4: Preserve captain and organization boundaries**

Never use route possession as authorization. Let the server apply exact team scope and return not-found semantics for inaccessible teams. Keep batch-import failures atomic and show the returned row results.

- [ ] **Step 5: Verify sports flows**

Run: `npm test -- apps/web/src/modules/sports apps/api/src/modules/sports`

Run after local stack is available: `npx playwright test tests/e2e/sports.spec.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/modules/sports tests/e2e/sports.spec.ts
git commit -m "feat: separate sports directory and team operations"
```

---

### Task 8: Add liaison problem, community, and outcome storage contracts

**Files:**

- Create: `database/migrations/009_liaison_problem_board.sql`
- Modify: `database/seeds/001_demo.sql`
- Modify: `apps/api/src/core/database/types.ts`
- Modify: `apps/api/src/core/database/memory-store.ts`
- Modify: `apps/api/src/core/database/mysql-store.ts`
- Create: `apps/api/src/core/database/liaison-problem-schema.test.ts`
- Create: `apps/api/src/core/database/liaison-problem-migration.test.ts`
- Modify: `apps/api/src/core/database/memory-store.test.ts`
- Modify: `apps/api/src/core/database/mysql.integration.test.ts`

- [ ] **Step 1: Write failing repository-contract tests**

Add records and repositories for:

```ts
type LiaisonProblemStatus =
  'draft' | 'pending_review' | 'rejected' | 'open' | 'paused' | 'closed' | 'archived';

interface LiaisonProblemRecord extends StoredRecord {
  title: string;
  summary: string;
  background: string;
  sourceType: 'lab' | 'company' | 'campus' | 'other';
  sourceName: string;
  tags: string[];
  expectedOutcome: string;
  constraints: string;
  startsAt: string | null;
  deadline: string | null;
  publicContact: string;
  internalContactNote: string;
  recorderUid: string;
  reviewerUid: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
}
```

Also add `LiaisonTeamRecord`, `LiaisonTeamMemberRecord`, `LiaisonPostRecord`, and `LiaisonOutcomeRecord`. Enforce `(problem_id, team_id, member_uid)` membership uniqueness and ordered outcome versions.

- [ ] **Step 2: Prove repository tests fail**

Run: `npm test -- apps/api/src/core/database/liaison-problem-schema.test.ts apps/api/src/core/database/liaison-problem-migration.test.ts`

Expected: FAIL because migration 009 and repositories do not exist.

- [ ] **Step 3: Implement additive migration and both adapters**

Create separate tables with explicit foreign keys and indexes. Use JSON for tags, UTC `DATETIME(3)` for instants, and `TEXT` for narrative content. Keep existing `liaison_resources` intact for rollback and data migration; stop exposing it in the new UI only.

- [ ] **Step 4: Add useful deterministic seeds**

Seed at least one open lab problem, one open company problem, two parallel teams, several progress posts, and one adopted outcome. Do not seed real private contact data.

- [ ] **Step 5: Verify storage parity**

Run: `npm test -- apps/api/src/core/database`

Run with MySQL integration available: `npm run test:mysql`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add database apps/api/src/core/database
git commit -m "feat: add liaison problem board storage"
```

---

### Task 9: Implement liaison review, participation, community, and outcomes API

**Files:**

- Modify: `apps/api/src/core/authorization/permission-catalog.ts`
- Modify: `apps/api/src/core/bootstrap/built-in-definitions.ts`
- Modify: `packages/contracts/src/permissions.ts`
- Modify: `packages/contracts/src/permissions.test.ts`
- Create: `apps/api/src/modules/liaison/problem-service.ts`
- Create: `apps/api/src/modules/liaison/problem-service.test.ts`
- Modify: `apps/api/src/modules/liaison/router.ts`
- Modify: `apps/api/src/modules/liaison/router.test.ts`
- Modify: `apps/api/src/modules/liaison/state-machine.test.ts`
- Modify: `apps/api/src/modules/liaison/review-regressions.test.ts`
- Create: `apps/api/src/modules/liaison/community.test.ts`

- [ ] **Step 1: Add failing authorization and state tests**

Register exact permissions:

```text
liaison.problem.read
liaison.problem.create
liaison.problem.update
liaison.problem.submit_review
liaison.problem.review
liaison.problem.join
liaison.problem.post
liaison.problem.outcome.submit
liaison.problem.outcome.manage
```

Grant proxy-create/update to liaison maintainers. Assign `liaison.problem.review` explicitly to the configured development lead and Youth League secretary subjects; do not derive it from `admin.manage`. Either reviewer may approve or reject once.

- [ ] **Step 2: Prove the tests fail**

Run: `npm test -- packages/contracts/src/permissions.test.ts apps/api/src/modules/liaison`

Expected: FAIL because problem permissions, transitions, and endpoints do not exist.

- [ ] **Step 3: Implement the problem lifecycle**

Use the approved graph:

```ts
const PROBLEM_TRANSITIONS = {
  draft: ['pending_review'],
  pending_review: ['open', 'rejected'],
  rejected: ['draft'],
  open: ['paused', 'closed'],
  paused: ['open', 'closed'],
  closed: ['archived'],
  archived: [],
} as const;
```

Only review-authorized subjects may transition `pending_review` to `open` or `rejected`. Review writes reviewer, time, note, decision, and audit event atomically.

- [ ] **Step 4: Implement stable API routes**

```text
GET    /liaison/problems
POST   /liaison/problems
GET    /liaison/problems/:problemId
PATCH  /liaison/problems/:problemId
POST   /liaison/problems/:problemId/transitions
POST   /liaison/problems/:problemId/review
GET    /liaison/problems/:problemId/teams
POST   /liaison/problems/:problemId/teams
POST   /liaison/problems/:problemId/teams/:teamId/members
GET    /liaison/problems/:problemId/posts
POST   /liaison/problems/:problemId/posts
GET    /liaison/problems/:problemId/outcomes
POST   /liaison/problems/:problemId/outcomes
PATCH  /liaison/problems/:problemId/outcomes/:outcomeId
```

Any authenticated student may read open problems, join a team, and post. Team maintainers confirm join requests. Multiple teams remain active concurrently. An outcome may be submitted/adopted without automatically closing the problem; multiple outcomes may be adopted.

- [ ] **Step 5: Enforce response projections and concurrency**

Public problem projections omit `internalContactNote`, `reviewNote` when rejected-detail access is absent, and unrelated draft records. Update and transition operations use transaction locks. Duplicate membership and repeated adoption return stable 409 errors.

- [ ] **Step 6: Verify API behavior**

Run: `npm test -- packages/contracts/src/permissions.test.ts apps/api/src/modules/liaison apps/api/src/core/authorization`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src/permissions.ts packages/contracts/src/permissions.test.ts apps/api/src/core/authorization apps/api/src/core/bootstrap apps/api/src/modules/liaison
git commit -m "feat: implement liaison bounty workflows"
```

---

### Task 10: Build the liaison bounty board and per-problem community

**Files:**

- Modify: `apps/web/src/modules/liaison/LiaisonPage.tsx`
- Modify: `apps/web/src/modules/liaison/LiaisonPage.test.tsx`
- Modify: `apps/web/src/modules/liaison/ProblemDetailPage.tsx`
- Create: `apps/web/src/modules/liaison/ProblemDetailPage.test.tsx`
- Create: `apps/web/src/modules/liaison/ProblemEditorDrawer.tsx`
- Create: `apps/web/src/modules/liaison/ProblemCommunity.tsx`
- Create: `apps/web/src/modules/liaison/OutcomePanel.tsx`
- Modify: `tests/e2e/liaison.spec.ts`

- [ ] **Step 1: Add failing board and community tests**

The board must show source, status, tags, deadline, expected outcome, and participating-team count. The detail route must show background/constraints/public contact, parallel teams, chronological community posts, and outcome versions. Ordinary students see browse/join/post actions; liaison maintainers see proxy record/edit; designated reviewers see approve/reject only on pending items.

- [ ] **Step 2: Prove the tests fail**

Run: `npm test -- apps/web/src/modules/liaison`

Expected: FAIL because the current page is a contact-resource editor.

- [ ] **Step 3: Implement the restrained tavern-board visual language**

Use the “揭榜挂帅” metaphor only in wording and information hierarchy: a compact notice-board list, category chips, clear deadlines, and one highlighted “参与课题” action. Do not use parchment textures, game animations, dense badges, or an independent social feed.

- [ ] **Step 4: Implement the per-problem community**

Use one detail page with four sections: problem brief, participating teams, progress discussion, and outcomes. Posts are lightweight progress/discussion entries ordered newest last. Outcome state changes are available only to liaison maintainers and do not close the problem.

- [ ] **Step 5: Verify privacy and role presentation**

Assert internal contacts never appear in ordinary-student rendering or serialized fixtures. Assert reviewer buttons depend on explicit review permission, not super-admin identity.

- [ ] **Step 6: Run UI and E2E verification**

Run: `npm test -- apps/web/src/modules/liaison apps/api/src/modules/liaison`

Run after local stack is available: `npx playwright test tests/e2e/liaison.spec.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/modules/liaison tests/e2e/liaison.spec.ts
git commit -m "feat: build liaison problem community"
```

---

### Task 11: Apply the shared shell to finance and administration without scope changes

**Files:**

- Modify: `apps/web/src/modules/finance/FinancePage.tsx`
- Modify: `apps/web/src/modules/finance/FinancePage.test.tsx`
- Modify: `apps/web/src/modules/finance/FinancePage.organization.test.tsx`
- Modify: `apps/web/src/modules/admin/AdminPage.tsx`
- Modify: `apps/web/src/modules/admin/AdminPage.test.tsx`
- Modify: `apps/web/src/modules/admin/AdminPage.governance.test.tsx`
- Modify: `tests/e2e/finance.spec.ts`
- Modify: `tests/e2e/admin.spec.ts`
- Modify: `tests/e2e/permissions.spec.ts`

- [ ] **Step 1: Add failing layout-regression tests**

Assert both pages use the common header, filters, states, and responsive list styles. Preserve all current finance organization/level visibility assertions and super-admin-only route assertions unchanged.

- [ ] **Step 2: Prove layout tests fail**

Run: `npm test -- apps/web/src/modules/finance apps/web/src/modules/admin`

Expected: FAIL only for new presentation contracts.

- [ ] **Step 3: Recompose existing behavior with shared components**

Do not add finance fields, statuses, endpoints, or permissions. Do not add administration permissions. Keep admin section navigation and editors; simplify spacing, headings, async states, and action grouping.

- [ ] **Step 4: Verify governance boundaries**

Run: `npm test -- apps/web/src/modules/finance apps/web/src/modules/admin apps/web/src/core/permissions apps/api/src/modules/finance apps/api/src/modules/admin`

Run after local stack is available: `npx playwright test tests/e2e/finance.spec.ts tests/e2e/admin.spec.ts tests/e2e/permissions.spec.ts`

Expected: PASS with ordinary students still unable to see finance and non-super-admin users redirected from admin.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/modules/finance apps/web/src/modules/admin tests/e2e/finance.spec.ts tests/e2e/admin.spec.ts tests/e2e/permissions.spec.ts
git commit -m "refactor: align governed modules with shared shell"
```

---

### Task 12: Integrate, document, and verify the full platform

**Files:**

- Modify: `apps/web/src/modules/dashboard/DashboardPage.tsx`
- Modify: `apps/web/src/modules/dashboard/DashboardPage.test.tsx`
- Modify: `tests/e2e/modules.spec.ts`
- Modify: `tests/e2e/responsive.spec.ts`
- Modify: `tests/e2e/release-smoke.spec.ts`
- Modify: `README.md`
- Modify: `docs/handoff.md`
- Modify: `docs/technical_design.md`

- [ ] **Step 1: Add cross-module navigation and responsive tests**

Assert the dashboard remains the default landing page, every visible module is reachable, nested routes keep the correct shell title/navigation state, mobile layouts avoid horizontal page overflow, and legacy `/clubs` redirects correctly.

- [ ] **Step 2: Update the dashboard without creating another navigation layer**

Keep it as a short overview: platform purpose, a small set of actionable updates, and recent items. Do not duplicate all sidebar entries as large cards and do not add a sidebar “工作台” button.

- [ ] **Step 3: Update collaborator documentation**

Document new routes, migrations 008/009, liaison review-subject configuration, public/internal response separation, test commands, and how future external submissions can be added without changing the phase-one proxy-publishing flow.

- [ ] **Step 4: Run static consistency checks**

Run: `npm run format:check`

Run: `npm run lint`

Run: `npm run typecheck`

Expected: all PASS with no placeholder text, unchecked casts between public/internal records, or unused legacy imports.

- [ ] **Step 5: Run the full repository gate**

Run: `npm run check`

Expected: PASS.

- [ ] **Step 6: Run browser verification**

Start the demo stack and run:

```bash
npx playwright test tests/e2e/modules.spec.ts tests/e2e/responsive.spec.ts tests/e2e/release-smoke.spec.ts tests/e2e/knowledge.spec.ts tests/e2e/information.spec.ts tests/e2e/clubs.spec.ts tests/e2e/events.spec.ts tests/e2e/liaison.spec.ts tests/e2e/sports.spec.ts tests/e2e/finance.spec.ts tests/e2e/admin.spec.ts tests/e2e/permissions.spec.ts
```

Expected: PASS on desktop and mobile projects configured by Playwright.

- [ ] **Step 7: Verify MySQL parity when the integration service is available**

Run: `npm run test:mysql`

Expected: PASS after migrations are applied twice, proving idempotent migration handling and adapter parity.

- [ ] **Step 8: Commit integration documentation**

```bash
git add apps/web/src/modules/dashboard tests/e2e README.md docs/handoff.md docs/technical_design.md
git commit -m "docs: complete unified platform handoff"
```

## Execution Order and Parallel Boundaries

1. Complete Tasks 1–3 sequentially; they establish shared files and data contracts.
2. After Task 3, Tasks 4–7 may run in parallel because each owns a separate web module.
3. Tasks 8–10 are sequential and own the liaison storage, API, and UI chain.
4. Task 11 may run in parallel with Tasks 8–10 because it does not change their files.
5. Complete Task 12 only after all preceding tracks are merged and conflicts are resolved.

## Definition of Done

- All approved module routes and visibility rules are represented in tests.
- Public, organization, reviewer, maintainer, captain, finance, and super-admin boundaries remain server-enforced.
- All new data works in both memory preview and MySQL production modes.
- Shared visual primitives replace repeated module-specific loading, empty, error, filter, editor, and confirmation patterns.
- Liaison problems support proxy publishing, either-reviewer approval, parallel teams, discussion/progress posts, versioned outcomes, and adoption without forced closure.
- Finance behavior is unchanged; administration remains super-admin-only.
- `npm run check`, focused E2E tests, and MySQL integration tests pass before a PR is opened.
