# L82 testing

Status: mediated SSH and client-management milestones are verified against disposable OpenSSH
and OpenBao, web and native iOS. Complete packet acceptance remains pending.

## Current terminal-agent milestone

The focused regression run passes **95 tests in ten files**: new server activation/protocol,
local process and authenticated client tests; existing SSH/launch/crypto tests; OpenBao adapter
coverage; shared provider-instruction and Pi launch/system-prompt regressions. Tests cover
host-bound signatures, owner/run/version checks, grant revocation, host disable, archive,
expiry, replay, generic/forwarded signing denial, foreign MCP callers, repository-only grant
rejection, local cancellation/timeouts, no personal/MCP credentials in child configuration,
connection-family separation, authenticated redirect refusal and oversized response cancellation.

The disposable `ssh_proof.py` now runs two files sequentially because they share one temporary
authorized-keys file. All **five real integration tests pass**. The added proof drives actual
CLI subprocesses through a synthetic authenticated MCP endpoint backed by real Vault services
and OpenBao, and uses real OpenSSH for host-bound authentication. It preserves exact stdout,
stderr and exit 7; exercises Git clone, fetch and push to a synthetic repository; revokes a
grant before signing; and proves workload/socket/public-directory cleanup. Pi's existing
terminal connection variables are used in the SSH proof. No personal keys or live host change.
A separate OpenBao proof passes encrypted persistence, CAS and clean stopped-data restore.

Repeated signing first exposed OpenBao's default JSON string-count complexity limit in the
policy audit record. The adapter now stores a versioned serialized payload and reads legacy
records; the full audit regression and real Git push pass without increasing backend limits or
dropping audit events. Temporary diagnostic instrumentation is removed. A cleanup assertion
also now checks directories rather than unrelated log files with the same prefix.

Contracts, client-runtime, server, web, mobile, desktop and provider-core typechecks pass.
Scoped source lint, formatting, local document links and seam checks pass. No frontend code is
changed, so no new browser/device interaction pass is claimed. No repo-wide suite is run.

These tests use a synthetic active provider run. Actual paid provider/model executions, native
Linux/Pi/Windows binaries, complete relay/tunnel routes and remaining native-harness terminal
connection propagation are not verified. Local key custody and same-user OS isolation limits
remain as documented. Full packet acceptance remains pending.

## Focused automated behavior

`SshCrypto.test.ts` independently constructs host-bound agent frames and verifies real Ed25519
signatures. Generic signing, wrong users/identities/host pins, unbound sessions, forged host
signatures and forwarding fail. `VaultSsh.test.ts` uses real core/policy/broker/workload services
with an in-memory backend and a controlled transport. It covers idempotent generation/trust,
CAS conflicts, trust removal/restoration, command tampering/replay, archive/restore, permission
reduction, grant changes, disabled hosts, bounded concurrency and cancellation permit recovery.

The same tests exercise authenticated MCP administration and signed runner/HTTP requests:
threads/read-only clients cannot generate keys or approve host trust, inspection requires its
own grant, HTTP execution carries no administrator bearer token, tampered result bindings fail
and revoked grants are rechecked. Existing host/workload/MCP regression tests remain required.
The management section adds tests for destination-scoped RPC authorization, read-only denial
before backend work, administrator probe denial for agents, fixed probe payloads, safe results,
stale/untrusted records and authorization rechecks at transport. Client tests independently
verify an Ed25519 fingerprint vector, reject malformed keys, enforce destination permissions
and revocation, and refresh mounted core lists/SSH details across factories after mutations.
Command-palette registry invariants cover the added capability-gated entry.

This section's focused runs cover 42 distinct tests across eight files: the 17-test service,
RPC, parsing, permissions and refresh run; six refresh/palette tests; 19 RPC/authorization
regressions; and two real integration tests. Overlapping tests are counted once. The refresh
case was strengthened before its final rerun. Contracts/server/client-runtime/web/mobile
typechecks, changed-file lint and mobile native static checks pass. Formatting, local links
and the declared seam markers pass; all 201 local links in changed documents resolve. No repository-wide suite is run.

## Real disposable proof

Run the following with the previously verified official OpenBao 2.7.1 binary:

```sh
python3 apps/server/src/fork/vault/testkit/ssh_proof.py --bao /absolute/path/to/bao
```

