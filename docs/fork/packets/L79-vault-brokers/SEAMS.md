# L79 seams

## Extension points

Existing fork extension points are reused where present. Proposed `ext-vault` is specified in
[LOOM-VAULT-FOUNDATION.md](../LOOM-VAULT-FOUNDATION.md); its implemented record boundary is specified in EXTENSION-POINTS.md and
future portions must be reconciled with [EXTENSION-POINTS.md](../EXTENSION-POINTS.md) before use.

## Packet integration review

Inspect CLI/service launch environments and desktop shell hydration. Keep broker startup independent of an Electron window; use a fork CLI registration rather than a second app-specific credential service.

These are candidate integration areas, not an approved list of upstream edits. Final source
locations, marked lines and any generated files must be enumerated after the extension and
backend decisions. Keep business logic in fork-owned paths.

## Actual seams and merge status

The enrollment slice adds shared contracts/services/client atoms and registers them in existing
fork-owned core, HTTP, RPC, CLI, MCP, permission and settings registries. Native mobile mounts
its broker section through the fork-owned Vault settings component. No new upstream seam or
SQL migration is needed. `makeForkRpcLayer` has an explicit checked handler-layer return type
so adding groups does not widen inferred Effect requirements to `any`.

Visible CLI/pairing branding is adjacent fork branding work, listed separately in FORK.md and
`docs/fork/seams.tsv`; it is not a new broker transport. Legacy internal identifiers remain
compatible. The selected full packet still needs the service/workload integration review above.
