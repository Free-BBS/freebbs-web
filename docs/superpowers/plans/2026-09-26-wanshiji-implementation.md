# 萬事集 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在发展端新增独立的“萬事集”，统一展示学习端活动报名、無活动报名和原生表单，并提供内容橱窗、我的报名和可视化表单工作台。

**Architecture:** 新模块以 `/development/collections` 为路由根，浏览器端适配三类报名来源，发展端 API 持久化原生表单、响应、橱窗文章与点赞。表单版本使用不可变 JSON schema；工作台只编辑草稿，发布时复制为版本快照。学习端 `/surveys` 保持不变，来源不可用时只隐藏该来源并显示非阻断提示。

**Tech Stack:** React 18、React Router 6、TypeScript、Express 5、Zod、MySQL 8、Vitest、Testing Library、原生 HTML Drag and Drop 与 CSS 动画。

## Global Constraints

- 学习端 `/surveys` 页面、脚本和既有报名接口行为不变。
- 发展端“無活动”既有页面和接口保持可用。
- 本轮只在 `feat/development-wanshiji` 本地分支施工，不创建或提交 PR。
- 普通用户可以浏览、报名、点赞和查看自己的记录；只有具备社工组织身份或 `platform.super_admin` 的用户可以创建原生表单。
- `platform.admin` 或代表队队长身份本身不授予表单创建权限。
- 所有上传限制必须在服务端重新校验；浏览器校验只提供即时反馈。
- 桌面端和窄屏均不得横向溢出；`prefers-reduced-motion: reduce` 时停止自动传送带动画。

---

### Task 1: 萬事集共享契约与模块入口

**Files:**
- Create: `development/packages/contracts/src/collections.ts`
- Modify: `development/packages/contracts/src/index.ts`
- Modify: `development/packages/contracts/src/modules.ts`
- Modify: `development/packages/contracts/src/modules.test.ts`
- Modify: `development/apps/web/src/app/module-manifests.ts`
- Modify: `development/apps/web/src/app/router.tsx`
- Create: `development/apps/web/src/assets/icons/collections.svg`
- Test: `development/apps/web/src/app/AppShell.test.tsx`

**Interfaces:**
- Produces: `CollectionSchema`, `CollectionFormSummary`, `CollectionResponseSummary`, `ShowcaseArticle`, `RegistrationSource`, `CollectionsDashboardPayload`.
- Produces route root `/collections` and module id `collections`.

- [ ] **Step 1: Write failing contract and shell tests**

Assert `MODULE_IDS` contains `collections`, sidebar order is 無活动、無体育、萬事集、無限机会、信息与咨询、经验库、个人成长, and `/collections` can render a labeled shell.

- [ ] **Step 2: Run the focused tests**

Run: `npm test -w @freebbs-development/contracts -- modules.test.ts && npm test -w @freebbs-development/web -- AppShell.test.tsx`

Expected: FAIL because `collections` is absent.

- [ ] **Step 3: Add exact contracts and route shell**

Define discriminated unions:

```ts
export type RegistrationSource = 'learning_survey' | 'development_activity' | 'native_collection';
export type CollectionFieldKind =
  | 'identity' | 'short_text' | 'long_text' | 'single_choice' | 'multiple_choice'
  | 'datetime' | 'file' | 'image' | 'video' | 'audio' | 'instructions';
export type CollectionRuleKind =
  | 'audience' | 'required' | 'attempt_limit' | 'upload_count' | 'file_types'
  | 'file_size' | 'title_pattern' | 'schedule' | 'capacity';
export interface CollectionField { id: string; kind: CollectionFieldKind; label: string; helpText: string; options: string[]; rules: CollectionRule[]; }
export interface CollectionSchema { title: string; description: string; fields: CollectionField[]; formRules: CollectionRule[]; }
```

Add a module manifest named `萬事集` at order 3 and shift later items by one.

- [ ] **Step 4: Run tests and commit**

Run the focused tests above; expected PASS.

Commit: `feat: add wanshiji module contracts`

### Task 2: 原生表单、响应和内容橱窗持久化

**Files:**
- Create: `development/database/migrations/015_collections.sql`
- Modify: `development/apps/api/src/core/database/types.ts`
- Modify: `development/apps/api/src/core/database/memory-store.ts`
- Modify: `development/apps/api/src/core/database/mysql-store.ts`
- Modify: `development/apps/api/src/core/database/migration-smoke.test.ts`
- Create: `development/apps/api/src/core/database/collections-store-contract.test.ts`

**Interfaces:**
- Produces repositories `collectionForms`, `collectionVersions`, `collectionResponses`, `showcaseArticles`, `showcaseLikes` on `DevelopmentStore`.
- JSON columns encode/decode `CollectionSchema` and response answer maps without string leakage.

- [ ] **Step 1: Write failing adapter contract tests**

Test memory and MySQL definitions for form/version creation, one response per form-version-user-attempt tuple, and one like per article-user tuple.

- [ ] **Step 2: Run tests and verify missing repositories fail**

Run: `npm test -w @freebbs-development/api -- collections-store-contract.test.ts migration-smoke.test.ts`

