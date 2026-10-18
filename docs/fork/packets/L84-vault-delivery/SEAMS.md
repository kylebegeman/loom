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

The workload-check milestone uses shared contracts/services and existing fork-owned core,
HTTP, MCP and CLI registries. It adds no upstream seam, SQL migration, production dependency
or provider prompt injection. Broker HTTP validation is shared by the two runner services.
There are no new web/native controls; the existing agent/tool path is used from each surface.
Real provider launch hooks and purpose-specific delivery still require integration review.
