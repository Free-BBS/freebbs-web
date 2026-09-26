# Development Administrator Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the development “系统设置” governance console with a clear administrator module centered on grouped organization identity cards and scoped sports-captain assignments.

**Architecture:** Keep development access, role assignments, and scoped captain tags as the three existing persistence mechanisms. Add a shared, typed identity catalog that drives both UI rendering and server validation, then simplify the administrator page to the user directory plus a secondary operation-record view. Fine-grained business capabilities remain mapped through the existing permission catalog and can be refined later without changing saved identities.

**Tech Stack:** React 19, TypeScript, Express, Zod, Vitest, Testing Library, MySQL-compatible stores, shared CSS theme tokens.

## Global Constraints

- Only `accessLevel: 'lead'` users may open the administrator module or mutate identity assignments.
- `platform.admin` is separate from `platform.super_admin` and cannot open the administrator module.
- Identity choices are exclusive inside one catalog group and additive across different groups.
- Sports captain selection appears last and requires at least one existing team when enabled.
- New identity keys without an approved business mapping add no new write capability.
- Existing assignments and hidden legacy role keys remain readable and are preserved on save.
- Both themes must avoid pure-black administrator surfaces and the layout must not overflow at 320px.

---

### Task 1: Shared organization identity catalog

**Files:**
- Create: `development/packages/contracts/src/development-identities.ts`
- Modify: `development/packages/contracts/src/modules.ts`
- Modify: `development/packages/contracts/src/index.ts`
- Modify: `development/packages/contracts/src/modules.test.ts`
- Create: `development/packages/contracts/src/development-identities.test.ts`
- Modify: `development/apps/api/src/core/bootstrap/built-in-definitions.ts`
- Modify: `development/apps/api/src/core/authorization/permission-catalog.ts`

**Interfaces:**
- Produces `DEVELOPMENT_IDENTITY_SECTIONS`, `DEVELOPMENT_IDENTITY_GROUPS`, `DEVELOPMENT_IDENTITY_ROLE_KEYS`, `DEVELOPMENT_IDENTITY_BY_ROLE`, `identityLabels(roles)`, and `validateIdentitySelection(roles)`.
- Extends `RoleKey` with `platform.admin` and every position defined in the approved specification.
- Existing code continues to consume `ROLE_KEYS` and `ROLE_PERMISSION_CATALOG`.

- [ ] **Step 1: Write failing catalog tests**

```ts
it('contains every approved organization section in display order', () => {
  expect(DEVELOPMENT_IDENTITY_SECTIONS.map(({ id }) => id)).toEqual([
    'counselors',
    'student_union',
    'youth_league',
    'tms',
    'science_association',
    'media_center',
  ]);
});

it('rejects two positions from one group and accepts roles from separate groups', () => {
  expect(
    validateIdentitySelection(['domain.arts_lead', 'department.arts_member']),
  ).toMatchObject({ ok: false, groupId: 'student_union.arts_center' });
  expect(
    validateIdentitySelection(['domain.arts_lead', 'department.sports_member']),
  ).toEqual({ ok: true });
});

it('keeps platform administrator separate from the development lead role', () => {
  expect(DEVELOPMENT_IDENTITY_ROLE_KEYS).toContain('platform.admin');
  expect(DEVELOPMENT_IDENTITY_ROLE_KEYS).not.toContain('platform.super_admin');
});
```

- [ ] **Step 2: Run tests and verify they fail because the catalog does not exist**

Run: `node_modules/.bin/vitest run packages/contracts/src/development-identities.test.ts packages/contracts/src/modules.test.ts`

Expected: FAIL with an unresolved `development-identities` import or missing exports.

- [ ] **Step 3: Implement the typed catalog and role keys**

Use these public shapes:

```ts
export interface DevelopmentIdentityOption {
  roleKey: RoleKey;
  label: string;
}

export interface DevelopmentIdentityGroup {
  id: string;
  label: string;
  selection: 'single' | 'toggle';
  options: readonly DevelopmentIdentityOption[];
}

export interface DevelopmentIdentitySection {
  id: string;
  label: string;
  groups: readonly DevelopmentIdentityGroup[];
}

export type IdentitySelectionValidation =
  | { ok: true }
  | { ok: false; groupId: string; message: string };
```

Populate the complete groups from the approved design document. `validateIdentitySelection` counts selected roles by group and rejects a count greater than one for `selection: 'single'`. `identityLabels` returns visible Chinese labels in catalog order. Keep legacy affiliation roles in `ROLE_KEYS` but out of `DEVELOPMENT_IDENTITY_ROLE_KEYS`.

- [ ] **Step 4: Add provisional permission profiles**

Keep current student-union center rules unchanged. Map detailed Youth League and science-association positions to the existing member/director/lead profiles by level. Map TMS 顾问/会长/会员 to the existing TMS lead/director/member profiles. Return an empty rule array for counselor, top student-union, finance, media-center, and `platform.admin` identities.

- [ ] **Step 5: Run contract and authorization tests**

