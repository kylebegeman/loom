# L84 testing

Status: **Local pool and authenticated run reservation milestones verified within the limits below.** Full
packet acceptance remains unfinished. Implementation base is current fork main `4070ef99a2`.

## Python requirement for mail proofs

The Migadu Python suites and the broker/mail cases in `VaultTestAccountWorkloads.test.ts`
require **Python 3.13 or newer**, with that interpreter available as `python3` on `PATH`.
The TypeScript suite launches `python3` directly; macOS `/usr/bin/python3` 3.9 is insufficient
and produces the adapter's deliberate unavailable result. Select an installed 3.13+ Python
in the shell before running either suite. Check from `apps/server`:

```sh
python3 -c 'import sys; assert sys.version_info >= (3, 13), "Python 3.13+ must be python3 on PATH"'
../../node_modules/.bin/vp test run src/fork/vault/VaultTestAccountWorkloads.test.ts src/fork/vault/SyntheticCleanupBarrier.test.ts
```

## Selected Loom target evidence

On 2026-10-20 the operator-only `loom_test_instance.py prepare/start/prove` workflow ran against
its own `.t3/vault-app-test` home, backend `127.0.0.1:15713`, web `localhost:7673`. This is a
second target application, separate from the earlier Vault controller QA instance. It seeds one
synthetic project and three stopped threads through the existing fixture seeder. The sample
workspace has its own local Git repository with no remotes, preventing ancestor-repository discovery. All configured
agent providers are disabled; inherited personal credentials and root `.env` loading are excluded.
No real userdata, production identity, Library or OpenBao backend is used by the target.

The actual session proof passes: unauthenticated shell access refuses; a five-minute
`orchestration:read` session reads the three stopped fixture threads; access administration
refuses; revocation makes the original credential refuse; a new session works while the old one
continues to refuse; final cleanup removes every active session for that invocation's subject
and the replacement then refuses too. The output contains no credential. This proves real Loom
runtime session provisioning/reset, not an email/password account, browser logout, pool-integrated
provisioning, app-data reset or durable broker cleanup. A crashed operator proof can leave its
session until the five-minute TTL. No execution, resumption or allow-once flag changes.

Fifty-six focused local-target Python cases pass from `apps/server`, also with `TMPDIR=/var/tmp`
to exercise macOS's `/var` symlink. Cases cover independent Git metadata, core.worktree escapes,
foreign common/absolute Git directories, symlinked objects/refs, alternates, owned interrupted-init
repair and unowned-init refusal. Start refuses a live PID and creates the HOME/XDG/gh sandbox;
its environment restricts Git transport to file. Atomic JSON publication preserves existing
settings on interrupted writes and leaves a new home retryable. Invalid seed markers are
preserved with unmarked databases before reseeding; incomplete unmarked settings recover.

The proof's negative cases separately refuse replacement HTTP failure, overbroad issued scopes,
foreign subjects, non-string token/session IDs, reused replacement IDs and a cleanup revoke that
appears successful while re-list still retains the session. Earlier unauthenticated/admin access,
thread count, active runs, revoked originals, final replacement cleanup, lost mint, origin,
environment identity, private-output and redirect/proxy cases remain.

An in-memory mutation pass removed or weakened each review safeguard without changing the
worktree source. All **22 mutants were killed** by the named regressions below; these are
synthetic tests, not additional live target or mail acceptance.

| Re-review item | Removed/weakened behavior caught by the tests                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1              | Replacement-session HTTP 200 requirement.                                                                                             |
| 2              | Exact read-only scopes, invocation subject, token type and session-ID type, each separately.                                          |
| 3              | Distinct replacement-session identity.                                                                                                |
| 4              | Post-cleanup re-list must contain no session for the invocation.                                                                      |
| 5              | Common-directory equality, absolute-Git-directory equality, symlinked storage refusal and object-alternates refusal, each separately. |
| 6              | Exact toplevel equality with a real core.worktree escape.                                                                             |
| 7              | File-only Git transport in the child environment.                                                                                     |
| 8              | Valid version/scenario seed marker rather than marker existence.                                                                      |
| 9              | Atomic settings publication and incomplete-settings retry, each separately.                                                           |
| 10             | Owned interrupted-init repair and foreign-init refusal, each separately.                                                              |
| 11             | Empty-home retry and atomic ownership-marker publication, each separately.                                                            |
| 12             | Start's live-PID refusal and sandbox creation, each separately.                                                                       |

