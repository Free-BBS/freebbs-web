# Daily discovery and Free BBS Map

## Design

Place a compact daily discovery card above the activity list and a Free BBS Map action in the page header. Keep the teal/serif styling and move preferences into the existing accessible drawer. Read only published general knowledge, active interest groups and published current/upcoming activities through existing authorized APIs. Requests are independent so an unavailable module does not break the rest. Never recommend past or invalid dated activities.

Users select content types, up to eight interest keywords, a 7/30/90-day activity window and whether to mix in unrelated discoveries. Store explicit preferences per account in this browser; do not infer interests from roles or track browsing. Deterministic weighted daily ordering makes the first result stable on refresh, and “换一个” walks the whole eligible pool without immediate repeats. Explain matching keywords or exploration reasons. Handle local-storage failures, empty pools, partial errors, retries and identity changes.

Site configuration lives in `apps/web/src/modules/discovery/site-config.ts`: enabled switch, allowed kinds, excluded candidate keys and suggested interests. Map URL is deployment configuration `VITE_FREE_BBS_MAP_URL`; accept HTTPS links without credentials. The user clarified the name is **frEE bbs MAP** and the mini-program is not yet published/registered. The action displays “即将上线” and explains its unreleased status until a real URL is configured. No fabricated destination or unavailable search instruction.

## Work

- [x] Add model and interaction tests and verify the expected failures.
- [x] Implement normalization, deterministic recommendations, account-scoped preferences and configuration.
- [x] Implement discovery drawer/card, map action and navigation to a specific group.
- [x] Verify repository checks and browser interaction/refresh/mobile layouts; document configuration.

## File responsibilities

- `discovery/model.ts`: candidate normalization, filtering, stable weighted ordering and preferences.
- `discovery/site-config.ts`: site defaults and map URL validation.
- `discovery/DailyDiscovery.tsx`: authorized data loading, recommendation presentation and preference editing.
- `discovery/FreeBbsMapAction.tsx`: configured external link or honest unavailable dialog.
- `styles/discovery.css`: compact responsive presentation.
- Existing `EventsPage`, `ClubsPage`, `main.tsx`: integrate discovery, targeted group query and styling.

## Verification

Full repository check passed: lint, formatting, type checking, 660 tests (10 skipped), 15 operations tests, 4 workflow tests and production builds. All 8 related browser flows passed, including two mobile checks rerun after the concurrent contracts build temporarily restarted the local API. New browser coverage verifies deterministic refresh, rotation, persisted preferences, targeted group navigation, empty-state recovery and the unreleased Map dialog. Desktop light/dark and mobile screenshots have no page errors or horizontal overflow; corrected inherited checkbox and Map-button styles after visual inspection. Reviewer findings for a stalled source and stale activity status were reproduced with failing tests and fixed with independent bounded requests and shared activity data.
