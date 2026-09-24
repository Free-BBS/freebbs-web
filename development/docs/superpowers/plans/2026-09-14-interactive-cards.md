# Interactive cards and navigation

## Design

Keep the established teal/serif light-and-dark visual system. Navigation becomes knowledge, information, resources, sports, events, interest groups, followed by permission-gated governance modules. Only the resource display name changes; stable module IDs and URLs remain compatible.

Knowledge becomes a grid of linked preview cards. Each title link covers its card through a stretched hit area, with management buttons above that hit area. A dedicated `/knowledge/:entryId` reader loads the requested entry from the existing authorized audience list. Social-organization links retain `audience=social_org`; back navigation preserves the audience. Refresh, loading, missing/inaccessible, error/retry and stale request handling are explicit. Plain-text content is rendered safely without HTML injection.

Activity cards use a calendar stamp, status, title, concise introduction, time/place and registration area. Secondary schedule/contact fields use a disclosure; authorized maintenance and technical support use a separate disclosure. Existing handlers and server confirmation remain authoritative.

## Work

- [x] Add failing tests for route registration, linked knowledge previews/readers, navigation order/name, and activity disclosure presentation.
- [x] Implement knowledge model/reader, card previews, activity presentation and navigation changes.
- [x] Update existing browser flows for intentional disclosure interactions; test direct entry refresh and keyboard access.
- [x] Run repository checks, module browser flows and responsive visual inspection. Present optional playful features as suggestions only.

## Verification

`npm run check` passed: lint, formatting, type checking, 650 tests (10 skipped), 15 operations tests, 4 workflow tests, and production builds. Related browser coverage passed for activity and knowledge lifecycles, module navigation, responsive layouts, and the three new reader flows. The reader checks cover keyboard activation, preview-area clicks, separate editing, refresh, browser Back, retained audience, and denied access. Desktop light/dark and mobile screenshots showed no horizontal overflow or page errors. Review findings for description CSS specificity and audience history were fixed before the final reader run.