The fixture creates a loopback OpenSSH host with a synthetic host key and authorized-keys file,
and a separate initialized/unsealed KV v2 OpenBao. `VaultSsh.integration.test.ts` uses real key,
policy, enrollment, heartbeat and workload services. It registers only a synthetic public key
on that disposable host, authenticates repeatedly, runs the fixed administrator probe, checks exact argv quoting, denies a wrong
host pin and a fresh grant revocation, and verifies public-file/socket cleanup. A separate real
transport test covers timeout, output bounds, a policy denial after initial admission and
cancellation. The stopped Raft files are checked for private-key text. The fixture stops only
its own processes and removes its temporary data. It never reads personal SSH credentials.

## Integrated client verification

On 2026-10-18, the authorized built-in Browser and Device panels used an isolated worktree
backend, meaningful synthetic projects/threads, OpenBao 2.7.1 and a disposable loopback SSH
host. Only two generated synthetic public keys were registered in its temporary authorized-keys
file. No production credential or personal key manager was involved.

Web checks cover empty-form validation, generation with initially untrusted destination,
public-key copying, pasted keys with comments, independently reviewed fingerprint confirmation,
a failed connection before public registration, successful authentication after registration,
confirmed trust removal and restoration, and archive/restore with use disabled while archived.
The 390×844 layout wraps keys/fingerprints without horizontal overflow. Tab stays in the
dialog; Escape closes it and restores its management trigger at a stable viewport. Pending
operations move focus to the result region before disabling the active button. The thread
palette action selects the correct environment's Vault settings. The shared desktop bundle
is covered by web checks; no separate Electron window was driven.

Native iOS 26.5 simulator checks cover creation, copying, proposed fingerprint review, explicit
trust confirmation, clean authentication failure before registration, success after registration,
confirmed trust removal with the test disabled and old success cleared, restoration and a
successful version-4 test. The native sheet expands and scrolls with the keyboard/form; a
screenshot confirms wrapped fingerprints, reachable actions and textual results. An initial
half-height sheet required expansion for reliable automation. No native primitive was changed.

Interactive read-only/locked/offline and older-server matrices were not driven; destination
permission reduction and revocation are covered by focused service/client tests and capability
gating is implemented. Android and a separate Electron client were not driven. Native
Windows/Linux execution, live provider-model/scheduler runs, real VPS routing, relay headless
authentication and production restart/recovery are not verified by the macOS proof.
Remote effects may survive timeout or disconnect. No production registration or deployment ran.

## Automatic hosted SSH/Git access

L85's [current testing record](../L85-vault-delivery/TESTING.md) covers automatic session setup,
dual signing and release through authenticated Pi/Codex MCP caller contexts, including both
SSH and Git tools, read-only/mismatched caller denial and cancellation. Project grants cover
a synthetic fresh scheduled thread and stop after revocation. Existing Pi native system-prompt
and launch-bridge tests plus Codex instruction regressions pass. No paid/live model or timer
was started, so that evidence does not claim a complete installed-provider/scheduler run.

The extended disposable proof now passes three integration tests, including real Git ref
listing and repeated fetches into an isolated checkout. It reads the fetched README with Git,
rejects a wrong host pin and a fresh grant revocation, and times out a stalled command. The
hosted service reads the real owner-only synthetic broker identity/connection from disk and
releases sessions after failure/timeout. The key remains encrypted in OpenBao. No real remote,
GitHub account, personal credential or global Git/SSH setting is changed.

## Remaining full acceptance

- Extend client coverage to Android, Electron-specific behavior and interactive read-only,
  sealed/offline and older-server connection matrices.
- Complete live installed-provider/scheduler acceptance and remaining native-harness terminal setup.
  Synthetic Pi/Codex callers and project-granted future task threads are verified below.
- Verify chosen OS boundaries, imports/algorithms and Windows support or explicit unsupported
  behavior on real Windows; exercise remote/relay/tunnel matrices and skewed capabilities.
- Verify provider-side registration/revocation reconciliation and production custody/recovery.

## Merge safety

The implementation uses fork-owned paths and existing registries, with no new upstream seam.
Read-only previews against the latest fetched nightly `v0.1.1-nightly.20261019.3373` show the
same 68 conflicting files for the starting commit `5b9abf5ef6` and the completed terminal-agent
change, with no added or removed conflict paths. The branch is not cleanly mergeable with
that nightly; pre-existing conflicts remain separate integration work. No actual
merge, push, PR, production registration, backend conversion or deployment was performed.
Full post-landing rehearsal remains a clean-main integration step. This local milestone does
not mark the full L82 packet complete.
