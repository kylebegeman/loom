# L77 seams

## Extension points

Existing fork extension points are reused where present. Proposed `ext-vault` is specified in
[LOOM-VAULT-FOUNDATION.md](../LOOM-VAULT-FOUNDATION.md); its implemented record boundary is specified in EXTENSION-POINTS.md and
future portions must be reconciled with [EXTENSION-POINTS.md](../EXTENSION-POINTS.md) before use.

## Packet integration review

Register background work in the fork service layer. Existing scheduler turns are not required for health checks; avoid generating agent conversations for maintenance.

These are candidate integration areas, not an approved list of upstream edits. Final source
locations, marked lines and any generated files must be enumerated after the extension and
backend decisions. Keep business logic in fork-owned paths.

## Actual seams and merge status

No new upstream seams. Contracts, the protected RPC group, server/client permission maps,
services/reactor, CLI/MCP registrations and web/native settings all extend fork-owned files.
Existing Vault access-review and palette hosts are reused. The service adds an encrypted
OpenBao record, not an application SQL migration or a runtime dependency.

The operating policy needs read/create/update on this environment namespace's `health` path.
That production policy change is documented and waiting on the host owner; it was not applied.
