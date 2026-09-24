# Center roles and festival review entry

**Goal:** Make all four centers' member/director/lead identities available and make the festival review entry discoverable.

**Design:** Retain the existing twelve governed roles and organization scopes. Share the demo identity catalog between API authentication, memory fixtures and Web selection; extend SQL demo fixtures for matching MySQL previews. Display Chinese center and rank names. Do not broaden festival access beyond arts member/director/lead, Youth League lead and super admin. Add a header review button for reviewers which selects and focuses the review section below the upload form.

**Verification:** Integration tests must resolve each of the twelve center identities to exactly its assigned role and organization tag, verify festival review access for arts and denial for the other three centers, and check the top-level UI action. Run project checks and browser tests with actual arts identities.

- [x] Add regression tests for complete center identity coverage and top review entry.
- [x] Implement the shared identity catalog and synchronize memory/SQL previews and Chinese role labels.
- [x] Add the header review action and permission guidance, preserving private submission behavior.
- [x] Run checks, browser review flow and document the outcome.

`npm run check` passed with 690 tests, 15 operations checks, 4 workflow checks and production builds. Ten existing MySQL-dependent tests remained skipped. The SQL demo fixture passed the actual seed statement parser (31 INSERT statements); a live MySQL seed run was not performed.

All three festival browser cases passed, including the arts member header action on desktop/mobile, all twelve center selectors, other-center exclusion, Youth League review, real video playback and private media restrictions. Four existing permissions browser cases passed on the first run; the fifth exposed an obsolete eight-user assertion, which was updated to sixteen and passed on rerun. Desktop and mobile review header screenshots were inspected.
