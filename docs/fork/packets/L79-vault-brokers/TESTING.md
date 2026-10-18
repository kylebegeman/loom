# L79 testing

Status: acceptance targets for this packet. No complete packet implementation has been verified.
Shared foundation checks are recorded in L78; they do not establish this packet's acceptance.

## Automated behavior

- A copied enrollment code cannot claim a different machine or be reused.
- Service restart works under the intended OS account without personal vault access.
- A disabled online host cannot obtain a new lease; offline leases expire at the published bound.
- An unrelated local process cannot impersonate a workload through a socket path or guessed thread ID.

Add service and adapter contract tests beside the future fork-owned implementation. Use
synthetic credentials and disposable services. Assert that normal responses, persisted events,
logs and error summaries contain no secret values. Exercise permission ceilings and server
capability absence, not static markup or callback wiring.

## Manual and integrated acceptance

Enroll isolated macOS and Linux hosts, restart their services, disconnect the control plane and disable one host. Test the macOS logged-out case and report actual support rather than assuming LaunchAgent startup equals boot startup.

Run one integrated client pass after implementation is assembled, with Kyle's authorization for
browser/device use. Cover web, Electron shell and native mobile where this packet claims them,
plus a remote client and upstream-server compatibility. Verify keyboard operation, readable
errors, focus restoration and every reverse action.

## Focused verification commands

Once implementation files exist, assign concrete test filenames in this document and run:

```sh
vp test run apps/server/src/fork/vault-brokers/service.test.ts
vp lint apps/server/src/fork/vault-brokers
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
