# L86 testing

Status: acceptance targets for this packet. No complete packet implementation has been verified.
Shared foundation checks are recorded in L78; they do not establish this packet's acceptance.

## Automated behavior

- Crashes at each rotation phase reconcile without duplicate issuance or premature old-key deletion.
- An expired or revoked grant cannot renew a lease.
- Single-key providers report required interruption instead of claiming zero downtime.
- Failed upstream revocation remains visible; a local denial is not reported as remote credential destruction.

Add service and adapter contract tests beside the future fork-owned implementation. Use
synthetic credentials and disposable services. Assert that normal responses, persisted events,
logs and error summaries contain no secret values. Exercise permission ceilings and server
capability absence, not static markup or callback wiring.

## Manual and integrated acceptance

Rotate a disposable service credential across two consumers, force one validation failure, recover it, then revoke a short-lived lease. Restart the worker during cutover and verify the recorded outcome.

Run one integrated client pass after implementation is assembled, with Kyle's authorization for
browser/device use. Cover web, Electron shell and native mobile where this packet claims them,
plus a remote client and upstream-server compatibility. Verify keyboard operation, readable
errors, focus restoration and every reverse action.

## Focused verification commands

Once implementation files exist, assign concrete test filenames in this document and run:

```sh
vp test run apps/server/src/fork/vault-lifecycle/service.test.ts
vp lint apps/server/src/fork/vault-lifecycle
vp run --filter t3 typecheck
```

The test path above is the proposed service-test target, not a file present today. Add targeted
client-runtime/contract tests and consumer typechecks only for changed packages. Mobile work
also requires the mobile static check. Do not run these speculative paths now or invoke
repo-wide checks. Use worker drains, persisted milestones or controlled clocks for async tests.

## Merge safety and results

Documentation checks cover paths, packet completeness, links and whitespace. No code seams are
created here. At implementation, record the actual focused results and required upstream merge
preview here; use the repository's post-merge rehearsal only at the authorized landing stage.
