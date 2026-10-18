# L78: Encrypted Vault and self-hosted control plane

Status: **In progress**. Kyle authorized the complete packet and selected self-hosted OpenBao
on 2026-10-17. V07 | Major system | Complexity: Large | Impact: Transformational.

## Delivered foundation

Versioned encrypted records now use OpenBao KV v2 through the shared `ext-vault` services.
Web/desktop Loom Settings and native mobile computer settings provide creation, metadata-only
rename, explicit value replacement/reveal, archive, restore and deletion. Small secure files
have explicit import/download or share. MCP accepts private secret references and returns only
safe summaries; the authenticated CLI provides status, metadata listing and lifecycle changes.

A disposable OpenBao 2.7.1 Raft instance passed CAS, encrypted persistence and clean restore.
Focused tests exercise version conflicts, environment namespaces, private-input retry recovery
and management permissions. Isolated web/native iOS item and grant flows have been verified;
see [TESTING.md](./TESTING.md) for remaining interaction and platform coverage.

## Remaining complete scope

Platform-owned Vault accounts/control plane, production key custody and unattended backend
unlock, full durable decision audit, richer typed account/connection records, and production
operating/recovery integration remain unfinished. The current service token connection is a
development bootstrap, not enrolled-host authentication or per-item workload grants. Dorothy's
SSH setup and personal 1Password integration have not changed.

All sixteen Vault packets remain selected. See [PRODUCT.md](./PRODUCT.md) for the complete
outcome and [Loom Vault](../LOOM-VAULT.md) for dependency groups and open decisions. No live
rollout, personal-vault migration or credential registration is implied by this local work.

## Surfaces and boundaries

Web and desktop share the settings implementation. Mobile embeds the shared commands in the
selected computer's settings. All operations target that environment over authenticated RPC;
older/upstream servers have no Vault controls. MCP exposes no raw reveal/export operation.
Provider execution integrations are selected work in L79/L81/L82/L84, not part of this milestone.

[User help](../../user/vault.md) · [Operating guide](../../operations/vault.md) ·
[Technical design](./TECHNICAL.md) · [Seams](./SEAMS.md) ·
[Implementation](./IMPLEMENTATION.md) · [Testing](./TESTING.md) · [References](./REFERENCES.md).
