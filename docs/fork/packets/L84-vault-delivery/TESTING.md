# L84 testing

Status: signed authorization-check channel verified; full delivery acceptance remains pending.

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

Seven new tests and the existing host/runner/MCP registration regression checks pass: 17 tests
across six files in the combined run. The
broker CLI help resolves `loom vault broker workload-check` with explicit machine/workload
state directories and a public session file. Targeted typechecks and lint cover changed
contracts, server, client-runtime, web and mobile. No new client UI or native code requires browser/device
interaction checks in this cycle. Existing web/iOS broker evidence remains recorded in L79.

## Remaining full acceptance

- Execute a harmless authenticated SSH/GitHub operation through Pi and another installed
  provider, standalone runner and scheduled workload.
- Attest real launched processes; prove socket/workload isolation at the chosen OS boundary.
- Revoke or reduce permissions during delivery and verify no new online use is granted.
- Verify signal/exit-code propagation, cancellation, crash cleanup and temporary-resource
  lifetimes for actual delivery modes.
- Verify actual remote/relay/tunnel and platform matrices, plus retained/recovered state.
- Demonstrate that normal responses, argv, prompts, receipts and logs contain no raw values.

These check-only tests establish no actual credential-delivery, Pi launch, SSH/GitHub login,
Android, boot/logout or production recovery claim. L81 separately verifies a mediated SSH
command using fresh command-bound proofs. A successful check is not a reusable use capability.

## Merge safety

The source milestone at `e6bcd7c24a` previews cleanly against the newest local upstream
nightly, `v0.1.1-nightly.20261017.3238`, using `git merge-tree --write-tree --name-only
--no-messages`. The seam manifest check also passes. No fetch, landing, push or production
rollout was performed. Full post-landing rehearsal remains a separate integration check.