- [ ] **Step 3: Add migration and repository mappings**

Create five tables with standard id/status/owner/scope/timestamps columns, foreign keys, indexes and unique keys. Persist schema and answers in MySQL JSON columns with `JSON.stringify`/`JSON.parse` codecs.

- [ ] **Step 4: Run tests and commit**

Expected: both memory and MySQL contract tests PASS.

Commit: `feat: persist collections and showcase content`

### Task 3: 萬事集 API 与权限边界

**Files:**
- Create: `development/apps/api/src/modules/collections/schemas.ts`
- Create: `development/apps/api/src/modules/collections/access.ts`
- Create: `development/apps/api/src/modules/collections/service.ts`
- Create: `development/apps/api/src/modules/collections/router.ts`
- Create: `development/apps/api/src/modules/collections/router.test.ts`
- Modify: `development/apps/api/src/app.ts`

**Interfaces:**
- Produces REST endpoints under `/api/development/v1/collections`:
  - `GET /dashboard`, `GET /registrations`, `GET /mine`
  - `POST /forms`, `GET /forms/:id`, `PUT /forms/:id/draft`, `POST /forms/:id/publish`
  - `POST /forms/:id/responses`
  - `GET /showcase`, `GET /showcase/:id`, `POST /showcase/:id/likes`, `DELETE /showcase/:id/likes`
- `canCreateCollection(user)` accepts `platform.super_admin`, counselors, and roles mapped by `organizationForRole`; rejects ordinary student, platform admin alone, and sports captain alone.

- [ ] **Step 1: Write authorization and lifecycle tests**

Cover ordinary read, ordinary create rejection, organization-member draft creation, ownership update, publish snapshot immutability, audience checks, required/format/title validation, response submission, mine filtering, and idempotent likes.

- [ ] **Step 2: Run tests to observe 404/missing implementation failures**

Run: `npm test -w @freebbs-development/api -- modules/collections/router.test.ts`

- [ ] **Step 3: Implement Zod schemas, access helper, service and router**

Return API envelopes through existing `send`, use authenticated subject context, validate every submitted answer against the published schema, and use a transaction for publish and submission capacity checks.

- [ ] **Step 4: Run tests and commit**

Expected: route tests PASS and existing API tests remain green.

Commit: `feat: add collections api workflows`

### Task 4: 三来源报名聚合与“我的报名”

**Files:**
- Create: `development/apps/web/src/modules/collections/source-adapters.ts`
- Create: `development/apps/web/src/modules/collections/source-adapters.test.ts`
- Create: `development/apps/web/src/modules/collections/useCollections.ts`
- Create: `development/apps/web/src/modules/collections/RegistrationGallery.tsx`
- Create: `development/apps/web/src/modules/collections/RegistrationGallery.test.tsx`
- Create: `development/apps/web/src/modules/collections/MyRegistrations.tsx`
- Modify: `development/apps/web/src/app/router.tsx`

**Interfaces:**
- `loadRegistrationCatalog(client, fetcher): Promise<{items: UnifiedRegistration[]; unavailable: RegistrationSource[]}>`.
- `submitRegistration(item, values)` dispatches to the source endpoint without changing learning survey endpoints.

- [ ] **Step 1: Write failing adapter and page tests**

Test normalization of learning surveys, development activities and native collections; partial-source failure; card expansion; direct registration; and wallet grouping by pending/succeeded/closed.

- [ ] **Step 2: Run focused tests**

Run: `npm test -w @freebbs-development/web -- source-adapters.test.ts RegistrationGallery.test.tsx`

- [ ] **Step 3: Implement adapters and screens**

Fetch learning data from `/api/surveys`, events from `/api/development/v1/events/activities`, and native data from `/api/development/v1/collections/registrations`. Keep source badges, deadlines and original detail fields in one `UnifiedRegistration` model.

- [ ] **Step 4: Run tests and commit**

Commit: `feat: unify collection registration sources`

### Task 5: 酒馆入口、传送带和新告示板插画

**Files:**
- Create: `development/apps/web/src/assets/collections/sheep-collection-keeper.webp`
- Create: `development/apps/web/src/modules/collections/CollectionsLandingPage.tsx`
- Create: `development/apps/web/src/modules/collections/CollectionsLandingPage.test.tsx`
- Create: `development/apps/web/src/styles/collections.css`
- Modify: `development/apps/web/src/styles/index.css`

**Interfaces:**
- Landing links: `/collections/registrations`, `/collections/showcase`, conditional `/collections/workbench/new`, and `/collections/mine`.

- [ ] **Step 1: Generate and inspect the revised illustration**

Use the existing bartender sheep as reference. Preserve the single sheep and warm wood counter; fill the board with pinned paper shapes and illegible strokes only. Export WebP and verify no readable characters remain.

- [ ] **Step 2: Write failing interaction tests**

Cover conveyor item links, board modal focus/escape close, ordinary two-button view, organization three-button view, and wallet link.

- [ ] **Step 3: Implement landing UI and motion rules**

Use duplicated conveyor items for seamless left-to-right motion, gradient masks at both sides, DOM labels over the board, focus trapping, backdrop blur, and reduced-motion static horizontal scroll.

