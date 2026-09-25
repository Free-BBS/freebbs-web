# Development Admin Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow verified main-site administrators to configure development access once, then automatically return authority to the development-owned allowlist.

**Architecture:** Carry a trusted `mainSiteAdmin` claim from the main backend into the development auth context. While no non-system development lead grant exists, build a temporary super-admin context and reconcile built-in definitions without persisting fallback access; normal development grants take precedence and become exclusive after a lead is saved in system settings.

**Tech Stack:** Node.js 24, TypeScript, Express, Vitest, Node test runner, MySQL/memory repository abstraction.

## Global Constraints

- Do not log into or modify the production server.
- Main-site administrator status must come from the authenticated backend profile and must not trust client headers or request bodies.
- Existing construction-page behavior remains for ordinary unauthorized users.
- The fallback ends after an active lead grant written by a real development actor exists.
- Use test-first red-green cycles for every behavior change.

---

### Task 1: Trusted main-site administrator identity

**Files:**
- Modify: `development/packages/contracts/src/auth.ts`
- Modify: `backend/development-integration.js`
- Test: `backend/development-integration.test.js`
- Modify: `development/apps/api/src/core/auth/main-site-auth-client.ts`
- Test: `development/apps/api/src/core/auth/auth-middleware.test.ts`

**Interfaces:**
- Produces: `UserContext.mainSiteAdmin?: boolean` populated only by authenticated server adapters.
- Consumes: main profile `isAdmin: boolean` and remote `/api/auth/me` boolean `isAdmin`.

- [ ] **Step 1: Write failing adapter tests**

Add assertions that an authenticated administrator maps to `mainSiteAdmin: true`, a normal user maps to `false`, and string values such as `"true"` are not accepted.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test backend/development-integration.test.js` and `npm test -- --run apps/api/src/core/auth/auth-middleware.test.ts` from `development/`.

Expected: FAIL because the field is missing.

- [ ] **Step 3: Implement the trusted field mapping**

Add `readonly mainSiteAdmin?: boolean` to `UserContext`; map with `profile.isAdmin === true` and `identity.isAdmin === true` in the two server-side adapters.

- [ ] **Step 4: Re-run focused tests**

Expected: both commands PASS.

### Task 2: Temporary bootstrap authorization and automatic cutoff

**Files:**
- Modify: `development/apps/api/src/core/bootstrap/bootstrap-service.ts`
- Test: `development/apps/api/src/core/bootstrap/bootstrap-service.test.ts`
- Modify: `development/apps/api/src/core/auth/development-access.ts`
- Test: `development/apps/api/src/core/auth/development-access.test.ts`
- Modify: `development/apps/api/src/core/auth/auth-middleware.ts`
- Test: `development/apps/api/src/core/auth/auth-middleware.test.ts`

**Interfaces:**
- Produces: `ensurePlatformDefinitions(store, ownerUid): Promise<void>`.
- Produces: `hasConfiguredDevelopmentLead(store): Promise<boolean>`.
- Produces: `temporarySuperAdminContext(context): AuthorizationContext` local to auth middleware.
- Consumes: active development lead grants and the existing permission catalog.

- [ ] **Step 1: Write failing access-state and middleware tests**

Cover an unconfigured store where a main administrator receives status 200 with `platform.super_admin`; a normal user receives 403; and adding an active lead whose owner is not `system` makes the same unlisted main administrator receive 403. Cover a system seed lead that initializes definitions before creating its assignment.

- [ ] **Step 2: Run focused tests and verify the intended failures**

Run: `npm test -- --run apps/api/src/core/auth/development-access.test.ts apps/api/src/core/auth/auth-middleware.test.ts apps/api/src/core/bootstrap/bootstrap-service.test.ts` from `development/`.

Expected: FAIL because fallback detection and definition-only initialization do not exist.

- [ ] **Step 3: Implement definition reconciliation without assigning a user**

Export an idempotent transaction wrapper around the existing built-in definition reconciliation. Refactor `bootstrapPlatform` to call the same internal helper inside its transaction.

- [ ] **Step 4: Implement configured-lead detection**

Return true only for an active `lead` access record whose `ownerUid` is non-empty and not `system`.

- [ ] **Step 5: Implement fallback middleware**

Resolve explicit development access first. If none exists and `mainSiteAdmin === true` and no configured lead exists, allow a temporary lead context, reconcile definitions, and attach `platform.super_admin` plus allow policies derived from `ROLE_PERMISSION_CATALOG['platform.super_admin']`. Do not create access grants or role assignments for fallback users. For explicit lead grants, reconcile definitions before `ensureDevelopmentLeadAssignment`.

- [ ] **Step 6: Separate backend failures from identity-provider failures**

Catch `IdentityProviderUnavailableError` as `identity_provider_unavailable`; map other errors to status 503 code `development_backend_unavailable` and log through an injectable reporter.

- [ ] **Step 7: Run focused tests**

Expected: all focused Vitest files PASS.

### Task 3: Construction-page feedback

**Files:**
- Modify: `public/development-entry.js`
- Test: `scripts/development-entry.test.js`
- Modify: `development.html`

**Interfaces:**
- Produces: `checkDevelopmentAccess({ token, fetchImplementation, navigate, reportStatus })` with status callbacks `checking`, `denied`, and `unavailable`.
- Consumes: `/api/development/v1/me` HTTP status and JSON error envelope.

- [ ] **Step 1: Write failing UI behavior tests**

Assert that 403 reports `denied`, 503 and thrown network errors report `unavailable`, and a successful response reports `checking` before navigation.

- [ ] **Step 2: Run the test and verify failure**

Run: `node --test scripts/development-entry.test.js`.

Expected: FAIL because `reportStatus` is not called.

- [ ] **Step 3: Implement status reporting and accessible page copy**

Add a status node with `role="status"` to `development.html`; report a concise Chinese message while checking and when the development service is temporarily unavailable. Keep 403 visually on the existing construction page.

- [ ] **Step 4: Re-run the UI test**

Expected: PASS.

### Task 4: Full verification and review-ready commit

**Files:**
- Verify all modified files.

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: a branch ready to rebase on the latest remote main and submit as a pull request.

- [ ] **Step 1: Run development checks**

Run from `development/`: `npm run typecheck`, focused Vitest tests, and `npm run build`.

Expected: all exit 0.

- [ ] **Step 2: Run main integration checks**

Run from repository root: `npm run test:development-integration` and `npm run check`.

Expected: all exit 0.

- [ ] **Step 3: Inspect the diff and secret scan**

Run: `git diff --check`, `git status --short`, and `rg -n "password|token|secret"` limited to changed files; confirm no credential was introduced.

- [ ] **Step 4: Re-read the remote main branch before PR**

Retry `git fetch origin main --prune`; compare `HEAD` with `origin/main` and rebase if the remote advanced.

- [ ] **Step 5: Commit the verified implementation**

Commit message: `feat: bootstrap development access from main admins`.
