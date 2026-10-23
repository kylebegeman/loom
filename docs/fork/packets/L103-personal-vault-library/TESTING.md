# L103 testing

## Current status

Design/source checks only; no library implementation, automated feature test, native run or
real-secret handling performed. L101 is a separate first build, not a personal-library claim.

## Proposed behavior tests

- `packages/contracts/src/fork/personal-vault-library.test.ts`: typed field round-trips,
  unknown-field preservation, limits, unsupported TOTP parameters and no wire reveal schema.
- `packages/client-runtime/src/fork/personal-vault-library.test.ts`: revision conflicts,
  archive/restore, favorite/unfavorite, history restore creates a new revision, deletion
  retention, search cancellation and lock/revoke discarding delayed plaintext results.
- Selected trusted-client target tests: encrypted-at-rest search/title/history/attachment
  canaries, corrupted file handling, owned clipboard behavior, local export cancellation and
  reopened-export equivalence. Record the actual native manifest command after target choice.

Commands below are for proposed TS files after implementation, not tests that exist today:

```sh
vp test run packages/contracts/src/fork/personal-vault-library.test.ts packages/client-runtime/src/fork/personal-vault-library.test.ts
vp lint packages/contracts/src/fork/personal-vault-library.ts packages/client-runtime/src/fork/personal-vault-library.ts
vp run --filter @t3tools/contracts typecheck
vp run --filter @t3tools/client-runtime typecheck
```

Typecheck changed consumers; native targets need their real build/test commands. No repo-wide
suite or static-markup test is justified for these packet documents.

## Integrated acceptance, once authorized

With synthetic data, use trusted Mac/iPhone clients to create every type, search/favorite,
edit/cancel, reveal/hide/copy, archive/restore, inspect/restore history and export/reopen.
Attempt invalid revisions, corrupt files, unsupported types, full storage and interrupted
writes/exports. Confirm no phantom success or silent data loss.

Lock during search, detail read, file-open and export preparation. Revoke the device and retry
stale handles. Clear search indexes/transient views and reject late results. Inspect only
synthetic network/log captures to prove that titles, queries, domains, usernames, card data,
recovery codes, TOTP seeds and file names/bytes never reach Loom server, RPC, MCP or prompt.

Check explicit Android/Windows/Linux/general web unavailable states and old/upstream-server
behavior. Do not route confidential fixtures into agent-controlled T3 preview. For real
critical custody, require independently reviewed isolation and recovery evidence first.

## Merge safety

No implementation seams or merge preview/rehearsal run. Later code records its focused
results, actual target/tag and applicable seam/merge checks.
