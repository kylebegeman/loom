# L84 testing

Status: signed checks and automatic hosted SSH/Git access verified; full delivery acceptance remains pending.

## Passing milestone checks

`VaultWorkloads.test.ts` covers current-run/item/destination binding, default denial, both-key
proofs, tampering and replay, policy revocation, runtime reductions, replaced runs, disabled
hosts, cleanup after grant revocation/overdue heartbeat, session/challenge expiry, bounded
issuance and control-plane reconstruction. A fresh Layer verifies sessions are truly lost.

`workload-integration.test.ts` exercises the real MCP handler and proof HTTP routes with real
Ed25519 signatures. It proves the caller cannot supply another thread ID, administrator and
read-only clients cannot mint sessions, runner requests carry no administrator bearer token,
response binding tampering is rejected, malformed bodies fail, current grants are rechecked
and signed cleanup succeeds after grant revocation. The HTTP test uses an in-process real
router/client transport with synthetic authority and host state; it does not contact production.

The automatic-access section adds real service/MCP tests with Pi and Codex caller identities.
They execute both SSH and Git tools through authenticated handlers, deny administrator
impersonation/read-only or mismatched-provider callers and runtime reductions, and verify
repeated operation cleanup. Further tests reject wrong Git destinations, traversal/options/
URL injection, changed signed checkout paths, proof replay and SSH-to-Git substitution. A
synthetic fresh scheduled-run thread uses a project grant and loses access after revocation.
Cancellation uses a Deferred milestone and interruption, without sleeps or polling.

The focused service/runner/RPC run passes 25 tests across six files. A separate provider/MCP
registration run passes 47 tests across five files, including Pi's real extension source and
launch bridge plus Codex application-context regressions. The final strengthened six-test
launch file rerun also passes. No paid/live model session or scheduler timer was launched;
those are synthetic caller/launch-bridge proofs, not a claim of installed-model execution.

The disposable OpenBao/OpenSSH proof passes three real integration tests. Its Git case reads
an owner-only synthetic broker identity/connection from disk using the actual BrokerIdentity
service, automatically signs ref listing and repeated fetches, then reads the fetched README
through Git. Wrong pins, revoked grants and a deliberately stalled server command are denied
or timed out, with managed sessions released. Only generated fixture keys and a temporary
repository are used. The stopped OpenBao Raft files contain no private-key text. See
[L81 testing](../L81-vault-ssh/TESTING.md) for the shared transport proof command and limits.

Targeted contracts, server, client-runtime, web, mobile and provider-core typechecks pass,
along with changed-source lint and CLI help for `loom vault ssh-exec`/`git`. No new client
screen or native code requires repeated browser/device interaction checks in this section.
Existing web/iOS evidence remains in L79/L81. Formatting, Python syntax, all 246 local links in changed docs and declared seam markers
pass. No repository-wide suite is run.

## Remaining full acceptance

- Run installed live-model/scheduler, external-runner, relay and platform acceptance against
  disposable services. Hosted MCP/service behavior and shared provider bridges are verified;
  ordinary terminal routing, clone/push and GitHub API authentication remain unfinished.
- Attest real launched processes; prove socket/workload isolation at the chosen OS boundary.
- Revoke or reduce permissions during delivery and verify no new online use is granted.
- Verify signal/exit-code propagation, cancellation, crash cleanup and temporary-resource
  lifetimes for actual delivery modes.
- Verify actual remote/relay/tunnel and platform matrices, plus retained/recovered state.
- Demonstrate that normal responses, argv, prompts, receipts and logs contain no raw values.

The real proof establishes hosted SSH/Git authentication with synthetic keys. It establishes
no live provider-model invocation, GitHub account login, Android, boot/logout or production
recovery claim. A successful authorization check remains no reusable use capability.

## Merge safety

The new shared instruction seam is recorded in FORK.md and the seam manifest; all other
source changes are fork-owned. Source commit `fe77b4fb01` previews cleanly against the newest local
nightly `v0.1.1-nightly.20261017.3238`. The isolated dev server starts successfully. No fetch, landing, push or production
rollout is performed. Full post-landing rehearsal remains a separate integration check.

## GitHub terminal/readiness verification

The shared milestone passes 47 focused tests in eight files, scoped consumer typechecks,
changed-source lint and mobile native static checks. Web/iOS verified synthetic credential
failure, thread-specific denial and reference-only command copying; web also verified narrow
layout and expiry. Service cancellation releases the acquired provider session. Full evidence,
commands, merge baseline and live-provider/runner limits are in
[L82 testing](../L82-vault-connectors/TESTING.md#github-terminal-and-live-readiness-milestone).
The complete selected packet remains In progress.
