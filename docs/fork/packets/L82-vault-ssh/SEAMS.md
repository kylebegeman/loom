# L82 seams

## Extension points

Existing fork extension points are reused where present. Proposed `ext-vault` is specified in
[LOOM-VAULT-FOUNDATION.md](../LOOM-VAULT-FOUNDATION.md); its implemented record boundary is specified in EXTENSION-POINTS.md and
future portions must be reconciled with [EXTENSION-POINTS.md](../EXTENSION-POINTS.md) before use.

## Packet integration review

Inspect packages/ssh, device-host SSH and MiniSshTransport independently. Prefer a shared credential adapter; do not rewrite base SSH arguments globally or relax host-key checking.

These are candidate integration areas, not an approved list of upstream edits. Final source
locations, marked lines and any generated files must be enumerated after the extension and
backend decisions. Keep business logic in fork-owned paths.

## Actual seams and merge status

The mediated-command milestone adds fork-owned contracts, Vault services, a scoped Node SSH
adapter and HTTP/MCP/CLI registration through existing fork registries. It extends the shared
workload proof with an operation-specific digest while preserving check/release signing messages.
No upstream file, SQL schema, application dependency, global SSH setting or personal credential
store is changed. Client key/trust UI, protected RPCs, palette navigation and shared refresh
reuse existing fork-owned registries. Hosted SSH/Git access and automatic session setup use
these same services. L85 owns the two-line `ext-vault` marker boundary in shared provider
instructions; L82 adds no upstream file. Explicit terminal activation registers in fork-owned contracts, SSH services, CLI/MCP and
capability lists. Provider guidance stays in `packages/provider-core/src/fork/vaultInstructions.ts`
through the existing shared seam. No new upstream file or seam is added. The OpenBao adapter
encoding fix is shared with L79 and documented there. Remaining harness setup, persistent
activation, imports and Windows transports still need implementation. Focused merge verification
is recorded in TESTING.md; no landing or deployment is implied.
