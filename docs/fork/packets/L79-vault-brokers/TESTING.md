# L79 testing

Status: Enrollment/heartbeat foundation verified locally; full packet acceptance remains pending.
All credentials and hosts used in verification are synthetic and isolated from the live Loom home.

## Automated evidence

- `VaultBrokers.test.ts`: reviewed enrollment, mismatched key denial, approval boundary,
  single-use challenges/replay, cancellation with later-claim denial, environment binding/expiry,
  disable across reconstruction,
  CAS contention/idempotency, audit failures and authorization failure.
- `BrokerRunner.test.ts`: owner-only identity persistence, reconstructed runner, project/public
  state rejection, real proof HTTP with Ed25519 and no administrator token, approval-pending,
  renewal, disable, malformed requests and body limits. HTTP integration uses a live clock;
  controlled-clock protocol tests cover expiry without sleeps.
- `broker-mcp.test.ts`: thread self-approval and read-only clients are refused before mutation;
  a full-access administrator uses the same service and live authorization callback.
- `vault-brokers.permissions.test.ts`: destination environment grants and revoked permission
  are checked at command execution.

The four focused files pass 11 tests. Registration and exhaustive RPC scope checks cover the
new tool/method registration. The CLI branding/ownership and shared authorization suite passes
78 tests across six existing files. POSIX invocation tests use `TMPDIR=/private/tmp` on this
Mac to avoid long Unix socket paths and noncanonical `/tmp` prefix comparisons.

Changed consumer packages pass typecheck: contracts, client-runtime, server, web, mobile and
desktop. Fork-owned code lint passes with warnings denied; formatting and mobile static checks pass.
The upstream connection screen retains its existing React memo-dependency and set-state-in-effect
warnings outside the copy-only branding diff; their state-management cleanup is deferred. Repo-wide suites and live
infrastructure checks were not run.

## Integrated evidence and remaining coverage

A disposable OpenBao Raft fixture and isolated Loom server back the web/iOS native client checks.
The macOS CLI generates its own private identity and claims a web-created invitation through
proof HTTP. Before approval, checks return approval-pending. Native mobile compares/reviews the
fingerprint and approves the host. Subsequent CLI checks run in new processes using the same
identity. Web/mobile inspection and permanent disable are exercised against that shared state.

No claim of Android interaction verification, Linux/Pi execution, Windows custody, Electron
native shell verification, automatic
boot/logout startup, authenticated workload channels, SSH signing or offline credential delivery
is made. Direct loopback HTTP is the integrated test route; production relay/tunnel routing and
real remote-host verification remain pending. The shared web bundle is used by desktop, but
launcher behavior is tested through isolated filesystem/real-shell tests, not a global install.

## Full packet acceptance targets

- Service boot, logout, reconnect and outage behavior on every selected OS/account mode.
- A local process cannot impersonate an isolated workload by copying a socket path or thread ID.
- Disabled hosts cannot receive new credential-use leases; publish any accepted offline bound.
- Verify actual SSH/GitHub execution through supported provider adapters without personal keys.
- Exercise supported remote connection modes and restore/revocation reconciliation.

Use the product-native Browser and Device skills for authorized integrated checks, retain
isolated state for review, and never use production credentials. Preserve complete selected
scope until these targets pass. Enrollment presence alone cannot establish readiness for use.

## Merge compatibility

The committed client/service chunk at `7709bf9fd6` previews cleanly against the newest local
nightly tag `v0.1.1-nightly.20261017.3238` using `git merge-tree --write-tree --name-only
--no-messages`. Seam-manifest and local documentation link checks pass. No upstream fetch,
full integration rehearsal, push, release or deployment was performed.
