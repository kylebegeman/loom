# L84 seams

## Extension points

Existing fork extension points are reused where present. Proposed `ext-vault` is specified in
[LOOM-VAULT-FOUNDATION.md](../LOOM-VAULT-FOUNDATION.md); its implemented record boundary is specified in EXTENSION-POINTS.md and
future portions must be reconciled with [EXTENSION-POINTS.md](../EXTENSION-POINTS.md) before use.

## Packet integration review

Inspect provider session process environment and shared turn-input hooks. Reuse Pi's existing system-prompt channel; add capability-aware guidance without embedding credentials or requiring a separate Vault MCP process for every provider.

These are candidate integration areas, not an approved list of upstream edits. Final source
locations, marked lines and any generated files must be enumerated after the extension and
backend decisions. Keep business logic in fork-owned paths.

## Actual seams and merge status

Services, signed SSH/Git contracts and hosted operations use existing fork-owned registries.
There is no SQL migration, production dependency or new web/native control. One upstream file,
`packages/provider-core/src/server/orchestrationInstructions.ts`, imports fork-owned Vault
guidance and prepends it through the existing provider instruction constant. Both marked
`fork: ext-vault` lines are registered in FORK.md and `docs/fork/seams.tsv`; no provider adapter
is edited. This shared instruction boundary is recorded in EXTENSION-POINTS.md. Ordinary
terminal environment attachment and additional delivery modes still need integration review.

GitHub terminal routing/readiness extends fork-owned contracts, adapters, services, CLI/MCP,
protected RPC registrations and web/native settings. It adds no upstream seams, dependencies,
SQL migrations or production infrastructure changes.
