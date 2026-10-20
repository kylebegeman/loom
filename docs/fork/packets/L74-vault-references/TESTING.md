# L74 testing

## Attachment button removal

The dedicated Vault attachment buttons and dialogs are removed from web/desktop and mobile
composers and scheduled-task editors, with no replacement control. Historical picker acceptance
below describes the earlier UI. Existing prompt-link parsing and server preflight are unchanged.
Web and mobile package typechecks pass. Changed-file lint has no errors; two existing mobile
composer warnings remain outside the removed code. Seam and whitespace checks pass. No browser
or simulator pass was run for this removal.

Status: **Local milestone verified; full packet acceptance remains open.** Synthetic state only.

## Automated evidence

The focused integrated set passes **49 tests in 10 files**: profile service, reference service,
profile MCP, launch, SSH, RPC authorization, client-runtime permission/refresh and web registry
coverage. Profile cases include CAS/idempotency, project isolation, incomplete previews,
durable pins across reconstruction, later edits/default changes, live grant denial, key-version
conflicts and archive between resolution and signing. Named SSH/Git execution closes sessions.
Reference cases cover inspect filtering, forbidden/unknown null, rename/archive, canonical
reference search and sparse pagination. Shared mounted queries refresh after core/SSH changes;
profile writes fail after permission loss.

```sh
node_modules/.bin/vp test run apps/server/src/fork/vault/VaultProfiles.test.ts apps/server/src/fork/vault/VaultReferences.test.ts apps/server/src/fork/vault/profile-mcp.test.ts apps/server/src/fork/vault/VaultLaunch.test.ts apps/server/src/fork/vault/VaultSsh.test.ts apps/server/src/fork/rpcAuthorization.test.ts packages/client-runtime/src/fork/vault-profiles.test.ts packages/client-runtime/src/fork/vault-core.refresh.test.ts apps/web/src/fork/settings/registry.test.ts apps/web/src/fork/commandPalette/registry.test.ts
python3 apps/server/src/fork/vault/testkit/ssh_proof.py --bao /absolute/path/to/bao
```

The second command passes **3 real OpenBao/SSH/Git tests**, including named profile Git ref
listing, repeated fetch, trust/version/revocation checks and cleanup. It runs a disposable
server/repository and does not register a real account. Relevant contracts, server,
client-runtime, web, mobile, desktop and provider-core typechecks pass. Changed-source lint and mobile
native static checks pass. No repo-wide checks or production actions were run.

## Terminal completion evidence

Seven focused CLI cases exercise a real disposable loopback MCP endpoint and the actual Loom
CLI child. Structured/text responses, sparse continuation, bounded scans (four requests), output
caps (20 references), deduplication, canonical-reference enforcement, mixed-environment refusal,
archived response refusal, cursor loops, missing credentials and tool failures are covered.
Child-process failures assert exit 1, empty stdout and one fixed stderr message for tool refusal,
malformed responses, missing connections and JSON-RPC errors containing a synthetic private body.
The CLI prints no item labels, server error bodies or credential values. It uses only its
inherited authenticated environment and never installs a shell function or edits a startup file.
Parse failures (leading dash, invalid kind and unknown flag) assert exit 1 and empty stdout;
help is routed to stderr at the CLI boundary. A query after `--` stays literal. The actual child also verifies the new account-discovery CLI alias uses the existing agent tool.

```sh
cd apps/server
../../node_modules/.bin/vp test run src/fork/vault/references-cli.test.ts
```

This provides newline completion candidates for a terminal picker or completion integration.
It does not modify the user's shell or complete an arbitrary embedded JSON argument. Use the
existing paged reference search for results beyond the bounded candidate scan. Reference-service
regressions cover canonical prefixes and mismatched environments. Wrappers must replace a label
query with the canonical candidates, not apply shell prefix filtering to the original label.

## Client evidence and limits