Item 13 is documentation reconciliation: the mailbox is confirmed, plus-folder routing is
explicit, and live credentials remain Kyle-only in 1Password until L79 approval.

The harness round-1 follow-up adds nine in-memory mutation checks, all killed: acceptance of
403/500 replacement responses despite valid stopped-thread data; omitted replacement fixture
validation; non-object issue decoding; skipped unlistable/shared Git storage; swallowed scandir
failure; ancestor-containment substitution for exact toplevel equality; marker staging inside
the home; omitted live-PID refusal; and omitted sandbox-symlink refusal. These extend the earlier
22-mutant evidence above. Replacement HTTP failures assert the intended message, and non-object
issue replies retain subject-scoped cleanup. Core.worktree tests now cover sibling and ancestor
escapes. Real mode-0300 directories and an injected listing error both refuse Git inspection.
Start's live-PID test checks its specific stderr message; sandbox-home, .config and gh symlinks
refuse before exec. A mid-write staging assertion pins the temporary marker outside the home.

A no-sleep subprocess proof waits for a staged-write notification, then SIGKILLs only its own
child. Existing settings remain intact; a new home remains empty/retryable. Non-secret orphan
temporaries persist in the expected directory and are neither read nor automatically deleted.
This is a documented cleanup limit. Git's file-only restriction does not sandbox direct SSH
features elsewhere in the test server; Mini workers and SSH device hosts are outside this flow.

The seed suite adds an interrupted marker-write regression using real isolated files and a
single filesystem fault: the old database and completion marker remain intact, the temporary
marker is removed on ordinary failure, and a later reset succeeds. Restoring the former
truncating marker writer makes this regression fail. A crash between database and marker
publication remains a separate recovery window; the harness preserves that unmarked state.

A fresh real seed uses sandboxed child HOME while explicitly passing the actual account's `.t3`
to the exported seeder's shared-home guard. The old target was stopped before replacing its
synthetic QA state and kept separately for review. The current target was relaunched with the
new environment. Actual server-process inspection confirms sandboxed HOME, XDG, gh, global Git,
system-config suppression, prompt suppression and the fixture-parent Git ceiling at that earlier
tip. File-only transport and the subsequent recovery fixes are regression-tested in this
follow-up; no new live-process or browser pass is claimed for them. The fresh
session issue/access/revoke/replacement/final-cleanup proof also passes. No real userdata,
credentials or production services were changed. The latest harness follow-up also changes atomic marker publication in the TypeScript seeder.
Its five seed tests and three fixture-home tests pass from the server package directory; server
typecheck and changed-file lint pass. These checks do not add new live or native acceptance.

```sh
# From the repository root:
PYTHONDONTWRITEBYTECODE=1 python3 -W error::ResourceWarning -m unittest discover \
  -s apps/server/src/fork/vault/testkit -p test_loom_test_instance.py -v
PYTHONDONTWRITEBYTECODE=1 python3 apps/server/src/fork/vault/testkit/loom_test_instance.py prove
# Current Python follow-up, from apps/server (repeat with TMPDIR=/var/tmp):
PYTHONPATH=src/fork/vault/testkit PYTHONDONTWRITEBYTECODE=1 \
  python3 -W error::ResourceWarning -m unittest -q \
  test_loom_test_instance test_migadu_inbox test_migadu_imap
# Earlier TypeScript seed milestone, not rerun for the Python/docs follow-up:
../../node_modules/.bin/vp test run src/fork/dev-fixtures/fixtureHome.test.ts scripts/seed-dev-db.test.ts
../../node_modules/.bin/vp run typecheck
```

