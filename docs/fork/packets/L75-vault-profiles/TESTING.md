# L75 testing

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
The attachment milestone initially retained dispatch status. Scheduled outcome reconciliation
and recovery are verified below. This does not imply full packet completion.

Launch implementation commits: `e13465b96b` (shared guard) and `975120228e` (client controls).
The final source preview against `v0.1.1-nightly.20261018.3335` reports 57 conflicting files,
including the pre-slice `310570a13f` set of 56 plus the marked
`vault-launch-ui` insertion in `ScheduledTasksSettings.tsx`. Upstream moved the scheduled editor
form, so that control must be placed in its moved prompt section during synchronization. The prior baseline
`v0.1.1-nightly.20261017.3238` still previews cleanly. The existing upstream-sync limitation
remains; no merge or deployment was attempted. The paused QA schedule was deleted after
persistence checks. iOS also displayed the saved reviewed profile in its scheduled editor.

## Portable requirements and scheduled recovery milestone

The focused set passes 49 tests in 8 files: 3 outcome ownership/reconciliation cases, 3 existing
scheduler recovery cases, 31 webhook cases, 3 schedule cases, 1 migration-ledger case, 5 profile
cases, 1 authenticated MCP case and 2 portable protocol cases. These verify exact message/run
ownership; queued, failed, cancelled, interrupted, rolled-back and completed states; restart;
foreign-project and deleted/recreated task denial; change notifications and ownership cleanup;
ordinary prompt/failed dispatch preservation; declaration format/size/unknown-field rejection;
exported binding omission; create-only import conflicts; and local binding repair/resolution.

Scoped contracts, server, web, mobile and client-runtime typechecks pass. Changed-source lint,
mobile native static checks, whitespace, seam counts and packet references pass. No repo-wide
suite, live provider, production deployment or credential registration was used.

The isolated web pass exported a real synthetic bound profile with no IDs/repositories,
rejected an import carrying itemId, reviewed/saved/reopened a fresh unbound Git profile and
exported it again. A paused scheduled task was fired manually twice with a wrong-environment
reference. Both V2 runs failed with zero provider sessions, while the task list/subscription
reported failed and exposed review/retry. Editing saved its revised prompt, and retry preserved
the pause state and counted exactly two dispatches. Desktop-width and 390px recovery layouts
were inspected with no horizontal overflow. Native iOS verified the shared failed result and
saved task editor. After restarting Metro with a clean cache, native copy succeeded and a
portable SSH declaration opened as an unbound profile, reviewed as missing and saved. A concurrent
web archive correctly caused a stale-write conflict first; refreshing/reviewing succeeded. The refreshed task screen showed the explicit native review/save/Run now guidance. Native Run now also retried a second paused QA task, counted two dispatches and opened zero provider sessions. Both QA tasks were deleted; both imported test profiles were archived.

No live successful model completion, native Android, standalone Electron, relay/tunnel transport,
real webhook request or automatic wall-clock firing was exercised in the client pass. Service
and existing scheduler tests cover terminal completion, schedule/webhook dispatch and cleanup.
Raw scheduled_tasks rows and webhook delivery logs intentionally remain dispatch records; task
list/subscribe and Run now show the derived provider outcome. Earlier untracked runs retain
legacy dispatch status. Full packet acceptance remains open.

Implementation: `d015748a84`. After fetching upstream tags, the final merge preview against
`v0.1.1-nightly.20261018.3335` has the same 57 conflicting files as pre-section `5651900126`;
this section adds no conflicting files. Existing scheduler form/seam conflicts still need porting
in the upstream-sync task. `v0.1.1-nightly.20261017.3238` still previews cleanly. No working-tree
merge was attempted. No push, PR or deployment was performed.

## Retained-selection milestone

The current integrated set passes **46 tests in 11 files**, shared with the dedicated GitHub
milestone in [L82 testing](../L82-vault-connectors/TESTING.md). Retention coverage proves exact
selection inspection, active and unavailable run denial, terminal-only eligibility, current CAS,
permission denial, actor-bound replay, metadata tombstones, no same-run reselection and fresh-run
resolution. Authenticated MCP denies agent history inspection and permits human administrators.
Destination-specific client permission tests observe grant loss. Scoped consumer typechecks,
changed-source lint and mobile native static checks pass.

