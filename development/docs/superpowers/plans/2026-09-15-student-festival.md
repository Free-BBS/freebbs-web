# Student festival submissions

## Design

Add a warm-accent pinned activity-page link to `/events/student-festival`, titled 「我要上学生节」特别栏目. A submission form accepts title, description and one MP4/WebM/MOV video (100 MiB maximum) with an unchecked 「我愿意即时展示」 checkbox explicitly explained as subject to review. The page shows an approved, consented video feed newest first, a submitter's own receipt/status list (no private video access), and a reviewer-only queue including private submissions.

Review/private access is limited to department.arts_member, department.arts_director, domain.arts_lead, affiliation.tuanwei_lead and platform.super_admin. The user explicitly included the Youth League lead. No unrelated department/lead gets access. Public display means visible to authenticated site users. Non-consented works are never publishable; reviewer rejection/approval applies only to pending consented works, with audited transitions and an option to remove a published work. Submitters see receipts/status but private video access remains reviewer-only as requested.

Persist metadata through both existing memory and MySQL stores and a new migration. Store uploaded bytes outside static roots in a configurable persistent directory, with generated file keys, size/type validation, failure cleanup, protected media requests and no-cache headers. The browser loads an authenticated video blob only when the viewer clicks play and revokes object URLs when removed. Native authenticated blob playback avoids putting credentials in URLs. Serve MP4/WebM/QuickTime media; recommend MP4 for browser compatibility. Never autoplay a feed of videos.

## Implementation

- [x] Add shared submission contract and memory/MySQL persistence with migration tests.
- [x] Add upload, listing, review, removal and authenticated media API with privacy/consent/validation tests.
- [x] Add activity entrance and submission/feed/reviewer UI with loading, validation and retry states.
- [x] Update deployment upload limits/storage documentation and run full checks plus browser upload/review/privacy verification.

## Verification

`npm run check` passed: lint, formatting, type checks, 687 unit/integration tests, 15 operations tests, 4 workflow tests, API and Web production builds. Ten existing MySQL-dependent tests were skipped; a live MySQL migration run remains unverified locally.

Ten Chrome browser regressions passed across student festival, activities, discovery and responsive navigation. The festival tests upload and play a real WebM, verify Youth League lead approval and removal, and check private media access on mobile. Light/dark activity entrances and the mobile submission form were visually inspected.

## API contract

Base `/api/development/v1/events/festival`.

- `GET /submissions?view=showcase|mine|review&page=1`: `{ items: FestivalSubmission[], page, pageSize: 12, total, canReview, maxUploadBytes }`. Non-reviewers cannot request review view. Mine is owner receipts only with `canViewMedia=false` unless published or reviewer.
- `POST /submissions`: multipart fields `title`, `description`, `displayConsent` string true/false and file field `video`. Returns FestivalSubmission with private or pending status.
- `POST /submissions/:id/review`: `{ decision: 'approve'|'reject'|'unpublish'|'reapprove', note: string }`. Only allowed reviewer roles; all decisions require explicit display consent. Initial approve/reject requires pending status; unpublish changes approved to rejected; explicit reapprove changes rejected back to approved. Transactions re-read/lock and audit, so a stale initial approval cannot override a rejection.
- `GET /submissions/:id/media`: authenticated byte response, private/pending/rejected only reviewer roles; approved+consent visible to authenticated users. No storage keys in public DTOs.

Shared DTO fields: id, title, description, authorName, ownerUid, status ('private'|'pending'|'approved'|'rejected'), displayConsent, mimeType, sizeBytes, createdAt, updatedAt, reviewedAt (nullable), reviewNote (string), canViewMedia (boolean). DB adds storageKey, reviewerUid nullable and StoredRecord scope metadata.
