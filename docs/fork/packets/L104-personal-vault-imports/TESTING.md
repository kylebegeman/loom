# L104 testing

## Evidence today

Current development-import and native-picker source was read; references were checked locally.
No personal parser/export implementation or real import was run. No browser, server, service,
credential read, dependency install or live 1Password operation was performed.

## Proposed suites

- `packages/contracts/src/fork/personal-vault-imports.test.ts`: bounded plan/result shapes,
  exact terminal-item/attachment counts, safe failures and unsupported-version states.
- `packages/client-runtime/src/fork/personal-vault-imports.test.ts`: synthetic mapping fidelity,
  unknown fields, TOTP parameter preservation, duplicate review binding, conflict-aware undo,
  cancellation and resumable receipt behavior.
- Trusted parser/native suite: malformed ZIP/JSON, traversal/absolute paths, symlinks,
  duplicate entries, decompression limits, missing/corrupt/oversized attachments, interrupted
  output and independently reopened encrypted export. Use its actual future manifest command.

The TS commands are proposed after those files exist:

```sh
vp test run packages/contracts/src/fork/personal-vault-imports.test.ts packages/client-runtime/src/fork/personal-vault-imports.test.ts
vp lint packages/contracts/src/fork/personal-vault-imports.ts packages/client-runtime/src/fork/personal-vault-imports.ts
vp run --filter @t3tools/contracts typecheck
vp run --filter @t3tools/client-runtime typecheck
```

Do not call a TS mapper test evidence for secure native archive parsing or engine recovery.
Typecheck only changed consumers and run actual native checks once the target exists.

## Acceptance cases

With synthetic data on trusted Mac, preview without writes, change mapping, inspect duplicates,
commit a subset, cancel mid-batch, lose a result, resume, inspect complete accounting and undo
unchanged results. Edit a committed item, then verify undo reports conflict. Check every mapped
field, unsupported record and attachment against the source manifest. Include all-unsupported
input and invalid files whose item counts are unknowable.

Lock/revoke during parsing, review, write and export. Late results cannot reveal or commit
under a stale authority. Simulate full storage, process restart and damaged output. Reopen
an encrypted export on a clean trusted iPhone/Mac fixture client and test wrong factors,
tampering and missing files; distinguish prepared, exported and verified.

Inspect synthetic transport/log captures for source paths, titles, source account names,
values, seeds, raw archive bytes and attachment names. None may reach Loom server, RPC, MCP,
prompt, telemetry or an agent workspace. Agent-controlled T3 preview is never used for
confidential import. Check Android/Windows/Linux/general web unsupported states and ordinary
upstream/old-server compatibility. Primary-agent manual verification requires authorization.

## Merge safety

No code seams or merge rehearsal exist for this documentation. Future implementation records
actual seam/merge results and focused checks without running a repo-wide suite here.