Web verified pinned-binding expansion, cancel/confirm retirement, tombstone display and 390px
layout with synthetic snapshots tied to existing isolated failed runs. OpenBao fixture seeding
establishes UI states only; service tests establish the state-transition behavior. Retirement
leaves older OpenBao versions and never claims erasure or provider revocation. Native iOS verified pinned metadata, the first web retirement, cancel/confirm retirement of the
second synthetic selection and refreshed tombstones without binding details. No automatic
retention is enabled.

The latest baseline preview against `v0.1.1-nightly.20261019.3348` has 60 conflicting files at
parent `78c8d44b17`. This section adds no upstream seams; its committed preview has the identical
60-file conflict set with no new conflicting files. The existing upstream synchronization remains separate work.

## GitHub profile binding milestone

The focused integrated set passes **35 tests in 9 files**: GitHub profile service/MCP/preflight,
GitHub connection service, existing profile MCP/launch/prompt services, portable contracts and
client permission/refresh regressions. New cases exercise local previews without provider calls,
missing/wrong-kind/invalid-repository bindings, exact use grants, pinned versions across service
reconstruction and profile edits, named GH without an SSH broker, mismatched operation kind,
archive/version/run/grant changes during token acquisition, scoped cleanup, launch denial/repair,
authenticated MCP execution and create-only portable GitHub import followed by local repair.

```sh
node_modules/.bin/vp test run apps/server/src/fork/vault/VaultGitHubProfiles.test.ts apps/server/src/fork/vault/VaultGitHub.test.ts apps/server/src/fork/vault/profile-mcp.test.ts apps/server/src/fork/vault/VaultPromptContext.test.ts apps/server/src/fork/vault/VaultLaunch.test.ts apps/server/src/fork/vault/VaultProfiles.test.ts packages/contracts/src/fork/vault-profiles.test.ts packages/client-runtime/src/fork/vault-profiles.test.ts packages/client-runtime/src/fork/vault-profiles.permissions.test.ts
```

Scoped contracts, client-runtime, provider-core, server, web, mobile and desktop typechecks,
changed-source lint and mobile native static checks pass. The native fingerprint is compatible;
no rebuild was needed. No repo-wide suite was run. The service test fixture now composes the
GitHub external adapters explicitly; unrelated synthetic connection tests keep their own adapters.

Web verified selecting a synthetic dedicated connection/repository, configuration-only review,
save/reopen, version 2 export without local bindings, fresh unbound import, local repair and
thread-specific denial without grants. Desktop-width and 390px layouts were inspected; picker
action labels were shortened with contextual accessible names. Native verified the shared
GitHub profile, dedicated connection/repository picker and configuration review. A
concurrent web import correctly rejected the stale native registry update; the editor was
refreshed before retry. Native then saved and reopened the persisted GitHub connection/repository. After a cold
launch, unbind/rebind, thread selection, denied-grant review and another save/reopen passed.
The editor uses the existing full-screen modal pattern with fixed review/save controls:
its former nested sheet measured beyond the visible detent and clipped those controls.
Connection and thread selection now use pages in the same modal, avoiding
native-sheet touch delivery across modal roots.

The GitHub record was seeded directly into disposable OpenBao and is not a working provider
credential. Client QA proves management wiring, not successful live provider authentication.
No live GitHub write, provider model, production state, deployment or personal-vault change was
used. Successful named execution and launch boundaries use real services with synthetic API/CLI
adapters. Live API/CLI health, terminal gh/Git HTTPS, Android, standalone Electron and relay/tunnel
transports are not independently verified here. Other selected packet scope remains open.

After fetching tags, parent `c1a61e657a` has **61 baseline conflicts** against
`v0.1.1-nightly.20261019.3360`. This section changes no upstream-owned source or seam manifest;
the committed preview has the same 61-file conflict set, with no added conflicting files.
No working-tree merge,
push, PR or deployment is authorized by these checks.
