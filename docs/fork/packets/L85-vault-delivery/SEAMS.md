# L85 seams

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

Services, signed SSH/Git contracts and hosted operations use fork-owned registries.
The existing provider instruction seam adds a separate Vault instruction section, keeping main's
orchestration section order and the native Codex per-entry size limit intact.

Native terminal setup adds `fork: ext-vault-terminal` in:

- `packages/provider-core/src/server/mcpSession.ts`: optional private connection-file path and environment helper.
- `packages/provider-core/src/server/McpProviderSessions.ts`: file creation, rotation and cleanup tied to provider sessions.
- `apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts`: thread shell environment path, refreshed on start/resume.
- `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts`: current session path in the query environment; changed MCP identity recreates the query.
- The two adapter tests and `ProviderSessionManager.test.ts`: configuration and lifecycle regressions, including asynchronous file cleanup after the parallel shutdown deadline.

All are listed in FORK.md and the seam manifest. File IO and connection parsing remain
in fork-owned modules. No SQL migration, runtime dependency, global shell setup or production
infrastructure change is introduced.

GitHub terminal routing/readiness extends fork-owned contracts, adapters, services, CLI/MCP,
protected RPC registrations and web/native settings. It adds no upstream seams, dependencies,
SQL migrations or production infrastructure changes.