- [ ] **Step 4: Run tests and commit**

Commit: `feat: build wanshiji tavern landing`

### Task 6: 内容橱窗与点赞

**Files:**
- Create: `development/apps/web/src/modules/collections/ShowcasePage.tsx`
- Create: `development/apps/web/src/modules/collections/ShowcaseDetailPage.tsx`
- Create: `development/apps/web/src/modules/collections/ShowcasePage.test.tsx`
- Modify: `development/apps/web/src/app/router.tsx`
- Modify: `development/apps/web/src/styles/collections.css`

**Interfaces:**
- Uses showcase REST endpoints from Task 3 and renders internal article body or safe external article URL.

- [ ] **Step 1: Write failing list/detail/like tests**

Test magazine hierarchy, article expansion, like/unlike count, optimistic rollback on failure, and disabled duplicate request while pending.

- [ ] **Step 2: Implement pages and article cards**

Use a lead story plus aligned article grid, semantic buttons and readable line length. Render body as paragraphs without raw HTML injection.

- [ ] **Step 3: Run tests and commit**

Commit: `feat: add collections content showcase`

### Task 7: 磁吸积木式表单工作台

**Files:**
- Create: `development/apps/web/src/modules/collections/builder/catalog.ts`
- Create: `development/apps/web/src/modules/collections/builder/model.ts`
- Create: `development/apps/web/src/modules/collections/builder/model.test.ts`
- Create: `development/apps/web/src/modules/collections/builder/CollectionWorkbench.tsx`
- Create: `development/apps/web/src/modules/collections/builder/CollectionWorkbench.test.tsx`
- Create: `development/apps/web/src/modules/collections/builder/FieldLibrary.tsx`
- Create: `development/apps/web/src/modules/collections/builder/FormCanvas.tsx`
- Create: `development/apps/web/src/modules/collections/builder/InspectorPanel.tsx`
- Modify: `development/apps/web/src/app/router.tsx`
- Modify: `development/apps/web/src/styles/collections.css`

**Interfaces:**
- Pure reducers: `addField`, `moveField`, `attachRule`, `detachRule`, `updateSelection`, `validateSchema`.
- Slot compatibility: form slots accept audience/schedule/capacity/attempt_limit; upload fields accept required/upload_count/file_types/file_size/title_pattern; text and choice fields accept required/title_pattern.

- [ ] **Step 1: Write failing reducer tests**

Cover stable ids, reorder, compatible/incompatible slot attachments, duplicate singleton rule rejection, field deletion, and schema validation messages.

- [ ] **Step 2: Implement pure builder model and catalog**

Represent selection as `{type:'form'} | {type:'field'; id:string} | {type:'rule'; fieldId?:string; id:string}` and never mutate prior state.

- [ ] **Step 3: Write failing component interaction tests**

Cover click-to-add, drag reorder, drag compatible rule into highlighted slot, keyboard move buttons, right inspector edits, save draft, publish confirmation and permission-hidden route.

- [ ] **Step 4: Implement three-column simulator UI**

Desktop: 260px library, minmax canvas, 320px inspector. Narrow screens use bottom drawers. Add 28px expanded hit area for compatible slots, snap highlight, 140ms settle transform, and live region announcements.

- [ ] **Step 5: Run tests and commit**

Commit: `feat: add magnetic collection form workbench`

### Task 8: 上传校验、整体回归与本地预览

**Files:**
- Create: `development/apps/api/src/modules/collections/uploads.ts`
- Create: `development/apps/api/src/modules/collections/uploads.test.ts`
- Modify: `development/apps/api/src/modules/collections/router.ts`
- Modify: `development/apps/web/src/modules/collections/RegistrationGallery.tsx`
- Modify: `development/apps/web/src/styles/collections.css`
- Modify: `development/vite.config.ts`

**Interfaces:**
- `POST /api/development/v1/collections/assets` stores accepted uploads and returns `{id, name, mimeType, sizeBytes, url}`.
- Validation checks allowed MIME, extension, byte signature, per-file bytes and count before response persistence.

- [ ] **Step 1: Write failing upload tests**

Cover valid image/audio/video/document, disguised executable rejection, size rejection, count rejection, title-pattern rejection, and cleanup after failed response submission.

- [ ] **Step 2: Implement storage and registration upload controls**

Use the repository's configurable local upload directory, randomized storage keys and download route authorization. Add progress, cancel and retry states in the registration form.

- [ ] **Step 3: Run focused and full verification**

Run:

```powershell
npm test -w @freebbs-development/api -- modules/collections
npm test -w @freebbs-development/web -- collections
npm run check
```

Expected: all commands exit 0 with no lint, formatting, typecheck, test or build failure.

- [ ] **Step 4: Perform local visual QA**

Check at 1440px, 1024px, 768px and 390px widths in light/dark themes; verify no horizontal overflow, conveyor edge fade, modal focus, builder drag/click/keyboard flows, direct signup, likes and wallet records.

- [ ] **Step 5: Commit and start preview**

Commit: `feat: complete wanshiji collection workflows`

Start: `npm run dev` in `development` and open `http://localhost:5173/development/collections`.

