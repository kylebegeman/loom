# L77 testing

Status: acceptance targets for this packet. No complete packet implementation has been verified.
Shared foundation checks are recorded in L79; they do not establish this packet's acceptance.

## Automated behavior

- One hundred identical failures create one active issue.
- A network outage never marks an item revoked or triggers destructive repair.
- Snooze expiry, unsnooze and resolution use a controlled clock; concurrent rechecks cannot reopen a newer resolved issue.

Add service and adapter contract tests beside the future fork-owned implementation. Use
synthetic credentials and disposable services. Assert that normal responses, persisted events,
logs and error summaries contain no secret values. Exercise permission ceilings and server
capability absence, not static markup or callback wiring.

## Manual and integrated acceptance

Seed expired, soon-to-expire, unused and healthy synthetic items. Repair one from mobile and verify all clients converge without notification bursts.

Run one integrated client pass after implementation is assembled, with Kyle's authorization for
browser/device use. Cover web, Electron shell and native mobile where this packet claims them,
plus a remote client and upstream-server compatibility. Verify keyboard operation, readable
errors, focus restoration and every reverse action.

## Focused verification

Use `./node_modules/.bin/vp test run` with these actual targets:

- `apps/server/src/fork/vault/VaultHealth.test.ts`
- `apps/server/src/fork/vault/health-observation.test.ts`
- `apps/server/src/fork/vault/VaultGitHub.test.ts`
- `apps/server/src/fork/vault/VaultLaunch.test.ts`
- `apps/server/src/fork/rpcAuthorization.test.ts`
- `apps/web/src/fork/commandPalette/registry.test.ts`
- `apps/web/src/fork/settings/registry.test.ts`
- `packages/client-runtime/src/state/commandPermissions.test.ts`
- `apps/server/src/fork/mcp/registration.test.ts`

Run scoped lint and typechecks for server, web, mobile, contracts and client-runtime,
plus `vp run lint:mobile`. No repository-wide checks are required for this slice.
Documentation link and seam-manifest validation cover fork integration. No new upstream
seam is introduced by health. Runtime archive startup smoke for the earlier MCP correction
passed on all three platforms in published 0.0.85-nightly.20261019.3348, reported by its owner.

## Local implementation evidence, 2026-10-20

Focused service/observation/GitHub/launch/permission/palette/settings checks passed: 63 tests
in nine files. Controlled-clock and Deferred tests cover 100 repeated failures, separate
network outages, snooze/reverse actions, stale revisions, rate limiting, removed/replaced
selection and rejection of an old probe after newer resolution. Observation tests preserve
remote outcomes when the health store fails and reject nonzero child exits as proof of health.
A real connector-observer regression first reproduced an old probe reopening a newer resolved
issue. Carrying its claim through the observer fixed that case. Unconfigured and rate-limited
rechecks return distinct results. The real fork MCP registration test passed and is required
before every push touching tools.

Server, web, mobile, contracts and client-runtime typechecks passed. Scoped lint passed;
mobile native static checks passed with no violations. Two prior terminal test-layer composition
warnings were corrected; the terminal/Claude files passed 291 tests and the server typecheck.

The integrated web pass used synthetic records and disposable OpenBao. It covered empty state,
rule save, explicit expiry check, rate-limited recheck, snooze/unsnooze, dismiss/history/reopen,
and access-review navigation with focus on its settings section. Startup reloads during source
watch restarts caused transient disconnects; after the server settled, the flow completed.

Native iOS interaction verification is pending: `mobile-native-client.ts check` reports the
installed client stale, and Kyle's current instruction forbids installation. No native build
or installation was attempted. Electron shell, remote/relay and upstream-server interaction checks are not claimed.
Current profile/grant references and paged retained selection inspection are implemented below.
External consumers remain undiscovered.

## Project reference follow-up

The context/service/health/profile/permission/registry/MCP check passed 52 tests in eight files.
The service test covers ten-project pagination, matching requirement names, project/thread
grants with explicit inactive states, changed bindings, missing items and unavailable registries.
Server, web, mobile, contracts and client-runtime typechecks passed; web/mobile were rerun
after capability gating. Scoped lint passed. No native module changed; the preceding native
static pass remains applicable.

The integrated web pass reached an empty project-reference page for a synthetic GitHub item,
including its inspected count, timestamp, caveat and disabled final-page navigation. Matching
reference cards were subsequently verified with a synthetic profile saved through the normal
service command. Retained-selection project choice and its empty page also passed. Project-review
navigation now opens the selected Vault profile and focuses its section. Native interaction remains pending under the no-install
restriction. Source-watch ownership and stale Vite optimization interfered with local QA;
reusing the existing isolated server and forcing optimization restored the client without
installation. No production state or Library service changed.

## Retained selection follow-up

Ten tests in the context/profile/MCP files passed, plus 36 permission tests in two files.
The new regression verifies matching pinned versions after current bindings change, stable page
cursors, unmatched entries, retired attribution counts and explicit backend failure. Existing
profile tests cover pin retirement and current run authority. All five affected package
typechecks and scoped lint passed. No application schema migration or native module changed.

Web acceptance used the existing isolated OpenBao fixture. A normal profile command added a
synthetic GitHub binding; the inbox displayed its matching profile/requirement card. Choosing a
scanned project displayed its retained-selection count, empty state and final-page controls.
The first review attempt exposed a global-settings scope mismatch. The corrected handoff
retains the requested project in the Vault navigation atom and routes by environment. A fresh
web pass opened the selected profile, displayed its saved requirement and focused the profile
section. The web typecheck and scoped lint passed after this correction.
Matched retained selection cards and native interaction retain service/static evidence only.
