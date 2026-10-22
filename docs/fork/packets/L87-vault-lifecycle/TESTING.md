# L87 testing

Status: internal durable evidence ledger verified; live issuance/rotation acceptance remains open.
The packet is not complete.
Shared foundation checks are recorded in L79; they do not establish this packet's acceptance.

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

From `apps/server`:

```sh
../../node_modules/.bin/vp test run src/fork/vault/CredentialLifecycleLedger.test.ts
PYTHONDONTWRITEBYTECODE=1 python3 src/fork/vault/testkit/journal_proof.py --bao /verified/path/to/bao
```

The 15 lifecycle unit cases pass. They cover issuance/consumer-validation/revocation records,
monotonic generations, lost intent acknowledgements, persistent unknown states without remint,
immutable references/issuer/consumer binding, stale CAS, forbidden phase skips, expiry with
maintenance still permitted, corruption/future versions, capacity refusal and server timestamps.
The disposable OpenBao proof reloads issuing evidence after an actual backend restart, verifies
existing profiles/* rights/json-v1 envelopes/sibling denial and keeps policy-format-3 approvals
readable. See [L84 testing](../L84-vault-test-accounts/TESTING.md#durable-maintenance-ledger-evidence)
for combined checks. No live provider operation, rotation, broker process restart or cutover is
claimed. The internal ledger has no client/agent surface or enabled execution worker.

## Merge safety and results

Documentation checks cover paths, packet completeness, links and whitespace. No code seams are
created here. At implementation, record the actual focused results and required upstream merge
preview here; use the repository's post-merge rehearsal only at the authorized landing stage.