Run: `node_modules/.bin/vitest run packages/contracts/src/development-identities.test.ts packages/contracts/src/modules.test.ts apps/api/src/core/bootstrap/bootstrap-service.test.ts apps/api/src/core/authorization/permission-matrix.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add development/packages/contracts development/apps/api/src/core/bootstrap/built-in-definitions.ts development/apps/api/src/core/authorization/permission-catalog.ts
git commit -m "feat: add development identity catalog"
```

---

### Task 2: Validate and persist identity-card selections

**Files:**
- Modify: `development/apps/api/src/modules/admin/development-users-router.ts`
- Modify: `development/apps/api/src/modules/admin/development-users-router.test.ts`

**Interfaces:**
- Consumes `validateIdentitySelection` and all non-super-admin `ROLE_KEYS`.
- Preserves the existing request body `{ accessLevel, roles, captainTeamIds }`.
- Produces one atomic update and one `admin.development_user.update` audit record.

- [ ] **Step 1: Write failing API tests**

Add tests that submit:

```ts
await request(app)
  .put('/api/development/v1/admin/development-users/u_target')
  .set('Authorization', 'Bearer lead')
  .send({
    accessLevel: 'member',
    roles: ['domain.arts_lead', 'department.arts_member'],
    captainTeamIds: [],
  })
  .expect(400);
```

Also assert that cross-group roles save successfully, `platform.admin` saves without creating `platform.super_admin`, a captain request with an unknown team returns `400`, and a non-lead caller receives `403` for list and update routes.

- [ ] **Step 2: Run the API test and verify the group-conflict and unknown-team assertions fail**

Run: `node_modules/.bin/vitest run apps/api/src/modules/admin/development-users-router.test.ts`

Expected: FAIL because group validation and team existence validation are absent.

- [ ] **Step 3: Implement strict server validation**

After Zod parsing, call `validateIdentitySelection(parsed.data.roles)`. Throw `HttpError(400, 'identity_group_conflict', message)` on failure. Load active sports teams and reject every `captainTeamIds` entry not matching an active team ID with `HttpError(400, 'invalid_sports_team', '代表队不存在或不可用')`.

Keep `platform.super_admin` excluded from the request schema. Continue deriving it only from `accessLevel: 'lead'`. Preserve hidden legacy roles if the client returns them.

- [ ] **Step 4: Record a focused before/after audit summary**

Write `previous` and `next` objects containing only `accessLevel`, sorted `roles`, and sorted `captainTeamIds`. Do not add profile or credential data.

- [ ] **Step 5: Run API and authorization regression tests**

Run: `node_modules/.bin/vitest run apps/api/src/modules/admin/development-users-router.test.ts apps/api/src/modules/admin/router.test.ts apps/api/src/core/auth/auth-middleware.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add development/apps/api/src/modules/admin/development-users-router.ts development/apps/api/src/modules/admin/development-users-router.test.ts
git commit -m "feat: validate development identity assignments"
```

---

### Task 3: Replace governance tabs with the administrator identity editor

**Files:**
- Modify: `development/apps/web/src/modules/admin/AdminPage.tsx`
- Delete: `development/apps/web/src/modules/admin/AdminSectionNav.tsx`
- Modify: `development/apps/web/src/modules/admin/AdminPage.test.tsx`
- Rewrite: `development/apps/web/src/modules/admin/sections/DevelopmentUsersSection.tsx`
- Create: `development/apps/web/src/modules/admin/sections/DevelopmentUsersSection.test.tsx`
- Create: `development/apps/web/src/modules/admin/sections/IdentitySection.tsx`
- Create: `development/apps/web/src/modules/admin/sections/OperationLogDrawer.tsx`
- Modify: `development/apps/web/src/app/AppShell.tsx`
- Modify: `development/apps/web/src/app/AppShell.test.tsx`
- Modify: `development/apps/web/src/app/module-manifests.ts`

**Interfaces:**
- `DevelopmentUsersSection` requests `/admin/development-users` and `/sports/teams`.
- `IdentitySection` consumes one catalog section, current roles, and `onRolesChange`.
- `OperationLogDrawer` requests `/admin/audit-logs?action=admin.development_user.update&page=1&pageSize=20` only while open.

- [ ] **Step 1: Write failing page and interaction tests**

Cover these visible behaviors:

```ts
expect(screen.getByRole('heading', { name: '管理员模块' })).toBeInTheDocument();
expect(screen.queryByRole('tab', { name: 'Tag 定义' })).not.toBeInTheDocument();
expect(screen.getByRole('button', { name: '操作记录' })).toBeInTheDocument();
```

For the user editor, assert that selecting 文艺中心负责人 then 文艺中心部员 leaves only 部员 selected; selecting 体育中心部员 preserves 文艺中心部员; platform administrator is a separate checkbox; the sports-captain section follows the media-center section and renders team checkboxes instead of a comma-separated ID input.

- [ ] **Step 2: Run UI tests and verify they fail against the current tabbed/card list**

Run: `node_modules/.bin/vitest run apps/web/src/modules/admin/AdminPage.test.tsx apps/web/src/modules/admin/sections/DevelopmentUsersSection.test.tsx apps/web/src/app/AppShell.test.tsx`

