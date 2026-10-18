# L81 testing

Status: mediated SSH and client-management milestones are verified against disposable OpenSSH
and OpenBao, web and native iOS. Complete packet acceptance remains pending.

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
Windows/Linux execution, actual provider launch/Git access, real VPS routing, relay headless
authentication and production restart/recovery are not verified by the macOS proof.
Remote effects may survive timeout or disconnect. No production registration or deployment ran.

## Remaining full acceptance

- Extend client coverage to Android, Electron-specific behavior and interactive read-only,
  sealed/offline and older-server connection matrices.
- Exercise Git fetch repeatedly through Pi, another provider and scheduled tasks without a
  personal key manager; verify runtime launch attachment, cancellation and restart behavior.
- Verify chosen OS boundaries, imports/algorithms and Windows support or explicit unsupported
  behavior on real Windows; exercise remote/relay/tunnel matrices and skewed capabilities.
- Verify provider-side registration/revocation reconciliation and production custody/recovery.

## Merge safety

The implementation uses fork-owned paths and existing registries, with no new upstream seam.
Source commit `30ac9197b6` previews cleanly against the newest local upstream nightly,
`v0.1.1-nightly.20261017.3238`, using `git merge-tree --write-tree --name-only --no-messages`.
Full post-landing rehearsal remains a separate integration check. No fetch, landing, push,
production registration or deployment was performed.
