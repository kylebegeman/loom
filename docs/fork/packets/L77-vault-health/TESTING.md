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
Matched retained cards and the review/retirement handoff now have web acceptance below. Native interaction retains service/static evidence only.

## SSH validation follow-up

The health/context/GitHub/observation/permission/MCP run passed 55 tests in seven files. The
synthetic SSH adapter regression verifies item-kind rejection, explicit opt-in, no background
probe while disabled, timeout versus configuration classification, successful resolution and
mutually exclusive validation. It calls no SSH binary or remote host. After replacing an
incompatible union of Effect success types with one composed effect, seven health/observation
tests and the server typecheck passed. Web, mobile, contracts and client-runtime typechecks
and scoped lint also passed. No native module changed.

Web acceptance generated an untrusted synthetic Ed25519 key using the normal service command,
then saved SSH validation with automatic checking off. Switching away and back confirmed the
stored option; disabling and saving also passed. No explicit probe was clicked and no SSH
command ran. Live SSH acceptance and native interaction remain unverified under Kyle's current
no-SSH/no-install restrictions. The existing fixed probe remains responsible for actual target,
version and trusted-host revalidation. Production policy and deployment remain with the host owner.

After merging current fork main's runtime-owner/update changes, 36 tests in seven affected
merge/health/MCP files passed. The real fork MCP registration check is included in that run.
All five affected package typechecks and scoped Vault lint passed on the merged tree.
`vp run lint:mobile` also passed, including SwiftLint, ktlint and detekt. No live installation,
SSH execution or production check was performed.

## Discovery coverage follow-up

Ten focused service/client/MCP tests in three files passed. Coverage verifies missing/deleted
thread and project attribution, valid references on later pages, environment-wide grant counts,
empty final pages, retired snapshot limits and older response compatibility. The server fixture's
deleted-thread date was corrected to the actual Effect UTC type; all five affected package
typechecks then passed. Scoped lint, changed-document links and all 390 seam rows passed.

Web acceptance expanded the current issue, displayed current-page scope and external/provider
unknowns, then selected a scanned project and verified the same limits on an empty final
retained-selection page. Unattributed-grant counts and legacy-server messaging have service/shared
client coverage; their interactive states were not seeded in this pass. Mobile shares the coverage
formatter and passed its package typecheck; native interaction remains pending because its
installed client is stale and Kyle's no-install restriction remains in force. No live SSH command,
provider validation, schema migration or production action was performed.

After merging fork main `e970ee0c25`, 71 tests passed in eight focused coverage/MCP/feature,
Directory service/HTTP and utility registry/runtime files. All five affected package typechecks,
scoped Vault lint and the documentation/seam check passed on the merged tree. Main's Directory
and utilities work was preserved. This Vault slice adds no Library deployment requirement.

## Matched history and recovery acceptance

The focused history/context/profile/shared-client run passed 18 tests in five files. The new
real-service history regression resolves a run, edits current bindings, inspects the earlier
profile/item versions, rejects an invalid retained record, recovers after repair and retires the
stopped selection through the profile service. Its transport fails if inspection attempts SSH.
Shared mounted-query tests cover unavailable and invalid-response failures followed by refresh
of the same project/cursor. They verify that a failed result can retain cached data, so clients
must check its success state before rendering it. Four affected package typechecks and scoped
lint passed. No contracts or application schema changed.

Web acceptance used 27 synthetic OpenBao selections and existing stopped runs in the isolated
worktree database; SQLite was read-only and no provider ran. The first page contained 25
unmatched/retired entries with a usable continuation. The next page displayed two matching
failed runs, earlier profile version 3 and item version 4. Injecting one invalid fixture record
produced a read error without a false empty state. Repair and refresh recovered those matches.
The review handoff selected the same project, exposed the pinned bindings, supported cancelling
retirement, and retired one synthetic stopped selection. Returning to maintenance showed its
snapshot as unattributable. External consumers remained not discovered, provider copies unknown
and current authorization not evaluated.

This pass found that the linked profile-history view rendered cached cards and enabled retirement
controls after a failed refresh. Both web and mobile now require a settled successful read before
rendering cards or using its continuation. The corrected web pass showed an error with no old
cards, no empty-success message and no enabled retirement action, then recovered on refresh.
A concurrent fixture-version change rejected retirement with a conflict; refresh cleared that
mutation error and its confirmation without retiring the second selection. Native interaction
remains pending under the no-install restriction. Production, relay/tunnel, live providers and
other validation adapters are not established by this evidence.

After merging fork main `967d8875d8`, 80 tests passed in ten focused history/context/profile,
shared-client, MCP registration, preview MCP/gateway/host and Library publisher files. All five
affected package typechecks, scoped Vault lint and documentation/seam checks passed. Main's
preview and Library changes were preserved; this Vault slice adds no Library deployment work.