Using the `test-t3-app` skill and authorized Browser panel, a new isolated incognito tab showed
Loom's pairing page, then consumed a fresh private pairing link for the relaunched target and rendered the
three synthetic thread titles, the isolated `loom-test` checkout and disabled-provider guidance.
Screenshot:
`/Users/kyle/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mvh5hd7p-b3cc41cf.png`.
The screenshot is QA evidence outside git, not runtime state used by this target. Browser startup
showed expected unauthenticated WebSocket refusals; a source-watch restart also briefly returned
502 before recovery. Pause edits to server `src/`, `packages/` and `apps/server/package.json` during the proof. No native pass is claimed;
native acceptance remains with the release owner.

Kyle confirmed the dedicated mailbox exists. No IMAP reader credential or live message delivery
has been verified. Live credential custody stays Kyle-only in 1Password until L79 approval;
no live credential may enter the disposable proof backend or test fixture. The [mailbox-owner handoff](../../operations/vault.md#dedicated-migadu-test-mailbox-handoff)
records the dedicated-mail setup and remaining live acceptance.

## Migadu contract evidence

Forty-six focused Migadu Python tests pass from `apps/server`: 42 message/selection/budget
cases and four stdlib IMAP-over-TLS cases against a disposable loopback server. Together with
the 56 local-target cases, **102 tests pass**, normally and with `TMPDIR=/var/tmp`. The four TLS
cases also pass using stock macOS `/usr/bin/openssl` through `PATH=/usr/bin:/bin` and the current
Python executable. Temporary certificates use portable `-nodes`; fixture keys are removed on
cleanup. Both untrusted certificates and a trusted certificate for another hostname refuse
before any IMAP verb reaches the server. Fixed Migadu hostname/SNI is retained while socket
destinations are redirected to loopback. No live provider or personal credential is used.

Both fixtures honor the actual requested HEADER.FIELDS, preserving raw address syntax instead
of rebuilding it through the contract's recipient list. Conflicts in Cc, Delivered-To and
X-Original-To prevent body reads, including on the real loopback wire. Raw encoded From CR/LF,
semicolon-separated recipients and trailing-dot aliases cannot abort or cross-match a read.

Per-candidate regressions cover body-only MIME defects, invalid base64, unknown charset, more
than 32 parts, decoded-text and message-size bounds, both UID orderings around a valid message,
and all-unusable versus pending. Old unrelated oversized headers are skipped before parsing;
in-window oversized headers report unclassified coverage. Vanished/header-or-body FETCH and NO
responses preserve another UID's text and report unavailable coverage; an all-unavailable scan
reports incomplete, not pending. Same-second INTERNALDATE is accepted despite a microsecond
request start. Signed/unknown multipart text is read while forwarded/attached text stays closed.

Independent body cases change INTERNALDATE, RFC822.SIZE and literal length while preserving
routing headers, each withdrawing the entire observation. A three-message expiry case proves
only the first body is fetched. Private-provider failures check formatted traceback, cause and
suppressed context, in addition to fixed public error text. Finite flooding-socket fixtures drive
short untagged lines (5 MB offered), near-maximum 999 KB lines (about 8 MB offered) and repeated
literals (10 MB offered) through actual imaplib parsing. Delivery is bounded by the logical-byte
budget plus one stdlib maximum line and socket read-ahead, rather than by one receive buffer
alone. The long-line case fails the former one-buffer assertion.
Expired readline refuses before socket access. No sleeps or live network destinations are used.

A separate no-sleep slow-drip reproduction confirms optional s1: one read can finish after 45
simulated seconds despite a thirty-second boundary budget. This remains explicitly documented,
not claimed fixed. No live-read gate is opened. The proposed `vault-reader@begam.in` login is
now named in the mail-owner handoff; its setup is not claimed.

The earlier in-memory mutation pass killed **28/28 mutants**, without changing the disk source:

| Review item | Mutations caught                                                                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| m1          | Body-only defects treated as drift; unusable candidate abort; removed part/text/MIME-defect limits. Separate unknown-charset and body-defect regressions also pass. |
| m2          | From parsing moved outside the guarded block.                                                                                                                       |
| m3          | Same-second start truncation removed.                                                                                                                               |
| m4          | Oversized matched candidate silently discarded.                                                                                                                     |
| m5          | Oversized-header abort restored, or header classification moved before arrival filtering.                                                                           |
| m6          | Traversal restricted to the original three multipart subtypes.                                                                                                      |
| m8          | `-nodes` replaced with `-noenc` under stock macOS PATH, failing certificate setup.                                                                                  |
| m9          | Requested fields reduced to FROM/TO; Cc, Delivered-To or X-Original-To removed from correlation separately.                                                         |
| m10         | Byte accounting removed; readline override removed; readline deadline check removed.                                                                                |
| m11         | Whole body-metadata check removed, then each arrival, size and length guard removed separately.                                                                     |
| m12         | Certificate hostname verification disabled despite a trusted wrong-host certificate.                                                                                |
| m13         | In-loop request expiry removed; provider exception-context suppression removed.                                                                                     |
| c2, c3      | Header-object defects ignored; vanished-FETCH handling removed.                                                                                                     |

The round-2 residual follow-up adds seven inbox cases and three local-target cases. Parser
failures in From/To/Cc and malformed MIME parameters preserve a different UID's valid text in
both UID orders. Server-style field selection continues past malformed fields until the first
blank line, exposing the before-routing structural defect. Display names with periods/raw UTF-8
remain usable; noncanonical aliases in Delivered-To/X-Original-To refuse correlation. Metadata-only
or empty FETCH replies report unavailable rather than aborting. Stamped, stopped, HEAD-less Git
fixtures recover stale config/HEAD locks and Git's exact symlink probe; foreign layouts and live
runtime records refuse before artifact cleanup or an init subprocess.

A fresh in-memory mutation pass catches **13/13 mutations**: narrow header-object exceptions,
unguarded header parse, omitted body IndexError handling, restored structural-defect drift,
blanket display-name rejection, excluded noncanonical aliases, all-None-only FETCH handling,
omitted transfer accounting, the former one-buffer assertion, omitted init-artifact cleanup,
refused init probe, omitted pre-init layout scan and omitted live-process refusal. Each is caught
by a focused regression; disk source is not mutated. The normal and `/var/tmp` runs both pass
102 tests. No live reads, runtime registration, persistent format or access gate changes.

m7 is the tracker correction restoring durable broker delivery alongside broker mail integration.
c1 is the explicit proposed reader identity in the handoff. Existing search/epoch/identity,
request validation, credential-ingress refusal, default-live refusal and no-mutation coverage
remain. Sender authentication and automatic verification are not claimed.

```sh
# From apps/server:
PYTHONDONTWRITEBYTECODE=1 python3 -W error::ResourceWarning -m unittest discover \
  -s src/fork/vault/testkit -p 'test_migadu*.py' -v
```

The adapter is a test-only contract with no credential ingress or runtime/public transport.
Python syntax, documentation references, seam manifest and whitespace are checked. No TypeScript
or client code changes in this slice, so previous package typechecks and browser/native evidence
are not claimed as new checks. Native acceptance stays with the release owner.

Kyle confirmed that `vault@begam.in` exists and is dedicated to Vault tests. No live reader
identity, authentication, folder routing/header preservation or unchanged live flags have been
verified. [Kyle-only credential custody and L79 approval](../../operations/vault.md#dedicated-migadu-test-mailbox-handoff)
remain required before any live acceptance. The default connector stays unavailable, and the
contract has no credential-file export, product CLI/MCP/RPC surface, backend path, policy or
format change. `canReadLive`, `canExecute`, resumption, verification and allow-once gates remain
false; L84 remains partial.

## Retained cleanup/reset design proof

The new `SyntheticCleanupBarrier.test.ts` has **51 passing cases** against an opaque in-memory
CAS store and a separately retained synthetic provider ledger. Controllers are reconstructed
at intent, external-effect and receipt/write boundaries. This is simulated crash/restart evidence,
not an OS-process, durable storage, real provider or production deployment exercise.

Cases prove write-before-start with before/after-commit failures; no automatic remint after a
lost start response; unknown/forged/error/lost fence evidence; before/after reset-intent failures;
provider failure/lost receipt; readiness write failure/lost acknowledgement; same-ID reset retry;
foreign scope/generation/operation receipts; concurrent CAS admission; delayed start after fence
and generation advance; stale cleanup/reset receipts that cannot clear a newer operation;
controller rollback refused by provider generation; missing/outage state; unchanged barriers after
thirty days; fresh lease/operation requirements; scope/version changes; and resource/replay/reset
capacity refusal without eviction. Deferred interleavings and fiber interruption use no sleeps
or polling. Separate start and maintenance authority allow host cleanup after workload revocation.
The result gates remain false and no pool account is marked clean.

All **11 guard-removal mutations are caught**: omitted write-ahead intent; reset before terminal
fence; unknown fence accepted; mismatched fence/reset receipt accepted; stale cleanup writing
against a fresh revision; forgotten operation ID; forgotten lease ID; provider-generation
comparison omitted; capacity guard omitted; and reset ID rebound to a later generation. Each
mutant runs the matching behavioral regression and is restored before final verification.
The rollback case uses a fresh operation ID so an old operation's terminal fence cannot mask a
missing provider-generation check. No serialized fixture, persistent backend or format is added.

Final package-CWD verification passes **158 tests** across the 51 barrier and 107 workload cases.
Server typecheck, changed-file lint, 398 seam entries/unlisted-marker scan, local doc references
and whitespace pass. No Python, client, native or provider code changes in this slice, so the
earlier Python and app-interaction checks are not claimed as new runs.

```sh
# From apps/server:
../../node_modules/.bin/vp test run src/fork/vault/SyntheticCleanupBarrier.test.ts \
  src/fork/vault/VaultTestAccountWorkloads.test.ts
../../node_modules/.bin/vp run typecheck
```

The [design](./TECHNICAL.md#cleanup-and-reset-before-reuse-barrier-design) states the required
terminal fence and provider-generation semantics, atomic CAS boundaries, reader/rollback and
reclamation gates. Only test files import the model. It changes no runtime transport, backend
path/capability, persistent reader/schema or policy/journal/registry format. Existing live cleanup,
provider identity and reset/reuse integration remain unfinished.

## Synthetic broker/mail integration evidence

The workload suite adds **55 cases** and passes **106 total** from `apps/server`. Combined with
five seeder and three fixture-home cases, the focused run passes **114 tests**. Server typecheck
and changed-file lint pass. The Python suites remain green at 92 cases under both normal temp
configuration and `TMPDIR=/var/tmp`; syntax, links, seams and whitespace pass.

The positive integration launches a bounded, cancellable Python child that uses the actual
inbox selector over synthetic messages: a different run's UID is not body-fetched, an unusable
matched UID is visible, and the valid UID remains usable. Raw body/reader/session canaries are
absent from the metadata-only result. Its gates remain false. No network connection, real mail,
provider or new browser/native pass is involved.

Cases prove fifteen forged initial scope fields refuse even when adapter registration agrees,
and nineteen registration-field changes refuse before reading. A separate real evaluator grant
on a synthetic reader reference is required. Revocation before read, at the adapter boundary,
after the awaited observation or during cleanup withdraws the result. Root-run replacement,
lease release, reader rotation, expiry and broker-offline transitions also refuse. Receipt tests
reject foreign scope/correlation/recipient/folder, out-of-range UID, inconsistent status, raw body
fields and enabled gates.

Deferred-only interleavings prove delayed observation refusal after broker reconciliation and
cleanup fencing on cancellation. An unknown cleanup withholds metadata; later cleanup can fence
but cannot reread/resume. Accounts stay reserved, not automatically clean or reusable. The
correlation echo does not authenticate mail. This remains test-only, with no durable cleanup
journal, live credential delivery, product grant namespace, API, policy or format change.

```sh
# From apps/server:
../../node_modules/.bin/vp test run src/fork/vault/VaultTestAccountWorkloads.test.ts \
  scripts/seed-dev-db.test.ts src/fork/dev-fixtures/fixtureHome.test.ts
../../node_modules/.bin/vp run typecheck
```

## Authenticated workload evidence

The focused workload suite now passes **106 tests**, including 55 new broker/mail composition
cases. The earlier four-suite baseline passed 66 tests (13 manager, 51 workload, MCP authorization
and startup registration); the unchanged manager/MCP suites are prior evidence. Workload tests use the real
account registry, VaultCore and VaultAccess evaluator with synthetic external storage/thread
boundaries. They prove inspect plus use and exact pool destination filtering; no discovery writes;
no other-owner/unrelated-collection leakage; audited reserve; exact run/lease release; renewal;
run/provider/project/mode/identity refusal; permission withdrawal and account rotation at async
write checks; lost replies; restart reconciliation; durable expiry; corrupt owner quarantine;
outage refusal; and cleanup CAS loss preserving a newer reservation. Agent administration and
injected owner fields refuse. The MCP case drains toolkit result streams, verifies trusted caller
identity and refuses external clients or a runtime lowered before mutation. No login is delivered.

Ten login-admission cases prove the separate exact-origin grant, canonical origin refusal,
wrong-run/lease refusal, fixed deadlines despite renewal, replacement lease refusal, grant loss
before a synthetic callback with exactly one fixture cleanup and no continuation, changed-run
refusal, and lease release while the login access audit is committing. Preparation writes no
state and exposes no password. The scoped OpenBao integration also prepares/revalidates that
guard with existing rights. This does not prove a live provider adapter, logout, unknown mint
outcome recovery or restart-safe cleanup; those remain gated and all execution flags stay false.

```sh
./node_modules/.bin/vp test run \
  apps/server/src/fork/vault/VaultTestAccountWorkloads.test.ts \
  apps/server/src/fork/vault/test-accounts-mcp.test.ts \
  apps/server/src/fork/vault/VaultTestAccounts.test.ts \
  apps/server/src/fork/mcp/registration.test.ts
```

The scoped OpenBao proof now runs **four applicable integration cases across two backend
lifetimes** (two per phase; complementary phase cases are skipped deliberately). In addition to
the first milestone's CAS/encryption/namespace proof, it runs real inspect/use grants and a
run-owned reservation, retains that lease through backend restart, then CAS-quarantines the
stopped run without changing policy3 or registry1. It uses only the existing documented scoped
rights; no production policy is read or changed. The policy's ordinary grant/audit contents change
through VaultAccess; no new field, path or capability is introduced. The initial manager-only
phase also proves unchanged policy before agent grants are created.

Server/contracts/client-runtime/web/mobile package typechecks and focused changed-file lint pass.
The web check uses a fresh temporary incremental cache. Links, seam manifest and whitespace are
checked before commit. These are backend/tool changes; no new browser or native interaction pass
is claimed. The existing integrated web evidence below remains the manager milestone evidence.
The reactor is tested through its reconciliation service and real backend restart, not by a
live production worker or provider session cleanup.

## First manager milestone evidence

Six focused suites pass **42 tests**: 13 real-service lifecycle/failure cases, client action/expiry
logic, destination-scoped command permissions, profile cleanup isolation, exhaustive fork RPC
permission mapping and actual MCP startup registration. That first milestone added no MCP tool; the workload milestone above adds two. Behavior
covers
competing CAS writers, actor-bound replay/lost replies, expiry into quarantine without read writes,
old/new lease IDs, another session's refusal, renewal bounded to one hour, expiry during async
authorization, blocked archive while reserved, quarantine/retire/restore, duplicate item references,
collection identity/move refusal, active account/version checks, missing/wrong-kind items, ledger
corruption, malformed input, permission withdrawal and aged/evicted receipt replay. Client tests
cover reverse actions, ownership, archived state and the exact expiry boundary.

The original disposable OpenBao 2.7.1 proof passed one applicable case in each phase.
The expanded workload proof above adds a second case in each phase. It uses only the documented existing environment-scoped service policy,
including profiles/*; no production policy is read. It proves a single reservation CAS winner,
denied sibling namespace, unchanged format-3 policy, core item-list independence and matching-owner
release into quarantine after a backend restart. Synthetic account plaintext is absent from the
stopped Raft files. The fixture captures/stops its own process and removes its temporary state.
This is restart/encryption evidence, not a production backup or provider reset exercise.

```sh
./node_modules/.bin/vp test run \
  apps/server/src/fork/vault/VaultTestAccounts.test.ts \
  packages/client-runtime/src/fork/vault-test-accounts.test.ts \
  packages/client-runtime/src/fork/vault-test-accounts.permissions.test.ts \
  apps/server/src/fork/vault/VaultProfiles.test.ts \
  apps/server/src/fork/rpcAuthorization.test.ts \
  apps/server/src/fork/mcp/registration.test.ts
PYTHONDONTWRITEBYTECODE=1 python3 \
  apps/server/src/fork/vault/testkit/test_accounts_proof.py \
  --bao /path/to/verified/openbao-2.7.1/bao
```

Server, contracts, client-runtime and mobile package typechecks pass. Web typecheck passes with
fresh incremental build info using the package's tsc-rs compiler; the ordinary TypeScript compiler
also passes. Initial upstream dependency-link and stale build-info failures were resolved by
reusing already installed packages and a fresh local cache. No install, lockfile change or
compiler/source workaround is included. Mobile native static checks pass. Focused lint/format,
changed links, seam manifest and whitespace are checked before commit; no repo-wide check runs.

## Integrated web evidence

The authorized test-t3-app Browser-panel pass used a new isolated Loom home, private disposable
loopback OpenBao and a synthetic Account item. No production database, personal credential or
existing Vault QA server was used or stopped. The backend used a disposable broad fixture policy
for that empty UI environment, separate from the narrowly scoped real-service policy proof above.

Observed through UI and real RPC: empty state; collection create and rename; safe account picker;
reference creation into quarantine; explicit clean review; reserve with correct connection owner;
release into quarantine; retire/restore; reference role edit back into quarantine; collection
archive/restore; and visible conflict/refusal when archiving an actively reserved collection.
The 1280px and 390px layouts render the account actions and safe references; the narrow document
width matches its viewport with no horizontal overflow. Review/cancel and labels are present.
No console error was observed in the checked flow. Expiry/races, offline/backend corruption,
permission withdrawal and retry outcomes have focused service/client evidence, not a claimed
manual/browser pass for every failure.

Browser artifacts (local evidence only, not committed):

- Desktop: `browser-screenshot-localhost-mvgvlbtd-2bfd18ca.png` in Kyle's browser-artifacts folder.
- Narrow viewport: `browser-screenshot-localhost-mvgvpe0q-872ab27d.png` in the same folder.

The native mobile implementation shares the guarded commands and expiry/action logic but has
not had an iOS/Android interaction pass in this slice. Native testing remains with the designated
owner. Electron shell/IPC, remote/relay/tunnel, keyboard-only and screen-reader behavior, live
application accounts and multi-worker login remain unverified. Desktop uses the shared web UI;
the browser pass does not imply Electron-specific acceptance.

## Scope and remaining acceptance

No raw password, cookie, TOTP or login session is returned or copied into the registry. This is
reference-only pool management; quarantine/retirement prevent reservations but do not revoke
external sessions or block generic Vault account access. Provisioning, automatic reset, mail
and login delivery remain unavailable. Authenticated agent reservations are exposed.
Manual clean review is an operator attestation, never adapter-reset proof. Full-access process
isolation and exactly-once provider effects are not claimed.

Continue with a synthetic separate login-delivery contract bound to the live lease and its
failure/revocation checks, then a chosen disposable app adapter, real reset/provision failure/cancellation recovery,
mail ownership/cleanup and browser/native login verification. These remain the full selected
PRODUCT outcomes. Policy3/journal1 and L86's false execution/resumption/allow-once gates stay
unchanged. L75 stays parked behind CW-1/L79. No Library schema, production, SSH, install or release
action is included. This branch is prepared for the release owner's landing review.

## Landing-review regressions

Queued follow-ups and pending runtime requests do not end an active reserving root run. Two
real-service cases preserve the same lease through discovery and reconciliation, then renew and
release it with status queued or running plus pendingRuntimeRequest. A reachable waiting state
with activeRunId null and a background subagent ends that lease and quarantines the account. The binding trusts activeRunId,
provider/project identity and permission modes rather than the thread's presentation status.

Each client has a mounted clock regression: an empty manager waits twelve minutes, receives a
new five-minute lease, then renews twice. Fresh snapshot.checkedAt rebases the clock and explicit
renew-eligibility deadlines wake it after a fifteen-minute extension. Both renew and release
withdraw at expiry, leaving clean review/retire and no timer. A callback that fires before the wall
clock reaches its deadline reschedules; both mounted hook regressions cover that clock behavior. This is unit evidence for both
web/native hooks, not a simulator pass. The card's lease line now uses that computed state, and
mobile rename disables application and target edits. Both clients show and can copy the exact
collection grant scope; the guide states full-access/default run requirements.

The isolated browser pass verifies the visible scope, Copy action and success notice, and the
quarantined card without a stale lease banner. Evidence: browser-screenshot-localhost-mvgz70ja-5a6d3d01.png
in the local browser-artifacts directory. No synthetic wall-clock mutation or native interaction
is claimed. Four affected package typechecks, focused lint, mobile static checks and seam/link
checks pass. The release owner's landing review remains separate from these local checks.

Lease identity regressions release and replace a lease before the original preparation deadline,
then prove that a fresh preparation succeeds while the old one fails. Removing the lease-id guard
makes this regression fail. Separate renewal coverage enforces the original deadline. Audit-write
hooks change the run, archive the account item or advance past expiry during access.require;
post-await revalidation refuses each case. These are synthetic service tests, not login delivery.

## Synthetic broker contract

The server package-CWD workload suite passes 106 tests, including 25 broker-contract cases and
55 broker/mail composition cases.
It uses the real account/grant admission service and a fake broker, with no credential reveal.
Cases cover environment/machine/app/target/origin mismatch, offline/expired presence, registered
origin changes at the adapter boundary, forged return correlation, grant/run/lease/expiry changes,
callback failure, duplicate admission, lost start replies and cleanup refusal/errors. Deferreds
interleave cancellation and a late remote mint; the fixture's terminal operation fence prevents
that late creation. Reconstructing the model with the same fixture fence cannot mint again.
Concurrent cleanup ownership and interrupted reconciliation are covered.
Only the original operation ID reaches cleanup. Confirmed cleanup does not mark the account
clean; unresolved cleanup blocks model redispatch and can only retry cleanup.

The contract is in testkit and imported only by this suite. Server typecheck, changed-file lint,
links and 398 seams pass. Client contracts and runtime surfaces do not change in this slice.
No synthetic broker assertion proves a real provider's fence, process isolation, durable cleanup
or account-reset/reuse safety. Those remain explicit live adapter gates in TECHNICAL.md.

```sh
cd apps/server
../../node_modules/.bin/vp test run src/fork/vault/VaultTestAccountWorkloads.test.ts
```

The landing-review regression also changes the root run during a reservation audit write and
proves the post-require identity check refuses before registry CAS. The final Math.min deadline
recheck has no isolated mutation proof; expiry during the earlier audit wait is covered, and no
stronger coverage is claimed for that non-blocking review note.

A Deferred-interleaved start now waits after minting while reconciliation closes and fences the
operation. Releasing that delayed response must return denied, keep the operation closed, skip
the callback and perform cleanup only once. The regression fails with the previous unconditional
activation; starting-to-active now requires an atomic state claim.

The barrier review regressions add same-generation controller rollback before and after fencing,
and reset replay from fenced/resetting snapshots after a new start or generation advance. The
mail regression passes admission B to a delivery captured under A and requires refusal before
session start or mailbox read. All six new cases fail against the previous implementation and
pass with provider spent-generation/reset-currentness checks and delivery-admission correlation.
