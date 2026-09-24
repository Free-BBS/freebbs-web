# UI simplification

## Design

Keep the main site's deep teal navigation, mint accents, serif headings, emblem, and shared light/dark preference. Use a compact context header above a single prominent content heading. Reduce border nesting and shadows, and give secondary metadata a quieter visual treatment.

The current knowledge records lay all children out horizontally; change their presentation to a readable vertical sequence with a wrapping metadata footer. Keep every existing permission check, action, and content field. Keep navigation destinations and accessible labels stable. The dashboard retains recent content and action tips with shorter prose. No API, dependency, database, or production changes.

## Implementation

- [x] Adjust shell dimensions and navigation; style the demo selector and include the visible Chinese label in its accessible name, retaining the legacy English name for browser automation.
- [x] Flatten shared list surfaces and definition lists; organize knowledge content and metadata; simplify dashboard copy and event heading.
- [x] Verify existing component, theme, navigation and module tests, formatting, types and build.
- [x] Inspect before/after screenshots in both themes and at mobile width; exercise navigation and responsive browser tests.

## Acceptance

At 1440px the sidebar is 232px wide and the top bar is compact. At 390px the title and account selector fit without horizontal page scrolling. Knowledge records read top to bottom; lists have one outer surface instead of nested cards. Primary actions remain clear, secondary actions remain reachable, and error, focus, selected and disabled states remain distinguishable.

## Verification

- `npm run check`: passed lint, formatting, types, 643 Vitest tests, 15 operational tests, four workflow tests, and production builds. Ten live-MySQL tests skipped because the integration environment is unavailable.
- Existing `modules.spec.ts` and `responsive.spec.ts`: 11/11 passed with system Chrome against the local memory/demo preview. The temporary configuration reused that preview without changing the repository's CI configuration.
- After the accessible-name review fix, `npm test -- apps/web/src`: 30 files and 168 tests passed.
- Compared desktop light/dark and 390px mobile screenshots of dashboard, knowledge, liaison, events and sports; no horizontal page overflow or uncaught page errors observed.
- Independent read-only review found one accessible-name mismatch, now corrected. API handlers, permission checks and database files are unchanged.
