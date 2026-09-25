# Development Center Integration Plan

**Goal:** Ship the development center as a peer application inside `freebbs-web`, while keeping its deployment, data, access list, roles, and administration independent from the learning center.

**Architecture:** The repository contains the development center as a nested workspace under `development/`. The main frontend server serves its compiled SPA at `/development/`, while `/development` remains the existing construction page. The main backend mounts the compiled development API and injects two narrow adapters: verified main-site identity and a read-only main-site user directory. All development access, role assignments, preview state, business data, and audit records remain in development-owned tables and code.

**Security:** Every development API request resolves the real main-site bearer token first. A development-owned allowlist is checked on the server before any subject or business data is returned. Only an active development lead can manage access/roles or provide `X-Development-Preview-Uid`; client-side controls never grant permission. Non-allowlisted accounts receive `preview_access_denied` and return to `/development`.

## Work items

1. **Import the current development worktree**
   - Copy source, tests, assets, migrations, and package locks into `development/` without generated files or local secrets.
   - Preserve the current UI and all uncommitted development features.

2. **Add development-owned access control**
   - Add a migration and store records for allowlist entries with `member` or `lead` access.
   - Seed student `2023010567` / username `Yuchong` as the initial development lead.
   - Resolve and claim the seed against the stable main-site UID on first successful login.
   - Fail closed for missing/inactive access and prevent deletion of the last active lead.

3. **Add controlled identity preview**
   - Extend the main identity adapter with student number and username.
   - Honor the preview header only after authenticating an active development lead.
   - Load the target user's real development role/tag assignments while retaining separate viewer metadata for the exit-preview control.
   - Keep the old demo switcher limited to local demo mode.

4. **Build development system settings**
   - Add a bottom-sidebar “系统设置” entry visible only to development leads.
   - Show the main-site user directory together with development access and assigned identities.
   - Support access grants/revocation, the existing center member/director/lead roles, Youth League lead, sports captain scope, and development lead status.
   - Add a lead-only preview action and a persistent exit-preview banner.

5. **Wire the main-site entry and runtime**
   - Keep `/development` as the construction page and add a small access probe that redirects eligible users to `/development/`.
   - Permit safe login return paths under `/development/`.
   - Serve the compiled SPA with history fallback.
   - Mount the development API in the existing backend process using injected identity/directory adapters, without granting learning-center administration.

6. **Update build and deployment**
   - Install, test, and build the nested development workspace in CI.
   - Build and prune the nested workspace during deployment while retaining the current two-service topology.
   - Run development migrations with a development-specific migration ledger so it does not conflict with the main site's ledger.

7. **Verify and publish**
   - Add focused API, UI, entry-gate, static routing, and deployment tests first.
   - Run both projects' checks/builds and relevant integration suites.
   - Review the final diff, commit, push through the configured Clash proxy, and open a PR against the latest `Free-BBS/freebbs-web` main branch.