Expected: FAIL because the administrator heading, split directory, grouped identity controls, and operation-record button do not exist.

- [ ] **Step 3: Simplify `AdminPage`**

Render `ModulePageHeader` with kicker `DEVELOPMENT ADMIN`, title `管理员模块`, and a concise description. Remove the tab state and render `DevelopmentUsersSection` directly. Add an “操作记录” button that controls `OperationLogDrawer`.

- [ ] **Step 4: Build the split user directory**

Maintain server data separately from the selected draft. The left list contains user avatar, username, display name, student ID, access badge, and `identityLabels(user.roles).slice(0, 3)`. The right editor contains access-level segmented controls, preview action, platform-admin toggle, organization accordions, the final captain section, and a sticky save bar.

When selecting an option in a single-choice group, remove all roles in that group before adding the selected role. Clicking the selected role clears it. Preserve roles not present in the visible catalog.

- [ ] **Step 5: Implement captain team selection**

Request active teams from `/sports/teams`. The “代表队队长” checkbox enables a team checklist. Turning it off clears `captainTeamIds`. Prevent save and show an inline message when it is on with no team selected.

- [ ] **Step 6: Rename navigation and add operation records**

Change the sidebar label and accessible labels from “系统设置” to “管理员模块”. The operation record view is secondary and only shows `admin.development_user.update` records with actor, target, time, and the concise before/after identity summary.

- [ ] **Step 7: Run focused UI tests**

Run: `node_modules/.bin/vitest run apps/web/src/modules/admin/AdminPage.test.tsx apps/web/src/modules/admin/sections/DevelopmentUsersSection.test.tsx apps/web/src/app/AppShell.test.tsx apps/web/src/core/permissions/SuperAdminRouteGuard.test.tsx`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add development/apps/web/src
git commit -m "feat: redesign development administrator module"
```

---

### Task 4: Align administrator surfaces with the main-site visual system

**Files:**
- Modify: `development/apps/web/src/styles/shell.css`
- Modify: `development/apps/web/src/styles/components.css`
- Modify: `development/apps/web/src/styles/theme.css`
- Modify: `development/apps/web/src/styles/responsive.css`
- Modify: `development/apps/web/src/styles/theme-contract.test.ts`

**Interfaces:**
- Uses existing semantic tokens such as `--surface-card`, `--surface-subtle`, `--line-soft`, `--text-primary`, and `--color-accent`.
- Adds component classes only; it does not add another independent color theme.

- [ ] **Step 1: Add failing theme-contract assertions**

Assert that administrator styles use semantic surfaces, that the obsolete `--admin-paper`/black governance theme is absent, and that the 320px media rule collapses the directory grid and permits option labels to wrap.

- [ ] **Step 2: Run the theme test and verify it fails on the current governance variables**

Run: `node_modules/.bin/vitest run apps/web/src/styles/theme-contract.test.ts`

Expected: FAIL because the old administrator paper variables and layout are present.

- [ ] **Step 3: Implement light, dark, and responsive styling**

Use a maximum content width, a `minmax(240px, 320px) minmax(0, 1fr)` desktop grid, semantic card backgrounds, restrained teal selected states, warm-gold lead badges, sticky save actions, visible focus rings, and `min-width: 0` on every grid child. At `max-width: 760px`, stack the directory and editor; at `max-width: 420px`, make action buttons full width and allow all segmented controls to wrap.

- [ ] **Step 4: Run UI and theme tests**

Run: `node_modules/.bin/vitest run apps/web/src/styles/theme-contract.test.ts apps/web/src/modules/admin/AdminPage.test.tsx apps/web/src/modules/admin/sections/DevelopmentUsersSection.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add development/apps/web/src/styles
git commit -m "style: refine development identity cards"
```

---

### Task 5: Full verification and pull request

**Files:**
- Modify if verification finds defects: files already listed above
- Final review: `docs/superpowers/specs/2026-09-26-development-admin-module-design.md`

**Interfaces:**
- Produces a pushed feature branch and a PR against `Free-BBS/freebbs-web:main`.

- [ ] **Step 1: Run formatting and static checks**

Run: `npm run check`

Expected: exit `0`.

- [ ] **Step 2: Run the development test suite**

Run: `npm test`

Expected: all tests pass with zero failures.

- [ ] **Step 3: Build the development workspace**

Run: `npm run build`

Expected: exit `0` and both API and web packages build.

- [ ] **Step 4: Review the final diff against the specification**

Run: `git diff --check origin/main...HEAD` and `git diff --stat origin/main...HEAD`.

Verify every identity group, admin boundary, captain-team scope, removed governance tab, light/dark surface, and 320px wrapping rule is represented.

- [ ] **Step 5: Commit any verification fixes and push**

```bash
git push -u origin feat/development-admin-module
```

- [ ] **Step 6: Create the pull request**

Use title `feat: 优化发展端管理员模块与身份卡片` and a concise body describing the reorganized user directory, grouped organization identity cards, scoped captain selection, operation records, main-site-aligned themes, and verification commands. Do not mention administrator bootstrap initialization, PR #115, or PR #117.