Web management verified at desktop and 390px width: create/review/save an incomplete profile,
edit and choose a referenced key, denied-thread preview, save, set default, archive/restore,
clone/cancel, reference search/copy and empty results. The narrow view has no horizontal
overflow. The authorized iOS pass verified reference copying, project selection, native
profile creation, nested key selection, host-only review and successful save. Metro required
a cache reset after serving an outdated module graph. The native client fingerprint matched;
no rebuild was needed. The isolated environment remains available for iteration.

Electron shell, Android, relay/tunnel paths, screen readers, live provider models and scheduler
launch are not independently verified by these checks. Services and shared web/native state
cover their common paths; this is not evidence of full platform acceptance. Other credential kinds, portable declarations and production recovery remain open. Explicit
composer/scheduled prompt selection is verified below.

## Merge safety

Implementation `9928a8072f` was previewed against `v0.1.1-nightly.20261018.3335` after fetching
upstream tags. The preview reports **56 conflicting files**. The pre-slice parent
`6e3301e02f` reports the identical 56-file conflict set; this slice adds no conflicting files
and touches no new upstream seams. The existing fork needs a separate upstream synchronization
before a clean landing rehearsal. This is a baseline integration limitation, not a clean-merge
claim. No worktree merge was attempted; Kyle's upstream-integration work owns its resolution.

The prior baseline nightly `v0.1.1-nightly.20261017.3238` merges cleanly in a read-only preview.

## Launch attachment milestone

The combined focused coverage is **49 tests across 7 files**: the 30 ProviderTurnStart cases
(including two blocked-launch seam regressions), 4 prompt-link cases, 3 real-service guard cases,
1 steering seam case, 4 profile cases, 6 launch cases and the existing control regression.
The new cases prove no-provider-open on invalid/unavailable requirements, inspect-denied and
archived references, exact run pinning, reviewed-version conflicts on later scheduled firings,
revocation and unchanged ordinary text. Removal preserves blank lines in user code.

Web and native iOS verified attachment discovery, denied-profile review, referenced-key
selection/removal and safe draft labels. A real isolated-server submission with no inspect
grant failed before provider open and displayed the safe blocked-run explanation in both
clients. The web scheduled editor attached a host-reviewed profile, saved it on a paused test
task and retained the exact profile/version on reopening. No task was enabled or fired. Desktop
and 390px responsive web are shared surfaces; standalone Electron/Android and a live scheduler
firing are not independently verified. No live provider model or personal credential was used.

Scoped server/web/mobile/contracts/provider-core typechecks, changed fork-source lint and
mobile native static checks pass. The server check exits 0 after composing the launch/reference
test-fixture layers explicitly; it has no errors or warnings. Affected fixture and guard
regressions also pass. Upstream mobile ThreadComposer retains its pre-existing
React hook/compiler warnings outside the added import/control seams. Seam rows/marker counts,
packet links and whitespace are checked. No repo-wide check was run.

The final launch commits are previewed separately against the newest upstream nightly and
compared with their pre-slice parent. Any baseline conflict remains an upstream-sync task.
The scheduler's dispatch-success status is not end-to-end run completion; outcome reconciliation
is the next proposed work section. This does not imply full packet completion.

Launch implementation commits: `e13465b96b` (shared guard) and `975120228e` (client controls).
The final source preview against `v0.1.1-nightly.20261018.3335` reports 57 conflicting files,
including the pre-slice `310570a13f` set of 56 plus the marked
`vault-launch-ui` insertion in `ScheduledTasksSettings.tsx`. Upstream moved the scheduled editor
form, so that control must be placed in its moved prompt section during synchronization. The prior baseline
`v0.1.1-nightly.20261017.3238` still previews cleanly. The existing upstream-sync limitation
remains; no merge or deployment was attempted. The paused QA schedule was deleted after
persistence checks. iOS also displayed the saved reviewed profile in its scheduled editor.

CLI test children resolve bin.ts from import.meta.url. Package-directory verification runs from
apps/server: references-cli (seven) and TerminalConnection (four) pass eleven tests; the two real SSH-agent
integration cases remain deliberately skipped without their explicit disposable SSH configuration.
That integration file uses the same file-relative entrypoint. No install, SSH probe or production
state is needed by the applicable CLI tests.
