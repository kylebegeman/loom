# L80 testing

Status: acceptance design. No implementation checks have run because this change is docs only.

## Automated behavior

- A child cannot request a broader resource, action, lifetime or destination than its parent.
- Spoofed project paths or thread IDs do not establish identity.
- Revocation invalidates new online use; previously delivered material has explicitly bounded guarantees.
- A permitted Vault grant cannot override T3 environment authorization or a restricted MCP caller.

Add service and adapter contract tests beside the future fork-owned implementation. Use
synthetic credentials and disposable services. Assert that normal responses, persisted events,
logs and error summaries contain no secret values. Exercise permission ceilings and server
capability absence, not static markup or callback wiring.

## Manual and integrated acceptance

Create one GitHub grant, run a parent and child task, then suspend and revoke access while work is pending. Confirm the same decision from web, mobile and CLI.

Run one integrated client pass after implementation is assembled, with Kyle's authorization for
browser/device use. Cover web, Electron shell and native mobile where this packet claims them,
plus a remote client and upstream-server compatibility. Verify keyboard operation, readable
errors, focus restoration and every reverse action.

## Focused verification commands

Once implementation files exist, assign concrete test filenames in this document and run:

```sh
vp test run apps/server/src/fork/vault-grants/service.test.ts
vp lint apps/server/src/fork/vault-grants
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
