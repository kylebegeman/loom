# L79 testing

Status: Enrollment and managed-user-service lifecycle/recovery verified locally. Full packet
acceptance remains pending. Credentials, identity files and host fixtures are synthetic.

## Managed lifecycle evidence

The current focused suite passes **33 tests in five files**:

- `BrokerService.test.ts`: macOS/Linux plan without writes; safe descriptor rendering; explicit
  install/start/restart/stop/uninstall; repeated install; enrollment preservation; failed stop
  preserving its definition; foreign/public definitions refused; unavailable manager status;
  independent autostart/linger/process observations; inspection never creates a missing identity; stop/uninstall remain available after identity loss.
- `BrokerDaemon.test.ts`: deterministic outage, sealed backend, recovery and permanent-disable
  sequence; no further renewal after disable; graceful stop, restart, stale observations,
  foreign/symlink/public/oversized report rejection and private atomic status-file modes.
- `BrokerRunner.test.ts`: private identity persistence, workspace/public-state rejection,
  home-shell operation and home-repository denial; real signed proof HTTP enrollment, approval,
  heartbeat and terminal daemon disable with unchanged identity.
- `VaultBrokers.test.ts`: reviewed enrollment, mismatched proof, replay/expiry, cancellation,
  environment binding, disable persistence, CAS/idempotency, audit and authorization failures.
- `apps/server/src/cli/app.test.ts`: existing CLI composition and desktop invocation behavior.

No tests wait on sleeps or polling. Recovery tests use controlled time and report milestones.
The console adapter signals synchronous callbacks correctly; status milestones occur after the
atomic file operation closes. The initial existing desktop CLI tests hit macOS Unix-socket
path limits under the host's long temporary directory. Re-running with `TMPDIR=/tmp` passes;
no product code or existing assertions were weakened for that infrastructure issue.

Actual macOS CLI subprocesses with a disposable HOME prove public identity generation,
read-only plan, native `plutil` acceptance, signed HTTP request to a synthetic disabled control
plane, successful terminal daemon exit, private report/status reading and unchanged identity.
No launchd service is installed, loaded or otherwise mutated. Lifecycle manager adapters are
isolated test doubles; real Linux/systemd/Pi process execution is not claimed.

The server package typecheck, changed-source lint with warnings denied, formatting, seam
manifest, documentation links and whitespace checks pass. No contracts or frontend code change
in this milestone. Web, desktop and mobile continue their existing remote registry management;
OS-service controls intentionally run on the execution host CLI. No new browser/device pass,
repo-wide suite, dependency, SQL migration or live infrastructure check is part of this milestone.

## Earlier integrated evidence

The enrollment milestone used a disposable OpenBao Raft fixture and isolated Loom server for
web/iOS native management. The macOS CLI claimed a web-created invitation, native mobile
reviewed/approved the fingerprint, and subsequent CLI processes renewed with the same identity.
Web/mobile inspection and permanent disable were exercised. Earlier MCP/permission tests
also establish thread self-approval denial and destination-environment authorization.
See L81/L84 testing notes for their subsequent mediated SSH and signed-workload evidence.

## Remaining acceptance

- Real macOS GUI login/logout and process crash/reboot behavior; no pre-login macOS claim.
- Real Linux/Pi systemd-user execution, linger enabled/disabled and reboot/logout continuity.
- Remote-host outage/reconnect, selected relay/tunnel routes and backend restore reconciliation.
- Stronger local key custody and separate-user/container workload boundaries where selected.
- Complete independent runner delivery, ordinary SSH-agent routing and adapter coverage.
- Publish any future offline lease/revocation bound before enabling offline credential use.

Owner-only machine identity files are plaintext and readable to same-user processes. Successful
machine presence proves no workload isolation, item grant or provider login. No production
service or personal credential was installed, migrated or changed.

## Merge compatibility

Read-only merge previews against the latest fetched nightly,
`v0.1.1-nightly.20261019.3373`, report the same 68 conflicting files for the section's starting
commit `9d5461361b` and the completed lifecycle change. No conflicting file is added or removed
by this milestone. The branch is not cleanly mergeable with that nightly; existing upstream
integration remains separate work. No actual merge, push, PR or deployment was performed.
Full integration rehearsal remains a clean-main step after Kyle lands the branch; this local
milestone does not claim that the complete Vault packet or upstream integration is finished.
