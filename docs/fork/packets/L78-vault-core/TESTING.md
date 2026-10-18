# L78 testing

Status: encrypted-record foundation checked locally. The complete packet remains in progress.
All credentials and OpenBao data in these checks are synthetic.

## Passing automated checks

Focused backend/contract/client checks cover 68 tests across these files:

- `apps/server/src/fork/vault/OpenBaoStore.test.ts`: configuration, private-token handling,
  status, bounded responses, CAS and redacted requests/errors.
- `VaultCore.test.ts`: safe metadata, idempotent mutation retries, CAS races, record lifecycle,
  metadata-only rename, reveal preconditions, private receipts, live authorization checks,
  pagination, environment namespace separation and invalid/oversized input.
- `VaultPrivateInput.test.ts`: committed-response loss, consumed-source retry, authenticated
  project binding, missing threads and authorization revocation before persistence.
- `vault/rpc.test.ts` and `fork/rpcAuthorization.test.ts`: read/write separation, explicit reveal
  protection, no work before denial, exhaustive scope mapping and no upstream tag collisions.
- `secrets/SecretRequests.test.ts`: existing one-use behavior plus claimed-transfer retries and
  failed cleanup. `fork/mcp/registration.test.ts`: all registered tools compile at startup.
- `packages/contracts/src/fork/vault-core.test.ts`: redacted values, metadata-only input,
  private-reference ingress and secure-file boundary validation.
- `packages/client-runtime/src/fork/vault-core.permissions.test.ts`: destination-scoped
  permissions and revocation for save, lifecycle changes and reveal.

The integrated focused run passed 65 non-contract tests and 2 contract tests; one malformed
base64 fixture was actually valid base64. After correcting that test input, all 3 contract tests
passed on the final rerun. No production behavior was weakened to satisfy it.

Affected contracts, server, client-runtime, web and mobile packages typecheck. Targeted lint and
format checks pass. Native mobile static checks passed SwiftLint, ktlint and detekt. No repo-wide suite was run. The subsequent access milestone has authorized isolated web/native
iOS verification; see L80/L77/L72 TESTING.md for its exact coverage.

## Real OpenBao proof

The repository fixture `apps/server/src/fork/vault/testkit/openbao_proof.py` passed against the
checksum-verified official OpenBao **2.7.1** binary. It runs the integration test twice: initial
CAS/version/encrypted-persistence assertions and clean restored-record assertions. Each stage
runs its applicable test and skips the other stage's test. The fixture waits on startup/active
leadership events, stops captured processes and removes temporary data in finally.

Persisted Raft bytes did not contain the synthetic canary, and the restored instance decrypted
the expected version after unseal. This is baseline evidence, not a production restore drill,
wrong-key/corruption acceptance or complete recovery/grant-invalidation implementation.

Reproduction instructions are in [the operating guide](../../operations/vault.md).

## Integration and remaining acceptance

The access milestone exercised isolated web and native iOS item/grant flows with Kyle's
authorization. Electron-specific and Android interaction verification remain unrun. Remaining
checks include complete keyboard/screen-reader
operation, file import/export, dismiss/focus behavior, reconnect with an active editor, permission
loss during an operation and remote/version-skew behavior in real clients. Static capability and
permission gates exist but do not substitute for these interaction checks.

Reviewed broker host identity is implemented in L79. The platform account model, authenticated
workload delivery, full durable audit and production custody/recovery are unfinished. No live credential migration, SSH/GitHub registration, VPS rollout or personal
1Password change was performed. Complete PRODUCT acceptance before marking the packet Done.

Seam-only validation and changed Markdown link checks pass. The merge-tree preview of the
integrated milestone against the newest locally available nightly,
`v0.1.1-nightly.20261017.3238`, exited 0 with no conflicts. No fetch or full upstream
integration rehearsal is claimed from this feature worktree.
