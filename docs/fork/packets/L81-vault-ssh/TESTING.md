# L81 testing

Status: acceptance design. No implementation checks have run because this change is docs only.

## Automated behavior

- The agent lists and signs only the identities assigned to the workload.
- A generic signing request cannot bypass the documented destination enforcement mechanism.
- Changed host keys fail independently of successful user authentication.
- A restarted broker resumes authorized work; personal SSH configuration and unrelated agent sockets remain unchanged.

Add service and adapter contract tests beside the future fork-owned implementation. Use
synthetic credentials and disposable services. Assert that normal responses, persisted events,
logs and error summaries contain no secret values. Exercise permission ceilings and server
capability absence, not static markup or callback wiring.

## Manual and integrated acceptance

Use disposable SSH hosts and a test Git repository. Fetch repeatedly, reconnect and restart without 1Password prompts, then remove host trust and revoke a key. Verify Windows support or the explicit unsupported state selected at design review.

Run one integrated client pass after implementation is assembled, with Kyle's authorization for
browser/device use. Cover web, Electron shell and native mobile where this packet claims them,
plus a remote client and upstream-server compatibility. Verify keyboard operation, readable
errors, focus restoration and every reverse action.

## Focused verification commands

Once implementation files exist, assign concrete test filenames in this document and run:

```sh
vp test run apps/server/src/fork/vault-ssh/service.test.ts
vp lint apps/server/src/fork/vault-ssh
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
