# L74 seams

## Implemented integration

All new implementation lives in fork-owned contracts, services, client-runtime and client
components. Existing core, RPC, settings, palette, CLI and MCP extension points register it.
The common provider instruction extension is reused without additional upstream changes.
The initial management milestone added no upstream seams. Launch integration now adds the
marked files listed below; no SQL migration or production dependency is added.

The shared boundary is documented in [EXTENSION-POINTS.md](../EXTENSION-POINTS.md#loom-vault-foundation-ext-vault).
Other packets consume shared references/profiles, never this packet's UI internals.

## Remaining integration

Portable requirements and additional consumers still require explicit integration design. They must not put credential values into turn events or bypass current
environment authority. Full packet acceptance remains open.

## Merge verification

The committed implementation is previewed with `git merge-tree` against the newest locally
available upstream nightly before handoff. The result and tag are recorded in TESTING.md.

## Launch integration seams

- `apps/server/src/orchestration-v2/ProviderTurnStartService.ts`: `ext-vault-preflight`, import and guard/failure settlement before session open.
- `apps/server/src/orchestration-v2/ProviderTurnStartService.test.ts`: `ext-vault-preflight`, regression tests for blocked starts.
- `apps/server/src/orchestration-v2/ProviderTurnControlService.ts`: `ext-vault-preflight`, guard before steering delivery.

FORK.md and seams.tsv enumerate these markers. The blocking guard is independent of the
optional `ext-turn-input` contributor proposal because a required check cannot be skipped.

## Completion output seam

`apps/server/src/binCli.ts` uses `ext-cli` for the fork command import, registration and
`withVaultCompletionOutput` around Command.run. The fork helper redirects this completion
command's parse/help Console output to stderr; its successful canonical candidates write stdout
explicitly. Other commands retain their existing output behavior. FORK.md and seams.tsv track it.

`evals/mcp-tool-use/run.ts` includes the real reference toolkit (`vault-references`) for model evaluation.
