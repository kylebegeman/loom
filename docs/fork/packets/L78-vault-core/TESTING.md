# L78 testing

Status: acceptance design. No implementation checks have run because this change is docs only.

## Automated behavior

- Unauthorized users cannot list or retrieve another scope's items, including via guessed IDs.
- Stored payloads and backups do not contain synthetic plaintext; wrong keys and corrupted ciphertext fail explicitly.
- Interrupted updates leave one committed version; archived and deleted records have distinct behavior.
- Restore a disposable Vault and prove item decryption plus grant invalidation after key recovery.

Add service and adapter contract tests beside the future fork-owned implementation. Use
synthetic credentials and disposable services. Assert that normal responses, persisted events,
logs and error summaries contain no secret values. Exercise permission ceilings and server
capability absence, not static markup or callback wiring.

## Manual and integrated acceptance

Exercise item creation and replacement from mobile and desktop against an isolated service. Restart it while a client reconnects; verify clear locked/unavailable states and no secret values in normal RPC, logs or saved conversations.

Run one integrated client pass after implementation is assembled, with Kyle's authorization for
browser/device use. Cover web, Electron shell and native mobile where this packet claims them,
plus a remote client and upstream-server compatibility. Verify keyboard operation, readable
errors, focus restoration and every reverse action.

## Focused verification commands

Once implementation files exist, assign concrete test filenames in this document and run:

```sh
vp test run apps/server/src/fork/vault-core/service.test.ts
vp lint apps/server/src/fork/vault-core
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
